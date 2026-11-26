"use client";

/**
 * /inventario/ajustes — Ajustes (AJ-) y pérdidas (PE-) de inventario.
 *   · ajuste: conteo físico, inventario inicial, corrección (solo ADMIN)
 *   · pérdida: vencimiento, rotura, devolución no revendible… valorizada al costo. La carga
 *     cualquiera de su sucursal; queda PENDIENTE hasta que un ADMIN la aprueba
 *   · detalle (?ver=<id>) con aprobar / rechazar / anular
 */
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, ClipboardCheck, Loader2, PackageMinus, Search, X } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { tienePermiso, useUsuario } from "@/erp2/lib/sesion/ContextoUsuario";
import { Select } from "@/erp2/components/Select";
import { BarraFiltros } from "@/erp2/components/EncabezadoPagina";
import { TablaTarjetas, useVistaTarjetas, type ColumnaTabla } from "@/erp2/components/TablaResponsive";
import { invalidarLista, useListaCacheada } from "@/erp2/modules/inventario/lista-cache";
import { hayVariosDepositos, invalidarDepositos, opcionesDepositos, useDepositos } from "@/erp2/modules/inventario/depositos";
import {
  ESTADO_AJUSTE, cant, dia, fechaHora, gs, motivoAjuste,
  type AjusteDetalle, type FilaAjuste,
} from "@/erp2/modules/inventario/documentos";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, Cabecera, Dato, INPUT_FILTRO, ModalDocumento, Paginador, PedirMotivo, Pestanas, TEAL } from "@/erp2/modules/inventario/ui";
import { SelectorFecha } from "@/erp2/components/SelectorFecha";

const POR_PAGINA = 25;
type Pagina = {
  rows: FilaAjuste[];
  total: number;
  pendientes: number;
  totales: { perdidas_valor: number; perdidas_unidades: number; ajustes_entrada_valor: number; ajustes_salida_valor: number };
};

const sinMover = (a: FilaAjuste) => a.estado === "pendiente" || a.estado === "rechazado";
const valorDe = (a: FilaAjuste) => Number(a.valor_entrada) - Number(a.valor_salida);

/** Celular (< 768 px): cada documento es una tarjeta (la tabla de escritorio queda igual). */
const columnasMovil: ColumnaTabla<FilaAjuste>[] = [
  { key: "tipo", titulo: "Tipo", movil: "titulo", celda: (a) => <>{a.tipo === "perdida" ? "Pérdida" : "Ajuste"} · {motivoAjuste(a.motivo)}</> },
  { key: "numero", titulo: "Documento", movil: "subtitulo", celda: (a) => a.numero },
  {
    key: "valor", titulo: "Valor al costo", movil: "valor",
    celda: (a) => {
      const v = valorDe(a);
      return sinMover(a) ? <span className="text-slate-400">—</span>
        : <span className={v < 0 ? "text-red-600" : v > 0 ? "text-emerald-700" : "text-slate-400"}>{`${v < 0 ? "−" : v > 0 ? "+" : ""}${gs(Math.abs(v))}`}</span>;
    },
  },
  { key: "estado", titulo: "Estado", movil: "chip", celda: (a) => { const e = ESTADO_AJUSTE[a.estado]; return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${e.clase}`}>{e.label}</span>; } },
  { key: "deposito", titulo: "Depósito", movil: "dato", celda: (a) => a.deposito.nombre },
  {
    key: "unidades", titulo: "Unidades", movil: "detalle",
    celda: (a) => sinMover(a) ? "—" : (
      <span className="tabular-nums">
        {Number(a.total_entrada) > 0 ? <span className="font-semibold text-emerald-700">+{cant(a.total_entrada)} </span> : null}
        {Number(a.total_salida) > 0 ? <span className="font-semibold text-red-600">−{cant(a.total_salida)}</span> : null}
        {!Number(a.total_entrada) && !Number(a.total_salida) ? <span className="text-slate-400">sin diferencias</span> : null}
      </span>
    ),
  },
  { key: "fecha", titulo: "Cargado", movil: "dato", celda: (a) => fechaHora(a.created_at) },
  { key: "items", titulo: "Productos", movil: "dato", celda: (a) => `${a.items} ${Number(a.items) === 1 ? "producto" : "productos"}` },
  { key: "usuario", titulo: "Usuario", movil: "detalle", celda: (a) => a.usuario_nombre ?? "—" },
  { key: "sucursal", titulo: "Sucursal", movil: "detalle", celda: (a) => a.deposito.sucursal },
  { key: "detalle", titulo: "Detalle", movil: "detalle", celda: (a) => a.detalle || "—" },
];

export default function AjustesPage() {
  return (
    <Suspense fallback={null}>
      <Ajustes />
    </Suspense>
  );
}

function Ajustes() {
  const router = useRouter();
  const sp = useSearchParams();
  const ver = sp.get("ver");
  const me = useUsuario();
  // Perfil: "Nuevo ajuste" pide ajustes de inventario; "Nueva pérdida", cargar pérdidas.
  const puedeAjustar = tienePermiso(me, "ajustes_inventario");
  const puedePerdida = tienePermiso(me, "registrar_perdidas");
  const deps = useDepositos();
  const [vista, setVista] = useState(sp.get("vista") ?? "");
  const [deposito, setDeposito] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [pagina, setPagina] = useState(1);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => { setQ(busqueda.trim()); setPagina(1); }, 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  const url = useMemo(() => {
    const p = new URLSearchParams({ pagina: String(pagina), por_pagina: String(POR_PAGINA) });
    if (vista === "ajuste" || vista === "perdida") p.set("tipo", vista);
    if (vista === "pendiente") p.set("estado", "pendiente");
    if (deposito) p.set("deposito", deposito);
    if (q) p.set("q", q);
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    return `/api/inventario/ajustes?${p}`;
  }, [pagina, vista, deposito, q, desde, hasta]);
  const lista = useListaCacheada<Pagina>(url, recarga);
  const rows = lista.error ? [] : lista.datos?.rows ?? [];
  const total = lista.error ? 0 : lista.datos?.total ?? 0;
  const tot = lista.datos?.totales;

  const abrir = (id: string | null) => router.replace(id ? `/inventario/ajustes?ver=${id}` : "/inventario/ajustes", { scroll: false });
  const cambio = () => {
    invalidarLista("/api/productos");
    invalidarLista("/api/inventario/movimientos");
    invalidarLista("/api/inventario/vencimientos");
    invalidarDepositos();
    setRecarga((k) => k + 1);
  };

  const vistaTarjetas = useVistaTarjetas();

  return (
    <div className="space-y-5 pb-10 sm:space-y-6">
      <Cabecera volver={{ href: "/inventario/panel", label: "Inventario" }} kicker="Inventario · Documentos" titulo="Ajustes y pérdidas" subtitulo="Conteos, correcciones y bajas de mercadería, documentados y valorizados al costo">
        {puedePerdida ? (
          <Link href="/inventario/ajustes/nuevo?tipo=perdida" className={BOTON_SECUNDARIO}>
            <PackageMinus className="h-4 w-4" /> Nueva pérdida
          </Link>
        ) : null}
        {puedeAjustar ? (
          <Link href="/inventario/ajustes/nuevo?tipo=ajuste" className={BOTON_PRIMARIO} style={{ backgroundColor: TEAL }}>
            <ClipboardCheck className="h-4 w-4" /> Nuevo ajuste
          </Link>
        ) : null}
      </Cabecera>

      {tot ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
          <Cifra etiqueta="Pérdidas (aplicadas)" valor={gs(tot.perdidas_valor)} detalle={`${cant(tot.perdidas_unidades)} unidades`} tono="rose" clase="max-sm:col-span-2" />
          <Cifra etiqueta="Ajustes que sumaron" valor={gs(tot.ajustes_entrada_valor)} detalle="al costo" tono="emerald" />
          <Cifra etiqueta="Ajustes que restaron" valor={gs(tot.ajustes_salida_valor)} detalle="al costo" tono="slate" />
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: `${TEAL}33` }}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-3 sm:px-5" style={{ borderColor: `${TEAL}22`, background: `linear-gradient(to right, ${TEAL}0d, transparent)` }}>
          <div className="min-w-0 max-md:w-full">
            <Pestanas valor={vista} onChange={(v) => { setVista(v); setPagina(1); }}
              opciones={[
                { id: "", label: "Todos" },
                { id: "ajuste", label: "Ajustes" },
                { id: "perdida", label: "Pérdidas" },
                { id: "pendiente", label: "Pendientes", badge: lista.datos?.pendientes ?? 0 },
              ]} />
          </div>
          {/* Celular: búsqueda + "Filtros" (hoja inferior con depósito y fechas); desde md, en línea. */}
          <BarraFiltros plano className="max-md:w-full" activos={(deposito ? 1 : 0) + (desde ? 1 : 0) + (hasta ? 1 : 0)}
            onLimpiar={() => { setDeposito(""); setDesde(""); setHasta(""); setPagina(1); }}
            busqueda={
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="N°, producto, detalle…" type="search" enterKeyHint="search" aria-label="Buscar ajustes y pérdidas"
                  className={`${INPUT_FILTRO} w-full pl-9 max-md:h-11 md:w-56`} />
              </div>
            }>
            {hayVariosDepositos(deps.datos) ? (
              <Select value={deposito} onChange={(v) => { setDeposito(v); setPagina(1); }} minWidth={200} etiqueta="Depósito" className="max-sm:!min-w-0"
                options={[["", "Todos los depósitos"], ...opcionesDepositos(deps.datos, { soloActivos: false })]} />
            ) : null}
            <div className="flex flex-col gap-1 md:block">
              <span className="text-xs font-medium text-slate-600 md:sr-only">Desde</span>
              <SelectorFecha compacto etiqueta="Desde" value={desde} onChange={(v) => { setDesde(v); setPagina(1); }} max={hasta || undefined} claseBoton="h-10 rounded-xl px-3 text-slate-800 max-md:h-11" className="max-md:w-full md:w-[150px]" />
            </div>
            <div className="flex flex-col gap-1 md:block">
              <span className="text-xs font-medium text-slate-600 md:sr-only">Hasta</span>
              <SelectorFecha compacto etiqueta="Hasta" value={hasta} onChange={(v) => { setHasta(v); setPagina(1); }} min={desde || undefined} claseBoton="h-10 rounded-xl px-3 text-slate-800 max-md:h-11" className="max-md:w-full md:w-[150px]" />
            </div>
          </BarraFiltros>
        </div>

        {vistaTarjetas ? (
          <TablaTarjetas
            filas={rows}
            columnas={columnasMovil}
            claveFila={(a) => a.id}
            onFila={(a) => abrir(a.id)}
            cargando={lista.cargando}
            vacio={
              <div className="px-4 py-14 text-center">
                {lista.cargando ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /> : (
                  <>
                    <div className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl border" style={{ backgroundColor: `${TEAL}14`, borderColor: `${TEAL}33` }}>
                      <ClipboardCheck className="h-6 w-6" style={{ color: TEAL }} />
                    </div>
                    <p className="text-sm font-semibold text-slate-700">{vista === "pendiente" ? "No hay pérdidas pendientes de aprobar" : "No hay documentos"}</p>
                  </>
                )}
              </div>
            }
          />
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-slate-50/70 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Documento</th>
                <th className="px-3 py-3 font-semibold">Motivo</th>
                <th className="px-3 py-3 font-semibold">Depósito</th>
                <th className="px-3 py-3 text-right font-semibold">Unidades</th>
                <th className="px-3 py-3 text-right font-semibold">Valor al costo</th>
                <th className="px-3 py-3 font-semibold">Estado</th>
                <th className="px-5 py-3 font-semibold">Cargado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lista.cargando && rows.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center">
                    <div className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl border" style={{ backgroundColor: `${TEAL}14`, borderColor: `${TEAL}33` }}>
                      <ClipboardCheck className="h-6 w-6" style={{ color: TEAL }} />
                    </div>
                    <p className="text-sm font-semibold text-slate-700">{vista === "pendiente" ? "No hay pérdidas pendientes de aprobar" : "No hay documentos"}</p>
                  </td>
                </tr>
              ) : rows.map((a) => {
                const e = ESTADO_AJUSTE[a.estado];
                const perdida = a.tipo === "perdida";
                const valor = Number(a.valor_entrada) - Number(a.valor_salida);
                return (
                  <tr key={a.id} onClick={() => abrir(a.id)} className={`cursor-pointer transition-colors hover:bg-[var(--brand-50)] ${lista.cargando ? "opacity-60" : ""}`}>
                    <td className="px-5 py-3">
                      <p className="font-mono text-sm font-semibold text-slate-900">{a.numero}</p>
                      <p className={`text-[11px] font-semibold ${perdida ? "text-rose-600" : "text-slate-500"}`}>{perdida ? "Pérdida" : "Ajuste"} · {a.items} {a.items === 1 ? "producto" : "productos"}</p>
                    </td>
                    <td className="max-w-[240px] px-3 py-3 text-xs">
                      <p className="font-medium text-slate-700">{motivoAjuste(a.motivo)}</p>
                      {a.detalle ? <p className="truncate text-[11px] text-slate-400" title={a.detalle}>{a.detalle}</p> : null}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <p className="font-medium text-slate-700">{a.deposito.nombre}</p>
                      <p className="text-[11px] text-slate-400">{a.deposito.sucursal}</p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right text-xs tabular-nums">
                      {a.estado === "pendiente" || a.estado === "rechazado" ? <span className="text-slate-400">—</span> : (
                        <>
                          {Number(a.total_entrada) > 0 ? <span className="block font-semibold text-emerald-700">+{cant(a.total_entrada)}</span> : null}
                          {Number(a.total_salida) > 0 ? <span className="block font-semibold text-red-600">−{cant(a.total_salida)}</span> : null}
                          {!Number(a.total_entrada) && !Number(a.total_salida) ? <span className="text-slate-400">sin diferencias</span> : null}
                        </>
                      )}
                    </td>
                    <td className={`whitespace-nowrap px-3 py-3 text-right text-sm font-semibold tabular-nums ${valor < 0 ? "text-red-600" : valor > 0 ? "text-emerald-700" : "text-slate-400"}`}>
                      {a.estado === "pendiente" || a.estado === "rechazado" ? "—" : `${valor < 0 ? "−" : valor > 0 ? "+" : ""}${gs(Math.abs(valor))}`}
                    </td>
                    <td className="px-3 py-3"><span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${e.clase}`}>{e.label}</span></td>
                    <td className="whitespace-nowrap px-5 py-3 text-xs text-slate-500">
                      {fechaHora(a.created_at)}
                      <span className="block text-[11px] text-slate-400">{a.usuario_nombre}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
        <Paginador pagina={pagina} porPagina={POR_PAGINA} total={total} cargando={lista.cargando} onCambiar={setPagina} />
      </section>

      {ver ? <DetalleAjuste id={ver} onClose={() => abrir(null)} onCambio={cambio} /> : null}
    </div>
  );
}

function Cifra({ etiqueta, valor, detalle, tono, clase = "" }: { etiqueta: string; valor: string; detalle: string; tono: "rose" | "emerald" | "slate"; clase?: string }) {
  const color = tono === "rose" ? "text-rose-600" : tono === "emerald" ? "text-emerald-700" : "text-slate-700";
  return (
    <div className={`min-w-0 rounded-2xl border border-slate-200 bg-white px-3.5 py-3 shadow-sm sm:px-5 sm:py-4 ${clase}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{etiqueta}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums [overflow-wrap:anywhere] sm:text-xl ${color}`}>{valor}</p>
      <p className="text-[11px] text-slate-400">{detalle}</p>
    </div>
  );
}

function DetalleAjuste({ id, onClose, onCambio }: { id: string; onClose: () => void; onCambio: () => void }) {
  const me = useUsuario();
  const [recarga, setRecarga] = useState(0);
  const det = useListaCacheada<AjusteDetalle>(`/api/inventario/ajustes/${id}`, recarga);
  const a = det.cargando && recarga === 0 ? null : det.datos;
  const [accion, setAccion] = useState<"" | "rechazar" | "anular">("");
  const [aprobando, setAprobando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listo = () => { setAccion(""); onCambio(); setRecarga((k) => k + 1); };
  async function aprobar() {
    if (!a) return;
    setAprobando(true);
    setError(null);
    try {
      await apiFetch(`/api/inventario/ajustes/${a.id}/aprobar`, { method: "POST", body: "{}" });
      listo();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAprobando(false);
    }
  }

  if (det.error) return <ModalDocumento titulo="Documento" onClose={onClose} ancho="max-w-md"><p className="text-sm text-rose-700">No se encontró el documento.</p></ModalDocumento>;
  if (!a) return <ModalDocumento titulo="Documento" onClose={onClose} ancho="max-w-md"><div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div></ModalDocumento>;

  const e = ESTADO_AJUSTE[a.estado];
  const perdida = a.tipo === "perdida";
  const aplicado = a.estado === "aplicado" || a.estado === "anulado";
  const conConteo = a.items.some((i) => i.modo === "conteo");
  // Perfil: aprobar / rechazar → "aprobar ajustes y pérdidas"; anular → "ajustes de inventario".
  const puedeAprobar = tienePermiso(me, "aprobar_perdidas");
  const puedeAnular = tienePermiso(me, "ajustes_inventario") && a.estado === "aplicado" && a.motivo !== "apertura";
  return (
    <>
      <ModalDocumento
        titulo={<><span className="font-mono">{a.numero}</span><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${e.clase}`}>{e.label}</span></>}
        subtitulo={<>{perdida ? "Pérdida" : "Ajuste de inventario"} · {motivoAjuste(a.motivo)} · {a.deposito.nombre} ({a.deposito.sucursal})</>}
        onClose={onClose}
        footer={
          <>
            {error ? <p className="mr-auto text-xs font-medium text-rose-600 max-sm:basis-full">{error}</p> : null}
            {puedeAnular ? (
              <button onClick={() => setAccion("anular")} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3.5 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 max-sm:min-h-11 max-sm:flex-1">
                <X className="h-4 w-4" /> Anular
              </button>
            ) : null}
            {puedeAprobar && a.estado === "pendiente" ? (
              <>
                <button onClick={() => setAccion("rechazar")} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3.5 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 max-sm:min-h-11 max-sm:flex-1">Rechazar</button>
                <button onClick={aprobar} disabled={aprobando} className={`${BOTON_PRIMARIO} max-sm:min-h-11 max-sm:flex-[2]`} style={{ backgroundColor: TEAL }}>
                  {aprobando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Aprobar y aplicar
                </button>
              </>
            ) : (
              <button onClick={onClose} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:flex-1`}>Cerrar</button>
            )}
          </>
        }>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-slate-100 bg-slate-50/50 p-4 sm:grid-cols-4">
          <Dato etiqueta="Cargado por">{a.usuario_nombre ?? "—"}<span className="block text-[11px] text-slate-400">{fechaHora(a.created_at)}</span></Dato>
          {a.aplicado_at ? <Dato etiqueta="Aplicado por">{a.aplicado_por_nombre ?? "—"}<span className="block text-[11px] text-slate-400">{fechaHora(a.aplicado_at)}</span></Dato> : null}
          {aplicado ? (
            <Dato etiqueta="Valor al costo">
              <span className={Number(a.valor_entrada) - Number(a.valor_salida) < 0 ? "font-semibold text-red-600" : "font-semibold text-emerald-700"}>
                {gs(Number(a.valor_entrada) - Number(a.valor_salida))}
              </span>
            </Dato>
          ) : null}
          {a.estado === "rechazado" ? <Dato etiqueta="Rechazado por">{a.rechazado_por_nombre}<span className="block text-[11px] text-slate-400">{a.rechazado_at ? fechaHora(a.rechazado_at) : ""}</span></Dato> : null}
          {a.estado === "anulado" ? <Dato etiqueta="Anulado por">{a.anulado_por_nombre}<span className="block text-[11px] text-slate-400">{a.anulado_at ? fechaHora(a.anulado_at) : ""}</span></Dato> : null}
        </div>
        {a.detalle ? <p className="mt-3 text-sm text-slate-700"><span className="text-slate-400">Detalle:</span> {a.detalle}</p> : null}
        {a.estado === "pendiente" ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            Todavía no movió stock. {puedeAprobar ? "Al aprobarla se descuenta del depósito." : "Alguien con permiso para aprobar pérdidas tiene que aprobarla."}
          </p>
        ) : null}
        {a.rechazado_motivo ? <p className="mt-3 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-xs text-rose-700"><strong>Rechazado:</strong> {a.rechazado_motivo}</p> : null}
        {a.anulado_motivo ? <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600"><strong>Anulado:</strong> {a.anulado_motivo}. El stock volvió a como estaba.</p> : null}

        {/* Celular: cada producto es una tarjeta; desde sm, la tabla. */}
        <ul className="mt-4 space-y-2 sm:hidden">
          {a.items.map((i) => {
            const dif = Number(i.diferencia);
            const lotes = i.lotes?.filter((l) => l.numero) ?? [];
            const loteTxt = i.lote_actual ?? i.lote_numero;
            return (
              <li key={i.id} className="rounded-xl border border-slate-200 px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium leading-snug text-slate-800 [overflow-wrap:anywhere]">{i.producto_nombre}</p>
                    <p className="font-mono text-[11px] text-slate-400">{i.producto_sku}</p>
                  </div>
                  <p className={`shrink-0 text-right font-semibold tabular-nums ${dif > 0 ? "text-emerald-700" : dif < 0 ? "text-red-600" : "text-slate-400"}`}>
                    {i.modo === "conteo" && !aplicado ? <span className="text-xs font-medium">al aprobar</span> : `${dif > 0 ? "+" : dif < 0 ? "−" : ""}${cant(Math.abs(dif))}`}
                  </p>
                </div>
                {i.nota ? <p className="mt-1 text-[11px] text-slate-500">{i.nota}</p> : null}
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  {conConteo ? (
                    <>
                      <div><dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Sistema</dt><dd className="tabular-nums text-slate-700">{i.cantidad_sistema == null ? "—" : cant(i.cantidad_sistema)}</dd></div>
                      <div><dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Contado</dt><dd className="tabular-nums text-slate-700">{i.cantidad_contada == null ? "—" : cant(i.cantidad_contada)}</dd></div>
                    </>
                  ) : null}
                  <div><dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Costo</dt><dd className="tabular-nums text-slate-700">{gs(i.costo_unitario)}</dd></div>
                  {aplicado ? <div><dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Valor</dt><dd className={`font-semibold tabular-nums ${Number(i.valor) < 0 ? "text-red-600" : "text-slate-700"}`}>{gs(i.valor)}</dd></div> : null}
                  {lotes.length || loteTxt || i.vencimiento ? (
                    <div className="col-span-2 min-w-0">
                      <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Lote</dt>
                      <dd className="text-slate-600 [overflow-wrap:anywhere]">
                        {lotes.length ? lotes.map((l) => <span key={`${l.lote_id}`} className="block"><span className="font-mono">{l.numero}</span> · {cant(l.cantidad)} · vence {dia(l.vencimiento)}</span>)
                          : <>{loteTxt ? <span className="font-mono">{loteTxt}</span> : null}{loteTxt && i.vencimiento ? " · " : ""}{i.vencimiento ? `vence ${dia(i.vencimiento)}` : ""}</>}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 max-sm:hidden">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead className="bg-slate-50/70 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2">Producto</th>
                {conConteo ? <th className="px-3 py-2 text-right">Sistema</th> : null}
                {conConteo ? <th className="px-3 py-2 text-right">Contado</th> : null}
                <th className="px-3 py-2 text-right">{aplicado ? "Diferencia" : perdida ? "Cantidad" : "Diferencia"}</th>
                <th className="px-3 py-2">Lote</th>
                <th className="px-3 py-2 text-right">Costo</th>
                {aplicado ? <th className="px-3 py-2 text-right">Valor</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {a.items.map((i) => {
                const dif = Number(i.diferencia);
                const lotes = i.lotes?.filter((l) => l.numero) ?? [];
                return (
                  <tr key={i.id} className="align-top">
                    <td className="px-3 py-2"><p className="font-medium text-slate-800">{i.producto_nombre}</p><p className="font-mono text-[11px] text-slate-400">{i.producto_sku}</p>{i.nota ? <p className="text-[11px] text-slate-500">{i.nota}</p> : null}</td>
                    {conConteo ? <td className="px-3 py-2 text-right tabular-nums text-slate-600">{i.cantidad_sistema == null ? "—" : cant(i.cantidad_sistema)}</td> : null}
                    {conConteo ? <td className="px-3 py-2 text-right tabular-nums text-slate-600">{i.cantidad_contada == null ? "—" : cant(i.cantidad_contada)}</td> : null}
                    <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums ${dif > 0 ? "text-emerald-700" : dif < 0 ? "text-red-600" : "text-slate-400"}`}>
                      {i.modo === "conteo" && !aplicado ? "al aprobar" : `${dif > 0 ? "+" : dif < 0 ? "−" : ""}${cant(Math.abs(dif))}`}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {lotes.length ? lotes.map((l) => <span key={`${l.lote_id}`} className="block"><span className="font-mono">{l.numero}</span> · {cant(l.cantidad)} · vence {dia(l.vencimiento)}</span>)
                        : i.lote_numero || i.lote_actual ? <span className="font-mono">{i.lote_actual ?? i.lote_numero}</span> : i.vencimiento ? `vence ${dia(i.vencimiento)}` : "—"}
                      {i.vencimiento && (i.lote_actual || i.lote_numero) ? <span className="block">vence {dia(i.vencimiento)}</span> : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-slate-600">{gs(i.costo_unitario)}</td>
                    {aplicado ? <td className={`whitespace-nowrap px-3 py-2 text-right text-xs font-semibold tabular-nums ${Number(i.valor) < 0 ? "text-red-600" : "text-slate-700"}`}>{gs(i.valor)}</td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ModalDocumento>

      {accion ? (
        <PedirMotivo
          titulo={accion === "anular" ? `Anular ${a.numero}` : `Rechazar ${a.numero}`}
          confirmar={accion === "anular" ? "Anular" : "Rechazar"}
          etiqueta={accion === "anular" ? "Motivo de la anulación" : "Por qué se rechaza"}
          descripcion={accion === "anular"
            ? <>Se revierte lo que movió: lo que entró sale del mismo lote y lo que salió vuelve a sus lotes. Si ya se vendió o trasladó, no se puede.</>
            : <>La pérdida no mueve stock y queda registrada como rechazada.</>}
          onClose={() => setAccion("")}
          onConfirmar={async (motivo) => {
            await apiFetch(`/api/inventario/ajustes/${a.id}/${accion}`, { method: "POST", body: JSON.stringify({ motivo }) });
            listo();
          }} />
      ) : null}
    </>
  );
}
