"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw, Search, X, ChevronRight, ExternalLink } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type TramoKey = "por_vencer" | "tramo_1" | "tramo_2" | "tramo_3";

type ServicioCobranza = {
  suscripcion_id: string | null;
  tipo: string;
  plan: string | null;
  monto_mensual: number | null;
  total_adeudado: number;
  cuotas_vencidas: number;
  meses_adeudados: string[];
  tramo: TramoKey;
  proximo_vencimiento: string | null;
};

type ClienteCobranza = {
  cliente_id: string;
  cliente_label: string;
  ultimo_pago: string | null;
  promesa_fecha: string | null;
  servicios: ServicioCobranza[];
  mensaje_mes_enviado?: boolean;
  mensaje_mes_fecha?: string | null;
};

type PromesaPago = {
  id: string;
  fecha_promesa: string | null;
  estado: string;
  creado_por_email: string | null;
  created_at: string | null;
};

type Resumen = {
  total_adeudado: number;
  clientes_con_deuda: number;
  cuotas_vencidas_total: number;
  por_tramo: { por_vencer: number; tramo_1: number; tramo_2: number; tramo_3: number };
};

type ListaPayload = { hoy: string; puede_registrar?: boolean; resumen: Resumen; clientes: ClienteCobranza[] };

type FacturaLite = {
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
type PagoLite = { numero_factura: string | null; fecha_pago: string | null; monto: number; metodo_pago: string | null };
type ServicioDetalle = ServicioCobranza & {
  facturas_vencidas: FacturaLite[];
  facturas_pendientes: FacturaLite[];
};
type DetallePayload = {
  puede_registrar?: boolean;
  cliente: { cliente_id: string; cliente_label: string; tipo: string; plan: string | null; monto_mensual: number | null; alta: string | null; mensaje_mes_enviado?: boolean; mensaje_mes_fecha?: string | null };
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

const TRAMO_LABEL: Record<TramoKey, string> = {
  por_vencer: "Por vencer",
  tramo_1: "Tramo 1",
  tramo_2: "Tramo 2",
  tramo_3: "Tramo 3",
};
const TRAMO_CLASS: Record<TramoKey, string> = {
  por_vencer: "border-sky-200 bg-sky-50 text-sky-700",
  tramo_1: "border-amber-200 bg-amber-50 text-amber-700",
  tramo_2: "border-orange-200 bg-orange-50 text-orange-700",
  tramo_3: "border-rose-200 bg-rose-50 text-rose-700",
};
const MES_LABEL = ["", "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const TRAMO_PESO: Record<TramoKey, number> = { por_vencer: 0, tramo_1: 1, tramo_2: 2, tramo_3: 3 };

function peorTramoUI(servs: { tramo: TramoKey }[]): TramoKey {
  let w: TramoKey = "por_vencer";
  for (const s of servs) if (TRAMO_PESO[s.tramo] > TRAMO_PESO[w]) w = s.tramo;
  return w;
}

/** Fila de la tabla = cliente con sus servicios visibles (según el filtro de tipo) ya agregados. */
type Row = {
  c: ClienteCobranza;
  servicios: ServicioCobranza[];
  tipo: string;
  total_adeudado: number;
  cuotas_vencidas: number;
  tramo: TramoKey;
  monto_mensual: number | null;
  proximo_vencimiento: string | null;
};

function makeRow(c: ClienteCobranza, servs: ServicioCobranza[], tipoFiltro: string): Row {
  const total = servs.reduce((a, s) => a + s.total_adeudado, 0);
  const cuotas = servs.reduce((a, s) => a + s.cuotas_vencidas, 0);
  const monto = servs.reduce<number | null>((a, s) => (s.monto_mensual != null ? (a ?? 0) + s.monto_mensual : a), null);
  const proximos = servs.map((s) => s.proximo_vencimiento).filter((x): x is string => !!x).sort();
  const tipo = servs.length === 1 ? servs[0]!.tipo : tipoFiltro !== "__all__" ? tipoFiltro : `Varios (${servs.length})`;
  return {
    c,
    servicios: servs,
    tipo,
    total_adeudado: total,
    cuotas_vencidas: cuotas,
    tramo: peorTramoUI(servs),
    monto_mensual: monto,
    proximo_vencimiento: proximos[0] ?? null,
  };
}

type SortKey = "cliente" | "tipo" | "monto" | "total" | "cuotas" | "tramo" | "ultimo" | "prox" | "promesa" | "mensaje";

/** Columnas de la tabla; `key=null` = no ordenable. `kind` define el orden por defecto al clickear. */
const COLUMNAS: { h: string; right: boolean; key: SortKey | null; kind: "str" | "num" | "date" | null }[] = [
  { h: "Cliente", right: false, key: "cliente", kind: "str" },
  { h: "Tipo", right: false, key: "tipo", kind: "str" },
  { h: "Monto mensual", right: true, key: "monto", kind: "num" },
  { h: "Total adeudado", right: true, key: "total", kind: "num" },
  { h: "Cuotas venc.", right: true, key: "cuotas", kind: "num" },
  { h: "Tramo", right: false, key: "tramo", kind: "num" },
  { h: "Mensaje del mes", right: false, key: "mensaje", kind: "date" },
  { h: "Último pago", right: false, key: "ultimo", kind: "date" },
  { h: "Próx. venc.", right: false, key: "prox", kind: "date" },
  { h: "Promesa de pago", right: false, key: "promesa", kind: "date" },
  { h: "Acción", right: true, key: null, kind: null },
];

/** Valor comparable de una fila para una columna. `null` = va al final siempre. */
function sortValue(r: Row, key: SortKey): string | number | null {
  switch (key) {
    case "cliente":
      return (r.c.cliente_label ?? "").toLowerCase();
    case "tipo":
      return (r.tipo ?? "").toLowerCase();
    case "monto":
      return r.monto_mensual;
    case "total":
      return r.total_adeudado;
    case "cuotas":
      return r.cuotas_vencidas;
    case "tramo":
      return TRAMO_PESO[r.tramo];
    case "ultimo":
      return r.c.ultimo_pago ? r.c.ultimo_pago.slice(0, 10) : null;
    case "prox":
      return r.proximo_vencimiento ? r.proximo_vencimiento.slice(0, 10) : null;
    case "promesa":
      return r.c.promesa_fecha ? r.c.promesa_fecha.slice(0, 10) : null;
    case "mensaje":
      return r.c.mensaje_mes_enviado && r.c.mensaje_mes_fecha ? r.c.mensaje_mes_fecha.slice(0, 10) : null;
  }
}

/** Badge "mensaje del mes": verde con fecha si se envió, gris "No" si no. */
function MensajeMesBadge({ enviado, fecha }: { enviado?: boolean; fecha?: string | null }) {
  if (enviado && fecha) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        {fmtDate(fecha)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
      No
    </span>
  );
}

function ordenarRows(rows: Row[], sort: { key: SortKey; dir: "asc" | "desc" } | null): Row[] {
  if (!sort) return rows;
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    // Nulos/vacíos siempre al final, sin importar la dirección.
    const aNull = va == null || va === "";
    const bNull = vb == null || vb === "";
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * factor;
    return String(va).localeCompare(String(vb), "es") * factor;
  });
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return `₲ ${new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(n)}`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
function fmtMes(ym: string): string {
  const [y, m] = ym.split("-");
  const mi = Number(m);
  return `${MES_LABEL[mi] ?? m} ${y?.slice(2) ?? ""}`;
}

function TramoBadge({ tramo }: { tramo: TramoKey }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${TRAMO_CLASS[tramo]}`}>
      {TRAMO_LABEL[tramo]}
    </span>
  );
}

function Kpi({
  label,
  value,
  accent,
  onClick,
  active,
}: {
  label: string;
  value: string | number;
  accent?: "featured" | "danger" | "warning";
  onClick?: () => void;
  active?: boolean;
}) {
  const valueCls =
    accent === "featured" ? "text-[#3F8E91]" : accent === "danger" ? "text-rose-700" : accent === "warning" ? "text-amber-700" : "text-slate-900";
  const clickable = typeof onClick === "function";
  return (
    <div
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick!(); } } : undefined}
      className={`rounded-2xl border bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${
        clickable ? "cursor-pointer transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/30" : ""
      } ${active ? "border-[#4FAEB2] ring-2 ring-[#4FAEB2]/30" : "border-slate-200"}`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
        {clickable ? <span className="ml-1 text-[#4FAEB2]">{active ? "· filtrando" : "· filtrar"}</span> : null}
      </p>
      <p className={`mt-1.5 text-xl font-semibold tabular-nums tracking-tight sm:text-2xl ${valueCls}`}>{value}</p>
    </div>
  );
}

export default function CobranzasClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ListaPayload | null>(null);
  const [query, setQuery] = useState("");
  const [tramoFiltro, setTramoFiltro] = useState<TramoKey | "todos">("todos");
  const [tipoFiltro, setTipoFiltro] = useState<string>("__all__");
  const [soloPromesaHoy, setSoloPromesaHoy] = useState(false);
  // Orden de la tabla por columna (click en el encabezado; segundo click invierte).
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);

  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<DetallePayload | null>(null);
  const [detalleLoading, setDetalleLoading] = useState(false);

  const [puedeRegistrar, setPuedeRegistrar] = useState(false);
  const [pagoFactura, setPagoFactura] = useState<FacturaLite | null>(null);
  const [pagoBusy, setPagoBusy] = useState(false);
  const [promesaOpen, setPromesaOpen] = useState(false);
  const [promesaBusy, setPromesaBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithSupabaseSession("/api/cobranzas/clientes", { cache: "no-store" });
      const json = (await res.json()) as { success?: boolean; data?: ListaPayload; error?: string };
      if (!res.ok || json.success !== true || !json.data) throw new Error(json.error ?? `Error ${res.status}`);
      setData(json.data);
      setPuedeRegistrar(json.data.puede_registrar === true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetalle = useCallback(async (id: string) => {
    setDetalleId(id);
    setDetalle(null);
    setDetalleLoading(true);
    try {
      const res = await fetchWithSupabaseSession(`/api/cobranzas/clientes/${encodeURIComponent(id)}`, { cache: "no-store" });
      const json = (await res.json()) as { success?: boolean; data?: DetallePayload; error?: string };
      if (!res.ok || json.success !== true || !json.data) throw new Error(json.error ?? `Error ${res.status}`);
      setDetalle(json.data);
    } catch {
      setDetalle(null);
    } finally {
      setDetalleLoading(false);
    }
  }, []);

  /** Cuota más vieja pendiente del cliente abierto (oldest-first): venc → emisión → número. */
  const oldestPayable = useMemo(() => {
    if (!detalle) return null;
    const all = [...detalle.facturas_vencidas, ...detalle.facturas_pendientes];
    if (all.length === 0) return null;
    const numInt = (n: string | null | undefined) => {
      const m = String(n ?? "").replace(/\D/g, "");
      return m ? parseInt(m, 10) : Number.MAX_SAFE_INTEGER;
    };
    return [...all].sort((a, b) => {
      const va = a.fecha_vencimiento ?? "";
      const vb = b.fecha_vencimiento ?? "";
      if (va !== vb) return va < vb ? -1 : 1;
      const ea = a.fecha ?? "";
      const eb = b.fecha ?? "";
      if (ea !== eb) return ea < eb ? -1 : 1;
      return numInt(a.numero_factura) - numInt(b.numero_factura);
    })[0];
  }, [detalle]);

  // Cobro por transferencia → NO confirma: crea un cobro PENDIENTE en Conciliación
  // bancaria (multipart, con comprobante). El saldo baja recién al aprobarlo un admin.
  const registrarPagoCobranza = useCallback(
    async (input: {
      factura_id: string;
      monto: number;
      fecha_pago: string;
      banco_origen: string;
      titular: string;
      numero_operacion: string;
      file: File | null;
    }) => {
      const idem =
        globalThis.crypto?.randomUUID?.() ??
        "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
      const fd = new FormData();
      fd.set("factura_id", input.factura_id);
      fd.set("monto", String(input.monto));
      fd.set("fecha", input.fecha_pago);
      fd.set("banco_origen", input.banco_origen);
      fd.set("titular", input.titular);
      fd.set("numero_operacion", input.numero_operacion);
      fd.set("idempotency_key", idem);
      if (input.file) fd.set("file", input.file, input.file.name);
      const res = await fetchWithSupabaseSession("/api/cobranzas/conciliacion", { method: "POST", body: fd });
      const json = (await res.json()) as { success?: boolean; error?: string; data?: { warning?: string } };
      if (!res.ok || json.success !== true) throw new Error(json.error ?? `Error ${res.status}`);
      setPagoFactura(null);
      showToast(json.data?.warning ?? "Cobro enviado a aprobación en Conciliación bancaria.");
      if (detalleId) await openDetalle(detalleId);
      await load();
    },
    [detalleId, openDetalle, load, showToast]
  );

  /** Tipos de SERVICIO presentes (para el selector). */
  const tiposDisponibles = useMemo(() => {
    const set = new Set<string>();
    for (const c of data?.clientes ?? []) for (const s of c.servicios) if (s.tipo) set.add(s.tipo);
    const orden = (t: string) => (t === "Contable" ? 0 : t === "SaaS" ? 1 : t === "General" ? 9 : 2);
    return [...set].sort((a, b) => orden(a) - orden(b) || a.localeCompare(b));
  }, [data]);

  /** Filas (cliente con servicios visibles según tipo) + búsqueda. Base de KPIs y chips. */
  const baseRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: Row[] = [];
    for (const c of data?.clientes ?? []) {
      const servs = tipoFiltro === "__all__" ? c.servicios : c.servicios.filter((s) => s.tipo === tipoFiltro);
      if (servs.length === 0) continue;
      if (q) {
        const hay =
          c.cliente_label.toLowerCase().includes(q) ||
          servs.some((s) => (s.plan ?? "").toLowerCase().includes(q) || s.tipo.toLowerCase().includes(q));
        if (!hay) continue;
      }
      out.push(makeRow(c, servs, tipoFiltro));
    }
    return out;
  }, [data, query, tipoFiltro]);

  /** + filtro de tramo: alimenta la tabla y los KPIs. */
  const registrarPromesa = useCallback(
    async (fecha: string) => {
      if (!detalleId) return;
      setPromesaBusy(true);
      try {
        const res = await fetchWithSupabaseSession("/api/cobranzas/promesa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cliente_id: detalleId, fecha_promesa: fecha }),
        });
        const json = (await res.json()) as { success?: boolean; error?: string };
        if (!res.ok || json.success !== true) throw new Error(json.error ?? `Error ${res.status}`);
        setPromesaOpen(false);
        showToast("Promesa de pago registrada.");
        await openDetalle(detalleId);
        await load();
      } catch (e) {
        showToast(e instanceof Error ? e.message : "No se pudo registrar la promesa");
      } finally {
        setPromesaBusy(false);
      }
    },
    [detalleId, openDetalle, load, showToast]
  );

  const rows = useMemo(
    () =>
      baseRows.filter((r) => {
        if (tramoFiltro !== "todos" && r.tramo !== tramoFiltro) return false;
        if (soloPromesaHoy && !(data?.hoy && r.c.promesa_fecha === data.hoy)) return false;
        return true;
      }),
    [baseRows, tramoFiltro, soloPromesaHoy, data]
  );

  /** Lo que muestra la tabla: filas filtradas + orden por la columna elegida. */
  const sortedRows = useMemo(() => ordenarRows(rows, sort), [rows, sort]);

  /** Click en un encabezado: si es otra columna, la ordena (números/fechas desc, texto asc);
   *  si es la misma, invierte la dirección. */
  const toggleSort = useCallback((key: SortKey, kind: "str" | "num" | "date" | null) => {
    setSort((prev) => {
      if (prev?.key === key) return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      const dirInicial: "asc" | "desc" = kind === "str" ? "asc" : "desc";
      return { key, dir: dirInicial };
    });
  }, []);

  /** Conteo estable de promesas para hoy (tipo+búsqueda, sin tramo ni el toggle). */
  const promesasHoyCount = useMemo(() => {
    const hoy = data?.hoy ?? "";
    if (!hoy) return 0;
    return baseRows.filter((r) => r.c.promesa_fecha === hoy).length;
  }, [baseRows, data]);

  /** Conteo por tramo dentro de tipo+búsqueda (los chips reflejan el tipo elegido). */
  const tramoCounts = useMemo(() => {
    const acc = { todos: baseRows.length, por_vencer: 0, tramo_1: 0, tramo_2: 0, tramo_3: 0 } as Record<string, number>;
    for (const r of baseRows) acc[r.tramo] = (acc[r.tramo] ?? 0) + 1;
    return acc;
  }, [baseRows]);

  /** KPIs recalculados sobre lo filtrado (tipo + búsqueda + tramo + promesa). */
  const kpis = useMemo(() => {
    const porTramo = { por_vencer: 0, tramo_1: 0, tramo_2: 0, tramo_3: 0 } as Record<string, number>;
    let totalAdeudado = 0;
    let cuotasVenc = 0;
    for (const r of rows) {
      totalAdeudado += r.total_adeudado;
      cuotasVenc += r.cuotas_vencidas;
      porTramo[r.tramo] = (porTramo[r.tramo] ?? 0) + 1;
    }
    return {
      total_adeudado: Math.round(totalAdeudado),
      clientes_con_deuda: rows.length,
      cuotas_vencidas: cuotasVenc,
      por_tramo: porTramo,
    };
  }, [rows]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-20 text-sm text-slate-500">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#4FAEB2]" />
        Cargando seguimiento de cobranzas…
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:border-[#4FAEB2]/60"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Reintentar
        </button>
      </div>
    );
  }

  const tramoChips: { key: TramoKey | "todos"; label: string; count: number }[] = [
    { key: "todos", label: "Todos", count: tramoCounts.todos },
    { key: "tramo_3", label: "Tramo 3", count: tramoCounts.tramo_3 },
    { key: "tramo_2", label: "Tramo 2", count: tramoCounts.tramo_2 },
    { key: "tramo_1", label: "Tramo 1", count: tramoCounts.tramo_1 },
    { key: "por_vencer", label: "Por vencer", count: tramoCounts.por_vencer },
  ];

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#4FAEB2] shadow-[0_0_0_3px_rgba(79,174,178,0.18)]" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Operativo</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Seguimiento Cobranzas</h1>
          <p className="mt-1 text-sm text-slate-500">Clientes con deuda y tramos de mora{data?.hoy ? ` · al ${fmtDate(data.hoy)}` : ""}.</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:border-[#4FAEB2]/60 hover:text-[#3F8E91]"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Actualizar
        </button>
      </div>

      {/* KPIs (reaccionan a tipo + tramo + búsqueda) */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Total adeudado" value={fmtMoney(kpis.total_adeudado)} accent="danger" />
        <Kpi label="Clientes con deuda" value={kpis.clientes_con_deuda} accent="featured" />
        <Kpi label="Cuotas vencidas" value={kpis.cuotas_vencidas} />
        <Kpi
          label="Promesa de pago hoy"
          value={promesasHoyCount}
          accent="featured"
          onClick={() => setSoloPromesaHoy((v) => !v)}
          active={soloPromesaHoy}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi label="Por vencer" value={kpis.por_tramo.por_vencer} />
        <Kpi label="Tramo 1" value={kpis.por_tramo.tramo_1} />
        <Kpi label="Tramo 2" value={kpis.por_tramo.tramo_2} accent="warning" />
        <Kpi label="Tramo 3" value={kpis.por_tramo.tramo_3} accent="danger" />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {tramoChips.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTramoFiltro(t.key)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
                tramoFiltro === t.key ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#3F8E91]" : "border-slate-200 bg-white text-slate-600 hover:border-[#4FAEB2]/60"
              }`}
            >
              {t.label}
              <span className="tabular-nums text-slate-400">({t.count})</span>
            </button>
          ))}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {tiposDisponibles.length > 0 ? (
            <select
              value={tipoFiltro}
              onChange={(e) => setTipoFiltro(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
              aria-label="Filtrar por tipo de cliente"
            >
              <option value="__all__">Todos los tipos</option>
              {tiposDisponibles.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          ) : null}
          <div className="relative w-full sm:w-64">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar cliente, plan o tipo…"
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-9 text-sm text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
            />
            {query ? (
              <button type="button" onClick={() => setQuery("")} aria-label="Limpiar" className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Tabla */}
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-12 text-center text-sm text-slate-600">
          No hay clientes con deuda para este filtro.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-left text-sm">
              <thead className="bg-slate-50/80">
                <tr>
                  {COLUMNAS.map((col) => {
                    const active = col.key != null && sort?.key === col.key;
                    return (
                      <th
                        key={col.h}
                        className={`px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] whitespace-nowrap ${
                          col.right ? "text-right" : "text-left"
                        } ${active ? "text-[#3F8E91]" : "text-slate-500"}`}
                      >
                        {col.key != null ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(col.key!, col.kind)}
                            className="inline-flex items-center gap-1 uppercase tracking-[0.08em] transition-colors hover:text-[#3F8E91]"
                            title="Ordenar por esta columna"
                          >
                            {col.h}
                            <span className={`text-[9px] leading-none ${active ? "opacity-100" : "opacity-25"}`}>
                              {active ? (sort!.dir === "asc" ? "▲" : "▼") : "↕"}
                            </span>
                          </button>
                        ) : (
                          col.h
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedRows.map((r) => (
                  <tr key={r.c.cliente_id} className="align-middle transition-colors hover:bg-[#4FAEB2]/[0.04]">
                    <td className="px-3 py-3 text-sm font-medium text-slate-800">
                      <span className="block max-w-[220px] truncate" title={r.c.cliente_label}>{r.c.cliente_label}</span>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600 whitespace-nowrap">{r.tipo}</td>
                    <td className="px-3 py-3 text-right text-xs tabular-nums text-slate-700 whitespace-nowrap">{fmtMoney(r.monto_mensual)}</td>
                    <td className="px-3 py-3 text-right text-sm font-semibold tabular-nums text-rose-700 whitespace-nowrap">{fmtMoney(r.total_adeudado)}</td>
                    <td className="px-3 py-3 text-right text-sm tabular-nums text-slate-800">{r.cuotas_vencidas}</td>
                    <td className="px-3 py-3 whitespace-nowrap"><TramoBadge tramo={r.tramo} /></td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <MensajeMesBadge enviado={r.c.mensaje_mes_enviado} fecha={r.c.mensaje_mes_fecha} />
                    </td>
                    <td className="px-3 py-3 text-xs tabular-nums text-slate-600 whitespace-nowrap">{fmtDate(r.c.ultimo_pago)}</td>
                    <td className="px-3 py-3 text-xs tabular-nums text-slate-600 whitespace-nowrap">{fmtDate(r.proximo_vencimiento)}</td>
                    <td className="px-3 py-3 text-xs tabular-nums whitespace-nowrap">
                      {r.c.promesa_fecha ? (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                            data?.hoy && r.c.promesa_fecha === data.hoy
                              ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#3F8E91]"
                              : "border-slate-200 bg-slate-50 text-slate-600"
                          }`}
                        >
                          {fmtDate(r.c.promesa_fecha)}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => void openDetalle(r.c.cliente_id)}
                        className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-[#4FAEB2]/60 hover:text-[#3F8E91]"
                      >
                        Ver detalle <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Drawer detalle */}
      {detalleId ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={() => setDetalleId(null)}>
          <div
            className="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">Detalle de cobranza</h2>
              <button type="button" onClick={() => setDetalleId(null)} aria-label="Cerrar" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            {detalleLoading ? (
              <p className="mt-6 text-sm text-slate-500">Cargando…</p>
            ) : !detalle ? (
              <p className="mt-6 text-sm text-rose-600">No se pudo cargar el detalle.</p>
            ) : (
              <div className="mt-4 space-y-5">
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <Link
                    href={`/gestion-clientes?cliente=${encodeURIComponent(detalle.cliente.cliente_id)}`}
                    className="group inline-flex items-center gap-1.5 text-base font-semibold text-slate-900 hover:text-[#3F8E91] hover:underline"
                    title="Abrir en Gestión de clientes"
                  >
                    {detalle.cliente.cliente_label}
                    <ExternalLink className="h-3.5 w-3.5 text-slate-400 transition-colors group-hover:text-[#3F8E91]" />
                  </Link>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
                    <span>Tipo: <b className="text-slate-800">{detalle.cliente.tipo}</b></span>
                    <span>Plan: <b className="text-slate-800">{detalle.cliente.plan ?? "—"}</b></span>
                    <span>Monto mensual: <b className="text-slate-800">{fmtMoney(detalle.cliente.monto_mensual)}</b></span>
                    <span>Alta: <b className="text-slate-800">{fmtDate(detalle.cliente.alta)}</b></span>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <TramoBadge tramo={detalle.tramo} />
                    <span className="text-sm font-semibold text-rose-700">Deuda: {fmtMoney(detalle.total_deuda)}</span>
                    <span className="text-xs text-slate-500">{detalle.cuotas_vencidas} cuota(s) vencida(s)</span>
                  </div>
                  {detalle.meses_adeudados.length ? (
                    <p className="mt-2 text-xs text-slate-600">Meses adeudados: {detalle.meses_adeudados.map(fmtMes).join(", ")}</p>
                  ) : null}
                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                    <span>Mensaje este mes:</span>
                    {detalle.cliente.mensaje_mes_enviado && detalle.cliente.mensaje_mes_fecha ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Enviado · {fmtDate(detalle.cliente.mensaje_mes_fecha)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                        Sin mensaje este mes
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                    Servicios asociados ({detalle.servicios.length})
                  </p>
                  <div className="space-y-3">
                    {detalle.servicios.map((s) => (
                      <div key={s.suscripcion_id ?? "general"} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <span className="text-sm font-semibold text-slate-900">{s.tipo}</span>
                            {s.plan ? <span className="ml-2 text-xs text-slate-500">{s.plan}</span> : null}
                          </div>
                          <div className="flex items-center gap-2">
                            <TramoBadge tramo={s.tramo} />
                            <span className="text-sm font-semibold tabular-nums text-rose-700">{fmtMoney(s.total_adeudado)}</span>
                          </div>
                        </div>
                        <div className="mt-2">
                          <DetalleSeccion
                            titulo={`Vencidas (${s.facturas_vencidas.length})`}
                            facturas={s.facturas_vencidas}
                            puedeRegistrar={puedeRegistrar}
                            onRegistrar={(f) => setPagoFactura(f)}
                            oldestId={oldestPayable?.id ?? null}
                            oldestNumero={oldestPayable?.numero_factura ?? null}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Último pago</p>
                  {detalle.pagos_recientes.length === 0 ? (
                    <p className="text-xs text-slate-500">Sin pagos registrados.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                      {detalle.pagos_recientes.slice(0, 1).map((p, i) => (
                        <li key={i} className="flex items-center justify-between px-3 py-2 text-xs">
                          <span className="text-slate-600">{p.numero_factura ?? "—"} · {fmtDate(p.fecha_pago)} · {p.metodo_pago ?? "—"}</span>
                          <span className="font-semibold tabular-nums text-emerald-700">{fmtMoney(p.monto)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Promesas de pago</p>
                    <button
                      type="button"
                      onClick={() => setPromesaOpen(true)}
                      className="rounded-lg border border-[#4FAEB2]/40 bg-[#4FAEB2]/10 px-2.5 py-1 text-[11px] font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/20"
                    >
                      + Agregar promesa
                    </button>
                  </div>
                  {detalle.promesas.length === 0 ? (
                    <p className="text-xs text-slate-500">Sin promesas registradas.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                      {detalle.promesas.map((p) => (
                        <li key={p.id} className="flex items-center justify-between px-3 py-2 text-xs">
                          <span className="text-slate-700">
                            <b className="tabular-nums">{fmtDate(p.fecha_promesa)}</b>
                            <span className="ml-2 text-slate-400">{p.estado}</span>
                          </span>
                          <span className="text-[10px] text-slate-400">{p.creado_por_email ?? ""}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {!puedeRegistrar ? (
                  <p className="text-[11px] text-slate-400">El registro de pagos está disponible solo para administradores.</p>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Modal registrar pago */}
      {pagoFactura ? (
        <RegistrarPagoModal
          factura={pagoFactura}
          busy={pagoBusy}
          onCancel={() => setPagoFactura(null)}
          onConfirm={async (input) => {
            setPagoBusy(true);
            try {
              await registrarPagoCobranza({ factura_id: pagoFactura.id, ...input });
            } catch (e) {
              showToast(e instanceof Error ? e.message : "No se pudo registrar el pago");
            } finally {
              setPagoBusy(false);
            }
          }}
        />
      ) : null}

      {/* Modal promesa de pago */}
      {promesaOpen ? (
        <PromesaModal busy={promesaBusy} onCancel={() => setPromesaOpen(false)} onConfirm={(f) => void registrarPromesa(f)} />
      ) : null}

      {/* Toast */}
      {toast ? (
        <div className="fixed bottom-5 left-1/2 z-[70] -translate-x-1/2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-800 shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function PromesaModal({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: (fecha: string) => void;
}) {
  const hoyLocal = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [fecha, setFecha] = useState(hoyLocal);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-slate-900">Agregar promesa de pago</h3>
        <p className="mt-1 text-xs text-slate-500">Fecha en que el cliente se comprometió a pagar.</p>
        <label className="mt-4 block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fecha de promesa</span>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || !fecha}
            onClick={() => onConfirm(fecha)}
            className="rounded-xl bg-[#3F8E91] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#357a7d] disabled:opacity-50"
          >
            {busy ? "Guardando…" : "Guardar promesa"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetalleSeccion({
  titulo,
  facturas,
  puedeRegistrar,
  onRegistrar,
  oldestId,
  oldestNumero,
}: {
  titulo: string;
  facturas: FacturaLite[];
  puedeRegistrar: boolean;
  onRegistrar: (f: FacturaLite) => void;
  oldestId: string | null;
  oldestNumero: string | null;
}) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">{titulo}</p>
      {facturas.length === 0 ? (
        <p className="text-xs text-slate-500">Ninguna.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {facturas.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
              <span className={`min-w-0 whitespace-nowrap ${f.vencida ? "text-rose-600" : "text-slate-600"}`}>
                {f.numero_factura ?? "—"} · vence {fmtDate(f.fecha_vencimiento)}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="font-semibold tabular-nums text-slate-800">{fmtMoney(f.saldo)}</span>
                {puedeRegistrar ? (
                  f.id === oldestId ? (
                    <button
                      type="button"
                      onClick={() => onRegistrar(f)}
                      className="rounded-lg border border-[#4FAEB2]/40 bg-[#4FAEB2]/10 px-2 py-1 text-[10px] font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/20"
                    >
                      Registrar pago
                    </button>
                  ) : (
                    <span
                      className="text-[10px] text-slate-400"
                      title={`Primero se cobra la cuota más vieja${oldestNumero ? ` (${oldestNumero})` : ""}`}
                    >
                      Pagá primero {oldestNumero ?? "la cuota anterior"}
                    </span>
                  )
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RegistrarPagoModal({
  factura,
  busy,
  onCancel,
  onConfirm,
}: {
  factura: FacturaLite;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (input: {
    monto: number;
    fecha_pago: string;
    banco_origen: string;
    titular: string;
    numero_operacion: string;
    file: File | null;
  }) => void;
}) {
  const hoyLocal = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [monto, setMonto] = useState(String(factura.saldo));
  const [fecha, setFecha] = useState(hoyLocal);
  const [bancoOrigen, setBancoOrigen] = useState("");
  const [titular, setTitular] = useState("");
  const [numeroOperacion, setNumeroOperacion] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const montoNum = Number(monto);
  const invalido =
    !Number.isFinite(montoNum) ||
    montoNum <= 0 ||
    montoNum > factura.saldo ||
    !fecha ||
    !bancoOrigen.trim() ||
    !titular.trim() ||
    !numeroOperacion.trim();
  const fieldCls =
    "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20";
  const labelCls = "text-[11px] font-semibold uppercase tracking-wide text-slate-500";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-slate-900">Registrar cobro</h3>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Cobro por transferencia. Queda <b>pendiente de aprobación</b> en Conciliación bancaria.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {factura.numero_factura ?? "—"} · vence {fmtDate(factura.fecha_vencimiento)}
        </p>
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-600">
          Saldo pendiente: <b className="text-slate-900">{fmtMoney(factura.saldo)}</b>
        </div>
        <div className="mt-4 grid gap-3">
          <label className="block">
            <span className={labelCls}>Monto a cobrar</span>
            <input
              type="number"
              value={monto}
              min={0}
              max={factura.saldo}
              onChange={(e) => setMonto(e.target.value)}
              className={fieldCls}
            />
            {montoNum > factura.saldo ? <span className="mt-1 block text-[11px] text-rose-600">No puede superar el saldo.</span> : null}
          </label>
          <label className="block">
            <span className={labelCls}>Fecha de la transferencia</span>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={fieldCls} />
          </label>
          <label className="block">
            <span className={labelCls}>Banco de origen</span>
            <input type="text" value={bancoOrigen} onChange={(e) => setBancoOrigen(e.target.value)} placeholder="Banco desde el que se envió" className={fieldCls} />
          </label>
          <label className="block">
            <span className={labelCls}>Titular (quién envía)</span>
            <input type="text" value={titular} onChange={(e) => setTitular(e.target.value)} placeholder="Titular de la cuenta que envía" className={fieldCls} />
          </label>
          <label className="block">
            <span className={labelCls}>N° de comprobante / operación</span>
            <input type="text" value={numeroOperacion} onChange={(e) => setNumeroOperacion(e.target.value)} placeholder="Nº de operación de la transferencia" className={fieldCls} />
          </label>
          <label className="block">
            <span className={labelCls}>Comprobante <span className="normal-case text-slate-400">(recomendado — JPG, PNG, WebP o PDF)</span></span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
            />
          </label>
        </div>
        {err ? <p className="mt-3 text-xs text-rose-600">{err}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || invalido}
            onClick={() => {
              setErr(null);
              try {
                onConfirm({
                  monto: montoNum,
                  fecha_pago: fecha,
                  banco_origen: bancoOrigen.trim(),
                  titular: titular.trim(),
                  numero_operacion: numeroOperacion.trim(),
                  file,
                });
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Error");
              }
            }}
            className="rounded-xl bg-[#3F8E91] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#357a7d] disabled:opacity-50"
          >
            {busy ? "Enviando…" : "Enviar a aprobación"}
          </button>
        </div>
      </div>
    </div>
  );
}
