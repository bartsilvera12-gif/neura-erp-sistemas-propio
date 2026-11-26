import { ok } from "@/lib/erp2/server";

/** Neura no usa cocina por estaciones: lista vacía (la pantalla del 2.0 la pide igual). */
export async function GET() {
  return ok({ estaciones: [] });
}
