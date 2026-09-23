/** Formatea el correlativo como `REC-00001`. Provisional (sin número) → `REC-—`. */
export function formatReciboNro(nro: number | null): string {
  if (nro == null || !Number.isFinite(nro)) return "REC-—";
  return `REC-${String(nro).padStart(5, "0")}`;
}
