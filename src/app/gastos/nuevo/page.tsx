"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Compat: el alta ahora se hace desde el listado (modal). Redirige a /gastos. */
export default function NuevoGastoPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/gastos");
  }, [router]);
  return null;
}
