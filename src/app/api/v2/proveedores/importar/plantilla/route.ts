import { GET as neura } from "@/app/api/proveedores/import/template/route";
import { reenviar } from "@/lib/erp2/reenviar";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return reenviar(() => neura(), request);
}
