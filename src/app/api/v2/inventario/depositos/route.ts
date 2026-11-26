import { ctxV2, enTransaccion, ErrorV2, esUuid, fallo, ok } from "@/lib/erp2/server";

export const runtime = "nodejs";

/**
 * Crear o editar un depósito (una `inventario_ubicaciones` de Neura). "Principal" = el
 * predeterminado: adonde va lo que se carga sin decir depósito.
 */
export async function POST(request: Request) {
  try {
    const c = await ctxV2(request, "inventario");
    const b = (await request.json().catch(() => ({}))) as {
      id?: string | null;
      nombre?: string;
      descripcion?: string | null;
      es_principal?: boolean;
      activo?: boolean;
    };
    const nombre = String(b.nombre ?? "").trim().slice(0, 80);
    if (!nombre) throw new ErrorV2("Escribí el nombre del depósito");
    const activo = b.activo !== false;
    if (b.es_principal && !activo) throw new ErrorV2("El depósito principal tiene que estar activo");
    const id = await enTransaccion(c.pool, async (t) => {
      let depId: string;
      if (esUuid(b.id)) {
        const { rows } = await t.query(
          `UPDATE neura.inventario_ubicaciones SET nombre = $3, descripcion = $4, activo = $5, updated_at = now()
            WHERE id = $1::uuid AND empresa_id = $2::uuid RETURNING id, es_predeterminado`,
          [b.id, c.empresaId, nombre, b.descripcion?.trim() || null, activo]
        );
        if (!rows[0]) throw new ErrorV2("Depósito no encontrado", 404);
        if (rows[0].es_predeterminado && !activo) {
          throw new ErrorV2("No se puede desactivar el depósito principal: elegí otro como principal antes");
        }
        depId = rows[0].id;
      } else {
        const { rows } = await t.query(
          `INSERT INTO neura.inventario_ubicaciones (empresa_id, nombre, descripcion, tipo, activo)
           VALUES ($1::uuid, $2, $3, 'deposito', $4) RETURNING id`,
          [c.empresaId, nombre, b.descripcion?.trim() || null, activo]
        );
        depId = rows[0].id;
      }
      if (b.es_principal) {
        await t.query(
          `UPDATE neura.inventario_ubicaciones SET es_predeterminado = false WHERE empresa_id = $1::uuid AND es_predeterminado AND id <> $2::uuid`,
          [c.empresaId, depId]
        );
        await t.query(`UPDATE neura.inventario_ubicaciones SET es_predeterminado = true WHERE id = $1::uuid`, [depId]);
      }
      return depId;
    });
    return ok({ id });
  } catch (err) {
    return fallo(err, "POST /inventario/depositos");
  }
}

/**
 * Depósitos con la forma del 2.0 (sucursales → depósitos). Neura no tiene sucursales: va una
 * sola, "Casa central", con todos los depósitos (`inventario_ubicaciones`).
 */
export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, "inventario");
    const { rows } = await c.pool.query(
      `SELECT u.id, u.nombre, u.descripcion, u.es_predeterminado AS es_principal, COALESCE(u.activo, true) AS activo,
              COUNT(s.id) FILTER (WHERE s.stock_actual <> 0)::int AS productos,
              COALESCE(SUM(s.stock_actual), 0)::float AS unidades,
              COALESCE(SUM(s.stock_actual * COALESCE(p.costo_promedio, 0)), 0)::float AS valor
         FROM neura.inventario_ubicaciones u
         LEFT JOIN neura.inventario_stock_ubicacion s ON s.ubicacion_id = u.id AND s.empresa_id = u.empresa_id
         LEFT JOIN neura.productos p ON p.id = s.producto_id
        WHERE u.empresa_id = $1::uuid
        GROUP BY u.id
        ORDER BY u.es_predeterminado DESC, u.nombre`,
      [c.empresaId]
    );
    const { rows: tr } = await c.pool.query(
      `SELECT count(*)::int AS n FROM neura.inventario_traslados WHERE empresa_id = $1::uuid AND estado = 'en_transito'`,
      [c.empresaId]
    );
    const predeterminado = rows.find((r) => r.es_principal)?.id ?? rows[0]?.id ?? null;
    return ok({
      sucursales: [
        {
          id: c.empresaId,
          nombre: "Casa central",
          direccion: null,
          ciudad: null,
          telefono: null,
          establecimiento: "001",
          punto_expedicion: "001",
          es_principal: true,
          activa: true,
          usuarios: 0,
          depositos: rows,
        },
      ],
      usuarios: [],
      mi_sucursal_id: c.empresaId,
      mi_deposito_id: predeterminado,
      es_admin: c.esAdmin,
      traslados_en_transito: tr[0]?.n ?? 0,
      ajustes_pendientes: 0,
    });
  } catch (err) {
    return fallo(err, "GET /inventario/depositos");
  }
}
