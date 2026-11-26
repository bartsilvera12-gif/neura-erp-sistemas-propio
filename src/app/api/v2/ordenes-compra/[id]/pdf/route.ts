import { NextResponse } from "next/server";

/** Los PDF del 2.0 (orden de pago, estado de cuenta) todavía no están en Neura. */
export async function GET() {
  return NextResponse.json({ ok: false, error: { message: "Este PDF todavía no está disponible en Neura." } }, { status: 400 });
}
