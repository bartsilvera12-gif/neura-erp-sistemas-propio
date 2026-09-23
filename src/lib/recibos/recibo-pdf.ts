/**
 * Recibo de dinero — PDF (pdf-lib, Vercel-safe).
 *
 * Comprobante de que la empresa RECIBIÓ un pago (una fila `pagos` ya confirmada,
 * incluye pagos parciales). No es un documento fiscal SIFEN: es el recibo interno
 * de cobro. Reusa la estética del KuDE (acento configurable + logo por empresa).
 */
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFImage, type PDFPage, type PDFFont, type RGB } from "pdf-lib";
import { montoEnLetras } from "./monto-en-letras";
import { formatReciboNro } from "./recibo-format";

const A4_W = 595.28;
const A4_H = 841.89;
const NEURA_BLUE: RGB = rgb(14 / 255, 165 / 255, 233 / 255);
const NEURA_BLUE_FILL: RGB = rgb(0.93, 0.97, 1);
const BLACK: RGB = rgb(0, 0, 0);
const GRAY: RGB = rgb(0.35, 0.35, 0.35);

export type ReciboBranding = {
  logoBytes?: Uint8Array | null;
  colorPrimario?: string | null;
  colorPrimarioFill?: string | null;
};

export type BuildReciboPdfInput = {
  reciboNro: number | null;
  emisor: { nombre: string; ruc: string | null };
  cliente: { nombre: string; doc: string | null };
  pago: {
    monto: number;
    moneda: "GS" | "USD";
    fecha: string; // YYYY-MM-DD
    metodo: string; // efectivo | transferencia | ...
    referencia: string | null;
  };
  factura: {
    numero: string;
    tipo: string | null;
    total: number;
    saldoRestante: number;
  };
  branding?: ReciboBranding | null;
  emitidoAt?: string | null; // ISO
};

const METODO_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia bancaria",
  cheque: "Cheque",
  tarjeta: "Tarjeta",
  otro: "Otro",
};

const TIPO_LABEL: Record<string, string> = {
  contado: "venta al contado",
  credito: "venta a crédito",
  suscripcion: "suscripción",
};

function parseHexColorToRgb(hex: string | null | undefined): RGB | null {
  if (hex == null) return null;
  const s = String(hex).trim();
  const m6 = /^#([0-9a-fA-F]{6})$/.exec(s);
  if (m6) {
    const h = m6[1]!;
    return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
  }
  return null;
}

function blendWithWhite(c: RGB, mix = 0.92): RGB {
  return rgb(c.red * (1 - mix) + mix, c.green * (1 - mix) + mix, c.blue * (1 - mix) + mix);
}

function formatMonto(n: number, moneda: "GS" | "USD"): string {
  const v = Number(n) || 0;
  if (moneda === "USD") return v.toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return Math.round(v).toLocaleString("es-PY");
}

function simbolo(moneda: "GS" | "USD"): string {
  return moneda === "USD" ? "US$" : "Gs.";
}

function formatFechaYmd(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd));
  if (!m) return String(ymd);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function readLogoBytes(): Uint8Array | null {
  const p = path.join(process.cwd(), "public", "logo-neura.png");
  try {
    if (fs.existsSync(p)) return new Uint8Array(fs.readFileSync(p));
  } catch {
    /* ignore */
  }
  return null;
}

function baseline(page: PDFPage, fromTop: number): number {
  return page.getHeight() - fromTop;
}

function drawRectFromTop(
  page: PDFPage,
  left: number,
  fromTop: number,
  width: number,
  height: number,
  opts: { border?: RGB; borderW?: number; fill?: RGB }
) {
  page.drawRectangle({
    x: left,
    y: page.getHeight() - (fromTop + height),
    width,
    height,
    borderColor: opts.border,
    borderWidth: opts.border ? (opts.borderW ?? 0.75) : 0,
    color: opts.fill,
  });
}

function drawTextRight(page: PDFPage, text: string, rightX: number, fromTop: number, size: number, font: PDFFont, color: RGB) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: rightX - w, y: baseline(page, fromTop), size, font, color });
}

function wrapByChars(text: string, maxChars: number): string[] {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= maxChars) return [t];
  const out: string[] = [];
  let rest = t;
  while (rest.length > 0) {
    if (rest.length <= maxChars) {
      out.push(rest);
      break;
    }
    let cut = rest.lastIndexOf(" ", maxChars);
    if (cut < maxChars * 0.5) cut = maxChars;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return out.filter(Boolean);
}

export async function buildReciboPdfBuffer(input: BuildReciboPdfInput): Promise<Buffer> {
  const { reciboNro, emisor, cliente, pago, factura, branding, emitidoAt } = input;

  const primaryConfig = parseHexColorToRgb(branding?.colorPrimario ?? null);
  const primary: RGB = primaryConfig ?? NEURA_BLUE;
  const primaryFillConfig = parseHexColorToRgb(branding?.colorPrimarioFill ?? null);
  const primaryFill: RGB = primaryFillConfig ?? (primaryConfig ? blendWithWhite(primaryConfig, 0.92) : NEURA_BLUE_FILL);

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Recibo ${formatReciboNro(reciboNro)}`);
  pdfDoc.setAuthor("Neura ERP");

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 42;
  const innerW = A4_W - margin * 2;
  const rightEdge = margin + innerW - 12;
  const page = pdfDoc.addPage([A4_W, A4_H]);

  let cursorTop = margin;

  /* ── Header: logo + emisor (izq) / título recibo (der) ── */
  const headerPad = 14;
  const headerH = 84;
  drawRectFromTop(page, margin, cursorTop, innerW, headerH, { fill: rgb(1, 1, 1), border: primary });

  let logoImg: PDFImage | null = null;
  let logoW = 0;
  let logoH = 0;
  const candidates: Uint8Array[] = [];
  if (branding?.logoBytes && branding.logoBytes.length > 0) candidates.push(branding.logoBytes);
  const fallbackLogo = readLogoBytes();
  if (fallbackLogo) candidates.push(fallbackLogo);
  for (const bytes of candidates) {
    try {
      logoImg = await pdfDoc.embedPng(bytes);
      logoW = 84;
      logoH = logoImg.height * (logoW / logoImg.width);
      if (logoH > 52) {
        logoH = 52;
        logoW = logoImg.width * (logoH / logoImg.height);
      }
      break;
    } catch {
      logoImg = null;
      logoW = 0;
      logoH = 0;
    }
  }

  if (logoImg && logoW > 0) {
    page.drawImage(logoImg, {
      x: margin + headerPad,
      y: baseline(page, cursorTop + headerPad + logoH),
      width: logoW,
      height: logoH,
    });
  }

  const emisorX = margin + headerPad + (logoW > 0 ? logoW + 12 : 0);
  let emisorY = cursorTop + headerPad + 10;
  page.drawText(emisor.nombre || "Neura", { x: emisorX, y: baseline(page, emisorY), size: 11, font: fontBold, color: BLACK });
  emisorY += 14;
  if (emisor.ruc) {
    page.drawText(`RUC: ${emisor.ruc}`, { x: emisorX, y: baseline(page, emisorY), size: 8.5, font, color: GRAY });
    emisorY += 12;
  }

  // Título a la derecha
  drawTextRight(page, "RECIBO DE DINERO", rightEdge, cursorTop + headerPad + 11, 13, fontBold, primary);
  drawTextRight(page, `N° ${formatReciboNro(reciboNro)}`, rightEdge, cursorTop + headerPad + 28, 12, fontBold, BLACK);
  drawTextRight(page, `Fecha: ${formatFechaYmd(pago.fecha)}`, rightEdge, cursorTop + headerPad + 43, 9, font, BLACK);

  cursorTop += headerH + 20;

  /* ── Cuerpo: "Recibí de" ── */
  const labelColor = primary;
  const lineGap = 20;

  const drawCampo = (label: string, value: string, valueBold = false) => {
    page.drawText(label, { x: margin, y: baseline(page, cursorTop), size: 9, font: fontBold, color: labelColor });
    const lx = margin + fontBold.widthOfTextAtSize(label, 9) + 6;
    const maxChars = Math.max(30, Math.floor((rightEdge - lx) / 5.0));
    const lines = wrapByChars(value || "—", maxChars);
    page.drawText(lines[0] ?? "—", {
      x: lx,
      y: baseline(page, cursorTop),
      size: 10,
      font: valueBold ? fontBold : font,
      color: BLACK,
    });
    for (let i = 1; i < lines.length; i++) {
      cursorTop += 12;
      page.drawText(lines[i]!, { x: lx, y: baseline(page, cursorTop), size: 10, font: valueBold ? fontBold : font, color: BLACK });
    }
    cursorTop += lineGap;
  };

  drawCampo("Recibí de:", cliente.nombre + (cliente.doc ? `   (RUC/CI: ${cliente.doc})` : ""), true);

  /* Monto destacado */
  const montoBoxH = 52;
  drawRectFromTop(page, margin, cursorTop, innerW, montoBoxH, { fill: primaryFill, border: primary });
  page.drawText("La cantidad de:", { x: margin + 12, y: baseline(page, cursorTop + 16), size: 8.5, font: fontBold, color: primary });
  page.drawText(`${simbolo(pago.moneda)} ${formatMonto(pago.monto, pago.moneda)}`, {
    x: margin + 12,
    y: baseline(page, cursorTop + 38),
    size: 18,
    font: fontBold,
    color: BLACK,
  });
  const enLetras = montoEnLetras(pago.monto, pago.moneda);
  for (const [i, ln] of wrapByChars(`(${enLetras})`, 46).entries()) {
    drawTextRight(page, ln, rightEdge, cursorTop + 20 + i * 12, 8.5, font, GRAY);
  }
  cursorTop += montoBoxH + 20;

  /* Concepto */
  const tipoTxt = factura.tipo ? TIPO_LABEL[factura.tipo] ?? factura.tipo : null;
  const conceptoTotal = Number(factura.saldoRestante) <= 0 ? "Cancelación total" : "Pago parcial";
  const concepto =
    `${conceptoTotal} de la factura N° ${factura.numero}` + (tipoTxt ? ` (${tipoTxt})` : "") + ".";
  drawCampo("En concepto de:", concepto);

  drawCampo("Forma de pago:", METODO_LABEL[pago.metodo] ?? pago.metodo);
  if (pago.referencia && pago.referencia.trim()) {
    drawCampo("Referencia:", pago.referencia.trim());
  }

  /* ── Resumen de la factura ── */
  cursorTop += 4;
  const resumenH = 92;
  drawRectFromTop(page, margin, cursorTop, innerW, resumenH, { fill: rgb(1, 1, 1), border: primary });
  page.drawText("RESUMEN DE LA FACTURA", { x: margin + 12, y: baseline(page, cursorTop + 16), size: 8.5, font: fontBold, color: primary });

  const rowY = cursorTop + 36;
  const fsz = 9.5;
  const labelX = margin + 12;
  page.drawText("Total de la factura", { x: labelX, y: baseline(page, rowY), size: fsz, font, color: BLACK });
  drawTextRight(page, `${simbolo(pago.moneda)} ${formatMonto(factura.total, pago.moneda)}`, rightEdge, rowY, fsz, font, BLACK);

  page.drawText("Este pago", { x: labelX, y: baseline(page, rowY + 18), size: fsz, font: fontBold, color: BLACK });
  drawTextRight(page, `${simbolo(pago.moneda)} ${formatMonto(pago.monto, pago.moneda)}`, rightEdge, rowY + 18, fsz, fontBold, primary);

  const saldo = Number(factura.saldoRestante);
  page.drawText("Saldo restante", { x: labelX, y: baseline(page, rowY + 36), size: fsz, font, color: BLACK });
  drawTextRight(
    page,
    saldo <= 0 ? "FACTURA CANCELADA" : `${simbolo(pago.moneda)} ${formatMonto(saldo, pago.moneda)}`,
    rightEdge,
    rowY + 36,
    fsz,
    fontBold,
    saldo <= 0 ? rgb(0.05, 0.5, 0.2) : BLACK
  );

  cursorTop += resumenH + 46;

  /* ── Firma ── */
  const firmaW = 220;
  const firmaX = margin + innerW - firmaW;
  page.drawLine({
    start: { x: firmaX, y: baseline(page, cursorTop) },
    end: { x: firmaX + firmaW, y: baseline(page, cursorTop) },
    thickness: 0.6,
    color: GRAY,
  });
  drawTextRight(page, "Recibí conforme", firmaX + firmaW - (firmaW - font.widthOfTextAtSize("Recibí conforme", 8)) / 2, cursorTop + 12, 8, font, GRAY);

  /* ── Pie ── */
  const pieY = A4_H - margin - 8;
  const emitido = emitidoAt ? new Date(emitidoAt) : new Date();
  const emitidoTxt = `Emitido el ${emitido.toLocaleString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`;
  page.drawText("Generado con Neura ERP", { x: margin, y: baseline(page, pieY), size: 6.5, font, color: GRAY });
  drawTextRight(page, emitidoTxt, rightEdge, pieY, 6.5, font, GRAY);

  return Buffer.from(await pdfDoc.save());
}
