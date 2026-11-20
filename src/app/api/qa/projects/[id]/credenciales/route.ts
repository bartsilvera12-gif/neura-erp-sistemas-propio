/**
 * NEURA QA CENTER — gestión de credenciales QA por proyecto.
 *
 * GET    /api/qa/projects/{id}/credenciales          lista máscaras (sin payload)
 * PUT    /api/qa/projects/{id}/credenciales          upsert { label, rol, email, password, notas? }
 * DELETE /api/qa/projects/{id}/credenciales/{credId} desactiva (no borra)
 *
 * Nunca devuelve payloads descifrados al panel: solo máscaras.
 * El runner recibe los payloads solo via /api/qa/runner/credenciales (HMAC).
 */

import { NextResponse } from "next/server";
import { assertQaCenterAccess } from "@/lib/qa/auth";
import { withQaClient } from "@/lib/qa/pg-pool";
import {
  upsertCredencial,
  listarCredencialesPorProyecto,
  desactivarCredencial,
  CredentialsConfigError,
  type CredencialRol,
} from "@/lib/qa/project-credentials";
import { requireJsonContentType, rateLimit } from "@/lib/qa/route-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LABEL_RE = /^[a-z][a-z0-9_]{0,40}$/;
const ROLES_PERMITIDOS: ReadonlySet<CredencialRol> = new Set([
  "lectura_autenticada",
  "sandbox_interactivo",
]);

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await assertQaCenterAccess(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id debe ser UUID", code: "validation" }, { status: 400 });
  }
  try {
    const rows = await withQaClient((c) => listarCredencialesPorProyecto(c, id));
    return NextResponse.json({ data: rows });
  } catch (err) {
    if (err instanceof CredentialsConfigError) {
      return NextResponse.json({ error: err.message, code: "config" }, { status: 500 });
    }
    const msg = err instanceof Error ? err.message : "error";
    console.error("[credenciales GET] error:", msg);
    return NextResponse.json({ error: "listar credenciales falló", code: "internal" }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  // 1) Content-Type obligatorio application/json (defensa CSRF)
  const ctErr = requireJsonContentType(request);
  if (ctErr) return ctErr;

  const auth = await assertQaCenterAccess(request);
  if (!auth.ok) return auth.response;

  // 2) Rate limit: 10 upserts por usuario por minuto (anti brute force / spam)
  const rlErr = rateLimit(`cred_put:${auth.user.id}`, { limit: 10, windowMs: 60_000 });
  if (rlErr) return rlErr;

  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id debe ser UUID", code: "validation" }, { status: 400 });
  }

  let body: {
    label?: unknown;
    rol?: unknown;
    email?: unknown;
    password?: unknown;
    notas?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body no es JSON", code: "validation" }, { status: 400 });
  }
  const label = typeof body.label === "string" ? body.label.trim().toLowerCase() : "";
  const rol = typeof body.rol === "string" ? (body.rol as CredencialRol) : null;
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const notas = typeof body.notas === "string" ? body.notas.trim() : "";

  if (!LABEL_RE.test(label)) {
    return NextResponse.json(
      { error: "label debe ser slug a-z0-9_ (max 41)", code: "validation", field: "label" },
      { status: 400 }
    );
  }
  if (!rol || !ROLES_PERMITIDOS.has(rol)) {
    return NextResponse.json(
      { error: "rol inválido", code: "validation", field: "rol", permitidos: [...ROLES_PERMITIDOS] },
      { status: 400 }
    );
  }
  if (!email || email.length > 254 || !email.includes("@")) {
    return NextResponse.json(
      { error: "email inválido", code: "validation", field: "email" },
      { status: 400 }
    );
  }
  if (!password || password.length < 4 || password.length > 256) {
    return NextResponse.json(
      { error: "password 4..256 chars", code: "validation", field: "password" },
      { status: 400 }
    );
  }

  try {
    const mascara = await withQaClient((c) =>
      upsertCredencial(c, {
        project_id: id,
        label,
        rol,
        payload: { email, password, notas: notas || undefined },
        created_by: auth.user.id,
      })
    );
    return NextResponse.json({ data: mascara });
  } catch (err) {
    if (err instanceof CredentialsConfigError) {
      return NextResponse.json({ error: err.message, code: "config" }, { status: 500 });
    }
    const msg = err instanceof Error ? err.message : "error";
    console.error("[credenciales PUT] error:", msg);
    return NextResponse.json({ error: "upsert credencial falló", code: "internal" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await assertQaCenterAccess(request);
  if (!auth.ok) return auth.response;

  // Rate limit 20 por minuto por usuario: deja margen para desactivar en bulk
  // pero bloquea scripts hostiles.
  const rlErr = rateLimit(`cred_del:${auth.user.id}`, { limit: 20, windowMs: 60_000 });
  if (rlErr) return rlErr;

  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id debe ser UUID", code: "validation" }, { status: 400 });
  }
  const url = new URL(request.url);
  const credId = (url.searchParams.get("cred_id") ?? "").trim();
  if (!UUID_RE.test(credId)) {
    return NextResponse.json(
      { error: "cred_id debe ser UUID (query string)", code: "validation" },
      { status: 400 }
    );
  }

  try {
    const ok = await withQaClient((c) => desactivarCredencial(c, credId, auth.user.id));
    if (!ok) {
      return NextResponse.json({ error: "credencial no encontrada", code: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ data: { desactivada: true } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    console.error("[credenciales DELETE] error:", msg);
    return NextResponse.json({ error: "desactivar credencial falló", code: "internal" }, { status: 500 });
  }
}
