import "server-only";
import { monto, texto, UUID } from "@/lib/propuestas/auth";
import type { PiezaEnPropuesta } from "@/lib/propuestas/tipos";

export const CAMPOS_PROPUESTA =
  "id, numero, cliente_id, cliente_nombre, titulo, bajada, piezas, inversion_total, cuota_mensual, condiciones, clientes_bandera, created_at, updated_at";

/** Limpia lo que manda el formulario de una propuesta. */
export function datosDePropuesta(body: Record<string, unknown>) {
  const piezas: PiezaEnPropuesta[] = Array.isArray(body.piezas)
    ? (body.piezas as unknown[]).slice(0, 60).flatMap((p) => {
        const o = (p ?? {}) as Record<string, unknown>;
        const titulo = texto(o.titulo, 120);
        if (!titulo) return [];
        const pid = typeof o.pieza_id === "string" && UUID.test(o.pieza_id) ? o.pieza_id : null;
        return [{ pieza_id: pid, titulo, descripcion: texto(o.descripcion, 300) }];
      })
    : [];
  return {
    cliente_id: typeof body.cliente_id === "string" && UUID.test(body.cliente_id) ? body.cliente_id : null,
    cliente_nombre: texto(body.cliente_nombre, 160),
    titulo: texto(body.titulo, 160),
    bajada: texto(body.bajada, 300),
    piezas,
    inversion_total: monto(body.inversion_total),
    cuota_mensual: monto(body.cuota_mensual),
    condiciones: texto(body.condiciones, 800),
    clientes_bandera: Array.isArray(body.clientes_bandera)
      ? [...new Set((body.clientes_bandera as unknown[]).map((n) => texto(n, 60)).filter(Boolean))].slice(0, 12)
      : [],
  };
}
