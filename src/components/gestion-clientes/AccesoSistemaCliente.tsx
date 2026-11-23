"use client";

import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { AccesoSistemaCompacto } from "@/components/proyectos/AccesoSistemaControl";

/**
 * Acceso al sistema del cliente, a mano en Gestión de clientes.
 *
 * Reusa el control del equipo (`AccesoSistemaCompacto`, que maneja estado, dominios,
 * "requiere código la primera vez" y el botón Bloquear/Desbloquear) para cada proyecto
 * activo del cliente. El bloqueo real vive en `neura.proyectos.acceso_suspendido` y lo
 * obedecen los ERP consultando `/api/public/acceso-sistema`.
 *
 * Se renderiza SIN tarjeta propia: devuelve los controles sueltos para que vivan en la
 * misma fila que los demás botones de acción (va adentro del flex de botones).
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

  // Sin tarjeta: cada control sale como un ítem más de la fila de botones de acción.
  return (
    <>
      {proys.map((p) => (
        <div key={p.id} className="inline-flex items-center gap-1.5 self-center">
          {proys.length > 1 ? (
            <span className="max-w-[140px] truncate text-[11px] font-medium text-slate-500" title={p.titulo ?? ""}>
              {p.titulo || "Proyecto"}:
            </span>
          ) : null}
          <AccesoSistemaCompacto proyectoId={p.id} />
        </div>
      ))}
    </>
  );
}
