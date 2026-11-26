/**
 * GET /api/qa/runs/[id]/report
 *
 * Genera un reporte PDF del run QA con los errores encontrados por módulo,
 * para entregar al cliente como evidencia de las pruebas. Sin screenshots —
 * solo texto con el detalle exacto de cada error (mensaje, módulo, tipo).
 *
 * Auth: misma gate que el panel (resolveQaAccess). Si el usuario no tiene
 * acceso al QA Center, 404.
 *
 * Content-Disposition fuerza nombre de archivo con extensión .pdf para
 * que el browser lo guarde correctamente aunque la ruta no termine en .pdf.
 */

import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveQaAccess } from "@/lib/qa/authorize";
import { buildQaRepo } from "@/lib/qa/route-helpers";
import PDFDocument from "pdfkit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Paleta Neura (misma del QA Center). */
const COLOR = {
  marca:    "#0B3A3D",
  cyan:     "#0EA5E9",
  rose:     "#DC2626",
  emerald:  "#059669",
  slateDeep:"#0F172A",
  slate:    "#475569",
  slateMuted:"#94A3B8",
  slateBg:  "#F8FAFC",
  slateLine:"#E2E8F0",
} as const;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!UUID_RE.test(id)) {
      return new Response(JSON.stringify({ error: "id debe ser UUID" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const sb = await createSupabaseServerClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user?.email) notFound();
    const decision = await resolveQaAccess(sb, user.email);
    if (!decision.ok) notFound();

    const repo = buildQaRepo();
    if (!repo) {
      return new Response(JSON.stringify({ error: "QA_DB_URL no configurada" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    const run = await repo.getRun(id);
    if (!run) notFound();
    const project = await repo.getProject(run.project_id);
    const suite = await repo.getSuite(run.suite_id);
    const results = await repo.listResultsForRun(id);

    const buffer = await construirPdf({ run, project, suite, results });

    const nombreArchivo = `qa-report-${project?.slug ?? "run"}-${id.slice(0, 8)}.pdf`;
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${nombreArchivo}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    // Si el PDF falla, devolvemos HTML simple con status 200 (para que el
    // browser no aborte la descarga ni intente guardar un .json/.txt raro).
    // El usuario ve el error directo en pantalla y puede captura-pegarlo.
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? (err.stack ?? "").slice(0, 2500) : "";
    console.error("[qa report pdf] error:", err);
    const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Error generando PDF</title>
<style>
body{font-family:ui-sans-serif,system-ui,sans-serif;max-width:860px;margin:40px auto;padding:0 20px;color:#0f172a}
h1{color:#dc2626}
.card{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:12px 0}
pre{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px;overflow-x:auto;font-size:12px;line-height:1.4}
.ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#065f46;padding:12px;border-radius:6px;font-size:13px}
</style></head><body>
<h1>No se pudo generar el PDF</h1>
<p>El endpoint falló al construir el informe. Detalle del error para que lo veas y lo pases al desarrollo:</p>
<div class="card">
  <strong>Mensaje:</strong>
  <pre>${msg.replace(/[<&]/g, (c) => c === "<" ? "&lt;" : "&amp;")}</pre>
  ${stack ? `<strong>Stack:</strong><pre>${stack.replace(/[<&]/g, (c) => c === "<" ? "&lt;" : "&amp;")}</pre>` : ""}
</div>
<p class="ok">Nota: los resultados del run SÍ están en la DB y se ven en la pantalla de detalle del run (<code>/dashboard/qa-center/runs/...</code>). El PDF es solo el archivo descargable que falló.</p>
</body></html>`;
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}

type RepoNN = NonNullable<ReturnType<typeof buildQaRepo>>;
type RunLike = Awaited<ReturnType<RepoNN["getRun"]>>;
type ResultLike = Awaited<ReturnType<RepoNN["listResultsForRun"]>>[number];
type ProjectLike = Awaited<ReturnType<RepoNN["getProject"]>>;
type SuiteLike = Awaited<ReturnType<RepoNN["getSuite"]>>;

/** Normaliza texto para pdfkit WinAnsi: quita emojis, box drawing,
 *  smart quotes, bullets y cualquier char fuera de Latin1. Esto evita
 *  que el PDF salga con gibberish al topar con chars no soportados. */
function safe(txt: unknown): string {
  if (txt == null) return "";
  return String(txt)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[•‣◦]/g, "-")
    .replace(/…/g, "...")
    .replace(/·/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[^\x00-\xFF]/g, "?")
    .trim();
}

async function construirPdf(args: {
  run: NonNullable<RunLike>;
  project: ProjectLike;
  suite: SuiteLike;
  results: ReadonlyArray<ResultLike>;
}): Promise<Buffer> {
  const { run, project, suite, results } = args;
  const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  // Deduplicar resultados (misma test_title + spec_file + status).
  // Antes algunos runs persistían el mismo veredicto dos veces (uno en
  // vivo, uno en el reporte final) y el PDF listaba duplicados.
  const vistos = new Set<string>();
  const dedup = results.filter((r) => {
    const k = `${r.spec_file}|${r.test_title}|${r.status}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });

  const fallidos = dedup.filter((r) => r.status === "failed" || r.status === "timed_out");
  const exitosos = dedup.filter((r) => r.status === "passed");
  const omitidos = dedup.filter((r) => r.status === "skipped");
  const aptoParaEntrega = fallidos.length === 0 && dedup.length > 0;

  const W = doc.page.width;
  const H = doc.page.height;
  const M = 50;
  const CW = W - 2 * M;
  let y = M;
  const nuevaPaginaSiHaceFalta = (needed: number = 80): void => {
    if (y + needed > H - 50) { doc.addPage(); y = M; }
  };

  // ─── PORTADA ────────────────────────────────────────────────────────
  doc.rect(0, 0, W, 180).fill(COLOR.marca);
  doc.fillColor("#FFFFFF").fontSize(10).font("Helvetica").text(safe("NEURA QA CENTER"), M, 45);
  doc.fontSize(9).fillColor("rgba(255,255,255,0.7)").text(safe("REPORTE DE EJECUCION AUTOMATIZADA"), M, 60);
  doc.fontSize(22).font("Helvetica-Bold").fillColor("#FFFFFF")
    .text(safe(project?.name ?? "Proyecto QA"), M, 85, { width: CW });
  doc.fontSize(10).font("Helvetica").fillColor("rgba(255,255,255,0.85)")
    .text(
      safe(`Run #${run.id.slice(0, 8)}   -   ${suite?.name ?? "Suite"}   -   ${formatearFecha(run.created_at)}`),
      M, 150, { width: CW }
    );
  y = 210;

  // ─── VEREDICTO ──────────────────────────────────────────────────────
  const vColor = aptoParaEntrega ? COLOR.emerald : fallidos.length > 0 ? COLOR.rose : COLOR.slate;
  const vTexto = aptoParaEntrega
    ? "APTO PARA ENTREGA"
    : fallidos.length > 0
    ? `NO APTO - ${fallidos.length} FALLA${fallidos.length > 1 ? "S" : ""} DETECTADA${fallidos.length > 1 ? "S" : ""}`
    : "SIN DATOS SUFICIENTES";

  doc.rect(M, y, CW, 90).fillAndStroke(COLOR.slateBg, COLOR.slateLine);
  doc.fillColor(COLOR.slate).fontSize(9).font("Helvetica").text("VEREDICTO DE LA EJECUCION", M + 16, y + 14);
  doc.fillColor(vColor).fontSize(18).font("Helvetica-Bold").text(safe(vTexto), M + 16, y + 32);
  doc.fillColor(COLOR.slate).fontSize(10).font("Helvetica")
    .text(safe(`${dedup.length} caso(s) evaluado(s)  -  ${exitosos.length} OK  -  ${fallidos.length} fallas  -  ${omitidos.length} omitidos`), M + 16, y + 62);
  y += 110;

  // ─── DATOS DEL PROYECTO ─────────────────────────────────────────────
  doc.fillColor(COLOR.marca).fontSize(13).font("Helvetica-Bold").text("Datos del proyecto", M, y);
  y += 18;
  doc.rect(M, y, 40, 2).fill(COLOR.marca);
  y += 10;
  const filasDatos: Array<[string, string]> = [
    ["ERP", project?.name ?? "-"],
    ["Repositorio", project?.repo_url ?? "-"],
    ["Entorno probado", run.target_base_url || "-"],
    ["Duracion del run", run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(1)} s` : "-"],
    ["Estado del run", traducirStatus(run.status)],
  ];
  for (const [k, v] of filasDatos) {
    doc.fillColor(COLOR.slate).fontSize(9).font("Helvetica-Bold").text(safe(k), M, y, { width: 110 });
    doc.fillColor(COLOR.slateDeep).fontSize(10).font("Helvetica").text(safe(v), M + 120, y, { width: CW - 120 });
    y += 16;
  }
  y += 10;

  // ─── BUGS DETECTADOS ────────────────────────────────────────────────
  if (fallidos.length > 0) {
    nuevaPaginaSiHaceFalta(60);
    doc.fillColor(COLOR.rose).fontSize(14).font("Helvetica-Bold").text(safe(`Bugs detectados (${fallidos.length})`), M, y);
    y += 20;
    doc.rect(M, y - 2, 50, 2).fill(COLOR.rose);
    y += 10;
    fallidos.forEach((r, idx) => {
      nuevaPaginaSiHaceFalta(140);
      const titulo = safe(r.test_title);
      const detalle = safe(r.error_message ?? "(sin detalle del error)");
      const modulo = safe(inferirModulo(r.spec_file));

      // Barra lateral roja
      doc.rect(M, y, 4, 70).fill(COLOR.rose);
      doc.fillColor(COLOR.slateDeep).fontSize(11).font("Helvetica-Bold")
        .text(safe(`#${idx + 1}  ${titulo}`), M + 14, y, { width: CW - 14 });
      doc.fillColor(COLOR.slate).fontSize(9).font("Helvetica")
        .text(safe(`Modulo: ${modulo}   URL: ${run.target_base_url || "-"}`), M + 14, y + 18, { width: CW - 14 });
      y += 40;

      // Caja del error
      doc.font("Courier").fontSize(9);
      const alturaError = Math.max(50, doc.heightOfString(detalle, { width: CW - 30 }) + 24);
      nuevaPaginaSiHaceFalta(alturaError + 10);
      doc.rect(M, y, CW, alturaError).fillAndStroke("#FEF2F2", "#FECACA");
      doc.fillColor(COLOR.rose).fontSize(8).font("Helvetica-Bold").text("DETALLE PARA EL PROGRAMADOR", M + 14, y + 8);
      doc.fillColor(COLOR.slateDeep).fontSize(9).font("Courier").text(detalle, M + 14, y + 22, { width: CW - 30 });
      y += alturaError + 14;
    });
    y += 10;
  }

  // ─── PRUEBAS EXITOSAS (resumen) ─────────────────────────────────────
  if (exitosos.length > 0) {
    nuevaPaginaSiHaceFalta(60);
    doc.fillColor(COLOR.emerald).fontSize(13).font("Helvetica-Bold").text(safe(`Pruebas exitosas (${exitosos.length})`), M, y);
    y += 20;
    doc.rect(M, y - 2, 50, 2).fill(COLOR.emerald);
    y += 10;
    for (const r of exitosos) {
      nuevaPaginaSiHaceFalta(16);
      doc.fillColor(COLOR.emerald).fontSize(9).font("Helvetica-Bold").text("[OK]", M, y);
      doc.fillColor(COLOR.slateDeep).fontSize(9).font("Helvetica").text(safe(r.test_title), M + 30, y, { width: CW - 30 });
      y += 13;
    }
    y += 10;
  }

  // ─── CONCLUSION ─────────────────────────────────────────────────────
  nuevaPaginaSiHaceFalta(140);
  doc.fillColor(COLOR.marca).fontSize(13).font("Helvetica-Bold").text("Conclusion", M, y);
  y += 20;
  doc.rect(M, y - 2, 40, 2).fill(COLOR.marca);
  y += 10;
  const conclusionTexto = aptoParaEntrega
    ? "Todas las verificaciones ejecutadas por el agente QA concluyeron sin hallazgos. El ERP puede avanzar al proceso de entrega."
    : fallidos.length > 0
    ? `Se detectaron ${fallidos.length} hallazgo(s) que requieren correccion antes de entregar al cliente. Revisa la seccion "Bugs detectados" con el detalle tecnico de cada error.`
    : "El agente QA no pudo completar las verificaciones minimas. Revisa la ejecucion y reintenta antes de evaluar la aptitud para entrega.";
  doc.fillColor(COLOR.slateDeep).fontSize(11).font("Helvetica")
    .text(safe(conclusionTexto), M, y, { width: CW, align: "justify", lineGap: 3 });
  y += 60;

  // ─── FOOTER ─────────────────────────────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fillColor(COLOR.slateMuted).fontSize(8).font("Helvetica")
      .text(
        safe(`NEURA QA Center  -  Run ${run.id.slice(0, 8)}  -  Pagina ${i - range.start + 1} de ${range.count}`),
        M, H - 35, { width: CW, align: "center" }
      );
  }

  doc.end();
  return done;
}

function seccion(doc: InstanceType<typeof PDFDocument>, titulo: string, color: string = COLOR.marca): void {
  doc.y += 8;
  doc.fillColor(color).fontSize(13).font("Helvetica-Bold").text(titulo, 50, doc.y);
  doc.y += 3;
  doc.rect(50, doc.y, 40, 2).fill(color);
  doc.fillColor(COLOR.slateDeep);
  doc.y += 10;
}

function filaDato(doc: InstanceType<typeof PDFDocument>, label: string, valor: string): void {
  doc.fillColor(COLOR.slate).fontSize(9).font("Helvetica-Bold").text(label, 50, doc.y, { width: 120, continued: false });
  doc.fillColor(COLOR.slateDeep).fontSize(10).font("Helvetica").text(valor, 175, doc.y - 12, { width: doc.page.width - 225 });
  doc.y += 6;
}

function estimarAlturaError(doc: InstanceType<typeof PDFDocument>, r: ResultLike): number {
  const ancho = doc.page.width - 124;
  doc.fontSize(10).font("Courier");
  const altura = doc.heightOfString(r.error_message ?? "(sin detalle del error)", { width: ancho });
  return Math.max(60, altura + 36);
}

function inferirModulo(specFile: string): string {
  const m = specFile.match(/^ai-direct\/(.+)\.spec\.ts$/);
  if (m) return m[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const m2 = specFile.match(/^erp-neura-(.+?)\.spec\.ts$/);
  if (m2) return m2[1];
  return specFile.replace(/\.spec\.ts$/, "");
}

function traducirStatus(s: string): string {
  const map: Record<string, string> = {
    passed: "Exitoso",
    failed: "Con fallas",
    aborted: "Abortado",
    error: "Error del runner",
    running: "En ejecución",
    queued: "En cola",
  };
  return map[s] ?? s;
}

function formatearFecha(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-PY", {
      day: "2-digit", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
