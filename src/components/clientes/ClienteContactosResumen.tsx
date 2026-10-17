"use client";

import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Contacto = { id: string; nombre: string; telefono: string | null; cargo: string | null };

/**
 * Los contactos secundarios del cliente a la vista, en una línea, dentro de la
 * ficha de Gestión del cliente. Son las otras personas del cliente —contador,
 * administración, dueño— con su función y su teléfono; se cargan con el botón
 * "Contactos". Hasta ahora había que abrir el modal para saber si existían.
 */
export default function ClienteContactosResumen({
  clienteId,
  refrescar = 0,
  onAdministrar,
}: {
  clienteId: string;
  refrescar?: number;
  onAdministrar?: () => void;
}) {
  const [lista, setLista] = useState<Contacto[] | null>(null);

  useEffect(() => {
    let vigente = true;
    setLista(null);
    void (async () => {
      try {
        const res = await fetchWithSupabaseSession(`/api/clientes/${clienteId}/contactos`, { cache: "no-store" });
        const j = (await res.json().catch(() => null)) as { success?: boolean; data?: Contacto[] } | null;
        if (vigente) setLista(res.ok && j?.success ? j.data ?? [] : []);
      } catch {
        if (vigente) setLista([]);
      }
    })();
    return () => {
      vigente = false;
    };
  }, [clienteId, refrescar]);

  if (lista == null || lista.length === 0) return null;

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Otros contactos</p>
        {onAdministrar ? (
          <button
            type="button"
            onClick={onAdministrar}
            className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4FAEB2] transition-colors hover:text-[#3F8E91]"
          >
            Administrar
          </button>
        ) : null}
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {lista.map((c) => (
          <li
            key={c.id}
            className="rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-1 text-[11.5px] text-slate-700"
          >
            <span className="font-semibold text-slate-800">{c.nombre}</span>
            {c.cargo ? <span className="text-slate-400"> · {c.cargo}</span> : null}
            {c.telefono ? <span className="ml-1.5 font-mono text-slate-600">{c.telefono}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
