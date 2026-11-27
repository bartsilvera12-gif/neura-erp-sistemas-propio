"use client";

/**
 * /compras/solicitudes — bandeja de solicitudes de compra.
 *
 * Fase 1: comercial crea solicitudes (quedan en estado 'solicitada').
 * Fase 2: Alan las confirma — puede ajustar cantidades/costos o quitar líneas que
 *   no se consiguen, y Aprobar (→ 'aprobada') o Rechazar (con motivo). El pago
 *   (Guillermo) y la recepción (stock) llegan en las próximas fases.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Ban, CheckCircle2, ClipboardList, HelpCircle, Loader2, Plus, Trash2, X } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { clienteConfig } from "@/erp2/cliente.config";
import { Select } from "@/erp2/components/Select";
import { Drawer } from "@/erp2/components/Drawer";
import { equivGs, montoMoneda } from "@/erp2/modules/compras/partes";

const TEAL = clienteConfig.color;

type Solicitud = {
  id: string;
  numero_oc: string;
  fecha: string;
  proveedor_nombre: string | null;
  estado: string;
  total: number;
  moneda?: string | null;
  tipo_cambio?: number | null;
  cantidad_items: number;
  unidades: number;
  usuario_nombre: string | null;
};

type ItemDetalle = {
  id: string;
  producto_id: string | null;
  producto_nombre: string;
  producto_sku: string | null;
  cantidad: number;
  costo_unitario: number;
};
type Detalle = Solicitud & {
  observacion: string | null;
  items: ItemDetalle[];
};

// estado ya viene mapeado al 2.0: 'solicitada' | 'pendiente' (=aprobada) | 'rechazada' | 'cancelada'.
const ESTADO: Record<string, { label: string; cls: string }> = {
  solicitada: { label: "Por confirmar", cls: "bg-amber-50 text-amber-700" },
  pendiente: { label: "Aprobada", cls: "bg-emerald-50 text-emerald-700" },
  rechazada: { label: "Rechazada", cls: "bg-rose-50 text-rose-700" },
  cancelada: { label: "Cancelada", cls: "bg-slate-100 text-slate-600" },
};
const FILTROS: [string, string][] = [
  ["solicitada", "Por confirmar"],
  ["pendiente", "Aprobadas"],
  ["rechazada", "Rechazadas"],
  ["", "Todas"],
];

export default function SolicitudesPage() {
  const [rows, setRows] = useState<Solicitud[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [estado, setEstado] = useState("solicitada");
  const [viendo, setViendo] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    const sp = new URLSearchParams();
    if (estado) sp.set("estado", estado);
    (async () => {
      try {
        const d = await apiFetch<{ rows: Solicitud[] }>(`/api/v2/compras/solicitudes?${sp}`);
        if (vivo) { setRows(d.rows ?? []); setError(null); }
      } catch (e) {
        if (vivo) setError((e as Error).message);
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => { vivo = false; };
  }, [estado, recarga]);

  const refrescar = useCallback(() => setRecarga((k) => k + 1), []);

  return (
    <div className="space-y-5 pb-10 sm:space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Compras</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Solicitudes de compra</h1>
          <p className="mt-1 text-[13px] text-slate-500 sm:text-sm">Pedidos de productos a comprar. Se confirman antes de pagarse y recibirse.</p>
          <Link href="/ayuda/flujo-solicitudes-de-compra" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-[var(--brand)]">
            <HelpCircle className="h-3.5 w-3.5" /> ¿Cómo funciona?
          </Link>
        </div>
        <Link href="/compras/solicitudes/nueva" className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white sm:min-h-0" style={{ backgroundColor: TEAL }}>
          <Plus className="h-4 w-4" /> Nueva solicitud
        </Link>
      </header>

      <div className="flex items-center gap-3">
        <Select value={estado} onChange={(v) => setEstado(v)} minWidth={180} etiqueta="Mostrar" options={FILTROS} />
      </div>

      {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left">Nº</th>
              <th className="px-3 py-2.5 text-left">Fecha</th>
              <th className="px-3 py-2.5 text-left">Proveedor</th>
              <th className="px-3 py-2.5 text-left">Solicitó</th>
              <th className="px-3 py-2.5 text-right">Ítems</th>
              <th className="px-3 py-2.5 text-right">Total est.</th>
              <th className="px-3 py-2.5 text-left">Estado</th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-12 text-center">
                <ClipboardList className="mx-auto h-7 w-7 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">{estado === "solicitada" ? "No hay solicitudes por confirmar." : "No hay solicitudes para este filtro."}</p>
                {estado === "solicitada" ? (
                  <Link href="/compras/solicitudes/nueva" className="mt-1 inline-block text-xs font-semibold hover:underline" style={{ color: TEAL }}>Cargar la primera</Link>
                ) : null}
              </td></tr>
            ) : rows.map((s) => {
              const e = ESTADO[s.estado] ?? { label: s.estado, cls: "bg-slate-100 text-slate-600" };
              return (
                <tr key={s.id} onClick={() => setViendo(s.id)} className="cursor-pointer border-b last:border-0 hover:bg-slate-50/60">
                  <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-800">{s.numero_oc}</td>
                  <td className="px-3 py-2">{(s.fecha ?? "").slice(0, 10)}</td>
                  <td className="px-3 py-2">{s.proveedor_nombre ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{s.usuario_nombre ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.cantidad_items}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {montoMoneda(s.total, s.moneda)}
                    {equivGs(s.total, s.moneda, s.tipo_cambio) ? <span className="block text-[10px] font-normal text-slate-400">{equivGs(s.total, s.moneda, s.tipo_cambio)}</span> : null}
                  </td>
                  <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs font-medium ${e.cls}`}>{e.label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {viendo ? <DetalleSolicitud id={viendo} onClose={() => setViendo(null)} onCambio={refrescar} /> : null}
    </div>
  );
}

/** Detalle + confirmación (Alan). Edita cantidades/costos, quita líneas, aprueba o rechaza. */
function DetalleSolicitud({ id, onClose, onCambio }: { id: string; onClose: () => void; onCambio: () => void }) {
  const [o, setO] = useState<Detalle | null>(null);
  const [lineas, setLineas] = useState<ItemDetalle[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState("");

  const cargar = useCallback(() => {
    apiFetch<Detalle>(`/api/v2/compras/solicitudes/${id}`)
      .then((d) => { setO(d); setLineas(d.items ?? []); })
      .catch((e) => setError((e as Error).message));
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  const porConfirmar = o?.estado === "solicitada";
  const totalEst = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0), 0);

  function setLinea(i: number, campo: "cantidad" | "costo_unitario", valor: number) {
    setLineas((ls) => ls.map((l, k) => (k === i ? { ...l, [campo]: valor } : l)));
  }
  function quitar(i: number) {
    setLineas((ls) => ls.filter((_, k) => k !== i));
  }

  async function aprobar() {
    if (lineas.length === 0) { setError("Dejá al menos una línea para aprobar."); return; }
    if (lineas.some((l) => !(Number(l.cantidad) > 0))) { setError("Todas las cantidades deben ser mayores a 0."); return; }
    setBusy(true); setError(null);
    try {
      const items = lineas.map((l) => ({ producto_id: l.producto_id, cantidad: Number(l.cantidad), costo_unitario: Number(l.costo_unitario) || 0 }));
      await apiFetch(`/api/v2/compras/solicitudes/${id}/confirmar`, { method: "POST", body: JSON.stringify({ items }) });
      onCambio();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function rechazar() {
    setBusy(true); setError(null);
    try {
      await apiFetch(`/api/v2/compras/solicitudes/${id}/rechazar`, { method: "POST", body: JSON.stringify({ motivo }) });
      onCambio();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const estadoChip = o ? (ESTADO[o.estado] ?? { label: o.estado, cls: "bg-slate-100 text-slate-600" }) : null;

  return (
    <Drawer
      titulo={o ? `Solicitud ${o.numero_oc}` : "Solicitud de compra"}
      subtitulo={o ? `${o.proveedor_nombre ?? "Sin proveedor"}${o.usuario_nombre ? ` · pidió ${o.usuario_nombre}` : ""}` : undefined}
      onClose={onClose}
      footer={o && porConfirmar ? (
        rechazando ? (
          <>
            <button onClick={() => setRechazando(false)} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 max-sm:flex-1">Volver</button>
            <button onClick={rechazar} disabled={busy || !motivo.trim()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-40 max-sm:flex-[2] max-sm:px-3">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} Confirmar rechazo
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setRechazando(true)} disabled={busy} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 max-sm:flex-1">
              <Ban className="h-4 w-4" /> Rechazar
            </button>
            <button onClick={aprobar} disabled={busy || lineas.length === 0} className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-40 max-sm:flex-[2] max-sm:px-3" style={{ backgroundColor: TEAL }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Aprobar
            </button>
          </>
        )
      ) : undefined}
    >
      {!o ? (
        error ? <p className="text-sm text-rose-600">{error}</p> : <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50/80 p-4">
            {estadoChip ? <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${estadoChip.cls}`}>{estadoChip.label}</span> : null}
            <div className="text-right">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Total estimado</p>
              <p className="text-xl font-bold tabular-nums tracking-tight text-slate-900">{totalEst ? montoMoneda(totalEst, o.moneda) : "—"}</p>
              {equivGs(totalEst, o.moneda, o.tipo_cambio) ? <p className="text-[11px] font-normal text-slate-400">{equivGs(totalEst, o.moneda, o.tipo_cambio)}</p> : null}
            </div>
          </div>

          {porConfirmar ? (
            <p className="rounded-xl border border-amber-200/70 bg-amber-50/50 px-3 py-2 text-xs text-amber-800">
              Revisá y ajustá lo que se pueda conseguir. Al aprobar queda firme para pagar y recibir.
            </p>
          ) : null}

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Productos ({lineas.length})</p>
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200">
              {lineas.map((l, i) => (
                <li key={l.id} className="px-3 py-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800 [overflow-wrap:anywhere]">{l.producto_nombre}</p>
                      {l.producto_sku ? <p className="mt-0.5 text-[11px] text-slate-400">SKU {l.producto_sku}</p> : null}
                    </div>
                    {porConfirmar ? (
                      <button onClick={() => quitar(i)} aria-label="Quitar" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                  {porConfirmar ? (
                    <div className="mt-2 flex flex-wrap items-end gap-3">
                      <label className="text-[11px] font-medium text-slate-500">
                        Cantidad
                        <input type="number" min={0} step="any" value={l.cantidad} onChange={(e) => setLinea(i, "cantidad", Number(e.target.value))}
                          className="mt-0.5 block w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-sm tabular-nums outline-none focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]" />
                      </label>
                      <label className="text-[11px] font-medium text-slate-500">
                        Costo unit. ({o.moneda === "USD" ? "US$" : "Gs."})
                        <input type="number" min={0} step="any" value={l.costo_unitario} onChange={(e) => setLinea(i, "costo_unitario", Number(e.target.value))}
                          className="mt-0.5 block w-32 rounded-lg border border-slate-200 px-2 py-1.5 text-sm tabular-nums outline-none focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]" />
                      </label>
                      <span className="ml-auto text-sm font-semibold tabular-nums text-slate-700">{montoMoneda((Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0), o.moneda)}</span>
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] text-slate-500 tabular-nums">
                      {Number(l.cantidad).toLocaleString("es-PY")} × {montoMoneda(l.costo_unitario, o.moneda)} = {montoMoneda((Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0), o.moneda)}
                    </p>
                  )}
                </li>
              ))}
              {lineas.length === 0 ? <li className="px-3 py-6 text-center text-xs text-slate-400">Sin líneas. Volvé a agregar o cerrá sin aprobar.</li> : null}
            </ul>
          </div>

          {o.observacion ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">Observación</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{o.observacion}</p>
            </div>
          ) : null}

          {rechazando ? (
            <div className="rounded-xl border border-rose-200 p-4">
              <p className="text-sm font-semibold text-slate-800">¿Por qué la rechazás?</p>
              <p className="mt-0.5 text-xs text-slate-500">El comercial verá el motivo. La solicitud queda rechazada.</p>
              <textarea autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={500} placeholder="Ej: el proveedor no tiene stock"
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-rose-400 focus:ring-4 focus:ring-rose-100" />
            </div>
          ) : null}

          {error ? (
            <div className="flex items-start justify-between gap-2 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">
              <span className="min-w-0 [overflow-wrap:anywhere]">{error}</span>
              <button onClick={() => setError(null)} aria-label="Cerrar" className="inline-flex shrink-0 items-center justify-center"><X className="h-3.5 w-3.5" /></button>
            </div>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}
