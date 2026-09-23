"use client";

import { useEffect, useState } from "react";
import { FancySelect } from "@/app/dashboard/proyectos/components/FancySelect";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type FacturaPendiente = {
  id: string;
  numero_factura: string;
  fecha: string | null;
  monto: number;
  saldo: number;
  estado: string;
  tipo: string;
};

/**
 * Selector de la factura de la venta que se asocia a un proyecto (una por
 * proyecto). Lista las facturas PENDIENTES del cliente elegido; el saldo que
 * muestra es lo que después aparece como Deuda del proyecto en el tablero.
 *
 * Si el proyecto ya tiene una factura que dejó de estar pendiente (se pagó),
 * igual se conserva la selección para no perder el vínculo.
 */
export function FacturaSelect({
  clienteId,
  value,
  onChange,
  currentLabel,
}: {
  clienteId: string;
  value: string;
  onChange: (facturaId: string) => void;
  currentLabel?: string | null;
}) {
  const [facturas, setFacturas] = useState<FacturaPendiente[]>([]);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!clienteId) {
      setFacturas([]);
      return;
    }
    let cancelado = false;
    setCargando(true);
    fetchWithSupabaseSession(`/api/proyectos/facturas-pendientes?cliente_id=${encodeURIComponent(clienteId)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelado) setFacturas(Array.isArray(j?.data) ? (j.data as FacturaPendiente[]) : []);
      })
      .catch(() => {
        if (!cancelado) setFacturas([]);
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [clienteId]);

  const fmt = (n: number) => `Gs ${Math.round(n).toLocaleString("es-PY")}`;

  const opciones = [
    { value: "", label: "Sin factura asociada" },
    ...facturas.map((f) => ({
      value: f.id,
      label: `${f.numero_factura || "s/n"} · debe ${fmt(f.saldo)}`,
    })),
  ];
  // La factura ya asociada puede no estar entre las pendientes (se pagó): se
  // agrega para no perder la selección al abrir la ficha.
  if (value && !opciones.some((o) => o.value === value)) {
    opciones.push({ value, label: currentLabel || "Factura asociada" });
  }

  return (
    <FancySelect
      ariaLabel="Factura asociada"
      value={value}
      onChange={onChange}
      options={opciones}
      disabled={!clienteId}
      placeholder={
        !clienteId ? "Elegí un cliente primero" : cargando ? "Cargando facturas…" : "Sin factura asociada"
      }
    />
  );
}
