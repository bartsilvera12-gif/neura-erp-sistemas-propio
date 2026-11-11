"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { apiSoporte } from "./api";

type Gasto = { hoy: number; mes: number; total: number; vueltas: number };

/** US$ 1,2 → "1,20"; en guaraníes no: el gasto del modelo se factura en dólares. */
const usd = (n: number) => n.toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Lo que lleva gastado Neurita, al lado de "Cargar ticket".
 *
 * El dato lo informa el propio agente cada vez que termina una vuelta
 * (POST /api/soporte/gastos). Si todavía no informó nada, la tarjeta no se
 * muestra: una tarjeta en cero no dice nada y ocupa lugar.
 */
export default function GastoNeurita() {
  const [g, setG] = useState<Gasto | null>(null);

  useEffect(() => {
    let vivo = true;
    const traer = () =>
      apiSoporte<Gasto>("/api/soporte/gastos")
        .then((d) => vivo && setG(d))
        .catch(() => {});
    traer();
    // Mientras la pantalla está abierta el agente sigue trabajando: se refresca solo.
    const t = setInterval(traer, 60_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, []);

  if (!g || g.total <= 0) return null;

  return (
    <div
      className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
      title={`${g.vueltas} ${g.vueltas === 1 ? "vuelta" : "vueltas"} del agente · este mes US$ ${usd(g.mes)}`}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-500">
        <Sparkles className="h-4 w-4" aria-hidden />
      </span>
      <div className="flex items-center gap-3.5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Neurita hoy</p>
          <p className="text-[13px] font-semibold text-slate-700">US$ {usd(g.hoy)}</p>
        </div>
        <span className="h-7 w-px bg-slate-200" aria-hidden />
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Total</p>
          <p className="text-[13px] font-semibold text-slate-700">US$ {usd(g.total)}</p>
        </div>
      </div>
    </div>
  );
}
