import { POST as neura } from "@/app/api/inventario/productos/import/commit/route";
import { reenviar } from "@/lib/erp2/reenviar";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return reenviar((r) => neura(r as NextRequest), request);
}
