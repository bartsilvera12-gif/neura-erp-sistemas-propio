import { NextResponse } from "next/server";

/** Neura trabaja con una sola sucursal: todos los usuarios están en Casa central. */
export async function POST() {
  return NextResponse.json(
    { ok: false, error: { message: "Neura trabaja con una sola sucursal: todos los usuarios están en Casa central." } },
    { status: 400 }
  );
}
