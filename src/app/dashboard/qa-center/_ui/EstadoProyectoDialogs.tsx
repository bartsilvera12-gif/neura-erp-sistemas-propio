"use client";

import { useState } from "react";

/** Badge de estado de entrega + fecha de vencimiento (si aplica). */
export function EstadoBadge({
  estado, vence,
}: { estado: "en_desarrollo" | "en_qa" | "entregado"; vence: string | null }) {
  const map = {
    en_desarrollo: { cls: "bg-slate-100 text-slate-700", label: "En desarrollo (sin autorización)" },
    en_qa:         { cls: "bg-emerald-100 text-emerald-700", label: "En QA" },
    entregado:     { cls: "bg-red-100 text-red-800", label: "Entregado — BLOQUEADO" },
  } as const;
  const e = map[estado];
  const venceMs = vence ? new Date(vence).getTime() : null;
  const vencido = venceMs !== null && venceMs < Date.now();
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${e.cls}`}>{e.label}</span>
      {estado === "en_qa" && vence && (
        <span className={`text-[10px] ${vencido ? "text-rose-600" : "text-slate-500"}`}>
          {vencido ? "autorización vencida" : `vence ${new Date(vence).toLocaleString("es-PY")}`}
        </span>
      )}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────

type DialogCommonProps = { projectId: string; onClose: () => void; onDone: () => void };

/** Dialog: autorizar proyecto (3 casillas). */
export function AutorizarDialog({ projectId, onClose, onDone }: DialogCommonProps) {
  const [noEntregado, setNoEntregado] = useState(false);
  const [datosFicticios, setDatosFicticios] = useState(false);
  const [integracionesAisladas, setIntegracionesAisladas] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const puedeEnviar = noEntregado && datosFicticios && integracionesAisladas && !busy;

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/qa/projects/${projectId}/autorizar`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ declaraciones: {
          no_entregado: noEntregado,
          datos_ficticios: datosFicticios,
          integraciones_aisladas: integracionesAisladas,
        }}),
      });
      const body = (await res.json()) as { data?: unknown; error?: string };
      if (!res.ok || !body.data) { setErr(body.error ?? `HTTP ${res.status}`); return; }
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : "Error de red"); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" data-testid="dlg-autorizar">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
        <h3 className="mb-2 text-lg font-semibold">Autorizar QA Desarrollo por 72 horas</h3>
        <p className="mb-3 text-xs text-slate-500">
          Para habilitar pruebas sobre este proyecto, confirmá las 3 declaraciones.
          El sistema también valida el entorno técnicamente (env-assert) antes de ejecutar.
        </p>
        <div className="space-y-2 text-sm">
          <Casilla checked={noEntregado} onChange={setNoEntregado} id="d1"
            label="Este ERP todavía NO fue entregado al cliente." />
          <Casilla checked={datosFicticios} onChange={setDatosFicticios} id="d2"
            label="La base NO contiene datos reales del cliente final." />
          <Casilla checked={integracionesAisladas} onChange={setIntegracionesAisladas} id="d3"
            label="Las integraciones externas (WhatsApp, Firebase, SIFEN, email, pagos) están deshabilitadas o en sandbox." />
        </div>
        {err && <p className="mt-3 text-xs text-rose-600" data-testid="autorizar-err">{err}</p>}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded border border-slate-300 px-3 py-1 text-xs">Cancelar</button>
          <button onClick={submit} disabled={!puedeEnviar}
            data-testid="btn-autorizar-submit"
            className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
            {busy ? "Autorizando…" : "Autorizar por 72h"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Dialog: marcar proyecto como entregado (bloqueo total). */
export function EntregarDialog({ projectId, projectName, onClose, onDone }: DialogCommonProps & { projectName: string }) {
  const [confirmado, setConfirmado] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/qa/projects/${projectId}/entregar`, { method: "POST" });
      const body = (await res.json()) as { data?: unknown; error?: string };
      if (!res.ok || !body.data) { setErr(body.error ?? `HTTP ${res.status}`); return; }
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : "Error de red"); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" data-testid="dlg-entregar">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
        <h3 className="mb-2 text-lg font-semibold text-red-800">Marcar como entregado al cliente</h3>
        <div className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-900">
          Esta acción <strong>bloquea TODAS las pruebas</strong> de QA Desarrollo sobre
          <strong> {projectName}</strong> (lectura y escritura). Es el paso final del flujo:
          implica que el cliente ya recibió el ERP y los datos ficticios fueron limpiados.
        </div>
        <Casilla checked={confirmado} onChange={setConfirmado} id="confirmar"
          label="Confirmo que este ERP ya fue entregado al cliente y que QA Desarrollo debe quedar bloqueado." />
        {err && <p className="mt-3 text-xs text-rose-600" data-testid="entregar-err">{err}</p>}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded border border-slate-300 px-3 py-1 text-xs">Cancelar</button>
          <button onClick={submit} disabled={!confirmado || busy}
            data-testid="btn-entregar-submit"
            className="rounded bg-red-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
            {busy ? "Marcando…" : "Marcar como entregado"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Casilla({
  checked, onChange, id, label,
}: { checked: boolean; onChange: (v: boolean) => void; id: string; label: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-2">
      <input id={id} data-testid={`chk-${id}`} type="checkbox" checked={checked}
        onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      <span className="text-xs text-slate-700">{label}</span>
    </label>
  );
}
