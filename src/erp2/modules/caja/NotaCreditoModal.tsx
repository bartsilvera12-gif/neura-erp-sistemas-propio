"use client";

/**
 * Nueva nota de crédito sobre una venta (receta 99), desde el detalle de la venta:
 *   · Devolver productos: por línea, cuánto se devuelve (hasta lo que queda sin devolver) y si
 *     vuelve al stock (por defecto sí; un plato ya preparado, no). Lo que no vuelve queda como
 *     pérdida. Un plato con receta que vuelve devuelve sus ingredientes.
 *   · Descuento por monto: sin stock (bonificación, error de precio…).
 *   · La plata: a crédito primero baja la deuda de la venta; lo que sobra (o todo, al contado)
 *     se devuelve desde una caja (efectivo, transferencia…) o queda a favor del cliente.
 * La base vuelve a validar todo (crear_nota_credito).
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, Minus, PiggyBank, Plus, ReceiptText, Undo2 } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import MontoInput from "@/erp2/components/ui/MontoInput";
import { Select } from "@/erp2/components/Select";
import { SelectorCaja } from "@/erp2/modules/caja/SelectorCaja";
import { invalidarCajas } from "@/erp2/modules/caja/turno";
import { formatGs } from "@/erp2/modules/caja/lib";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, ET, INPUT, ModalDocumento, TEAL } from "@/erp2/modules/inventario/ui";
import { METODOS_DEVOLUCION, type DestinoNota, type ItemPrevia, type MetodoDevolucion, type NotaCreditoPrevia, type TipoNota } from "@/erp2/modules/caja/notas-credito";

const soloDecimal = (v: string) => v.replace(/[^\d.,]/g, "");
/** "1,5" o "1.5" → 1.5 (con coma, el punto es de miles). */
const aNum = (v: string) => Number(v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v) || 0;
const aTexto = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",");
const fmtCant = (n: number) => Number(n).toLocaleString("es-PY", { maximumFractionDigits: 3 });
const esEntero = (u: string | null) => !u || u === "Unidad";

/** Monto de la línea por lo que se devuelve (la última parte toma lo que falta). */
function montoLinea(i: ItemPrevia, q: number): number {
  if (q <= 0) return 0;
  if (Math.abs(q - i.disponible) < 0.00001) return Number(i.monto_disponible);
  return Math.round((Number(i.total_linea) * q) / Number(i.cantidad));
}

export function NotaCreditoModal({ ventaId, onClose, onHecho }: {
  ventaId: string;
  onClose: () => void;
  onHecho: (r: { id: string; numero: string }) => void;
}) {
  const [p, setP] = useState<NotaCreditoPrevia | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoNota>("devolucion");
  const [cant, setCant] = useState<Record<string, string>>({});
  const [vuelve, setVuelve] = useState<Record<string, boolean>>({});
  const [monto, setMonto] = useState<number>(0);
  const [motivo, setMotivo] = useState("");
  const [destino, setDestino] = useState<DestinoNota>("devolver");
  const [metodo, setMetodo] = useState<MetodoDevolucion>("efectivo");
  const [referencia, setReferencia] = useState("");
  const [caja, setCaja] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idem] = useState(() => crypto.randomUUID());

  useEffect(() => {
    apiFetch<NotaCreditoPrevia>(`/api/ventas/${ventaId}/nota-credito`)
      .then((d) => {
        setP(d);
        // Un plato ya preparado no vuelve al stock (se elige igual).
        setVuelve(Object.fromEntries(d.items.map((i) => [i.id, i.mueve_stock && !i.receta])));
        if (d.items.every((i) => i.disponible <= 0)) setTipo("descuento");
      })
      .catch((e) => setErrorCarga((e as Error).message));
  }, [ventaId]);

  const credito = p?.venta.tipo_venta === "CREDITO";
  const conCliente = !!p?.venta.cliente_id;
  const items = p?.items ?? [];
  const lineas = useMemo(
    () => items.map((i) => {
      const q = Math.min(aNum(cant[i.id] ?? ""), Number(i.disponible));
      return { i, q, monto: montoLinea(i, q) };
    }),
    [items, cant],
  );
  const totalDev = Math.min(lineas.reduce((a, l) => a + l.monto, 0), Number(p?.disponible ?? 0));
  const total = tipo === "devolucion" ? totalDev : Math.round(monto || 0);
  const aCuenta = credito ? Math.min(Number(p?.deuda ?? 0), total) : 0;
  const resto = total - aCuenta;
  const noVuelven = lineas.filter((l) => l.q > 0 && l.i.mueve_stock && !vuelve[l.i.id]);

  const problema = useMemo((): string | null => {
    if (!p) return null;
    if (p.disponible <= 0) return "La venta ya tiene notas de crédito por todo su total.";
    if (tipo === "devolucion") {
      const mal = lineas.find((l) => aNum(cant[l.i.id] ?? "") > Number(l.i.disponible) + 0.00001);
      if (mal) return `«${mal.i.producto_nombre}»: se puede devolver hasta ${fmtCant(mal.i.disponible)}.`;
      const noEntero = lineas.find((l) => l.q > 0 && esEntero(l.i.unidad_medida) && Number.isInteger(Number(l.i.cantidad)) && !Number.isInteger(l.q));
      if (noEntero) return `«${noEntero.i.producto_nombre}» se cuenta por unidad: devolvé un número entero.`;
      if (total <= 0) return "Elegí qué productos se devuelven y cuántos.";
    } else {
      if (total <= 0) return "Poné el monto del descuento.";
      if (total > p.disponible) return `El descuento no puede pasar ${formatGs(p.disponible)} (lo que queda por acreditar).`;
    }
    if (motivo.trim().length < 3) return "Escribí el motivo.";
    if (resto > 0 && destino === "saldo_favor" && !conCliente) return "La venta no tiene cliente: no puede quedar a favor. Devolvé el dinero.";
    if (resto > 0 && destino === "devolver" && !caja) return "Para devolver el dinero tiene que haber una caja abierta.";
    return null;
  }, [p, tipo, lineas, cant, total, motivo, resto, destino, conCliente, caja]);
  const puede = !!p && !problema && !busy;

  function devolverTodo() {
    setCant(Object.fromEntries(items.filter((i) => i.disponible > 0).map((i) => [i.id, aTexto(Number(i.disponible))])));
  }
  function paso(i: ItemPrevia, d: number) {
    const actual = aNum(cant[i.id] ?? "");
    const nuevo = Math.max(0, Math.min(Number(i.disponible), Math.floor(actual) + d));
    setCant((c) => ({ ...c, [i.id]: nuevo > 0 ? aTexto(nuevo) : "" }));
  }

  async function emitir() {
    if (!puede || !p) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ id: string; numero: string }>("/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          venta_id: p.venta.id,
          tipo,
          motivo: motivo.trim(),
          items: tipo === "devolucion"
            ? lineas.filter((l) => l.q > 0).map((l) => ({ venta_item_id: l.i.id, cantidad: l.q, vuelve_stock: l.i.mueve_stock && !!vuelve[l.i.id] }))
            : undefined,
          monto: tipo === "descuento" ? total : undefined,
          destino: resto > 0 ? destino : "devolver",
          metodo,
          referencia: metodo !== "efectivo" ? referencia.trim() || null : null,
          caja_id: resto > 0 && destino === "devolver" ? caja : null,
          idempotency_key: idem,
        }),
      });
      invalidarCajas();
      onHecho(r);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const SEG = (on: boolean) =>
    `flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition [@media(pointer:coarse)]:min-h-11 ${on ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`;

  return (
    <ModalDocumento
      ancho="max-w-2xl"
      z="z-[130]"
      titulo={<><ReceiptText className="h-5 w-5 shrink-0" style={{ color: TEAL }} /> Nota de crédito</>}
      subtitulo={p ? `Venta ${p.venta.numero_control} · ${p.venta.cliente_nombre} · ${formatGs(p.venta.total)}` : "Cargando…"}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          {error ? <p className="mr-auto text-xs font-medium text-rose-600 max-sm:basis-full">{error}</p>
            : problema && p ? <p className="mr-auto text-xs text-slate-500 max-sm:basis-full">{problema}</p> : null}
          <button type="button" onClick={onClose} disabled={busy} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:flex-1`}>Cancelar</button>
          <button type="button" onClick={() => void emitir()} disabled={!puede} className={`${BOTON_PRIMARIO} max-sm:min-h-11 max-sm:flex-[2]`} style={{ backgroundColor: TEAL }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ReceiptText className="h-4 w-4" />}
            {total > 0 ? `Emitir por ${formatGs(total)}` : "Emitir nota"}
          </button>
        </>
      }
    >
      {errorCarga ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{errorCarga}</p> : !p ? (
        <p className="py-8 text-center text-sm text-slate-400">Cargando…</p>
      ) : (
        <div className="space-y-5">
          {p.acreditado > 0 ? (
            <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
              Esta venta ya tiene notas por <b>{formatGs(p.acreditado)}</b>. Queda por acreditar <b>{formatGs(p.disponible)}</b>.
            </p>
          ) : null}

          <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
            <button type="button" onClick={() => setTipo("devolucion")} className={SEG(tipo === "devolucion")}>Devolver productos</button>
            <button type="button" onClick={() => setTipo("descuento")} className={SEG(tipo === "descuento")}>Descuento por monto</button>
          </div>

          {tipo === "devolucion" ? (
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">¿Qué devuelve?</p>
                {items.some((i) => i.disponible > 0) ? (
                  <button type="button" onClick={devolverTodo} className="text-xs font-semibold text-[var(--brand)] hover:underline [@media(pointer:coarse)]:min-h-11">Devolver todo</button>
                ) : null}
              </div>
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                {lineas.map(({ i, q, monto: m }) => {
                  const sin = i.disponible <= 0;
                  const entero = esEntero(i.unidad_medida) && Number.isInteger(Number(i.cantidad));
                  return (
                    <li key={i.id} className={`px-3.5 py-3 ${sin ? "bg-slate-50/70" : ""}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className={`text-sm font-medium [overflow-wrap:anywhere] ${sin ? "text-slate-400" : "text-slate-800"}`}>{i.producto_nombre}</p>
                          {i.modificadores_texto ? <p className="text-xs text-slate-500 [overflow-wrap:anywhere]">{i.modificadores_texto}</p> : null}
                          <p className="mt-0.5 text-xs text-slate-400">
                            Vendido {fmtCant(i.cantidad)} × {formatGs(i.precio_venta)}{i.devuelto > 0 ? ` · ya devuelto ${fmtCant(i.devuelto)}` : ""}
                          </p>
                        </div>
                        {sin ? (
                          <span className="shrink-0 text-xs font-medium text-slate-400">Ya devuelto</span>
                        ) : (
                          <div className="flex shrink-0 items-center gap-1">
                            {entero ? (
                              <button type="button" onClick={() => paso(i, -1)} disabled={q <= 0} aria-label="Uno menos"
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"><Minus className="h-4 w-4" /></button>
                            ) : null}
                            <input inputMode="decimal" value={cant[i.id] ?? ""} onChange={(e) => setCant((c) => ({ ...c, [i.id]: soloDecimal(e.target.value) }))}
                              placeholder="0" aria-label={`Cuánto devuelve de ${i.producto_nombre}`}
                              className="h-9 w-16 rounded-lg border border-slate-200 px-2 text-center text-sm font-semibold tabular-nums outline-none focus:border-[var(--brand)] [@media(pointer:coarse)]:h-11" />
                            {entero ? (
                              <button type="button" onClick={() => paso(i, 1)} disabled={q >= i.disponible} aria-label="Uno más"
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"><Plus className="h-4 w-4" /></button>
                            ) : null}
                          </div>
                        )}
                      </div>
                      {q > 0 ? (
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          {i.mueve_stock ? (
                            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-600 [@media(pointer:coarse)]:min-h-11">
                              <input type="checkbox" checked={!!vuelve[i.id]} onChange={(e) => setVuelve((v) => ({ ...v, [i.id]: e.target.checked }))}
                                className="h-4 w-4 rounded border-slate-300 accent-[var(--brand)]" />
                              {i.receta ? "Vuelven sus ingredientes al stock" : "Vuelve al stock"}
                              {!vuelve[i.id] ? <span className="text-amber-700">· queda como pérdida</span> : null}
                            </label>
                          ) : <span className="text-xs text-slate-400">No mueve stock</span>}
                          <span className="text-sm font-semibold tabular-nums text-slate-900">{formatGs(m)}</span>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {noVuelven.length ? (
                <p className="mt-2 text-[11px] text-amber-700">Lo que no vuelve al stock se registra como pérdida (Reportes › Pérdidas, «Devolución de cliente»).</p>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="block min-w-0">
                <span className={ET}>Monto del descuento *</span>
                <MontoInput value={monto || ""} onChange={(n) => setMonto(Math.max(0, Math.round(n)))} decimals={false}
                  placeholder="0" className={`${INPUT} text-right text-base font-semibold tabular-nums`} />
              </label>
              <p className="pb-2.5 text-xs text-slate-500">Hasta {formatGs(p.disponible)} · no mueve stock</p>
            </div>
          )}

          <label className="block">
            <span className={ET}>Motivo *</span>
            <textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500}
              placeholder={tipo === "devolucion" ? "Ej.: producto fallado, se equivocó de talle…" : "Ej.: bonificación por demora, error de precio…"}
              className={`${INPUT} resize-none`} />
          </label>

          {total > 0 ? (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900">Total de la nota</span>
                <span className="text-lg font-bold tabular-nums text-slate-900">{formatGs(total)}</span>
              </div>
              {credito ? (
                <div className="flex items-center justify-between text-sm text-slate-600">
                  <span>Baja la deuda de la venta</span>
                  <span className="font-semibold tabular-nums">{formatGs(aCuenta)}</span>
                </div>
              ) : null}
              {resto > 0 ? (
                <>
                  {credito ? <p className="text-xs text-slate-500">La venta ya estaba pagada en parte: quedan <b>{formatGs(resto)}</b> para el cliente.</p> : null}
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button type="button" onClick={() => setDestino("devolver")}
                      className={`flex items-start gap-2.5 rounded-xl border bg-white p-3 text-left transition ${destino === "devolver" ? "ring-2" : "hover:border-slate-300"}`}
                      style={destino === "devolver" ? { borderColor: TEAL, ["--tw-ring-color" as string]: `${TEAL}30` } : { borderColor: "#e2e8f0" }}>
                      <Undo2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: TEAL }} />
                      <span><span className="block text-sm font-semibold text-slate-800">Devolver el dinero</span><span className="block text-xs text-slate-500">Sale de la caja: {formatGs(resto)}</span></span>
                    </button>
                    <button type="button" onClick={() => conCliente && setDestino("saldo_favor")} disabled={!conCliente}
                      className={`flex items-start gap-2.5 rounded-xl border bg-white p-3 text-left transition disabled:opacity-50 ${destino === "saldo_favor" ? "ring-2" : "hover:border-slate-300"}`}
                      style={destino === "saldo_favor" ? { borderColor: TEAL, ["--tw-ring-color" as string]: `${TEAL}30` } : { borderColor: "#e2e8f0" }}>
                      <PiggyBank className="mt-0.5 h-4 w-4 shrink-0" style={{ color: TEAL }} />
                      <span>
                        <span className="block text-sm font-semibold text-slate-800">Dejar a favor del cliente</span>
                        <span className="block text-xs text-slate-500">{conCliente ? "Lo usa en su próxima compra o para pagar su deuda" : "La venta no tiene cliente"}</span>
                      </span>
                    </button>
                  </div>
                  {destino === "devolver" ? (
                    <div className="space-y-3">
                      <div className={`grid gap-3 ${metodo !== "efectivo" ? "sm:grid-cols-2" : ""}`}>
                        {/* div y no label: un <label> con el botón del Select adentro le repite el click (abre y cierra). */}
                        <div className="min-w-0">
                          <span className={ET}>Se devuelve en</span>
                          <Select block value={metodo} onChange={(v) => setMetodo(v as MetodoDevolucion)} options={METODOS_DEVOLUCION} etiqueta="Se devuelve en" />
                        </div>
                        {metodo !== "efectivo" ? (
                          <label className="block min-w-0">
                            <span className={ET}>Referencia <span className="font-normal text-slate-400">(opcional)</span></span>
                            <input value={referencia} onChange={(e) => setReferencia(e.target.value)} maxLength={80} placeholder="N° de operación" className={INPUT} />
                          </label>
                        ) : null}
                      </div>
                      <SelectorCaja value={caja} onChange={setCaja} etiqueta="Sale de la caja" />
                    </div>
                  ) : p.saldo_favor > 0 ? (
                    <p className="text-xs text-slate-500">Ya tiene {formatGs(p.saldo_favor)} a favor: le quedaría {formatGs(p.saldo_favor + resto)}.</p>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </ModalDocumento>
  );
}
