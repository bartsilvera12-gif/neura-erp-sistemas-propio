import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { horaPY, diaMesPY } from "@/lib/format/hora-py";

/**
 * Avisos de vencimiento de observaciones de QA, calculados al leer la campanita.
 *
 * Mismo criterio que los recordatorios de reunión y los de esqueleto: "faltan 2
 * horas" es una CONDICIÓN, no un hecho. Deja de ser cierta sola cuando pasa la
 * hora o cuando alguien resuelve la observación, así que persistirla dejaría
 * filas mintiendo. Tampoco hace falta un cron barriendo vencimientos.
 */

/** Ventanas de aviso, en minutos antes del vencimiento. De la más lejana a la más cercana. */
const VENTANAS_MIN = [120, 60] as const;

/**
 * La campanita no se lee en el minuto exacto: sin tolerancia, el aviso de "2
 * horas" existiría sólo durante ese minuto y casi nadie lo vería.
 */
const TOLERANCIA_MIN = 5;

/** Estados en los que ya no hay nada que hacer: no se avisa. */
const CERRADOS = new Set(["resuelto", "verificado", "descartado"]);

export type AvisoVencimientoQA = {
  id: string;
  tipo: "qa_vence";
  titulo: string;
  cuerpo: string;
  proyecto_id: string;
  observacion_id: string;
  agrupadas: number;
  leida_at: null;
  created_at: string;
  derivada: true;
  minutos_restantes: number;
};

type ObsRow = {
  id: string;
  proyecto_id: string;
  numero: number;
  titulo: string;
  estado: string;
  fecha_limite: string | null;
  asignado_a: string | null;
};

/**
 * Observaciones del usuario que están por vencer.
 *
 * Destinatario: a quien está ASIGNADA la observación. Si no tiene a nadie
 * asignado, cae al responsable técnico del proyecto — la observación es trabajo
 * suyo aunque nadie la haya repartido todavía.
 */
export async function avisosVencimientoQADe(
  sb: AppSupabaseClient,
  empresaId: string,
  usuarioId: string
): Promise<AvisoVencimientoQA[]> {
  const ahora = Date.now();
  const desde = new Date(ahora).toISOString();
  const hasta = new Date(ahora + (VENTANAS_MIN[0] + TOLERANCIA_MIN) * 60_000).toISOString();

  const { data, error } = await sb
    .from("proyecto_qa_observaciones")
    .select("id, proyecto_id, numero, titulo, estado, fecha_limite, asignado_a")
    .eq("empresa_id", empresaId)
    .not("fecha_limite", "is", null)
    .gte("fecha_limite", desde)
    .lte("fecha_limite", hasta);

  // La campanita no puede caerse porque QA falle: sin avisos es degradado
  // aceptable, un 500 en el header no.
  if (error) return [];

  const abiertas = ((data ?? []) as ObsRow[]).filter((o) => !CERRADOS.has(o.estado));
  if (abiertas.length === 0) return [];

  // Para las que no tienen asignado, el destinatario es el técnico del proyecto.
  const sinAsignar = abiertas.filter((o) => !o.asignado_a).map((o) => o.proyecto_id);
  const tecnicoDeProyecto = new Map<string, string | null>();
  if (sinAsignar.length > 0) {
    const { data: proys } = await sb
      .from("proyectos")
      .select("id, responsable_tecnico_id")
      .eq("empresa_id", empresaId)
      .in("id", [...new Set(sinAsignar)]);
    for (const p of (proys ?? []) as { id: string; responsable_tecnico_id: string | null }[]) {
      tecnicoDeProyecto.set(p.id, p.responsable_tecnico_id);
    }
  }

  const mias = abiertas.filter((o) =>
    o.asignado_a ? o.asignado_a === usuarioId : tecnicoDeProyecto.get(o.proyecto_id) === usuarioId
  );

  const avisos: AvisoVencimientoQA[] = [];
  for (const o of mias) {
    if (!o.fecha_limite) continue;
    const faltanMin = (Date.parse(o.fecha_limite) - ahora) / 60_000;
    if (!Number.isFinite(faltanMin) || faltanMin < 0) continue;

    // La ventana más cercana ya alcanzada: a 45 minutos corresponde el aviso de
    // 1 hora, no el de 2, y nunca los dos a la vez.
    const ventana = VENTANAS_MIN.find(
      (v) => faltanMin <= v + TOLERANCIA_MIN && faltanMin > (v === 60 ? -1 : 60 + TOLERANCIA_MIN)
    );
    if (ventana == null) continue;

    const restantes = Math.max(1, Math.round(faltanMin));
    avisos.push({
      // Id estable por observación+ventana: el cliente lo usa como key y para no
      // volver a sonar por el mismo aviso en cada refresco.
      id: `qa_vence:${o.id}:${ventana}`,
      tipo: "qa_vence",
      titulo:
        restantes >= 60
          ? `Vence en ${Math.round(restantes / 60)} h: ${o.titulo}`
          : `Vence en ${restantes} min: ${o.titulo}`,
      cuerpo: `QA-${String(o.numero).padStart(3, "0")} · vence ${diaMesPY(o.fecha_limite)} a las ${horaPY(o.fecha_limite)}`,
      proyecto_id: o.proyecto_id,
      observacion_id: o.id,
      agrupadas: 1,
      leida_at: null,
      created_at: new Date().toISOString(),
      derivada: true,
      minutos_restantes: restantes,
    });
  }

  return avisos.sort((a, b) => a.minutos_restantes - b.minutos_restantes);
}
