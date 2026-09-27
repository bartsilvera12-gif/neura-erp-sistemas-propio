"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import { getMisModulos } from "@/lib/empresas/actions";

export default function SorteosModuleGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [estado, setEstado] = useState<"cargando" | "ok" | "no">("cargando");

  useEffect(() => {
    let cancel = false;
    async function run() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user?.email) {
          if (!cancel) router.replace("/");
          return;
        }
        // El rol se resuelve server-side (getCurrentUser → /api/usuarios/me): leer `usuarios`
        // desde el navegador pegaba contra `zentra_erp` (404) y mandaba a todos al inicio.
        let usuario: { rol?: string | null } | null = null;
        try {
          usuario = await getCurrentUser();
        } catch {
          if (!cancel) router.replace("/");
          return;
        }

        if (usuario?.rol === "super_admin") {
          if (!cancel) setEstado("ok");
          return;
        }

        const modulos = await getMisModulos();
        if (cancel) return;
        const tiene = modulos.some((m) => m.slug === "sorteos");
        setEstado(tiene ? "ok" : "no");
        if (!tiene) router.replace("/");
      } catch {
        if (!cancel) {
          setEstado("no");
          router.replace("/");
        }
      }
    }
    run();
    return () => {
      cancel = true;
    };
  }, [router]);

  if (estado !== "ok") {
    return (
      <div className="py-16 text-center text-slate-400 text-sm animate-pulse">
        {estado === "cargando" ? "Cargando módulo Sorteos…" : "Redirigiendo…"}
      </div>
    );
  }

  return <>{children}</>;
}
