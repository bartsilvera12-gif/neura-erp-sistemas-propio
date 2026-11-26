import { GET as exportarNeura } from "@/app/api/inventario/productos/export/route";
import { reenviar } from "@/lib/erp2/reenviar";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return reenviar((r) => exportarNeura(r as NextRequest), request);
}
