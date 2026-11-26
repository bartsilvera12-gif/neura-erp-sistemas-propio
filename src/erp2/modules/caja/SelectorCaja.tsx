"use client";

/**
 * "¿En qué caja?" — para todo lo que mueve EFECTIVO fuera del POS (cobros, compras, gastos,
 * pagos a proveedores). Trae las cajas abiertas que el usuario puede usar (GET /api/caja):
 *   · ninguna → avisa que hay que abrir una (el efectivo la necesita)
 *   · una → la muestra (sin elegir nada)
 *   · varias → un selector; arranca en la que le toca (la que abrió él / la de su sucursal)
 * El valor elegido se manda como `caja_id` (la base lo valida con caja_abierta_para).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { Select } from "@/erp2/components/Select";
import type { CajaAbierta } from "@/erp2/modules/caja/turno";

type Respuesta = { caja: CajaAbierta | null; abiertas: CajaAbierta[]; predeterminada: string | null };

export function SelectorCaja({ value, onChange, etiqueta = "Sale / entra de la caja" }: {
  value: string | null;
  onChange: (id: string | null) => void;
  etiqueta?: string;
}) {
  const [datos, setDatos] = useState<Respuesta | null>(null);

  useEffect(() => {
    let vivo = true;
    apiFetch<Respuesta>("/api/caja")
      .then((r) => {
        if (!vivo) return;
        setDatos(r);
        // Arranca en la que le toca; si ya había una elegida que sigue abierta, la respeta.
        if (!value || !r.abiertas.some((c) => c.id === value)) onChange(r.predeterminada ?? r.caja?.id ?? null);
      })
      .catch(() => { if (vivo) setDatos({ caja: null, abiertas: [], predeterminada: null }); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!datos) return <p className="text-xs text-slate-400">Buscando la caja abierta…</p>;
  if (datos.abiertas.length === 0) {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        No hay una caja abierta: el efectivo necesita una. <Link href="/caja/turnos" className="font-semibold underline underline-offset-2">Abrir caja</Link>
      </p>
    );
  }
  const etiq = (c: CajaAbierta) => `${c.punto_nombre} · ${c.sucursal_nombre}${c.mia ? " (la tuya)" : ""}`;
  if (datos.abiertas.length === 1) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <Wallet className="h-3.5 w-3.5 text-slate-400" /> {etiqueta}: <span className="font-semibold text-slate-700">{etiq(datos.abiertas[0])}</span>
      </p>
    );
  }
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-slate-600">{etiqueta}</span>
      <Select value={value ?? ""} onChange={(v) => onChange(v || null)} block
        options={[...(value ? [] : [["", "Elegí la caja…"] as [string, string]]), ...datos.abiertas.map((c): [string, string] => [c.id, etiq(c)])]} />
    </div>
  );
}
