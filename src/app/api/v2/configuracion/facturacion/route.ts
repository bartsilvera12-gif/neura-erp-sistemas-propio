import { ctxV2, fallo, ok } from "@/lib/erp2/server";

export const runtime = "nodejs";

/**
 * Lo que la caja del 2.0 lee de "Tickets y facturación". En Neura la factura es la de siempre
 * (SIFEN desde Facturas); no hay ticket impreso; el "cliente ocasional" no se factura (tope 0).
 */
export async function GET(request: Request) {
  try {
    await ctxV2(request, "ventas");
    return ok({
      modo: "sifen",
      impresion_tipo_default: "pdf_a4",
      preguntar_datos_al_confirmar: false,
      prefijo_factura: process.env.FACTURA_PREFIJO ?? "FAC-",
      numeracion_inicial: 1,
      dias_vencimiento_default: Number(process.env.FACTURA_DIAS_CREDITO_DEFAULT ?? 30) || 30,
      interes_moratorio: 0,
      gestion_tributaria_clientes: false,
      ocasional_nombre: "X",
      ocasional_ruc: "X",
      ocasional_tope: 0,
      ticket_venta: { imprimir_al_cobrar: false, ancho_mm: 80 },
      ticket_comanda: {},
      updated_at: null,
      updated_by_nombre: null,
      proximo_numero: "",
      ultimo_numero: null,
      sifen: { configurada: true, activo: true, ambiente: "produccion", completa: true },
      autoimpresor: { guardado: false, activo: false },
      puede_editar: false,
    });
  } catch (err) {
    return fallo(err, "GET /configuracion/facturacion");
  }
}
