import { ErrorV2, fallo } from "@/lib/erp2/server";

export const runtime = "nodejs";

/** Las notas de crédito de Neura se hacen desde Facturas (SIFEN). */
export async function GET() {
  return fallo(new ErrorV2("Las notas de crédito se hacen desde Facturas.", 404), "GET /ventas/[id]/nota-credito");
}
