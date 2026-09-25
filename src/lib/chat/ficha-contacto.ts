import "server-only";
import { filterConversationIdsByOmnicanalScope } from "@/lib/chat/omnicanal-scope";
import { clienteDelContacto } from "@/lib/clientes/cliente-de-contacto";
import { nombreClienteDisplay } from "@/lib/clientes/display-name";
import { nombrePreferido } from "@/lib/format/nombres";
import { enrichProyectosRows } from "@/lib/proyectos/enrich-proyectos";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Ficha del contacto que se abre al costado del chat: quién es, con qué cliente y proyectos
 * se corresponde, cómo quedó tipificado y por qué manos pasó.
 *
 * Tres decisiones que conviene tener presentes antes de tocar esto:
 *
 * 1. **La autorización es por conversación, no por contacto.** Se entra con el chat abierto y
 *    se valida ese chat contra el alcance omnicanal. Después, la lista de conversaciones del
 *    contacto se vuelve a filtrar por el mismo alcance: sin eso, la ficha sería una puerta
 *    lateral para ver chats de otro equipo.
 * 2. **Los proyectos tienen permisos propios.** Se piden con las mismas reglas que el módulo
 *    Proyectos. Si el usuario no tiene acceso, la sección viaja en `null` (que la UI oculta),
 *    distinto de `[]` (tiene acceso y el cliente no tiene proyectos).
 * 3. **Resolver el cliente por teléfono es caro** (compara contra toda la cartera), así que
 *    solo se hace cuando el contacto no lo tiene guardado, y el resultado se persiste para
 *    que la segunda apertura no lo repita.
 */

export type FichaCliente = {
  id: string;
  nombre: string;
  ruc: string | null;
  email: string | null;
  telefono: string | null;
  direccion: string | null;
  ciudad: string | null;
  /** Cómo se llegó a este cliente: guardado en el contacto o deducido al vuelo. */
  via: "guardado" | "telefono" | "contacto" | "nombre";
  /** Nombre del contacto secundario que hizo de puente, si el match fue por ahí. */
  contacto?: string;
};

export type FichaProyecto = {
  id: string;
  nombre: string;
  tipo: string | null;
  estado: string | null;
  estado_color: string | null;
  estado_desde: string | null;
  es_final: boolean;
  /** Sacado de circulación. Se muestra igual, pero al final y apagado. */
  archivado: boolean;
  project_manager: string | null;
  responsable_tecnico: string | null;
  fecha_ingreso: string | null;
};

export type FichaConversacion = {
  id: string;
  canal: string | null;
  canal_tipo: string | null;
  cola: string | null;
  agente: string | null;
  estado: string;
  ultimo_mensaje_at: string | null;
  /** La que está abierta ahora mismo en el chat. */
  actual: boolean;
};

export type FichaTipificacion = {
  estado: string | null;
  subestado: string | null;
  comentario: string | null;
  fecha: string | null;
  por: string | null;
};

export type FichaEvento = {
  id: string;
  fecha: string;
  /** Familia del evento, para el ícono y el color en la UI. */
  tipo: "ingreso" | "asignado" | "tomado" | "transferido" | "cola" | "cerrado" | "sistema";
  titulo: string;
  detalle: string | null;
  conversation_id: string;
};

export type FichaContacto = {
  contacto: {
    id: string;
    nombre: string | null;
    telefono: string;
    creado_en: string | null;
  };
  cliente: FichaCliente | null;
  /** `null` = el usuario no tiene acceso al módulo Proyectos. */
  proyectos: FichaProyecto[] | null;
  ultima_tipificacion: FichaTipificacion | null;
  conversaciones: FichaConversacion[];
  linea_tiempo: FichaEvento[];
  /** Avisos para mostrar en la ficha (p. ej. historial incompleto por datos viejos). */
  notas: string[];
};

export type ResultadoFicha =
  | { ok: true; ficha: FichaContacto }
  | { ok: false; status: number; error: string };

/** Tope de conversaciones a traer: un contacto con años de historia no tiene que colgar la ficha. */
const MAX_CONVERSACIONES = 50;
/** Tope de eventos de la línea de tiempo. */
const MAX_EVENTOS = 200;

type Fila = Record<string, unknown>;

const txt = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

export async function construirFichaContacto(input: {
  supabase: AppSupabaseClient;
  catalogSr: AppSupabaseClient;
  empresaId: string;
  usuarioId: string;
  conversationId: string;
  /** Se reenvía a los permisos de Proyectos, que leen la sesión del request. */
  request: Request;
}): Promise<ResultadoFicha> {
  const { supabase, catalogSr, empresaId, usuarioId, conversationId, request } = input;

  // 1. La conversación desde la que se abrió, y su contacto.
  const { data: convRow, error: convErr } = await supabase
    .from("chat_conversations")
    .select("id, contact_id")
    .eq("empresa_id", empresaId)
    .eq("id", conversationId)
    .maybeSingle();
  if (convErr) return { ok: false, status: 500, error: convErr.message };
  const conv = convRow as { id: string; contact_id: string | null } | null;
  if (!conv) return { ok: false, status: 404, error: "Conversación no encontrada" };

  // 2. Puerta de entrada: ¿puede ver ESTE chat?
  const visibleActual = await filterConversationIdsByOmnicanalScope(
    supabase,
    catalogSr,
    empresaId,
    usuarioId,
    [conversationId]
  );
  if (!visibleActual.has(conversationId)) {
    return { ok: false, status: 403, error: "No autorizado para esta conversación" };
  }

  const contactId = txt(conv.contact_id);
  if (!contactId) return { ok: false, status: 404, error: "La conversación no tiene contacto" };

  // 3. El contacto.
  const { data: contactoRow } = await supabase
    .from("chat_contacts")
    .select("id, name, phone_number, cliente_id, created_at")
    .eq("empresa_id", empresaId)
    .eq("id", contactId)
    .maybeSingle();
  const contacto = contactoRow as {
    id: string;
    name: string | null;
    phone_number: string | null;
    cliente_id: string | null;
    created_at: string | null;
  } | null;
  if (!contacto) return { ok: false, status: 404, error: "Contacto no encontrado" };

  const notas: string[] = [];

  // 4 y 5. Cliente y proyectos, en paralelo con el resto del historial del contacto.
  const [clienteRes, historialRes] = await Promise.all([
    resolverCliente(supabase, empresaId, contacto),
    cargarHistorial(supabase, catalogSr, empresaId, usuarioId, contactId, conversationId),
  ]);

  const proyectosRes = await cargarProyectos(request, empresaId, clienteRes?.id ?? null);
  if (proyectosRes.error) {
    notas.push("No se pudieron cargar los proyectos de este cliente.");
  }

  if (historialRes.hayEventosViejos) {
    notas.push(
      "El detalle de quién transfirió y los cambios de cola se registra desde septiembre de 2026; los pasos anteriores pueden aparecer incompletos."
    );
  }

  return {
    ok: true,
    ficha: {
      contacto: {
        id: contacto.id,
        nombre: txt(contacto.name),
        telefono: String(contacto.phone_number ?? ""),
        creado_en: txt(contacto.created_at),
      },
      cliente: clienteRes,
      proyectos: proyectosRes.lista,
      ultima_tipificacion: historialRes.ultimaTipificacion,
      conversaciones: historialRes.conversaciones,
      linea_tiempo: historialRes.lineaTiempo,
      notas,
    },
  };
}

/**
 * Cliente del contacto. Si ya está guardado se lee directo; si no, se deduce por teléfono y se
 * guarda, para pagar el costo una sola vez.
 */
async function resolverCliente(
  supabase: AppSupabaseClient,
  empresaId: string,
  contacto: { id: string; name: string | null; phone_number: string | null; cliente_id: string | null }
): Promise<FichaCliente | null> {
  let clienteId = txt(contacto.cliente_id);
  let via: FichaCliente["via"] = "guardado";
  let contactoPuente: string | undefined;

  if (!clienteId) {
    const hallado = await clienteDelContacto(
      supabase,
      empresaId,
      contacto.phone_number,
      contacto.name
    ).catch(() => null);
    if (!hallado) return null;
    clienteId = hallado.cliente_id;
    via = hallado.via;
    contactoPuente = hallado.contacto;

    // Solo se persiste lo que el propio ERP considera seguro para vincular: el match por
    // nombre queda como sugerencia y no se escribe.
    if (hallado.via === "telefono" || hallado.via === "contacto") {
      await supabase
        .from("chat_contacts")
        .update({ cliente_id: clienteId })
        .eq("empresa_id", empresaId)
        .eq("id", contacto.id)
        .then(
          () => undefined,
          () => undefined
        );
    }
  }

  const { data } = await supabase
    .from("clientes")
    .select(
      "id, tipo_cliente, nombre, empresa, razon_social, nombre_contacto, ruc, email, telefono, direccion, ciudad"
    )
    .eq("empresa_id", empresaId)
    .eq("id", clienteId)
    .maybeSingle();
  const c = data as Fila | null;
  if (!c) return null;

  return {
    id: String(c.id),
    // El criterio vive en `display-name`: para una persona el cliente ES la persona, aunque
    // tenga cargada una empresa. Resolverlo a mano acá mostraba el nombre equivocado.
    nombre: nombreClienteDisplay(c),
    ruc: txt(c.ruc),
    email: txt(c.email),
    telefono: txt(c.telefono),
    direccion: txt(c.direccion),
    ciudad: txt(c.ciudad),
    via,
    ...(contactoPuente ? { contacto: contactoPuente } : {}),
  };
}

/**
 * Proyectos del cliente, con los permisos del módulo Proyectos. Devuelve `null` cuando el
 * usuario no tiene acceso: la ficha no puede ser un atajo para ver lo que el módulo esconde.
 */
async function cargarProyectos(
  request: Request,
  empresaId: string,
  clienteId: string | null
): Promise<{ lista: FichaProyecto[] | null; error: boolean }> {
  if (!clienteId) return { lista: null, error: false };

  const auth = await requireProyectosApiAccess(request).catch(() => null);
  if (!auth?.ok) return { lista: null, error: false };
  // El acceso se resolvió contra la empresa de la sesión; si no coincide, no se devuelve nada.
  if (auth.empresaId !== empresaId) return { lista: null, error: false };

  try {
    const sb = await getChatServiceClientForEmpresa(empresaId);
    // `proyectos` no tiene borrado lógico: lo que sale de circulación se marca `archivado`.
    // Se traen todos y los archivados quedan al final; filtrarlos escondería proyectos
    // que el cliente efectivamente tuvo.
    const { data, error } = await sb
      .from("proyectos")
      .select("*")
      .eq("empresa_id", empresaId)
      .eq("cliente_id", clienteId)
      .limit(100);
    // Un error acá NO puede devolver una lista vacía: se leería como "este cliente no tiene
    // proyectos", que es una mentira difícil de detectar.
    if (error) {
      console.error("[ficha-contacto] proyectos:", error.message);
      return { lista: null, error: true };
    }
    const filas = (data ?? []) as Fila[];
    if (filas.length === 0) return { lista: [], error: false };

    const ricos = await enrichProyectosRows(sb, empresaId, filas);
    const proyectos: FichaProyecto[] = ricos.map((p) => {
      const estado = p.proyecto_estado as
        | { nombre?: string; color?: string; es_estado_final?: boolean }
        | null
        | undefined;
      return {
        id: String((p as Fila).id ?? ""),
        nombre: txt((p as Fila).nombre) ?? "Sin nombre",
        archivado: Boolean((p as Fila).archivado),
        tipo: txt((p.proyecto_tipo as { nombre?: string } | null | undefined)?.nombre),
        estado: txt(estado?.nombre),
        estado_color: txt(estado?.color),
        estado_desde: txt((p as Fila).estado_actual_desde),
        es_final: Boolean(estado?.es_estado_final),
        project_manager: txt(
          (p.project_manager as { nombre?: string | null } | null | undefined)?.nombre
        ),
        responsable_tecnico: txt(
          (p.responsable_tecnico as { nombre?: string | null } | null | undefined)?.nombre
        ),
        fecha_ingreso: txt((p as Fila).fecha_ingreso) ?? txt((p as Fila).created_at),
      };
    });

    // En curso arriba, después los terminados y al fondo los archivados; dentro de cada
    // grupo, lo más nuevo primero.
    const peso = (p: FichaProyecto) => (p.archivado ? 2 : p.es_final ? 1 : 0);
    proyectos.sort((a, b) => {
      const d = peso(a) - peso(b);
      if (d !== 0) return d;
      return String(b.fecha_ingreso ?? "").localeCompare(String(a.fecha_ingreso ?? ""));
    });
    return { lista: proyectos, error: false };
  } catch (e) {
    // Un problema leyendo proyectos no puede tumbar la ficha entera, pero sí tiene que verse.
    console.error("[ficha-contacto] proyectos:", e instanceof Error ? e.message : String(e));
    return { lista: null, error: true };
  }
}

/** Conversaciones del contacto, su última tipificación y la línea de tiempo. */
async function cargarHistorial(
  supabase: AppSupabaseClient,
  catalogSr: AppSupabaseClient,
  empresaId: string,
  usuarioId: string,
  contactId: string,
  conversationIdActual: string
): Promise<{
  conversaciones: FichaConversacion[];
  ultimaTipificacion: FichaTipificacion | null;
  lineaTiempo: FichaEvento[];
  hayEventosViejos: boolean;
}> {
  const vacio = {
    conversaciones: [] as FichaConversacion[],
    ultimaTipificacion: null,
    lineaTiempo: [] as FichaEvento[],
    hayEventosViejos: false,
  };

  const { data: convsData } = await supabase
    .from("chat_conversations")
    .select(
      "id, status, queue_id, channel_id, assigned_agent_id, last_message_at, created_at, closed_at"
    )
    .eq("empresa_id", empresaId)
    .eq("contact_id", contactId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(MAX_CONVERSACIONES);
  const convs = (convsData ?? []) as Fila[];
  if (convs.length === 0) return vacio;

  // Segunda reja: el contacto puede tener chats de colas que este usuario no ve.
  const ids = convs.map((c) => String(c.id));
  const visibles = await filterConversationIdsByOmnicanalScope(
    supabase,
    catalogSr,
    empresaId,
    usuarioId,
    ids
  );
  const permitidas = convs.filter((c) => visibles.has(String(c.id)));
  if (permitidas.length === 0) return vacio;
  const idsPermitidos = permitidas.map((c) => String(c.id));

  const [canales, colas, agentes, cierres, eventos] = await Promise.all([
    catalogoPorId(supabase, empresaId, "chat_channels", "id, nombre, type", permitidas, "channel_id"),
    catalogoPorId(supabase, empresaId, "chat_queues", "id, nombre", permitidas, "queue_id"),
    cargarAgentes(supabase, catalogSr, empresaId, permitidas),
    supabase
      .from("chat_conversation_closures")
      .select(
        "id, conversation_id, closure_state_label, closure_substate_label, comment, closed_at, closed_by_usuario_id"
      )
      .eq("empresa_id", empresaId)
      .in("conversation_id", idsPermitidos)
      .order("closed_at", { ascending: false })
      .limit(MAX_EVENTOS)
      .then((r) => (r.data ?? []) as Fila[], () => [] as Fila[]),
    supabase
      .from("chat_routing_events")
      .select("id, conversation_id, queue_id, event_type, payload, created_at")
      .eq("empresa_id", empresaId)
      .in("conversation_id", idsPermitidos)
      .order("created_at", { ascending: false })
      .limit(MAX_EVENTOS)
      .then((r) => (r.data ?? []) as Fila[], () => [] as Fila[]),
  ]);

  const conversaciones: FichaConversacion[] = permitidas.map((c) => ({
    id: String(c.id),
    canal: txt(canales.get(String(c.channel_id ?? ""))?.nombre),
    canal_tipo: txt(canales.get(String(c.channel_id ?? ""))?.type),
    cola: txt(colas.get(String(c.queue_id ?? ""))?.nombre),
    agente: agentes.get(String(c.assigned_agent_id ?? "")) ?? null,
    estado: String(c.status ?? ""),
    ultimo_mensaje_at: txt(c.last_message_at),
    actual: String(c.id) === conversationIdActual,
  }));

  // Los nombres de usuario (quién cerró, quién transfirió) viven en el catálogo.
  const usuarioIds = new Set<string>();
  for (const f of cierres) {
    const u = txt(f.closed_by_usuario_id);
    if (u) usuarioIds.add(u);
  }
  for (const e of eventos) {
    const u = txt((e.payload as Fila | null)?.by_usuario_id);
    if (u) usuarioIds.add(u);
  }
  const usuarios = await nombresDeUsuarios(catalogSr, empresaId, [...usuarioIds]);

  const ultimoCierre = cierres[0] ?? null;
  const ultimaTipificacion: FichaTipificacion | null = ultimoCierre
    ? {
        estado: txt(ultimoCierre.closure_state_label),
        subestado: txt(ultimoCierre.closure_substate_label),
        comentario: txt(ultimoCierre.comment),
        fecha: txt(ultimoCierre.closed_at),
        por: usuarios.get(String(ultimoCierre.closed_by_usuario_id ?? "")) ?? null,
      }
    : null;

  const lineaTiempo = armarLineaTiempo({
    conversaciones: permitidas,
    eventos,
    cierres,
    colas,
    agentes,
    usuarios,
  });

  // Si hay eventos de asignación sin actor, el historial viejo va a verse a medias.
  const hayEventosViejos = eventos.some(
    (e) =>
      String(e.event_type ?? "") === "supervisor_assigned" &&
      !txt((e.payload as Fila | null)?.by_usuario_id)
  );

  return { conversaciones, ultimaTipificacion, lineaTiempo, hayEventosViejos };
}

/** Une eventos de ruteo, cierres y aperturas en una sola lista ordenada de más nuevo a más viejo. */
function armarLineaTiempo(input: {
  conversaciones: Fila[];
  eventos: Fila[];
  cierres: Fila[];
  colas: Map<string, Fila>;
  agentes: Map<string, string>;
  usuarios: Map<string, string>;
}): FichaEvento[] {
  const { conversaciones, eventos, cierres, colas, agentes, usuarios } = input;
  const out: FichaEvento[] = [];

  const nombreCola = (id: unknown) => txt(colas.get(String(id ?? ""))?.nombre);
  const nombreAgente = (id: unknown) => agentes.get(String(id ?? "")) ?? null;
  const nombreUsuario = (id: unknown) => usuarios.get(String(id ?? "")) ?? null;

  for (const c of conversaciones) {
    const fecha = txt(c.created_at);
    if (!fecha) continue;
    out.push({
      id: `ingreso:${String(c.id)}`,
      fecha,
      tipo: "ingreso",
      titulo: "Ingresó la conversación",
      detalle: nombreCola(c.queue_id) ? `Cola ${nombreCola(c.queue_id)}` : null,
      conversation_id: String(c.id),
    });
  }

  for (const e of eventos) {
    const fecha = txt(e.created_at);
    if (!fecha) continue;
    const p = (e.payload ?? {}) as Fila;
    const tipoEvento = String(e.event_type ?? "");
    const porQuien = nombreUsuario(p.by_usuario_id);
    const hacia = nombreAgente(p.to_agent_id);
    const desde = nombreAgente(p.from_agent_id);
    const base = { id: `ev:${String(e.id)}`, fecha, conversation_id: String(e.conversation_id) };

    if (tipoEvento === "supervisor_assigned") {
      // `source` distingue el auto-servicio ("lo tomé yo") de la asignación a un tercero.
      const propio = String(p.source ?? "") === "assignConversationToMe";
      if (propio) {
        out.push({
          ...base,
          tipo: "tomado",
          titulo: `Lo tomó ${porQuien ?? hacia ?? "un agente"}`,
          detalle: nombreCola(e.queue_id) ? `Cola ${nombreCola(e.queue_id)}` : null,
        });
      } else {
        out.push({
          ...base,
          tipo: "transferido",
          titulo: `Transferido a ${hacia ?? "otro agente"}`,
          detalle:
            [porQuien ? `por ${porQuien}` : null, desde ? `desde ${desde}` : null]
              .filter(Boolean)
              .join(" · ") || null,
        });
      }
      continue;
    }

    if (tipoEvento === "queue_changed") {
      const de = nombreCola(p.from_queue_id);
      const a = nombreCola(p.to_queue_id) ?? nombreCola(e.queue_id);
      out.push({
        ...base,
        tipo: "cola",
        titulo: a ? `Pasó a la cola ${a}` : "Cambió de cola",
        detalle:
          [de ? `desde ${de}` : null, porQuien ? `por ${porQuien}` : null]
            .filter(Boolean)
            .join(" · ") || null,
      });
      continue;
    }

    if (tipoEvento === "assigned_auto" || tipoEvento === "same_advisor_route") {
      out.push({
        ...base,
        tipo: "asignado",
        titulo: `Asignado a ${hacia ?? "un agente"}`,
        detalle:
          tipoEvento === "same_advisor_route"
            ? "Automático · mismo asesor de siempre"
            : "Automático por cola",
      });
      continue;
    }

    // El resto (sin cola, sin agente elegible, reasignaciones por demora) es ruido para el
    // asesor pero oro cuando hay que explicar por qué un chat quedó sin atender.
    const leyendas: Record<string, string> = {
      no_queue: "No había cola para este canal",
      no_eligible_agent: "Ningún agente disponible en la cola",
      manual_queue_only: "Cola de toma manual: quedó esperando",
      reassigned_initial_timeout: "Reasignado por demora en responder",
      reassign_skipped_no_alternate: "Sin agente alternativo para reasignar",
      reassign_skipped_max_iterations: "Se alcanzó el máximo de reasignaciones",
    };
    const leyenda = leyendas[tipoEvento];
    if (leyenda) {
      out.push({ ...base, tipo: "sistema", titulo: leyenda, detalle: nombreCola(e.queue_id) });
    }
  }

  for (const c of cierres) {
    const fecha = txt(c.closed_at);
    if (!fecha) continue;
    const estado = txt(c.closure_state_label);
    const sub = txt(c.closure_substate_label);
    const por = nombreUsuario(c.closed_by_usuario_id);
    out.push({
      id: `cierre:${String(c.id)}`,
      fecha,
      tipo: "cerrado",
      titulo: por ? `Finalizado por ${por}` : "Finalizado",
      detalle: [estado, sub && sub !== "—" ? sub : null].filter(Boolean).join(" · ") || null,
      conversation_id: String(c.conversation_id),
    });
  }

  out.sort((a, b) => b.fecha.localeCompare(a.fecha));
  return out.slice(0, MAX_EVENTOS);
}

/** Lee un catálogo chico (canales, colas) solo para los ids que aparecen en las filas. */
async function catalogoPorId(
  supabase: AppSupabaseClient,
  empresaId: string,
  tabla: string,
  columnas: string,
  filas: Fila[],
  campo: string
): Promise<Map<string, Fila>> {
  const ids = [...new Set(filas.map((f) => txt(f[campo])).filter((x): x is string => Boolean(x)))];
  if (ids.length === 0) return new Map();
  const { data } = await supabase
    .from(tabla)
    .select(columnas)
    .eq("empresa_id", empresaId)
    .in("id", ids);
  // `select` con columnas dinámicas pierde el tipado de PostgREST; el shape lo garantiza quien llama.
  return new Map(((data ?? []) as unknown as Fila[]).map((r) => [String(r.id), r]));
}

/** `chat_agents.id` → nombre del usuario detrás del agente. */
async function cargarAgentes(
  supabase: AppSupabaseClient,
  catalogSr: AppSupabaseClient,
  empresaId: string,
  filas: Fila[]
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(filas.map((f) => txt(f.assigned_agent_id)).filter((x): x is string => Boolean(x))),
  ];
  if (ids.length === 0) return new Map();
  const { data } = await supabase
    .from("chat_agents")
    .select("id, usuario_id")
    .eq("empresa_id", empresaId)
    .in("id", ids);
  const agentes = (data ?? []) as Fila[];
  const usuarios = await nombresDeUsuarios(
    catalogSr,
    empresaId,
    agentes.map((a) => txt(a.usuario_id)).filter((x): x is string => Boolean(x))
  );
  return new Map(
    agentes
      .map((a) => [String(a.id), usuarios.get(String(a.usuario_id ?? "")) ?? null] as const)
      .filter((p): p is readonly [string, string] => Boolean(p[1]))
  );
}

async function nombresDeUsuarios(
  catalogSr: AppSupabaseClient,
  empresaId: string,
  ids: string[]
): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (unicos.length === 0) return new Map();
  const { data } = await catalogSr
    .from("usuarios")
    .select("id, nombre, nombre_chat")
    .eq("empresa_id", empresaId)
    .in("id", unicos);
  return new Map(
    ((data ?? []) as Fila[])
      .map((u) => [String(u.id), nombrePreferido(u as { nombre?: string; nombre_chat?: string })] as const)
      .filter((p): p is readonly [string, string] => Boolean(p[1]))
  );
}
