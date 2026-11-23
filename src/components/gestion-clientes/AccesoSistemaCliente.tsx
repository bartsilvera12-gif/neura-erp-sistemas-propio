"use client";

import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { AccesoSistemaCompacto } from "@/components/proyectos/AccesoSistemaControl";

/**
 * Acceso al sistema del cliente, a mano en Gestión de clientes (fila principal).
 *
 * Reusa el control del equipo (`AccesoSistemaCompacto`, que maneja estado, dominios,
 * "requiere código la primera vez" y el botón Bloquear/Desbloquear) para cada proyecto
 * activo del cliente. El bloqueo real vive en `neura.proyectos.acceso_suspendido` y lo
 * obedecen los ERP consultando `/api/public/acceso-sistema`.
 */
type Proy = { id: string; titulo?: string | null };

export default function AccesoSistemaCliente({ clienteId }: { clienteId: string }) {
  const [proys, setProys] = useState<Proy[] | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const res = await fetchWithSupabaseSession(
          `/api/proyectos?cliente_id=${encodeURIComponent(clienteId)}&archivado=0`,
          { cache: "no-store" }
        );
        const j = (await res.json().catch(() => null)) as { success?: boolean; data?: Proy[] } | null;
        if (vivo) setProys(res.ok && j?.success && Array.isArray(j.data) ? j.data : []);
      } catch {
        if (vivo) setProys([]);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [clienteId]);

  if (!proys || proys.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col gap-1.5 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Acceso al sistema</span>
      {proys.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center gap-2">
          {proys.length > 1 ? (
            <span className="max-w-[180px] truncate text-[11px] font-medium text-slate-500" title={p.titulo ?? ""}>
              {p.titulo || "Proyecto"}:
            </span>
          ) : null}
          <AccesoSistemaCompacto proyectoId={p.id} />
        </div>
      ))}
    </div>
  );
}
