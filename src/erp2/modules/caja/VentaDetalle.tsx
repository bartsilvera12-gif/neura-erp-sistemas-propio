"use client";

/**
 * Detalle de una venta: cliente, condición, caja (caja · sucursal · turno), depósito,
 * formas de pago (con referencia, lo recibido y el vuelto), cuenta a cobrar si es a crédito,
 * productos y total. Anular:
 *   · turno abierto: se anula y el cobro sale del arqueo de ese turno
 *   · turno CERRADO: solo ADMIN o SUPERVISOR, con motivo; el efectivo se devuelve desde
 *     una caja abierta (la base valida todo: anular_venta, receta 51)
 *   · una FACTURA solo dentro de las 48 h (regla SIFEN); después, nota de crédito (receta 99)
 * Nota de crédito: devolver productos o descuento por monto (NotaCreditoModal); las notas de la
 * venta se listan abajo y abren su detalle (imprimir / anular).
 * Corregir el método de pago (receta 109): sin cambiar montos, con motivo y queda registrado.
 */
import { useEffect, useState } from "react";
import { ALTO_MAX_MODAL, CapaModal } from "@/erp2/components/CapaModal";
import { ChevronRight, FileText, ReceiptText, Trash2, X } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { browserClient } from "@/erp2/lib/supabase/browser";
import { tienePermiso, useUsuario } from "@/erp2/lib/sesion/ContextoUsuario";
import { clienteConfig } from "@/erp2/cliente.config";
import { formatGs } from "@/erp2/modules/caja/lib";
import { textoCredito } from "@/erp2/modules/caja/cuotas";
import { metodoLabel, invalidarCajas, METODOS_VENTA } from "@/erp2/modules/caja/turno";
import { Select } from "@/erp2/components/Select";
import { fechaHora } from "@/erp2/lib/fecha/paraguay";
import { SelectorCaja } from "@/erp2/modules/caja/SelectorCaja";
import { textoConPrecios, type ModsSnapshot } from "@/erp2/modules/mesas/modificadores";
import { NotaCreditoModal } from "@/erp2/modules/caja/NotaCreditoModal";
import { NotaCreditoDetalle } from "@/erp2/modules/caja/NotaCreditoDetalle";
import type { NotaCreditoPrevia } from "@/erp2/modules/caja/notas-credito";

const TEAL = clienteConfig.color;

type Item = {
  id: string;
  producto_nombre: string;
  sku: string | null;
  cantidad: number;
  precio_venta: number;
  tipo_precio: string;
  tipo_iva: string;
  monto_iva: number;
  total_linea: number;
  modificadores?: ModsSnapshot | null;
  modificadores_texto?: string | null;
};
type Venta = {
  id: string;
  numero_control: string;
  fecha: string;
  subtotal: number;
  monto_iva: number;
  total: number;
  estado: string;
  tipo_venta: string;
  plazo_dias: number | null;
  /** Receta 98 */
  cuotas?: number | null;
  cuotas_cada?: string | null;
  metodo_pago: string | null;
  usuario_nombre: string | null;
  anulada_at: string | null;
  anulada_motivo: string | null;
  /** Receta 101 */
  fiscal_numero?: string | null;
  fiscal_timbrado?: string | null;
  turno: { numero_caja: number; estado: string } | null;
  punto: { nombre: string } | null;
  sucursal: { nombre: string } | null;
  deposito: { nombre: string } | null;
  tipo_documento?: string | null;
  /** Neura: la factura de la venta y su estado en SIFEN. */
  factura_id?: string | null;
  estado_sifen?: string | null;
  receptor_nombre?: string | null;
  receptor_ruc?: string | null;
};
type Pago = { id: string; metodo_pago: string; monto: number; referencia: string | null; banco: string | null; recibido: number | null; vuelto: number | null };
type Cuenta = { vencimiento: string; cobrado: number; saldo: number; estado: string } | null;
type PagoCorregido = { metodo_pago: string; monto: number };
type Correccion = { id: string; usuario_nombre: string | null; motivo: string; antes: PagoCorregido[]; despues: PagoCorregido[]; created_at: string };
type Detalle = { venta: Venta; items: Item[]; pagos: Pago[]; correcciones?: Correccion[]; cuenta: Cuenta; cliente_nombre: string };
type PagoEditado = { id: string; metodo_pago: string; referencia: string; banco: string };

const PRECIO: Record<string, string> = { minorista: "Minorista", mayorista: "Mayorista", distribuidor: "Distribuidor", costo: "Costo" };
const fechaCorta = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const CAMPO_PAGO = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand)] max-sm:min-h-11";

export function VentaDetalle({ ventaId, onClose, onAnulada, onCambio }: {
  ventaId: string;
  onClose: () => void;
  onAnulada: () => void;
  /** se emitió o anuló una nota de crédito (para refrescar la lista) */
  onCambio?: () => void;
}) {
  const me = useUsuario();
  const [d, setD] = useState<Detalle | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [cajaDev, setCajaDev] = useState<string | null>(null);
  const [anulando, setAnulando] = useState(false);
  // Receta 99: notas de crédito de la venta y si la factura todavía se puede anular (48 h).
  const [nc, setNc] = useState<NotaCreditoPrevia | null>(null);
  const [nuevaNc, setNuevaNc] = useState(false);
  const [verNc, setVerNc] = useState<string | null>(null);

  // Receta 109: corregir el método de pago.
  const [editandoPago, setEditandoPago] = useState<PagoEditado[] | null>(null);
  const [motivoPago, setMotivoPago] = useState("");
  const [guardandoPago, setGuardandoPago] = useState(false);

  const cargarVenta = () => apiFetch<Detalle>(`/api/ventas/${ventaId}`).then(setD);
  const cargarNc = () => apiFetch<NotaCreditoPrevia>(`/api/ventas/${ventaId}/nota-credito`).then(setNc).catch(() => {});
  useEffect(() => {
    cargarVenta().catch((e) => setError((e as Error).message)).finally(() => setCargando(false));
    void cargarNc();
  }, [ventaId]); // eslint-disable-line react-hooks/exhaustive-deps

  const venta = d?.venta;
  const anulada = venta?.estado === "anulada";
  const credito = venta?.tipo_venta === "CREDITO";
  const turnoCerrado = !!venta?.turno && venta.turno.estado !== "abierta";
  const efectivo = (d?.pagos ?? []).filter((p) => p.metodo_pago === "efectivo").reduce((a, p) => a + Number(p.monto), 0);
  // Perfil: anular pide "anular ventas"; si el turno ya se cerró, además "anular ventas de turnos cerrados".
  const puedeAnular = tienePermiso(me, "anular_ventas") && (!turnoCerrado || tienePermiso(me, "anular_ventas_cerradas"));
  const notasVivas = (nc?.notas ?? []).filter((x) => x.estado === "emitida");
  // La base lo vuelve a validar: con notas de crédito, o factura de más de 48 h, no se anula.
  const motivoNoAnula = notasVivas.length ? "Tiene notas de crédito: anulalas para poder anular la venta."
    : nc && !nc.venta.factura_anulable ? "Pasaron más de 48 h de la factura: ya no se anula. Hacé una nota de crédito."
    : null;
  const puedeNc = tienePermiso(me, "notas_credito") && !!nc && nc.disponible > 0;

  async function corregirPago() {
    if (!editandoPago) return;
    if (!motivoPago.trim()) { setError("Escribí el motivo de la corrección."); return; }
    setGuardandoPago(true);
    setError(null);
    try {
      await apiFetch(`/api/ventas/${ventaId}/corregir-pago`, {
        method: "POST",
        body: JSON.stringify({ motivo: motivoPago.trim(), cambios: editandoPago }),
      });
      await cargarVenta();
      setEditandoPago(null);
      setMotivoPago("");
      invalidarCajas();
      onCambio?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardandoPago(false);
    }
  }

  async function anular() {
    if (turnoCerrado && !motivo.trim()) { setError("Escribí el motivo de la anulación."); return; }
    setAnulando(true);
    setError(null);
    try {
      await apiFetch(`/api/ventas/${ventaId}/anular`, {
        method: "POST",
        body: JSON.stringify({ motivo: motivo.trim() || null, caja_id: turnoCerrado && efectivo > 0 ? cajaDev : null }),
      });
      invalidarCajas();
      onAnulada();
    } catch (e) {
      setError((e as Error).message);
      setAnulando(false);
    }
  }

  // Abre el MISMO ticket térmico del POS (/api/ventas/[id]/ticket) en pestaña
  // normal. La auth del 2.0 es por Bearer, así que lo traemos con el token y lo
  // abrimos como blob (una pestaña nueva directa no llevaría el token).
  async function verComprobante() {
    if (!d) return;
    try {
      const { data } = await browserClient().auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch(`/api/ventas/${d.venta.id}/ticket?auto=1`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) { setError("No se pudo abrir el comprobante. Probá de nuevo."); return; }
      const html = await res.text();
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    } catch { setError("No se pudo abrir el comprobante. Probá de nuevo."); }
  }

  const cajaTxt = venta ? [venta.punto?.nombre, venta.sucursal?.nombre].filter(Boolean).join(" · ") : "";

  return (
    <CapaModal onClose={onClose} z="z-[120]" fondo="bg-slate-900/30">
      <div
        className={`flex ${ALTO_MAX_MODAL} w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white`}
        style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)", boxShadow: "0 24px 50px -24px rgba(2,48,71,0.35)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 py-3 pl-4 pr-2 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-slate-900 [overflow-wrap:anywhere] sm:text-lg">Venta {venta?.numero_control ?? "…"}</h2>
            {venta ? <p className="mt-0.5 text-xs text-slate-500">{fechaHora(venta.fecha)}{venta.usuario_nombre ? ` · ${venta.usuario_nombre}` : ""}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
          {cargando ? (
            <p className="py-8 text-center text-sm text-slate-400">Cargando…</p>
          ) : d && venta ? (
            <>
              {anulada ? (
                <p className="mb-4 rounded-lg bg-rose-50 p-2.5 text-center text-xs font-semibold uppercase tracking-wide text-rose-700">
                  Venta anulada{venta.anulada_motivo ? <span className="mt-0.5 block font-normal normal-case tracking-normal">{venta.anulada_motivo}</span> : null}
                </p>
              ) : null}
              <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:gap-x-6">
                <Campo label="Cliente" valor={d.cliente_nombre} />
                <Campo label="Condición">
                  <span className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-800">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: credito ? "#ea580c" : "#16a34a" }} />
                    {credito ? textoCredito(venta.plazo_dias, venta.cuotas, venta.cuotas_cada) : "Contado"}
                  </span>
                </Campo>
                <Campo label="Caja" valor={cajaTxt ? `${cajaTxt}${venta.turno ? ` · turno N° ${venta.turno.numero_caja}${turnoCerrado ? " (cerrado)" : ""}` : ""}` : "—"} />
                <Campo label="Salió de" valor={venta.deposito?.nombre ?? "—"} />
                <Campo label="Precio" valor={PRECIO[d.items[0]?.tipo_precio ?? "minorista"] ?? "Minorista"} />
                <Campo label="Documento" valor={venta.tipo_documento === "factura" ? `Factura${venta.receptor_ruc ? ` · RUC ${venta.receptor_ruc}` : ""}` : "Ticket"} />
                {venta.fiscal_numero ? <Campo label="Factura N°" valor={`${venta.fiscal_numero}${venta.estado_sifen ? ` · SIFEN: ${venta.estado_sifen}` : " · sin emitir"}`} /> : null}
                {venta.factura_id ? (
                  <a href={`/facturas/${venta.factura_id}`} target="_blank" rel="noreferrer" className="self-end text-sm font-semibold text-[var(--brand)] hover:underline">
                    Ver / emitir la factura →
                  </a>
                ) : null}
              </div>

              {credito && d.cuenta ? (
                <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-orange-100 bg-orange-50/50 p-3 text-xs sm:grid-cols-3">
                  <div><p className="text-slate-500">Vence</p><p className="font-semibold text-slate-800">{fechaCorta(d.cuenta.vencimiento)}</p></div>
                  <div><p className="text-slate-500">Cobrado</p><p className="font-semibold tabular-nums text-slate-800">{formatGs(d.cuenta.cobrado)}</p></div>
                  <div><p className="text-slate-500">Saldo</p><p className="font-semibold tabular-nums text-slate-800">{formatGs(d.cuenta.saldo)} <span className="font-normal capitalize text-slate-500">· {d.cuenta.estado}</span></p></div>
                </div>
              ) : null}

              {!credito && d.pagos.length ? (
                <>
                  <div className="mb-2 mt-5 flex items-center justify-between gap-3">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Forma{d.pagos.length > 1 ? "s" : ""} de pago</p>
                    {!anulada && puedeAnular && !editandoPago && d.pagos.some((p) => p.metodo_pago !== "saldo_favor") ? (
                      <button type="button" onClick={() => { setError(null); setEditandoPago(d.pagos.filter((p) => p.metodo_pago !== "saldo_favor").map((p) => ({ id: p.id, metodo_pago: p.metodo_pago, referencia: p.referencia ?? "", banco: p.banco ?? "" }))); }}
                        className="inline-flex items-center text-xs font-semibold hover:underline max-sm:min-h-11" style={{ color: TEAL }}>
                        Corregir
                      </button>
                    ) : null}
                  </div>
                  {editandoPago ? (
                    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
                      {editandoPago.map((e) => {
                        const original = d.pagos.find((p) => p.id === e.id);
                        const met = METODOS_VENTA.find((m) => m.value === e.metodo_pago);
                        const poner = (cambio: Partial<PagoEditado>) => setEditandoPago((l) => (l ?? []).map((x) => (x.id === e.id ? { ...x, ...cambio } : x)));
                        return (
                          <div key={e.id} className="space-y-2">
                            <div className="flex items-center gap-3">
                              <div className="min-w-0 flex-1">
                                <Select block value={e.metodo_pago} onChange={(v) => poner({ metodo_pago: v })} etiqueta="Método de pago"
                                  options={[
                                    ...(METODOS_VENTA.some((m) => m.value === e.metodo_pago) ? [] : [[e.metodo_pago, metodoLabel(e.metodo_pago)] as [string, string]]),
                                    ...METODOS_VENTA.map((m): [string, string] => [m.value, m.label]),
                                  ]} />
                              </div>
                              <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{formatGs(original?.monto ?? 0)}</p>
                            </div>
                            {met?.referencia || met?.banco ? (
                              <div className="grid gap-2 sm:grid-cols-2">
                                {met.referencia ? <input value={e.referencia} onChange={(ev) => poner({ referencia: ev.target.value })} maxLength={100} placeholder={`${met.referencia} (opcional)`} aria-label={met.referencia} className={CAMPO_PAGO} /> : null}
                                {met.banco ? <input value={e.banco} onChange={(ev) => poner({ banco: ev.target.value })} maxLength={100} placeholder="Banco (opcional)" aria-label="Banco" className={CAMPO_PAGO} /> : null}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-slate-600">Motivo <span className="text-rose-500">*</span></span>
                        <input value={motivoPago} onChange={(ev) => setMotivoPago(ev.target.value)} maxLength={500} placeholder="Ej: se marcó efectivo y pagó con tarjeta" className={CAMPO_PAGO} />
                      </label>
                      <p className="text-xs text-slate-500">
                        {turnoCerrado ? "El turno ya se cerró: su arqueo queda como está. Cambian la venta y los reportes." : "El monto no cambia. El arqueo de la caja se ajusta al método correcto."}
                      </p>
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => { setEditandoPago(null); setMotivoPago(""); setError(null); }} disabled={guardandoPago} className="min-h-10 rounded-xl px-3 text-sm font-medium text-slate-500 hover:text-slate-700 max-sm:min-h-11">Cancelar</button>
                        <button type="button" onClick={corregirPago} disabled={guardandoPago} className="min-h-10 rounded-xl px-4 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50 max-sm:min-h-11" style={{ backgroundColor: TEAL }}>
                          {guardandoPago ? "Guardando…" : "Guardar corrección"}
                        </button>
                      </div>
                    </div>
                  ) : (
                  <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                    {d.pagos.map((p) => (
                      <li key={p.id} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800">{metodoLabel(p.metodo_pago)}</p>
                          {p.referencia || p.banco ? <p className="text-xs text-slate-400">{[p.banco, p.referencia ? `Ref. ${p.referencia}` : null].filter(Boolean).join(" · ")}</p> : null}
                          {p.metodo_pago === "efectivo" && Number(p.recibido) > 0 ? (
                            <p className="text-xs text-slate-400">Recibido {formatGs(Number(p.recibido))} · vuelto {formatGs(Number(p.vuelto) || 0)}</p>
                          ) : null}
                        </div>
                        <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{formatGs(p.monto)}</p>
                      </li>
                    ))}
                  </ul>
                  )}
                  {(d.correcciones ?? []).map((c) => (
                    <p key={c.id} className="mt-1.5 text-xs text-slate-500">
                      Corregido: {c.antes.map((a) => metodoLabel(a.metodo_pago)).join(" + ")} → {c.despues.map((a) => metodoLabel(a.metodo_pago)).join(" + ")} · {fechaHora(c.created_at)}{c.usuario_nombre ? ` · ${c.usuario_nombre}` : ""} · {c.motivo}
                    </p>
                  ))}
                </>
              ) : null}

              <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Productos ({d.items.length})</p>
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                {d.items.map((i) => (
                  <li key={i.id} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 [overflow-wrap:anywhere] sm:truncate">{i.producto_nombre}</p>
                      {/* Receta 73: modificadores del plato (extras con su precio). */}
                      {i.modificadores || i.modificadores_texto ? (
                        <p className="mt-0.5 text-xs text-slate-500 [overflow-wrap:anywhere]">{textoConPrecios(i.modificadores) || i.modificadores_texto}</p>
                      ) : null}
                      <p className="mt-0.5 text-xs text-slate-400">{Number(i.cantidad).toLocaleString("es-PY", { maximumFractionDigits: 3 })} × {formatGs(i.precio_venta)}{i.sku ? ` · ${i.sku}` : ""}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums text-slate-900">{formatGs(i.total_linea)}</p>
                      <p className="mt-0.5 text-[11px] text-slate-400">IVA {i.tipo_iva}</p>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-3.5 space-y-1.5 rounded-xl bg-slate-50 p-3.5">
                <div className="flex items-center justify-between text-sm text-slate-500"><span>IVA incluido</span><span className="tabular-nums">{formatGs(venta.monto_iva)}</span></div>
                <div className="flex items-center justify-between border-t border-slate-200 pt-1.5"><span className="text-sm font-semibold text-slate-900">Total</span><span className="text-lg font-bold tabular-nums text-slate-900">{formatGs(venta.total)}</span></div>
              </div>

              {nc && nc.notas.length ? (
                <>
                  <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Notas de crédito ({nc.notas.length})</p>
                  <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                    {nc.notas.map((x) => (
                      <li key={x.id}>
                        <button type="button" onClick={() => setVerNc(x.id)} className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-slate-50">
                          <span className="min-w-0">
                            <span className={`block font-mono text-sm font-semibold ${x.estado === "anulada" ? "text-slate-400 line-through" : "text-slate-800"}`}>{x.numero}</span>
                            <span className="block truncate text-xs text-slate-400">{fechaHora(x.fecha)} · {x.motivo}</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <span className={`text-sm font-semibold tabular-nums ${x.estado === "anulada" ? "text-slate-400" : "text-rose-600"}`}>−{formatGs(x.total)}</span>
                            <ChevronRight className="h-4 w-4 text-slate-300" />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {nc.acreditado > 0 ? <p className="mt-1.5 text-right text-xs text-slate-500">Acreditado {formatGs(nc.acreditado)} · queda {formatGs(nc.disponible)}</p> : null}
                </>
              ) : null}

              {confirmar && !anulada ? (
                <div className="mt-4 space-y-3 rounded-xl border border-rose-200 bg-rose-50/60 p-3.5">
                  {turnoCerrado ? (
                    <p className="text-xs text-rose-800">
                      La venta es de un turno <b>ya cerrado</b>: ese arqueo no cambia. El stock vuelve al depósito
                      {efectivo > 0 ? <> y los <b>{formatGs(efectivo)}</b> en efectivo se devuelven desde una caja abierta</> : null}.
                      {d.pagos.some((p) => p.metodo_pago !== "efectivo") ? " Lo cobrado con tarjeta / transferencia se reintegra por fuera." : ""}
                    </p>
                  ) : (
                    <p className="text-xs text-rose-800">El stock vuelve al depósito y el cobro sale del arqueo de la caja.</p>
                  )}
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-600">Motivo {turnoCerrado ? <span className="text-rose-500">*</span> : <span className="font-normal text-slate-400">(opcional)</span>}</span>
                    <textarea autoFocus rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500}
                      className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-rose-300" />
                  </label>
                  {turnoCerrado && efectivo > 0 ? <SelectorCaja value={cajaDev} onChange={setCajaDev} etiqueta="El efectivo sale de" /> : null}
                </div>
              ) : null}
              {error ? <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
            </>
          ) : error ? (
            <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 sm:flex-nowrap sm:px-6 sm:py-4">
          {!anulada && venta ? (
            motivoNoAnula ? (
              <span className="text-[11px] text-slate-400 max-sm:w-full sm:max-w-[45%]">{motivoNoAnula}</span>
            ) : !puedeAnular ? (
              <span className="text-[11px] text-slate-400 max-sm:w-full sm:max-w-[45%]">{!tienePermiso(me, "anular_ventas") ? "Tu perfil no permite anular ventas." : "Es de un turno cerrado: tu perfil no permite anularla."}</span>
            ) : confirmar ? (
              <div className="flex items-center gap-2 max-sm:w-full">
                <button onClick={anular} disabled={anulando} className="inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-rose-600 px-4 max-sm:h-11 max-sm:flex-1 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50">
                  <Trash2 className="h-4 w-4" /> {anulando ? "Anulando…" : "Confirmar anulación"}
                </button>
                <button onClick={() => { setConfirmar(false); setError(null); }} disabled={anulando} className="h-10 whitespace-nowrap rounded-xl px-3 text-sm font-medium text-slate-500 hover:text-slate-700 max-sm:h-11">Cancelar</button>
              </div>
            ) : (
              <button onClick={() => setConfirmar(true)} className="inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap max-sm:h-11 max-sm:flex-1 rounded-xl border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-600 transition hover:bg-rose-50">
                <Trash2 className="h-4 w-4" /> Anular venta
              </button>
            )
          ) : <span />}
          {!anulada && venta && puedeNc && !confirmar ? (
            <button onClick={() => setNuevaNc(true)} className="inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)] max-sm:h-11 max-sm:flex-1 sm:ml-auto">
              <ReceiptText className="h-4 w-4" /> Nota de crédito
            </button>
          ) : null}
          <button onClick={verComprobante} className="inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-4 max-sm:h-11 max-sm:flex-1 text-sm font-semibold text-white transition hover:brightness-95" style={{ backgroundColor: TEAL }}>
            <FileText className="h-4 w-4" /> Ver comprobante
          </button>
        </div>
      </div>
      {nuevaNc ? (
        <NotaCreditoModal ventaId={ventaId} onClose={() => setNuevaNc(false)}
          onHecho={(r) => { setNuevaNc(false); void cargarNc(); setVerNc(r.id); onCambio?.(); }} />
      ) : null}
      {verNc ? <NotaCreditoDetalle notaId={verNc} onClose={() => setVerNc(null)} onCambio={() => { void cargarNc(); onCambio?.(); }} /> : null}
    </CapaModal>
  );
}

function Campo({ label, valor, children }: { label: string; valor?: string; children?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{label}</p>
      {children ?? <p className="mt-1 text-[15px] text-slate-800 [overflow-wrap:anywhere] sm:truncate" title={valor}>{valor}</p>}
    </div>
  );
}
