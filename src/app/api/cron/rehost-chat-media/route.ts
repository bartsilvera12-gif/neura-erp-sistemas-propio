import { NextRequest, NextResponse } from "next/server";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getAuthWithRol } from "@/lib/middleware/auth";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import {
  rehostYCloudMessageMedia,
  mergeRehostIntoRaw,
} from "@/lib/chat/ycloud-media-rehost";

/**
 * BACKFILL: re-hospeda media vieja de WhatsApp/YCloud (imágenes/audios/videos/docs) que se guardó
 * apuntando a un link firmado de YCloud (caduca) → se veía rota en el inbox. Descarga los bytes
 * (pidiendo a YCloud un link fresco) y los sube a nuestro bucket `chat-media`, dejando la URL
 * permanente en `raw_payload.erp.public_url`. Idempotente y resumible: los mensajes ya re-hospedados
 * salen del filtro; los que fallan acumulan `erp.rehost_attempts` y se saltan tras `maxAttempts`
 * (media que YCloud ya no conserva → irrecuperable).
 *
 * Seguridad: `Authorization: Bearer <CRON_SECRET>`. Sin secret válido → 401.
 *
 * Query params:
 *  - `limit`   → cuántos mensajes procesar por llamada (default 20, máx 200).
 *  - `maxAttempts` → tope de reintentos por mensaje antes de darlo por perdido (default 3).
 *  - `stats=1` → no procesa; solo devuelve cuántos faltan.
 *  - `empresa_id` → (opcional) empresa objetivo; si no, auto-resuelve la instancia single-client.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const MEDIA_TYPES = ["image", "audio", "video", "document", "sticker"];
const CONCURRENCY = 5;

/**
 * Autoriza por CRON_SECRET (Bearer, para curl/cron) O por sesión de admin logueado (para que el
 * dueño lo dispare abriendo el link en el navegador, sin manejar secretos). Devuelve la empresa de
 * la sesión cuando aplica, para acotar el backfill a esa empresa.
 */
async function authorize(request: NextRequest): Promise<{ ok: boolean; empresaIdFromSession?: string }> {
  const expected = process.env.CRON_SECRET?.trim();
  if (expected && (request.headers.get("authorization") ?? "") === `Bearer ${expected}`) {
    return { ok: true };
  }
  try {
    const auth = await getAuthWithRol(request);
    if (auth?.empresa_id && esRolAdminEmpresaOGlobal(auth.rol)) {
      return { ok: true, empresaIdFromSession: auth.empresa_id };
    }
  } catch {
    /* sin sesión válida */
  }
  return { ok: false };
}

function parseBool(v: string | null): boolean {
  const s = (v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function safeSchema(s: string): string {
  return /^[a-z0-9_]+$/.test(s) ? s : "";
}

async function resolveEmpresaId(explicit: string | null): Promise<string | null> {
  if (explicit && explicit.trim()) return explicit.trim();
  const schemaRaw = (process.env.APP_DB_SCHEMA ?? "neura").trim();
  const schema = safeSchema(schemaRaw) || "neura";
  const pool = getChatPostgresPool();
  if (!pool) return null;
  const r = await pool.query(`SELECT id::text AS id FROM "${schema}".empresas LIMIT 1`);
  return (r.rows[0] as { id?: string } | undefined)?.id ?? null;
}

interface Row {
  id: string;
  wa_message_id: string | null;
  message_type: string;
  conversation_id: string;
  raw_payload: Record<string, unknown> | null;
  api_key: string | null;
}

async function handle(request: NextRequest) {
  const url = new URL(request.url);

  // Sonda de salud sin auth (para detectar que esta versión ya está desplegada). No toca datos.
  if (parseBool(url.searchParams.get("ping"))) {
    return NextResponse.json({ ok: true, ready: true, feature: "admin-session-auth" });
  }

  const authz = await authorize(request);
  if (!authz.ok) {
    return NextResponse.json({ ok: false, error: "no autorizado" }, { status: 401 });
  }

  const statsOnly = parseBool(url.searchParams.get("stats"));
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1), 200);
  const maxAttempts = Math.min(Math.max(parseInt(url.searchParams.get("maxAttempts") ?? "3", 10) || 3, 1), 10);
  // Modo BARREDOR (safety net): al pasar maxAgeDays, procesa SOLO media dentro de la ventana de
  // retención de YCloud (recuperable) y la reintenta indefinidamente hasta lograrlo o hasta que
  // envejezca fuera de la ventana. Así nada dentro de la ventana se pierde por un fallo transitorio.
  const maxAgeDaysRaw = url.searchParams.get("maxAgeDays");
  const maxAgeDays = maxAgeDaysRaw
    ? Math.min(Math.max(parseInt(maxAgeDaysRaw, 10) || 0, 1), 30)
    : null;

  const empresaId = await resolveEmpresaId(
    url.searchParams.get("empresa_id") ?? authz.empresaIdFromSession ?? null
  );
  if (!empresaId) {
    return NextResponse.json({ ok: false, error: "Sin empresa objetivo" }, { status: 500 });
  }

  const pool = getChatPostgresPool();
  if (!pool) {
    return NextResponse.json({ ok: false, error: "Sin conexión a Postgres (SUPABASE_DB_URL/DIRECT_URL)" }, { status: 500 });
  }
  const schema = safeSchema(await fetchDataSchemaForEmpresaId(empresaId));
  if (!schema) {
    return NextResponse.json({ ok: false, error: "Schema inválido" }, { status: 500 });
  }

  const typesList = MEDIA_TYPES.map((t) => `'${t}'`).join(",");
  const pendWhere = `
    m.message_type IN (${typesList})
    AND m.wa_message_id IS NOT NULL
    AND (m.raw_payload#>>'{erp,public_url}' IS NULL
         OR m.raw_payload#>>'{erp,public_url}' NOT LIKE '%/storage/v1/object/%')`;

  // Cuántos faltan (recuperables vs agotados).
  const cnt = await pool.query(
    `SELECT
       count(*) FILTER (WHERE coalesce((m.raw_payload#>>'{erp,rehost_attempts}')::int,0) < $1) AS pendientes,
       count(*) FILTER (WHERE coalesce((m.raw_payload#>>'{erp,rehost_attempts}')::int,0) >= $1) AS agotados
     FROM "${schema}".chat_messages m
     WHERE ${pendWhere}`,
    [maxAttempts]
  );
  const pendientes = Number((cnt.rows[0] as { pendientes: string }).pendientes ?? 0);
  const agotados = Number((cnt.rows[0] as { agotados: string }).agotados ?? 0);

  if (statsOnly) {
    return NextResponse.json({ ok: true, empresa_id: empresaId, schema, pendientes, agotados });
  }

  // En modo barredor (por edad) ignoramos el tope de intentos: se reintenta mientras la media siga
  // dentro de la ventana recuperable. Fuera de ese modo, respetamos el tope (backfill puntual).
  const effAttemptsCap = maxAgeDays ? 100000 : maxAttempts;
  const ageFilter = maxAgeDays ? `AND m.created_at > now() - interval '${maxAgeDays} days'` : "";
  const batch = await pool.query(
    `SELECT m.id::text AS id, m.wa_message_id, m.message_type,
            m.conversation_id::text AS conversation_id, m.raw_payload,
            ch.config->>'ycloud_api_key' AS api_key
     FROM "${schema}".chat_messages m
     JOIN "${schema}".chat_conversations c ON c.id = m.conversation_id
     JOIN "${schema}".chat_channels ch ON ch.id = c.channel_id
     WHERE ${pendWhere}
       AND coalesce((m.raw_payload#>>'{erp,rehost_attempts}')::int,0) < $1
       ${ageFilter}
     ORDER BY m.created_at DESC
     LIMIT $2`,
    [effAttemptsCap, limit]
  );
  const rows = batch.rows as Row[];

  const supabase = await getChatServiceClientForEmpresa(empresaId);
  const empId: string = empresaId;

  const counters = { procesados: 0, rehospedados: 0, saltados: 0, fallidos: 0 };
  const errores: Record<string, number> = {};

  async function processOne(row: Row): Promise<void> {
    counters.procesados++;
    const raw = (row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {}) as Record<string, unknown>;
    const apiKey = (row.api_key ?? "").trim();
    const prevAttempts = Number((raw.erp as { rehost_attempts?: number } | undefined)?.rehost_attempts ?? 0);

    let res;
    try {
      res = await rehostYCloudMessageMedia({
        supabase: supabase as unknown as Parameters<typeof rehostYCloudMessageMedia>[0]["supabase"],
        apiKey,
        waMessageId: row.wa_message_id ?? "",
        empresaId: empId,
        conversationId: row.conversation_id,
        messageId: row.id,
        messageType: row.message_type,
        storedRaw: raw,
      });
    } catch (e) {
      res = { ok: false, error: e instanceof Error ? e.message.slice(0, 80) : "excepcion" };
    }

    if (res.ok && !res.skipped && res.public_url) {
      const merged = mergeRehostIntoRaw(raw, res);
      await pool!.query(`UPDATE "${schema}".chat_messages SET raw_payload = $1::jsonb WHERE id = $2`, [
        JSON.stringify(merged),
        row.id,
      ]);
      counters.rehospedados++;
    } else if (res.ok && res.skipped) {
      counters.saltados++;
    } else {
      counters.fallidos++;
      const key = res.error ?? "desconocido";
      errores[key] = (errores[key] ?? 0) + 1;
      const erpExisting = raw.erp && typeof raw.erp === "object" && !Array.isArray(raw.erp) ? raw.erp : {};
      const merged = {
        ...raw,
        erp: { ...erpExisting, rehost_attempts: prevAttempts + 1, rehost_error: String(key).slice(0, 120) },
      };
      await pool!.query(`UPDATE "${schema}".chat_messages SET raw_payload = $1::jsonb WHERE id = $2`, [
        JSON.stringify(merged),
        row.id,
      ]);
    }
  }

  // Concurrencia acotada.
  let idx = 0;
  async function worker(): Promise<void> {
    while (idx < rows.length) {
      const i = idx++;
      await processOne(rows[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, () => worker()));

  return NextResponse.json({
    ok: true,
    empresa_id: empresaId,
    schema,
    lote: rows.length,
    ...counters,
    errores,
    pendientes_antes: pendientes,
    agotados,
    restantes_aprox: Math.max(0, pendientes - counters.rehospedados - counters.saltados),
  });
}

export async function POST(request: NextRequest) {
  return handle(request);
}
export async function GET(request: NextRequest) {
  return handle(request);
}
