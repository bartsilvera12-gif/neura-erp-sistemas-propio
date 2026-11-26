"use client";

/**
 * Sección "Stock por depósito" de la ficha del producto: cuánto hay en cada depósito (y en
 * tránsito), y para productos con lotes, los lotes de CADA depósito (Lote · Vence ·
 * Unidades · Estado) con "Dar de baja" (queda como pérdida PE-). Desde cada depósito:
 * ajustar, trasladar o ver su kardex. El stock no se edita acá: solo con documentos.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeftRight, ClipboardCheck, History, Loader2, PackageX, Truck } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { invalidarLista, useListaCacheada } from "@/erp2/modules/inventario/lista-cache";
import { urlStock } from "@/erp2/modules/inventario/ficha-cache";
import { ALTO_MAX_MODAL, CapaModal } from "@/erp2/components/CapaModal";
import { Select } from "@/erp2/components/Select";
import { parseNumero } from "@/erp2/lib/imports/consolidacion-productos";
import {
  chipEstado, diasAlerta, diasHasta, fechaCorta, textoDias,
  type StockProducto,
} from "@/erp2/modules/inventario/vencimientos";

const fmt = (n: number) => Number(n).toLocaleString("es-PY", { maximumFractionDigits: 3 });
const INPUT = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";
const ET = "mb-1 block text-xs font-medium text-slate-600";

export function StockDepositosProducto({
  productoId,
  unidad,
  puedeEditar,
}: {
  productoId: string;
  unidad: string;
  /** ADMIN y producto activo: ajustar, trasladar, dar de baja */
  puedeEditar: boolean;
}) {
  const [baja, setBaja] = useState<{ id: string; numero: string; vencimiento: string; cantidad: number; deposito: string } | null>(null);
  const [alerta, setAlerta] = useState(30);
  const [recarga, setRecarga] = useState(0);
  const lista = useListaCacheada<StockProducto>(urlStock(productoId), recarga);
  const datos = lista.cargando && recarga === 0 ? null : lista.datos;

  useEffect(() => setAlerta(diasAlerta()), []);

  if (lista.error) return <p className="text-xs text-rose-600">No se pudo cargar el stock por depósito.</p>;
  if (!datos) return <p className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando stock…</p>;

  const u = unidad === "Unidad" ? "u." : unidad;
  const varias = new Set(datos.depositos.map((d) => d.sucursal_id)).size > 1;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">
          Total <span className="tabular-nums">{fmt(datos.stock_total)}</span> {u}
        </span>
        {Number(datos.en_transito) > 0 ? (
          <Link href="/inventario/traslados?estado=en_transito" className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100">
            <Truck className="h-3 w-3" /> {fmt(datos.en_transito)} {u} en tránsito
          </Link>
        ) : null}
      </div>

      <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
        {datos.depositos.map((d) => {
          const lotes = d.lotes;
          return (
            <div key={d.deposito_id} className={`px-3 py-2.5 ${!d.activo ? "bg-slate-50/60" : ""}`}>
              {/* Celular: depósito + cantidad arriba y las acciones (44 px, con texto) en su propia fila. */}
              <div className="flex flex-wrap items-center justify-between gap-x-3 max-sm:gap-y-1.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">
                    {d.deposito}
                    {d.es_principal ? <span className="ml-1.5 rounded bg-[var(--brand-50)] px-1.5 py-0.5 align-middle text-[10px] font-semibold text-[var(--brand)]">Principal</span> : null}
                    {!d.activo ? <span className="ml-1.5 rounded bg-slate-200 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-slate-500">Inactivo</span> : null}
                  </p>
                  {varias ? <p className="text-[11px] text-slate-400">{d.sucursal}</p> : null}
                </div>
                <span className={`shrink-0 text-base font-bold tabular-nums sm:mr-1 ${Number(d.cantidad) > 0 ? "text-slate-900" : "text-slate-300"}`}>
                  {fmt(d.cantidad)} <span className="text-[11px] font-normal text-slate-400">{u}</span>
                </span>
                <div className="flex shrink-0 items-center gap-1 max-sm:-mx-1 max-sm:w-full max-sm:flex-wrap sm:-ml-2">
                  <Accion href={`/inventario/movimientos?producto=${productoId}&deposito=${d.deposito_id}`} titulo="Kardex de este depósito" corto="Kardex"><History className="h-3.5 w-3.5" /></Accion>
                  {puedeEditar && d.activo ? (
                    <>
                      <Accion href={`/inventario/ajustes/nuevo?tipo=ajuste&deposito=${d.deposito_id}&producto=${productoId}`} titulo="Ajustar (conteo físico)" corto="Ajustar"><ClipboardCheck className="h-3.5 w-3.5" /></Accion>
                      {Number(d.cantidad) > 0 ? (
                        <Accion href={`/inventario/traslados/nuevo?origen=${d.deposito_id}&producto=${productoId}`} titulo="Trasladar a otro depósito" corto="Trasladar"><ArrowLeftRight className="h-3.5 w-3.5" /></Accion>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>

              {datos.controla_lotes && (lotes.length > 0 || Number(d.sin_lote) !== 0) ? (
                <div className="mt-2 overflow-hidden rounded-lg border border-slate-100">
                  {/* Celular: cada lote en una fila-tarjeta; desde sm, la tabla. */}
                  <ul className="divide-y divide-slate-100 sm:hidden">
                    {lotes.map((l) => {
                      const dias = diasHasta(l.vencimiento, datos.hoy);
                      const chip = chipEstado(dias, alerta);
                      return (
                        <li key={l.id} className="px-2.5 py-2 text-xs">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-mono font-semibold text-slate-800 [overflow-wrap:anywhere]">{l.numero}</p>
                              <p className="text-[11px] text-slate-400 [overflow-wrap:anywhere]">{l.compra_numero ? `${l.compra_numero}${l.proveedor_nombre ? ` · ${l.proveedor_nombre}` : ""}` : l.origen === "traslado" ? "Llegó por traslado" : "Ajuste de inventario"}</p>
                            </div>
                            <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{fmt(l.cantidad)}</p>
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                            <span className="flex flex-wrap items-center gap-1.5 text-slate-600">
                              Vence {fechaCorta(l.vencimiento)} <span className="text-[11px] text-slate-400">· {textoDias(dias)}</span>
                              <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${chip.clase}`}>{chip.texto}</span>
                            </span>
                            {puedeEditar ? (
                              <button type="button" onClick={() => setBaja({ id: l.id, numero: l.numero, vencimiento: l.vencimiento, cantidad: l.cantidad, deposito: d.deposito })}
                                className="min-h-11 whitespace-nowrap rounded-lg border border-slate-200 px-3 text-[13px] font-semibold text-slate-600 transition active:bg-rose-50 active:text-rose-700">
                                Dar de baja
                              </button>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <table className="w-full text-left text-xs max-sm:hidden">
                    <tbody className="divide-y divide-slate-100">
                      {lotes.map((l) => {
                        const dias = diasHasta(l.vencimiento, datos.hoy);
                        const chip = chipEstado(dias, alerta);
                        return (
                          <tr key={l.id}>
                            <td className="px-2.5 py-1.5">
                              <p className="font-mono font-semibold text-slate-800">{l.numero}</p>
                              <p className="text-[10px] text-slate-400">{l.compra_numero ? `${l.compra_numero}${l.proveedor_nombre ? ` · ${l.proveedor_nombre}` : ""}` : l.origen === "traslado" ? "Llegó por traslado" : "Ajuste de inventario"}</p>
                            </td>
                            <td className="whitespace-nowrap px-2.5 py-1.5 text-slate-700">
                              {fechaCorta(l.vencimiento)}
                              <span className="block text-[10px] text-slate-400">{textoDias(dias)}</span>
                            </td>
                            <td className="px-2.5 py-1.5 text-right font-semibold tabular-nums text-slate-900">{fmt(l.cantidad)}</td>
                            <td className="px-2.5 py-1.5 text-center">
                              <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${chip.clase}`}>{chip.texto}</span>
                            </td>
                            {puedeEditar ? (
                              <td className="w-px px-2.5 py-1.5 text-right">
                                <button type="button" onClick={() => setBaja({ id: l.id, numero: l.numero, vencimiento: l.vencimiento, cantidad: l.cantidad, deposito: d.deposito })}
                                  className="whitespace-nowrap rounded-md border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700">
                                  Dar de baja
                                </button>
                              </td>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {Number(d.sin_lote) > 0 ? (
                    <p className="border-t border-slate-100 bg-slate-50/60 px-2.5 py-1.5 text-[11px] text-slate-600"><strong>{fmt(d.sin_lote)} {u} sin lote</strong> (stock de antes de activar lotes, de una importación o de un ajuste)</p>
                  ) : Number(d.sin_lote) < 0 ? (
                    <p className="border-t border-slate-100 bg-amber-50/60 px-2.5 py-1.5 text-[11px] text-amber-800"><strong>{fmt(-d.sin_lote)} {u} vendidas sin lote vigente</strong>: los lotes dicen más de lo que hay. Revisá y dá de baja lo que falte.</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-500">
        El stock no se edita a mano: entra con compras y ajustes, sale con ventas y pérdidas, y se mueve entre depósitos con traslados.
        {datos.controla_lotes ? " La caja vende primero el lote que vence antes (del depósito de la caja) y no vende los vencidos." : ""}
      </p>

      {baja ? (
        <DarDeBajaLote
          lote={{ ...baja, producto: undefined }}
          deposito={baja.deposito}
          unidad={u}
          onClose={() => setBaja(null)}
          onHecho={() => {
            setBaja(null);
            invalidarLista("/api/productos");
            invalidarLista("/api/inventario/movimientos");
            invalidarLista("/api/inventario/vencimientos");
            invalidarLista("/api/inventario/ajustes");
            setRecarga((k) => k + 1);
          }}
        />
      ) : null}
    </div>
  );
}

function Accion({ href, titulo, corto, children }: { href: string; titulo: string; corto: string; children: React.ReactNode }) {
  return (
    <Link href={href} title={titulo} aria-label={titulo}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-[var(--brand-50)] hover:text-[var(--brand)] max-sm:h-11 max-sm:w-auto max-sm:gap-1.5 max-sm:px-2.5 max-sm:text-[13px] max-sm:font-medium max-sm:text-slate-600">
      {children}
      <span className="sm:hidden">{corto}</span>
    </Link>
  );
}

const MOTIVOS: [string, string][] = [
  ["Vencido", "Vencido"],
  ["Roto / dañado", "Roto / dañado"],
  ["Devuelto al proveedor", "Devuelto al proveedor"],
  ["Otro", "Otro motivo"],
];

/**
 * Modal "Dar de baja lote": cantidad (por defecto todo el lote) y motivo. Queda como una
 * PÉRDIDA documentada (PE-) del lote puntual, valorizada al costo del lote.
 */
export function DarDeBajaLote({ lote, deposito, unidad, onClose, onHecho }: {
  lote: { id: string; numero: string; vencimiento: string; cantidad: number; producto?: string };
  deposito?: string;
  unidad: string;
  onClose: () => void;
  onHecho: () => void;
}) {
  const [cantidad, setCantidad] = useState(String(Number(lote.cantidad)));
  const [motivo, setMotivo] = useState("Vencido");
  const [detalle, setDetalle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<{ documento: string; estado: string } | null>(null);

  const cant = parseNumero(cantidad) ?? NaN;
  const motivoFinal = motivo === "Otro" ? detalle.trim() : detalle.trim() ? `${motivo} — ${detalle.trim()}` : motivo;
  const invalido = !(cant > 0) || cant > Number(lote.cantidad) || !motivoFinal;

  async function confirmar() {
    if (invalido || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ documento: string; estado: string }>(`/api/inventario/lotes/${lote.id}/baja`, {
        method: "POST",
        body: JSON.stringify({ cantidad: cant, motivo: motivoFinal }),
      });
      setHecho(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <CapaModal onClose={busy ? undefined : hecho ? onHecho : onClose} z="z-[120]" fondo="bg-slate-900/40 backdrop-blur-sm">
      <div className={`flex w-full max-w-md ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5`} onClick={(e) => e.stopPropagation()} style={{ animation: "rb-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-100 px-4 py-3 sm:px-5 sm:py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-50 text-rose-600"><PackageX className="h-4 w-4" /></div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900">Dar de baja lote</h3>
            <p className="text-xs text-slate-500 sm:truncate">
              {lote.producto ? `${lote.producto} · ` : ""}Lote <span className="font-mono font-semibold">{lote.numero}</span> · vence {fechaCorta(lote.vencimiento)} · quedan {fmt(lote.cantidad)} {unidad}{deposito ? ` en ${deposito}` : ""}
            </p>
          </div>
        </div>
        {hecho ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 text-center">
            <p className="text-sm font-semibold text-slate-900">Baja registrada como pérdida <span className="font-mono">{hecho.documento}</span></p>
            <p className="mt-1 text-xs text-slate-500">Bajó el stock del depósito y quedó en Movimientos y en Ajustes y pérdidas, valorizada al costo del lote.</p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className={ET}>Unidades a dar de baja</span>
                <input autoFocus inputMode="decimal" enterKeyHint="next" value={cantidad} onChange={(e) => setCantidad(e.target.value.replace(/[^\d.,]/g, ""))} className={`${INPUT} text-right tabular-nums`} />
              </label>
              <div>
                <span className={ET}>Motivo</span>
                <Select value={motivo} onChange={setMotivo} options={MOTIVOS} block etiqueta="Motivo de la baja" />
              </div>
            </div>
            <label className="block">
              <span className={ET}>{motivo === "Otro" ? "Contá el motivo *" : <>Detalle <span className="font-normal text-slate-400">(opcional)</span></>}</span>
              <input enterKeyHint="done" value={detalle} onChange={(e) => setDetalle(e.target.value)} maxLength={90} placeholder="Ej: se cortó la cadena de frío" className={INPUT} />
            </label>
            {cant > Number(lote.cantidad) ? <p className="text-xs font-medium text-rose-600">Del lote quedan {fmt(lote.cantidad)}.</p> : null}
            <p className="text-xs text-slate-500">Queda como <strong>pérdida</strong> (PE-) con el lote y el motivo, valorizada al costo. Se puede anular desde Ajustes y pérdidas.</p>
            {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
          </div>
        )}
        <div className="pb-safe flex shrink-0 gap-2 border-t border-slate-100 bg-slate-50/40 px-4 py-3 sm:px-5 max-sm:[&_button]:min-h-11">
          {hecho ? (
            <button type="button" onClick={onHecho} className="flex-1 rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95">Listo</button>
          ) : (
            <>
              <button type="button" onClick={onClose} disabled={busy} className="flex-1 rounded-lg border-2 border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={confirmar} disabled={busy || invalido} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {busy ? "Dando de baja…" : `Dar de baja ${Number.isFinite(cant) && cant > 0 ? fmt(cant) : ""} ${unidad}`}
              </button>
            </>
          )}
        </div>
      </div>
    </CapaModal>
  );
}
