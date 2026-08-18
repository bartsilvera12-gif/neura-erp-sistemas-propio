import "server-only";
import type { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { ESTADO_CON_ESQUELETO, TIPO_CON_ESQUELETO, evaluarEsqueleto, textoEsqueleto } from "@/lib/proyectos/esqueleto";

/**
 * Avisos de esqueleto para la campanita, calculados en el momento de leerla.
 *
 * NO se guardan como filas en `usuario_notificaciones`, y es a propósito:
 *
 *  - Son una CONDICIÓN, no un hecho. "Al proyecto X le quedan 3 horas" deja de
 *    ser cierto solo, cuando el técnico entrega el esqueleto y mueve el estado.
 *    Una fila persistida quedaría mintiendo hasta que alguien la marque leída.
 *  - No hacen falta ni un cron que barra vencimientos ni una tabla que se
 *    ensucie con avisos viejos.
 *
 * La contrapartida es que no se pueden marcar como leídos: se apagan cuando el
 * proyecto sale de "En desarrollo", se pausa, o deja de ser un Proyecto Web.
 */

type NotifSupabase = Awaited<ReturnType<typeof getChatServiceClientForEmpresa>>;

export type AvisoEsqueleto = {
  id: string;
  tipo: "esqueleto_por_vencer" | "esqueleto_vencido";
  titulo: string;
  cuerpo: string;
  proyecto_id: string;
  /** Marca que no tiene fila en la base: el panel no debe intentar marcarlo leído. */
  derivada: true;
  leida_at: null;
  created_at: string;
};

/**
 * Proyectos Web en desarrollo a cargo de `usuarioId` que están por incumplir —o
 * ya incumplieron— el compromiso de 48 h del esqueleto.
 *
 * Nunca lanza: la campanita tiene que seguir funcionando aunque esto falle.
 */
export async function avisosEsqueletoDe(
  sb: NotifSupabase,
  empresaId: string,
  usuarioId: string
): Promise<AvisoEsqueleto[]> {
  try {
    // Los ids de la columna y del tipo se resuelven por código: son
    // configurables por empresa y no se pueden dar por fijos.
    const [{ data: estados }, { data: tipos }] = await Promise.all([
      sb
        .from("proyecto_estados")
        .select("id, codigo")
        .eq("empresa_id", empresaId)
        .eq("codigo", ESTADO_CON_ESQUELETO)
        .eq("activo", true),
      sb
        .from("proyecto_tipos")
        .select("id, codigo")
        .eq("empresa_id", empresaId)
        .eq("codigo", TIPO_CON_ESQUELETO),
    ]);

    const estadoIds = ((estados ?? []) as { id: string }[]).map((e) => e.id);
    const tipoIds = ((tipos ?? []) as { id: string }[]).map((t) => t.id);
    if (estadoIds.length === 0 || tipoIds.length === 0) return [];

    const { data, error } = await sb
      .from("proyectos")
      .select("id, titulo, tecnico_asignado_at, fecha_ingreso, pausado_at, brief_data")
      .eq("empresa_id", empresaId)
      .eq("archivado", false)
      .eq("responsable_tecnico_id", usuarioId)
      .in("estado_id", estadoIds)
      .in("tipo_id", tipoIds);

    if (error || !data) return [];

    const ahoraIso = new Date().toISOString();
    const avisos: AvisoEsqueleto[] = [];

    for (const row of data as {
      id: string;
      titulo: string | null;
      tecnico_asignado_at: string | null;
      fecha_ingreso: string | null;
      pausado_at: string | null;
      brief_data: unknown;
    }[]) {
      const ev = evaluarEsqueleto({
        tipoCodigo: TIPO_CON_ESQUELETO,
        estadoCodigo: ESTADO_CON_ESQUELETO,
        desde: row.tecnico_asignado_at ?? row.fecha_ingreso,
        pausado: typeof row.pausado_at === "string" && !!row.pausado_at,
        briefData: row.brief_data,
        ahoraIso,
      });
      if (!ev.aplica || ev.estado === "ok") continue;

      avisos.push({
        id: `esqueleto:${row.id}`,
        tipo: ev.estado === "vencido" ? "esqueleto_vencido" : "esqueleto_por_vencer",
        titulo: `Esqueleto · ${(row.titulo ?? "").trim() || "un proyecto"}`,
        cuerpo: textoEsqueleto(ev) ?? "Revisá el compromiso de entrega del esqueleto.",
        proyecto_id: row.id,
        derivada: true,
        leida_at: null,
        created_at: ahoraIso,
      });
    }

    // Lo vencido primero: es lo que ya está incumplido.
    return avisos.sort((a, b) =>
      a.tipo === b.tipo ? 0 : a.tipo === "esqueleto_vencido" ? -1 : 1
    );
  } catch (e) {
    console.error("[esqueleto-avisos] no se pudieron calcular los avisos", e);
    return [];
  }
}
