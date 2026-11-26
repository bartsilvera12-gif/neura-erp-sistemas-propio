"use client";

/**
 * /compras/ordenes — órdenes de compra (Fase 3). Lista con búsqueda inteligente y filtro
 * por estado (por defecto las abiertas: pendientes y recibidas en parte), con
 * barra de cuánto llegó. El detalle muestra pedido / recibido / falta por producto y las
 * compras con que se recibió, y permite Recibir mercadería, PDF, Editar y Cancelar.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Ban, Building2, CalendarDays, ChevronRight, ClipboardList, Download, FileText, Loader2, PackageCheck, Pencil, Plus, Search, StickyNote, Truck, Wallet, X } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { descargarArchivo } from "@/erp2/lib/api/client-blob";
import { clienteConfig } from "@/erp2/cliente.config";
import { Select } from "@/erp2/components/Select";
import { Drawer } from "@/erp2/components/Drawer";
import { AccionesPagina, BarraFiltros, EncabezadoPagina } from "@/erp2/components/EncabezadoPagina";
import { TablaTarjetas, type ColumnaTabla } from "@/erp2/components/TablaResponsive";
import { TZ_PY } from "@/erp2/lib/fecha/paraguay";
import { ESTADO_OC, type OrdenCompra } from "@/erp2/modules/compras/ordenes";

const TEAL = clienteConfig.color;
const POR_PAGINA = 25;
const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const num = (v: number) => Number(v || 0).toLocaleString("es-PY", { maximumFractionDigits: 3 });
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "short", year: "numeric" });
const fechaDia = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("es-PY", { day: "2-digit", month: "short", year: "numeric" });
const TH = "whitespace-nowrap px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[var(--brand)]";
const hoy = () => new Date().toLocaleDateString("sv-SE", { timeZone: TZ_PY });

export default function OrdenesPage() {
  const [rows, setRows] = useState<OrdenCompra[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [cargando, setCargando] = useState(true);
  const [borrador, setBorrador] = useState("");
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("abiertas");
  const [viendo, setViendo] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    // /compras/ordenes?ver=<id> (desde una compra o desde "Recibir"): abre esa orden.
    const ver = new URLSearchParams(window.location.search).get("ver");
    if (ver && /^[0-9a-f-]{36}$/i.test(ver)) { setViendo(ver); window.history.replaceState(null, "", "/compras/ordenes"); }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { setQ(borrador.trim()); setPagina(1); }, 350);
    return () => clearTimeout(t);
  }, [borrador]);
  useEffect(() => {
    let cancel = false;
    setCargando(true);
    const sp = new URLSearchParams({ pagina: String(pagina), por_pagina: String(POR_PAGINA) });
    if (q) sp.set("q", q);
    if (estado) sp.set("estado", estado);
    apiFetch<{ rows: OrdenCompra[]; total: number }>(`/api/ordenes-compra?${sp}`)
      .then((r) => { if (!cancel) { setRows(r.rows); setTotal(r.total); } })
      .catch(() => { if (!cancel) { setRows([]); setTotal(0); } })
      .finally(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, [pagina, q, estado, recarga]);

  const refrescar = useCallback(() => setRecarga((k) => k + 1), []);
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  const filtrosActivos = estado !== "abiertas" ? 1 : 0;
  const limpiar = () => { setBorrador(""); setQ(""); setEstado("abiertas"); setPagina(1); };

  // Tabla en ≥ 768 px; en celular cada orden es una tarjeta (proveedor, número · fecha, total, estado y cuánto llegó).
  const columnas: ColumnaTabla<OrdenCompra>[] = [
    {
      key: "numero", titulo: "Número", movil: "subtitulo", claseTh: "pl-5", claseTd: "whitespace-nowrap pl-5 font-mono text-xs font-semibold text-slate-800",
      celda: (o) => o.numero_oc,
      celdaMovil: (o) => <><span className="font-mono text-xs">{o.numero_oc}</span> · {fecha(o.fecha)}</>,
    },
    { key: "fecha", titulo: "Fecha", movil: "oculto", claseTd: "whitespace-nowrap text-xs text-slate-600", celda: (o) => fecha(o.fecha) },
    { key: "proveedor", titulo: "Proveedor", movil: "titulo", claseTd: "font-semibold text-slate-800", celda: (o) => o.proveedor_nombre },
    {
      key: "llego", titulo: "Llegó", movil: "dato",
      celda: (o) => {
        const pct = o.unidades ? Math.min(100, Math.round(((o.recibidas ?? 0) / o.unidades) * 100)) : 0;
        return (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-slate-100 max-md:w-12">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: pct >= 100 ? "#10b981" : TEAL }} />
            </div>
            <span className="text-[11px] tabular-nums text-slate-500">{num(o.recibidas ?? 0)} de {num(o.unidades ?? 0)}</span>
          </div>
        );
      },
      celdaMovil: (o) => `Llegó ${num(o.recibidas ?? 0)} de ${num(o.unidades ?? 0)}`,
    },
    {
      key: "entrega", titulo: "Entrega", movil: "dato",
      claseTd: "whitespace-nowrap text-xs",
      celda: (o) => {
        const atrasada = o.fecha_entrega && o.fecha_entrega < hoy() && (o.estado === "pendiente" || o.estado === "recibida_parcial");
        return <span className={atrasada ? "font-semibold text-rose-600" : "text-slate-600"}>{o.fecha_entrega ? fechaDia(o.fecha_entrega) : "—"}{atrasada ? " · atrasada" : ""}</span>;
      },
    },
    { key: "estado", titulo: "Estado", movil: "chip", celda: (o) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ESTADO_OC[o.estado].clase}`}>{ESTADO_OC[o.estado].texto}</span> },
    {
      key: "total", titulo: "Total estimado", movil: "valor", claseTh: "pr-5 text-right",
      claseTd: "whitespace-nowrap pr-5 text-right font-bold tabular-nums text-slate-900",
      celda: (o) => (Number(o.total) ? gs(o.total) : "—"),
    },
  ];

  return (
    <div className="space-y-5 pb-10 sm:space-y-6">
      <EncabezadoPagina
        titulo="Órdenes de compra"
        subtitulo="Lo que le pediste a cada proveedor y cuánto ya llegó."
        acciones={<AccionesPagina acciones={[{ etiqueta: "Nueva orden", icono: <Plus />, href: "/compras/ordenes/nueva", primaria: true }]} />}
      />

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-3 py-3 sm:px-5">
          <BarraFiltros
            plano
            activos={filtrosActivos}
            onLimpiar={limpiar}
            busqueda={
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input type="search" value={borrador} onChange={(e) => setBorrador(e.target.value)} placeholder="Buscar por número, proveedor o producto…"
                  aria-label="Buscar órdenes de compra" enterKeyHint="search"
                  className="h-11 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)] md:h-auto md:py-2.5" />
              </div>
            }
          >
            <Select value={estado} onChange={(v) => { setEstado(v); setPagina(1); }} minWidth={190} etiqueta="Estado" options={[
              ["abiertas", "Abiertas (por recibir)"], ["", "Todas"], ["pendiente", "Pendientes"], ["recibida_parcial", "Recibidas en parte"], ["recibida_total", "Recibidas"], ["cancelada", "Canceladas"],
            ]} />
          </BarraFiltros>
        </div>

        {cargando && rows.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-400">Cargando…</p>
        ) : rows.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <ClipboardList className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-medium text-slate-700">{estado === "abiertas" && !q ? "No hay órdenes esperando mercadería" : "Ninguna orden coincide"}</p>
            <Link href="/compras/ordenes/nueva" className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white sm:min-h-0" style={{ backgroundColor: TEAL }}>
              <Plus className="h-4 w-4" /> Nueva orden
            </Link>
          </div>
        ) : (
          <TablaTarjetas
            filas={rows}
            columnas={columnas}
            claveFila={(o) => o.id}
            onFila={(o) => setViendo(o.id)}
            cargando={cargando}
            minAncho={860}
            claseTabla="w-full text-left text-sm"
            claseThead="border-b-2 border-[var(--brand)]/15 bg-[var(--brand)]/5"
            thBase={TH}
            tdBase="px-3 py-3"
          />
        )}
        {total > POR_PAGINA ? (
          <div className="flex flex-col gap-2 border-t border-slate-100 px-3 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <span className="text-center sm:text-left">Página {pagina} de {totalPaginas} · {total} órdenes</span>
            <div className="flex gap-2">
              <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40 max-sm:min-h-11 max-sm:flex-1 max-sm:text-sm">Anterior</button>
              <button disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40 max-sm:min-h-11 max-sm:flex-1 max-sm:text-sm">Siguiente</button>
            </div>
          </div>
        ) : null}
      </section>

      {viendo ? <DetalleOrden id={viendo} onClose={() => setViendo(null)} onCambio={refrescar} /> : null}
    </div>
  );
}

function DetalleOrden({ id, onClose, onCambio }: { id: string; onClose: () => void; onCambio: () => void }) {
  const [o, setO] = useState<OrdenCompra | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    apiFetch<OrdenCompra>(`/api/ordenes-compra/${id}`).then(setO).catch((e) => setError((e as Error).message));
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  async function cancelar() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/ordenes-compra/${id}/cancelar`, { method: "POST", body: JSON.stringify({ motivo }) });
      setCancelando(false);
      cargar();
      onCambio();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const abierta = o?.estado === "pendiente" || o?.estado === "recibida_parcial";
  const avance = (() => {
    const items = o?.items ?? [];
    const pedido = items.reduce((t, i) => t + Number(i.cantidad || 0), 0);
    const recibido = items.reduce((t, i) => t + Math.min(Number(i.cantidad_recibida || 0), Number(i.cantidad || 0)), 0);
    return { pedido, recibido: items.reduce((t, i) => t + Number(i.cantidad_recibida || 0), 0), pct: pedido > 0 ? Math.round((recibido / pedido) * 100) : 0 };
  })();
  // "en 3 días" / "atrasada 2 días" mientras la orden siga abierta.
  const entrega = (() => {
    if (!o?.fecha_entrega || !abierta) return null;
    const dias = Math.round((Date.parse(`${o.fecha_entrega}T12:00:00`) - Date.parse(`${hoy()}T12:00:00`)) / 86400000);
    if (dias < 0) return { texto: `atrasada ${-dias} día${dias === -1 ? "" : "s"}`, tono: "text-rose-600" };
    if (dias === 0) return { texto: "hoy", tono: "text-amber-600" };
    return { texto: `en ${dias} día${dias === 1 ? "" : "s"}`, tono: "text-slate-400" };
  })();
  const editable = o?.estado === "pendiente" && !(o.items ?? []).some((i) => Number(i.cantidad_recibida) > 0);

  return (
    <Drawer
      titulo={o ? `Orden ${o.numero_oc}` : "Orden de compra"}
      subtitulo={o ? `${o.proveedor_nombre} · ${ESTADO_OC[o.estado].texto}` : undefined}
      onClose={onClose}
      footer={o ? (
        cancelando ? (
          <>
            <button onClick={() => setCancelando(false)} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 max-sm:flex-1">Volver</button>
            <button onClick={cancelar} disabled={busy || !motivo.trim()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-40 max-sm:flex-[2] max-sm:px-3">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} {o.estado === "recibida_parcial" ? "Confirmar cierre" : "Confirmar cancelación"}
            </button>
          </>
        ) : (
          <>
            <button onClick={() => descargarArchivo(`/api/ordenes-compra/${o.id}/pdf`, `orden-compra-${o.numero_oc}.pdf`).catch(() => {})}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 max-sm:flex-1">
              <Download className="h-4 w-4" /> PDF
            </button>
            {abierta ? (
              <Link href={`/compras/nueva?oc=${o.id}`} className="inline-flex items-center justify-center gap-1.5 rounded-xl px-5 py-2.5 text-sm font-semibold text-white hover:brightness-95 max-sm:flex-[2] max-sm:px-3" style={{ backgroundColor: TEAL }}>
                <PackageCheck className="h-4 w-4" /> Recibir mercadería
              </Link>
            ) : null}
          </>
        )
      ) : undefined}
    >
      {!o ? (
        error ? <p className="text-sm text-rose-600">{error}</p> : <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
      ) : (
        <div className="space-y-5">
          {o.estado === "cancelada" ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <p className="font-semibold">Orden cancelada</p>
              <p className="text-xs">{o.cancelada_motivo}{o.cancelada_por ? ` · ${o.cancelada_por}` : ""}{o.cancelada_at ? ` · ${fecha(o.cancelada_at)}` : ""}</p>
            </div>
          ) : null}
          {/* Avance de la recepción: lo primero que se quiere saber de una orden. */}
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50/80 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${ESTADO_OC[o.estado].clase}`}>{ESTADO_OC[o.estado].texto}</span>
                <p className="mt-2 text-sm text-slate-600">
                  Llegaron <b className="font-semibold text-slate-900 tabular-nums">{num(avance.recibido)}</b> de <b className="font-semibold text-slate-900 tabular-nums">{num(avance.pedido)}</b> unidades
                </p>
              </div>
              <div className="sm:text-right">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Total estimado</p>
                <p className="text-xl font-bold tabular-nums tracking-tight text-slate-900">{Number(o.total) ? gs(o.total) : "—"}</p>
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200/70">
              <div className="h-full rounded-full transition-all" style={{ width: `${avance.pct}%`, backgroundColor: avance.pct >= 100 ? "#10b981" : TEAL }} />
            </div>
            <p className="mt-1 text-right text-[11px] font-semibold tabular-nums text-slate-500">{avance.pct}%</p>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border border-slate-200 px-4 py-3.5">
            <Dato icono={CalendarDays} l="Creada" v={`${fecha(o.fecha)}${o.usuario_nombre ? ` · ${o.usuario_nombre}` : ""}`} />
            <Dato icono={Truck} l="Entrega esperada" v={o.fecha_entrega ? fechaDia(o.fecha_entrega) : "A coordinar"}
              extra={entrega} />
            <Dato icono={Wallet} l="Condición" v={o.tipo_pago === "credito" ? `Crédito${o.plazo_dias ? ` ${o.plazo_dias} días` : ""}` : "Contado"} />
            <Dato icono={Building2} l="Proveedor" v={o.proveedor_nombre} />
          </dl>

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Productos ({(o.items ?? []).length})</p>
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200">
              {(o.items ?? []).map((i) => {
                const pedido = Number(i.cantidad);
                const llego = Number(i.cantidad_recibida);
                const falta = Math.max(pedido - llego, 0);
                const pct = pedido > 0 ? Math.min(100, Math.round((llego / pedido) * 100)) : 0;
                return (
                  <li key={i.id} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800 max-sm:line-clamp-2 max-sm:[overflow-wrap:anywhere] sm:truncate">{i.producto_nombre}</p>
                        <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
                          {Number(i.costo_unitario) ? `${gs(i.costo_unitario)} c/u · subtotal ${gs(pedido * Number(i.costo_unitario))}` : "Sin costo cargado"}
                        </p>
                      </div>
                      {falta > 0 && o.estado !== "cancelada" ? (
                        <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Faltan {num(falta)}</span>
                      ) : falta === 0 ? (
                        <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          {llego > pedido ? `Completo · ${num(llego - pedido)} de más` : "Completo"}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 flex items-center gap-2.5">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: pct >= 100 ? "#10b981" : TEAL }} />
                      </div>
                      <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-600">{num(llego)} / {num(pedido)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {o.compras?.length ? (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Recibida con</p>
              <ul className="space-y-2">
                {o.compras.map((c) => (
                  <li key={c.id}>
                    <Link href={`/compras?ver=${c.id}`} title="Ver la compra"
                      className={`group flex items-center gap-3 rounded-2xl border border-slate-200 px-3.5 py-2.5 transition hover:border-[var(--brand)]/50 hover:bg-[var(--brand-50)] ${c.estado === "anulada" ? "opacity-50" : ""}`}>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-400)]/12 text-[var(--brand)]"><FileText className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className={`block font-mono text-xs font-semibold text-slate-800 ${c.estado === "anulada" ? "line-through" : ""}`}>{c.numero_control}</span>
                        <span className="block truncate text-[11px] text-slate-500">Factura {c.numero_factura} · {fecha(c.fecha)}{c.estado === "anulada" ? " · anulada" : ""}</span>
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-slate-800">{gs(c.total)}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-[var(--brand)]" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {o.observacion ? (
            <div className="flex gap-2.5 rounded-2xl border border-amber-200/70 bg-amber-50/50 px-4 py-3">
              <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-700">Observación</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{o.observacion}</p>
              </div>
            </div>
          ) : null}

          {!cancelando && (editable || abierta) ? (
            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
              {editable ? (
                <Link href={`/compras/ordenes/nueva?editar=${o.id}`} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 max-sm:min-h-11 max-sm:w-full max-sm:text-sm">
                  <Pencil className="h-3.5 w-3.5" /> Editar orden
                </Link>
              ) : null}
              {abierta ? (
                <button onClick={() => setCancelando(true)} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 px-3.5 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 max-sm:min-h-11 max-sm:w-full max-sm:text-sm">
                  <Ban className="h-3.5 w-3.5" /> {o.estado === "recibida_parcial" ? "Cerrar orden (no esperar lo que falta)" : "Cancelar orden"}
                </button>
              ) : null}
            </div>
          ) : null}

          {cancelando ? (
            <div className="rounded-xl border border-rose-200 p-4">
              <p className="text-sm font-semibold text-slate-800">{o.estado === "recibida_parcial" ? "¿Por qué la cerrás?" : "¿Por qué la cancelás?"}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {o.estado === "recibida_parcial"
                  ? "Lo que ya llegó queda como está (sus compras siguen vigentes); lo que falta deja de esperarse y la orden ya no se puede recibir."
                  : "La orden queda cancelada y no se puede recibir."}
              </p>
              <textarea autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={500} enterKeyHint="done" placeholder="Ej: el proveedor no tiene stock"
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
  );
}

function Dato({ l, v, icono: Icono, extra }: {
  l: string; v: string; icono: React.ComponentType<{ className?: string }>; extra?: { texto: string; tono: string } | null;
}) {
  return (
    <div className="flex min-w-0 gap-2.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><Icono className="h-3.5 w-3.5" /></span>
      <div className="min-w-0">
        <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{l}</dt>
        <dd className="text-sm font-medium text-slate-800 max-sm:[overflow-wrap:anywhere] sm:truncate" title={v}>{v}</dd>
        {extra ? <dd className={`text-[11px] font-semibold ${extra.tono}`}>{extra.texto}</dd> : null}
      </div>
    </div>
  );
}
