"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import FichaFuncionarioClient from "../_ui/FichaFuncionarioClient";

function Contenido() {
  const params = useParams();
  const id = String(params?.id ?? "");
  if (!id) return <div className="py-24 text-center text-sm text-slate-400">Cargando…</div>;
  return <FichaFuncionarioClient id={id} />;
}

/** Ficha del funcionario. */
export default function Page() {
  return (
    <Suspense fallback={<div className="py-24 text-center text-sm text-slate-400">Cargando…</div>}>
      <Contenido />
    </Suspense>
  );
}
