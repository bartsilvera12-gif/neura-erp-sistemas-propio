"use client";

/**
 * /inventario/traslados — Traslados entre depósitos y sucursales con su NOTA DE REMISIÓN.
 *   · pestañas En tránsito / Recibidos / Anulados / Todos, filtro por depósito y búsqueda
 *   · detalle (?ver=<id>): origen → destino, transporte, productos con sus lotes, diferencias
 *   · recibir en destino (con diferencias documentadas si llegó menos), anular si no se
 *     recibió (vuelve todo al origen) y descargar la remisión en PDF
 */
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCircle2, FileDown, Loader2, PackageCheck, Plus, Search, Truck, X } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { descargarArchivo } from "@/erp2/lib/api/client-blob";
import { tienePermiso, useUsuario } from "@/erp2/lib/sesion/ContextoUsuario";
import { Select } from "@/erp2/components/Select";
import { BarraFiltros } from "@/erp2/components/EncabezadoPagina";
import { TablaTarjetas, useVistaTarjetas, type ColumnaTabla } from "@/erp2/components/TablaResponsive";
import { invalidarLista, useListaCacheada } from "@/erp2/modules/inventario/lista-cache";
import { hayVariosDepositos, invalidarDepositos, opcionesDepositos, useDepositos } from "@/erp2/modules/inventario/depositos";
import {
  ESTADO_TRASLADO, cant, dia, fechaHora, gs, motivoTraslado,
  type FilaTraslado, type ItemTraslado, type TrasladoDetalle,
} from "@/erp2/modules/inventario/documentos";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, Cabecera, Dato, ET, INPUT, INPUT_FILTRO, ModalDocumento, Paginador, PedirMotivo, Pestanas, TEAL } from "@/erp2/modules/inventario/ui";

const POR_PAGINA = 25;
type Pagina = { rows: FilaTraslado[]; total: number; en_transito: number };

const bajarRemision = (t: FilaTraslado) => void descargarArchivo(`/api/inventario/traslados/${t.id}/remision`, `remision-${t.remision_numero}.pdf`);

/** Celular (< 768 px): cada traslado es una tarjeta (la tabla de escritorio queda igual). */
const columnasMovil: ColumnaTabla<FilaTraslado>[] = [
  {
    key: "ruta", titulo: "Origen → destino", movil: "titulo",
    celda: (t) => <>{t.origen.nombre} <ArrowRight className="inline h-3.5 w-3.5 text-slate-400" /> {t.destino.nombre}</>,
  },
  { key: "numero", titulo: "Traslado", movil: "subtitulo", celda: (t) => t.numero },
  { key: "unidades", titulo: "Unidades", movil: "valor", celda: (t) => `${cant(t.total_unidades)} u.` },
  { key: "items", titulo: "Productos", movil: "dato", celda: (t) => `${t.total_items} ${t.total_items === 1 ? "producto" : "productos"}` },
  {
    key: "estado", titulo: "Estado", movil: "chip",
    celda: (t) => {
      const e = ESTADO_TRASLADO[t.estado];
      return (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${e.clase}`}>{e.label}</span>
          {Number(t.diferencia_unidades) > 0 ? <span className="text-[11px] text-orange-600">Faltaron {cant(t.diferencia_unidades)}</span> : null}
        </span>
      );
    },
  },
  { key: "fecha", titulo: "Fecha", movil: "dato", celda: (t) => dia(t.fecha_inicio) },
  { key: "valor", titulo: "Valor al costo", movil: "detalle", celda: (t) => <span className="tabular-nums">{gs(t.valor_costo)}</span> },
  { key: "remision", titulo: "Remisión", movil: "detalle", celda: (t) => <span className="font-mono">{t.remision_numero}</span> },
  { key: "usuario", titulo: "Enviado por", movil: "detalle", celda: (t) => t.usuario_nombre ?? "—" },
  {
    key: "sucursal", titulo: "Sucursales", movil: "detalle",
    celda: (t) => (t.origen.sucursal === t.destino.sucursal ? t.origen.sucursal : `${t.origen.sucursal} → ${t.destino.sucursal}`),
  },
  {
    key: "acc", titulo: "", movil: "acciones",
    celda: (t) => (
      <button type="button" onClick={() => bajarRemision(t)} aria-label="Descargar nota de remisión"
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 active:bg-slate-100">
        <FileDown className="h-4 w-4" />
      </button>
    ),
  },
];

export default function TrasladosPage() {
  return (
    <Suspense fallback={null}>
      <Traslados />
    </Suspense>
  );
}

function Traslados() {
  const router = useRouter();
  const sp = useSearchParams();
  const ver = sp.get("ver");
  const esAdmin = tienePermiso(useUsuario(), "crear_traslados"); // perfil: crear traslados
  const deps = useDepositos();
  const [estado, setEstado] = useState(sp.get("estado") ?? "");
  const [deposito, setDeposito] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [pagina, setPagina] = useState(1);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => { setQ(busqueda.trim()); setPagina(1); }, 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  const url = useMemo(() => {
    const p = new URLSearchParams({ pagina: String(pagina), por_pagina: String(POR_PAGINA) });
    if (estado) p.set("estado", estado);
    if (deposito) p.set("deposito", deposito);
    if (q) p.set("q", q);
    return `/api/inventario/traslados?${p}`;
  }, [pagina, estado, deposito, q]);
  const lista = useListaCacheada<Pagina>(url, recarga);
  const rows = lista.error ? [] : lista.datos?.rows ?? [];
  const total = lista.error ? 0 : lista.datos?.total ?? 0;
  const enTransito = lista.datos?.en_transito ?? 0;

  const abrir = (id: string | null) => router.replace(id ? `/inventario/traslados?ver=${id}` : "/inventario/traslados", { scroll: false });
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
      <Cabecera volver={{ href: "/inventario/panel", label: "Inventario" }} kicker="Inventario · Documentos" titulo="Traslados" subtitulo="Mercadería que se mueve entre depósitos y sucursales, con su nota de remisión">
        {esAdmin ? (
          <Link href="/inventario/traslados/nuevo" className={BOTON_PRIMARIO} style={{ backgroundColor: TEAL }}>
            <Plus className="h-4 w-4" /> Nuevo traslado
          </Link>
        ) : null}
      </Cabecera>

      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: `${TEAL}33` }}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-3 sm:px-5" style={{ borderColor: `${TEAL}22`, background: `linear-gradient(to right, ${TEAL}0d, transparent)` }}>
          <div className="min-w-0 max-md:w-full">
            <Pestanas valor={estado} onChange={(v) => { setEstado(v); setPagina(1); }}
              opciones={[
                { id: "en_transito", label: "En tránsito", badge: enTransito },
                { id: "recibido", label: "Recibidos" },
                { id: "anulado", label: "Anulados" },
                { id: "", label: "Todos" },
              ]} />
          </div>
          {/* Celular: búsqueda + "Filtros" (hoja inferior con el depósito); desde md, en línea. */}
          <BarraFiltros plano className="max-md:w-full" activos={deposito ? 1 : 0} onLimpiar={() => { setDeposito(""); setPagina(1); }}
            busqueda={
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="N°, remisión, producto, chofer…" type="search" enterKeyHint="search" aria-label="Buscar traslados"
                  className={`${INPUT_FILTRO} w-full pl-9 max-md:h-11 md:w-64`} />
              </div>
            }>
            {hayVariosDepositos(deps.datos) ? (
              <Select value={deposito} onChange={(v) => { setDeposito(v); setPagina(1); }} minWidth={200} etiqueta="Depósito" className="max-sm:!min-w-0"
                options={[["", "Todos los depósitos"], ...opcionesDepositos(deps.datos, { soloActivos: false })]} />
            ) : null}
          </BarraFiltros>
        </div>

        {vistaTarjetas ? (
          <TablaTarjetas
            filas={rows}
            columnas={columnasMovil}
            claveFila={(t) => t.id}
            onFila={(t) => abrir(t.id)}
            cargando={lista.cargando}
            vacio={
              <div className="px-4 py-14 text-center">
                {lista.cargando ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /> : (
                  <>
                    <div className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl border" style={{ backgroundColor: `${TEAL}14`, borderColor: `${TEAL}33` }}>
                      <Truck className="h-6 w-6" style={{ color: TEAL }} />
                    </div>
                    <p className="text-sm font-semibold text-slate-700">{estado === "en_transito" ? "No hay traslados en tránsito" : "No hay traslados"}</p>
                    <p className="mt-1 text-xs text-slate-500">Un traslado saca la mercadería de un depósito y la deja en tránsito hasta que se recibe en el otro.</p>
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
                <th className="px-5 py-3 font-semibold">Traslado</th>
                <th className="px-3 py-3 font-semibold">Fecha</th>
                <th className="px-3 py-3 font-semibold">Origen → destino</th>
                <th className="px-3 py-3 text-right font-semibold">Unidades</th>
                <th className="px-3 py-3 text-right font-semibold">Valor al costo</th>
                <th className="px-3 py-3 font-semibold">Estado</th>
                <th className="w-px px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lista.cargando && rows.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center">
                    <div className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl border" style={{ backgroundColor: `${TEAL}14`, borderColor: `${TEAL}33` }}>
                      <Truck className="h-6 w-6" style={{ color: TEAL }} />
                    </div>
                    <p className="text-sm font-semibold text-slate-700">{estado === "en_transito" ? "No hay traslados en tránsito" : "No hay traslados"}</p>
                    <p className="mt-1 text-xs text-slate-500">Un traslado saca la mercadería de un depósito y la deja en tránsito hasta que se recibe en el otro.</p>
                  </td>
                </tr>
              ) : rows.map((t) => {
                const e = ESTADO_TRASLADO[t.estado];
                return (
                  <tr key={t.id} onClick={() => abrir(t.id)} className={`cursor-pointer transition-colors hover:bg-[var(--brand-50)] ${lista.cargando ? "opacity-60" : ""}`}>
                    <td className="px-5 py-3">
                      <p className="font-mono text-sm font-semibold text-slate-900">{t.numero}</p>
                      <p className="font-mono text-[11px] text-slate-400">Remisión {t.remision_numero}</p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-600">
                      {dia(t.fecha_inicio)}
                      <span className="block text-[11px] text-slate-400">{t.usuario_nombre}</span>
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <span className="flex items-center gap-1.5">
                        <span className="min-w-0 truncate font-medium text-slate-700">{t.origen.nombre}</span>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="min-w-0 truncate font-medium text-slate-700">{t.destino.nombre}</span>
                      </span>
                      <span className="block truncate text-[11px] text-slate-400">{t.origen.sucursal === t.destino.sucursal ? t.origen.sucursal : `${t.origen.sucursal} → ${t.destino.sucursal}`}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                      <span className="font-semibold text-slate-900">{cant(t.total_unidades)}</span>
                      <span className="block text-[11px] text-slate-400">{t.total_items} {t.total_items === 1 ? "producto" : "productos"}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right text-xs tabular-nums text-slate-700">{gs(t.valor_costo)}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${e.clase}`}>{e.label}</span>
                      {Number(t.diferencia_unidades) > 0 ? <span className="mt-0.5 block text-[11px] text-orange-600">Faltaron {cant(t.diferencia_unidades)}</span> : null}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button type="button" title="Descargar nota de remisión" onClick={(ev) => { ev.stopPropagation(); void descargarArchivo(`/api/inventario/traslados/${t.id}/remision`, `remision-${t.remision_numero}.pdf`); }}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-[var(--brand-50)] hover:text-[var(--brand)]">
                        <FileDown className="h-4 w-4" />
                      </button>
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

      {ver ? <DetalleTraslado id={ver} onClose={() => abrir(null)} onCambio={cambio} /> : null}
    </div>
  );
}

function DetalleTraslado({ id, onClose, onCambio }: { id: string; onClose: () => void; onCambio: () => void }) {
  const [recarga, setRecarga] = useState(0);
  const det = useListaCacheada<TrasladoDetalle>(`/api/inventario/traslados/${id}`, recarga);
  const t = det.cargando && recarga === 0 ? null : det.datos;
  const [recibiendo, setRecibiendo] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [bajando, setBajando] = useState(false);

  async function pdf() {
    if (!t) return;
    setBajando(true);
    try { await descargarArchivo(`/api/inventario/traslados/${t.id}/remision`, `remision-${t.remision_numero}.pdf`); } catch { /* best-effort */ } finally { setBajando(false); }
  }
  const listo = () => { setRecibiendo(false); setAnulando(false); onCambio(); setRecarga((k) => k + 1); };

  if (det.error) {
    return (
      <ModalDocumento titulo="Traslado" onClose={onClose} ancho="max-w-md">
        <p className="text-sm text-rose-700">No se encontró el traslado.</p>
      </ModalDocumento>
    );
  }
  if (!t) {
    return (
      <ModalDocumento titulo="Traslado" onClose={onClose} ancho="max-w-md">
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      </ModalDocumento>
    );
  }
  if (recibiendo) return <RecibirTraslado t={t} onClose={() => setRecibiendo(false)} onHecho={listo} />;

  const e = ESTADO_TRASLADO[t.estado];
  const recibido = t.estado === "recibido" || t.estado === "recibido_con_diferencias";
  return (
    <>
      <ModalDocumento
        titulo={<><span className="font-mono">{t.numero}</span><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${e.clase}`}>{e.label}</span></>}
        subtitulo={<>Nota de remisión <span className="font-mono font-semibold">{t.remision_numero}</span> · {motivoTraslado(t.motivo_codigo)}</>}
        onClose={onClose}
        footer={
          <>
            <button onClick={pdf} disabled={bajando} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:flex-1`}>
              {bajando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} <span className="sm:hidden">Remisión (PDF)</span><span className="max-sm:hidden">Nota de remisión (PDF)</span>
            </button>
            {t.puede_anular ? (
              <button onClick={() => setAnulando(true)} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3.5 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 max-sm:min-h-11 max-sm:flex-1">
                <X className="h-4 w-4" /> Anular
              </button>
            ) : null}
            {t.puede_recibir ? (
              <button onClick={() => setRecibiendo(true)} className={`${BOTON_PRIMARIO} max-sm:min-h-11 max-sm:w-full max-sm:basis-full`} style={{ backgroundColor: TEAL }}>
                <PackageCheck className="h-4 w-4 shrink-0" /> <span className="truncate">Recibir en {t.destino.nombre}</span>
              </button>
            ) : null}
          </>
        }>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
          <Punto titulo="Sale de" nombre={t.origen.nombre} sucursal={t.origen.sucursal} direccion={[t.punto_partida, t.ciudad_partida].filter(Boolean).join(", ")} />
          <div className="flex items-center justify-center text-slate-300"><ArrowRight className="h-5 w-5 rotate-90 sm:rotate-0" /></div>
          <Punto titulo="Llega a" nombre={t.destino.nombre} sucursal={t.destino.sucursal} direccion={[t.punto_llegada, t.ciudad_llegada].filter(Boolean).join(", ")} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-slate-100 bg-slate-50/50 p-4 sm:grid-cols-4">
          <Dato etiqueta="Inicio del traslado">{dia(t.fecha_inicio)}</Dato>
          <Dato etiqueta="Llegada estimada">{t.fecha_fin_estimada ? dia(t.fecha_fin_estimada) : "—"}</Dato>
          <Dato etiqueta="Vehículo">{[t.vehiculo_marca, t.vehiculo_chapa].filter(Boolean).join(" · ") || "—"}</Dato>
          <Dato etiqueta="Chofer">{t.chofer_nombre ? `${t.chofer_nombre}${t.chofer_documento ? ` · CI ${t.chofer_documento}` : ""}` : "—"}</Dato>
          {t.transportista_nombre ? <Dato etiqueta="Transportista">{t.transportista_nombre}{t.transportista_ruc ? ` · RUC ${t.transportista_ruc}` : ""}</Dato> : null}
          <Dato etiqueta="Enviado por">{t.usuario_nombre ?? "—"}<span className="block text-[11px] text-slate-400">{fechaHora(t.created_at)}</span></Dato>
          {recibido ? <Dato etiqueta="Recibido por">{t.recibido_por_nombre ?? "—"}<span className="block text-[11px] text-slate-400">{t.recibido_at ? fechaHora(t.recibido_at) : ""}</span></Dato> : null}
          {t.estado === "anulado" ? <Dato etiqueta="Anulado por">{t.anulado_por_nombre ?? "—"}<span className="block text-[11px] text-slate-400">{t.anulado_at ? fechaHora(t.anulado_at) : ""}</span></Dato> : null}
        </div>

        {t.estado === "recibido_con_diferencias" ? (
          <div className="mt-4 flex gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Llegaron {cant(t.diferencia_unidades)} unidades menos ({gs(t.diferencia_valor)} al costo)</p>
              <p className="text-xs">{t.diferencia_motivo}</p>
            </div>
          </div>
        ) : null}
        {t.estado === "anulado" && t.anulado_motivo ? (
          <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600"><strong>Anulado:</strong> {t.anulado_motivo}. La mercadería volvió a {t.origen.nombre}.</p>
        ) : null}

        {/* Celular: cada producto es una tarjeta (lotes debajo); desde sm, la tabla. */}
        <ul className="mt-4 space-y-2 sm:hidden">
          {t.items.map((it) => <TarjetaItem key={it.id} it={it} recibido={recibido} />)}
        </ul>
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 max-sm:hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50/70 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2">Producto</th>
                <th className="px-3 py-2">Lote</th>
                <th className="px-3 py-2 text-right">Enviado</th>
                {recibido ? <th className="px-3 py-2 text-right">Recibido</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {t.items.map((it) => <FilaItem key={it.id} it={it} recibido={recibido} />)}
            </tbody>
          </table>
        </div>
        {t.observacion ? <p className="mt-3 text-xs text-slate-600"><strong>Observación:</strong> {t.observacion}</p> : null}
        {t.recepcion_observacion ? <p className="mt-1 text-xs text-slate-600"><strong>En la recepción:</strong> {t.recepcion_observacion}</p> : null}
        {t.estado === "en_transito" && !t.puede_recibir ? (
          <p className="mt-3 text-xs text-slate-500">Lo recibe un administrador o alguien de {t.destino.sucursal}.</p>
        ) : null}
      </ModalDocumento>

      {anulando ? (
        <PedirMotivo titulo={`Anular ${t.numero}`} confirmar="Anular traslado"
          descripcion={<>Todo vuelve a <strong>{t.origen.nombre}</strong>, a los mismos lotes. La nota de remisión queda anulada.</>}
          onClose={() => setAnulando(false)}
          onConfirmar={async (motivo) => {
            await apiFetch(`/api/inventario/traslados/${t.id}/anular`, { method: "POST", body: JSON.stringify({ motivo }) });
            listo();
          }} />
      ) : null}
    </>
  );
}

function Punto({ titulo, nombre, sucursal, direccion }: { titulo: string; nombre: string; sucursal: string; direccion: string }) {
  return (
    <div className="rounded-xl border border-slate-200 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{titulo}</p>
      <p className="mt-0.5 font-semibold text-slate-900">{nombre}</p>
      <p className="text-xs text-slate-500">{sucursal}</p>
      {direccion ? <p className="mt-0.5 text-[11px] text-slate-400">{direccion}</p> : null}
    </div>
  );
}

function FilaItem({ it, recibido }: { it: ItemTraslado; recibido: boolean }) {
  const u = it.unidad_medida === "Unidad" || !it.unidad_medida ? "" : ` ${it.unidad_medida}`;
  const falta = recibido && Number(it.cantidad_recibida ?? 0) < Number(it.cantidad);
  const conLotes = it.lotes.length > 0;
  return (
    <>
      <tr className="align-top">
        <td className="px-3 py-2">
          <p className="font-medium text-slate-800">{it.producto_nombre}</p>
          <p className="font-mono text-[11px] text-slate-400">{it.producto_sku}</p>
        </td>
        <td className="px-3 py-2 text-xs text-slate-500">{conLotes ? (it.lotes.length === 1 ? (it.lotes[0].lote_numero ? `${it.lotes[0].lote_numero} · vence ${dia(it.lotes[0].vencimiento)}` : "Sin lote") : `${it.lotes.length} lotes`) : "—"}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{cant(it.cantidad)}{u}</td>
        {recibido ? <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums ${falta ? "text-orange-600" : "text-emerald-700"}`}>{cant(it.cantidad_recibida)}{u}</td> : null}
      </tr>
      {it.lotes.length > 1 ? it.lotes.map((l) => (
        <tr key={l.id} className="bg-slate-50/50 text-xs">
          <td className="px-3 py-1.5 pl-6 text-slate-400">↳</td>
          <td className="px-3 py-1.5 text-slate-600">{l.lote_numero ? <><span className="font-mono">{l.lote_numero}</span> · vence {dia(l.vencimiento)}</> : "Sin lote"}</td>
          <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{cant(l.cantidad)}</td>
          {recibido ? <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{cant(l.cantidad_recibida)}</td> : null}
        </tr>
      )) : null}
    </>
  );
}

function TarjetaItem({ it, recibido }: { it: ItemTraslado; recibido: boolean }) {
  const u = it.unidad_medida === "Unidad" || !it.unidad_medida ? "" : ` ${it.unidad_medida}`;
  const falta = recibido && Number(it.cantidad_recibida ?? 0) < Number(it.cantidad);
  const lote1 = it.lotes.length === 1 ? it.lotes[0] : null;
  return (
    <li className="rounded-xl border border-slate-200 px-3 py-2.5">
      <p className="font-medium leading-snug text-slate-800 [overflow-wrap:anywhere]">{it.producto_nombre}</p>
      <p className="font-mono text-[11px] text-slate-400">{it.producto_sku}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
        <div className="min-w-0">
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Enviado</dt>
          <dd className="font-semibold tabular-nums text-slate-900">{cant(it.cantidad)}{u}</dd>
        </div>
        {recibido ? (
          <div className="min-w-0">
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Recibido</dt>
            <dd className={`font-semibold tabular-nums ${falta ? "text-orange-600" : "text-emerald-700"}`}>{cant(it.cantidad_recibida)}{u}</dd>
          </div>
        ) : lote1 ? (
          <div className="min-w-0">
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Lote</dt>
            <dd className="text-xs text-slate-600 [overflow-wrap:anywhere]">{lote1.lote_numero ? <><span className="font-mono">{lote1.lote_numero}</span> · vence {dia(lote1.vencimiento)}</> : "Sin lote"}</dd>
          </div>
        ) : null}
      </dl>
      {recibido && lote1 ? (
        <p className="mt-1.5 text-xs text-slate-600">Lote {lote1.lote_numero ? <><span className="font-mono">{lote1.lote_numero}</span> · vence {dia(lote1.vencimiento)}</> : "sin lote"}</p>
      ) : null}
      {it.lotes.length > 1 ? (
        <ul className="mt-2 divide-y divide-slate-100 rounded-lg bg-slate-50/70 text-xs">
          {it.lotes.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 px-2.5 py-1.5">
              <span className="min-w-0 text-slate-600 [overflow-wrap:anywhere]">{l.lote_numero ? <><span className="font-mono">{l.lote_numero}</span> · vence {dia(l.vencimiento)}</> : "Sin lote"}</span>
              <span className="shrink-0 tabular-nums text-slate-700">{cant(l.cantidad)}{recibido ? <span className="text-slate-400"> → {cant(l.cantidad_recibida)}</span> : null}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Recepción: por defecto llegó todo; se corrige lo que llegó de menos (por lote si tiene). */
function RecibirTraslado({ t, onClose, onHecho }: { t: TrasladoDetalle; onClose: () => void; onHecho: () => void }) {
  // Recibido por ítem (sin lotes) o por lote (traslados_lotes.id).
  const [rec, setRec] = useState<Record<string, string>>(() => {
    const r: Record<string, string> = {};
    for (const it of t.items) {
      if (it.lotes.length) for (const l of it.lotes) r[l.id] = String(Number(l.cantidad));
      else r[it.id] = String(Number(it.cantidad));
    }
    return r;
  });
  const [motivo, setMotivo] = useState("");
  const [obs, setObs] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const num = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(",", ".")));
  const filas = t.items.flatMap((it) => (it.lotes.length ? it.lotes.map((l) => ({ id: l.id, env: Number(l.cantidad) })) : [{ id: it.id, env: Number(it.cantidad) }]));
  const invalido = filas.some((f) => { const n = num(rec[f.id] ?? ""); return !Number.isFinite(n) || n < 0 || n > f.env; });
  const falta = filas.reduce((a, f) => a + Math.max(0, f.env - (Number.isFinite(num(rec[f.id] ?? "")) ? num(rec[f.id]) : f.env)), 0);
  const faltaValor = t.items.reduce((a, it) => {
    const env = Number(it.cantidad);
    const r = it.lotes.length ? it.lotes.reduce((s, l) => s + (num(rec[l.id] ?? "") || 0), 0) : num(rec[it.id] ?? "") || 0;
    return a + Math.max(0, env - r) * Number(it.costo_unitario);
  }, 0);

  async function confirmar() {
    if (invalido || busy || (falta > 0 && !motivo.trim())) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/inventario/traslados/${t.id}/recibir`, {
        method: "POST",
        body: JSON.stringify({
          diferencia_motivo: falta > 0 ? motivo.trim() : null,
          observacion: obs.trim() || null,
          items: t.items.map((it) => it.lotes.length
            ? { item_id: it.id, cantidad_recibida: it.lotes.reduce((s, l) => s + num(rec[l.id]), 0), lotes: it.lotes.map((l) => ({ id: l.id, cantidad_recibida: num(rec[l.id]) })) }
            : { item_id: it.id, cantidad_recibida: num(rec[it.id]) }),
        }),
      });
      onHecho();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const campo = (id: string, env: number, nombre: string) => {
    const n = num(rec[id] ?? "");
    const mal = !Number.isFinite(n) || n < 0 || n > env;
    return (
      <input inputMode="decimal" enterKeyHint="next" aria-label={`Llegó de ${nombre}`} value={rec[id] ?? ""} onChange={(e) => setRec((p) => ({ ...p, [id]: e.target.value.replace(/[^\d.,]/g, "") }))}
        className={`w-24 rounded-lg border px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:ring-2 max-sm:min-h-11 max-sm:w-28 ${mal ? "border-rose-300 focus:ring-rose-100" : n < env ? "border-orange-300 bg-orange-50/50 focus:ring-orange-100" : "border-slate-200 focus:border-[var(--brand)] focus:ring-[var(--brand-100)]"}`} />
    );
  };

  return (
    <ModalDocumento titulo={<>Recibir <span className="font-mono">{t.numero}</span></>} subtitulo={<>Entra a <strong>{t.destino.nombre}</strong> ({t.destino.sucursal}). Corregí solo lo que llegó de menos.</>}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button onClick={onClose} disabled={busy} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:shrink-0`}>Volver</button>
          <button onClick={confirmar} disabled={busy || invalido || (falta > 0 && !motivo.trim())} className={`${BOTON_PRIMARIO} max-sm:min-h-11 max-sm:min-w-0 max-sm:flex-1`} style={{ backgroundColor: TEAL }}>
            {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
            <span className="max-sm:text-left max-sm:leading-tight">{falta > 0 ? `Recibir con diferencia (faltan ${cant(falta)})` : "Confirmar recepción completa"}</span>
          </button>
        </>
      }>
      {/* Celular: cada producto (y cada lote) en una tarjeta con "Enviado" y el campo "Llegó" de 44 px. */}
      <ul className="space-y-2 sm:hidden">
        {t.items.map((it) => (
          <li key={it.id} className="rounded-xl border border-slate-200 px-3 py-2.5">
            <p className="font-medium leading-snug text-slate-800 [overflow-wrap:anywhere]">{it.producto_nombre}</p>
            <p className="font-mono text-[11px] text-slate-400">{it.producto_sku}</p>
            {it.lotes.length ? (
              <ul className="mt-2 divide-y divide-slate-100">
                {it.lotes.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 py-1.5">
                    <div className="min-w-0 text-xs">
                      <p className="text-slate-600 [overflow-wrap:anywhere]">{l.lote_numero ? <><span className="font-mono font-semibold">{l.lote_numero}</span> · vence {dia(l.vencimiento)}</> : "Sin lote"}</p>
                      <p className="text-slate-400">Enviado <span className="font-semibold tabular-nums text-slate-700">{cant(l.cantidad)}</span></p>
                    </div>
                    {campo(l.id, Number(l.cantidad), `${it.producto_nombre} lote ${l.lote_numero ?? "sin lote"}`)}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-400">Enviado <span className="font-semibold tabular-nums text-slate-700">{cant(it.cantidad)}</span></p>
                {campo(it.id, Number(it.cantidad), it.producto_nombre)}
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="overflow-hidden rounded-xl border border-slate-200 max-sm:hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50/70 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2">Producto / lote</th>
              <th className="px-3 py-2 text-right">Enviado</th>
              <th className="px-3 py-2 text-right">Llegó</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {t.items.map((it) => it.lotes.length ? (
              [
                <tr key={it.id}><td colSpan={3} className="px-3 pt-2 font-medium text-slate-800">{it.producto_nombre} <span className="font-mono text-[11px] text-slate-400">{it.producto_sku}</span></td></tr>,
                ...it.lotes.map((l) => (
                  <tr key={l.id} className="text-xs">
                    <td className="px-3 py-1.5 pl-6 text-slate-600">{l.lote_numero ? <><span className="font-mono">{l.lote_numero}</span> · vence {dia(l.vencimiento)}</> : "Sin lote"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{cant(l.cantidad)}</td>
                    <td className="px-3 py-1.5 text-right">{campo(l.id, Number(l.cantidad), `${it.producto_nombre} lote ${l.lote_numero ?? "sin lote"}`)}</td>
                  </tr>
                )),
              ]
            ) : (
              <tr key={it.id}>
                <td className="px-3 py-2"><p className="font-medium text-slate-800">{it.producto_nombre}</p><p className="font-mono text-[11px] text-slate-400">{it.producto_sku}</p></td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{cant(it.cantidad)}</td>
                <td className="px-3 py-2 text-right">{campo(it.id, Number(it.cantidad), it.producto_nombre)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {falta > 0 ? (
        <div className="mt-4 space-y-2 rounded-xl border border-orange-200 bg-orange-50/60 p-4">
          <p className="text-sm font-semibold text-orange-800">Faltan {cant(falta)} unidades ({gs(faltaValor)} al costo)</p>
          <p className="text-xs text-orange-700">Lo que no llegó queda documentado en el traslado como diferencia (no vuelve al origen).</p>
          <label className="block">
            <span className={ET}>Motivo de la diferencia *</span>
            <input enterKeyHint="next" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="Ej. 2 cajas llegaron rotas" className={INPUT} />
          </label>
        </div>
      ) : null}
      <label className="mt-4 block">
        <span className={ET}>Observación de la recepción <span className="font-normal text-slate-400">(opcional)</span></span>
        <input enterKeyHint="done" value={obs} onChange={(e) => setObs(e.target.value)} maxLength={1000} className={INPUT} />
      </label>
      {error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
    </ModalDocumento>
  );
}
