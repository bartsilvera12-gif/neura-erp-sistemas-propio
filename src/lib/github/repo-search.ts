/**
 * Buscador "re contra pro" para el selector de repositorios: sin tildes, orden
 * libre de palabras, tolerante a errores de tipeo y por relevancia. Puro (sirve
 * en cliente y servidor), sin dependencias.
 */

export type RepoItem = {
  /** `owner/repo`, ej. `bartsilvera12-gif/neura-erp-mevo`. */
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
};

/** minúsculas + sin acentos, igual criterio que el resto del sistema. */
export function normalizeRepoBusqueda(s: string): string {
  return (s ?? "").trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

/** Distancia de edición acotada: devuelve true si a y b difieren en <= 1 cambio. */
function dentroDeUnaEdicion(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  // Longitudes iguales: a lo sumo una sustitución.
  if (la === lb) {
    let diffs = 0;
    for (let i = 0; i < la; i++) {
      if (a[i] !== b[i] && ++diffs > 1) return false;
    }
    return true;
  }
  // Difieren en 1: a lo sumo una inserción/eliminación.
  const corta = la < lb ? a : b;
  const larga = la < lb ? b : a;
  let i = 0;
  let j = 0;
  let saltos = 0;
  while (i < corta.length && j < larga.length) {
    if (corta[i] === larga[j]) {
      i++;
      j++;
    } else if (++saltos > 1) {
      return false;
    } else {
      j++;
    }
  }
  return true;
}

/**
 * Puntaje de un repo contra la consulta. `-1` si no matchea (se descarta).
 * Más alto = más relevante. Cada palabra de la consulta tiene que aparecer
 * (como prefijo de palabra, subcadena, o con un error de tipeo).
 */
export function puntuarRepo(repo: RepoItem, tokens: string[], queryJunta: string): number {
  if (tokens.length === 0) return 0;
  const nombre = normalizeRepoBusqueda(repo.full_name);
  const desc = normalizeRepoBusqueda(repo.description ?? "");
  const heno = `${nombre} ${desc}`;
  const palabras = nombre.split(/[^a-z0-9]+/).filter(Boolean);

  let total = 0;
  for (const token of tokens) {
    let mejor = 0;
    if (palabras.some((w) => w === token)) {
      mejor = 100; // palabra exacta del nombre
    } else if (palabras.some((w) => w.startsWith(token))) {
      mejor = 70; // prefijo de una palabra del nombre
    } else if (nombre.includes(token)) {
      mejor = 45; // subcadena en el nombre
    } else if (heno.includes(token)) {
      mejor = 25; // aparece en la descripción
    } else if (token.length >= 3 && palabras.some((w) => dentroDeUnaEdicion(w, token))) {
      mejor = 15; // error de tipeo tolerado (solo tokens de 3+)
    } else {
      return -1; // una palabra que no aparece descarta el repo
    }
    total += mejor;
  }

  // Bonus: el nombre empieza con la consulta junta, o el repo es más corto
  // (más específico). Esto ordena mejor cuando varios matchean parecido.
  if (queryJunta && nombre.startsWith(queryJunta)) total += 40;
  if (nombre.includes(queryJunta)) total += 10;
  total += Math.max(0, 20 - Math.floor(nombre.length / 4));
  return total;
}

/** Filtra y ordena los repos por relevancia para la consulta dada. */
export function buscarRepos(lista: RepoItem[], queryRaw: string, limite = 50): RepoItem[] {
  const q = normalizeRepoBusqueda(queryRaw);
  if (!q) {
    // Sin consulta: los primeros (ya vienen ordenados por actividad reciente).
    return lista.slice(0, limite);
  }
  const tokens = q.split(/\s+/).filter(Boolean);
  const queryJunta = tokens.join("-");
  const conPuntaje: { repo: RepoItem; score: number }[] = [];
  for (const repo of lista) {
    const score = puntuarRepo(repo, tokens, queryJunta);
    if (score >= 0) conPuntaje.push({ repo, score });
  }
  conPuntaje.sort((a, b) => b.score - a.score || a.repo.full_name.localeCompare(b.repo.full_name));
  return conPuntaje.slice(0, limite).map((x) => x.repo);
}
