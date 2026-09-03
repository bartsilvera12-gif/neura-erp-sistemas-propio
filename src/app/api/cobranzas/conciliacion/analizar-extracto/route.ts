import { NextRequest, NextResponse } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireCobranzasApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { listCobrosPendientes } from "@/lib/cobranzas/conciliacion-pg";
import { extraerTransacciones, conciliar, type AprobadoLite } from "@/lib/cobranzas/extracto-conciliacion";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const EXT_OK = /\.(pdf|xlsx|xls|csv)$/i;

/**
 * POST /api/cobranzas/conciliacion/analizar-extracto
 * multipart: file (PDF del extracto) + mes (YYYY-MM, opcional; default: todas las aprobadas)
 * Lee el PDF con IA, extrae las transacciones y las cruza contra las transferencias APROBADAS
 * del mes. Solo lectura: no crea ni modifica nada.
 */
export async function POST(request: NextRequest) {
  const auth = await requireCobranzasApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const form = await request.formData();
    const file = form.get("file");
    const mes = String(form.get("mes") ?? "").trim();
    // DEBUG temporal: qué llega realmente en la subida.
    console.warn("[analizar-extracto] debug", {
      keys: [...form.keys()],
      fileKind: file === null ? "null" : file instanceof File ? "File" : typeof file,
      fileName: file instanceof File ? file.name : (typeof file === "string" ? `str:${file.slice(0, 40)}` : null),
      fileSize: file instanceof File ? file.size : null,
      contentType: request.headers.get("content-type"),
      contentLength: request.headers.get("content-length"),
    });
    if (mes && !/^\d{4}-\d{2}$/.test(mes)) {
      return NextResponse.json(errorResponse("Mes inválido (YYYY-MM)"), { status: 400 });
    }
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(errorResponse("Subí el extracto (PDF o Excel)"), { status: 400 });
    }
    if (!EXT_OK.test(file.name || "")) {
      return NextResponse.json(errorResponse("El archivo debe ser PDF, Excel (.xlsx/.xls) o CSV"), { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(errorResponse("El archivo supera el límite de 15 MB"), { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());

    // 1) Extraer transacciones del extracto (PDF→IA, Excel→directo con fallback IA).
    let extracto;
    try {
      extracto = await extraerTransacciones(bytes, file.name || "extracto.pdf");
    } catch (e) {
      const raw = e instanceof Error ? e.message : "Error al analizar el PDF";
      const status = (e as { status?: number })?.status;
      const overloaded = status === 529 || /overloaded/i.test(raw);
      console.error("[analizar-extracto] extract", String(status ?? ""), raw.slice(0, 200));
      const msg = overloaded
        ? "El servicio de IA está saturado en este momento. Probá de nuevo en unos segundos."
        : `No se pudo leer el extracto: ${raw}`;
      // 422 (no 5xx): así el proxy no reemplaza el cuerpo y el mensaje llega al usuario.
      return NextResponse.json(errorResponse(msg), { status: 422 });
    }

    // 2) Transferencias APROBADAS (opcionalmente del mes elegido).
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const rows = await listCobrosPendientes(schema, auth.empresaId, { estado: "aprobado" });
    const aprobados: AprobadoLite[] = rows
      .map((r) => ({
        id: String(r.id),
        monto: Math.round(Number(r.monto) || 0),
        fecha: String(r.fecha ?? "").slice(0, 10),
        numero_operacion: r.numero_operacion != null ? String(r.numero_operacion) : null,
        banco_origen: r.banco_origen != null ? String(r.banco_origen) : null,
        titular: r.titular != null ? String(r.titular) : null,
        cliente_nombre: (r as { cliente_nombre?: string | null }).cliente_nombre ?? null,
        numero_factura: (r as { numero_factura?: string | null }).numero_factura ?? null,
      }))
      .filter((a) => (mes ? a.fecha.slice(0, 7) === mes : true));

    // 3) Conciliar.
    const resultado = conciliar(aprobados, extracto);

    return NextResponse.json(
      successResponse({
        mes: mes || null,
        archivo: file.name,
        via: extracto.via,
        ...resultado,
      })
    );
  } catch (e) {
    console.error("[analizar-extracto]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo analizar el extracto."), { status: 500 });
  }
}
