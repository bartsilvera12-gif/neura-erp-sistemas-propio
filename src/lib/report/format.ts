/**
 * Helpers de formato compartidos por los tableros de reportería (Gerencia, Producción, …).
 *
 * Extraídos de `GerenciaClient.tsx` para reuso. Nota: el desktop usaba el sufijo `"K"`
 * y el mobile (`GerenciaMobile.formatGsCompact`) usaba `"k"` minúscula — se unifica en `"K"`.
 * Moneda: Guaraníes (Gs).
 */

/** Monto completo con separador de miles: `Gs 1.234.567`. */
export const gs = (n: number): string => "Gs " + Math.round(n || 0).toLocaleString("es-PY");

/** Monto compacto: `Gs 1.2MM` / `Gs 3M` / `Gs 450K`. */
export const gsShort = (n: number): string => {
  const v = Math.abs(n || 0);
  if (v >= 1e9) return "Gs " + (n / 1e9).toFixed(1) + "MM";
  if (v >= 1e6) return "Gs " + (n / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return "Gs " + (n / 1e3).toFixed(0) + "K";
  return "Gs " + Math.round(n || 0);
};

/** Variación con signo: `+12.3%` / `-4.0%` / `—` (null = no calculable). */
export const pct = (p: number | null): string => (p == null ? "—" : (p > 0 ? "+" : "") + p.toFixed(1) + "%");

/** Clase Tailwind de color para una variación (verde sube, rojo baja). */
export const pctColor = (p: number | null): string =>
  p == null ? "text-slate-400" : p > 0 ? "text-emerald-600" : p < 0 ? "text-rose-600" : "text-slate-500";
