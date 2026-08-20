import "server-only";
import type { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { msLaborables } from "@/lib/proyectos/reloj-laboral";

type Sb = Awaited<ReturnType<typeof getChatServiceClientForEmpresa>>;

/**
 * Pasadas por QA: una fila por vez que un proyecto entra y sale de la columna
 * QA, para poder medirle el tiempo de respuesta a cada QA.
 *
 * Por qué una tabla y no una columna en `proyectos`: un proyecto puede rebotar
 * varias veces (entra, QA pide cambios, el técnico corrige, vuelve a entrar).
 * Cada pasada es un tiempo de respuesta distinto y hay que poder promediarlos.
 *
 * Por qué no alcanzaba `proyecto_estado_historial`: ya guarda cuánto estuvo el
 * proyecto en la columna QA, pero no QUIÉN lo estaba revisando, que es
 * justamente lo que se quiere medir.
 *
 * Todo acá degrada en silencio si la tabla no existe todavía: medir es
 * secundario, y un cambio de estado nunca puede fallar porque la métrica falle.
 */

function noDisponible(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  if (e.code === "42P01" || e.code === "PGRST205") return true;
  const msg = (e.message ?? "").toLowerCase();
  if (!msg.includes("proyecto_qa_revisiones")) return false;
  return msg.includes("does not exist") || msg.includes("schema cache");
}

/**
 * Abre una pasada por QA. Idempotente: si ya hay una abierta para ese proyecto,
 * el índice único parcial rechaza la segunda y se ignora — mover el proyecto
 * dentro de QA (por ejemplo cambiando su etapa) no arranca un contador nuevo.
 */
export async function abrirRevisionQA(
  sb: Sb,
  args: { empresaId: string; proyectoId: string; qaResponsableId: string | null; ahoraIso: string }
): Promise<void> {
  const { error } = await sb.from("proyecto_qa_revisiones").insert({
    empresa_id: args.empresaId,
    proyecto_id: args.proyectoId,
    qa_responsable_id: args.qaResponsableId,
    entrada_at: args.ahoraIso,
  });
  if (error && !noDisponible(error)) {
    // 23505 = ya había una abierta. Es el caso esperado al re-entrar, no un error.
    const code = (error as { code?: string }).code;
    if (code !== "23505") {
      console.error("[qa-revisiones] abrir", error);
    }
  }
}

/**
 * Cierra la pasada abierta del proyecto, guardando el tiempo en HORARIO LABORAL
 * y con qué veredicto salió.
 *
 * El reloj laboral es el mismo del contador del tablero: un proyecto que entra a
 * QA un viernes 16:30 y se aprueba el lunes 8:30 cuenta 1 hora, no 64. Medir el
 * tiempo de respuesta de una persona con reloj de pared la penalizaría por los
 * fines de semana.
 */
export async function cerrarRevisionQA(
  sb: Sb,
  args: {
    empresaId: string;
    proyectoId: string;
    ahoraIso: string;
    /** Veredicto con el que salió, si se puede inferir del estado destino. */
    resultado: "aprobado" | "cambios" | null;
    estadoSalidaId: string | null;
  }
): Promise<void> {
  const { data, error } = await sb
    .from("proyecto_qa_revisiones")
    .select("id, entrada_at")
    .eq("empresa_id", args.empresaId)
    .eq("proyecto_id", args.proyectoId)
    .is("salida_at", null)
    .limit(1);

  if (error) {
    if (!noDisponible(error)) console.error("[qa-revisiones] buscar abierta", error);
    return;
  }

  const abierta = (data ?? [])[0] as { id: string; entrada_at: string } | undefined;
  if (!abierta) return; // nunca se registró la entrada (p. ej. proyecto anterior a esto)

  const ms = msLaborables(abierta.entrada_at, args.ahoraIso) ?? 0;

  const { error: eUp } = await sb
    .from("proyecto_qa_revisiones")
    .update({
      salida_at: args.ahoraIso,
      ms_laborables: Math.max(0, Math.round(ms)),
      resultado: args.resultado,
      estado_salida_id: args.estadoSalidaId,
      updated_at: args.ahoraIso,
    })
    .eq("empresa_id", args.empresaId)
    .eq("id", abierta.id);

  if (eUp && !noDisponible(eUp)) console.error("[qa-revisiones] cerrar", eUp);
}
