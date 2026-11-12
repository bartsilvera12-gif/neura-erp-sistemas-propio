/**
 * NEURA QA CENTER — gate server-side de modo QA-only.
 *
 * Activo SOLO cuando `QA_ONLY_MODE === "true"`. Bloquea toda ruta del ERP que
 * no sea estrictamente necesaria para login, sesión y QA Center. Prod no entra
 * en esta rama — `isQaOnlyMode()` devuelve `false` si la variable no está.
 *
 * Diseño pure-function para que el middleware sea testeable y para habilitar
 * una auditoría estática del allowlist. No toca cookies ni Supabase.
 */

export type QaOnlyGateDecision =
  | { kind: "pass" }
  | { kind: "redirect"; location: string }
  | { kind: "block"; status: 404 | 405; reason: string };

export type GateRequest = {
  pathname: string;
  method: string;
};

/** Default-false. Cualquier valor distinto de literal "true" deja el modo apagado. */
export function isQaOnlyMode(): boolean {
  return (process.env.QA_ONLY_MODE ?? "").trim().toLowerCase() === "true";
}

/**
 * Métodos HTTP aceptados en general. Cualquier método fuera de este set se
 * rechaza con 405 incluso en rutas permitidas (previene PUT/DELETE/PATCH en
 * endpoints que fueron pensados sólo lectura/escritura acotada).
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "POST"]);

/** Prefijos de PATH que, bajo QA-only, pasan al handler sin rewrite. */
const ALLOWED_PATH_PREFIXES: ReadonlyArray<string> = [
  "/_next/",
  "/favicon.ico",
  "/login",
  "/logout",
  "/dashboard/qa-center",
  "/api/qa/",
  "/api/auth/",
  "/api/empresas/module-access",
];

/** Rutas EXACTAS permitidas que no son prefijos (evita que "/loginfake" cuele). */
const ALLOWED_EXACT_PATHS: ReadonlyArray<string> = [
  "/login",
  "/logout",
  "/dashboard/qa-center",
  "/favicon.ico",
  "/api/empresas/module-access",
];

function isPathAllowed(pathname: string): boolean {
  if (ALLOWED_EXACT_PATHS.includes(pathname)) return true;
  // Prefijos "terminados en /" solo matchean sub-rutas reales.
  for (const prefix of ALLOWED_PATH_PREFIXES) {
    if (prefix.endsWith("/") && pathname.startsWith(prefix)) return true;
  }
  // Prefijos "sueltos": matchean la ruta exacta o la ruta seguida de "/".
  for (const prefix of ["/login", "/logout", "/dashboard/qa-center"]) {
    if (pathname === prefix) return true;
    if (pathname.startsWith(prefix + "/")) return true;
  }
  return false;
}

/**
 * Evalúa la petición bajo modo QA-only.
 *   - "/" (raíz) → redirect a /dashboard/qa-center (evita loop de AuthGuard)
 *   - Rutas de la allowlist → pass
 *   - Método fuera de SAFE_METHODS → block 405
 *   - Cualquier otra ruta → block 404
 *
 * Los chequeos de autorización (sesión, super_admin, member Neura) los hacen
 * las propias rutas; este gate NO otorga permisos, solo cierra la puerta
 * de rutas ajenas a QA Center.
 */
export function evaluateQaOnlyGate(req: GateRequest): QaOnlyGateDecision {
  const method = (req.method ?? "GET").toUpperCase();
  const pathname = req.pathname;

  if (!SAFE_METHODS.has(method)) {
    return { kind: "block", status: 405, reason: "method_not_allowed" };
  }

  // Raíz → redirigimos directo al panel QA. AuthGuard luego exige sesión y
  // acceso de módulo; si el usuario no está autorizado, AuthGuard redirige
  // a /login (que SÍ está en la allowlist).
  if (pathname === "/") {
    return { kind: "redirect", location: "/dashboard/qa-center" };
  }

  if (isPathAllowed(pathname)) {
    return { kind: "pass" };
  }

  return { kind: "block", status: 404, reason: "path_not_in_qa_allowlist" };
}

/** Exporta allowlist para tests/auditoría — sólo lectura. */
export const QA_ONLY_ALLOWLIST = Object.freeze({
  prefixes: ALLOWED_PATH_PREFIXES,
  exact: ALLOWED_EXACT_PATHS,
  methods: Array.from(SAFE_METHODS),
});
