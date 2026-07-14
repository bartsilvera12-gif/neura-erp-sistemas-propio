"use client";

import { useState } from "react";
import type { PreviewResponse, CommitResponse, PreviewRow } from "@/lib/excel/import-types";

const PREVIEW_URL = "/api/configuracion/plan-cuentas/import/preview";
const COMMIT_URL = "/api/configuracion/plan-cuentas/import/commit";
const TEMPLATE_URL = "/api/configuracion/plan-cuentas/import/template";

export function PlanCuentasImportModal({ onClose, onCompleted }: { onClose: () => void; onCompleted: () => void }) {
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [actualizar, setActualizar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [commit, setCommit] = useState<CommitResponse | null>(null);

  async function post(url: string): Promise<Response> {
    const { apiFetch } = await import("@/lib/api/fetch-with-supabase-session");
    const fd = new FormData();
    fd.append("file", file as File);
    fd.append("actualizar_existentes", actualizar ? "1" : "0");
    return apiFetch(url, { method: "POST", body: fd });
  }

  async function handleUpload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const r = await post(PREVIEW_URL);
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setError(j?.error ?? `Error ${r.status}`);
        return;
      }
      setPreview(j.data as PreviewResponse);
      setStep("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const r = await post(COMMIT_URL);
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setError(j?.error ?? `Error ${r.status}`);
        return;
      }
      setCommit(j.data as CommitResponse);
      setStep("done");
      onCompleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center bg-slate-900/60 px-0 pt-0 backdrop-blur-sm sm:px-4 sm:pt-16"
      onClick={onClose}
    >
      <div
        className="flex h-[100dvh] max-h-[100dvh] w-full max-w-5xl flex-col rounded-none border-0 bg-white shadow-2xl sm:h-auto sm:max-h-[85dvh] sm:rounded-2xl sm:border sm:border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b p-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Importar plan de cuentas</h2>
            <p className="text-xs text-slate-400">
              Paso {step === "upload" ? "1 de 3" : step === "preview" ? "2 de 3" : "3 de 3"}
            </p>
          </div>
          <button onClick={onClose} className="text-xl text-slate-400 hover:text-slate-700">
            ×
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

          {step === "upload" && (
            <div className="space-y-4">
              <div className="text-sm text-slate-600">
                Subí un archivo Excel (.xlsx, .xls) o CSV. Máx. 5 MB / 5.000 filas. Encabezados: Cuenta, Denominación,
                Nivel, Naturaleza, Asentable, Centro Costo, Moneda, Tipo cambio, Cuenta SSET.
                <a href={TEMPLATE_URL} className="ml-2 inline-flex items-center gap-1 text-[#3F8E91] underline hover:text-[#2c6f72]">
                  Descargar plantilla
                </a>
              </div>
              <input
                type="file"
                accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm"
              />
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={actualizar} onChange={(e) => setActualizar(e.target.checked)} />
                Actualizar cuentas existentes (si el código ya existe, sobrescribe sus datos). Si está desmarcado, las
                existentes se omiten.
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">
                  Cancelar
                </button>
                <button
                  onClick={handleUpload}
                  disabled={!file || busy}
                  className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
                >
                  {busy ? "Analizando…" : "Analizar (vista previa)"}
                </button>
              </div>
            </div>
          )}

          {step === "preview" && preview && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
                <Stat label="Total filas" value={preview.summary.total} color="slate" />
                <Stat label="Insertar" value={preview.summary.insertar} color="green" />
                <Stat label="Actualizar" value={preview.summary.actualizar} color="sky" />
                <Stat label="Omitir" value={preview.summary.omitir} color="amber" />
                <Stat label="Errores" value={preview.summary.errores} color="red" />
              </div>
              <PreviewTable rows={preview.rows} />
              <div className="flex justify-between gap-2 pt-2">
                <button onClick={() => setStep("upload")} className="rounded-lg border px-4 py-2 text-sm">
                  ← Volver
                </button>
                <button
                  onClick={handleCommit}
                  disabled={busy || preview.summary.insertar + preview.summary.actualizar === 0}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy ? "Importando…" : "Confirmar e importar"}
                </button>
              </div>
            </div>
          )}

          {step === "done" && commit && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-6">
                <Stat label="Total" value={commit.summary.total} color="slate" />
                <Stat label="Insertados" value={commit.summary.inserted} color="green" />
                <Stat label="Actualizados" value={commit.summary.updated} color="sky" />
                <Stat label="Omitidos" value={commit.summary.skipped} color="amber" />
                <Stat label="Errores" value={commit.summary.errors} color="red" />
                <Stat label="Warnings" value={commit.summary.warnings} color="amber" />
              </div>
              {commit.errors.length > 0 && (
                <ul className="max-h-40 overflow-y-auto rounded border border-red-200 bg-red-50 p-2 text-xs">
                  {commit.errors.map((e, i) => (
                    <li key={i}>• {e}</li>
                  ))}
                </ul>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={onClose} className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white">
                  Cerrar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: "slate" | "green" | "sky" | "amber" | "red" }) {
  const colors: Record<string, string> = {
    slate: "bg-slate-50 border-slate-200 text-slate-700",
    green: "bg-emerald-50 border-emerald-200 text-emerald-700",
    sky: "bg-sky-50 border-sky-200 text-sky-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    red: "bg-red-50 border-red-200 text-red-700",
  };
  return (
    <div className={`rounded-lg border px-3 py-2 ${colors[color]}`}>
      <p className="text-[11px] uppercase tracking-wide opacity-75">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function PreviewTable({ rows }: { rows: PreviewRow[] }) {
  const visibles = rows.slice(0, 300);
  return (
    <div className="max-h-[40vh] overflow-auto rounded-lg border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-slate-50 text-slate-600">
          <tr>
            <th className="px-2 py-1.5 text-left">Fila</th>
            <th className="px-2 py-1.5 text-left">Acción</th>
            <th className="px-2 py-1.5 text-left">Cuenta</th>
            <th className="px-2 py-1.5 text-left">Denominación</th>
            <th className="px-2 py-1.5 text-left">Mensajes</th>
          </tr>
        </thead>
        <tbody>
          {visibles.map((r, i) => {
            const badge =
              r.action === "INSERT"
                ? "bg-emerald-100 text-emerald-700"
                : r.action === "UPDATE"
                  ? "bg-sky-100 text-sky-700"
                  : r.action === "SKIP"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-red-100 text-red-700";
            return (
              <tr key={i} className="border-t">
                <td className="px-2 py-1 text-slate-500">{r.row_number}</td>
                <td className="px-2 py-1">
                  <span className={`rounded px-1.5 py-0.5 font-semibold ${badge}`}>{r.action}</span>
                </td>
                <td className="px-2 py-1 font-mono">{String(r.data.cuenta ?? "")}</td>
                <td className="px-2 py-1">{String(r.data.denominacion ?? "")}</td>
                <td className="px-2 py-1 text-red-600">{[...r.errors, ...r.warnings].join(" ")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > visibles.length && (
        <p className="px-2 py-1 text-[11px] text-slate-400">Mostrando {visibles.length} de {rows.length} filas.</p>
      )}
    </div>
  );
}
