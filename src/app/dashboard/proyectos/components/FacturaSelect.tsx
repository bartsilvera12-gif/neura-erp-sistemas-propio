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
 * proyecto). Lista las facturas del cliente elegido —pendientes y pagadas
 * (contado)—; el saldo que muestra es lo que después aparece como Deuda del
 * proyecto en el tablero (0 = "Al día").
 *
 * Si el proyecto ya tiene una factura que dejó de estar pendiente (se pagó),
 * igual se conserva la selección para no perder el vínculo.
 */
export function FacturaSelect({
  clienteId,
  value,
  onChange,
  currentLabel,
  onCount,
}: {
  clienteId: string;
  value: string;
  onChange: (facturaId: string) => void;
  currentLabel?: string | null;
  /** Reporta cuántas facturas tiene el cliente (para gatear si la factura es obligatoria). */
  onCount?: (n: number) => void;
}) {
  const [facturas, setFacturas] = useState<FacturaPendiente[]>([]);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!clienteId) {
      setFacturas([]);
      onCount?.(0);
      return;
    }
    let cancelado = false;
    setCargando(true);
    fetchWithSupabaseSession(`/api/proyectos/facturas-pendientes?cliente_id=${encodeURIComponent(clienteId)}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelado) return;
        const arr = Array.isArray(j?.data) ? (j.data as FacturaPendiente[]) : [];
        setFacturas(arr);
        onCount?.(arr.length);
      })
      .catch(() => {
        if (!cancelado) {
          setFacturas([]);
          onCount?.(0);
        }
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });
    return () => {
      cancelado = true;
    };
    // onCount es estable (setState del padre); no se incluye para no re-fetchar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteId]);

  const fmt = (n: number) => `Gs ${Math.round(n).toLocaleString("es-PY")}`;

  const opciones = [
    { value: "", label: "Sin factura asociada" },
    ...facturas.map((f) => ({
      value: f.id,
      label: `${f.numero_factura || "s/n"} · ${f.saldo > 0 ? `debe ${fmt(f.saldo)}` : "pagada"}`,
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
