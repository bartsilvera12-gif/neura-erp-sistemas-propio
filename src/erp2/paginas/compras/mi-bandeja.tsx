"use client";

/**
 * /compras/mi-bandeja — inbox del flujo de compra (Fase 5.3).
 *
 * Cada persona ve solo las secciones que le tocan según su rol: "Mis solicitudes"
 * (las que creó, siempre), y "Por confirmar" / "Por pagar" / "Por recibir" según
 * confirma/paga/recibe (con fallback a administradores). Cada sección muestra un
 * resumen y lleva a la bandeja completa.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, ChevronRight, ClipboardCheck, ClipboardList, HelpCircle, Loader2, PackageCheck, Plus, Wallet } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { clienteConfig } from "@/erp2/cliente.config";
import { montoMoneda } from "@/erp2/modules/compras/partes";

const TEAL = clienteConfig.color;

type Fila = { id: string; numero_oc: string; proveedor_nombre: string | null; fecha?: string | null; total: number; moneda?: string | null; estado: string; pago_estado: string };
type Seccion = { total: number; rows: Fila[] };
type Resp = {
  roles: { confirma: boolean; paga: boolean; recibe: boolean };
  mis_solicitudes?: Seccion;
  por_confirmar?: Seccion;
  por_pagar?: Seccion;
  por_recibir?: Seccion;
};

type Def = { key: keyof Resp; titulo: string; subtitulo: string; icono: typeof ClipboardList; verHref: string; rowHref: (id: string) => string; chip: (f: Fila) => { label: string; cls: string } };

const CHIP_SOL: Record<string, { label: string; cls: string }> = {
  solicitada: { label: "Por confirmar", cls: "bg-amber-50 text-amber-700" },
  pendiente: { label: "Aprobada", cls: "bg-emerald-50 text-emerald-700" },
  recibida_parcial: { label: "Recibida en parte", cls: "bg-sky-50 text-sky-700" },
  recibida_total: { label: "Recibida", cls: "bg-slate-100 text-slate-600" },
  rechazada: { label: "Rechazada", cls: "bg-rose-50 text-rose-700" },
  cancelada: { label: "Cancelada", cls: "bg-slate-100 text-slate-600" },
};
const chipSol = (f: Fila) => CHIP_SOL[f.estado] ?? { label: f.estado, cls: "bg-slate-100 text-slate-600" };
const chipPago = (f: Fila) => (f.pago_estado === "confirmado" ? { label: "Pagada", cls: "bg-emerald-50 text-emerald-700" } : { label: "Por pagar", cls: "bg-amber-50 text-amber-700" });

const DEFS: Def[] = [
  { key: "mis_solicitudes", titulo: "Mis solicitudes", subtitulo: "Los pedidos que cargaste", icono: ClipboardList, verHref: "/compras/solicitudes", rowHref: () => "/compras/solicitudes", chip: chipSol },
  { key: "por_confirmar", titulo: "Por confirmar", subtitulo: "Solicitudes esperando tu OK", icono: ClipboardCheck, verHref: "/compras/solicitudes", rowHref: () => "/compras/solicitudes", chip: chipSol },
  { key: "por_pagar", titulo: "Por pagar", subtitulo: "Órdenes aprobadas esperando el pago", icono: Wallet, verHref: "/compras/por-pagar", rowHref: () => "/compras/por-pagar", chip: chipPago },
  { key: "por_recibir", titulo: "Por recibir", subtitulo: "Órdenes listas para recibir mercadería", icono: PackageCheck, verHref: "/compras/ordenes", rowHref: (id) => `/compras/ordenes?ver=${id}`, chip: chipSol },
];

export default function MiBandejaPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<keyof Resp | null>(null);

  useEffect(() => {
    let vivo = true;
    apiFetch<Resp>("/api/v2/compras/mi-bandeja")
      .then((d) => { if (vivo) { setData(d); setError(null); } })
      .catch((e) => { if (vivo) setError((e as Error).message); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, []);

  const secciones = DEFS.filter((d) => data && (data[d.key] as Seccion | undefined));
  const todoVacio = secciones.length > 0 && secciones.every((d) => (data![d.key] as Seccion).total === 0);

  return (
    <div className="space-y-5 pb-10 sm:space-y-6">
      <header className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Compras</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Mi bandeja de compras</h1>
        <p className="mt-1 text-[13px] text-slate-500 sm:text-sm">Lo que te toca a vos en el flujo de compra, según tu rol.</p>
        <Link href="/ayuda/flujo-solicitudes-de-compra" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-[var(--brand)]">
          <HelpCircle className="h-3.5 w-3.5" /> ¿Cómo funciona?
        </Link>
      </header>

      {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      {cargando ? (
        <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
      ) : todoVacio || secciones.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center shadow-sm">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl" style={{ backgroundColor: `${TEAL}14`, color: TEAL }}><CheckCircle2 className="h-7 w-7" /></span>
          <h2 className="mt-4 text-base font-semibold text-slate-900">Estás al día</h2>
          <p className="mt-1 max-w-xs text-sm text-slate-500">No tenés nada pendiente en compras según tu rol. Cuando te toque algo, aparece acá.</p>
          <Link href="/compras/solicitudes/nueva" className="mt-5 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white sm:min-h-0" style={{ backgroundColor: TEAL }}>
            <Plus className="h-4 w-4" /> Nueva solicitud
          </Link>
        </div>
      ) : (() => {
        const activaKey = tab ?? secciones.find((d) => (data![d.key] as Seccion).total > 0)?.key ?? secciones[0].key;
        const def = DEFS.find((d) => d.key === activaKey)!;
        const s = data![activaKey] as Seccion;
        return (
          <div className="space-y-4">
            {/* Selector de secciones (uno al lado del otro) */}
            <div className="flex flex-wrap gap-2">
              {secciones.map((d) => {
                const sec = data![d.key] as Seccion;
                const act = d.key === activaKey;
                const Icono = d.icono;
                return (
                  <button key={String(d.key)} type="button" onClick={() => setTab(d.key)}
                    className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold transition ${act ? "border-transparent text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800"}`}
                    style={act ? { backgroundColor: TEAL } : undefined}>
                    <Icono className="h-4 w-4" />
                    <span className="max-sm:hidden">{d.titulo}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${act ? "bg-white/25 text-white" : sec.total > 0 ? "text-[var(--brand)]" : "text-slate-400"}`} style={!act && sec.total > 0 ? { backgroundColor: `${TEAL}1a` } : !act ? { backgroundColor: "#f1f5f9" } : undefined}>{sec.total}</span>
                  </button>
                );
              })}
            </div>

            {/* Listado de la sección elegida */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-2.5 sm:px-5">
                <h2 className="text-sm font-semibold text-slate-900">{def.titulo}</h2>
                <p className="text-[11px] text-slate-500">{def.subtitulo}</p>
              </div>
              {s.rows.length === 0 ? (
                <p className="px-4 py-14 text-center text-sm text-slate-400">Nada pendiente acá por ahora.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="border-b bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-semibold sm:px-5">Nº</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Proveedor</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Fecha</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Total</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Estado</th>
                        <th className="px-3 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {s.rows.map((f) => {
                        const c = def.chip(f);
                        return (
                          <tr key={f.id} onClick={() => { window.location.href = def.rowHref(f.id); }}
                            className="cursor-pointer border-b border-slate-100 last:border-0 transition hover:bg-[var(--brand)]/[0.04]">
                            <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-800 sm:px-5">{f.numero_oc}</td>
                            <td className="px-3 py-2.5 text-slate-700">{f.proveedor_nombre ?? "—"}</td>
                            <td className="px-3 py-2.5 text-xs text-slate-500">{(f.fecha ?? "").slice(0, 10)}</td>
                            <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-800">{montoMoneda(f.total, f.moneda)}</td>
                            <td className="px-3 py-2.5"><span className={`rounded px-2 py-0.5 text-[11px] font-medium ${c.cls}`}>{c.label}</span></td>
                            <td className="px-3 py-2.5 text-right"><ChevronRight className="inline h-4 w-4 text-slate-300" /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {s.total > s.rows.length ? (
                <Link href={def.verHref} className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-xs font-semibold hover:bg-slate-50 sm:px-5" style={{ color: TEAL }}>
                  Ver las {s.total} en la bandeja completa
                  <ChevronRight className="h-4 w-4" />
                </Link>
              ) : null}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
