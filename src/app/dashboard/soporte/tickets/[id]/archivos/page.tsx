"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, ExternalLink, FileText, Files, MoreVertical, Play, Trash2 } from "lucide-react";
import { tamanoLegible } from "@/lib/soporte/dominio";
import { useTicket } from "../../../_ui/TicketContexto";
import { apiSoporte, fechaHora, subirArchivos, type Persona } from "../../../_ui/api";
import ZonaArchivos from "../../../_ui/ZonaArchivos";
import { Aviso, Boton, Cargando, Tarjeta, Vacio } from "../../../_ui/ui";

type Archivo = {
  id: string;
  nombre: string;
  descripcion: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
  subido_por: Persona | null;
  url: string | null;
  url_descarga: string | null;
};

function Vista({ a }: { a: Archivo }) {
  const tipo = a.mime_type ?? "";
  if (tipo.startsWith("image/") && a.url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={a.url} alt={a.nombre} className="h-14 w-20 rounded-xl border border-slate-200 object-cover shadow-sm" loading="lazy" />;
  }
  if (tipo.startsWith("video/")) {
    return (
      <span className="grid h-14 w-20 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-[0_6px_14px_-6px_rgba(139,92,246,0.7)]">
        <Play className="h-5 w-5" aria-hidden />
      </span>
    );
  }
  const pdf = tipo === "application/pdf";
  return (
    <span className={`grid h-14 w-20 place-items-center rounded-xl ${pdf ? "bg-rose-100 text-rose-600" : "bg-sky-100 text-sky-600"}`}>
      <FileText className="h-5 w-5" aria-hidden />
    </span>
  );
}

function MenuArchivo({ a, onEliminar }: { a: Archivo; onEliminar: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const c = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setAbierto(false);
    document.addEventListener("mousedown", c);
    return () => document.removeEventListener("mousedown", c);
  }, [abierto]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setAbierto((x) => !x)} aria-label={`Acciones de ${a.nombre}`} className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50">
        <MoreVertical className="h-4 w-4" />
      </button>
      {abierto ? (
        <div className="absolute right-0 top-9 z-20 w-40 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-[13px] shadow-lg">
          {a.url ? (
            <a href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-3 py-2 text-slate-700 no-underline hover:bg-slate-50">
              <ExternalLink className="h-4 w-4" aria-hidden /> Abrir
            </a>
          ) : null}
          <button type="button" onClick={() => { setAbierto(false); onEliminar(); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-rose-600 hover:bg-rose-50">
            <Trash2 className="h-4 w-4" aria-hidden /> Eliminar
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Archivos y evidencias del ticket. Quitar uno no borra su rastro del historial. */
export default function TicketArchivosPage() {
  const { ticket, recargar } = useTicket();
  const [lista, setLista] = useState<Archivo[] | null>(null);
  const [nuevos, setNuevos] = useState<File[]>([]);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setLista(await apiSoporte<Archivo[]>(`/api/soporte/tickets/${ticket.id}/archivos`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los archivos");
    }
  }, [ticket.id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const subir = async () => {
    if (!nuevos.length) return;
    setError(null);
    setSubiendo(`Subiendo 0 de ${nuevos.length}…`);
    const r = await subirArchivos(ticket.id, nuevos, {
      alAvanzar: (h, t) => setSubiendo(`Subiendo ${h} de ${t}…`),
    });
    setSubiendo(null);
    setNuevos([]);
    if (r.errores.length) setError(r.errores.join(" · "));
    await Promise.all([cargar(), recargar()]);
  };

  const eliminar = async (a: Archivo) => {
    if (!window.confirm(`¿Eliminar "${a.nombre}"? El historial conserva que existió.`)) return;
    try {
      await apiSoporte(`/api/soporte/tickets/${ticket.id}/archivos/${a.id}`, { method: "DELETE" });
      await Promise.all([cargar(), recargar()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo eliminar");
    }
  };

  return (
    <Tarjeta>
      {lista == null ? (
        error ? <Aviso>{error}</Aviso> : <Cargando />
      ) : lista.length === 0 ? (
        <Vacio icono={Files} tono="celeste" titulo="Todavía no hay archivos" detalle="Capturas, videos o documentos del problema." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {lista.map((a) => (
            <li key={a.id} className="-mx-2 flex items-center gap-4 rounded-xl px-2 py-3 transition-colors hover:bg-[#4FAEB2]/[0.04]">
              {a.url ? (
                <a href={a.url} target="_blank" rel="noreferrer" className="shrink-0" aria-label={`Ver ${a.nombre}`}>
                  <Vista a={a} />
                </a>
              ) : (
                <Vista a={a} />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium text-slate-900">{a.nombre}</p>
                {a.descripcion ? <p className="truncate text-[12.5px] text-slate-500">{a.descripcion}</p> : null}
                <p className="mt-0.5 text-[12px] text-slate-400">
                  {a.subido_por?.nombre ?? "Usuario"} · {fechaHora(a.created_at)}
                </p>
              </div>
              <span className="hidden shrink-0 tabular-nums text-[12px] text-slate-500 sm:block">{tamanoLegible(a.size_bytes)}</span>
              {a.url_descarga ? (
                <a href={a.url_descarga} className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-slate-200 text-slate-600 no-underline hover:bg-slate-50" aria-label={`Descargar ${a.nombre}`}>
                  <Download className="h-4 w-4" />
                </a>
              ) : null}
              <MenuArchivo a={a} onEliminar={() => void eliminar(a)} />
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 space-y-3 border-t border-slate-100 pt-5">
        <p className="flex items-center gap-2 text-[13px] font-bold text-slate-800"><Files className="h-4 w-4 text-[#4FAEB2]" aria-hidden /> Agregar más archivos</p>
        <ZonaArchivos archivos={nuevos} onCambio={setNuevos} deshabilitada={!!subiendo} />
        {error && lista != null ? <Aviso>{error}</Aviso> : null}
        {nuevos.length ? (
          <div className="flex items-center justify-end gap-3">
            {subiendo ? <span className="text-[12.5px] text-slate-500">{subiendo}</span> : null}
            <Boton onClick={() => void subir()} cargando={!!subiendo}>
              Subir {nuevos.length} archivo(s)
            </Boton>
          </div>
        ) : null}
      </div>
    </Tarjeta>
  );
}
