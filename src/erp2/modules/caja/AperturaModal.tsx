"use client";

/**
 * Abrir caja: elegir la caja (las de la sucursal del usuario; ADMIN ve todas, agrupadas por
 * sucursal) y el monto inicial con el que arranca el cajón. Enter abre.
 */
import { useMemo, useState } from "react";
import { Loader2, Lock, Unlock } from "lucide-react";
import MontoInput from "@/erp2/components/ui/MontoInput";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, ET, INPUT, ModalDocumento, TEAL } from "@/erp2/modules/inventario/ui";
import { abrirCaja, fechaHora, type EstadoCajas } from "@/erp2/modules/caja/turno";
import { formatGs } from "@/erp2/modules/caja/lib";

export function AperturaModal({ estado, puntoInicial, onClose, onAbierta }: {
  estado: EstadoCajas;
  puntoInicial?: string | null;
  onClose: () => void;
  onAbierta: (turnoId: string) => void;
}) {
  // Cajas que se pueden abrir: activas y sin turno en curso.
  const grupos = useMemo(
    () => estado.sucursales
      .filter((s) => s.activa)
      .map((s) => ({ ...s, cajas: s.cajas.filter((c) => c.activo) }))
      .filter((s) => s.cajas.length),
    [estado],
  );
  const libres = grupos.flatMap((s) => s.cajas.filter((c) => !c.turno).map((c) => ({ ...c, sucursal: s.nombre })));
  const [punto, setPunto] = useState<string>(() => (puntoInicial && libres.some((c) => c.id === puntoInicial) ? puntoInicial : libres[0]?.id ?? ""));
  const [monto, setMonto] = useState(0);
  const [obs, setObs] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const elegida = libres.find((c) => c.id === punto);

  async function abrir(e?: React.FormEvent) {
    e?.preventDefault();
    if (!punto || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await abrirCaja(punto, monto, obs.trim() || null);
      onAbierta(r.caja_id);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <ModalDocumento titulo="Abrir caja" subtitulo="Empieza un turno: todo lo que se venda y cobre queda en esta caja hasta el cierre" ancho="max-w-lg"
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className={BOTON_SECUNDARIO}>Cancelar</button>
          <button type="submit" form="form-apertura" disabled={busy || !punto} className={BOTON_PRIMARIO} style={{ backgroundColor: TEAL }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlock className="h-4 w-4" />} Abrir {elegida ? elegida.nombre : "caja"}
          </button>
        </>
      }>
      <form id="form-apertura" onSubmit={abrir} className="space-y-5">
        {libres.length === 0 ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Todas tus cajas ya están abiertas{estado.es_admin ? "" : " (o tu sucursal no tiene cajas: pedile a un administrador que cree una)"}.
          </p>
        ) : (
          <div>
            <span className={ET}>Caja</span>
            <div className="space-y-3">
              {grupos.map((s) => (
                <div key={s.id}>
                  {grupos.length > 1 ? <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{s.nombre}</p> : null}
                  <div className="grid gap-2 sm:grid-cols-2">
                    {s.cajas.map((c) => {
                      const ocupada = !!c.turno;
                      const sel = c.id === punto;
                      return (
                        <button key={c.id} type="button" disabled={ocupada} onClick={() => setPunto(c.id)}
                          className={`rounded-xl border px-3.5 py-2.5 text-left transition ${ocupada ? "cursor-not-allowed border-slate-100 bg-slate-50 opacity-60" : sel ? "ring-2" : "border-slate-200 hover:border-slate-300"}`}
                          style={sel ? { borderColor: TEAL, backgroundColor: `${TEAL}0d`, ["--tw-ring-color" as string]: `${TEAL}40` } : undefined}>
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-slate-800">{c.nombre}</span>
                            {ocupada ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Abierta</span> : <Lock className="h-3.5 w-3.5 text-slate-300" />}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                            {ocupada ? `Turno N° ${c.turno!.numero_caja} · ${c.turno!.abierta_por_nombre ?? "—"}` : `Sale de ${c.deposito_nombre}`}
                          </span>
                          {!ocupada && c.ultimo_cierre?.fecha_cierre ? (
                            <span className="block text-[10px] text-slate-400">Último cierre {fechaHora(c.ultimo_cierre.fecha_cierre)}</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <label className="block">
          <span className={ET}>Monto inicial en efectivo</span>
          <MontoInput value={monto || ""} onChange={(n) => setMonto(Math.max(0, Math.round(n)))} decimals={false} autoFocus placeholder="0"
            className={`${INPUT} text-right text-xl font-bold tabular-nums`} />
          <span className="mt-1 block text-[11px] text-slate-400">El cambio con el que arranca el cajón. Al cerrar se cuenta contra esto.</span>
        </label>
        <div className="flex flex-wrap gap-1.5">
          {[0, 100000, 200000, 300000, 500000].map((v) => (
            <button key={v} type="button" onClick={() => setMonto(v)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition max-sm:min-h-11 max-sm:px-4 max-sm:text-sm ${monto === v ? "border-[var(--brand)] bg-[var(--brand-50)] text-[var(--brand)]" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
              {v === 0 ? "Sin cambio" : formatGs(v)}
            </button>
          ))}
        </div>
        <label className="block">
          <span className={ET}>Observación <span className="font-normal text-slate-400">(opcional)</span></span>
          <input value={obs} onChange={(e) => setObs(e.target.value)} maxLength={500} placeholder="Ej. turno mañana" className={INPUT} />
        </label>
        {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
      </form>
    </ModalDocumento>
  );
}
