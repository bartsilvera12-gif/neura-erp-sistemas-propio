import "server-only";
import type { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { etiquetaVisibleTipoServicio } from "@/lib/clientes/tipo-servicio-catalogo";
import { telefonoSignificativo } from "@/lib/telefono";

type Sb = Awaited<ReturnType<typeof getChatServiceClientForEmpresa>>;

const PAGE = 800;
const ESTADOS_NO_DEUDA = new Set(["pagado", "anulado", "corregida nc"]);

export type TramoKey = "por_vencer" | "tramo_1" | "tramo_2" | "tramo_3";

/** Un servicio = una suscripción (o el bucket "General" para facturas sin suscripcion_id). */
export type ServicioCobranza = {
  suscripcion_id: string | null;
  tipo: string; // etiqueta visible: Contable / SaaS / Web / General / ...
  plan: string | null;
  monto_mensual: number | null;
  total_adeudado: number;
  cuotas_vencidas: number;
  meses_adeudados: string[]; // por mes de vencimiento
  tramo: TramoKey;
  proximo_vencimiento: string | null;
};

export type ClienteCobranza = {
  cliente_id: string;
  cliente_label: string;
  ultimo_pago: string | null;
  /** Promesa de pago pendiente vigente (la más reciente), YYYY-MM-DD o null. */
  promesa_fecha: string | null;
  /** Deuda desglosada por servicio/suscripción. El front deriva total/tramo/tipo. */
  servicios: ServicioCobranza[];
  /** ¿Se le envió algún mensaje saliente de WhatsApp este mes? (cruce por teléfono → contacto). */
  mensaje_mes_enviado: boolean;
  /** Fecha (YYYY-MM-DD) del último mensaje saliente de este mes, o null. */
  mensaje_mes_fecha: string | null;
};

export type PromesaPago = {
  id: string;
  fecha_promesa: string | null;
  estado: string;
  creado_por_email: string | null;
  created_at: string | null;
};

export type CobranzasResumen = {
  total_adeudado: number;
  clientes_con_deuda: number;
  cuotas_vencidas_total: number;
  por_tramo: { por_vencer: number; tramo_1: number; tramo_2: number; tramo_3: number };
};

export type FacturaLite = {
  id: string;
  numero_factura: string | null;
  fecha: string | null;
  fecha_vencimiento: string | null;
  monto: number;
  saldo: number;
  estado: string | null;
  tipo: string | null;
  vencida: boolean;
};

export type PagoLite = { factura_id: string; numero_factura: string | null; fecha_pago: string | null; monto: number; metodo_pago: string | null };

export type ServicioDetalle = ServicioCobranza & {
  facturas_vencidas: FacturaLite[];
  facturas_pendientes: FacturaLite[];
};

export type DetalleCobranza = {
  cliente: {
    cliente_id: string;
    cliente_label: string;
    tipo: string;
    plan: string | null;
    monto_mensual: number | null;
    alta: string | null;
    mensaje_mes_enviado: boolean;
    mensaje_mes_fecha: string | null;
  };
  total_deuda: number;
  cuotas_vencidas: number;
  tramo: TramoKey;
  meses_adeudados: string[];
  facturas_pendientes: FacturaLite[];
  facturas_vencidas: FacturaLite[];
  pagos_recientes: PagoLite[];
  promesas: PromesaPago[];
  servicios: ServicioDetalle[];
};

/**
 * Tramo de mora por cantidad de cuotas vencidas. Dentro de Cobranzas el cliente SIEMPRE
 * tiene saldo pendiente (se filtra deuda>0): 0 cuotas vencidas = "Por vencer" (no "Al día").
 */
export function tramoDe(cuotasVencidas: number): TramoKey {
  if (cuotasVencidas <= 0) return "por_vencer";
  if (cuotasVencidas === 1) return "tramo_1";
  if (cuotasVencidas === 2) return "tramo_2";
  return "tramo_3";
}

/** Hoy en America/Asuncion como YYYY-MM-DD. */
export function hoyAsuncionYmd(now: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Asuncion",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(now); // en-CA → YYYY-MM-DD
}

function ymd(s: string | null | undefined): string {
  return s ? String(s).slice(0, 10) : "";
}

function esDeuda(estado: string | null | undefined): boolean {
  return !ESTADOS_NO_DEUDA.has(String(estado ?? "").trim().toLowerCase());
}

/** Cliente activo para Cobranzas: estado 'activo' (o null=default) y no eliminado. */
function esClienteActivo(c: Record<string, unknown> | undefined | null): boolean {
  if (!c) return false;
  if (c.deleted_at != null) return false;
  const est = String(c.estado ?? "activo").trim().toLowerCase();
  return est === "activo";
}

/** Mapa slug→nombre del catálogo de tipos de servicio de la empresa. */
async function cargarCatalogoTipos(sb: Sb, empresaId: string): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  const { data } = await sb
    .from("cliente_tipos_servicio_catalogo")
    .select("slug, nombre")
    .eq("empresa_id", empresaId);
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const slug = String(r.slug ?? "").trim().toLowerCase();
    const nombre = String(r.nombre ?? "").trim();
    if (slug && nombre) map[slug] = nombre;
  }
  return map;
}

async function fetchAll(
  sb: Sb,
  table: string,
  columns: string,
  empresaId: string
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from(table)
      .select(columns)
      .eq("empresa_id", empresaId)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const chunk = (data ?? []) as unknown as Record<string, unknown>[];
    out.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return out;
}

type SuscInfo = {
  tipo_servicio: string | null;
  /** Tipo del PLAN (slug del catálogo): fuente del tipo del SERVICIO en Cobranzas. */
  plan_tipo: string | null;
  plan: string | null;
  precio: number | null;
};

/** Mapa suscripcion_id → { tipo_servicio, plan_tipo, plan, precio } (TODAS las suscripciones, cualquier estado). */
async function cargarSuscripcionInfo(sb: Sb, empresaId: string): Promise<Map<string, SuscInfo>> {
  const subs = await fetchAll(sb, "suscripciones", "id, plan_id, precio, tipo_servicio", empresaId);
  const planIds = [...new Set(subs.map((s) => String(s.plan_id ?? "")).filter(Boolean))];
  const planNombre = new Map<string, string>();
  const planTipo = new Map<string, string | null>();
  for (let i = 0; i < planIds.length; i += 120) {
    const slice = planIds.slice(i, i + 120);
    if (slice.length === 0) break;
    const { data } = await sb.from("planes").select("id, nombre, tipo_servicio").in("id", slice);
    for (const p of (data ?? []) as Record<string, unknown>[]) {
      planNombre.set(String(p.id), String(p.nombre ?? ""));
      const t = p.tipo_servicio != null ? String(p.tipo_servicio).trim().toLowerCase() : "";
      planTipo.set(String(p.id), t || null);
    }
  }
  const map = new Map<string, SuscInfo>();
  for (const s of subs) {
    const planId = String(s.plan_id ?? "");
    map.set(String(s.id), {
      tipo_servicio: s.tipo_servicio != null ? String(s.tipo_servicio) : null,
      plan_tipo: planTipo.get(planId) ?? null,
      plan: planNombre.get(planId) || null,
      precio: s.precio != null ? Number(s.precio) : null,
    });
  }
  return map;
}

const PESO_TRAMO: Record<TramoKey, number> = { tramo_3: 3, tramo_2: 2, tramo_1: 1, por_vencer: 0 };

/** Peor (más alto) tramo entre los servicios. */
export function peorTramo(tramos: TramoKey[]): TramoKey {
  let worst: TramoKey = "por_vencer";
  for (const t of tramos) if (PESO_TRAMO[t] > PESO_TRAMO[worst]) worst = t;
  return worst;
}

type GrupoServicio = {
  suscripcion_id: string | null;
  tipo: string;
  plan: string | null;
  monto: number | null;
  facturas: FacturaLite[];
};

/** Agrupa las facturas-deuda de un cliente por suscripción (o "General" si no tiene suscripcion_id). */
function agruparPorServicio(
  facturasCliente: Record<string, unknown>[],
  suscInfo: Map<string, SuscInfo>,
  catalogo: Record<string, string>,
  clienteTipoSlug: string | null | undefined,
  hoyYmd: string
): GrupoServicio[] {
  const grupos = new Map<string, GrupoServicio>();
  for (const f of facturasCliente) {
    const saldo = Number(f.saldo) || 0;
    if (saldo <= 0 || !esDeuda(f.estado as string)) continue;
    const sid = f.suscripcion_id != null ? String(f.suscripcion_id) : "";
    const key = sid || "general";
    let g = grupos.get(key);
    if (!g) {
      // El tipo de un SERVICIO sale del TIPO DE SU PLAN (`planes.tipo_servicio`). Así un mismo
      // cliente con suscripciones de distinto servicio (p. ej. Contable + SaaS) aparece en el
      // filtro de CADA equipo con la deuda que le corresponde. Si el plan no tiene tipo cargado,
      // se cae al tipo del CLIENTE (`clientes.tipo_servicio_cliente`). Las facturas SIN suscripción
      // (bucket "general": contado, o facturas huérfanas) usan el tipo del cliente.
      const clienteSlug = clienteTipoSlug ?? null;
      if (key === "general") {
        const label = clienteSlug ? etiquetaVisibleTipoServicio(clienteSlug, catalogo) : "Sin clasificar";
        g = { suscripcion_id: null, tipo: label, plan: null, monto: null, facturas: [] };
      } else {
        const info = suscInfo.get(sid);
        const slug = (info?.plan_tipo ?? null) || clienteSlug;
        const label = slug ? etiquetaVisibleTipoServicio(slug, catalogo) : "Sin clasificar";
        g = {
          suscripcion_id: sid,
          tipo: label,
          plan: info?.plan ?? null,
          monto: info?.precio ?? null,
          facturas: [],
        };
      }
      grupos.set(key, g);
    }
    const venc = ymd(f.fecha_vencimiento as string);
    g.facturas.push({
      id: String(f.id),
      numero_factura: (f.numero_factura as string) ?? null,
      fecha: ymd(f.fecha as string) || null,
      fecha_vencimiento: venc || null,
      monto: Number(f.monto) || 0,
      saldo,
      estado: (f.estado as string) ?? null,
      tipo: (f.tipo as string) ?? null,
      vencida: !!venc && venc < hoyYmd,
    });
  }
  return [...grupos.values()];
}

/** Aggrega un grupo de servicio a ServicioCobranza (total, cuotas, meses, próximo, tramo). */
function aggServicio(g: GrupoServicio): ServicioCobranza {
  let total = 0;
  let cuotas = 0;
  const meses = new Set<string>();
  let proximo: string | null = null;
  for (const f of g.facturas) {
    total += f.saldo;
    if (f.vencida) {
      cuotas += 1;
      const m = (f.fecha_vencimiento ?? "").slice(0, 7);
      if (m) meses.add(m);
    } else if (f.fecha_vencimiento) {
      if (!proximo || f.fecha_vencimiento < proximo) proximo = f.fecha_vencimiento;
    }
  }
  return {
    suscripcion_id: g.suscripcion_id,
    tipo: g.tipo,
    plan: g.plan,
    monto_mensual: g.monto,
    total_adeudado: Math.round(total * 100) / 100,
    cuotas_vencidas: cuotas,
    meses_adeudados: [...meses].sort(),
    tramo: tramoDe(cuotas),
    proximo_vencimiento: proximo,
  };
}

/** Mapa cliente_id → fecha de la promesa de pago pendiente más reciente (por created_at). */
async function cargarPromesasPendientes(sb: Sb, empresaId: string): Promise<Map<string, string>> {
  const fechaPorCliente = new Map<string, string>();
  const createdPorCliente = new Map<string, string>();
  const { data } = await sb
    .from("cobranza_promesas")
    .select("cliente_id, fecha_promesa, created_at")
    .eq("empresa_id", empresaId)
    .eq("estado", "pendiente");
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const cid = String(r.cliente_id ?? "");
    if (!cid) continue;
    const fecha = r.fecha_promesa != null ? String(r.fecha_promesa).slice(0, 10) : "";
    if (!fecha) continue;
    const cAt = r.created_at != null ? String(r.created_at) : "";
    const prev = createdPorCliente.get(cid);
    if (!prev || cAt > prev) {
      createdPorCliente.set(cid, cAt);
      fechaPorCliente.set(cid, fecha);
    }
  }
  return fechaPorCliente;
}

/**
 * ¿A qué clientes se les envió algún mensaje SALIENTE de WhatsApp este mes?
 * Cruce por teléfono: cliente.telefono → dígitos significativos → chat_contacts.phone_normalized
 * → chat_conversations → chat_messages (from_me=true) con fecha en [inicio, fin] del mes.
 * Devuelve cliente_id → { enviado, fecha } (solo para los que SÍ tuvieron mensaje).
 */
async function cargarMensajeEsteMes(
  sb: Sb,
  empresaId: string,
  telPorCliente: Map<string, string>,
  ym: string
): Promise<Map<string, { enviado: boolean; fecha: string | null }>> {
  const res = new Map<string, { enviado: boolean; fecha: string | null }>();
  // sig (número nacional) → clientes con ese número.
  const sigToClientes = new Map<string, Set<string>>();
  for (const [cid, tel] of telPorCliente) {
    const sig = telefonoSignificativo(String(tel ?? ""));
    if (sig.length < 6) continue;
    if (!sigToClientes.has(sig)) sigToClientes.set(sig, new Set());
    sigToClientes.get(sig)!.add(cid);
  }
  if (sigToClientes.size === 0) return res;

  // Candidatos de phone_normalized (guardado casi siempre como "595"+nacional).
  const cands = new Set<string>();
  for (const sig of sigToClientes.keys()) {
    cands.add("595" + sig);
    cands.add(sig);
    cands.add("0" + sig);
  }
  const candList = [...cands];

  // Contactos que matchean → contact_id → sig.
  const contactToSig = new Map<string, string>();
  for (let i = 0; i < candList.length; i += 100) {
    const slice = candList.slice(i, i + 100);
    const { data } = await sb
      .from("chat_contacts")
      .select("id, phone_normalized")
      .eq("empresa_id", empresaId)
      .in("phone_normalized", slice);
    for (const c of (data ?? []) as Record<string, unknown>[]) {
      const sig = telefonoSignificativo(String(c.phone_normalized ?? ""));
      if (sigToClientes.has(sig)) contactToSig.set(String(c.id), sig);
    }
  }
  if (contactToSig.size === 0) return res;

  // Conversaciones de esos contactos → conversation_id → contact_id.
  const contactIds = [...contactToSig.keys()];
  const convToContact = new Map<string, string>();
  for (let i = 0; i < contactIds.length; i += 100) {
    const slice = contactIds.slice(i, i + 100);
    const { data } = await sb
      .from("chat_conversations")
      .select("id, contact_id")
      .eq("empresa_id", empresaId)
      .in("contact_id", slice);
    for (const cv of (data ?? []) as Record<string, unknown>[]) {
      convToContact.set(String(cv.id), String(cv.contact_id));
    }
  }
  if (convToContact.size === 0) return res;

  // Mensajes salientes (from_me=true) con fecha en el mes.
  const [yy, mm] = ym.split("-").map((x) => parseInt(x, 10));
  const lastDay = new Date(yy, mm, 0).getDate();
  const desde = `${ym}-01`;
  const hasta = `${ym}-${String(lastDay).padStart(2, "0")}T23:59:59.999`;
  const convIds = [...convToContact.keys()];
  const sigMaxFecha = new Map<string, string>(); // sig → última fecha (YYYY-MM-DD)
  for (let i = 0; i < convIds.length; i += 100) {
    const slice = convIds.slice(i, i + 100);
    const { data } = await sb
      .from("chat_messages")
      .select("conversation_id, created_at")
      .eq("empresa_id", empresaId)
      .eq("from_me", true)
      .in("conversation_id", slice)
      .gte("created_at", desde)
      .lte("created_at", hasta);
    for (const msg of (data ?? []) as Record<string, unknown>[]) {
      const contactId = convToContact.get(String(msg.conversation_id));
      if (!contactId) continue;
      const sig = contactToSig.get(contactId);
      if (!sig) continue;
      const fecha = String(msg.created_at ?? "").slice(0, 10);
      if (!fecha) continue;
      const prev = sigMaxFecha.get(sig);
      if (!prev || fecha > prev) sigMaxFecha.set(sig, fecha);
    }
  }

  for (const [sig, fecha] of sigMaxFecha) {
    for (const cid of sigToClientes.get(sig) ?? []) res.set(cid, { enviado: true, fecha });
  }
  return res;
}

/** Resumen + lista de clientes con deuda (total_adeudado > 0). */
export async function cargarCobranzas(
  sb: Sb,
  empresaId: string,
  hoyYmd: string
): Promise<{ resumen: CobranzasResumen; clientes: ClienteCobranza[] }> {
  const [clientesRows, facturasRows, suscInfo, catalogoTipos, promesaPorCliente] = await Promise.all([
    fetchAll(sb, "clientes", "id, empresa, nombre_contacto, tipo_servicio_cliente, created_at, estado, deleted_at, telefono", empresaId),
    fetchAll(sb, "facturas", "id, cliente_id, suscripcion_id, fecha, fecha_vencimiento, monto, saldo, estado", empresaId),
    cargarSuscripcionInfo(sb, empresaId),
    cargarCatalogoTipos(sb, empresaId),
    cargarPromesasPendientes(sb, empresaId),
  ]);

  // Último pago por cliente (pagos → factura → cliente).
  const facturaCliente = new Map<string, string>();
  for (const f of facturasRows) facturaCliente.set(String(f.id), String(f.cliente_id ?? ""));
  const pagosRows = await fetchAll(sb, "pagos", "factura_id, fecha_pago", empresaId);
  const ultimoPagoPorCliente = new Map<string, string>();
  for (const p of pagosRows) {
    const cid = facturaCliente.get(String(p.factura_id ?? ""));
    if (!cid) continue;
    const fp = ymd(p.fecha_pago as string);
    if (!fp) continue;
    const prev = ultimoPagoPorCliente.get(cid);
    if (!prev || fp > prev) ultimoPagoPorCliente.set(cid, fp);
  }

  const clienteInfo = new Map<string, Record<string, unknown>>();
  for (const c of clientesRows) clienteInfo.set(String(c.id), c);

  // Facturas agrupadas por cliente.
  const facturasPorCliente = new Map<string, Record<string, unknown>[]>();
  for (const f of facturasRows) {
    const cid = String(f.cliente_id ?? "");
    if (!cid) continue;
    const arr = facturasPorCliente.get(cid) ?? [];
    arr.push(f);
    facturasPorCliente.set(cid, arr);
  }

  const clientes: ClienteCobranza[] = [];
  const resumen: CobranzasResumen = {
    total_adeudado: 0,
    clientes_con_deuda: 0,
    cuotas_vencidas_total: 0,
    por_tramo: { por_vencer: 0, tramo_1: 0, tramo_2: 0, tramo_3: 0 },
  };

  for (const [cid, facts] of facturasPorCliente) {
    const c = clienteInfo.get(cid);
    if (!esClienteActivo(c)) continue; // Cobranzas: solo clientes activos (no inactivos/eliminados)
    const grupos = agruparPorServicio(facts, suscInfo, catalogoTipos, c?.tipo_servicio_cliente as string, hoyYmd);
    const servicios = grupos.map(aggServicio).filter((s) => s.total_adeudado > 0);
    if (servicios.length === 0) continue;
    const label =
      String(c?.empresa ?? "").trim() || String(c?.nombre_contacto ?? "").trim() || cid.slice(0, 8);
    clientes.push({
      cliente_id: cid,
      cliente_label: label,
      ultimo_pago: ultimoPagoPorCliente.get(cid) ?? null,
      promesa_fecha: promesaPorCliente.get(cid) ?? null,
      servicios,
      mensaje_mes_enviado: false,
      mensaje_mes_fecha: null,
    });
    const total = servicios.reduce((acc, s) => acc + s.total_adeudado, 0);
    const worst = peorTramo(servicios.map((s) => s.tramo));
    resumen.total_adeudado += total;
    resumen.clientes_con_deuda += 1;
    resumen.cuotas_vencidas_total += servicios.reduce((acc, s) => acc + s.cuotas_vencidas, 0);
    resumen.por_tramo[worst] += 1;
  }

  // ¿Se le mandó mensaje este mes? (cruce por teléfono → contacto → mensajes salientes).
  const telPorCliente = new Map<string, string>();
  for (const c of clientes) {
    const info = clienteInfo.get(c.cliente_id);
    const tel = info ? String(info.telefono ?? "").trim() : "";
    if (tel) telPorCliente.set(c.cliente_id, tel);
  }
  try {
    const msgMap = await cargarMensajeEsteMes(sb, empresaId, telPorCliente, hoyYmd.slice(0, 7));
    for (const c of clientes) {
      const m = msgMap.get(c.cliente_id);
      if (m) {
        c.mensaje_mes_enviado = m.enviado;
        c.mensaje_mes_fecha = m.fecha;
      }
    }
  } catch {
    // El indicador de mensaje NO debe tumbar la cobranza: si falla el cruce, queda "sin dato".
  }

  resumen.total_adeudado = Math.round(resumen.total_adeudado * 100) / 100;
  // Orden: peor tramo primero, luego mayor deuda total.
  const totalDe = (c: ClienteCobranza) => c.servicios.reduce((a, s) => a + s.total_adeudado, 0);
  const worstDe = (c: ClienteCobranza) => peorTramo(c.servicios.map((s) => s.tramo));
  clientes.sort((x, y) => PESO_TRAMO[worstDe(y)] - PESO_TRAMO[worstDe(x)] || totalDe(y) - totalDe(x));

  return { resumen, clientes };
}

/** Detalle de un cliente para el drawer. */
export async function cargarDetalleCliente(
  sb: Sb,
  empresaId: string,
  clienteId: string,
  hoyYmd: string
): Promise<DetalleCobranza | null> {
  const { data: cRows } = await sb
    .from("clientes")
    .select("id, empresa, nombre_contacto, tipo_servicio_cliente, created_at, estado, deleted_at, telefono")
    .eq("empresa_id", empresaId)
    .eq("id", clienteId)
    .limit(1);
  const c = (cRows ?? [])[0] as Record<string, unknown> | undefined;
  if (!c) return null;
  if (!esClienteActivo(c)) return null; // Cobranzas no muestra detalle de inactivos/eliminados

  const [suscInfo, catalogoTipos] = await Promise.all([
    cargarSuscripcionInfo(sb, empresaId),
    cargarCatalogoTipos(sb, empresaId),
  ]);

  const { data: fRows } = await sb
    .from("facturas")
    .select("id, numero_factura, suscripcion_id, fecha, fecha_vencimiento, monto, saldo, estado, tipo")
    .eq("empresa_id", empresaId)
    .eq("cliente_id", clienteId);
  const facturas = (fRows ?? []) as Record<string, unknown>[];

  const facturaNumero = new Map<string, string | null>();
  for (const f of facturas) facturaNumero.set(String(f.id), (f.numero_factura as string) ?? null);

  const facturaIds = facturas.map((f) => String(f.id));
  const pagos: PagoLite[] = [];
  for (let i = 0; i < facturaIds.length; i += 120) {
    const slice = facturaIds.slice(i, i + 120);
    if (slice.length === 0) break;
    const { data: pRows } = await sb
      .from("pagos")
      .select("factura_id, fecha_pago, monto, metodo_pago")
      .eq("empresa_id", empresaId)
      .in("factura_id", slice);
    for (const p of (pRows ?? []) as Record<string, unknown>[]) {
      pagos.push({
        factura_id: String(p.factura_id ?? ""),
        numero_factura: facturaNumero.get(String(p.factura_id ?? "")) ?? null,
        fecha_pago: ymd(p.fecha_pago as string) || null,
        monto: Number(p.monto) || 0,
        metodo_pago: (p.metodo_pago as string) ?? null,
      });
    }
  }
  pagos.sort((a, b) => (b.fecha_pago ?? "").localeCompare(a.fecha_pago ?? ""));

  const byVenc = (a: FacturaLite, b: FacturaLite) =>
    (a.fecha_vencimiento ?? "").localeCompare(b.fecha_vencimiento ?? "");

  // Deuda por servicio (suscripción) + bucket "General".
  const grupos = agruparPorServicio(facturas, suscInfo, catalogoTipos, c.tipo_servicio_cliente as string, hoyYmd);
  const servicios: ServicioDetalle[] = grupos
    .map((g) => {
      const agg = aggServicio(g);
      return {
        ...agg,
        facturas_vencidas: g.facturas.filter((f) => f.vencida).sort(byVenc),
        facturas_pendientes: g.facturas.filter((f) => !f.vencida).sort(byVenc),
      };
    })
    .filter((s) => s.total_adeudado > 0)
    .sort((a, b) => PESO_TRAMO[b.tramo] - PESO_TRAMO[a.tramo] || b.total_adeudado - a.total_adeudado);

  // Listas planas (todas las facturas-deuda) para la regla oldest-first del cliente.
  const vencidas: FacturaLite[] = servicios.flatMap((s) => s.facturas_vencidas).sort(byVenc);
  const pendientes: FacturaLite[] = servicios.flatMap((s) => s.facturas_pendientes).sort(byVenc);
  const totalDeuda = servicios.reduce((a, s) => a + s.total_adeudado, 0);
  const meses = new Set<string>();
  for (const s of servicios) for (const m of s.meses_adeudados) meses.add(m);

  const { data: promRows } = await sb
    .from("cobranza_promesas")
    .select("id, fecha_promesa, estado, creado_por_email, created_at")
    .eq("empresa_id", empresaId)
    .eq("cliente_id", clienteId);
  const promesas: PromesaPago[] = ((promRows ?? []) as Record<string, unknown>[])
    .map((r) => ({
      id: String(r.id ?? ""),
      fecha_promesa: r.fecha_promesa != null ? String(r.fecha_promesa).slice(0, 10) : null,
      estado: String(r.estado ?? "pendiente"),
      creado_por_email: r.creado_por_email != null ? String(r.creado_por_email) : null,
      created_at: r.created_at != null ? String(r.created_at) : null,
    }))
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const label =
    String(c.empresa ?? "").trim() || String(c.nombre_contacto ?? "").trim() || clienteId.slice(0, 8);

  const tipoResumen =
    servicios.length === 1 ? servicios[0]!.tipo : servicios.length > 1 ? `Varios (${servicios.length})` : "Sin clasificar";
  const montoResumen = servicios.reduce<number | null>((a, s) => (s.monto_mensual != null ? (a ?? 0) + s.monto_mensual : a), null);

  // ¿Mensaje saliente este mes? (mismo cruce que la lista, pero para este único cliente).
  let mensajeMes: { enviado: boolean; fecha: string | null } = { enviado: false, fecha: null };
  const telCliente = String(c.telefono ?? "").trim();
  if (telCliente) {
    try {
      const msgMap = await cargarMensajeEsteMes(sb, empresaId, new Map([[clienteId, telCliente]]), hoyYmd.slice(0, 7));
      mensajeMes = msgMap.get(clienteId) ?? mensajeMes;
    } catch {
      // sin dato si falla
    }
  }

  return {
    cliente: {
      cliente_id: clienteId,
      cliente_label: label,
      tipo: tipoResumen,
      plan: servicios.length === 1 ? servicios[0]!.plan : null,
      monto_mensual: montoResumen,
      alta: ymd(c.created_at as string) || null,
      mensaje_mes_enviado: mensajeMes.enviado,
      mensaje_mes_fecha: mensajeMes.fecha,
    },
    total_deuda: Math.round(totalDeuda * 100) / 100,
    cuotas_vencidas: vencidas.length,
    tramo: peorTramo(servicios.map((s) => s.tramo)),
    meses_adeudados: [...meses].sort(),
    facturas_pendientes: pendientes,
    facturas_vencidas: vencidas,
    pagos_recientes: pagos.slice(0, 10),
    promesas,
    servicios,
  };
}

// La regla oldest-first vive ahora en `@/lib/pagos/oldest-first` (centralizada en
// `registrarPago`). Se quitó la copia local para evitar lógica/mensajes duplicados.
