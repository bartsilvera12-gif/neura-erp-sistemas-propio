/**
 * Configuración de facturación (receta 61): tipos y etiquetas compartidos entre las
 * pantallas (Configuración › Facturación / Facturación electrónica), la caja y las rutas.
 * Sin dependencias de servidor.
 */
import type { ConfigComanda, ConfigTicketVenta } from "./tickets";

export type ModoFacturacion = "sin_factura_fiscal" | "sifen" | "autoimpresor";
export type TipoImpresion = "pdf_a4" | "pdf_media_hoja" | "ticket_80mm" | "ticket_58mm";

export const MODOS: { key: ModoFacturacion; titulo: string; resumen: string }[] = [
  { key: "sin_factura_fiscal", titulo: "Sin factura fiscal", resumen: "Solo registra ventas internas. Sin documento fiscal." },
  { key: "sifen", titulo: "Facturación electrónica SIFEN", resumen: "Emite Documentos Electrónicos a través del Set/SIFEN." },
  { key: "autoimpresor", titulo: "Autoimpresor / factura impresa", resumen: "Emite factura impresa con timbrado autorizado (PDF o ticket térmico)." },
];

export const IMPRESIONES: [TipoImpresion, string][] = [
  ["pdf_a4", "PDF A4"],
  ["pdf_media_hoja", "PDF media hoja"],
  ["ticket_80mm", "Ticket térmico 80 mm"],
  ["ticket_58mm", "Ticket térmico 58 mm"],
];
export const etiquetaImpresion = (t: TipoImpresion) => IMPRESIONES.find(([k]) => k === t)?.[1] ?? t;
export const esTicket = (t: TipoImpresion) => t === "ticket_80mm" || t === "ticket_58mm";
/** Ancho del ticket que imprime la caja hoy (los PDF A4 / media hoja todavía salen en 80 mm). */
export const anchoTicket = (t: TipoImpresion | undefined) => (t === "ticket_58mm" ? 58 : 80);

export type Autoimpresor = {
  guardado: boolean;
  activo: boolean;
  ruc_emisor: string | null;
  razon_social_emisor: string | null;
  nombre_fantasia: string | null;
  direccion_matriz: string | null;
  telefono: string | null;
  timbrado_numero: string | null;
  timbrado_inicio_vigencia: string | null;
  timbrado_fin_vigencia: string | null;
  establecimiento_codigo: string | null;
  punto_expedicion_codigo: string | null;
  numero_actual: number | null;
  /** Receta 101: próximo número de nota de crédito. */
  nc_numero_actual: number | null;
  numero_inicial: number | null;
  numero_final: number | null;
  tipo_documento_default: string;
  formato_impresion_default: TipoImpresion;
  leyenda_papel_termico: string | null;
  observaciones: string | null;
};

export type ConfigFacturacion = {
  modo: ModoFacturacion;
  impresion_tipo_default: TipoImpresion;
  preguntar_datos_al_confirmar: boolean;
  prefijo_factura: string;
  numeracion_inicial: number;
  dias_vencimiento_default: number;
  interes_moratorio: number;
  gestion_tributaria_clientes: boolean;
  /** Receta 67: cómo figura el "Cliente ocasional" en la factura (default "X" / "X"). */
  ocasional_nombre: string;
  ocasional_ruc: string;
  /** Tope (Gs.) para facturar a cliente ocasional; null = sin tope. Por encima, solo ticket. */
  ocasional_tope: number | null;
  /** Receta 71: ticket de venta y comanda de cocina (lo guardado + defaults). */
  ticket_venta: ConfigTicketVenta;
  ticket_comanda: ConfigComanda;
  updated_at: string | null;
  updated_by_nombre: string | null;
  proximo_numero: string;
  ultimo_numero: string | null;
  sifen: { configurada: boolean; activo: boolean; ambiente: "test" | "produccion" | null; completa: boolean };
  autoimpresor: Autoimpresor;
  puede_editar: boolean;
};

/**
 * Receptor "Cliente ocasional (X)" en el Documento Electrónico (SIFEN, Manual Técnico v150):
 * todavía no se arma el XML; cuando se arme, una venta con `receptor_ocasional` va como
 * receptor innominado B2C (no se informa el "X" de la factura impresa).
 */
export const RECEPTOR_INNOMINADO_SIFEN = {
  iNatRec: 2, // no contribuyente
  iTiOpe: 2, // B2C
  iTiDocRec: 5, // Innominado
  iTipIDRec: 5,
  dDTipIDRec: "Innominado",
  dNumIDRec: "0",
  dNomRec: "Sin Nombre",
} as const;

export type AmbienteSifen = "test" | "produccion";

export type SifenConfig = {
  ambiente: AmbienteSifen;
  activo: boolean;
  ruc: string;
  razon_social: string;
  direccion_fiscal: string | null;
  timbrado_numero: string;
  timbrado_fecha_inicio_vigencia: string | null;
  actividad_economica_codigo: string | null;
  actividad_economica_descripcion: string | null;
  establecimiento: string;
  punto_expedicion: string;
  csc_id: string | null;
  plazo_cancelacion_horas: number;
  certificado_nombre: string | null;
  certificado_titular: string | null;
  certificado_vencimiento: string | null;
  certificado_subido_at: string | null;
  kude_color_primario: string | null;
  kude_color_primario_fill: string | null;
  kude_logo_subido_at: string | null;
  updated_at: string | null;
  updated_by_nombre: string | null;
};

export type SifenLectura = {
  config: SifenConfig | null;
  /** Solo si están cargados: el contenido nunca sale de la base / del servidor. */
  secretos: { certificado: boolean; certificado_bytes: number; password: boolean; csc: boolean; kude_logo: boolean };
  empresa: {
    razon_social: string | null; nombre_fantasia: string | null; ruc: string | null;
    actividad_economica: string | null; direccion: string | null; ciudad: string | null;
  };
  puede_editar: boolean;
};

/** Config "completa" (mismo criterio que el original): datos + activo + .p12 + contraseña. */
export function sifenCompleta(d: SifenLectura): boolean {
  const c = d.config;
  if (!c) return false;
  const datos = [c.ruc, c.razon_social, c.direccion_fiscal, c.timbrado_numero, c.timbrado_fecha_inicio_vigencia,
    c.actividad_economica_codigo, c.actividad_economica_descripcion, c.establecimiento, c.punto_expedicion]
    .every((v) => Boolean(String(v ?? "").trim()));
  return datos && c.activo && d.secretos.certificado && d.secretos.password;
}

/** Vista previa de la numeración: prefijo + 6 dígitos. */
export function numeroFactura(prefijo: string, n: number): string {
  const s = String(Math.max(1, Math.floor(n) || 1));
  return `${prefijo}${s.length >= 6 ? s : s.padStart(6, "0")}`;
}

// ── Perfil tributario de clientes ───────────────────────────────────────────
export type ObligacionCatalogo = { slug: string; nombre: string; requiere_detalle_otro: boolean };
export type PerfilTributario = {
  perfil_activo: boolean;
  dv: string | null;
  razon_social_fiscal: string | null;
  dia_vencimiento_tributario: number | null;
  honorario_mensual: number | null;
  honorario_anual: number | null;
  notas_tributarias: string | null;
  obligacion_otro_detalle: string | null;
  obligaciones: string[];
  clave_tributaria_configurada: boolean;
  updated_at: string | null;
  updated_by_nombre: string | null;
};
export type PerfilTributarioLectura = {
  gestion_tributaria_clientes: boolean;
  puede_editar: boolean;
  catalogo: ObligacionCatalogo[];
  perfil: PerfilTributario | null;
};
