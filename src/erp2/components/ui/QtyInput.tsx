"use client";

/**
 * Input numérico con "buffer local" para cantidades editables.
 * Portado tal cual de neura-erp-oymcomercial.
 *
 * Mantiene una copia del texto como string mientras el input tiene foco, y
 * sincroniza con `value` sólo cuando cambia externamente y no está siendo
 * editado. Al perder foco (o Enter), si el texto es inválido, restaura al `min`.
 */

import { useEffect, useRef, useState } from "react";

export function QtyInput({
  value,
  onChange,
  min = 1,
  step = 1,
  decimals,
  className = "",
  autoSelectOnFocus = true,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  /** 1 → integer; usar "any" o 0.001 para decimales (kg). */
  step?: number | "any";
  /** Si se define, el display siempre muestra ese número de decimales fijos. */
  decimals?: number;
  className?: string;
  autoSelectOnFocus?: boolean;
}) {
  const format = (n: number): string =>
    decimals != null ? n.toFixed(decimals) : String(n);
  const [text, setText] = useState<string>(format(value));
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setText(format(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editing, decimals]);

  const usarTexto = decimals != null;

  return (
    <input
      ref={inputRef}
      type={usarTexto ? "text" : "number"}
      // Teclado numérico en celular: enteros → numérico puro (iOS: pattern), decimales → con coma.
      inputMode={usarTexto || step !== 1 ? "decimal" : "numeric"}
      pattern={!usarTexto && step === 1 ? "[0-9]*" : undefined}
      enterKeyHint="done"
      min={usarTexto ? undefined : min}
      step={usarTexto ? undefined : step}
      value={text}
      onFocus={(e) => {
        setEditing(true);
        if (autoSelectOnFocus) e.currentTarget.select();
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        if (raw === "") return;
        const normalized = usarTexto ? raw.replace(",", ".") : raw;
        const n = step === 1 ? parseInt(normalized, 10) : Number(normalized);
        if (Number.isFinite(n) && n >= min) onChange(n);
      }}
      onBlur={(e) => {
        setEditing(false);
        const raw = e.target.value;
        const normalized = usarTexto ? raw.replace(",", ".") : raw;
        const n = step === 1 ? parseInt(normalized, 10) : Number(normalized);
        if (!Number.isFinite(n) || n < min) {
          onChange(min);
          setText(format(min));
        } else {
          setText(format(n));
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") inputRef.current?.blur();
      }}
      className={className}
    />
  );
}
