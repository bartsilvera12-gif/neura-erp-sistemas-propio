"use client";

/**
 * Comprobantes de compra (foto o PDF de la factura del proveedor).
 *   - ComprobantesCompra: bloque del detalle de una compra (lista, Adjuntar, Ver, Quitar).
 *   - AdjuntosPendientes: en "Nueva compra", elegir archivos ANTES de guardar; se suben
 *     apenas se crea la compra (subirComprobantes).
 * El archivo lo sube el servidor al bucket privado; para verlo se pide una URL firmada
 * de corta duración.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, FileText, Image as ImageIcon, Loader2, Paperclip, Trash2, X } from "lucide-react";
import { apiFetch, apiForm } from "@/erp2/lib/api/client-fetch";
import { TZ_PY } from "@/erp2/lib/fecha/paraguay";
import type { ComprobanteCompra } from "@/erp2/modules/compras/tipos";

export const ACCEPT_COMPROBANTE = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf,.pdf";
const MAX_BYTES = 20 * 1024 * 1024;
const EXT_OK = ["jpg", "jpeg", "png", "webp", "heic", "heif", "pdf"];

/** Validación previa en el navegador (el servidor igual vuelve a validar todo). */
export function validarComprobante(f: File): string | null {
  const ext = f.name.toLowerCase().split(".").pop() ?? "";
  const tipoOk = /^image\/(jpeg|png|webp|heic|heif)$/.test(f.type) || f.type === "application/pdf" || EXT_OK.includes(ext);
  if (!tipoOk) return `«${f.name}» no es una foto ni un PDF.`;
  if (f.size > MAX_BYTES) return `«${f.name}» supera los 20 MB.`;
  if (f.size === 0) return `«${f.name}» está vacío.`;
  return null;
}

export const tamano = (b: number | null | undefined) => {
  const n = Number(b) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toLocaleString("es-PY", { maximumFractionDigits: 1 })} MB`;
};
const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const esPdf = (mime: string | null | undefined, nombre: string) => mime === "application/pdf" || /\.pdf$/i.test(nombre);

export function subirComprobante(compraId: string, f: File) {
  const fd = new FormData();
  fd.append("file", f);
  return apiForm<ComprobanteCompra>(`/api/compras/${compraId}/comprobantes`, fd);
}

/** Sube varios, uno por uno. Devuelve los nombres de los que fallaron (con el motivo). */
export async function subirComprobantes(compraId: string, files: File[]): Promise<string[]> {
  const fallidos: string[] = [];
  for (const f of files) {
    try {
      await subirComprobante(compraId, f);
    } catch (e) {
      fallidos.push(`${f.name}: ${(e as Error).message}`);
    }
  }
  return fallidos;
}

/** Abre el comprobante en otra pestaña con una URL firmada recién pedida. */
async function verComprobante(compraId: string, id: string) {
  // La pestaña se abre YA (en el clic) para que el navegador no la bloquee; después se le pone la URL.
  const w = window.open("", "_blank");
  if (w) w.opener = null;
  try {
    const r = await apiFetch<{ url: string }>(`/api/compras/${compraId}/comprobantes/${id}`);
    if (w) w.location.href = r.url;
    else window.location.href = r.url;
  } catch (e) {
    w?.close();
    throw e;
  }
}

function IconoArchivo({ pdf }: { pdf: boolean }) {
  return pdf ? <FileText className="h-4 w-4 shrink-0 text-rose-500" /> : <ImageIcon className="h-4 w-4 shrink-0 text-sky-500" />;
}

/** Bloque "Comprobantes" del detalle de una compra. */
export function ComprobantesCompra({ compraId, esAdmin }: { compraId: string; esAdmin: boolean }) {
  const [lista, setLista] = useState<ComprobanteCompra[] | null>(null);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [quitando, setQuitando] = useState<ComprobanteCompra | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const cargar = useCallback(() => {
    apiFetch<{ comprobantes: ComprobanteCompra[] }>(`/api/compras/${compraId}/comprobantes`)
      .then((r) => setLista(r.comprobantes))
      .catch(() => { setLista([]); setError("No se pudieron cargar los comprobantes."); });
  }, [compraId]);
  useEffect(() => { cargar(); }, [cargar]);

  async function adjuntar(files: File[]) {
    setError(null);
    const problemas: string[] = [];
    for (const f of files) {
      const err = validarComprobante(f);
      if (err) { problemas.push(err); continue; }
      setSubiendo(f.name);
      try {
        await subirComprobante(compraId, f);
      } catch (e) {
        problemas.push(`${f.name}: ${(e as Error).message}`);
      }
    }
    setSubiendo(null);
    if (problemas.length) setError(problemas.join(" · "));
    cargar();
  }

  async function quitar() {
    if (!quitando) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/compras/${compraId}/comprobantes/${quitando.id}`, { method: "DELETE" });
      setQuitando(null);
      cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Comprobantes</p>
        {esAdmin ? (
          <>
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={!!subiendo}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 max-sm:min-h-11 max-sm:px-3 max-sm:text-[13px]"
            >
              {subiendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
              {subiendo ? "Subiendo…" : "Adjuntar comprobante"}
            </button>
            <input
              ref={input}
              type="file"
              multiple
              accept={ACCEPT_COMPROBANTE}
              className="sr-only"
              onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; if (fs.length) void adjuntar(fs); }}
            />
          </>
        ) : null}
      </div>

      {lista === null ? (
        <p className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…</p>
      ) : lista.length === 0 && !subiendo ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-3 py-3 text-center text-xs text-slate-500">
          Sin comprobantes. {esAdmin ? "Adjuntá la foto o el PDF de la factura." : ""}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
          {lista.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2.5 max-sm:gap-1.5 max-sm:py-1.5">
              <IconoArchivo pdf={esPdf(c.mime, c.nombre)} />
              <div className="min-w-0 flex-1 max-sm:ml-1.5">
                <p className="truncate text-sm font-medium text-slate-800" title={c.nombre}>{c.nombre}</p>
                <p className="text-[11px] text-slate-500">{tamano(c.size)} · {fechaHora(c.created_at)}</p>
              </div>
              <button
                type="button"
                onClick={() => void verComprobante(compraId, c.id).catch((e) => setError((e as Error).message))}
                className="inline-flex shrink-0 items-center justify-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 max-sm:min-h-11 max-sm:min-w-11"
              >
                <Eye className="h-3.5 w-3.5" /> Ver
              </button>
              {esAdmin ? (
                <button type="button" onClick={() => setQuitando(c)} aria-label={`Quitar ${c.nombre}`} className="inline-flex shrink-0 items-center justify-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 max-sm:min-h-11 max-sm:min-w-11">
                  <Trash2 className="h-3.5 w-3.5" /> <span className="max-[380px]:sr-only">Quitar</span>
                </button>
              ) : null}
            </li>
          ))}
          {subiendo ? (
            <li className="flex items-center gap-3 px-3 py-2.5 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> <span className="truncate">Subiendo {subiendo}…</span>
            </li>
          ) : null}
        </ul>
      )}

      {quitando ? (
        <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50/60 p-3">
          <p className="text-sm text-slate-800">¿Quitar <strong className="font-semibold">{quitando.nombre}</strong>? El archivo se borra y no se puede recuperar.</p>
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setQuitando(null)} disabled={busy} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 max-sm:min-h-11 max-sm:flex-1 max-sm:text-sm">Cancelar</button>
            <button type="button" onClick={quitar} disabled={busy} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50 max-sm:min-h-11 max-sm:flex-[2] max-sm:text-sm">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Quitar comprobante
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mt-2 flex items-start justify-between gap-2 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">
          <span className="min-w-0 [overflow-wrap:anywhere]">{error}</span><button type="button" onClick={() => setError(null)} aria-label="Cerrar" className="inline-flex shrink-0 items-center justify-center max-sm:-m-2 max-sm:h-9 max-sm:w-9"><X className="h-3.5 w-3.5" /></button>
        </div>
      ) : null}
    </div>
  );
}

/** "Nueva compra": archivos elegidos que se suben cuando la compra queda registrada. */
export function AdjuntosPendientes({ files, onChange, disabled }: { files: File[]; onChange: (f: File[]) => void; disabled?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  function agregar(nuevos: File[]) {
    const problemas: string[] = [];
    const ok: File[] = [];
    for (const f of nuevos) {
      const err = validarComprobante(f);
      if (err) problemas.push(err);
      else if (!files.some((x) => x.name === f.name && x.size === f.size)) ok.push(f);
    }
    setError(problemas.length ? problemas.join(" · ") : null);
    if (ok.length) onChange([...files, ...ok].slice(0, 10));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-600">Comprobante <span className="font-normal text-slate-400">(opcional)</span></span>
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={disabled || files.length >= 10}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 max-sm:min-h-11 max-sm:px-3 max-sm:text-[13px]"
        >
          <Paperclip className="h-3.5 w-3.5" /> Adjuntar comprobante
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT_COMPROBANTE}
          className="sr-only"
          onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; if (fs.length) agregar(fs); }}
        />
      </div>
      {files.length ? (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs max-sm:py-0 max-sm:pr-0">
              <IconoArchivo pdf={esPdf(f.type, f.name)} />
              <span className="min-w-0 flex-1 truncate text-slate-700" title={f.name}>{f.name}</span>
              <span className="shrink-0 text-slate-400">{tamano(f.size)}</span>
              <button type="button" disabled={disabled} onClick={() => onChange(files.filter((_, j) => j !== i))} className="shrink-0 font-medium text-rose-600 hover:underline disabled:opacity-50 max-sm:min-h-11 max-sm:px-3">
                Quitar
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[11px] text-slate-400">Foto o PDF de la factura (máx. 20 MB). Se sube al registrar la compra.</p>
      )}
      {error ? <p className="mt-1.5 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">{error}</p> : null}
    </div>
  );
}
