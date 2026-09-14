"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, Lock, RefreshCw } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { credencialHref, type ProyectoCredencial } from "@/lib/proyectos/credenciales-shared";
import {
  CampoFila,
  CopiarTodoButton,
  CopyButton,
} from "@/app/dashboard/proyectos/components/ProyectoCredencialesTab";

type Estado =
  | { tipo: "cargando" }
  | { tipo: "error"; mensaje: string }
  | { tipo: "sin_permiso" }
  | { tipo: "listo"; items: ProyectoCredencial[] };

/**
 * Accesos del proyecto, SÓLO LECTURA, para Soporte y la tipificación.
 *
 * No hay otro almacenamiento: lee `proyecto_credenciales` por la misma API que
 * usa la pestaña Credenciales de Proyectos (`/api/proyectos/[id]/credenciales`),
 * con su mismo permiso. Nada de esto se copia al ticket ni a la tipificación:
 * se consulta en vivo cada vez que se muestra.
 */
export default function AccesosProyecto({ proyectoId, compacto = false }: { proyectoId: string | null | undefined; compacto?: boolean }) {
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });
  const [visibles, setVisibles] = useState<Set<string>>(() => new Set());
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async (id: string, vivo: () => boolean) => {
    setEstado({ tipo: "cargando" });
    try {
      const res = await fetchWithSupabaseSession(`/api/proyectos/${id}/credenciales`, { cache: "no-store" });
      const j = (await res.json().catch(() => null)) as { success?: boolean; data?: ProyectoCredencial[] } | null;
      if (!vivo()) return;
      if (res.status === 403) return setEstado({ tipo: "sin_permiso" });
      if (!res.ok || !j?.success || !Array.isArray(j.data)) {
        return setEstado({ tipo: "error", mensaje: "No fue posible cargar las credenciales." });
      }
      setEstado({ tipo: "listo", items: j.data });
    } catch {
      if (vivo()) setEstado({ tipo: "error", mensaje: "No fue posible cargar las credenciales." });
    }
  }, []);

  useEffect(() => {
    if (!proyectoId) return;
    let vivo = true;
    setVisibles(new Set());
    void cargar(proyectoId, () => vivo);
    return () => {
      vivo = false;
    };
  }, [proyectoId, cargar]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 2500);
    return () => clearTimeout(t);
  }, [aviso]);

  const onCopied = useCallback((ok: boolean) => setAviso(ok ? "Copiado al portapapeles" : "No se pudo copiar. Copialo a mano."), []);

  const cabecera = (
    <div className="mb-2 flex items-center justify-between gap-2">
      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-slate-500">
        <KeyRound className="h-3.5 w-3.5 text-[#4FAEB2]" aria-hidden /> Accesos del proyecto
      </p>
      <div className="flex items-center gap-2">
        {aviso ? <span className="text-[11.5px] font-medium text-emerald-600">{aviso}</span> : null}
        {proyectoId && estado.tipo !== "cargando" ? (
          <button
            type="button"
            onClick={() => void cargar(proyectoId, () => true)}
            title="Volver a cargar"
            aria-label="Volver a cargar los accesos"
            className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );

  const vacio = (texto: string, clase = "text-slate-500") => (
    <div className={`rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-3 text-[13px] ${clase}`}>{texto}</div>
  );

  let cuerpo: React.ReactNode;
  if (!proyectoId) cuerpo = vacio("No se seleccionó proyecto.", "text-slate-400");
  else if (estado.tipo === "cargando") cuerpo = vacio("Cargando accesos…", "text-slate-400");
  else if (estado.tipo === "sin_permiso")
    cuerpo = (
      <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
        <Lock className="h-4 w-4 shrink-0" aria-hidden /> Tu usuario no tiene acceso a las credenciales de Proyectos.
      </div>
    );
  else if (estado.tipo === "error") cuerpo = vacio(estado.mensaje, "text-rose-600");
  else if (estado.items.length === 0) cuerpo = vacio("No hay credenciales registradas para este proyecto.");
  else
    cuerpo = (
      <div className={`grid gap-3 ${compacto ? "" : "md:grid-cols-2"}`}>
        {estado.items.map((c) => {
          const pass = c.password ?? "";
          const ver = visibles.has(c.id);
          return (
            <div key={c.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold text-slate-800">{c.nombre}</p>
                <CopiarTodoButton credencial={c} onCopied={onCopied} />
              </div>
              <div className="mt-1">
                <CampoFila label="URL" value={c.url} href={credencialHref(c.url)} onCopied={onCopied} />
                <CampoFila label="Usuario" value={c.usuario} mono onCopied={onCopied} />
                <div className="flex items-center gap-3 border-b border-slate-100 py-2 last:border-b-0">
                  <span className="w-24 shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500">Contraseña</span>
                  <div className="min-w-0 flex-1">
                    {pass ? (
                      <span className="block truncate font-mono text-sm text-slate-900">{ver ? pass : "•".repeat(Math.min(pass.length, 12))}</span>
                    ) : (
                      <span className="text-sm text-slate-400">—</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setVisibles((prev) => {
                        const n = new Set(prev);
                        if (n.has(c.id)) n.delete(c.id);
                        else n.add(c.id);
                        return n;
                      })
                    }
                    disabled={!pass}
                    aria-label={ver ? "Ocultar contraseña" : "Mostrar contraseña"}
                    title={ver ? "Ocultar" : "Mostrar"}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
                  >
                    {ver ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <CopyButton value={pass} label="Contraseña" onCopied={onCopied} />
                </div>
              </div>
              {c.notas ? <p className="mt-2 whitespace-pre-line break-words text-xs leading-relaxed text-slate-500">{c.notas}</p> : null}
            </div>
          );
        })}
      </div>
    );

  return (
    <div>
      {cabecera}
      {cuerpo}
    </div>
  );
}
