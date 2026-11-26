"use client";

/**
 * Asistente "Importar … desde Excel" en 3 pasos (portado de Ferretería República):
 *   1. subir archivo (+ descargar plantilla)   2. vista previa con acciones por fila
 *   3. resultado. Al confirmar se vuelve a subir el MISMO archivo (el servidor re-valida).
 */
import { useState } from "react";
import { ALTO_MAX_MODAL, CapaModal } from "@/erp2/components/CapaModal";
import { Download, Loader2, Upload, X } from "lucide-react";
import { apiForm } from "@/erp2/lib/api/client-fetch";
import { descargarArchivo } from "@/erp2/lib/api/client-blob";
import { clienteConfig } from "@/erp2/cliente.config";

const TEAL = clienteConfig.color;

type Accion = "INSERT" | "UPDATE" | "SKIP" | "ERROR";
type FilaPreview = { row_number: number; action: Accion; warnings: string[]; errors: string[]; data: Record<string, string> };
type Preview = {
  summary: {
    total: number; insertar: number; actualizar: number; omitir: number; errores: number; warnings: number;
    faltantes?: { categorias: string[] };
    /** avisos generales del archivo (ej. "se van a crear 3 rubros nuevos") */
    notas?: string[];
    movimientos_a_generar?: number; unidades_entrada?: number; unidades_salida?: number;
  };
  rows: FilaPreview[];
};
type Commit = {
  summary: {
    total: number; inserted: number; updated: number; skipped: number; errors: number; warnings: number;
    movimientos_generados?: number; unidades_entrada?: number; unidades_salida?: number; categorias_creadas?: number;
    ajuste_numero?: string | null; deposito?: string | null;
  };
  errors: string[];
};

export function ExcelImportWizard({
  entidad,
  previewUrl,
  commitUrl,
  templateUrl,
  permiteCrearFaltantes = false,
  etiquetas,
  textoConfirmar,
  camposExtra,
  opcionesExtra,
  onClose,
  onCompleted,
}: {
  entidad: string;
  previewUrl: string;
  commitUrl: string;
  templateUrl: string;
  permiteCrearFaltantes?: boolean;
  /** cómo se llama cada acción en la tabla y los contadores (por defecto INSERT/UPDATE/…) */
  etiquetas?: Partial<Record<Accion, string>>;
  /** texto del botón de confirmar según la vista previa (por defecto "Confirmar e importar") */
  textoConfirmar?: (s: Preview["summary"]) => string;
  /** campos que se mandan con la vista previa y la confirmación (ej. deposito_id) */
  camposExtra?: Record<string, string>;
  /** controles propios de la entidad en el paso 1 (ej. a qué depósito entra el stock) */
  opcionesExtra?: React.ReactNode;
  onClose: () => void;
  onCompleted?: () => void;
}) {
  const [paso, setPaso] = useState<"upload" | "preview" | "done">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [commit, setCommit] = useState<Commit | null>(null);
  const [crearFaltantes, setCrearFaltantes] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);

  async function analizar() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      for (const [k, v] of Object.entries(camposExtra ?? {})) fd.append(k, v);
      setPreview(await apiForm<Preview>(previewUrl, fd));
      setPaso("preview");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmar() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      for (const [k, v] of Object.entries(camposExtra ?? {})) fd.append(k, v);
      if (permiteCrearFaltantes) fd.append("crear_faltantes", crearFaltantes ? "1" : "0");
      setCommit(await apiForm<Commit>(commitUrl, fd));
      setPaso("done");
      onCompleted?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <CapaModal onClose={busy ? undefined : onClose} z="z-[120]" fondo="bg-slate-900/50 backdrop-blur-[2px]">
        <div className={`flex ${ALTO_MAX_MODAL} w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl`} onClick={(e) => e.stopPropagation()}>
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 py-3 pl-4 pr-2 sm:p-5">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-800 [overflow-wrap:anywhere] sm:text-lg">Importar {entidad} desde Excel</h2>
              <p className="text-xs text-slate-400">Paso {paso === "upload" ? "1 de 3" : paso === "preview" ? "2 de 3" : "3 de 3"}</p>
            </div>
            <button onClick={onClose} disabled={busy} aria-label="Cerrar" className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5">
            {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

            {paso === "upload" ? (
              <div className="space-y-4">
                {opcionesExtra}
                <div className="text-sm text-slate-600">
                  Subí un archivo Excel (.xlsx) o CSV. Máx. 5 MB / 5.000 filas.
                  <button
                    type="button"
                    onClick={() => void descargarArchivo(templateUrl, "plantilla.xlsx").catch((e) => setError((e as Error).message))}
                    className="inline-flex items-center gap-1 font-medium underline underline-offset-2 max-sm:mt-1 max-sm:flex max-sm:min-h-11 sm:ml-2"
                    style={{ color: TEAL }}
                  >
                    <Download className="h-3.5 w-3.5" /> Descargar plantilla
                  </button>
                </div>
                <label
                  onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
                  onDragLeave={() => setArrastrando(false)}
                  onDrop={(e) => { e.preventDefault(); setArrastrando(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}
                  className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-sm text-slate-500 transition hover:border-[var(--brand)] hover:bg-[var(--brand-50)] ${arrastrando ? "border-[var(--brand)] bg-[var(--brand-50)]" : "border-slate-200 bg-slate-50/50"}`}
                >
                  <Upload className="h-6 w-6 text-slate-400" />
                  {file ? <span className="max-w-full text-center font-medium text-slate-800 [overflow-wrap:anywhere]">{file.name}</span> : <span>Elegí el archivo o arrastralo acá</span>}
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="sr-only"
                  />
                </label>
              </div>
            ) : null}

            {paso === "preview" && preview ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
                  <Stat label="Total filas" value={preview.summary.total} color="slate" />
                  <Stat label={etiquetas?.INSERT ?? "Insertar"} value={preview.summary.insertar} color="green" />
                  <Stat label={etiquetas?.UPDATE ?? "Actualizar"} value={preview.summary.actualizar} color="sky" />
                  <Stat label={etiquetas?.SKIP ?? "Omitir"} value={preview.summary.omitir} color="amber" />
                  <Stat label="Errores" value={preview.summary.errores} color="red" />
                </div>
                {preview.summary.notas?.length ? (
                  <div className="space-y-0.5 rounded border border-sky-200 bg-sky-50 p-2 text-xs text-sky-800">
                    {preview.summary.notas.map((n, i) => <p key={i}>{n}</p>)}
                  </div>
                ) : null}
                {preview.summary.warnings > 0 ? (
                  <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">{preview.summary.warnings} advertencia(s) — revisá la tabla.</div>
                ) : null}
                {typeof preview.summary.movimientos_a_generar === "number" ? (
                  <div className="rounded border border-indigo-200 bg-indigo-50 p-2 text-xs text-indigo-800">
                    <strong>Impacto en inventario:</strong> {preview.summary.movimientos_a_generar} movimiento(s) · +{preview.summary.unidades_entrada ?? 0} entrada(s) · −{preview.summary.unidades_salida ?? 0} salida(s)
                  </div>
                ) : null}
                {preview.summary.faltantes?.categorias.length ? (
                  <div className="space-y-1 rounded border border-amber-200 bg-amber-50 p-2 text-xs">
                    <p className="font-semibold text-amber-800">Referencias faltantes:</p>
                    <p>
                      Categorías: {preview.summary.faltantes.categorias.slice(0, 8).join(", ")}
                      {preview.summary.faltantes.categorias.length > 8 ? "…" : ""}
                    </p>
                  </div>
                ) : null}
                {permiteCrearFaltantes ? (
                  <label className="flex min-h-11 cursor-pointer select-none items-center gap-3 text-sm text-slate-700 sm:min-h-0 sm:gap-2">
                    <input type="checkbox" checked={crearFaltantes} onChange={(e) => setCrearFaltantes(e.target.checked)} className="h-5 w-5 shrink-0 rounded border-slate-300 sm:h-4 sm:w-4" />
                    Crear las categorías faltantes durante la importación
                  </label>
                ) : null}
                <TablaPreview rows={preview.rows} etiquetas={etiquetas} />
              </div>
            ) : null}

            {paso === "done" && commit ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-6">
                  <Stat label="Total" value={commit.summary.total} color="slate" />
                  <Stat label="Insertados" value={commit.summary.inserted} color="green" />
                  <Stat label="Actualizados" value={commit.summary.updated} color="sky" />
                  <Stat label="Omitidos" value={commit.summary.skipped} color="amber" />
                  <Stat label="Errores" value={commit.summary.errors} color="red" />
                  <Stat label="Warnings" value={commit.summary.warnings} color="amber" />
                </div>
                {typeof commit.summary.movimientos_generados === "number" ? (
                  <div className="rounded border border-indigo-200 bg-indigo-50 p-2 text-xs text-indigo-800">
                    <strong>Movimientos generados:</strong> {commit.summary.movimientos_generados} · +{commit.summary.unidades_entrada ?? 0} entrada(s) · −{commit.summary.unidades_salida ?? 0} salida(s)
                    {commit.summary.categorias_creadas ? ` · ${commit.summary.categorias_creadas} categoría(s) creada(s)` : ""}
                    {commit.summary.ajuste_numero ? ` · ajuste ${commit.summary.ajuste_numero}${commit.summary.deposito ? ` en ${commit.summary.deposito}` : ""}` : ""}
                  </div>
                ) : commit.summary.categorias_creadas ? (
                  <div className="rounded border border-sky-200 bg-sky-50 p-2 text-xs text-sky-800">{commit.summary.categorias_creadas} rubro(s) nuevo(s) creado(s)</div>
                ) : null}
                {commit.errors.length ? (
                  <ul className="max-h-40 overflow-y-auto rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                    {commit.errors.map((e, i) => <li key={i}>• {e}</li>)}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
          {/* Acciones del paso: fijas abajo, siempre visibles aunque la tabla sea larga. */}
          <div className="shrink-0 border-t border-slate-100 px-4 py-3 sm:px-5 sm:py-4">
            {paso === "upload" ? (
              <div className="flex justify-end gap-2 max-sm:[&>button]:flex-1">
                <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancelar</button>
                <button onClick={analizar} disabled={!file || busy} className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50" style={{ backgroundColor: TEAL }}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {busy ? "Analizando..." : "Analizar (preview)"}
                </button>
              </div>
            ) : paso === "preview" && preview ? (
              <div className="flex justify-between gap-2">
                <button onClick={() => setPaso("upload")} disabled={busy} className="shrink-0 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">← Volver</button>
                <button
                  onClick={confirmar}
                  disabled={busy || preview.summary.errores === preview.summary.total || preview.summary.insertar + preview.summary.actualizar === 0}
                  className="inline-flex min-w-0 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-center text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50 max-sm:flex-1"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {busy ? "Importando..." : textoConfirmar ? textoConfirmar(preview.summary) : "Confirmar e importar"}
                </button>
              </div>
            ) : paso === "done" && commit ? (
              <div className="flex justify-end gap-2">
                <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-semibold text-white max-sm:flex-1" style={{ backgroundColor: TEAL }}>Cerrar</button>
              </div>
            ) : null}
          </div>
        </div>
    </CapaModal>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: "slate" | "green" | "sky" | "amber" | "red" }) {
  const colores: Record<string, string> = {
    slate: "bg-slate-50 border-slate-200 text-slate-700",
    green: "bg-emerald-50 border-emerald-200 text-emerald-700",
    sky: "bg-sky-50 border-sky-200 text-sky-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    red: "bg-red-50 border-red-200 text-red-700",
  };
  return (
    <div className={`min-w-0 rounded-lg border px-3 py-2 ${colores[color]}`}>
      <p className="text-[11px] uppercase tracking-wide opacity-75">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value.toLocaleString("es-PY")}</p>
    </div>
  );
}

function TablaPreview({ rows, etiquetas }: { rows: FilaPreview[]; etiquetas?: Partial<Record<Accion, string>> }) {
  const visibles = rows.slice(0, 200);
  return (
        // Vista previa con scroll interno en los dos sentidos (cabecera fija): en celular la tabla
    // conserva su ancho y se desplaza adentro; la hoja nunca se corre de costado.
    <div className="max-h-[45dvh] overflow-auto overscroll-contain rounded-lg border border-slate-200 sm:max-h-[40vh]">
      <table className="w-full min-w-[640px] text-xs md:min-w-0">
        <thead className="sticky top-0 z-[1] bg-slate-50 text-slate-600">
          <tr>
            <th className="px-2 py-1.5 text-left">Fila</th>
            <th className="px-2 py-1.5 text-left">Acción</th>
            <th className="px-2 py-1.5 text-left">Detalle</th>
            <th className="px-2 py-1.5 text-left">Mensajes</th>
          </tr>
        </thead>
        <tbody>
          {visibles.map((r) => {
            const badge =
              r.action === "INSERT" ? "bg-emerald-100 text-emerald-700"
              : r.action === "UPDATE" ? "bg-sky-100 text-sky-700"
              : r.action === "SKIP" ? "bg-amber-100 text-amber-700"
              : "bg-red-100 text-red-700";
            const resumen = Object.entries(r.data).slice(0, 3).map(([k, v]) => `${k}=${String(v).slice(0, 40)}`).join(" · ");
            return (
              <tr key={r.row_number} className="border-t border-slate-100">
                <td className="px-2 py-1 text-slate-500">{r.row_number}</td>
                <td className="px-2 py-1"><span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${badge}`}>{etiquetas?.[r.action] ?? r.action}</span></td>
                <td className="max-w-md truncate px-2 py-1 text-slate-700">{resumen}</td>
                <td className="px-2 py-1 text-xs">
                  {r.errors.map((e, i) => <div key={`e${i}`} className="text-red-700">⚠ {e}</div>)}
                  {r.warnings.map((w, i) => <div key={`w${i}`} className="text-amber-700">• {w}</div>)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > visibles.length ? (
        <div className="border-t px-2 py-1 text-xs text-slate-400">Mostrando primeras {visibles.length} de {rows.length} filas.</div>
      ) : null}
    </div>
  );
}
