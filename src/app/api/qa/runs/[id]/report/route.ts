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
  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return new Response(JSON.stringify({ error: "id debe ser UUID" }), { status: 400 });
  }

  const sb = await createSupabaseServerClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.email) notFound();
  const decision = await resolveQaAccess(sb, user.email);
  if (!decision.ok) notFound();

  const repo = buildQaRepo();
  if (!repo) {
    return new Response(JSON.stringify({ error: "QA_DB_URL no configurada" }), { status: 500 });
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
}

type RepoNN = NonNullable<ReturnType<typeof buildQaRepo>>;
type RunLike = Awaited<ReturnType<RepoNN["getRun"]>>;
type ResultLike = Awaited<ReturnType<RepoNN["listResultsForRun"]>>[number];
type ProjectLike = Awaited<ReturnType<RepoNN["getProject"]>>;
type SuiteLike = Awaited<ReturnType<RepoNN["getSuite"]>>;

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

  const fallidos = results.filter((r) => r.status === "failed" || r.status === "timed_out");
  const exitosos = results.filter((r) => r.status === "passed");
  const omitidos = results.filter((r) => r.status === "skipped");
  const aptoParaEntrega = fallidos.length === 0 && results.length > 0;

  // ─── Portada ────────────────────────────────────────────────────────
  doc.rect(0, 0, doc.page.width, 160).fill(COLOR.marca);
  doc.fillColor("white").fontSize(10).font("Helvetica")
    .text("NEURA QA CENTER · REPORTE DE EJECUCIÓN", 50, 40);
  doc.fontSize(24).font("Helvetica-Bold")
    .text(project?.name ?? "Proyecto QA", 50, 65, { width: doc.page.width - 100 });
  doc.fontSize(11).font("Helvetica").fillColor("rgba(255,255,255,0.85)")
    .text(
      `Run #${run.id.slice(0, 8)}  ·  ${suite?.name ?? "Suite"}  ·  ${formatearFecha(run.created_at)}`,
      50,
      doc.y + 4,
      { width: doc.page.width - 100 }
    );
  doc.fillColor(COLOR.slateDeep);
  doc.y = 190;

  // ─── Veredicto global ───────────────────────────────────────────────
  const veredictoColor = aptoParaEntrega ? COLOR.emerald : fallidos.length > 0 ? COLOR.rose : COLOR.slate;
  const veredictoTexto = aptoParaEntrega
    ? "APTO PARA ENTREGA"
    : fallidos.length > 0
    ? "NO APTO · HAY FALLAS"
    : "SIN DATOS SUFICIENTES";

  doc.rect(50, doc.y, doc.page.width - 100, 70).fillAndStroke(COLOR.slateBg, COLOR.slateLine);
  doc.fillColor(COLOR.slate).fontSize(10).font("Helvetica")
    .text("Veredicto de la ejecución", 65, doc.y - 55);
  doc.fillColor(veredictoColor).fontSize(20).font("Helvetica-Bold")
    .text(veredictoTexto, 65, doc.y - 40);
  doc.fillColor(COLOR.slate).fontSize(10).font("Helvetica")
    .text(
      `${results.length} caso(s) evaluado(s) · ${exitosos.length} OK · ${fallidos.length} con fallas · ${omitidos.length} omitido(s)`,
      65,
      doc.y - 18
    );
  doc.y += 20;

  // ─── Datos del proyecto ─────────────────────────────────────────────
  seccion(doc, "Datos del proyecto");
  filaDato(doc, "ERP", project?.name ?? "—");
  filaDato(doc, "Repositorio", project?.repo_url ?? "—");
  filaDato(doc, "Entorno probado", run.target_base_url || "—");
  filaDato(doc, "Duración del run", run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(1)} s` : "—");
  filaDato(doc, "Estado del run", traducirStatus(run.status));
  doc.y += 10;

  // ─── Pruebas fallidas (lo más importante) ───────────────────────────
  if (fallidos.length > 0) {
    seccion(doc, `Pruebas fallidas (${fallidos.length})`, COLOR.rose);
    fallidos.forEach((r, idx) => {
      if (doc.y > doc.page.height - 180) doc.addPage();
      const modulo = inferirModulo(r.spec_file);
      doc.rect(50, doc.y, doc.page.width - 100, 4).fill(COLOR.rose);
      doc.y += 6;
      doc.fillColor(COLOR.slateDeep).fontSize(11).font("Helvetica-Bold")
        .text(`${idx + 1}. ${r.test_title}`, 50, doc.y, { width: doc.page.width - 100 });
      doc.y += 4;
      doc.fillColor(COLOR.slate).fontSize(9).font("Helvetica")
        .text(`Módulo: ${modulo}  ·  Caso: ${r.spec_file}`, 50, doc.y);
      doc.y += 12;

      // Cuadro del error
      const errorY = doc.y;
      const errorAltura = estimarAlturaError(doc, r);
      doc.rect(50, errorY, doc.page.width - 100, errorAltura).fillAndStroke("#FEF2F2", "#FECACA");
      doc.fillColor(COLOR.rose).fontSize(9).font("Helvetica-Bold")
        .text(`[${(r.error_type ?? "ERROR").toUpperCase()}]`, 62, errorY + 10);
      doc.fillColor(COLOR.slateDeep).fontSize(10).font("Courier")
        .text(r.error_message ?? "(sin detalle del error)", 62, errorY + 26, {
          width: doc.page.width - 124,
          align: "left",
        });
      doc.y = errorY + errorAltura + 14;
    });
  } else {
    seccion(doc, "Pruebas fallidas", COLOR.emerald);
    doc.fillColor(COLOR.emerald).fontSize(11).font("Helvetica-Bold")
      .text("✓  Ninguna prueba falló.", 50, doc.y);
    doc.y += 24;
  }

  // ─── Pruebas exitosas (resumen breve) ───────────────────────────────
  if (exitosos.length > 0) {
    if (doc.y > doc.page.height - 120) doc.addPage();
    seccion(doc, `Pruebas exitosas (${exitosos.length})`, COLOR.emerald);
    exitosos.forEach((r) => {
      if (doc.y > doc.page.height - 50) doc.addPage();
      const modulo = inferirModulo(r.spec_file);
      doc.fillColor(COLOR.emerald).fontSize(10).font("Helvetica-Bold").text("✓", 50, doc.y, { continued: true });
      doc.fillColor(COLOR.slateDeep).fontSize(10).font("Helvetica")
        .text(`  ${r.test_title}`, { continued: true });
      doc.fillColor(COLOR.slateMuted).fontSize(9).font("Helvetica").text(`  ·  ${modulo}`);
      doc.y += 2;
    });
  }

  // ─── Conclusión final ───────────────────────────────────────────────
  if (doc.y > doc.page.height - 160) doc.addPage();
  doc.y += 16;
  seccion(doc, "Conclusión");
  const conclusionTexto = aptoParaEntrega
    ? "Todas las verificaciones ejecutadas por el agente QA concluyeron sin hallazgos. El ERP puede avanzar al proceso de entrega."
    : fallidos.length > 0
    ? `Se detectaron ${fallidos.length} hallazgo(s) que requieren corrección antes de entregar al cliente. Revisá la sección "Pruebas fallidas" con el detalle técnico de cada error para asignarlos a desarrollo.`
    : "El agente QA no pudo completar las verificaciones mínimas. Revisá la ejecución y reintentá antes de evaluar la aptitud para entrega.";
  doc.fillColor(COLOR.slateDeep).fontSize(11).font("Helvetica")
    .text(conclusionTexto, 50, doc.y, { width: doc.page.width - 100, align: "justify", lineGap: 3 });

  if (run.summary) {
    doc.y += 14;
    doc.fillColor(COLOR.slate).fontSize(9).font("Helvetica-Oblique")
      .text(`Resumen del agente: ${run.summary}`, 50, doc.y, { width: doc.page.width - 100, lineGap: 2 });
  }

  // ─── Footer con paginación ──────────────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fillColor(COLOR.slateMuted).fontSize(8).font("Helvetica")
      .text(
        `Página ${i - range.start + 1} de ${range.count}  ·  Generado automáticamente por NEURA QA Center`,
        50, doc.page.height - 30,
        { width: doc.page.width - 100, align: "center" }
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
