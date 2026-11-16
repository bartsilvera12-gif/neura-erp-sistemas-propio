/**
 * NEURA QA CENTER — cliente GitHub para listar repos autorizados.
 *
 * Reglas:
 *  - El token (GITHUB_TOKEN) es server-side; nunca lo exponemos al frontend.
 *  - Permisos de SÓLO LECTURA (`/user/repos` + `/repos/{owner}/{name}`).
 *  - Alcance limitado a los owners declarados en `QA_GITHUB_ALLOWED_OWNERS`
 *    (coma-separado). Si la env está vacía, el alcance queda limitado al
 *    propio owner del token (consultamos `/user`).
 *  - Cache en memoria por 5 minutos para no quemar rate limit.
 *  - El endpoint expone sólo los campos necesarios (etiqueta, url, rama).
 *
 * NO se exponen OAuth scopes, headers ni el token al cliente.
 */

export type GithubRepoLite = {
  url: string; // https://github.com/<owner>/<name>
  owner: string;
  name: string;
  etiqueta: string; // owner/name + privado?
  codebase: string; // inferido heurísticamente — el usuario puede cambiarlo
  default_branch: string;
  private: boolean;
  updated_at: string;
};

export type ListarReposOut =
  | {
      ok: true;
      repos: GithubRepoLite[];
      page: number;
      per_page: number;
      has_more: boolean;
      total_estimado: number | null;
      source: "github" | "cache";
      allowed_owners: string[];
    }
  | { ok: false; code: "no_token" | "github_error" | "no_allowed_owners"; message: string };

const CACHE_TTL_MS = 5 * 60 * 1000;

type RawRepo = {
  name: string;
  full_name: string;
  owner: { login: string };
  html_url: string;
  default_branch: string;
  private: boolean;
  updated_at: string;
  archived: boolean;
  description: string | null;
};

type CacheEntry = { fetched_at: number; repos: GithubRepoLite[] };
const cache = new Map<string, CacheEntry>(); // key = allowed-owners sorted

/** Owners permitidos, derivados de env + login del token. */
async function resolverAllowedOwners(token: string): Promise<string[]> {
  const envList = (process.env.QA_GITHUB_ALLOWED_OWNERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (envList.length > 0) return envList;
  // Si no se declara allowlist, usamos el login del token como único owner.
  try {
    const r = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "neura-qa-center",
      },
    });
    if (!r.ok) return [];
    const d = (await r.json()) as { login?: string };
    return d.login ? [d.login] : [];
  } catch {
    return [];
  }
}

function inferirCodebase(repoName: string): string {
  const n = repoName.toLowerCase();
  if (n.includes("sistemas-propio")) return "sistemas-propio";
  if (n.includes("mevo") && n.includes("vendedor")) return "mevo-vendedores";
  if (n.includes("mevo")) return "mevo";
  if (n.includes("erp")) return "erp-neura";
  return "otro";
}

function normalizarRaw(r: RawRepo): GithubRepoLite {
  return {
    url: r.html_url,
    owner: r.owner.login,
    name: r.name,
    etiqueta: `${r.full_name}${r.private ? " (privado)" : ""}`,
    codebase: inferirCodebase(r.name),
    default_branch: r.default_branch || "main",
    private: Boolean(r.private),
    updated_at: r.updated_at,
  };
}

/** Lista TODAS las páginas y las guarda en cache. Usa /user/repos. */
async function fetchTodosLosRepos(token: string): Promise<GithubRepoLite[]> {
  const out: GithubRepoLite[] = [];
  const PER_PAGE = 100;
  for (let page = 1; page <= 20; page++) {
    const url = new URL("https://api.github.com/user/repos");
    url.searchParams.set("per_page", String(PER_PAGE));
    url.searchParams.set("page", String(page));
    url.searchParams.set("sort", "updated");
    url.searchParams.set("affiliation", "owner,organization_member,collaborator");
    const r = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "neura-qa-center",
      },
    });
    if (!r.ok) {
      throw new Error(`GitHub /user/repos page=${page}: HTTP ${r.status}`);
    }
    const arr = (await r.json()) as RawRepo[];
    for (const raw of arr) {
      if (raw.archived) continue;
      out.push(normalizarRaw(raw));
    }
    if (arr.length < PER_PAGE) break;
  }
  return out;
}

export type ListarReposInput = { q?: string; page?: number; per_page?: number };

export async function listarReposDeGithub(input: ListarReposInput): Promise<ListarReposOut> {
  const token = process.env.GITHUB_TOKEN ?? "";
  if (!token) {
    return {
      ok: false,
      code: "no_token",
      message: "GitHub no está conectado al QA Center (falta GITHUB_TOKEN en el servidor)",
    };
  }

  const allowed = await resolverAllowedOwners(token);
  if (allowed.length === 0) {
    return {
      ok: false,
      code: "no_allowed_owners",
      message: "No hay owners autorizados (seteá QA_GITHUB_ALLOWED_OWNERS o revisá los permisos del token)",
    };
  }

  const cacheKey = allowed.slice().sort().join(",");
  let entry = cache.get(cacheKey);
  let source: "github" | "cache" = "github";
  if (entry && Date.now() - entry.fetched_at < CACHE_TTL_MS) {
    source = "cache";
  } else {
    try {
      const todos = await fetchTodosLosRepos(token);
      // Filtramos por owners permitidos
      const permitidos = todos.filter((r) =>
        allowed.map((o) => o.toLowerCase()).includes(r.owner.toLowerCase())
      );
      entry = { fetched_at: Date.now(), repos: permitidos };
      cache.set(cacheKey, entry);
    } catch (e) {
      return {
        ok: false,
        code: "github_error",
        message: e instanceof Error ? e.message : "GitHub devolvió un error",
      };
    }
  }

  const q = (input.q ?? "").trim().toLowerCase();
  let filtrados = entry.repos;
  if (q) {
    filtrados = entry.repos.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.owner.toLowerCase().includes(q) ||
        r.etiqueta.toLowerCase().includes(q) ||
        r.url.toLowerCase().includes(q)
    );
  }

  const per_page = Math.min(Math.max(input.per_page ?? 50, 1), 100);
  const page = Math.max(input.page ?? 1, 1);
  const start = (page - 1) * per_page;
  const slice = filtrados.slice(start, start + per_page);
  return {
    ok: true,
    repos: slice,
    page,
    per_page,
    has_more: start + slice.length < filtrados.length,
    total_estimado: filtrados.length,
    source,
    allowed_owners: allowed,
  };
}

/**
 * Valida que `repoUrl` corresponda a un owner autorizado y que el token lo
 * pueda leer. Devuelve la metadata normalizada o null. Esto reemplaza a la
 * whitelist estática.
 */
export async function verificarRepoAutorizado(repoUrl: string): Promise<GithubRepoLite | null> {
  const token = process.env.GITHUB_TOKEN ?? "";
  if (!token) return null;
  const match = repoUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?\/?$/i);
  if (!match) return null;
  const owner = match[1];
  const name = match[2];
  if (!owner || !name) return null;
  const allowed = await resolverAllowedOwners(token);
  if (!allowed.map((o) => o.toLowerCase()).includes(owner.toLowerCase())) return null;
  try {
    const r = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "neura-qa-center",
      },
    });
    if (!r.ok) return null;
    const raw = (await r.json()) as RawRepo;
    return normalizarRaw(raw);
  } catch {
    return null;
  }
}

/** Solo para tests: limpia el cache de repos. */
export function __limpiarCacheReposGithub(): void {
  cache.clear();
}
