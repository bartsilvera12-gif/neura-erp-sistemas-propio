import { ctxV2, fallo, ok } from "@/lib/erp2/server";

export const runtime = "nodejs";

/**
 * El usuario como lo espera una pantalla del 2.0: perfil con permisos (sacados de los módulos de
 * Neura) y funciones de la empresa (todo lo gastronómico apagado).
 */
export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, null);
    const permisos: string[] = [];
    // Los permisos del 2.0 salen de los módulos que la persona tiene en Neura.
    if (c.modulos.has("inventario")) {
      permisos.push("editar_productos", "ver_costos", "ajustes_inventario", "registrar_perdidas", "aprobar_perdidas", "crear_traslados", "recibir_traslados", "exportar");
    }
    if (c.modulos.has("compras")) permisos.push("registrar_compras", "anular_compras", "pagar_proveedores", "ver_costos", "exportar");
    if (c.modulos.has("ventas")) permisos.push("abrir_cerrar_caja", "movimientos_caja", "vender_credito", "registrar_cobros");
    if (c.esAdmin) permisos.push("configuracion", "anular_ventas", "notas_credito", "ver_cierres_caja", "ver_reportes_financieros");
    return ok({
      usuarioId: c.usuarioId,
      empresaId: c.empresaId,
      // En las pantallas del 2.0 "ADMIN" es quien administra el módulo. En Neura eso lo da tener
      // Inventario habilitado (igual que antes: Categorías y Depósitos los editaba quien tenía el módulo).
      rol: c.esAdmin || c.modulos.has("inventario") ? "ADMIN" : "VENDEDOR",
      nombre: c.nombre,
      email: c.email,
      sucursalId: null,
      perfil: {
        id: null,
        nombre: c.esAdmin ? "Administrador" : null,
        codigo: null,
        todo: c.esAdmin,
        alcance: "todas",
        tope_descuento_pct: null,
        pantallas: [],
        permisos: [...new Set(permisos)],
      },
      funciones: {
        mesas: false,
        cocina: false,
        recetas: false,
        pedidos: false,
        sorteos: false,
        inmobiliaria: false,
        gimnasio: false,
        comedor: false,
        ocultas: true,
        modulos_apagados: [],
      },
    });
  } catch (err) {
    return fallo(err, "GET /me");
  }
}
