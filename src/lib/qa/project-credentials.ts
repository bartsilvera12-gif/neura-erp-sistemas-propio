/**
 * NEURA QA CENTER — gestión de credenciales QA por proyecto.
 *
 * Objetivo (Fase 1): "Almacenamiento cifrado y sin exposición en logs".
 *
 * Diseño de seguridad:
 *   · El payload (email + password + notas) se cifra con pgp_sym_encrypt
 *     usando una master key que vive en `process.env.QA_CREDENTIALS_ENC_KEY`.
 *   · Esa key NUNCA se loggea ni se devuelve al cliente.
 *   · El payload descifrado NUNCA se devuelve a la UI — solo se devuelve una
 *     vista "máscara" (p. ej. email con dominio visible, password censurado).
 *   · El runner recibe credenciales solo via HMAC en un endpoint dedicado,
 *     nunca via la API pública del panel.
 *
 * Compartido entre:
 *   · `/api/qa/projects/[id]/credenciales/*` (panel admin)
 *   · `/api/qa/runner/credenciales/[slug]` (runner via HMAC)
 */

/** Cliente pg mínimo que necesitamos — compatible con pg.PoolClient. */
export type PgLike = {
  query: (
    sql: string,
    args?: unknown[]
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

const KEY_ENV = "QA_CREDENTIALS_ENC_KEY";
const MIN_KEY_LEN = 32;

export type CredencialRol =
  | "lectura_anonima_no_aplica"
  | "lectura_autenticada"
  | "sandbox_interactivo"
  | "metrics_pg_monitor";

export type PayloadCredencial = {
  email: string;
  password: string;
  notas?: string;
};

export type CredencialMascara = {
  id: string;
  label: string;
  rol: CredencialRol;
  email_mascara: string;        // "a***a@n***.py"
  password_mascara: string;     // "•••••••"
  active: boolean;
  created_at: string;
  last_used_at: string | null;
  updated_at: string;
};

export type CredencialParaRunner = {
  label: string;
  rol: CredencialRol;
  email: string;
  password: string;
  notas: string | null;
};

export class CredentialsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialsConfigError";
  }
}

function getMasterKey(): string {
  const k = (process.env[KEY_ENV] ?? "").trim();
  if (k.length < MIN_KEY_LEN) {
    throw new CredentialsConfigError(
      `${KEY_ENV} no configurada o demasiado corta (requiere >=${MIN_KEY_LEN} chars)`
    );
  }
  return k;
}

/** Máscara un email como "a***a@n***.py". Nunca devuelve el valor completo. */
function mascararEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 0) return "***";
  const local = email.slice(0, at);
  const dom = email.slice(at + 1);
  const l = local.length <= 2 ? "*".repeat(local.length) : `${local[0]}${"*".repeat(local.length - 2)}${local[local.length - 1]}`;
  const dotIdx = dom.lastIndexOf(".");
  const d =
    dotIdx > 0 && dom.length > 2
      ? `${dom[0]}${"*".repeat(Math.max(1, dotIdx - 1))}${dom.slice(dotIdx)}`
      : "***";
  return `${l}@${d}`;
}

function mascararPassword(len: number): string {
  // No devolvemos la longitud real para no dar pistas: siempre 7 bullets.
  void len;
  return "•••••••";
}

/** Inserta o actualiza una credencial. Devuelve la máscara, nunca el payload. */
export async function upsertCredencial(
  client: PgLike,
  input: {
    project_id: string;
    label: string;
    rol: CredencialRol;
    payload: PayloadCredencial;
    created_by: string | null;
  }
): Promise<CredencialMascara> {
  const key = getMasterKey();
  const payloadJson = JSON.stringify({
    email: input.payload.email,
    password: input.payload.password,
    notas: input.payload.notas ?? null,
  });

  const r = await client.query(
    `INSERT INTO qa_center.project_credentials
       (project_id, label, rol, payload_cifrado, created_by)
     VALUES ($1, $2, $3, extensions.pgp_sym_encrypt($4, $5), $6)
     ON CONFLICT (project_id, label) DO UPDATE SET
       rol             = EXCLUDED.rol,
       payload_cifrado = EXCLUDED.payload_cifrado,
       active          = true,
       updated_at      = now()
     RETURNING id, label, rol, active, created_at, last_used_at, updated_at`,
    [input.project_id, input.label, input.rol, payloadJson, key, input.created_by]
  );
  const row = r.rows[0];
  if (!row) throw new Error("upsertCredencial: insert no devolvió fila");

  return {
    id: String(row.id),
    label: String(row.label),
    rol: row.rol as CredencialRol,
    email_mascara: mascararEmail(input.payload.email),
    password_mascara: mascararPassword(input.payload.password.length),
    active: Boolean(row.active),
    created_at: toIso(row.created_at),
    last_used_at: row.last_used_at ? toIso(row.last_used_at) : null,
    updated_at: toIso(row.updated_at),
  };
}

/** Lista las credenciales (máscaras) de un proyecto. Nunca devuelve payloads. */
export async function listarCredencialesPorProyecto(
  client: PgLike,
  project_id: string
): Promise<CredencialMascara[]> {
  const key = getMasterKey();
  // Descifrar solo para extraer el email (con el dominio) y poder enmascararlo
  // de manera útil. Si la master key cambia y los registros quedan huérfanos,
  // `pgp_sym_decrypt` arroja — lo atrapamos y devolvemos máscara "???".
  const r = await client.query(
    `SELECT id, label, rol, active, created_at, last_used_at, updated_at,
            CASE
              WHEN active THEN extensions.pgp_sym_decrypt(payload_cifrado, $2)
              ELSE NULL
            END AS payload_text
       FROM qa_center.project_credentials
      WHERE project_id = $1
      ORDER BY created_at DESC`,
    [project_id, key]
  );
  const out: CredencialMascara[] = [];
  for (const row of r.rows) {
    let email = "";
    let passLen = 0;
    try {
      const txt = row.payload_text as string | null;
      if (txt) {
        const parsed = JSON.parse(txt) as PayloadCredencial;
        email = parsed.email;
        passLen = parsed.password?.length ?? 0;
      }
    } catch {
      email = "???";
      passLen = 0;
    }
    out.push({
      id: String(row.id),
      label: String(row.label),
      rol: row.rol as CredencialRol,
      email_mascara: email ? mascararEmail(email) : "???",
      password_mascara: mascararPassword(passLen),
      active: Boolean(row.active),
      created_at: toIso(row.created_at),
      last_used_at: row.last_used_at ? toIso(row.last_used_at) : null,
      updated_at: toIso(row.updated_at),
    });
  }
  return out;
}

/** Desactiva (no borra) una credencial. Registra quién la desactivó. */
export async function desactivarCredencial(
  client: PgLike,
  id: string,
  actor_user_id: string | null
): Promise<boolean> {
  const r = await client.query(
    `UPDATE qa_center.project_credentials
        SET active = false,
            desactivada_at = now(),
            desactivada_por = $2,
            updated_at = now()
      WHERE id = $1
        AND active = true
      RETURNING id`,
    [id, actor_user_id]
  );
  return r.rows.length > 0;
}

/**
 * Devuelve la credencial descifrada para el RUNNER. SOLO debe llamarse desde
 * el endpoint HMAC `/api/qa/runner/credenciales/[slug]`.
 * Actualiza `last_used_at`.
 */
export async function obtenerCredencialesParaRunner(
  client: PgLike,
  project_slug: string
): Promise<CredencialParaRunner[]> {
  const key = getMasterKey();
  const r = await client.query(
    `WITH act AS (
       SELECT c.id, c.label, c.rol,
              extensions.pgp_sym_decrypt(c.payload_cifrado, $2) AS payload_text
         FROM qa_center.project_credentials c
         JOIN qa_center.projects p ON p.id = c.project_id
        WHERE p.slug = $1
          AND c.active = true
          AND p.archived_at IS NULL
     )
     UPDATE qa_center.project_credentials c
        SET last_used_at = now()
       FROM act
      WHERE c.id = act.id
      RETURNING act.label, act.rol, act.payload_text`,
    [project_slug, key]
  );
  const out: CredencialParaRunner[] = [];
  for (const row of r.rows) {
    try {
      const parsed = JSON.parse(String(row.payload_text)) as PayloadCredencial;
      out.push({
        label: String(row.label),
        rol: row.rol as CredencialRol,
        email: parsed.email,
        password: parsed.password,
        notas: parsed.notas ?? null,
      });
    } catch {
      // Si no se puede descifrar o parsear, saltamos — el runner recibe
      // solo las credenciales que sí pudimos descifrar.
    }
  }
  return out;
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/**
 * Para evitar que `email` o `password` caigan en logs por accidente, este
 * wrapper redact los campos sensibles antes de serializar. Úsalo en
 * `logger.info({ cred: redactCred(x) }, "...")`.
 */
export function redactCred<T extends { email?: unknown; password?: unknown }>(
  obj: T
): Omit<T, "email" | "password"> & { email: string; password: string } {
  const copy = { ...obj } as unknown as Record<string, unknown>;
  copy.email = "[REDACTED]";
  copy.password = "[REDACTED]";
  return copy as Omit<T, "email" | "password"> & { email: string; password: string };
}
