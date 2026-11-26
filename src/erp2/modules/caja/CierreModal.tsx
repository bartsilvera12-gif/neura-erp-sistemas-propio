"use client";

/**
 * Cierre de caja con ARQUEO por forma de pago:
 *   · efectivo: se CUENTA (a mano o billete por billete) contra lo que debería haber
 *   · débito, crédito, transferencia, QR, cheque: se CONFIRMAN contra el cierre del POS /
 *     el extracto (vienen cargados con lo esperado; si no coincide, se corrige)
 *   · cualquier diferencia pide el motivo
 * Al lado, el resumen del turno: ventas contado por forma de pago, crédito otorgado, cobros,
 * egresos, retiros e ingresos. Cerrado: el resultado y el PDF del cierre.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, Lock, Printer } from "lucide-react";
import MontoInput from "@/erp2/components/ui/MontoInput";
import { imprimirArchivo } from "@/erp2/lib/api/client-blob";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, ET, INPUT, ModalDocumento, TEAL } from "@/erp2/modules/inventario/ui";
import { cerrarCaja, DENOMINACIONES, fechaHora, getResumenTurno, type ResumenTurno } from "@/erp2/modules/caja/turno";
import { formatGs } from "@/erp2/modules/caja/lib";

const gsSigno = (v: number) => (v === 0 ? formatGs(0) : `${v > 0 ? "+ " : "− "}${formatGs(Math.abs(v))}`);

export function CierreModal({ turnoId, onClose, onCerrada }: { turnoId: string; onClose: () => void; onCerrada: () => void }) {
  const [r, setR] = useState<ResumenTurno | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [contado, setContado] = useState<number | null>(null);
  const [porBillete, setPorBillete] = useState(false);
  const [billetes, setBilletes] = useState<Record<string, number>>({});
  const [declarado, setDeclarado] = useState<Record<string, number>>({});
  const [motivo, setMotivo] = useState("");
  const [obs, setObs] = useState("");
  const [verDetalle, setVerDetalle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<{ diferencia: number; diferencia_otros: number } | null>(null);

  useEffect(() => {
    getResumenTurno(turnoId)
      .then((d) => {
        setR(d);
        const dec: Record<string, number> = {};
        for (const m of d.metodos) if (m.metodo !== "efectivo") dec[m.metodo] = m.esperado;
        setDeclarado(dec);
      })
      .catch((e) => setErrorCarga((e as Error).message));
  }, [turnoId]);

  const totalBilletes = useMemo(() => Object.entries(billetes).reduce((a, [d, n]) => a + Number(d) * (n || 0), 0), [billetes]);
  const efectivoContado = porBillete ? totalBilletes : contado;
  const otros = (r?.metodos ?? []).filter((m) => m.metodo !== "efectivo");
  const esperado = r?.efectivo.esperado ?? 0;
  const difEfectivo = efectivoContado == null ? null : efectivoContado - esperado;
  const difOtros = otros.reduce((a, m) => a + ((declarado[m.metodo] ?? m.esperado) - m.esperado), 0);
  const hayDiferencia = (difEfectivo ?? 0) !== 0 || difOtros !== 0;
  const falta = efectivoContado == null ? "contar el efectivo" : hayDiferencia && !motivo.trim() ? "el motivo de la diferencia" : null;

  async function cerrar() {
    if (!r || falta || busy || efectivoContado == null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await cerrarCaja({
        caja_id: turnoId,
        monto_cierre_contado: efectivoContado,
        declarado,
        billetes: porBillete ? Object.fromEntries(Object.entries(billetes).filter(([, n]) => n > 0)) : null,
        motivo_diferencia: hayDiferencia ? motivo.trim() : null,
        observacion: obs.trim() || null,
      });
      setHecho({ diferencia: res.diferencia, diferencia_otros: res.diferencia_otros });
      onCerrada();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const pdf = () =>
    imprimirArchivo(`/api/caja/turnos/${turnoId}/pdf`, `cierre-caja-${r?.caja.numero_caja ?? ""}.pdf`).catch((e) => setError((e as Error).message));

  const titulo = r ? `Cerrar ${r.caja.punto_nombre} · ${r.caja.sucursal_nombre}` : "Cerrar caja";
  const subtitulo = r ? `Turno N° ${r.caja.numero_caja} · abierta ${fechaHora(r.caja.fecha_apertura)} por ${r.caja.abierta_por_nombre ?? "—"}` : undefined;

  if (hecho && r) {
    const total = hecho.diferencia + hecho.diferencia_otros;
    return (
      <ModalDocumento titulo="Caja cerrada" subtitulo={`${r.caja.punto_nombre} · ${r.caja.sucursal_nombre} · Turno N° ${r.caja.numero_caja}`} ancho="max-w-md" onClose={onClose}
        footer={
          <>
            <button type="button" onClick={onClose} className={`${BOTON_SECUNDARIO} max-sm:flex-1`}>Listo</button>
            <button type="button" onClick={pdf} className={`${BOTON_PRIMARIO} max-sm:flex-[1.4]`} style={{ backgroundColor: TEAL }}><Printer className="h-4 w-4" /> Imprimir cierre</button>
          </>
        }>
        <div className="py-4 text-center">
          {total === 0 && hecho.diferencia === 0 ? <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" /> : <AlertTriangle className="mx-auto h-14 w-14 text-amber-500" />}
          <p className="mt-3 text-lg font-semibold text-slate-900">{hecho.diferencia === 0 && hecho.diferencia_otros === 0 ? "El arqueo cuadró" : "Cerrada con diferencias"}</p>
          <div className="mx-auto mt-3 max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Efectivo</span><span className={`font-semibold tabular-nums ${hecho.diferencia === 0 ? "text-emerald-700" : hecho.diferencia < 0 ? "text-rose-600" : "text-amber-600"}`}>{hecho.diferencia === 0 ? "Cuadra" : gsSigno(hecho.diferencia)}</span></div>
            {otros.length ? <div className="flex justify-between"><span className="text-slate-500">Otras formas de pago</span><span className={`font-semibold tabular-nums ${hecho.diferencia_otros === 0 ? "text-emerald-700" : "text-rose-600"}`}>{hecho.diferencia_otros === 0 ? "Cuadran" : gsSigno(hecho.diferencia_otros)}</span></div> : null}
          </div>
          <p className="mt-4 text-xs text-slate-500">Ya no se puede vender ni mover efectivo en esta caja hasta abrir un turno nuevo.</p>
        </div>
      </ModalDocumento>
    );
  }

  return (
    <ModalDocumento titulo={titulo} subtitulo={subtitulo} ancho="max-w-5xl" onClose={busy ? undefined : onClose}
      footer={
        <>
          {error ? <p className="mr-auto max-w-md text-xs font-medium text-rose-600 max-sm:w-full">{error}</p> : falta && r ? <p className="mr-auto text-xs text-slate-500 max-sm:w-full">Falta {falta}.</p> : null}
          {/* Celular: el PDF queda como ícono; "Cerrar caja" ocupa el resto. */}
          <button type="button" onClick={pdf} disabled={!r} className={`${BOTON_SECUNDARIO} max-sm:w-11 max-sm:px-0`} title="Imprimir arqueo parcial (sin cerrar)" aria-label="Imprimir arqueo parcial"><Printer className="h-4 w-4" /> <span className="max-sm:hidden">Arqueo parcial</span></button>
          <button type="button" onClick={onClose} disabled={busy} className={`${BOTON_SECUNDARIO} max-sm:flex-1`}>Cancelar</button>
          <button type="button" onClick={cerrar} disabled={!r || !!falta || busy} className={`${BOTON_PRIMARIO} bg-rose-600 max-sm:flex-[1.4]`}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} Cerrar caja
          </button>
        </>
      }>
      {!r ? (
        errorCarga ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{errorCarga}</p> : <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
          {/* ── ARQUEO ─────────────────────────────────────────────── */}
          <div className="space-y-5">
            <section className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-sky-800">Efectivo · se cuenta</p>
                  <p className="mt-0.5 text-xs text-sky-900/70">Debería haber en el cajón</p>
                </div>
                <p className="text-2xl font-extrabold tabular-nums text-sky-950">{formatGs(esperado)}</p>
              </div>
              <button type="button" onClick={() => setVerDetalle((v) => !v)} className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-sky-800 hover:underline max-sm:min-h-10 max-sm:text-xs">
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${verDetalle ? "rotate-180" : ""}`} /> {verDetalle ? "Ocultar" : "Ver"} de dónde sale
              </button>
              {verDetalle ? <DetalleEfectivo r={r} /> : null}

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-800">¿Cuánto efectivo contaste?</span>
                <div className="flex rounded-lg bg-white/80 p-0.5 text-[11px] font-semibold ring-1 ring-sky-200">
                  <button type="button" onClick={() => setPorBillete(false)} className={`rounded-md px-2.5 py-1 max-sm:min-h-10 max-sm:px-3.5 max-sm:text-xs ${!porBillete ? "bg-sky-600 text-white" : "text-sky-800"}`}>Total</button>
                  <button type="button" onClick={() => setPorBillete(true)} className={`rounded-md px-2.5 py-1 max-sm:min-h-10 max-sm:px-3.5 max-sm:text-xs ${porBillete ? "bg-sky-600 text-white" : "text-sky-800"}`}>Por billete</button>
                </div>
              </div>
              {porBillete ? (
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-1.5">
                  {DENOMINACIONES.map((d) => (
                    <label key={d} className="rounded-lg bg-white px-2 py-1.5 ring-1 ring-sky-100">
                      <span className="block text-[10px] font-semibold text-slate-500">{d.toLocaleString("es-PY")}</span>
                      <input inputMode="numeric" pattern="[0-9]*" enterKeyHint="next" value={billetes[d] ? String(billetes[d]) : ""} placeholder="0"
                        onChange={(e) => setBilletes((b) => ({ ...b, [d]: Math.min(99999, parseInt(e.target.value.replace(/\D/g, "")) || 0) }))}
                        className="w-full bg-transparent text-sm font-bold tabular-nums text-slate-900 outline-none" />
                    </label>
                  ))}
                  <p className="col-span-full mt-1 text-right text-sm font-bold tabular-nums text-sky-950">Contado: {formatGs(totalBilletes)}</p>
                </div>
              ) : (
                <MontoInput value={contado ?? ""} onChange={(n) => setContado(Math.max(0, Math.round(n)))} decimals={false} autoFocus placeholder="Contá los billetes y monedas"
                  className={`${INPUT} mt-2 text-right text-xl font-bold tabular-nums`} />
              )}
              {difEfectivo != null ? <Resultado diferencia={difEfectivo} /> : null}
            </section>

            {otros.length ? (
              <section className="rounded-2xl border border-slate-200 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Otras formas de pago · se confirman</p>
                <p className="mt-0.5 text-xs text-slate-500">Compará con el cierre del POS, el extracto o la app del banco. Si algo no coincide, corregí el monto.</p>
                <ul className="mt-3 divide-y divide-slate-100">
                  {otros.map((m) => {
                    const dec = declarado[m.metodo] ?? m.esperado;
                    const dif = dec - m.esperado;
                    return (
                      // Celular: el nombre arriba a todo el ancho; monto y estado debajo.
                      <li key={m.metodo} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 sm:flex-nowrap sm:py-2">
                        <div className="min-w-0 flex-1 max-sm:basis-full">
                          <p className="text-sm font-medium text-slate-800">{m.label}</p>
                          <p className="text-[11px] text-slate-500">Esperado {formatGs(m.esperado)}{m.egresos ? ` (salidas ${formatGs(m.egresos)})` : ""}</p>
                        </div>
                        <MontoInput value={dec} onChange={(n) => setDeclarado((d) => ({ ...d, [m.metodo]: Math.max(0, Math.round(n)) }))} decimals={false}
                          className={`w-36 rounded-lg border px-3 py-1.5 text-right text-sm font-semibold tabular-nums outline-none focus:ring-2 max-sm:h-11 max-sm:min-w-0 max-sm:flex-1 ${dif === 0 ? "border-slate-200" : "border-amber-300 bg-amber-50"}`} />
                        <span className={`w-28 text-right text-xs font-semibold tabular-nums ${dif === 0 ? "text-emerald-600" : "text-rose-600"}`}>{dif === 0 ? "✓ Confirmado" : gsSigno(dif)}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            {hayDiferencia ? (
              <label className="block">
                <span className={ET}>Motivo de la diferencia <span className="text-rose-500">*</span></span>
                <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={500} className={`${INPUT} resize-none`}
                  placeholder="Ej. se dio mal un vuelto; un voucher de débito no entró en el lote" />
              </label>
            ) : null}
            <label className="block">
              <span className={ET}>Observación <span className="font-normal text-slate-400">(opcional)</span></span>
              <input value={obs} onChange={(e) => setObs(e.target.value)} maxLength={500} className={INPUT} />
            </label>
          </div>

          {/* ── RESUMEN DEL TURNO ──────────────────────────────────── */}
          <ResumenTurnoPanel r={r} />
        </div>
      )}
    </ModalDocumento>
  );
}

function Resultado({ diferencia }: { diferencia: number }) {
  const tono = diferencia === 0 ? "border-emerald-200 bg-emerald-50 text-emerald-800" : diferencia > 0 ? "border-amber-200 bg-amber-50 text-amber-800" : "border-rose-200 bg-rose-50 text-rose-800";
  return (
    <div className={`mt-2 flex items-center justify-between rounded-xl border px-4 py-2.5 ${tono}`}>
      <span className="text-sm font-semibold">{diferencia === 0 ? "Cuadra justo" : diferencia > 0 ? "Sobra efectivo" : "Falta efectivo"}</span>
      <span className="text-lg font-extrabold tabular-nums">{diferencia === 0 ? "✓" : gsSigno(diferencia)}</span>
    </div>
  );
}

function DetalleEfectivo({ r }: { r: ResumenTurno }) {
  const e = r.efectivo;
  const filas: [string, number, boolean][] = [
    ["Monto inicial", e.apertura, false],
    ["Ventas en efectivo", e.ventas, false],
    ["Cobros en efectivo", e.cobros, false],
    ["Ingresos de efectivo", e.ingresos, false],
    ["Compras", -e.compras, true],
    ["Gastos", -e.gastos, true],
    ["Pagos a proveedores", -e.pagos_proveedores, true],
    ["Devoluciones", -e.devoluciones, true],
    ["Otros egresos", -e.egresos_manuales, true],
    ["Retiros", -e.retiros, true],
    ["Ajustes", e.ajustes, true],
  ];
  return (
    <ul className="mt-2 space-y-0.5 rounded-lg bg-white/70 px-3 py-2 text-xs">
      {filas.filter(([, v, opc], i) => i < 2 || !opc || v !== 0).map(([l, v]) => (
        <li key={l} className="flex justify-between text-slate-600"><span>{l}</span><span className="tabular-nums">{gsSigno(v)}</span></li>
      ))}
    </ul>
  );
}

/** Resumen del turno (cierre y detalle de un turno). */
export function ResumenTurnoPanel({ r }: { r: ResumenTurno }) {
  const egresos: [string, { cantidad: number; total: number }][] = [
    ["Compras en efectivo", r.egresos.compras],
    ["Gastos en efectivo", r.egresos.gastos],
    ["Pagos a proveedores", r.egresos.pagos_proveedores],
    ["Devoluciones", r.egresos.devoluciones],
  ];
  return (
    <div className="space-y-4">
      <Bloque titulo="Ventas del turno" total={r.ventas.total} sub={`${r.ventas.cantidad} venta${r.ventas.cantidad === 1 ? "" : "s"}`}>
        <Linea label={`Contado (${r.ventas.contado.cantidad})`} valor={r.ventas.contado.total} fuerte />
        {r.ventas.por_metodo.map((m) => <Linea key={m.metodo} label={m.label} valor={m.total} sangria />)}
        <Linea label={`Crédito (${r.ventas.credito.cantidad})`} valor={r.ventas.credito.total} fuerte />
        {r.ventas.anuladas.cantidad ? <Linea label={`Anuladas (${r.ventas.anuladas.cantidad})`} valor={r.ventas.anuladas.total} gris /> : null}
      </Bloque>

      {r.credito.ventas.length ? (
        <Bloque titulo="Crédito otorgado" total={r.credito.total} sub={`${r.credito.cantidad} venta${r.credito.cantidad === 1 ? "" : "s"}`}>
          {r.credito.ventas.slice(0, 6).map((v) => (
            <div key={v.venta_id} className={`flex items-center justify-between gap-2 py-0.5 text-xs ${v.estado === "anulada" ? "text-slate-400 line-through" : "text-slate-600"}`}>
              <span className="min-w-0 truncate"><span className="font-mono">{v.numero_control}</span> · {v.cliente_nombre ?? "—"}</span>
              <span className="shrink-0 tabular-nums">{formatGs(v.total)}{v.vencimiento ? <span className="ml-1 text-slate-400">vence {v.vencimiento.slice(8, 10)}/{v.vencimiento.slice(5, 7)}</span> : null}</span>
            </div>
          ))}
          {r.credito.ventas.length > 6 ? <p className="text-[11px] text-slate-400">y {r.credito.ventas.length - 6} más (en el PDF y en Ventas a crédito)</p> : null}
        </Bloque>
      ) : null}

      <Bloque titulo="Cobros de cuentas" total={r.cobros.total} sub={`${r.cobros.cantidad} recibo${r.cobros.cantidad === 1 ? "" : "s"}`}>
        {r.cobros.por_metodo.length ? r.cobros.por_metodo.map((m) => <Linea key={m.metodo} label={m.label} valor={m.total} sangria />) : <p className="text-xs text-slate-400">Sin cobros en este turno.</p>}
      </Bloque>

      <Bloque titulo="Salidas e ingresos de efectivo" total={r.manuales.ingresos.total - (r.egresos.total + r.manuales.retiros.total + r.manuales.egresos.total)}>
        {egresos.filter(([, v]) => v.cantidad).map(([l, v]) => <Linea key={l} label={`${l} (${v.cantidad})`} valor={-v.total} />)}
        {r.manuales.egresos.cantidad ? <Linea label={`Otros egresos (${r.manuales.egresos.cantidad})`} valor={-r.manuales.egresos.total} /> : null}
        <Linea label={`Retiros (${r.manuales.retiros.cantidad})`} valor={-r.manuales.retiros.total} />
        <Linea label={`Ingresos de efectivo (${r.manuales.ingresos.cantidad})`} valor={r.manuales.ingresos.total} />
      </Bloque>
    </div>
  );
}

function Bloque({ titulo, total, sub, children }: { titulo: string; total: number; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{titulo}{sub ? <span className="ml-1.5 normal-case tracking-normal text-slate-400">· {sub}</span> : null}</p>
        <p className="text-sm font-bold tabular-nums" style={{ color: TEAL }}>{formatGs(total)}</p>
      </div>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

function Linea({ label, valor, fuerte, sangria, gris }: { label: string; valor: number; fuerte?: boolean; sangria?: boolean; gris?: boolean }) {
  return (
    <div className={`flex justify-between text-xs ${fuerte ? "font-semibold text-slate-800" : gris ? "text-slate-400" : "text-slate-600"} ${sangria ? "pl-3" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{valor < 0 ? `− ${formatGs(-valor)}` : formatGs(valor)}</span>
    </div>
  );
}
