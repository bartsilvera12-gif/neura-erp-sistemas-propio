"use client";

/**
 * Detalle de un turno de caja (abierto o cerrado): arqueo por forma de pago, resumen,
 * movimientos (con anulación de retiros / ingresos mientras está abierta) y ventas.
 * PDF del cierre (o arqueo parcial si sigue abierta).
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Lock, Printer, Undo2 } from "lucide-react";
import { imprimirArchivo } from "@/erp2/lib/api/client-blob";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, Dato, ModalDocumento, Pestanas, PedirMotivo } from "@/erp2/modules/inventario/ui";
import { anularMovimiento, fechaHora, getResumenTurno, hora, metodoLabel, type MovimientoTurno, type ResumenTurno } from "@/erp2/modules/caja/turno";
import { ResumenTurnoPanel } from "@/erp2/modules/caja/CierreModal";
import { TablaScroll, TablaTarjetas } from "@/erp2/components/TablaResponsive";
import { formatGs } from "@/erp2/modules/caja/lib";

const ORIGEN: Record<string, string> = {
  venta: "Venta", devolucion: "Devolución", cobro: "Cobro", compra: "Compra", gasto: "Gasto", pago_proveedor: "Pago a proveedor",
};
const tipoMov = (m: MovimientoTurno) =>
  m.origen !== "manual" ? ORIGEN[m.origen] : m.tipo === "retiro" ? "Retiro" : m.tipo === "ingreso" ? "Ingreso" : m.tipo === "egreso" ? "Egreso" : "Ajuste";

export function TurnoModal({ turnoId, onClose, onCerrar, onCambio }: {
  turnoId: string;
  onClose: () => void;
  /** turno abierto: botón "Cerrar caja" */
  onCerrar?: () => void;
  onCambio?: () => void;
}) {
  const [r, setR] = useState<ResumenTurno | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("resumen");
  const [anulando, setAnulando] = useState<MovimientoTurno | null>(null);

  const cargar = useCallback(() => {
    getResumenTurno(turnoId).then(setR).catch((e) => setError((e as Error).message));
  }, [turnoId]);
  useEffect(cargar, [cargar]);

  const abierta = r?.caja.estado === "abierta";
  const pdf = () => imprimirArchivo(`/api/caja/turnos/${turnoId}/pdf`, `cierre-caja-${r?.caja.numero_caja ?? ""}.pdf`).catch((e) => setError((e as Error).message));

  return (
    <>
      <ModalDocumento
        titulo={r ? <>{r.caja.punto_nombre} · {r.caja.sucursal_nombre} <EstadoTurno abierta={!!abierta} /></> : "Turno de caja"}
        subtitulo={r ? `Turno N° ${r.caja.numero_caja} · sale de ${r.caja.deposito_nombre}` : undefined}
        ancho="max-w-4xl" onClose={onClose}
        footer={
          <>
            {error ? <p className="mr-auto text-xs text-rose-600 max-sm:w-full">{error}</p> : null}
            <button type="button" onClick={pdf} disabled={!r} className={`${BOTON_SECUNDARIO} max-sm:flex-1`}><Printer className="h-4 w-4" /> {abierta ? "Imprimir arqueo parcial" : "Imprimir cierre"}</button>
            {abierta && onCerrar ? (
              <button type="button" onClick={onCerrar} className={`${BOTON_PRIMARIO} bg-rose-600 max-sm:flex-1`}><Lock className="h-4 w-4" /> Cerrar caja</button>
            ) : null}
          </>
        }>
        {!r ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 rounded-2xl bg-slate-50 px-4 py-3 sm:grid-cols-4">
              <Dato etiqueta="Apertura">{fechaHora(r.caja.fecha_apertura)}<span className="block text-[11px] text-slate-500">{r.caja.abierta_por_nombre ?? "—"}</span></Dato>
              <Dato etiqueta="Cierre">{r.caja.fecha_cierre ? fechaHora(r.caja.fecha_cierre) : "En curso"}<span className="block text-[11px] text-slate-500">{r.caja.cerrada_por_nombre ?? ""}</span></Dato>
              <Dato etiqueta="Monto inicial">{formatGs(r.caja.monto_apertura)}</Dato>
              <Dato etiqueta={abierta ? "Efectivo esperado" : "Diferencia efectivo"}>
                {abierta ? formatGs(r.efectivo.esperado) : (
                  <span className={r.caja.diferencia === 0 ? "text-emerald-700" : (r.caja.diferencia ?? 0) < 0 ? "text-rose-600" : "text-amber-600"}>
                    {r.caja.diferencia === 0 ? "Cuadra" : `${(r.caja.diferencia ?? 0) > 0 ? "+" : "−"} ${formatGs(Math.abs(r.caja.diferencia ?? 0))}`}
                  </span>
                )}
              </Dato>
            </div>

            <Pestanas valor={tab} onChange={setTab} opciones={[
              { id: "resumen", label: "Arqueo y resumen" },
              { id: "movimientos", label: "Movimientos", badge: r.movimientos.length },
              { id: "ventas", label: "Ventas", badge: r.ventas_lista.length },
            ]} />

            {tab === "resumen" ? (
              <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
                <div className="space-y-4">
                  <section className="overflow-hidden rounded-2xl border border-slate-200">
                    <TablaScroll primeraFija minAncho={abierta ? undefined : 420}>
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2 text-left">Forma de pago</th>
                          <th className="px-3 py-2 text-right">Esperado</th>
                          {!abierta ? <th className="px-3 py-2 text-right">Declarado</th> : null}
                          {!abierta ? <th className="px-3 py-2 text-right">Diferencia</th> : null}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {r.metodos.map((m) => (
                          <tr key={m.metodo}>
                            <td className="px-3 py-2 text-slate-700">{m.label}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatGs(m.esperado)}</td>
                            {!abierta ? <td className="px-3 py-2 text-right tabular-nums">{formatGs(m.declarado ?? m.esperado)}</td> : null}
                            {!abierta ? (
                              <td className={`px-3 py-2 text-right font-semibold tabular-nums ${(m.diferencia ?? 0) === 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                {(m.diferencia ?? 0) === 0 ? "✓" : `${(m.diferencia ?? 0) > 0 ? "+" : "−"} ${formatGs(Math.abs(m.diferencia ?? 0))}`}
                              </td>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </TablaScroll>
                  </section>
                  {r.caja.motivo_diferencia ? <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900"><b>Motivo de la diferencia:</b> {r.caja.motivo_diferencia}</p> : null}
                  {r.caja.observacion_cierre ? <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700"><b>Observación:</b> {r.caja.observacion_cierre}</p> : null}
                </div>
                <ResumenTurnoPanel r={r} />
              </div>
            ) : tab === "movimientos" ? (
              // Celular: cada movimiento es una tarjeta (tipo + concepto, monto a la derecha).
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <TablaTarjetas
                  filas={r.movimientos}
                  claveFila={(m) => m.id}
                  claseFila={(m) => (m.anulado ? "text-slate-400" : "")}
                  claseThead="bg-slate-50"
                  thBase="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                  tdBase="px-3 py-2"
                  vacio={<p className="py-10 text-center text-sm text-slate-400">Sin movimientos todavía.</p>}
                  columnas={[
                    { key: "hora", titulo: "Hora", claseTd: "whitespace-nowrap tabular-nums text-slate-500", celda: (m) => hora(m.created_at), movil: "dato" },
                    { key: "tipo", titulo: "Movimiento", movil: "chip", celda: (m) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.signo < 0 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{tipoMov(m)}</span> },
                    {
                      key: "detalle", titulo: "Detalle", movil: "titulo",
                      celda: (m) => (
                        <>
                          <span className={m.anulado ? "line-through" : "text-slate-700"}>{m.concepto}</span>
                          <span className="block text-[11px] font-normal text-slate-400">
                            {[m.referencia ? `Ref. ${m.referencia}` : null, m.banco, m.usuario_nombre, m.anulado ? `Anulado: ${m.anulado_motivo ?? ""}` : null].filter(Boolean).join(" · ")}
                          </span>
                        </>
                      ),
                    },
                    { key: "forma", titulo: "Forma", claseTd: "text-xs", celda: (m) => m.metodo_label, movil: "dato" },
                    {
                      key: "monto", titulo: "Monto", claseTh: "!text-right", movil: "valor",
                      claseTd: "whitespace-nowrap text-right font-semibold tabular-nums",
                      celda: (m) => <span className={m.anulado ? "line-through" : m.signo < 0 ? "text-rose-600" : "text-emerald-700"}>{m.signo < 0 ? "−" : "+"} {formatGs(m.monto)}</span>,
                    },
                    {
                      key: "acc", titulo: "", claseTh: "w-10", claseTd: "px-2 text-right", movil: "acciones",
                      celda: (m) => abierta && m.origen === "manual" && !m.anulado && (m.tipo === "retiro" || m.tipo === "ingreso") ? (
                        <button type="button" onClick={() => setAnulando(m)} title="Anular" aria-label="Anular movimiento" className="inline-flex items-center justify-center gap-1 rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Undo2 className="h-4 w-4" /><span className="text-xs font-semibold md:hidden">Anular</span></button>
                      ) : null,
                    },
                  ]}
                />
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <TablaTarjetas
                  filas={r.ventas_lista}
                  claveFila={(v) => v.id}
                  claseFila={(v) => (v.estado === "anulada" ? "text-slate-400" : "")}
                  claseThead="bg-slate-50"
                  thBase="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                  tdBase="px-3 py-2"
                  vacio={<p className="py-10 text-center text-sm text-slate-400">Sin ventas en este turno.</p>}
                  columnas={[
                    { key: "venta", titulo: "Venta", movil: "subtitulo", celda: (v) => <><span className="font-mono text-xs">{v.numero_control}</span><span className="block text-[11px] text-slate-400 max-md:ml-1.5 max-md:inline">{hora(v.fecha)}</span></> },
                    { key: "cliente", titulo: "Cliente", movil: "titulo", claseTd: "text-slate-700", celda: (v) => v.cliente_nombre ?? "Consumidor final" },
                    {
                      key: "cond", titulo: "Condición / pago", movil: "dato", etiquetaMovil: "Pago", claseTd: "text-xs",
                      celda: (v) => (
                        <>
                          {v.estado === "anulada" ? <span className="font-semibold text-rose-600">Anulada · </span> : null}
                          {v.tipo_venta === "CREDITO" ? <span className="font-semibold text-orange-600">Crédito</span> : v.pagos.map((p) => `${p.label} ${formatGs(p.monto)}`).join(" + ") || metodoLabel(v.metodo_pago)}
                        </>
                      ),
                    },
                    { key: "total", titulo: "Total", claseTh: "!text-right", movil: "valor", claseTd: "text-right font-semibold tabular-nums", celda: (v) => <span className={v.estado === "anulada" ? "line-through" : "text-slate-800"}>{formatGs(v.total)}</span> },
                  ]}
                />
              </div>
            )}
          </div>
        )}
      </ModalDocumento>
      {anulando ? (
        <PedirMotivo titulo={`Anular ${anulando.tipo === "retiro" ? "retiro" : "ingreso"} ${anulando.numero ?? ""}`}
          descripcion={<>{anulando.concepto} · <b>{formatGs(anulando.monto)}</b>. El efectivo vuelve a contar como {anulando.tipo === "retiro" ? "en la caja" : "fuera de la caja"}.</>}
          confirmar="Anular movimiento"
          onConfirmar={async (motivo) => { await anularMovimiento(anulando.id, motivo); setAnulando(null); cargar(); onCambio?.(); }}
          onClose={() => setAnulando(null)} />
      ) : null}
    </>
  );
}

function EstadoTurno({ abierta }: { abierta: boolean }) {
  return abierta ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Abierta
    </span>
  ) : (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Cerrada</span>
  );
}

