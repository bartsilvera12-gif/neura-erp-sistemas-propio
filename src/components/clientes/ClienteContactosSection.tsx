"use client";

import { useCallback, useEffect, useState } from "react";
import { Mail, Phone, UserRound, Users } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { ModalContactosCliente } from "@/components/gestion-clientes/ModalContactosCliente";

type Contacto = {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  cargo: string | null;
  notas: string | null;
};

/**
 * Contactos secundarios dentro del detalle del cliente: otras personas del
 * cliente (contador, administración, dueño…) con su función y su teléfono.
 * Es la misma lista que se administra desde Gestión de clientes.
 */
export default function ClienteContactosSection({
  clienteId,
  clienteNombre,
}: {
  clienteId: string;
  clienteNombre: string;
}) {
  const [lista, setLista] = useState<Contacto[] | null>(null);
  const [abierto, setAbierto] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetchWithSupabaseSession(`/api/clientes/${clienteId}/contactos`, { cache: "no-store" });
      const j = (await res.json().catch(() => null)) as { success?: boolean; data?: Contacto[] } | null;
      setLista(res.ok && j?.success ? j.data ?? [] : []);
    } catch {
      setLista([]);
    }
  }, [clienteId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Otros contactos</h3>
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-700 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:text-[#4FAEB2]"
        >
          <Users className="h-3.5 w-3.5" aria-hidden /> Administrar
        </button>
      </div>

      {lista == null ? (
        <p className="text-[12.5px] text-slate-400">Cargando contactos…</p>
      ) : lista.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-[12.5px] text-slate-500">
          Sin contactos secundarios. Acá se cargan las otras personas del cliente —contador, administración, dueño— con
          su nombre, su función y su teléfono.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {lista.map((c) => (
            <li key={c.id} className="flex items-start gap-3 px-3.5 py-2.5">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500">
                <UserRound className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold text-slate-800">
                  {c.nombre}
                  {c.cargo ? <span className="ml-1.5 font-medium text-slate-400">· {c.cargo}</span> : null}
                </p>
                <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12.5px] text-slate-600">
                  {c.telefono ? (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3 w-3 text-slate-400" aria-hidden />
                      {c.telefono}
                    </span>
                  ) : null}
                  {c.email ? (
                    <span className="inline-flex items-center gap-1">
                      <Mail className="h-3 w-3 text-slate-400" aria-hidden />
                      {c.email}
                    </span>
                  ) : null}
                </p>
                {c.notas ? <p className="mt-0.5 text-[12px] text-slate-400">{c.notas}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {abierto ? (
        <ModalContactosCliente
          clienteId={clienteId}
          clienteNombre={clienteNombre}
          onClose={() => {
            setAbierto(false);
            void cargar();
          }}
        />
      ) : null}
    </section>
  );
}
