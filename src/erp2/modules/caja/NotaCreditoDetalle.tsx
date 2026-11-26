"use client";

/**
 * Detalle de una nota de crédito (receta 99): venta que corrige, cliente, motivo, productos
 * (si volvieron al stock o quedaron como pérdida) o el descuento, y a dónde fue la plata.
 * Imprimir (PDF A4 con el logo de la empresa) y Anular (con motivo; la base no deja si su saldo
 * a favor ya se usó o si la devolución salió de un turno ya cerrado).
 */
import { useEffect, useState } from "react";
import { Ban, Loader2, Printer, ReceiptText } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { imprimirArchivo } from "@/erp2/lib/api/client-blob";
import { tienePermiso, useUsuario } from "@/erp2/lib/sesion/ContextoUsuario";
import { fechaHora } from "@/erp2/lib/fecha/paraguay";
import { formatGs } from "@/erp2/modules/caja/lib";
import { invalidarCajas } from "@/erp2/modules/caja/turno";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, ModalDocumento, PedirMotivo, TEAL } from "@/erp2/modules/inventario/ui";
import { metodoDevolucionLabel, tipoNotaLabel, type NotaCreditoDetalle as Detalle } from "@/erp2/modules/caja/notas-credito";

const fechaCorta = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const fmtCant = (n: number) => Number(n).toLocaleString("es-PY", { maximumFractionDigits: 3 });

export function NotaCreditoDetalle({ notaId, onClose, onCambio, onVerVenta }: {
  notaId: string;
  onClose: () => void;
  /** se anuló (para refrescar la lista) */
  onCambio?: () => void;
  /** abrir la venta (desde el listado) */
  onVerVenta?: (ventaId: string) => void;
}) {
  const me = useUsuario();
  const [d, setD] = useState<Detalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [anular, setAnular] = useState(false);
  const [imprimiendo, setImprimiendo] = useState(false);

  const cargar = () => apiFetch<Detalle>(`/api/notas-credito/${notaId}`).then(setD).catch((e) => setError((e as Error).message));
  useEffect(() => { void cargar(); }, [notaId]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = d?.nota;
  const anulada = n?.estado === "anulada";
  const turnoCerrado = !!n && n.devuelto > 0 && !!d?.caja && d.caja.estado !== "abierta";
  const bloqueo = !n || anulada ? null
    : d?.saldo_favor_usado ? "El saldo a favor de esta nota ya se usó: no se puede anular."
    : turnoCerrado ? `La devolución salió del turno N° ${d?.caja?.numero_caja}, que ya se cerró: no se puede anular.`
    : null;
  const puedeAnular = tienePermiso(me, "notas_credito") && !anulada && !bloqueo;

  async function imprimir() {
    if (!n) return;
    setImprimiendo(true);
    try { await imprimirArchivo(`/api/notas-credito/${n.id}/pdf`, `nota-de-credito-${n.numero}.pdf`); }
    catch (e) { setError((e as Error).message); }
    finally { setImprimiendo(false); }
  }

  return (
    <>
      <ModalDocumento
        ancho="max-w-lg"
        z="z-[125]"
        titulo={<><ReceiptText className="h-5 w-5 shrink-0" style={{ color: TEAL }} /> Nota de crédito {n?.numero ?? "…"}
          {anulada ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-200">Anulada</span> : null}</>}
        subtitulo={n ? `${fechaHora(n.fecha)}${n.usuario_nombre ? ` · ${n.usuario_nombre}` : ""}` : undefined}
        onClose={onClose}
        footer={
          <>
            {bloqueo ? <p className="mr-auto text-[11px] text-slate-400 max-sm:basis-full">{bloqueo}</p> : null}
            {puedeAnular ? (
              <button type="button" onClick={() => setAnular(true)} className={`${BOTON_SECUNDARIO} text-rose-600 hover:border-rose-300 hover:text-rose-700 max-sm:min-h-11 max-sm:flex-1`}>
                <Ban className="h-4 w-4" /> Anular
              </button>
            ) : null}
            <button type="button" onClick={() => void imprimir()} disabled={!n || imprimiendo} className={`${BOTON_PRIMARIO} max-sm:min-h-11 max-sm:flex-[1.4]`} style={{ backgroundColor: TEAL }}>
              {imprimiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />} Imprimir
            </button>
          </>
        }
      >
        {error && !d ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : !d || !n ? (
          <p className="py-8 text-center text-sm text-slate-400">Cargando…</p>
        ) : (
          <div className="space-y-5">
            {anulada ? (
              <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">
                Anulada{n.anulada_at ? ` el ${fechaHora(n.anulada_at)}` : ""}{n.anulada_por_nombre ? ` por ${n.anulada_por_nombre}` : ""}{n.anulada_motivo ? `: ${n.anulada_motivo}` : ""}.
                Lo que había vuelto al stock salió de nuevo y la plata volvió a su lugar.
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:gap-x-6">
              <Campo label="Cliente" valor={d.cliente_nombre} />
              <Campo label="Corrige la venta">
                {onVerVenta ? (
                  <button type="button" onClick={() => onVerVenta(d.venta.id)} className="mt-1 text-left font-mono text-sm font-semibold text-[var(--brand)] hover:underline [@media(pointer:coarse)]:min-h-11">
                    {d.venta.numero_control}
                  </button>
                ) : <p className="mt-1 font-mono text-sm text-slate-800">{d.venta.numero_control}</p>}
                <p className="text-[11px] text-slate-400">{fechaCorta(d.venta.fecha)} · {d.venta.fiscal_numero ? `Factura ${d.venta.fiscal_numero}` : d.venta.tipo_documento === "factura" ? "Factura" : "Ticket"} · {formatGs(d.venta.total)}</p>
              </Campo>
              {n.fiscal_numero ? <Campo label="N° fiscal" valor={`${n.fiscal_numero} · Timbrado ${n.fiscal_timbrado ?? "—"}`} /> : null}
              <Campo label="Tipo" valor={tipoNotaLabel(n.tipo)} />
              <Campo label="Depósito" valor={d.deposito ?? "—"} />
            </div>
            <div className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700">
              <span className="font-semibold">Motivo:</span> {n.motivo}
            </div>

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">{n.tipo === "devolucion" ? `Productos devueltos (${d.items.length})` : "Detalle"}</p>
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                {d.items.map((i) => (
                  <li key={i.id} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 [overflow-wrap:anywhere]">{i.producto_nombre}</p>
                      {n.tipo === "devolucion" ? (
                        <p className="mt-0.5 text-xs text-slate-400">
                          {fmtCant(i.cantidad)} × {formatGs(i.precio_unitario)}
                          {i.mueve_stock ? (i.vuelve_stock ? " · volvió al stock" : <span className="text-amber-700"> · no volvió (pérdida)</span>) : ""}
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums text-slate-900">{formatGs(i.total_linea)}</p>
                      <p className="mt-0.5 text-[11px] text-slate-400">IVA {i.tipo_iva ?? "—"}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-1.5 rounded-xl bg-slate-50 p-3.5 text-sm">
              <div className="flex items-center justify-between text-slate-500"><span>IVA incluido</span><span className="tabular-nums">{formatGs(n.monto_iva)}</span></div>
              <div className="flex items-center justify-between border-t border-slate-200 pt-1.5"><span className="font-semibold text-slate-900">Total</span><span className="text-lg font-bold tabular-nums text-slate-900">{formatGs(n.total)}</span></div>
              <div className="space-y-1 border-t border-slate-200 pt-2 text-xs text-slate-600">
                {n.a_cuenta > 0 ? (
                  <div className="flex justify-between gap-3"><span>Bajó la deuda de la venta{d.aplicaciones.length > 1 ? ` (${d.aplicaciones.length} cuotas)` : ""}</span><span className="shrink-0 whitespace-nowrap font-semibold tabular-nums">{formatGs(n.a_cuenta)}</span></div>
                ) : null}
                {n.devuelto > 0 ? (
                  <div className="flex justify-between gap-3">
                    <span>Devuelto en {metodoDevolucionLabel(n.metodo_devolucion).toLowerCase()}{d.caja ? ` · ${d.caja.etiqueta}${d.caja.numero_caja ? `, turno N° ${d.caja.numero_caja}` : ""}` : ""}{n.referencia_devolucion ? ` · ref. ${n.referencia_devolucion}` : ""}</span>
                    <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums">{formatGs(n.devuelto)}</span>
                  </div>
                ) : null}
                {n.a_favor > 0 ? (
                  <div className="flex justify-between gap-3"><span>Quedó a favor del cliente{d.saldo_favor_usado ? " (ya lo usó)" : ""}</span><span className="shrink-0 whitespace-nowrap font-semibold tabular-nums">{formatGs(n.a_favor)}</span></div>
                ) : null}
              </div>
            </div>
            {error ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
          </div>
        )}
      </ModalDocumento>
      {anular && n ? (
        <PedirMotivo
          titulo={`Anular ${n.numero}`}
          descripcion={<>Lo que había vuelto al stock sale de nuevo{n.a_cuenta > 0 ? ", la deuda vuelve a la venta" : ""}{n.devuelto > 0 ? ", la devolución sale del arqueo de la caja" : ""}{n.a_favor > 0 ? " y se quita el saldo a favor" : ""}.</>}
          confirmar="Anular nota"
          onClose={() => setAnular(false)}
          onConfirmar={async (motivo) => {
            await apiFetch(`/api/notas-credito/${n.id}/anular`, { method: "POST", body: JSON.stringify({ motivo }) });
            invalidarCajas();
            setAnular(false);
            await cargar();
            onCambio?.();
          }}
        />
      ) : null}
    </>
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
