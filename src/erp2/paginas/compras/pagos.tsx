"use client";

/**
 * /compras/pagos — Pagos a proveedores (cuentas a pagar). Espejo de Cuentas a cobrar:
 * arriba lo que se debe, lo que vence esta semana, lo vencido por tramos y lo pagado en
 * el mes (Gs. o USD); los tramos filtran. Lista por vencimiento (lo más urgente primero)
 * con "Pagar" por factura y "Registrar pago" por proveedor. Pestaña "Pagos realizados"
 * con las órdenes de pago (ver, PDF, anular).
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Ban, Banknote, CalendarClock, Download, Eye, Loader2, Printer, Search, Wallet } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { descargarArchivo } from "@/erp2/lib/api/client-blob";
import { clienteConfig } from "@/erp2/cliente.config";
import { BarraFiltros, EncabezadoPagina } from "@/erp2/components/EncabezadoPagina";
import { TablaTarjetas, type ColumnaTabla } from "@/erp2/components/TablaResponsive";
import { TZ_PY } from "@/erp2/lib/fecha/paraguay";
import { useUsuario } from "@/erp2/lib/sesion/ContextoUsuario";
import {
  ESTADO_CXP, dinero, hrefOrigenCxp, nombreMetodoPago, textoVencimiento,
  type AntiguedadPagar, type CuentaPagar, type ListaCuentasPagar, type Moneda, type PagoProveedor,
} from "@/erp2/modules/compras/pagos";
import { RegistrarPagoProveedor, imprimirOrdenPago, useAvisoPago } from "@/erp2/modules/compras/RegistrarPagoProveedor";
import { AnularPago, DetallePago } from "@/erp2/modules/compras/DetallePago";

const TEAL = clienteConfig.color;
const POR_PAGINA = 50;
const dia = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("es-PY", { day: "2-digit", month: "short", year: "numeric" });
const fechaHora = (iso: string) => new Date(iso).toLocaleString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const TH = "whitespace-nowrap px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[var(--brand)]";
const BUSCADOR = "h-11 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none md:h-auto md:py-2.5 transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";

type Pagando = { id: string; nombre: string; cxp?: string | null };

export default function PagosProveedoresPage() {
  const esAdmin = useUsuario()?.rol === "ADMIN";
  const [tab, setTab] = useState<"cuentas" | "pagos">("cuentas");
  const [moneda, setMoneda] = useState<Moneda>("GS");
  const [ant, setAnt] = useState<AntiguedadPagar | null>(null);
  const [pagando, setPagando] = useState<Pagando | null>(null);
  const [filtro, setFiltro] = useState("");
  const [recarga, setRecarga] = useState(0);
  const { nodo: aviso, avisar } = useAvisoPago();

  const refrescar = useCallback(() => setRecarga((k) => k + 1), []);
  const din = (v: number) => dinero(v, moneda);

  return (
    <div className="space-y-5 pb-10 sm:space-y-6">
      <EncabezadoPagina
        titulo="Pagos a proveedores"
        subtitulo="Lo que les debés a tus proveedores por compras y gastos a crédito, empezando por lo más urgente."
        acciones={
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="flex rounded-xl bg-slate-100 p-1" role="group" aria-label="Moneda">
              {(["GS", "USD"] as const).map((m) => (
                <button key={m} onClick={() => setMoneda(m)} aria-pressed={moneda === m}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition max-sm:min-h-10 max-sm:flex-1 max-sm:text-sm ${moneda === m ? "bg-white shadow-sm" : "text-slate-500"}`}
                  style={moneda === m ? { color: TEAL } : undefined}>{m === "GS" ? "Guaraníes" : "Dólares"}</button>
              ))}
            </div>
          </div>
        }
      />

      <Kpis ant={ant} din={din} filtro={tab === "cuentas" ? filtro : ""} onFiltro={(f) => { setFiltro(f); setTab("cuentas"); }} />

      <div className="flex gap-1 border-b border-slate-200" role="tablist">
        {([["cuentas", "Cuentas a pagar"], ["pagos", "Pagos realizados"]] as const).map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)} role="tab" aria-selected={tab === v}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition max-sm:min-h-11 max-sm:flex-1 max-sm:px-2 ${tab === v ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === "cuentas" ? (
        <TablaCuentas moneda={moneda} filtro={filtro} setFiltro={setFiltro} recarga={recarga}
          onAntiguedad={setAnt} esAdmin={esAdmin} onPagar={setPagando} />
      ) : (
        <>
          <AntiguedadSilenciosa moneda={moneda} recarga={recarga} onAntiguedad={setAnt} />
          <TablaPagos moneda={moneda} recarga={recarga} esAdmin={esAdmin} onCambio={refrescar} />
        </>
      )}

      {pagando ? (
        <RegistrarPagoProveedor proveedorId={pagando.id} proveedorNombre={pagando.nombre} moneda={moneda} cxpInicial={pagando.cxp ?? null}
          onClose={() => setPagando(null)} onHecho={(p) => { avisar(p); refrescar(); }} />
      ) : null}
      {aviso}
    </div>
  );
}

function Kpis({ ant, din, filtro, onFiltro }: { ant: AntiguedadPagar | null; din: (v: number) => string; filtro: string; onFiltro: (f: string) => void }) {
  const tile = (clave: string) =>
    `rounded-2xl border bg-white px-3 py-3 text-left shadow-sm transition hover:border-slate-300 ${filtro === clave ? "border-[var(--brand)] ring-2 ring-[var(--brand-100)]" : "border-slate-200"}`;
  const tocar = (clave: string) => onFiltro(filtro === clave ? "" : clave);
  const vencido = ant ? Number(ant.d1_30) + Number(ant.d31_60) + Number(ant.d61_90) + Number(ant.d90) : 0;
  const tramos: { l: string; v: number; tono: string }[] = [
    { l: "Vencido 1 a 30 días", v: Number(ant?.d1_30 ?? 0), tono: "text-amber-600" },
    { l: "31 a 60 días", v: Number(ant?.d31_60 ?? 0), tono: "text-orange-600" },
    { l: "61 a 90 días", v: Number(ant?.d61_90 ?? 0), tono: "text-rose-600" },
    { l: "Más de 90 días", v: Number(ant?.d90 ?? 0), tono: "text-rose-700" },
  ];
  return (
    <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr_2fr]">
      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><Wallet className="h-4 w-4" /> A pagar</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 [overflow-wrap:anywhere] sm:text-3xl">{din(ant?.total ?? 0)}</p>
        <p className="mt-1 text-xs text-slate-500">
          {ant?.proveedores ?? 0} {ant?.proveedores === 1 ? "proveedor" : "proveedores"}
          {vencido > 0 ? <span className="font-semibold text-rose-600"> · vencido {din(vencido)}</span> : null}
          <span className="text-emerald-700"> · pagado este mes {din(ant?.pagado_mes ?? 0)}</span>
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => tocar("semana")} className={tile("semana")}>
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500"><CalendarClock className="h-3.5 w-3.5" /> Vence esta semana</p>
          <p className={`mt-1 text-sm font-bold tabular-nums ${Number(ant?.vence_semana ?? 0) > 0 ? "text-amber-600" : "text-slate-300"}`}>{din(ant?.vence_semana ?? 0)}</p>
        </button>
        <button onClick={() => tocar("por_vencer")} className={tile("por_vencer")}>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Por vencer</p>
          <p className={`mt-1 text-sm font-bold tabular-nums ${Number(ant?.por_vencer ?? 0) > 0 ? "text-slate-900" : "text-slate-300"}`}>{din(ant?.por_vencer ?? 0)}</p>
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tramos.map((t) => (
          <button key={t.l} onClick={() => tocar("vencidas")} className={tile("vencidas")}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t.l}</p>
            <p className={`mt-1 text-sm font-bold tabular-nums ${t.v > 0 ? t.tono : "text-slate-300"}`}>{din(t.v)}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

/** En la pestaña de pagos los KPIs siguen al día (antigüedad de la moneda elegida). */
function AntiguedadSilenciosa({ moneda, recarga, onAntiguedad }: { moneda: Moneda; recarga: number; onAntiguedad: (a: AntiguedadPagar) => void }) {
  useEffect(() => {
    apiFetch<ListaCuentasPagar>(`/api/cuentas-pagar?moneda=${moneda}&por_pagina=10`).then((r) => onAntiguedad(r.antiguedad)).catch(() => {});
  }, [moneda, recarga, onAntiguedad]);
  return null;
}

function TablaCuentas({ moneda, filtro, setFiltro, recarga, onAntiguedad, esAdmin, onPagar }: {
  moneda: Moneda; filtro: string; setFiltro: (f: string) => void; recarga: number;
  onAntiguedad: (a: AntiguedadPagar) => void; esAdmin: boolean; onPagar: (p: Pagando) => void;
}) {
  const [rows, setRows] = useState<CuentaPagar[]>([]);
  const [total, setTotal] = useState(0);
  const [totalSaldo, setTotalSaldo] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [borrador, setBorrador] = useState("");
  const [q, setQ] = useState("");
  const [pagina, setPagina] = useState(1);
  const [exportando, setExportando] = useState(false);
  const din = (v: number) => dinero(v, moneda);

  useEffect(() => {
    const t = setTimeout(() => { setQ(borrador.trim()); setPagina(1); }, 300);
    return () => clearTimeout(t);
  }, [borrador]);
  useEffect(() => { setPagina(1); }, [moneda, filtro]);

  const params = useCallback(() => {
    const sp = new URLSearchParams({ moneda });
    if (q) sp.set("q", q);
    if (filtro) sp.set("filtro", filtro);
    return sp;
  }, [moneda, q, filtro]);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    const sp = params();
    sp.set("pagina", String(pagina));
    sp.set("por_pagina", String(POR_PAGINA));
    apiFetch<ListaCuentasPagar>(`/api/cuentas-pagar?${sp}`)
      .then((r) => { if (!cancel) { setRows(r.rows); setTotal(r.total); setTotalSaldo(r.total_saldo); onAntiguedad(r.antiguedad); } })
      .catch(() => { if (!cancel) { setRows([]); setTotal(0); } })
      .finally(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, [params, pagina, recarga, onAntiguedad]);

  async function exportar() {
    setExportando(true);
    try { await descargarArchivo(`/api/cuentas-pagar/export?${params()}`, "cuentas-a-pagar.xlsx"); } catch { /* best-effort */ } finally { setExportando(false); }
  }

  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const filtrosActivos = filtro ? 1 : 0;

  // Tabla en ≥ 768 px; en celular cada factura es una tarjeta (proveedor, factura, saldo, estado y "Pagar").
  const columnas: ColumnaTabla<CuentaPagar>[] = [
    {
      key: "proveedor", titulo: "Proveedor", movil: "titulo", claseTh: "pl-5", claseTd: "min-w-48 pl-5",
      celda: (r) => (
        <>
          <p className="font-bold text-slate-900">{r.proveedor_nombre}</p>
          <p className="text-[11px] text-slate-500">
            {r.proveedor_ruc ? <span className="font-mono">RUC {r.proveedor_ruc}</span> : "sin RUC"}
            {esAdmin ? (
              <button onClick={() => onPagar({ id: r.proveedor_id, nombre: r.proveedor_nombre })} className="ml-2 font-semibold text-[var(--brand)] hover:underline">Registrar pago</button>
            ) : null}
          </p>
        </>
      ),
      celdaMovil: (r) => r.proveedor_nombre,
    },
    { key: "ruc", titulo: "RUC", movil: "detalle", claseTh: "hidden", claseTd: "hidden", celda: (r) => (r.proveedor_ruc ? <span className="font-mono">{r.proveedor_ruc}</span> : "sin RUC") },
    {
      key: "factura", titulo: "Factura", movil: "subtitulo", claseTd: "whitespace-nowrap font-mono text-xs font-semibold text-slate-800",
      celda: (r) => r.numero, celdaMovil: (r) => <>Factura <span className="font-mono text-xs">{r.numero}</span></>,
    },
    { key: "compra", titulo: "Compra / gasto", movil: "oculto", celda: (r) => <Link href={hrefOrigenCxp(r)} className="inline-flex items-center font-mono text-xs font-semibold text-[var(--brand)] hover:underline max-md:min-h-9">{r.compra_numero}</Link> },
    { key: "emision", titulo: "Emisión", movil: "detalle", claseTd: "whitespace-nowrap text-xs text-slate-600", celda: (r) => dia(r.fecha_emision) },
    {
      key: "vencimiento", titulo: "Vencimiento", movil: "dato", claseTd: "whitespace-nowrap text-xs",
      celda: (r) => {
        const v = textoVencimiento(r.dias_atraso, r.dias_para_vencer);
        return (
          <>
            <span className="text-slate-700">{dia(r.vencimiento)}</span>
            <span className={`block text-[11px] ${v.c}`}>{v.t}</span>
          </>
        );
      },
      celdaMovil: (r) => { const v = textoVencimiento(r.dias_atraso, r.dias_para_vencer); return <span className={v.c}>{v.t}</span>; },
    },
    { key: "monto", titulo: "Monto", movil: "oculto", claseTh: "text-right", claseTd: "whitespace-nowrap text-right tabular-nums text-slate-600", celda: (r) => din(r.monto) },
    { key: "pagado", titulo: "Pagado", movil: "dato", claseTh: "text-right", claseTd: "whitespace-nowrap text-right tabular-nums text-emerald-700", celda: (r) => (Number(r.pagado) ? din(r.pagado) : "—"), celdaMovil: (r) => (Number(r.pagado) ? `pagado ${din(r.pagado)}` : null) },
    { key: "saldo", titulo: "Saldo", movil: "valor", claseTh: "text-right", claseTd: "whitespace-nowrap text-right font-bold tabular-nums text-slate-900", celda: (r) => din(r.saldo) },
    {
      key: "estado", titulo: "Estado", movil: "chip",
      celda: (r) => {
        const est = r.dias_atraso > 0 ? { t: "Vencida", c: "bg-rose-50 text-rose-700" } : ESTADO_CXP[r.estado] ?? ESTADO_CXP.pendiente;
        return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${est.c}`}>{est.t}</span>;
      },
    },
    {
      key: "acciones", titulo: "", movil: esAdmin ? "pie" : "oculto", claseTh: "w-px pr-5", claseTd: "pr-5",
      celda: (r) => esAdmin ? (
        <button onClick={() => onPagar({ id: r.proveedor_id, nombre: r.proveedor_nombre, cxp: r.id })}
          className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white hover:brightness-95" style={{ backgroundColor: TEAL }}>
          <Banknote className="h-3.5 w-3.5" /> Pagar
        </button>
      ) : null,
      celdaMovil: (r) => (
        <>
          <button onClick={() => onPagar({ id: r.proveedor_id, nombre: r.proveedor_nombre })} className="inline-flex items-center whitespace-nowrap rounded-lg border border-slate-200 px-3 text-[13px] font-semibold text-slate-600" title="Registrar un pago a este proveedor (una o varias facturas)">Pagar varias</button>
          <button onClick={() => onPagar({ id: r.proveedor_id, nombre: r.proveedor_nombre, cxp: r.id })}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-4 text-sm font-semibold text-white" style={{ backgroundColor: TEAL }}>
            <Banknote className="h-4 w-4" /> Pagar
          </button>
        </>
      ),
    },
  ];

  const contador = <p className="text-xs text-slate-500">{total} {total === 1 ? "factura" : "facturas"} · {din(totalSaldo)}</p>;
  const botonExcel = (
    <button onClick={exportar} disabled={exportando || total === 0} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 max-md:min-h-11">
      {exportando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Excel
    </button>
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-3 py-3 sm:px-5">
        <BarraFiltros
          plano
          activos={filtrosActivos}
          onLimpiar={() => { setFiltro(""); setPagina(1); }}
          busqueda={
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input type="search" value={borrador} onChange={(e) => setBorrador(e.target.value)} placeholder="Buscar por proveedor, RUC, factura o compra…"
                aria-label="Buscar cuentas a pagar" enterKeyHint="search" className={BUSCADOR} />
            </div>
          }
          extra={<div className="flex items-center gap-2 max-md:hidden">{botonExcel}{contador}</div>}
        >
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 md:flex" role="group" aria-label="Vencimiento">
            {([["", "Todas"], ["vencidas", "Vencidas"], ["semana", "Vencen esta semana"], ["por_vencer", "Por vencer"]] as const).map(([v, l]) => (
              <button key={v} onClick={() => { setFiltro(v); setPagina(1); }} aria-pressed={filtro === v}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition max-md:min-h-11 max-md:text-sm ${filtro === v ? "bg-white shadow-sm" : "text-slate-500"}`}
                style={filtro === v ? { color: TEAL } : undefined}>{l}</button>
            ))}
          </div>
        </BarraFiltros>
        <div className="mt-2 flex items-center justify-between gap-2 md:hidden">{contador}{botonExcel}</div>
      </div>

      {cargando && rows.length === 0 ? (
        <p className="px-5 py-12 text-center text-sm text-slate-400">Cargando…</p>
      ) : rows.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <Banknote className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-700">{q || filtro ? "Ninguna factura coincide" : `No le debés nada a ningún proveedor${moneda === "USD" ? " en dólares" : ""}`}</p>
          <p className="mt-1 text-xs text-slate-500">Las compras y los gastos a crédito aparecen acá hasta que los pagues.</p>
        </div>
      ) : (
        <TablaTarjetas
          filas={rows}
          columnas={columnas}
          claveFila={(r) => r.id}
          cargando={cargando}
          minAncho={1040}
          claseTabla="w-full text-left text-sm"
          claseThead="border-b-2 border-[var(--brand)]/15 bg-[var(--brand)]/5"
          thBase={TH}
          tdBase="px-3 py-3"
        />
      )}
      <Paginador pagina={pagina} totalPaginas={totalPaginas} total={total} porPagina={POR_PAGINA} setPagina={setPagina} />
    </section>
  );
}

function TablaPagos({ moneda, recarga, esAdmin, onCambio }: {
  moneda: Moneda; recarga: number; esAdmin: boolean; onCambio: () => void;
}) {
  const POR = 25;
  const [rows, setRows] = useState<PagoProveedor[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [borrador, setBorrador] = useState("");
  const [q, setQ] = useState("");
  const [anulados, setAnulados] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [viendo, setViendo] = useState<string | null>(null);
  const [anulando, setAnulando] = useState<PagoProveedor | null>(null);
  const [recargaLocal, setRecargaLocal] = useState(0);
  const din = (v: number) => dinero(v, moneda);

  useEffect(() => {
    const t = setTimeout(() => { setQ(borrador.trim()); setPagina(1); }, 300);
    return () => clearTimeout(t);
  }, [borrador]);
  useEffect(() => { setPagina(1); }, [moneda, anulados]);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    const sp = new URLSearchParams({ moneda, pagina: String(pagina), por_pagina: String(POR) });
    if (q) sp.set("q", q);
    if (anulados) sp.set("anulados", "1");
    apiFetch<{ rows: PagoProveedor[]; total: number }>(`/api/pagos-proveedores?${sp}`)
      .then((r) => { if (!cancel) { setRows(r.rows); setTotal(r.total); } })
      .catch(() => { if (!cancel) { setRows([]); setTotal(0); } })
      .finally(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, [moneda, q, anulados, pagina, recarga, recargaLocal]);

  const totalPaginas = Math.max(1, Math.ceil(total / POR));
  const contador = <p className="text-xs text-slate-500">{total} {total === 1 ? "orden de pago" : "órdenes de pago"}</p>;
  const medios = (p: PagoProveedor) => (p.medios ?? []).map((m) => `${nombreMetodoPago(m.metodo)}${m.referencia ? ` (${m.referencia})` : ""}`).join(" + ");

  // Tabla en ≥ 768 px; en celular cada orden de pago es una tarjeta (tocarla abre el detalle).
  const columnas: ColumnaTabla<PagoProveedor>[] = [
    {
      key: "numero", titulo: "Número", movil: "subtitulo", claseTh: "pl-5", claseTd: "whitespace-nowrap pl-5",
      celda: (p) => {
        const anulado = !!p.anulado_at;
        return (
          <>
            <button onClick={() => setViendo(p.id)} className={`font-mono text-xs font-semibold hover:text-[var(--brand)] ${anulado ? "text-slate-400 line-through" : "text-slate-800"}`}>{p.numero}</button>
            {anulado ? <span className="ml-2 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">Anulada</span> : null}
          </>
        );
      },
      celdaMovil: (p) => <><span className={`font-mono text-xs ${p.anulado_at ? "line-through" : ""}`}>{p.numero}</span> · {fechaHora(p.fecha)}</>,
    },
    { key: "proveedor", titulo: "Proveedor", movil: "titulo", claseTd: "font-semibold text-slate-800", celda: (p) => p.proveedor_nombre },
    { key: "fecha", titulo: "Fecha", movil: "oculto", claseTd: "whitespace-nowrap text-xs text-slate-600", celda: (p) => fechaHora(p.fecha) },
    {
      key: "medios", titulo: "Medios", movil: "dato", claseTd: "text-xs text-slate-600",
      celda: (p) => (
        <>
          {medios(p)}
          {p.anulado_at && p.anulado_motivo ? <span className="block text-[11px] text-rose-600">anulada: {p.anulado_motivo}</span> : null}
        </>
      ),
    },
    { key: "anulada", titulo: "Estado", movil: "chip", claseTh: "hidden", claseTd: "hidden", celda: (p) => (p.anulado_at ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-600">Anulada</span> : null) },
    {
      key: "total", titulo: "Total", movil: "valor", claseTh: "text-right", claseTd: "whitespace-nowrap text-right font-bold tabular-nums",
      celda: (p) => <span className={p.anulado_at ? "text-slate-400 line-through" : "text-slate-900"}>{din(p.total)}</span>,
    },
    { key: "usuario", titulo: "Usuario", movil: "dato", claseTd: "text-xs text-slate-600", celda: (p) => p.usuario_nombre ?? "—" },
    {
      key: "acciones", titulo: "", movil: "pie", claseTh: "w-px pr-5", claseTd: "pr-5",
      celda: (p) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => setViendo(p.id)} title="Ver" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"><Eye className="h-3.5 w-3.5" /> Ver</button>
          <button onClick={() => imprimirOrdenPago(p.id, p.numero).catch(() => {})} title="Orden de pago en PDF" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"><Printer className="h-3.5 w-3.5" /> PDF</button>
          {!p.anulado_at && esAdmin ? (
            <button onClick={() => setAnulando(p)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Ban className="h-3.5 w-3.5" /> Anular</button>
          ) : null}
        </div>
      ),
      celdaMovil: (p) => (
        <>
          <button onClick={() => imprimirOrdenPago(p.id, p.numero).catch(() => {})} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[13px] font-medium text-slate-600"><Printer className="h-4 w-4" /> PDF</button>
          {!p.anulado_at && esAdmin ? (
            <button onClick={() => setAnulando(p)} className="inline-flex items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-rose-600"><Ban className="h-4 w-4" /> Anular</button>
          ) : null}
        </>
      ),
    },
  ];

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-3 py-3 sm:px-5">
        <BarraFiltros
          plano
          activos={anulados ? 1 : 0}
          onLimpiar={() => setAnulados(false)}
          busqueda={
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input type="search" value={borrador} onChange={(e) => setBorrador(e.target.value)} placeholder="Buscar por número de orden (OP-…) o proveedor…"
                aria-label="Buscar órdenes de pago" enterKeyHint="search" className={BUSCADOR} />
            </div>
          }
          extra={<div className="max-md:hidden">{contador}</div>}
        >
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600 max-md:min-h-11 max-md:text-sm">
            <input type="checkbox" checked={anulados} onChange={(e) => setAnulados(e.target.checked)} className="h-4 w-4 accent-[var(--brand)] max-md:h-5 max-md:w-5" />
            Ver también las anuladas
          </label>
        </BarraFiltros>
        <div className="mt-2 md:hidden">{contador}</div>
      </div>

      {cargando && rows.length === 0 ? (
        <p className="px-5 py-12 text-center text-sm text-slate-400">Cargando…</p>
      ) : rows.length === 0 ? (
        <p className="px-5 py-16 text-center text-sm text-slate-400">{q ? "Ninguna orden de pago coincide." : "Todavía no registraste pagos a proveedores."}</p>
      ) : (
        <TablaTarjetas
          filas={rows}
          columnas={columnas}
          claveFila={(p) => p.id}
          onFila={(p) => setViendo(p.id)}
          cargando={cargando}
          claseFila={(p) => (p.anulado_at ? "opacity-60" : "")}
          minAncho={960}
          claseTabla="w-full text-left text-sm"
          claseThead="border-b-2 border-[var(--brand)]/15 bg-[var(--brand)]/5"
          thBase={TH}
          tdBase="px-3 py-3"
        />
      )}
      <Paginador pagina={pagina} totalPaginas={totalPaginas} total={total} porPagina={POR} setPagina={setPagina} />

      {viendo ? <DetallePago id={viendo} puedeAnular={esAdmin} onClose={() => setViendo(null)} onAnular={(p) => { setViendo(null); setAnulando(p); }} /> : null}
      {anulando ? (
        <AnularPago pago={anulando} onClose={() => setAnulando(null)} onAnulado={() => { setRecargaLocal((k) => k + 1); onCambio(); }} />
      ) : null}
    </section>
  );
}

function Paginador({ pagina, totalPaginas, total, porPagina, setPagina }: { pagina: number; totalPaginas: number; total: number; porPagina: number; setPagina: (f: (p: number) => number) => void }) {
  if (total <= porPagina) return null;
  return (
    <div className="flex flex-col gap-2 border-t border-slate-100 px-3 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <span className="text-center sm:text-left">Página {pagina} de {totalPaginas}</span>
      <div className="flex gap-2">
        <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40 max-sm:min-h-11 max-sm:flex-1 max-sm:text-sm">Anterior</button>
        <button disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40 max-sm:min-h-11 max-sm:flex-1 max-sm:text-sm">Siguiente</button>
      </div>
    </div>
  );
}
