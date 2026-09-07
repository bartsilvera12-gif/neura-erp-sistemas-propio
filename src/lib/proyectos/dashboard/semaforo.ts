/**
 * Semáforos de los dashboards de Proyectos.
 *
 * Módulo ISOMÓRFICO a propósito (sin `server-only`): la API clasifica y el
 * cliente pinta, y las dos puntas tienen que decir lo mismo. Cuando cada lado
 * tenía su propia tabla de umbrales, una tarjeta podía verse amarilla mientras
 * el KPI la contaba como crítica.
 */

export type NivelSlv = "al_dia" | "en_riesgo" | "critico" | "vencido";

export type NivelWip = "en_rango" | "al_limite" | "sobre_limite";

/** Umbrales de consumo del objetivo de SLV técnico, en porcentaje. */
export const SLV_UMBRALES = { riesgo: 70, critico: 90, vencido: 100 } as const;

export const SLV_META: Record<NivelSlv, { label: string; color: string; pill: string }> = {
  al_dia: { label: "Al día", color: "#22c55e", pill: "bg-emerald-50 text-emerald-700" },
  en_riesgo: { label: "En riesgo", color: "#eab308", pill: "bg-amber-50 text-amber-700" },
  critico: { label: "Crítico", color: "#f97316", pill: "bg-orange-50 text-orange-700" },
  vencido: { label: "Vencido", color: "#ef4444", pill: "bg-rose-50 text-rose-700" },
};

/**
 * Consumo del objetivo, en porcentaje. `null` cuando no hay objetivo: sin
 * objetivo no hay incumplimiento posible, y devolver 0 mentiría diciendo que
 * está al día.
 */
export function consumoPct(consumidoMs: number, objetivoHoras: number | null): number | null {
  if (objetivoHoras == null || !Number.isFinite(objetivoHoras) || objetivoHoras <= 0) return null;
  return Math.round((consumidoMs / (objetivoHoras * 3600_000)) * 1000) / 10;
}

/** 0–70 verde · >70–90 amarillo · >90–100 naranja · >100 rojo. */
export function nivelSlv(pct: number | null): NivelSlv | null {
  if (pct == null) return null;
  if (pct > SLV_UMBRALES.vencido) return "vencido";
  if (pct > SLV_UMBRALES.critico) return "critico";
  if (pct > SLV_UMBRALES.riesgo) return "en_riesgo";
  return "al_dia";
}

export function nivelWip(wip: number, limite: number): NivelWip {
  if (wip > limite) return "sobre_limite";
  if (wip === limite) return "al_limite";
  return "en_rango";
}

export const WIP_META: Record<NivelWip, { label: string; color: string }> = {
  en_rango: { label: "En rango", color: "#22c55e" },
  al_limite: { label: "Al límite", color: "#f59e0b" },
  sobre_limite: { label: "Sobre el límite", color: "#ef4444" },
};
