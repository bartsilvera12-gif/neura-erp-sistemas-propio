/**
 * Carga del equipo (WIP): cuántos proyectos tiene realmente encima cada técnico.
 *
 * "Activo" no es "no archivado": un proyecto entregado, cancelado o parado en
 * una columna puramente comercial no le ocupa lugar al técnico. El criterio es
 * el mismo que ya usa el tablero "Tareas del equipo" (`estados-tablero.ts`),
 * para que las dos pantallas no discutan sobre cuántos proyectos tiene alguien.
 */

import { nivelWip, type NivelWip } from "./semaforo";

export type WipTecnico = {
  usuario_id: string;
  nombre: string;
  wip: number;
  nivel: NivelWip;
};

export function calcularWip(
  proyectos: { responsable_tecnico_id: string | null; estado_id: string | null }[],
  cuentaParaWip: (estadoId: string) => boolean,
  nombreDe: (id: string) => string,
  limite: number
): WipTecnico[] {
  const conteo = new Map<string, number>();
  for (const p of proyectos) {
    const tid = p.responsable_tecnico_id;
    if (!tid || !p.estado_id || !cuentaParaWip(p.estado_id)) continue;
    conteo.set(tid, (conteo.get(tid) ?? 0) + 1);
  }
  return [...conteo.entries()]
    .map(([usuario_id, wip]) => ({
      usuario_id,
      nombre: nombreDe(usuario_id),
      wip,
      nivel: nivelWip(wip, limite),
    }))
    .sort((a, b) => b.wip - a.wip || a.nombre.localeCompare(b.nombre, "es"));
}
