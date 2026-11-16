import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import { errorInesperado, sinPermiso } from "@/lib/soporte/servidor";
import { datosNeurita } from "@/lib/soporte/neurita-datos";
import { TZ_PY } from "@/lib/format/hora-py";

/** Helvetica de pdf-lib escribe WinAnsi: lo que no entra ahí rompe el documento. */
function limpiar(t: string): string {
  return (t ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
}

const VIOLETA = rgb(0.55, 0.36, 0.96);
const TINTA = rgb(0.11, 0.16, 0.19);
const GRIS = rgb(0.42, 0.45, 0.48);
const LINEA = rgb(0.85, 0.87, 0.89);
const VERDE = rgb(0.06, 0.6, 0.45);
const ROJO = rgb(0.75, 0.21, 0.21);

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Lee `desde`/`hasta` de la URL. Fechas inválidas se ignoran, no rompen. */
function rangoDe(request: Request) {
  const sp = new URL(request.url).searchParams;
  const leer = (k: string) => {
    const v = sp.get(k) ?? "";
    return RE_FECHA.test(v) ? v : null;
  };
  let desde = leer("desde");
  let hasta = leer("hasta");
  // Rango al revés: se da vuelta en vez de devolver vacío.
  if (desde && hasta && hasta < desde) [desde, hasta] = [hasta, desde];
  return { desde, hasta };
}

const usd = (n: number | null) =>
  n == null ? "-" : `US$ ${n.toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nro = (n: number) => `#${String(n).padStart(4, "0")}`;
function duracion(min: number | null): string {
  if (min == null) return "-";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * GET /api/soporte/neurita/pdf — el tablero, descargable.
 *
 * Mismos datos que la pantalla (`datosNeurita`), dibujados con pdf-lib, que ya
 * se usa para el KuDE. Sin navegador headless: esto corre en el servidor del ERP.
 */
export async function GET(request: Request) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const rango = rangoDe(request);
    const d = await datosNeurita(auth, rango);
    const pdf = await PDFDocument.create();
    const normal = await pdf.embedFont(StandardFonts.Helvetica);
    const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);

    const ANCHO = 842;
    const ALTO = 595; // A4 apaisado: las tablas de tickets no entran en vertical
    const M = 40;
    let pagina: PDFPage = pdf.addPage([ANCHO, ALTO]);
    let y = ALTO - M;

    const texto = (t: string, x: number, yy: number, tam = 9, f: PDFFont = normal, color = TINTA) =>
      pagina.drawText(limpiar(t), { x, y: yy, size: tam, font: f, color });
    /** Recorta al ancho dado, en vez de pisar la columna siguiente. */
    const cortar = (t: string, max: number, tam: number, f: PDFFont) => {
      let s = limpiar(t);
      while (s.length > 1 && f.widthOfTextAtSize(s, tam) > max) s = s.slice(0, -1);
      return s;
    };
    const hoja = (altoNecesario: number) => {
      if (y - altoNecesario > M) return;
      pagina = pdf.addPage([ANCHO, ALTO]);
      y = ALTO - M;
    };

    // ---------------------------------------------------------------- cabecera
    pagina.drawRectangle({ x: 0, y: ALTO - 70, width: ANCHO, height: 70, color: rgb(0.97, 0.96, 1) });
    texto(d.agente?.nombre ?? "Neurita", M, ALTO - 38, 20, negrita, VIOLETA);
    const periodo = d.rango.activo
      ? `Periodo: ${d.rango.desde ?? "el inicio"} a ${d.rango.hasta ?? "hoy"}`
      : "Todo el historial";
    texto(`Agente de IA de soporte - ${periodo}`, M, ALTO - 55, 9.5, normal, GRIS);
    const ahora = new Intl.DateTimeFormat("es-PY", {
      timeZone: TZ_PY, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(new Date());
    const pie = `Generado el ${ahora}`;
    texto(pie, ANCHO - M - normal.widthOfTextAtSize(limpiar(pie), 8.5), ALTO - 38, 8.5, normal, GRIS);
    y = ALTO - 96;

    // ---------------------------------------------------------------- números
    const pctMes = d.gasto.topeMes > 0 ? Math.round((d.gasto.mes / d.gasto.topeMes) * 100) : 0;
    const pctVuelta = d.trabajo.resueltos > 0 ? Math.round((d.trabajo.volvieron / d.trabajo.resueltos) * 100) : null;
    const tarjetas: { t: string; v: string; p: string }[] = [
      { t: d.rango.activo ? "GASTO DEL PERIODO" : "GASTO HOY", v: usd(d.rango.activo ? d.gasto.periodo : d.gasto.hoy), p: `${d.rango.activo ? d.gasto.vueltasPeriodo : d.gasto.vueltasHoy} vueltas del modelo` },
      { t: "ESTE MES", v: usd(d.gasto.mes), p: `${pctMes}% del tope de ${usd(d.gasto.topeMes)}` },
      { t: "TOTAL HISTORICO", v: usd(d.gasto.total), p: "desde que empezo a informar" },
      { t: "RESUELTOS", v: String(d.trabajo.resueltos), p: `${d.trabajo.abiertos} abiertos ahora` },
      { t: "COSTO POR TICKET", v: usd(d.trabajo.costoPorTicket), p: "todo lo gastado / resueltos" },
      { t: "LE VOLVIERON", v: pctVuelta == null ? "-" : `${pctVuelta}%`, p: `${d.trabajo.volvieron} de ${d.trabajo.resueltos}` },
      { t: "TARDA (MEDIANA)", v: duracion(d.trabajo.medianaMinutos), p: "de tomarlo a resolverlo" },
      { t: "VUELTAS / TICKET", v: d.trabajo.vueltasMediana == null ? "-" : String(d.trabajo.vueltasMediana), p: "mediana" },
    ];
    const anchoT = (ANCHO - M * 2 - 7 * 8) / 8;
    tarjetas.forEach((c, i) => {
      const x = M + i * (anchoT + 8);
      pagina.drawRectangle({ x, y: y - 56, width: anchoT, height: 56, borderColor: LINEA, borderWidth: 0.6, color: rgb(1, 1, 1) });
      texto(c.t, x + 7, y - 15, 6.5, negrita, GRIS);
      texto(c.v, x + 7, y - 33, 13, negrita, c.t === "LE VOLVIERON" && d.trabajo.volvieron > 0 ? ROJO : TINTA);
      texto(cortar(c.p, anchoT - 14, 6.5, normal), x + 7, y - 47, 6.5, normal, GRIS);
    });
    y -= 78;

    // ---------------------------------------------------------------- gasto por día
    texto(d.rango.activo ? `Gasto por dia (${d.dias.length} dias)` : "Gasto de los ultimos 14 dias", M, y, 11, negrita);
    y -= 12;
    const pico = Math.max(0.01, ...d.dias.map((x) => x.usd));
    const altoG = 70;
    const anchoB = (ANCHO - M * 2) / d.dias.length;
    d.dias.forEach((dia, i) => {
      const x = M + i * anchoB;
      const h = dia.usd > 0 ? Math.max(3, (dia.usd / pico) * altoG) : 1;
      pagina.drawRectangle({ x: x + 4, y: y - altoG, width: anchoB - 8, height: h, color: dia.usd > 0 ? VIOLETA : LINEA });
      const et = `${dia.fecha.slice(8, 10)}/${dia.fecha.slice(5, 7)}`;
      texto(et, x + (anchoB - normal.widthOfTextAtSize(et, 6.5)) / 2, y - altoG - 11, 6.5, normal, GRIS);
      if (dia.usd > 0) {
        const v = dia.usd.toFixed(2);
        texto(v, x + (anchoB - normal.widthOfTextAtSize(v, 6)) / 2, y - altoG + h + 3, 6, normal, GRIS);
      }
    });
    y -= altoG + 28;

    // ---------------------------------------------------------------- tablas
    type Col = { t: string; ancho: number; der?: boolean };
    const tabla = (titulo: string, cols: Col[], filas: string[][], vacio: string) => {
      hoja(60);
      texto(titulo, M, y, 11, negrita);
      y -= 15;
      let x = M;
      for (const c of cols) {
        const w = normal.widthOfTextAtSize(limpiar(c.t), 6.5);
        texto(c.t, c.der ? x + c.ancho - w : x, y, 6.5, negrita, GRIS);
        x += c.ancho;
      }
      y -= 5;
      pagina.drawLine({ start: { x: M, y }, end: { x: ANCHO - M, y }, thickness: 0.6, color: LINEA });
      y -= 12;
      if (!filas.length) {
        texto(vacio, M, y, 8.5, normal, GRIS);
        y -= 20;
        return;
      }
      for (const f of filas) {
        hoja(18);
        let cx = M;
        f.forEach((celda, i) => {
          const c = cols[i];
          const s = cortar(celda, c.ancho - 6, 8, normal);
          const w = normal.widthOfTextAtSize(s, 8);
          texto(s, c.der ? cx + c.ancho - w : cx, y, 8);
          cx += c.ancho;
        });
        y -= 13;
      }
      y -= 12;
    };

    tabla(
      "En que esta ahora (no depende del periodo)",
      [{ t: "TICKET", ancho: 56 }, { t: "ASUNTO", ancho: 330 }, { t: "CLIENTE", ancho: 190 }, { t: "VUELTAS", ancho: 60, der: true }, { t: "COSTO", ancho: 126, der: true }],
      d.abiertos.map((t) => [nro(t.numero), t.asunto, t.cliente ?? "-", String(t.vueltas), usd(t.usd)]),
      "No tiene ningun ticket abierto."
    );
    tabla(
      "Los que le volvieron",
      [{ t: "TICKET", ancho: 56 }, { t: "ASUNTO", ancho: 330 }, { t: "CLIENTE", ancho: 190 }, { t: "VUELTAS", ancho: 186, der: true }],
      d.volvieronLista.map((t) => [nro(t.numero), t.asunto, t.cliente ?? "-", String(t.vueltas)]),
      "Ninguno de los que resolvio se volvio a abrir."
    );
    tabla(
      "En que sistemas gasto",
      [{ t: "SISTEMA", ancho: 420 }, { t: "TICKETS", ancho: 110, der: true }, { t: "VUELTAS", ancho: 110, der: true }, { t: "GASTO", ancho: 122, der: true }],
      d.sistemas.map((s) => [s.nombre, s.tickets ? String(s.tickets) : "-", String(s.vueltas), usd(s.usd)]),
      "Todavia no informo gasto."
    );
    tabla(
      `Todo lo que resolvio (${d.resueltos.length})`,
      [{ t: "TICKET", ancho: 56 }, { t: "ASUNTO", ancho: 300 }, { t: "CLIENTE", ancho: 170 }, { t: "RESUELTO", ancho: 80 }, { t: "COSTO", ancho: 156, der: true }],
      d.resueltos.map((t) => [
        nro(t.numero),
        t.asunto + (t.volvio ? "  (volvio)" : ""),
        t.cliente ?? "-",
        new Intl.DateTimeFormat("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "2-digit" }).format(new Date(t.resuelto_at)),
        t.usd > 0 ? usd(t.usd) : "sin dato",
      ]),
      "Todavia no resolvio ninguno."
    );

    hoja(40);
    texto(
      "El gasto se cuenta desde que el agente empezo a informarlo. Los tickets resueltos, los tiempos y las reaperturas salen del historial y cubren todo.",
      M, y, 7.5, normal, GRIS
    );

    // Numeración al final: recién acá se sabe cuántas páginas salieron.
    const hojas = pdf.getPages();
    hojas.forEach((pg, i) => {
      const t = limpiar(`${i + 1} / ${hojas.length}`);
      pg.drawText(t, { x: ANCHO - M - normal.widthOfTextAtSize(t, 7.5), y: 20, size: 7.5, font: normal, color: GRIS });
      pg.drawText(limpiar("Neura - tablero de Neurita"), { x: M, y: 20, size: 7.5, font: normal, color: GRIS });
    });

    const bytes = await pdf.save();
    const sufijo = d.rango.activo ? `${d.rango.desde ?? "inicio"}_${d.rango.hasta ?? "hoy"}` : "";
    const hoyNombre = new Intl.DateTimeFormat("en-CA", { timeZone: TZ_PY, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return new Response(bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="neurita-${sufijo || hoyNombre}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorInesperado(e);
  }
}
