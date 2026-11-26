"use client";

import { useRef } from "react";

/** Formatea número con separador de miles (Paraguay: 1.200.000) */
export function formatMontoDisplay(value: number | string, decimals = true): string {
  const n = typeof value === "string" ? parseMontoInput(value) : value;
  if (isNaN(n) || (typeof value === "number" && isNaN(value))) return "";
  return n.toLocaleString("es-PY", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals ? 2 : 0,
  });
}

/** Parsea string con formato a número (acepta "1.200.000", "1.234,50", "1234.56") */
export function parseMontoInput(value: string): number {
  if (!value || !value.trim()) return 0;
  const v = value.replace(/\s/g, "");
  if (v.includes(",")) {
    const [intPart, decPart] = v.split(",");
    const n = parseFloat((intPart || "").replace(/\./g, "") + "." + (decPart || "0"));
    return isNaN(n) ? 0 : n;
  }
  const parts = v.split(".");
  if (parts.length === 1) return parseFloat(parts[0]) || 0;
  const last = parts[parts.length - 1] || "";
  if (last.length <= 2 && /^\d+$/.test(last)) {
    return parseFloat(parts.slice(0, -1).join("") + "." + last) || 0;
  }
  return parseFloat(parts.join("")) || 0;
}

type MontoInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: number | string;
  onChange: (value: number) => void;
  /** Si true, permite decimales. Default: true */
  decimals?: boolean;
  /** React 19: el ref llega como prop y se pasa al <input> (para enfocarlo desde afuera). */
  ref?: React.Ref<HTMLInputElement>;
};

/**
 * Input de monto con separador de miles. Portado de neura-erp-oymcomercial.
 * Muestra el valor formateado (ej: 1.200.000) y emite el número al cambiar.
 */
export default function MontoInput({
  value,
  onChange,
  decimals = true,
  className = "",
  onFocus,
  onMouseUp,
  ...rest
}: MontoInputProps) {
  const recienEnfocado = useRef(false);
  const numValue = typeof value === "string"
    ? (value === "" ? 0 : parseMontoInput(value))
    : Number(value) || 0;
  const display = (typeof value === "string" && value === "") ? "" : formatMontoDisplay(numValue, decimals);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = parseMontoInput(e.target.value);
    onChange(n);
  };

  return (
    <input
      type="text"
      // Teclado numérico en celular (con coma si admite decimales). En celular los campos
      // van a 16 px (globals.css) para que iOS no haga zoom al enfocarlos.
      inputMode={decimals ? "decimal" : "numeric"}
      autoComplete="off"
      enterKeyHint="done"
      value={display}
      onChange={handleChange}
      className={className}
      // Con "0" adentro, al tocar el campo se selecciona: lo que se tipea reemplaza el 0
      // (antes "3000" quedaba "30.000").
      onFocus={(e) => {
        const el = e.currentTarget;
        if (numValue === 0 && el.value !== "") { el.select(); recienEnfocado.current = true; setTimeout(() => { recienEnfocado.current = false; }, 400); }
        onFocus?.(e);
      }}
      // El mouseup del mismo clic que enfocó no debe mover el cursor (deshacía la selección).
      onMouseUp={(e) => {
        if (recienEnfocado.current) { e.preventDefault(); recienEnfocado.current = false; }
        onMouseUp?.(e);
      }}
      {...rest}
    />
  );
}
