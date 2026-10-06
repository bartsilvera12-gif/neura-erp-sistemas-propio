"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { tieneAccesoMovilEspecial } from "@/lib/auth/acceso-movil-especial";
import { supabase } from "@/lib/supabase";
import { useNotificaciones } from "@/shared/hooks/useNotificaciones";

/** Campana superior exclusiva del acceso móvil especial. */
export default function AsesorAvisosBell() {
  const [habilitado, setHabilitado] = useState(false);
  const { noLeidas } = useNotificaciones({ enabled: habilitado });

  useEffect(() => {
    let activo = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (activo) setHabilitado(tieneAccesoMovilEspecial(data.session?.user.email));
    });
    return () => {
      activo = false;
    };
  }, []);

  if (!habilitado) return null;

  return (
    <Link
      href="/m/asesor/avisos"
      aria-label={noLeidas > 0 ? `Avisos, ${noLeidas} sin leer` : "Avisos"}
      className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/15 text-white active:bg-white/25"
    >
      <Bell className="h-4 w-4" aria-hidden />
      {noLeidas > 0 ? (
        <span className="absolute -right-1 -top-1 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-[#0EA5E9] px-1 text-[9px] font-bold leading-none text-white shadow-sm">
          {noLeidas > 99 ? "99+" : noLeidas}
        </span>
      ) : null}
    </Link>
  );
}
