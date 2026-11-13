/**
 * POST /api/qa/runner/discovery
 * El runner reporta el output del análisis "Analizar ERP completo".
 * Guarda discovery, specs generados (si hay), uso de IA y (opcional) informe.
 *
 * Auth: HMAC del runner.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRunner } from "@/lib/qa/runner-auth";
import { buildQaNonceStore, buildQaRepo } from "@/lib/qa/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const discoverySchema = z.object({
  run_id: z.string().uuid(),
  project_id: z.string().uuid(),
  codebase: z.string().optional().nullable(),
  commit_sha: z.string().optional().nullable(),
  discovery: z.object({
    modulos: z.array(z.unknown()),
    totales: z.record(z.string(), z.unknown()).or(z.object({}).passthrough()),
  }),
  usage: z
    .array(
      z.object({
        step: z.string(),
        model: z.string(),
        input_tokens: z.number().int(),
        output_tokens: z.number().int(),
        cache_read_tokens: z.number().int(),
        cache_creation_tokens: z.number().int(),
        cost_usd: z.number(),
        status: z.enum(["ok", "skipped_budget", "error"]),
        error_message: z.string().nullable(),
      })
    )
    .default([]),
  specs_generados: z
    .array(
      z.object({
        modulo: z.string(),
        spec_file: z.string(),
        spec_source: z.string(),
        source_sanitized_sha256: z.string().length(64),
        invariante: z.string(),
        severidad: z.string(),
        requiere_sesion: z.boolean(),
      })
    )
    .default([]),
  ejecucion_specs: z
    .array(
      z.object({
        modulo: z.string(),
        spec_file: z.string(),
        estado: z.enum([
          "pending",
          "executed_pass",
          "executed_fail",
          "executed_error",
          "blocked_env_assert",
          "blocked_safety",
        ]),
        error_message: z.string().nullable(),
        results: z.array(z.unknown()).default([]),
      })
    )
    .default([]),
  informe: z
    .object({
      resumen: z.string(),
      modulos: z.array(z.unknown()),
      parcial: z.boolean().optional(),
    })
    .optional()
    .nullable(),
});

export async function POST(request: Request) {
  try {
    const nonceStore = buildQaNonceStore();
    if (!nonceStore) {
      return NextResponse.json({ error: "QA_DB_URL no configurada", code: "internal" }, { status: 500 });
    }
    const auth = await authenticateRunner(request, nonceStore);
    if (!auth.ok) return auth.response;

    const raw = await request.json().catch(() => null);
    const parsed = discoverySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "payload inválido", code: "validation", detail: parsed.error.message },
        { status: 400 }
      );
    }
    const repo = buildQaRepo();
    if (!repo) {
      return NextResponse.json({ error: "QA_DB_URL no configurada", code: "internal" }, { status: 500 });
    }

    const p = parsed.data;

    await repo.insertErpDiscovery({
      project_id: p.project_id,
      run_id: p.run_id,
      commit_sha: p.commit_sha ?? null,
      codebase: p.codebase ?? null,
      modulos: p.discovery.modulos,
      totales: p.discovery.totales,
    });

    for (const u of p.usage) {
      await repo.insertAiUsage({
        run_id: p.run_id,
        step: u.step,
        model: u.model,
        input_tokens: u.input_tokens,
        output_tokens: u.output_tokens,
        cache_read_tokens: u.cache_read_tokens,
        cache_creation_tokens: u.cache_creation_tokens,
        cost_usd: u.cost_usd,
        status: u.status,
        error_message: u.error_message,
      });
    }

    let specsResult = { inserted: 0, updated: 0 };
    if (p.specs_generados.length > 0 && p.codebase) {
      specsResult = await repo.upsertGeneratedSpecs({
        codebase: p.codebase,
        created_by_run_id: p.run_id,
        specs: p.specs_generados,
      });
    }

    // Ciclo de ejecución de specs IA: actualiza estado por spec persistido.
    if (p.codebase && p.ejecucion_specs.length > 0) {
      for (const e of p.ejecucion_specs) {
        await repo.updateGeneratedSpecEstado({
          codebase: p.codebase,
          spec_file: e.spec_file,
          estado: e.estado,
          run_id: p.run_id,
          error_message: e.error_message,
        });
      }
    }

    if (p.informe) {
      await repo.upsertInformeIa({
        run_id: p.run_id,
        project_id: p.project_id,
        resumen: p.informe.resumen,
        modulos: p.informe.modulos,
      });
    }

    const totalCost = await repo.sumAiCostForRun(p.run_id);
    const cobertura = p.codebase
      ? await repo.coberturaPorModuloParaCodebase(p.codebase)
      : [];

    return NextResponse.json(
      {
        ok: true,
        modulos_descubiertos: p.discovery.modulos.length,
        specs_persistidos: specsResult,
        specs_ejecutados: p.ejecucion_specs.length,
        total_cost_usd: totalCost,
        cobertura,
      },
      { status: 201 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    console.error("[runner/discovery POST] error:", err);
    return NextResponse.json({ error: msg, code: "internal_exception" }, { status: 500 });
  }
}
