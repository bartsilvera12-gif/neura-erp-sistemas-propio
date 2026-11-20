/**
 * POST /api/qa/runner/event
 *
 * Progreso en vivo del agente QA. El runner emite eventos spec-por-spec /
 * módulo-por-módulo mientras corre el pipeline. La UI del run los pinta en un
 * timeline con polling cada ~2 s.
 *
 * Auth: HMAC del runner (igual que /claim, /heartbeat, /discovery).
 *
 * Body:
 *   {
 *     run_id: uuid,
 *     fase:   "discovery"|"comprension"|"spec_gen"|"spec_executing"|"informe"|"visual",
 *     modulo?: string,
 *     submodulo?: string,
 *     accion?: string,
 *     estado?: "info"|"started"|"ok"|"fail"|"skipped"|"blocked"|"warn",
 *     mensaje?: string,
 *     evidence_path?: string,
 *     payload?: object,
 *   }
 *   O un batch: { events: [{...}, ...] } para no spamear el HTTP.
 *
 * El endpoint acepta hasta 50 eventos por batch. No hay rate-limit — el
 * sanitizador del pipeline ya impide loops infinitos en los specs IA.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRunner } from "@/lib/qa/runner-auth";
import { buildQaNonceStore, buildQaRepo } from "@/lib/qa/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const eventSchema = z.object({
  run_id: z.string().uuid(),
  fase: z.string().min(1).max(40),
  modulo: z.string().max(200).optional().nullable(),
  submodulo: z.string().max(200).optional().nullable(),
  accion: z.string().max(400).optional().nullable(),
  estado: z.string().max(40).default("info"),
  mensaje: z.string().max(4000).optional().nullable(),
  evidence_path: z.string().max(1000).optional().nullable(),
  payload: z.record(z.string(), z.unknown()).optional().nullable(),
});

const bodySchema = z.union([
  eventSchema,
  z.object({ events: z.array(eventSchema).min(1).max(50) }),
]);

export async function POST(request: Request) {
  try {
    const nonceStore = buildQaNonceStore();
    if (!nonceStore) {
      return NextResponse.json({ error: "QA_DB_URL no configurada", code: "internal" }, { status: 500 });
    }
    const auth = await authenticateRunner(request, nonceStore);
    if (!auth.ok) return auth.response;

    const raw = (() => { try { return auth.bodyJson(); } catch { return null; } })();
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({
        path: i.path.join("."), code: i.code, message: i.message,
      }));
      return NextResponse.json(
        { error: "payload inválido", code: "validation", detail: issues.slice(0, 3).map(i => `${i.path}: ${i.message}`).join(" | "), issues },
        { status: 400 }
      );
    }
    const events = "events" in parsed.data ? parsed.data.events : [parsed.data];

    const repo = buildQaRepo();
    if (!repo) return NextResponse.json({ error: "QA_DB_URL no configurada", code: "internal" }, { status: 500 });

    await repo.insertRunEvents(events.map((e) => ({
      run_id: e.run_id,
      fase: e.fase,
      modulo: e.modulo ?? null,
      submodulo: e.submodulo ?? null,
      accion: e.accion ?? null,
      estado: e.estado,
      mensaje: e.mensaje ?? null,
      evidence_path: e.evidence_path ?? null,
      payload: e.payload ?? null,
    })));

    return NextResponse.json({ ok: true, inserted: events.length }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    console.error("[runner/event POST] error:", err);
    return NextResponse.json({ error: msg, code: "internal_exception" }, { status: 500 });
  }
}
