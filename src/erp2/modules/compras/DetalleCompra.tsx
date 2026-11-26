"use client";

/**
 * Detalle de una compra (panel lateral): comprobante, condición y pago, sucursal / depósito,
 * las líneas separadas por tipo (Mercadería: productos que sumaron stock · Gastos: subcategoría,
 * sucursal y empleado), totales con IVA por tasa y crédito fiscal, la cuenta a pagar con sus
 * pagos (y "Pagar"), los comprobantes adjuntos y "Anular" (la mercadería vuelve a salir del
 * stock; los gastos se anulan sin tocar stock).
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Ban, Banknote, Loader2, Package, Printer, Receipt, X } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { clienteConfig } from "@/erp2/cliente.config";
import { Drawer } from "@/erp2/components/Drawer";
import { TZ_PY } from "@/erp2/lib/fecha/paraguay";
import { TIPO_COMPRA, type Compra } from "@/erp2/modules/compras/tipos";
import { ComprobantesCompra } from "@/erp2/modules/compras/Comprobantes";
import { useUsuario } from "@/erp2/lib/sesion/ContextoUsuario";
import { ESTADO_CXP, dinero, nombreMetodoPago } from "@/erp2/modules/compras/pagos";
import { RegistrarPagoProveedor, imprimirOrdenPago, useAvisoPago } from "@/erp2/modules/compras/RegistrarPagoProveedor";

const TEAL = clienteConfig.color;
const gs = (v: number | null | undefined) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const usd = (v: number | null | undefined) => `US$ ${Number(v || 0).toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "short", year: "numeric" });
const fechaDia = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("es-PY", { day: "2-digit", month: "short", year: "numeric" });

export function DetalleCompra({ id, onClose, onAnulada }: { id: string; onClose: () => void; onAnulada: () => void }) {
  const [c, setC] = useState<Compra | null>(null);
  const [pagando, setPagando] = useState(false);
  const { nodo: aviso, avisar } = useAvisoPago();
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esAdmin = useUsuario()?.rol === "ADMIN";

  const cargar = useCallback(() => {
    apiFetch<Compra>(`/api/compras/${id}`).then(setC).catch((e) => setError((e as Error).message));
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  async function anular() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/compras/${id}/anular`, { method: "POST", body: JSON.stringify({ motivo }) });
      setAnulando(false);
      cargar();
      onAnulada();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const anulada = c?.estado === "anulada";
  const cxp = c?.cuenta_pagar ?? null;
  const items = c?.items ?? [];
  const gastos = c?.gastos ?? [];
  const tipo = c?.tipo ?? "mercaderia";
  const conComprobante = c?.con_comprobante !== false;
  const titulo = c ? `${tipo === "gasto" ? "Gasto" : "Compra"} ${c.numero_control}` : "Compra";
  const subtitulo = c
    ? [c.proveedor_nombre ?? "Sin proveedor", conComprobante ? (c.numero_factura ? `${(c.tipo_comprobante ?? "factura").toLowerCase()} ${c.numero_factura}` : null) : "sin comprobante fiscal"]
        .filter(Boolean).join(" · ")
    : undefined;

  return (
    <>
    <Drawer
      titulo={titulo}
      subtitulo={subtitulo}
      onClose={onClose}
      footer={c && !anulada ? (
        anulando ? (
          <>
            <button onClick={() => setAnulando(false)} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 max-sm:flex-1">Volver</button>
            <button onClick={anular} disabled={busy || !motivo.trim()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-40 max-sm:flex-[2] max-sm:px-3">
              {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Ban className="h-4 w-4 shrink-0" />} Confirmar anulación
            </button>
          </>
        ) : (
          <button onClick={() => setAnulando(true)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 max-sm:flex-1">
            <Ban className="h-4 w-4" /> Anular {tipo === "gasto" ? "gasto" : "compra"}
          </button>
        )
      ) : undefined}
    >
      {!c ? (
        error ? <p className="text-sm text-rose-600">{error}</p> : <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
      ) : (
        <div className="space-y-5">
          {anulada ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <p className="font-semibold">{tipo === "gasto" ? "Gasto anulado" : "Compra anulada"}</p>
              <p className="text-xs">{c.anulada_motivo}{c.anulada_por ? ` · ${c.anulada_por}` : ""}{c.anulada_at ? ` · ${fecha(c.anulada_at)}` : ""}</p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${TIPO_COMPRA[tipo].c}`}>{TIPO_COMPRA[tipo].t}</span>
            {!conComprobante ? <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">Sin comprobante fiscal</span> : null}
            {c.tipo_pago === "credito" ? <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">Crédito</span>
              : <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">Contado</span>}
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Dato l="Cargada" v={`${fecha(c.fecha)}${c.usuario_nombre ? ` · ${c.usuario_nombre}` : ""}`} />
            <Dato l={conComprobante ? "Fecha del comprobante" : "Fecha"} v={c.fecha_factura ? fechaDia(c.fecha_factura) : "—"} />
            {conComprobante ? <Dato l="Comprobante" v={`${c.tipo_comprobante ?? "Factura"}${c.numero_factura ? ` ${c.numero_factura}` : ""}`} mono /> : c.numero_factura ? <Dato l="Referencia" v={c.numero_factura} mono /> : null}
            {conComprobante ? <Dato l="Timbrado" v={c.nro_timbrado ?? "—"} mono /> : null}
            {c.sucursal?.nombre ? <Dato l="Sucursal" v={c.sucursal.nombre} /> : null}
            {c.deposito?.nombre && items.length ? <Dato l="Entró al depósito" v={c.deposito.nombre} /> : null}
            <Dato l="Condición" v={c.tipo_pago === "credito"
              ? `Crédito${c.plazo_dias ? ` ${c.plazo_dias} días` : ""}${c.vencimiento ? ` · vence ${fechaDia(c.vencimiento)}` : ""}`
              : `Contado${c.medio_pago ? ` · ${nombreMetodoPago(c.medio_pago)}${c.medio_pago === "efectivo" ? " (salió de la caja)" : ""}` : ""}${c.referencia_pago ? ` · ${c.referencia_pago}` : ""}`} />
            {c.cuenta ? <Dato l="Cuenta de origen" v={`${c.cuenta.banco_nombre} · ${c.cuenta.numero}${c.cuenta.alias ? ` (${c.cuenta.alias})` : ""}`} /> : null}
            {c.moneda === "USD" ? <Dato l="Moneda" v={`Dólares · 1 US$ = ${gs(c.tipo_cambio)}`} /> : null}
            {c.orden_compra_id ? (
              <div>
                <dt className="text-[11px] text-slate-500">Orden de compra</dt>
                <dd><Link href={`/compras/ordenes?ver=${c.orden_compra_id}`} className="inline-flex items-center font-mono text-sm font-semibold text-sky-700 hover:underline max-sm:min-h-11">{c.oc?.numero_oc ?? "Ver la orden"}</Link></dd>
              </div>
            ) : null}
          </dl>

          {items.length ? (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                <Package className="h-3.5 w-3.5" /> Mercadería <span className="font-normal normal-case tracking-normal text-slate-400">· sumó stock</span>
                <span className="ml-auto font-semibold normal-case tracking-normal text-slate-700">{gs(c.total_mercaderia ?? items.reduce((a, i) => a + Number(i.total), 0))}</span>
              </p>
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                {items.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800 max-sm:line-clamp-2 max-sm:[overflow-wrap:anywhere] sm:truncate">{i.producto_nombre}</p>
                      <p className="text-[11px] text-slate-500">
                        {Number(i.cantidad).toLocaleString("es-PY")} × {c.moneda === "USD" ? `US$ ${Number(i.costo_unitario_original).toLocaleString("es-PY")}` : gs(i.costo_unitario)}
                        {` · IVA ${i.tipo_iva}`}
                        {i.precio_venta_nuevo ? ` · precio de venta → ${gs(i.precio_venta_nuevo)}` : ""}
                        {i.lote_numero ? <> · lote <span className="font-mono font-semibold text-slate-600">{i.lote_numero}</span>{i.lote_vencimiento ? ` vence ${i.lote_vencimiento.slice(8, 10)}/${i.lote_vencimiento.slice(5, 7)}/${i.lote_vencimiento.slice(0, 4)}` : ""}</> : null}
                      </p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums text-slate-900">{gs(i.total)}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {gastos.length ? (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                <Receipt className="h-3.5 w-3.5" /> Gastos <span className="font-normal normal-case tracking-normal text-slate-400">· no tocan stock</span>
                <span className="ml-auto font-semibold normal-case tracking-normal text-slate-700">{gs(c.total_gastos ?? gastos.reduce((a, g) => a + Number(g.monto), 0))}</span>
              </p>
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                {gastos.map((g) => (
                  <li key={g.id} className="flex items-start gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800 [overflow-wrap:anywhere]">{g.descripcion}</p>
                      <p className="text-[11px] text-slate-500">
                        {g.rubro_nombre ? `${g.rubro_nombre} › ` : ""}{g.categoria_nombre ?? "Sin categoría"}
                        {g.tipo_costo ? ` · ${g.tipo_costo === "fijo" ? "fijo" : "variable"}` : ""}
                        {` · IVA ${g.iva_tipo === "exenta" ? "exenta" : g.iva_tipo}`}
                        {g.deducible ? "" : " · no deducible"}
                        {g.empleado_nombre ? ` · ${g.empleado_nombre}` : ""}
                        {g.sucursal_nombre && g.sucursal_id !== c.sucursal_id ? ` · ${g.sucursal_nombre}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums text-slate-900">{gs(g.monto)}</p>
                      {c.moneda === "USD" ? <p className="text-[11px] tabular-nums text-slate-400">{usd(g.monto_original)}</p> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-1 rounded-xl bg-slate-50 p-4 text-sm">
            {Number(c.total_10) ? <div className="flex justify-between text-slate-600"><span>Gravado 10 % · IVA {gs(c.iva_10)}</span><span className="tabular-nums">{gs(c.total_10)}</span></div> : null}
            {Number(c.total_5) ? <div className="flex justify-between text-slate-600"><span>Gravado 5 % · IVA {gs(c.iva_5)}</span><span className="tabular-nums">{gs(c.total_5)}</span></div> : null}
            {Number(c.exenta) ? <div className="flex justify-between text-slate-600"><span>Exentas</span><span className="tabular-nums">{gs(c.exenta)}</span></div> : null}
            {!Number(c.total_10) && !Number(c.total_5) && !Number(c.exenta) ? (
              <>
                <div className="flex justify-between text-slate-600"><span>Subtotal sin IVA</span><span className="tabular-nums">{gs(c.subtotal)}</span></div>
                <div className="flex justify-between text-slate-600"><span>IVA contenido</span><span className="tabular-nums">{gs(c.monto_iva)}</span></div>
              </>
            ) : null}
            <div className="flex justify-between border-t border-slate-200 pt-1.5 font-bold text-slate-900"><span>Total</span><span className="tabular-nums">{gs(c.total)}</span></div>
            <p className="text-right text-[11px] text-slate-500">
              {conComprobante ? `Crédito fiscal (IVA deducible): ${gs(c.iva_credito ?? c.monto_iva)}` : "Sin comprobante fiscal: no genera crédito fiscal"}
            </p>
          </div>

          {c.observacion ? <p className="rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-600">{c.observacion}</p> : null}

          {c.tipo_pago === "credito" && cxp ? <CuentaPagarBloque c={c} puedePagar={esAdmin && !anulada && !!c.proveedor_id} onPagar={() => setPagando(true)} /> : null}

          <ComprobantesCompra compraId={c.id} esAdmin={esAdmin} />

          {anulando ? (
            <div className="rounded-xl border border-rose-200 p-4">
              <p className="text-sm font-semibold text-slate-800">¿Por qué la anulás?</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {items.length ? "Se descuenta del stock lo que entró con esta compra y se quita su costo (queda en el kardex). " : ""}
                {gastos.length ? `${items.length ? "Las líneas de gasto" : "El gasto"} deja${items.length ? "n" : ""} de contar en el resumen de gastos (no tocan stock). ` : ""}
                {c.orden_compra_id ? `Lo recibido vuelve a quedar pendiente en la ${c.oc?.numero_oc ?? "orden de compra"}. ` : ""}
                {c.tipo_pago === "contado" && c.medio_pago === "efectivo" ? "El egreso de caja se anula (solo si esa caja sigue abierta). " : ""}
                {c.tipo_pago === "credito" ? "Su cuenta a pagar se anula." : ""}
              </p>
              {cxp && Number(cxp.pagado) > 0 ? (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Ya tiene pagos al proveedor ({dinero(cxp.pagado, cxp.moneda)}): para anularla primero anulá esas órdenes de pago.</p>
              ) : null}
              <textarea autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={500} enterKeyHint="done" placeholder="Ej: se cargó con el proveedor equivocado"
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-rose-400 focus:ring-4 focus:ring-rose-100" />
            </div>
          ) : null}
          {error ? (
            <div className="flex items-start justify-between gap-2 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">
              <span className="min-w-0 [overflow-wrap:anywhere]">{error}</span><button onClick={() => setError(null)} aria-label="Cerrar" className="inline-flex shrink-0 items-center justify-center max-sm:-m-2 max-sm:h-9 max-sm:w-9"><X className="h-3.5 w-3.5" /></button>
            </div>
          ) : null}
        </div>
      )}
    </Drawer>
    {pagando && c && cxp && c.proveedor_id ? (
      <RegistrarPagoProveedor proveedorId={c.proveedor_id} proveedorNombre={c.proveedor_nombre ?? ""} moneda={cxp.moneda} cxpInicial={cxp.id}
        onClose={() => setPagando(false)} onHecho={(p) => { avisar(p); cargar(); }} />
    ) : null}
    {aviso}
    </>
  );
}

/** Compra a crédito: cómo está su cuenta a pagar (saldo, pagado, vencimiento y pagos aplicados). */
function CuentaPagarBloque({ c, puedePagar, onPagar }: { c: Compra; puedePagar: boolean; onPagar: () => void }) {
  const x = c.cuenta_pagar!;
  const din = (v: number) => dinero(v, x.moneda);
  const abierta = x.estado === "pendiente" || x.estado === "parcial";
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: TZ_PY });
  const atraso = abierta && x.vencimiento < hoy ? Math.round((Date.parse(hoy) - Date.parse(x.vencimiento)) / 86400000) : 0;
  const est = atraso > 0 ? { t: `Vencida · ${atraso} días de atraso`, c: "bg-rose-50 text-rose-700" } : ESTADO_CXP[x.estado] ?? ESTADO_CXP.pendiente;
  return (
    <div className="rounded-xl border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Cuenta a pagar</p>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${est.c}`}>{est.t}</span>
      </div>
      <dl className="grid grid-cols-2 gap-3 px-4 py-3 text-sm sm:grid-cols-3">
        <div className="min-w-0"><dt className="text-[11px] text-slate-500">Saldo</dt><dd className="font-bold tabular-nums text-slate-900 [overflow-wrap:anywhere]">{din(x.saldo)}</dd></div>
        <div className="min-w-0"><dt className="text-[11px] text-slate-500">Pagado</dt><dd className="font-semibold tabular-nums text-emerald-700 [overflow-wrap:anywhere]">{din(x.pagado)}</dd></div>
        <div className="col-span-2 sm:col-span-1"><dt className="text-[11px] text-slate-500">Vence</dt><dd className={`font-medium ${atraso > 0 ? "text-rose-600" : "text-slate-800"}`}>{fechaDia(x.vencimiento)}</dd></div>
      </dl>
      {x.pagos.length ? (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {x.pagos.map((p) => (
            <li key={p.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs ${p.anulado_at ? "opacity-60" : ""}`}>
              <span className={`font-mono font-semibold text-slate-800 ${p.anulado_at ? "line-through" : ""}`}>{p.numero}</span>
              <span className="text-slate-500 max-sm:order-last max-sm:-mt-1.5 max-sm:basis-full">{fecha(p.fecha)}</span>
              {p.anulado_at ? <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">Anulada</span> : null}
              <span className={`ml-auto font-semibold tabular-nums ${p.anulado_at ? "text-slate-400 line-through" : "text-emerald-700"}`}>{din(p.monto)}</span>
              <button onClick={() => imprimirOrdenPago(p.id, p.numero).catch(() => {})} title="Orden de pago en PDF" aria-label={`Orden de pago ${p.numero} en PDF`} className="inline-flex items-center justify-center rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 max-sm:-my-2 max-sm:-mr-2 max-sm:h-11 max-sm:w-11"><Printer className="h-4 w-4 sm:h-3.5 sm:w-3.5" /></button>
            </li>
          ))}
        </ul>
      ) : null}
      {puedePagar && abierta && Number(x.saldo) > 0 ? (
        <div className="border-t border-slate-100 px-4 py-3">
          <button onClick={onPagar} className="inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white hover:brightness-95 max-sm:min-h-11 max-sm:w-full" style={{ backgroundColor: TEAL }}>
            <Banknote className="h-4 w-4" /> Pagar {din(x.saldo)}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Dato({ l, v, mono }: { l: string; v: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-slate-500">{l}</dt>
      <dd className={`text-sm font-medium text-slate-800 [overflow-wrap:anywhere] ${mono ? "font-mono" : ""}`}>{v}</dd>
    </div>
  );
}
