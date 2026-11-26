import { GET as neura } from "@/app/api/proveedores/export/route";
import { reenviar } from "@/lib/erp2/reenviar";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return reenviar((r) => neura(r as NextRequest), request);
}
