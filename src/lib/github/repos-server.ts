import "server-only";
import type { RepoItem } from "@/lib/github/repo-search";

/**
 * Lista de repositorios de GitHub accesibles por el token, con caché en memoria.
 *
 * El token (`GITHUB_REPOS_TOKEN`, read-only) vive solo en el servidor; el
 * navegador nunca lo ve. La app corre en Argentina, donde GitHub limita a 60
 * req/hora SIN token: por eso el token es obligatorio y además cacheamos el
 * resultado (la lista cambia poco) para no pegarle en cada apertura del selector.
 */

const TTL_MS = 10 * 60 * 1000; // 10 min
const PER_PAGE = 100;
const MAX_PAGINAS = 10; // tope de seguridad (hasta 1000 repos)

type GithubRepoRaw = {
  full_name?: string;
  private?: boolean;
  html_url?: string;
  description?: string | null;
};

let cache: { at: number; repos: RepoItem[] } | null = null;
let enVuelo: Promise<RepoItem[]> | null = null;

export class GithubReposError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "GithubReposError";
  }
}

async function traerTodos(token: string): Promise<RepoItem[]> {
  const repos: RepoItem[] = [];
  for (let page = 1; page <= MAX_PAGINAS; page++) {
    const url = `https://api.github.com/user/repos?per_page=${PER_PAGE}&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      // Nunca cachear del lado de Next: el caché lo manejamos acá.
      cache: "no-store",
    });
    if (!res.ok) {
      const cuerpo = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new GithubReposError(
        cuerpo?.message || `GitHub respondió ${res.status}`,
        res.status
      );
    }
    const lote = (await res.json()) as GithubRepoRaw[];
    if (!Array.isArray(lote) || lote.length === 0) break;
    for (const r of lote) {
      if (!r.full_name || !r.html_url) continue;
      repos.push({
        full_name: r.full_name,
        private: r.private === true,
        html_url: r.html_url,
        description: typeof r.description === "string" ? r.description : null,
      });
    }
    if (lote.length < PER_PAGE) break;
  }
  return repos;
}

/** Repos cacheados; refresca si venció el TTL. Deduplica llamadas concurrentes. */
export async function listarReposCacheados(): Promise<RepoItem[]> {
  const token = (process.env.GITHUB_REPOS_TOKEN ?? "").trim();
  if (!token) {
    throw new GithubReposError(
      "Falta GITHUB_REPOS_TOKEN en el servidor. Configurá el token read-only de GitHub en las variables de entorno.",
      500
    );
  }

  const ahora = Date.now();
  if (cache && ahora - cache.at < TTL_MS) return cache.repos;
  if (enVuelo) return enVuelo;

  enVuelo = (async () => {
    try {
      const repos = await traerTodos(token);
      cache = { at: Date.now(), repos };
      return repos;
    } catch (e) {
      // Si falla el refresco pero hay caché viejo, servilo igual (mejor que nada).
      if (cache) return cache.repos;
      throw e;
    } finally {
      enVuelo = null;
    }
  })();
  return enVuelo;
}
