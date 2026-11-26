"use client";

/**
 * Registrar un pago a un proveedor (orden de pago). Espejo de RegistrarCobro:
 * arriba lo que se le debe y lo vencido; abajo sus facturas abiertas con casilla y monto
 * editable (por defecto todo, lo más viejo primero; "¿Cuánto le pagás?" reparte solo
 * desde la factura que vence primero). Uno o varios medios de pago; el efectivo sale de
 * la caja abierta y solo en Gs. Al confirmar: aviso con el número de la orden de pago y
 * "Imprimir orden de pago".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, Plus, Printer, Trash2, X } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { abrirArchivo } from "@/erp2/lib/api/client-blob";
import { clienteConfig } from "@/erp2/cliente.config";
import { ALTO_MAX_MODAL, CapaModal } from "@/erp2/components/CapaModal";
import { Select } from "@/erp2/components/Select";
import MontoInput from "@/erp2/components/ui/MontoInput";
import {
  METODOS_PAGO_PROV, dinero, redondear, type EstadoCuentaProveedor, type MetodoPagoProv, type Moneda,
} from "@/erp2/modules/compras/pagos";

const BRAND = clienteConfig.color;
const INPUT = "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";
const ET = "mb-1 block text-xs font-medium text-slate-600";
const dia = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}`;
const PIDE_REFERENCIA: MetodoPagoProv[] = ["transferencia", "cheque"];

type Medio = { key: number; metodo: MetodoPagoProv; monto: number; referencia: string };
export type PagoHecho = { id: string; numero: string; total: number; moneda: Moneda };

export function RegistrarPagoProveedor({ proveedorId, proveedorNombre, moneda: monedaInicial, cxpInicial, onClose, onHecho }: {
  proveedorId: string;
  proveedorNombre: string;
  moneda?: Moneda;
  /** Pagar una factura puntual ("Pagar" en la fila): arranca solo con esa, por su saldo. */
  cxpInicial?: string | null;
  onClose: () => void;
  onHecho: (p: PagoHecho) => void;
}) {
  const [ec, setEc] = useState<EstadoCuentaProveedor | null>(null);
  const [cajaAbierta, setCajaAbierta] = useState<boolean | null>(null);
  const [moneda, setMoneda] = useState<Moneda>(monedaInicial ?? "GS");
  const [montos, setMontos] = useState<Map<string, number>>(new Map()); // cxp_id → monto a pagar (solo las marcadas)
  const [medios, setMedios] = useState<Medio[]>([{ key: 1, metodo: "transferencia", monto: 0, referencia: "" }]);
  const [observacion, setObservacion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const iniciado = useRef(false);
  // Un doble clic o un reintento tras un corte devuelve la misma orden de pago (no dos).
  const [idem] = useState(() => crypto.randomUUID());

  useEffect(() => {
    apiFetch<EstadoCuentaProveedor>(`/api/proveedores/${proveedorId}/estado-cuenta`).then(setEc).catch((e) => setError((e as Error).message));
    apiFetch<{ caja: { id: string } | null }>("/api/caja").then((r) => setCajaAbierta(!!r.caja)).catch(() => setCajaAbierta(false));
  }, [proveedorId]);

  const abiertasDe = useCallback(
    (m: Moneda) => (ec?.cuentas ?? [])
      .filter((c) => (c.estado === "pendiente" || c.estado === "parcial") && Number(c.saldo) > 0 && c.moneda === m)
      .sort((a, b) => a.vencimiento.localeCompare(b.vencimiento) || a.fecha_emision.localeCompare(b.fecha_emision) || a.numero.localeCompare(b.numero)),
    [ec],
  );
  const abiertas = useMemo(() => abiertasDe(moneda), [abiertasDe, moneda]);
  const hayGs = abiertasDe("GS").length > 0;
  const hayUsd = abiertasDe("USD").length > 0;

  /** Cambia de moneda proponiendo pagar todo lo de esa moneda (lo más viejo primero). */
  const elegirMoneda = useCallback((m: Moneda) => {
    setMoneda(m);
    setMontos(new Map(abiertasDe(m).map((c) => [c.id, Number(c.saldo)])));
  }, [abiertasDe]);

  // Selección inicial (una vez): la factura pedida, o todo lo que se le debe.
  useEffect(() => {
    if (!ec || iniciado.current) return;
    iniciado.current = true;
    const ini = cxpInicial ? ec.cuentas.find((c) => c.id === cxpInicial && Number(c.saldo) > 0 && (c.estado === "pendiente" || c.estado === "parcial")) : undefined;
    if (ini) {
      setMoneda(ini.moneda);
      setMontos(new Map([[ini.id, Number(ini.saldo)]]));
      return;
    }
    elegirMoneda(!monedaInicial && !hayGs && hayUsd ? "USD" : moneda);
  }, [ec, cxpInicial, elegirMoneda, monedaInicial, hayGs, hayUsd, moneda]);

  // El efectivo solo con caja abierta y en Gs.
  const motivoSinEfectivo = moneda !== "GS"
    ? "El efectivo de la caja es en guaraníes: un pago en USD va por transferencia, cheque u otro medio."
    : cajaAbierta === false ? "Para pagar en efectivo abrí la caja primero (el efectivo sale de la caja)." : null;
  const efectivoOk = !motivoSinEfectivo && cajaAbierta === true;
  useEffect(() => {
    if (!efectivoOk) setMedios((ms) => ms.map((x) => (x.metodo === "efectivo" ? { ...x, metodo: "transferencia" } : x)));
  }, [efectivoOk]);
  const opcionesMedio = METODOS_PAGO_PROV.filter((m) => m.v !== "efectivo" || efectivoOk).map((m): [string, string] => [m.v, m.l]);

  const deuda = abiertas.reduce((a, c) => a + Number(c.saldo), 0);
  const vencido = abiertas.filter((c) => c.dias_atraso > 0).reduce((a, c) => a + Number(c.saldo), 0);
  const total = redondear(abiertas.reduce((a, c) => a + (montos.get(c.id) ?? 0), 0), moneda);
  const marcadas = abiertas.filter((c) => montos.has(c.id)).length;
  const decimales = moneda === "USD";
  const din = useCallback((v: number) => dinero(v, moneda), [moneda]);

  // Con un solo medio, su monto acompaña al total.
  useEffect(() => {
    setMedios((ms) => (ms.length === 1 ? [{ ...ms[0], monto: total }] : ms));
  }, [total]);

  /** "¿Cuánto le pagás?": reparte desde lo que vence primero. */
  function repartir(monto: number) {
    let resto = redondear(Math.min(monto, deuda), moneda);
    const m = new Map<string, number>();
    for (const c of abiertas) {
      if (resto <= 0) break;
      const a = redondear(Math.min(Number(c.saldo), resto), moneda);
      m.set(c.id, a);
      resto = redondear(resto - a, moneda);
    }
    setMontos(m);
  }
  function alternar(id: string, saldo: number) {
    setMontos((m) => { const n = new Map(m); if (n.has(id)) n.delete(id); else n.set(id, saldo); return n; });
  }
  function cambiarMonto(id: string, v: number, saldo: number) {
    setMontos((m) => { const n = new Map(m); if (v > 0) n.set(id, Math.min(v, saldo)); else n.delete(id); return n; });
  }

  const sumaMedios = redondear(medios.reduce((a, p) => a + (p.monto || 0), 0), moneda);
  const diferencia = redondear(total - sumaMedios, moneda);
  const faltan = [
    !(total > 0) && "elegir qué facturas pagás",
    diferencia !== 0 && (diferencia > 0 ? `asignar ${din(diferencia)} a un medio de pago` : `bajar ${din(-diferencia)} de los medios de pago`),
    medios.some((p) => p.monto > 0 && PIDE_REFERENCIA.includes(p.metodo) && !p.referencia.trim()) && "el número de la transferencia o del cheque",
    medios.some((p) => p.metodo === "efectivo" && p.monto > 0) && !efectivoOk && "cambiar el efectivo por otro medio",
  ].filter(Boolean) as string[];

  async function registrar() {
    if (faltan.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<PagoHecho>("/api/pagos-proveedores", {
        method: "POST",
        body: JSON.stringify({
          proveedor_id: proveedorId,
          moneda,
          medios: medios.filter((p) => p.monto > 0).map((p) => ({ metodo: p.metodo, monto: redondear(p.monto, moneda), referencia: p.referencia.trim() || null })),
          aplicaciones: abiertas.filter((c) => montos.has(c.id)).map((c) => ({ cxp_id: c.id, monto: redondear(montos.get(c.id) ?? 0, moneda) })),
          observacion: observacion.trim() || null,
          idempotency_key: idem,
        }),
      });
      onHecho({ ...r, total: Number(r.total), moneda: (r.moneda ?? moneda) as Moneda });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <CapaModal onClose={busy ? undefined : onClose} z="z-[115]">
      <div onClick={(e) => e.stopPropagation()} className={`flex w-full max-w-2xl ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`} style={{ animation: "rb-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900">Registrar pago</h2>
            <p className="truncate text-sm text-slate-500">{proveedorNombre}</p>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Cerrar" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
          {!ec ? (
            error ? <p className="text-sm text-rose-600">{error}</p> : <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
          ) : (
            <div className="space-y-6">
              {hayGs && hayUsd ? (
                <div className="flex rounded-xl bg-slate-100 p-1">
                  {(["GS", "USD"] as const).map((m) => (
                    <button key={m} type="button" onClick={() => elegirMoneda(m)}
                      className={`flex-1 rounded-lg py-1.5 text-sm font-semibold transition max-sm:min-h-10 ${moneda === m ? "bg-white shadow-sm" : "text-slate-500"}`}
                      style={moneda === m ? { color: BRAND } : undefined}>{m === "GS" ? "Deuda en guaraníes" : "Deuda en dólares"}</button>
                  ))}
                </div>
              ) : null}

              {abiertas.length === 0 ? (
                <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  <strong className="font-semibold">No le debés nada a este proveedor{moneda === "USD" ? " en dólares" : ""}.</strong> Las compras a crédito aparecen acá para pagarlas.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="min-w-0 rounded-xl bg-slate-50 px-3 py-3 sm:px-4">
                      <p className="text-[11px] text-slate-500">Le debés en total</p>
                      <p className="text-lg font-bold tabular-nums text-slate-900 [overflow-wrap:anywhere]">{din(deuda)}</p>
                    </div>
                    <div className={`min-w-0 rounded-xl px-3 py-3 sm:px-4 ${vencido > 0 ? "bg-rose-50" : "bg-slate-50"}`}>
                      <p className={`text-[11px] ${vencido > 0 ? "text-rose-600" : "text-slate-500"}`}>Vencido</p>
                      <p className={`text-lg font-bold tabular-nums [overflow-wrap:anywhere] ${vencido > 0 ? "text-rose-600" : "text-slate-900"}`}>{din(vencido)}</p>
                    </div>
                  </div>

                  <div>
                    <span className={ET}>¿Cuánto le pagás? <span className="font-normal text-slate-400">(se aplica desde lo que vence primero)</span></span>
                    <MontoInput value={total || ""} onChange={repartir} decimals={decimales} enterKeyHint="done" aria-label="¿Cuánto le pagás?" className={`${INPUT} text-right text-lg font-bold tabular-nums`} />
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <Chip on={total === redondear(deuda, moneda)} onClick={() => repartir(deuda)}>Todo · {din(deuda)}</Chip>
                      {vencido > 0 && vencido < deuda ? <Chip on={total === redondear(vencido, moneda)} onClick={() => repartir(vencido)}>Solo lo vencido · {din(vencido)}</Chip> : null}
                    </div>
                    {total > 0 && total < deuda ? <p className="mt-1 text-[11px] text-slate-500">Le vas a quedar debiendo {din(deuda - total)}.</p> : null}
                  </div>

                  <div>
                    <span className={ET}>Facturas que pagás <span className="font-normal text-slate-400">· {marcadas} de {abiertas.length} · {din(total)}</span></span>
                    <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                      {abiertas.map((c) => {
                        const marcada = montos.has(c.id);
                        const aplicado = montos.get(c.id) ?? 0;
                        const queda = redondear(Number(c.saldo) - aplicado, moneda);
                        return (
                          <li key={c.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:flex-nowrap ${marcada ? "bg-[var(--brand-50)]/40" : ""}`}>
                            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                            <input type="checkbox" checked={marcada} onChange={() => alternar(c.id, Number(c.saldo))} aria-label={`Pagar factura ${c.numero}`} className="h-4 w-4 shrink-0 accent-[var(--brand)] max-sm:h-5 max-sm:w-5" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-slate-800">
                                <span className="font-mono text-xs">{c.numero}</span>
                                <span className="ml-2 text-xs text-slate-500 max-sm:ml-0 max-sm:block">{c.compra_numero} · del {dia(c.fecha_emision)} · vence {dia(c.vencimiento)}</span>
                              </p>
                              <p className="text-[11px] text-slate-500">
                                Saldo {din(c.saldo)}
                                {c.dias_atraso > 0 ? <span className="font-semibold text-rose-600"> · {c.dias_atraso} días de atraso</span> : null}
                                {marcada && queda > 0 ? <span> · queda {din(queda)}</span> : null}
                                {marcada && queda <= 0 ? <span className="font-semibold text-emerald-700"> · queda pagada</span> : null}
                              </p>
                            </div>
                            </label>
                            <div className="w-36 shrink-0 max-sm:w-full max-sm:pl-8">
                              <MontoInput value={marcada ? aplicado : ""} onChange={(v) => cambiarMonto(c.id, v, Number(c.saldo))} decimals={decimales} placeholder="0"
                                aria-label={`Monto para ${c.numero}`} enterKeyHint="done" className={`${INPUT} py-1.5 text-right tabular-nums max-sm:py-2.5`} />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  <div>
                    <span className={ET}>Cómo le pagás</span>
                    <ul className="space-y-2">
                      {medios.map((p) => (
                        <li key={p.key} className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                          <div className="min-w-0 sm:w-36 sm:shrink-0">
                            <Select etiqueta="Medio de pago" value={p.metodo} onChange={(v) => setMedios((ms) => ms.map((x) => (x.key === p.key ? { ...x, metodo: v as MetodoPagoProv } : x)))} block options={opcionesMedio} />
                          </div>
                          <MontoInput value={p.monto || ""} onChange={(v) => setMedios((ms) => ms.map((x) => (x.key === p.key ? { ...x, monto: v } : x)))} decimals={decimales} placeholder="0" aria-label="Monto de este medio" enterKeyHint="done" className={`${INPUT} min-w-0 text-right tabular-nums sm:min-w-[120px] sm:flex-1`} />
                          {p.metodo !== "efectivo" || medios.length > 1 ? (
                          <div className="col-span-2 flex items-center justify-end gap-2 sm:contents">
                          {p.metodo !== "efectivo" ? (
                            <input value={p.referencia} onChange={(e) => setMedios((ms) => ms.map((x) => (x.key === p.key ? { ...x, referencia: e.target.value } : x)))} maxLength={120}
                              enterKeyHint="done" placeholder={p.metodo === "cheque" ? "Nº de cheque / banco" : p.metodo === "transferencia" ? "Nº de transferencia" : "Referencia"} className={`${INPUT} min-w-0 flex-1 sm:w-44 sm:flex-none`} />
                          ) : null}
                          {medios.length > 1 ? (
                            <button onClick={() => setMedios((ms) => ms.filter((x) => x.key !== p.key))} aria-label="Quitar medio" className="inline-flex shrink-0 items-center justify-center rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 max-sm:h-11 max-sm:w-11"><Trash2 className="h-4 w-4" /></button>
                          ) : null}
                          </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <button type="button" onClick={() => setMedios((ms) => [...ms, { key: Date.now(), metodo: "transferencia", monto: Math.max(diferencia, 0), referencia: "" }])}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)] hover:underline max-sm:min-h-11 max-sm:text-[13px]">
                        <Plus className="h-3.5 w-3.5" /> Agregar otro medio (pago combinado)
                      </button>
                      {diferencia !== 0 && medios.length > 1 ? (
                        <span className="text-xs font-semibold text-amber-600">{diferencia > 0 ? `Falta asignar ${din(diferencia)}` : `Sobran ${din(-diferencia)}`}</span>
                      ) : null}
                    </div>
                    {motivoSinEfectivo ? (
                      <p className="mt-1.5 text-[11px] text-slate-500">Efectivo no disponible: {motivoSinEfectivo}</p>
                    ) : medios.some((p) => p.metodo === "efectivo" && p.monto > 0) ? (
                      <p className="mt-1.5 text-[11px] text-slate-400">El efectivo sale de la caja abierta (queda como «Pago a proveedor» en el cierre).</p>
                    ) : null}
                  </div>

                  <label className="block">
                    <span className={ET}>Observación <span className="font-normal text-slate-400">(opcional)</span></span>
                    <input value={observacion} onChange={(e) => setObservacion(e.target.value)} maxLength={1000} enterKeyHint="done" placeholder="Ej: pago acordado con el vendedor" className={INPUT} />
                  </label>

                  {faltan.length ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Falta: {faltan.join(", ")}.</p> : null}
                </>
              )}
              {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 max-sm:flex-1">Cancelar</button>
          <button onClick={registrar} disabled={!!faltan.length || busy || !ec || abiertas.length === 0}
            className="inline-flex min-w-0 items-center justify-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-40 max-sm:flex-[2] max-sm:px-3" style={{ backgroundColor: BRAND }}>
            {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
            <span className="truncate">{busy ? "Registrando…" : `Pagar ${din(total)}`}</span>
          </button>
        </div>
      </div>
    </CapaModal>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-full border px-3 py-1 text-xs font-semibold transition max-sm:min-h-10 max-sm:py-1.5 ${on ? "border-[var(--brand)] bg-[var(--brand-50)] text-[var(--brand)]" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
      {children}
    </button>
  );
}

/** Imprimir (abrir) la orden de pago en PDF. */
export function imprimirOrdenPago(id: string, numero: string) {
  return abrirArchivo(`/api/pagos-proveedores/${id}/pdf`, `orden-de-pago-${numero}.pdf`);
}

/**
 * Aviso (toast) "Orden de pago OP-000012 registrada" con "Imprimir orden de pago".
 * Lo usan la pantalla de Pagos, la ficha del proveedor y el detalle de la compra.
 */
export function useAvisoPago() {
  const [aviso, setAviso] = useState<(PagoHecho & { k: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const avisar = useCallback((p: PagoHecho) => {
    if (timer.current) clearTimeout(timer.current);
    setAviso({ ...p, k: Date.now() });
    timer.current = setTimeout(() => setAviso(null), 12000);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const nodo = aviso ? (
    <div key={aviso.k} role="status"
      className="fixed bottom-5 right-5 z-[130] flex max-w-sm items-start gap-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm text-slate-800 shadow-lg max-sm:inset-x-3 max-sm:bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] max-sm:max-w-none"
      style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Orden de pago {aviso.numero} registrada</p>
        <p className="text-xs text-slate-500">Por {dinero(aviso.total, aviso.moneda)}. Ya se descontó de la deuda.</p>
        <button onClick={() => imprimirOrdenPago(aviso.id, aviso.numero).catch(() => {})}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white max-sm:min-h-11 max-sm:px-4 max-sm:text-sm" style={{ backgroundColor: BRAND }}>
          <Printer className="h-3.5 w-3.5" /> Imprimir orden de pago
        </button>
      </div>
      <button type="button" onClick={() => setAviso(null)} aria-label="Cerrar aviso" className="inline-flex shrink-0 items-center justify-center text-slate-400 hover:text-slate-600 max-sm:-mr-2 max-sm:-mt-2 max-sm:h-11 max-sm:w-11"><X className="h-4 w-4" /></button>
    </div>
  ) : null;
  return { nodo, avisar };
}
