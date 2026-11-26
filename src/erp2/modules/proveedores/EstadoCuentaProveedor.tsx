"use client";

/**
 * Estado de cuenta de un proveedor (desde Proveedores): lo que le debés en Gs. y USD, lo
 * vencido, las facturas a crédito (con lo pagado y lo que falta; las vencidas en rojo) y
 * las órdenes de pago (PDF, ver, anular). "Registrar pago" y el PDF del estado de cuenta.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Ban, Banknote, Download, Eye, Loader2, Printer, X } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { descargarArchivo } from "@/erp2/lib/api/client-blob";
import { clienteConfig } from "@/erp2/cliente.config";
import { ALTO_MAX_MODAL, CapaModal } from "@/erp2/components/CapaModal";
import { TablaScroll } from "@/erp2/components/TablaResponsive";
import { TZ_PY } from "@/erp2/lib/fecha/paraguay";
import { ESTADO_CXP, dinero, hrefOrigenCxp, nombreMetodoPago, type EstadoCuentaProveedor as EC, type PagoEstadoCuenta } from "@/erp2/modules/compras/pagos";
import { RegistrarPagoProveedor, imprimirOrdenPago, useAvisoPago } from "@/erp2/modules/compras/RegistrarPagoProveedor";
import { AnularPago, DetallePago } from "@/erp2/modules/compras/DetallePago";

const BRAND = clienteConfig.color;
const dia = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("es-PY", { day: "2-digit", month: "short", year: "numeric" });
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "short", year: "numeric" });

export function EstadoCuentaProveedor({ proveedorId, proveedorNombre, puedePagar, onClose }: {
  proveedorId: string; proveedorNombre: string; puedePagar: boolean; onClose: () => void;
}) {
  const [ec, setEc] = useState<EC | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verTodas, setVerTodas] = useState(false);
  const [pagando, setPagando] = useState(false);
  const [viendo, setViendo] = useState<string | null>(null);
  const [anulando, setAnulando] = useState<PagoEstadoCuenta | null>(null);
  const [bajando, setBajando] = useState(false);
  const { nodo: aviso, avisar } = useAvisoPago();

  const cargar = useCallback(() => {
    apiFetch<EC>(`/api/proveedores/${proveedorId}/estado-cuenta`).then(setEc).catch((e) => setError((e as Error).message));
  }, [proveedorId]);
  useEffect(() => { cargar(); }, [cargar]);

  const cuentas = (ec?.cuentas ?? []).filter((c) => verTodas || c.estado === "pendiente" || c.estado === "parcial");
  const debe = Number(ec?.deuda_gs ?? 0) > 0 || Number(ec?.deuda_usd ?? 0) > 0;
  const modalAbierto = pagando || !!viendo || !!anulando;

  async function pdf() {
    setBajando(true);
    try { await descargarArchivo(`/api/proveedores/${proveedorId}/estado-cuenta/pdf`, "estado-cuenta-proveedor.pdf"); } catch { /* best-effort */ } finally { setBajando(false); }
  }

  return (
    <>
      <CapaModal onClose={modalAbierto ? undefined : onClose} cerrarConEscape={!modalAbierto} z="z-[100]">
        <div onClick={(e) => e.stopPropagation()} className={`flex w-full max-w-4xl ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`} style={{ animation: "rb-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
          {/* Cabecera: en celular el nombre y la cruz arriba; PDF y "Registrar pago" debajo, a todo el ancho. */}
          <div className="flex shrink-0 flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: BRAND }}>Estado de cuenta</p>
              <h2 className="text-lg font-semibold text-slate-900 [overflow-wrap:anywhere] sm:truncate">{proveedorNombre}</h2>
            </div>
            <div className="flex items-center gap-2 max-sm:order-last max-sm:w-full">
              <button onClick={pdf} disabled={bajando || !ec} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 max-sm:min-h-11 max-sm:flex-1 max-sm:text-sm">
                {bajando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} PDF
              </button>
              {puedePagar && debe ? (
                <button onClick={() => setPagando(true)} className="inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold text-white hover:brightness-95 max-sm:min-h-11 max-sm:flex-[2] max-sm:text-sm" style={{ backgroundColor: BRAND }}>
                  <Banknote className="h-3.5 w-3.5" /> Registrar pago
                </button>
              ) : null}
            </div>
            <button onClick={onClose} aria-label="Cerrar" className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 max-sm:-mr-2 max-sm:-mt-1 sm:-ml-1"><X className="h-5 w-5" /></button>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
            {!ec ? (
              error ? <p className="text-sm text-rose-600">{error}</p> : <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
            ) : (
              <>
                <div className={`grid gap-2.5 sm:gap-3 ${Number(ec.deuda_usd) > 0 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2"}`}>
                  <Cifra l="Le debés (Gs.)" v={dinero(ec.deuda_gs, "GS")} />
                  {Number(ec.deuda_usd) > 0 ? <Cifra l="Le debés (USD)" v={dinero(ec.deuda_usd, "USD")} /> : null}
                  <Cifra l="Vencido (Gs.)" v={dinero(ec.vencido_gs, "GS")} rojo={Number(ec.vencido_gs) > 0} className={Number(ec.deuda_usd) > 0 ? "max-sm:col-span-2" : ""} />
                </div>

                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-2.5 sm:py-3">
                    <p className="text-sm font-semibold text-slate-800">Facturas a crédito</p>
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600 max-sm:min-h-11">
                      <input type="checkbox" checked={verTodas} onChange={(e) => setVerTodas(e.target.checked)} className="h-4 w-4 accent-[var(--brand)] max-sm:h-5 max-sm:w-5" />
                      Ver también las pagadas
                    </label>
                  </div>
                  {cuentas.length === 0 ? (
                    <p className="px-4 py-10 text-center text-sm text-slate-400">{ec.cuentas.length ? "No le debés nada." : "Todavía no le compraste a crédito."}</p>
                  ) : (
                    // Tabla numérica: scroll interno con la factura fija a la izquierda.
                    <TablaScroll primeraFija minAncho={720} className="[--tabla-fondo-cabecera:var(--brand-50)]">
                      <table className="w-full whitespace-nowrap text-sm">
                        <thead>
                          <tr className="border-b-2 text-left text-[11px] font-bold uppercase tracking-wider" style={{ borderColor: `${BRAND}26`, backgroundColor: `${BRAND}0d`, color: BRAND }}>
                            <th className="px-4 py-2.5">Factura</th>
                            <th className="px-4 py-2.5">Compra</th>
                            <th className="px-4 py-2.5">Vence</th>
                            <th className="px-4 py-2.5 text-right">Importe</th>
                            <th className="px-4 py-2.5 text-right">Pagado</th>
                            <th className="px-4 py-2.5 text-right">Saldo</th>
                            <th className="px-4 py-2.5">Estado</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {cuentas.map((c) => (
                            <tr key={c.id} className={c.estado === "anulada" ? "opacity-50" : ""}>
                              <td className="px-4 py-2.5"><span className="font-mono text-xs font-semibold text-slate-800">{c.numero}</span><span className="block text-[11px] text-slate-500">{dia(c.fecha_emision)}</span></td>
                              <td className="px-4 py-2.5"><Link href={hrefOrigenCxp(c)} className="font-mono text-xs text-[var(--brand)] hover:underline">{c.compra_numero}</Link></td>
                              <td className={`px-4 py-2.5 text-xs ${c.dias_atraso > 0 ? "font-semibold text-rose-600" : "text-slate-600"}`}>
                                {dia(c.vencimiento)}{c.dias_atraso > 0 ? <span className="block">{c.dias_atraso} días de atraso</span> : null}
                              </td>
                              <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-slate-600">{dinero(c.monto, c.moneda)}</td>
                              <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-emerald-700">{Number(c.pagado) ? dinero(c.pagado, c.moneda) : "—"}</td>
                              <td className="whitespace-nowrap px-4 py-2.5 text-right font-bold tabular-nums text-slate-900">{Number(c.saldo) ? dinero(c.saldo, c.moneda) : "—"}</td>
                              <td className="px-4 py-2.5">
                                <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.dias_atraso > 0 ? "bg-rose-50 text-rose-700" : ESTADO_CXP[c.estado]?.c}`}>{c.dias_atraso > 0 ? "Vencida" : ESTADO_CXP[c.estado]?.t}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TablaScroll>
                  )}
                </section>

                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <p className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Pagos realizados</p>
                  {ec.pagos.length === 0 ? (
                    <p className="px-4 py-10 text-center text-sm text-slate-400">Todavía no le pagaste nada.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {ec.pagos.map((k) => (
                        <li key={k.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 max-sm:[&_button]:min-h-11 max-sm:[&_button]:px-3 ${k.anulado_at ? "opacity-60" : ""}`}>
                          <div className="min-w-0 flex-1 [overflow-wrap:anywhere] max-sm:basis-[60%]">
                            <p className="text-sm font-semibold text-slate-800">
                              <span className={`font-mono text-xs ${k.anulado_at ? "line-through" : ""}`}>{k.numero}</span>
                              <span className="ml-2 text-xs font-normal text-slate-500">{fecha(k.fecha)}{k.usuario ? ` · ${k.usuario}` : ""}</span>
                              {k.anulado_at ? <span className="ml-2 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">Anulada</span> : null}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {(k.medios ?? []).map((m) => `${nombreMetodoPago(m.metodo)} ${dinero(m.monto, k.moneda)}${m.referencia ? ` (${m.referencia})` : ""}`).join(" + ")}
                              {k.aplicado_a?.length ? ` · aplicado a ${k.aplicado_a.map((a) => a.numero).join(", ")}` : ""}
                              {k.anulado_at && k.anulado_motivo ? ` · anulada: ${k.anulado_motivo}` : ""}
                            </p>
                          </div>
                          <p className={`text-sm font-bold tabular-nums ${k.anulado_at ? "text-slate-400 line-through" : "text-slate-900"}`}>{dinero(k.total, k.moneda)}</p>
                          <button onClick={() => setViendo(k.id)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"><Eye className="h-3.5 w-3.5" /> Ver</button>
                          <button onClick={() => imprimirOrdenPago(k.id, k.numero).catch(() => {})} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"><Printer className="h-3.5 w-3.5" /> PDF</button>
                          {!k.anulado_at && puedePagar ? (
                            <button onClick={() => setAnulando(k)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Ban className="h-3.5 w-3.5" /> Anular</button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </div>
        </div>
      </CapaModal>

      {pagando ? (
        <RegistrarPagoProveedor proveedorId={proveedorId} proveedorNombre={proveedorNombre} moneda={Number(ec?.deuda_gs ?? 0) > 0 ? "GS" : "USD"}
          onClose={() => setPagando(false)} onHecho={(p) => { avisar(p); cargar(); }} />
      ) : null}
      {viendo ? (
        <DetallePago id={viendo} puedeAnular={puedePagar} onClose={() => setViendo(null)}
          onAnular={(p) => { setViendo(null); setAnulando({ id: p.id, numero: p.numero, fecha: p.fecha, moneda: p.moneda, total: p.total, observacion: p.observacion, usuario: p.usuario_nombre, anulado_at: null, anulado_motivo: null, medios: p.medios, aplicado_a: null }); }} />
      ) : null}
      {anulando ? <AnularPago pago={anulando} onClose={() => setAnulando(null)} onAnulado={cargar} /> : null}
      {aviso}
    </>
  );
}

function Cifra({ l, v, rojo, className = "" }: { l: string; v: string; rojo?: boolean; className?: string }) {
  return (
    <div className={`min-w-0 rounded-xl px-3 py-2.5 sm:px-4 sm:py-3 ${rojo ? "bg-rose-50" : "bg-slate-50"} ${className}`}>
      <p className={`text-[11px] ${rojo ? "text-rose-600" : "text-slate-500"}`}>{l}</p>
      <p className={`text-base font-bold tabular-nums sm:text-lg ${rojo ? "text-rose-600" : "text-slate-900"}`}>{v}</p>
    </div>
  );
}
