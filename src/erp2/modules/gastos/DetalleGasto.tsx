"use client";

/**
 * Detalle de un gasto operativo (modal): datos fiscales (o "sin comprobante"), sucursal, moneda,
 * pago (medio y cuenta de origen), líneas con Rubro › Subcategoría / sucursal / empleado, totales
 * por tasa de IVA, la deuda con el proveedor (con sus pagos) o el egreso de caja, los adjuntos
 * (varios: ver / adjuntar / quitar), notas y quién lo cargó y lo aprobó (confirmó).
 * Acciones: borrador → abrir y confirmar / eliminar · confirmado → anular (con motivo).
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, CalendarClock, Eye, FileText, Image as ImageIcon, Loader2, Paperclip, Pencil, Trash2, X } from "lucide-react";
import { apiFetch, apiForm } from "@/erp2/lib/api/client-fetch";
import { TZ_PY } from "@/erp2/lib/fecha/paraguay";
import { ALTO_MAX_MODAL, CapaModal } from "@/erp2/components/CapaModal";
import { ACCEPT_COMPROBANTE, tamano, validarComprobante } from "@/erp2/modules/compras/Comprobantes";
import { ESTADO_CXP } from "@/erp2/modules/compras/pagos";
import { ESTADO_GASTO, fechaCorta, gs, monto, nombreMedioGasto, type DetalleGasto as Detalle } from "@/erp2/modules/gastos/tipos";

const fechaHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "—";

export function DetalleGasto({ id, onClose, onEditar, onEliminar, onAnular, onCambio }: {
  id: string;
  onClose: () => void;
  onEditar: (id: string) => void;
  onEliminar: (d: { id: string; numero: string | null }) => void;
  onAnular: (d: { id: string; numero: string | null }) => void;
  onCambio: () => void;
}) {
  const [d, setD] = useState<Detalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const cargar = useCallback(() => {
    apiFetch<Detalle>(`/api/gastos/${id}`).then(setD).catch((e) => setError((e as Error).message));
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  async function ver(aid: string) {
    const w = window.open("", "_blank");
    if (w) w.opener = null;
    try {
      const r = await apiFetch<{ url: string }>(`/api/gastos/${id}/adjuntos/${aid}`);
      if (w) w.location.href = r.url; else window.location.href = r.url;
    } catch (e) {
      w?.close();
      setError((e as Error).message);
    }
  }

  async function adjuntar(files: File[]) {
    for (const f of files) {
      const err = validarComprobante(f);
      if (err) { setError(err); return; }
    }
    setSubiendo(true);
    setError(null);
    const fallidos: string[] = [];
    for (const f of files) {
      try {
        const fd = new FormData();
        fd.append("file", f);
        await apiForm(`/api/gastos/${id}/adjuntos`, fd);
      } catch (e) {
        fallidos.push(`${f.name}: ${(e as Error).message}`);
      }
    }
    if (fallidos.length) setError(fallidos.join(" · "));
    setSubiendo(false);
    cargar();
    onCambio();
  }

  async function quitar(aid: string) {
    setSubiendo(true);
    setError(null);
    try {
      await apiFetch(`/api/gastos/${id}/adjuntos/${aid}`, { method: "DELETE" });
      cargar();
      onCambio();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubiendo(false);
    }
  }

  const g = d?.gasto;
  const est = g ? ESTADO_GASTO[g.estado] : null;
  const m = (n: number | null | undefined) => monto(n, g?.moneda);
  const repartido = !!d && new Set(d.items.map((i) => i.sucursal_id)).size > 1;

  return (
    <CapaModal onClose={onClose}>
      <div className={`flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${ALTO_MAX_MODAL}`} style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--brand-400)]">Gasto operativo</p>
            <h2 className="mt-0.5 flex flex-wrap items-center gap-2 text-lg font-semibold text-slate-800">
              <span className="font-mono">{g?.numero ?? "Borrador"}</span>
              {est ? <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${est.c}`}>{est.t}</span> : null}
              {g && !g.con_comprobante ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Sin comprobante</span> : null}
              {g?.moneda === "USD" ? <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">USD</span> : null}
            </h2>
            {g ? <p className="text-sm text-slate-500">{g.proveedor_nombre ?? "Sin proveedor"}{g.proveedor_ruc ? ` · RUC ${g.proveedor_ruc}` : ""}</p> : null}
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm sm:px-6 sm:py-5">
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</div> : null}
          {!d || !g ? (
            !error ? <p className="py-10 text-center text-slate-400">Cargando…</p> : null
          ) : (
            <>
              {g.estado === "anulado" ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  Anulado el {fechaHora(g.anulado_at)}{g.anulado_por ? ` por ${g.anulado_por}` : ""}. Motivo: {g.anulado_motivo ?? "—"}
                </div>
              ) : null}
              {g.recurrente_id ? (
                <div className="flex items-center gap-2 rounded-xl border border-[var(--brand-400)]/30 bg-[var(--brand-400)]/5 px-3 py-2 text-xs text-[#2f6f72]">
                  <CalendarClock className="h-4 w-4 shrink-0" />
                  Generado de la plantilla <b>{g.recurrente_nombre ?? "recurrente"}</b>{g.fecha_programada ? ` · programado para el ${fechaCorta(g.fecha_programada)}` : ""}.
                </div>
              ) : null}

              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                {g.con_comprobante ? (
                  <>
                    <Dato t="Comprobante" v={[g.tipo_comprobante, g.numero_comprobante].filter(Boolean).join(" ") || "—"} mono />
                    <Dato t="Timbrado" v={g.timbrado ?? "—"} mono />
                  </>
                ) : (
                  <Dato t="Referencia" v={g.numero_comprobante ?? "—"} />
                )}
                <Dato t="Fecha" v={fechaCorta(g.fecha_comprobante ?? g.fecha)} />
                <Dato t="Sucursal" v={repartido ? `${g.sucursal_nombre ?? "—"} (repartido)` : g.sucursal_nombre ?? "—"} />
                <Dato t="Condición" v={g.tipo_pago === "credito" ? `Crédito${g.plazo_dias ? ` ${g.plazo_dias} días` : ""}` : g.tipo_pago === "contado" ? "Contado" : "—"} />
                {g.tipo_pago === "credito" ? <Dato t="Vencimiento" v={fechaCorta(g.fecha_vencimiento)} /> : <Dato t="Medio de pago" v={nombreMedioGasto(g.medio_pago)} />}
                {g.cuenta_bancaria ? <Dato t="Cuenta de origen" v={`${g.cuenta_bancaria.banco} · ${g.cuenta_bancaria.numero}${g.cuenta_bancaria.alias ? ` (${g.cuenta_bancaria.alias})` : ""}`} /> : null}
                {g.tipo_pago === "contado" && g.referencia_pago ? <Dato t="Referencia del pago" v={g.referencia_pago} /> : null}
                {g.moneda === "USD" ? <Dato t="Tipo de cambio" v={`Gs. ${Number(g.tipo_cambio).toLocaleString("es-PY")}`} /> : null}
                <Dato t="IVA" v={g.deducible ? "Deducible (crédito fiscal)" : "No deducible"} />
                {g.descripcion ? <div className="col-span-2 sm:col-span-4"><Dato t="Descripción" v={g.descripcion} /></div> : null}
              </dl>

              <div className="overflow-hidden rounded-xl border border-slate-200">
                {/* Celular: cada línea como fila de lista (categoría arriba, descripción, IVA y monto) */}
                <ul className="divide-y divide-slate-100 sm:hidden">
                  {d.items.length === 0 ? <li className="px-3 py-4 text-center text-slate-400">Sin líneas</li> : d.items.map((it, i) => (
                    <li key={it.id ?? i} className="px-3 py-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[11px] text-slate-500 [overflow-wrap:anywhere]">
                            {it.categoria_nombre ? <>{it.rubro_nombre ? <span className="text-slate-400">{it.rubro_nombre} › </span> : null}{it.categoria_nombre}</> : <span className="italic text-slate-400">Sin categoría</span>}
                            {it.tipo_costo === "fijo" ? <span className="ml-1.5 rounded bg-violet-50 px-1 py-0.5 text-[10px] font-semibold text-violet-700">Fijo</span> : null}
                          </p>
                          <p className="mt-0.5 text-slate-800 [overflow-wrap:anywhere]">{it.descripcion}</p>
                        </div>
                        <p className="shrink-0 whitespace-nowrap text-right font-semibold tabular-nums text-slate-800">{m(it.monto)}</p>
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {[it.iva_tipo === "exenta" ? "Exenta" : `IVA ${it.iva_tipo} · ${m(it.monto_iva)}`, it.empleado_nombre, repartido ? it.sucursal_nombre : null].filter(Boolean).join(" · ")}
                      </p>
                    </li>
                  ))}
                </ul>
                <div className="overflow-x-auto max-sm:hidden">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    <tr><th className="px-3 py-2">Categoría</th><th className="px-3 py-2">Descripción</th><th className="px-3 py-2">IVA</th><th className="px-3 py-2 text-right">Monto</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {d.items.length === 0 ? (
                      <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400">Sin líneas</td></tr>
                    ) : d.items.map((it, i) => (
                      <tr key={it.id ?? i}>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {it.categoria_nombre ? <>{it.rubro_nombre ? <span className="text-slate-400">{it.rubro_nombre} › </span> : null}{it.categoria_nombre}</> : <span className="italic text-slate-400">Sin categoría</span>}
                          {it.tipo_costo === "fijo" ? <span className="ml-1.5 rounded bg-violet-50 px-1 py-0.5 text-[10px] font-semibold text-violet-700">Fijo</span> : null}
                        </td>
                        <td className="px-3 py-2 text-slate-800">
                          {it.descripcion}
                          {it.empleado_nombre || repartido ? (
                            <span className="block text-[11px] text-slate-400">{[it.empleado_nombre, repartido ? it.sucursal_nombre : null].filter(Boolean).join(" · ")}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-500">{it.iva_tipo === "exenta" ? "Exenta" : `${it.iva_tipo} · ${m(it.monto_iva)}`}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-slate-800">{m(it.monto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                <div className="flex flex-wrap justify-end gap-x-5 gap-y-1 border-t border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500 max-sm:gap-x-3">
                  {g.con_comprobante ? <span>Gravado <b className="text-slate-700">{m(g.subtotal)}</b></span> : null}
                  {Number(g.iva_10) ? <span>IVA 10 % <b className="text-slate-700">{m(g.iva_10)}</b></span> : null}
                  {Number(g.iva_5) ? <span>IVA 5 % <b className="text-slate-700">{m(g.iva_5)}</b></span> : null}
                  {Number(g.exenta) && g.con_comprobante ? <span>Exentas <b className="text-slate-700">{m(g.exenta)}</b></span> : null}
                  <span className="text-sm text-slate-600">Total <b className="text-slate-900">{m(g.total)}</b></span>
                  {g.moneda === "USD" ? <span className="text-slate-500">≈ {gs(g.total_gs)}</span> : null}
                </div>
              </div>

              {d.cxp ? (
                <div className="rounded-xl border border-slate-200 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Deuda con el proveedor</p>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${(ESTADO_CXP[d.cxp.estado] ?? ESTADO_CXP.pendiente).c}`}>{(ESTADO_CXP[d.cxp.estado] ?? ESTADO_CXP.pendiente).t}</span>
                  </div>
                  <p className="mt-1 text-slate-700">
                    Saldo <b className="tabular-nums">{monto(d.cxp.saldo, d.cxp.moneda)}</b> de {monto(d.cxp.monto, d.cxp.moneda)} · vence {fechaCorta(d.cxp.vencimiento)}
                  </p>
                  {d.cxp.pagos.length ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Pagos: {d.cxp.pagos.map((p) => `${p.numero} (${monto(p.monto, d.cxp!.moneda)}${p.anulado ? ", anulado" : ""})`).join(" · ")}
                    </p>
                  ) : null}
                  {g.estado === "confirmado" && Number(d.cxp.saldo) > 0 ? (
                    <Link href="/compras/pagos" className="mt-2 inline-flex items-center text-xs font-semibold text-[var(--brand)] hover:underline max-sm:mt-0 max-sm:min-h-11">Pagar en Pagos a proveedores →</Link>
                  ) : null}
                </div>
              ) : d.caja ? (
                <div className="rounded-xl border border-slate-200 px-4 py-3 text-slate-700">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Egreso de caja</p>
                  <p className="mt-1">{gs(d.caja.monto)} en efectivo de la caja N° {d.caja.numero_caja}{d.caja.anulado ? " (anulado)" : ""}.</p>
                </div>
              ) : null}

              <div className="rounded-xl border border-slate-200 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Adjuntos ({d.adjuntos.length})</p>
                  {g.estado !== "anulado" ? (
                    <>
                      <input ref={fileRef} type="file" multiple accept={ACCEPT_COMPROBANTE} className="hidden"
                        onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; if (fs.length) void adjuntar(fs); }} />
                      <button onClick={() => fileRef.current?.click()} disabled={subiendo}
                        className="inline-flex items-center gap-1 rounded-lg border border-[var(--brand-400)]/40 px-2.5 py-1 text-xs font-semibold text-[var(--brand)] hover:bg-[var(--brand-400)]/5 disabled:opacity-50 max-sm:min-h-11 max-sm:px-3">
                        {subiendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />} Adjuntar
                      </button>
                    </>
                  ) : null}
                </div>
                {d.adjuntos.length === 0 ? (
                  <p className="mt-1 text-slate-400">Sin adjuntos.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-slate-100">
                    {d.adjuntos.map((a) => {
                      const pdf = a.mime === "application/pdf" || /\.pdf$/i.test(a.nombre);
                      return (
                        <li key={a.id} className="flex items-center gap-2 py-1.5">
                          {pdf ? <FileText className="h-4 w-4 shrink-0 text-rose-500" /> : <ImageIcon className="h-4 w-4 shrink-0 text-sky-500" />}
                          <span className="min-w-0 flex-1 truncate text-slate-700">{a.nombre}</span>
                          <span className="hidden text-[11px] text-slate-400 sm:inline">{tamano(a.size)}{a.subido_por ? ` · ${a.subido_por}` : ""}</span>
                          <button onClick={() => void ver(a.id)} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50 max-sm:min-h-11 max-sm:px-3"><Eye className="h-3.5 w-3.5" /> Ver</button>
                          {g.estado !== "anulado" ? (
                            <button onClick={() => void quitar(a.id)} disabled={subiendo} className="shrink-0 rounded-lg px-1.5 py-0.5 text-xs text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 max-sm:min-h-11 max-sm:px-2">Quitar</button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {g.observacion ? <p className="whitespace-pre-line rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600"><b>Notas:</b> {g.observacion}</p> : null}
              <p className="text-[11px] text-slate-400">
                Cargado por {g.usuario_nombre ?? "—"} el {fechaHora(g.created_at)}
                {g.confirmado_at ? ` · aprobado (confirmado) por ${g.confirmado_por ?? "—"} el ${fechaHora(g.confirmado_at)}` : ""}
              </p>
            </>
          )}
        </div>

        {g ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
            {g.estado === "borrador" ? (
              <>
                <button onClick={() => onEliminar({ id: g.id, numero: g.numero })} className="mr-auto inline-flex items-center gap-1 rounded-xl px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 max-sm:border max-sm:border-rose-200"><Trash2 className="h-4 w-4" /> Eliminar</button>
                <button onClick={() => onEditar(g.id)} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 max-sm:flex-1"><Pencil className="h-4 w-4" /> Abrir y confirmar</button>
              </>
            ) : g.estado === "confirmado" ? (
              <button onClick={() => onAnular({ id: g.id, numero: g.numero })} className="mr-auto inline-flex items-center justify-center gap-1 rounded-xl px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 max-sm:mr-0 max-sm:flex-1 max-sm:border max-sm:border-rose-200"><Ban className="h-4 w-4" /> Anular</button>
            ) : null}
            {/* Con un borrador, en celular se omite "Cerrar" (la ✕ de arriba cierra): entran las dos acciones. */}
            <button onClick={onClose} className={`rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 max-sm:flex-1 ${g.estado === "borrador" ? "max-sm:hidden" : ""}`}>Cerrar</button>
          </div>
        ) : null}
      </div>
    </CapaModal>
  );
}

function Dato({ t, v, mono }: { t: string; v: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{t}</dt>
      <dd className={`mt-0.5 break-words text-slate-800 ${mono ? "font-mono text-xs" : ""}`}>{v}</dd>
    </div>
  );
}

/** Confirmación con motivo (anular) o simple (eliminar borrador). */
export function ConfirmarAccionGasto({ modo, gasto, onClose, onHecho }: {
  modo: "anular" | "eliminar";
  gasto: { id: string; numero: string | null };
  onClose: () => void;
  onHecho: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anular = modo === "anular";

  async function enviar() {
    if (busy) return;
    if (anular && motivo.trim().length < 3) { setError("Escribí el motivo (mínimo 3 caracteres)."); return; }
    setBusy(true);
    setError(null);
    try {
      if (anular) await apiFetch(`/api/gastos/${gasto.id}/anular`, { method: "POST", body: JSON.stringify({ motivo: motivo.trim() }) });
      else await apiFetch(`/api/gastos/${gasto.id}`, { method: "DELETE" });
      onHecho();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <CapaModal onClose={busy ? undefined : onClose} z="z-[60]">
      <div className={`flex w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${ALTO_MAX_MODAL}`} style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="shrink-0 border-b border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
          <h2 className="text-base font-semibold text-slate-800">{anular ? `Anular ${gasto.numero ?? "el gasto"}` : "Eliminar el borrador"}</h2>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm text-slate-600 sm:px-6">
          {anular ? (
            <>
              <p>El documento conserva su número y queda como anulado. Si fue a crédito se anula la deuda con el proveedor (no si ya tiene pagos); si salió efectivo de la caja, se anula ese egreso (solo con la caja abierta).</p>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Motivo *</label>
                <textarea autoFocus rows={3} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[var(--brand-400)] focus:ring-2 focus:ring-[var(--brand-400)]/20" />
              </div>
            </>
          ) : (
            <p>¿Eliminar el borrador? Esta acción no se puede deshacer (sus adjuntos también se borran). Si salió de una plantilla recurrente, lo podés volver a generar.</p>
          )}
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
          <button onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 max-sm:flex-1">Cancelar</button>
          <button onClick={() => void enviar()} disabled={busy}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50 max-sm:flex-1">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {anular ? "Anular" : "Eliminar"}
          </button>
        </div>
      </div>
    </CapaModal>
  );
}
