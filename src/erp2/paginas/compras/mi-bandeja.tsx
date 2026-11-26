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
import { ChevronRight, ClipboardCheck, ClipboardList, HelpCircle, Loader2, PackageCheck, Wallet } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { clienteConfig } from "@/erp2/cliente.config";
import { gs } from "@/erp2/modules/compras/partes";

const TEAL = clienteConfig.color;

type Fila = { id: string; numero_oc: string; proveedor_nombre: string | null; total: number; estado: string; pago_estado: string };
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

  useEffect(() => {
    let vivo = true;
    apiFetch<Resp>("/api/v2/compras/mi-bandeja")
      .then((d) => { if (vivo) { setData(d); setError(null); } })
      .catch((e) => { if (vivo) setError((e as Error).message); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, []);

  const secciones = DEFS.filter((d) => data && (data[d.key] as Seccion | undefined));

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
      ) : secciones.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No tenés nada pendiente en compras por ahora.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {secciones.map((d) => {
            const s = data![d.key] as Seccion;
            const Icono = d.icono;
            return (
              <section key={String(d.key)} className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${TEAL}1a`, color: TEAL }}><Icono className="h-4.5 w-4.5" /></span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold text-slate-900">{d.titulo}</h2>
                    <p className="truncate text-[11px] text-slate-500">{d.subtitulo}</p>
                  </div>
                  <span className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums text-white" style={{ backgroundColor: s.total > 0 ? TEAL : "#cbd5e1" }}>{s.total}</span>
                </div>

                {s.rows.length === 0 ? (
                  <p className="px-4 py-8 text-center text-xs text-slate-400">Nada pendiente.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {s.rows.map((f) => {
                      const c = d.chip(f);
                      return (
                        <li key={f.id}>
                          <Link href={d.rowHref(f.id)} className="flex items-center gap-2 px-4 py-2.5 transition hover:bg-slate-50/70">
                            <span className="font-mono text-[11px] font-semibold text-slate-700">{f.numero_oc}</span>
                            <span className="min-w-0 flex-1 truncate text-[13px] text-slate-700">{f.proveedor_nombre ?? "—"}</span>
                            <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-800">{gs(f.total)}</span>
                            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${c.cls}`}>{c.label}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <Link href={d.verHref} className="mt-auto flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-xs font-semibold hover:bg-slate-50" style={{ color: TEAL }}>
                  Ver todas{s.total > s.rows.length ? ` (${s.total})` : ""}
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
