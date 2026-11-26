import { NextResponse } from "next/server";

/** La nota de remisión en PDF todavía no está en Neura (el traslado se ve completo en su detalle). */
export async function GET() {
  return NextResponse.json(
    { ok: false, error: { message: "La nota de remisión en PDF todavía no está disponible en Neura." } },
    { status: 400 }
  );
}
