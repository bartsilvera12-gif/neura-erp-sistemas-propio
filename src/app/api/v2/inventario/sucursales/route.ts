import { NextResponse } from "next/server";

/** Neura trabaja con una sola sucursal ("Casa central"): no se crean ni editan sucursales. */
export async function POST() {
  return NextResponse.json(
    { ok: false, error: { message: "Neura trabaja con una sola sucursal: creá depósitos dentro de Casa central." } },
    { status: 400 }
  );
}
