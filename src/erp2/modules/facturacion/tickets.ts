/**
 * Tickets imprimibles (receta 71): ticket de venta y comanda de cocina.
 * Configuración › Tickets y facturación guarda solo lo que se cambió; lo demás sale de los
 * defaults de acá (iguales a fac_ticket_efectivo() en la base), que reproducen el ticket de
 * siempre. Las funciones de abajo son PURAS (sin servidor ni DOM): arman el HTML completo
 * del ticket a partir de la config y los datos. Las usan la vista previa de la pantalla, la
 * ruta /api/ventas/[id]/ticket y la comanda de cocina.
 */

export type AnchoTicket = 58 | 80;
export type LetraTicket = "chica" | "normal" | "grande";
export type LetraComanda = "normal" | "grande" | "muy_grande";

export type ConfigTicketVenta = {
  ancho_mm: AnchoTicket;
  /** Logo de Datos de la empresa (o el de la instalación). */
  logo: boolean;
  enc_nombre_fantasia: boolean;
  enc_razon_social: boolean;
  enc_ruc: boolean;
  enc_direccion: boolean;
  enc_telefono: boolean;
  /** Caja y sucursal (debajo del número). */
  enc_sucursal: boolean;
  /** Texto libre debajo de los datos de la empresa ('' = nada). */
  encabezado_texto: string;
  /** Texto de pie ('' = nada). */
  pie_texto: string;
  mostrar_cajero: boolean;
  mostrar_cliente: boolean;
  mostrar_cliente_doc: boolean;
  /** Subtotal e IVA antes del total. */
  mostrar_iva: boolean;
  /** Forma de pago, recibido y vuelto. */
  mostrar_pago: boolean;
  letra: LetraTicket;
  copias: number;
  /** La caja abre e imprime el ticket sola al cobrar. */
  imprimir_al_cobrar: boolean;
};

export type ConfigComanda = {
  ancho_mm: AnchoTicket;
  letra: LetraComanda;
  mostrar_cliente: boolean;
  mostrar_notas: boolean;
  mostrar_precios: boolean;
  copias: number;
  pie_texto: string;
};

export const TICKET_VENTA_DEFAULT: ConfigTicketVenta = {
  ancho_mm: 80,
  logo: false,
  enc_nombre_fantasia: true,
  enc_razon_social: true,
  enc_ruc: true,
  enc_direccion: true,
  enc_telefono: true,
  enc_sucursal: true,
  encabezado_texto: "",
  pie_texto: "¡Gracias por su compra!",
  mostrar_cajero: true,
  mostrar_cliente: true,
  mostrar_cliente_doc: true,
  mostrar_iva: true,
  mostrar_pago: true,
  letra: "normal",
  copias: 1,
  imprimir_al_cobrar: true,
};

export const COMANDA_DEFAULT: ConfigComanda = {
  ancho_mm: 80,
  letra: "grande",
  mostrar_cliente: true,
  mostrar_notas: true,
  mostrar_precios: false,
  copias: 1,
  pie_texto: "",
};

export const LETRAS_TICKET: [LetraTicket, string][] = [["chica", "Chica"], ["normal", "Normal"], ["grande", "Grande"]];
export const LETRAS_COMANDA: [LetraComanda, string][] = [["normal", "Normal"], ["grande", "Grande"], ["muy_grande", "Muy grande"]];

/** Config guardada (parcial o vieja) + defaults. Sin nada guardado, el ancho sale del tipo de impresión. */
export function ticketVentaEfectivo(g?: Partial<ConfigTicketVenta> | null, impresion?: string | null): ConfigTicketVenta {
  const base = { ...TICKET_VENTA_DEFAULT, ancho_mm: (impresion === "ticket_58mm" ? 58 : 80) as AnchoTicket };
  const c = { ...base, ...(g ?? {}) };
  return { ...c, ancho_mm: Number(c.ancho_mm) === 58 ? 58 : 80, copias: limitarCopias(c.copias) };
}
export function comandaEfectiva(g?: Partial<ConfigComanda> | null): ConfigComanda {
  const c = { ...COMANDA_DEFAULT, ...(g ?? {}) };
  return { ...c, ancho_mm: Number(c.ancho_mm) === 58 ? 58 : 80, copias: limitarCopias(c.copias) };
}
const limitarCopias = (n: unknown) => Math.min(5, Math.max(1, Math.round(Number(n) || 1)));

// ── Utilidades ───────────────────────────────────────────────────────────────
export const escHtml = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const gs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;
const multilinea = (s: string) => escHtml(s).replace(/\r?\n/g, "<br>");

export const etiquetaMetodoPago = (m: string) => {
  const t = (m ?? "").trim().toLowerCase();
  return ({
    efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", pos: "Tarjeta", cheque: "Cheque",
    tarjeta_debito: "Tarjeta débito", tarjeta_credito: "Tarjeta crédito", pos_debito: "Tarjeta débito", pos_credito: "Tarjeta crédito",
    qr: "QR / billetera", billetera: "QR / billetera", mixto: "Mixto", otro: "Otro",
  } as Record<string, string>)[t] ?? (t ? t[0].toUpperCase() + t.slice(1) : "—");
};

/** Tamaño de letra base (px) del ticket de venta: 11 / 12 px en 58 / 80 mm (como siempre) ± el tamaño elegido. */
export const letraTicketPx = (ancho: AnchoTicket, letra: LetraTicket) =>
  (ancho === 58 ? 11 : 12) + (letra === "chica" ? -1 : letra === "grande" ? 2 : 0);
/** Comanda: más grande (se lee de lejos en la cocina). */
export const letraComandaPx = (ancho: AnchoTicket, letra: LetraComanda) =>
  (ancho === 58 ? 12 : 13) + (letra === "grande" ? 3 : letra === "muy_grande" ? 7 : 0);

// ── Documento (común a ticket y comanda) ─────────────────────────────────────
export type OpcionesDocumento = {
  /** Botones Imprimir / cambiar ancho (la vista previa no los lleva). Default true. */
  acciones?: boolean;
  /** Dispara window.print() al cargar. */
  auto?: boolean;
  /** Vista previa en un iframe: sin fondo gris ni márgenes grandes. */
  vistaPrevia?: boolean;
};

/** CSS del papel térmico (monoespaciado). `--w` y `--fs` van aparte para poder cambiar el ancho al vuelo. */
export const ESTILOS_TICKET = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: ui-monospace, "Courier New", monospace; font-size: var(--fs); color: #000; background: #f1f1f1; margin: 0; padding: 20px; }
  .paper { background: #fff; width: var(--w); margin: 0 auto 12mm; padding: 6mm 4mm; box-shadow: 0 1px 4px rgba(0,0,0,0.1); page-break-after: always; break-after: page; }
  .paper.last { page-break-after: auto; break-after: auto; margin-bottom: 0; }
  h1 { font-size: calc(var(--fs) + 4px); text-align: center; margin: 0 0 2mm; letter-spacing: 1px; }
  .logo { display: block; margin: 0 auto 2mm; max-width: 70%; max-height: 22mm; object-fit: contain; }
  .emisor { font-size: calc(var(--fs) - 2px); text-align: center; line-height: 1.35; margin: 0 0 2mm; }
  .meta { font-size: calc(var(--fs) - 1px); text-align: center; margin: 1mm 0 2mm; }
  .cliente { font-size: var(--fs); margin: 1mm 0; }
  hr { border: none; border-top: 1px dashed #000; margin: 2mm 0; }
  table { width: 100%; border-collapse: collapse; }
  td { vertical-align: top; padding: 0.5mm 0; }
  td.qty { width: 9mm; }
  td.amt { width: 22mm; text-align: right; white-space: nowrap; }
  tr.sub td { color: #555; font-size: calc(var(--fs) - 2px); padding-bottom: 1mm; }
  .totales td { padding: 0.7mm 0; }
  .totales .lbl { text-align: left; }
  .totales .val { text-align: right; white-space: nowrap; }
  .total-row { font-weight: bold; font-size: calc(var(--fs) + 2px); border-top: 1px solid #000; }
  .footer { font-size: calc(var(--fs) - 2px); text-align: center; margin-top: 3mm; font-style: italic; }
  .anulado-banner { border: 3px solid #b91c1c; color: #b91c1c; text-align: center; font-weight: 900; letter-spacing: 3px; font-size: calc(var(--fs) + 8px); padding: 3mm 2mm; margin: 0 0 3mm; background: #fef2f2; }
  body.anulada .paper { position: relative; }
  body.anulada .paper::before { content: "ANULADO"; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 60px; font-weight: 900; color: rgba(185,28,28,0.12); letter-spacing: 8px; transform: rotate(-20deg); pointer-events: none; }
  .cmd-titulo { font-size: calc(var(--fs) + 6px); font-weight: 900; text-align: center; margin: 0 0 1mm; letter-spacing: 1px; }
  .cmd-meta { text-align: center; margin: 0 0 1mm; }
  .cmd-item td { font-weight: bold; padding: 1mm 0; }
  .cmd-item td.qty { width: auto; padding-right: 2mm; white-space: nowrap; }
  .cmd-nota td { font-style: italic; padding: 0 0 1.5mm; }
  .cmd-mods td { padding: 0 0 1.2mm; line-height: 1.3; }
  .cmd-opc { font-weight: 900; }
  .cmd-sin { font-weight: 900; color: #b91c1c; text-transform: uppercase; }
  .cmd-extra { font-weight: 900; color: #047857; text-transform: uppercase; }
  .cmd-notas { border: 1px solid #000; padding: 1.5mm 2mm; margin: 1mm 0; }
  .actions { max-width: var(--w); margin: 8mm auto 0; text-align: center; }
  .actions button { padding: 8px 16px; font-size: 13px; cursor: pointer; border: 1px solid #333; background: #fff; border-radius: 6px; }
  .actions button:hover { background: #f5f5f5; }
  .actions a { margin-left: 12px; font-size: 13px; color: #444; cursor: pointer; text-decoration: underline; }
  body.preview { background: transparent; padding: 8px 0; }
  body.preview .paper { margin: 0 auto 4mm; box-shadow: 0 1px 6px rgba(15,23,42,0.16); }
  body.preview .paper.last { margin-bottom: 0; }
  @media print {
    body { background: #fff; padding: 0; }
    .paper { box-shadow: none; padding: 2mm; margin: 0; }
    .actions { display: none; }
  }
`;

/**
 * HTML completo de un ticket: papeles (uno por copia), estilos, y si corresponde los botones
 * y el auto-print. `fontPara` da la letra para cada ancho (el botón "Cambiar a 58mm" la usa).
 */
export function documentoTicket(a: {
  titulo: string;
  ancho: AnchoTicket;
  fontPara: (ancho: AnchoTicket) => number;
  papel: string;
  copias: number;
  claseBody?: string;
} & OpcionesDocumento): string {
  const acciones = a.acciones !== false && !a.vistaPrevia;
  const n = limitarCopias(a.copias);
  const papeles = Array.from({ length: n }, (_, i) => `<section class="paper${i === n - 1 ? " last" : ""}">${a.papel}</section>`).join("\n  ");
  const clases = [a.claseBody, a.vistaPrevia ? "preview" : ""].filter(Boolean).join(" ");
  const f58 = a.fontPara(58);
  const f80 = a.fontPara(80);
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escHtml(a.titulo)}</title>
<style id="sz">
  :root { --w: ${a.ancho}mm; --fs: ${a.fontPara(a.ancho)}px; }
  @page { margin: 0; size: ${a.ancho}mm auto; }
</style>
<style>${ESTILOS_TICKET}</style>
</head>
<body class="${clases}">
  ${papeles}
${acciones ? `  <div class="actions">
    <button type="button" onclick="window.print()">Imprimir</button>
    <a id="toggle" onclick="setAncho()">Cambiar a ${a.ancho === 80 ? 58 : 80}mm</a>
  </div>
  <script>
    var ancho = ${a.ancho};
    function setAncho(){
      ancho = ancho === 80 ? 58 : 80;
      var fs = ancho === 58 ? ${f58} : ${f80};
      document.getElementById('sz').textContent = ':root{--w:'+ancho+'mm;--fs:'+fs+'px;}@page{margin:0;size:'+ancho+'mm auto;}';
      document.getElementById('toggle').textContent = 'Cambiar a ' + (ancho === 80 ? 58 : 80) + 'mm';
    }
    ${a.auto ? "setTimeout(function(){try{window.print();}catch(e){}},250);" : ""}
  </script>
` : ""}</body>
</html>`;
}

// ── Ticket de venta ──────────────────────────────────────────────────────────
export type EmpresaTicket = {
  /** Nombre grande (fantasía, o razón social, o el de la instalación): como membreteEmpresa(). */
  nombre: string;
  razonSocial?: string | null;
  ruc?: string | null;
  /** Dirección, ciudad (y departamento). */
  ubicacion?: string | null;
  telefono?: string | null;
  /** URL o data URI del logo (solo si la config lo pide). */
  logo?: string | null;
};

export type PagoTicket = { etiqueta: string; referencia?: string | null; monto: number; recibido?: number | null; vuelto?: number | null; efectivo?: boolean };

export type DatosTicketVenta = {
  empresa: EmpresaTicket;
  numero: string;
  /** Ya formateada (dd/mm/aa hh:mm). */
  fecha: string;
  /** "Caja 1 · Sucursal Centro" */
  caja?: string | null;
  cajero?: string | null;
  cliente: { nombre: string; documento?: string | null };
  /** Receta 73: `detalle` = modificadores del plato en chico (extras con su precio). */
  /** `precioLista`: precio unitario de lista cuando se vendió más barato (descuento del producto
   *  o precio manual menor): se muestra tachado y una línea "Desc. 10 %: −Gs. 2.600". */
  items: { nombre: string; cantidad: number; precio: number; total: number; detalle?: string | null; precioLista?: number | null }[];
  subtotal: number;
  iva: number;
  total: number;
  /** Crédito / sin detalle: una sola etiqueta ("Efectivo", "Crédito (30 días)"). Si no, el detalle de cada pago. */
  pago: { metodo: string } | { detalle: PagoTicket[] };
  anulada?: boolean;
  /** Receta 101: factura del autoimpresor. Con esto el papel sale como factura, no como comprobante interno. */
  fiscal?: FiscalTicket | null;
};

export type FiscalTicket = {
  numero: string;
  timbrado: string;
  /** Ya formateadas (dd/mm/aaaa). */
  vigenciaDesde?: string | null;
  vigenciaHasta?: string | null;
  condicion: string;
  exenta: number;
  gravada5: number;
  gravada10: number;
  iva5: number;
  iva10: number;
  leyenda?: string | null;
};

/** Cuerpo de un papel del ticket de venta (sin <section>). */
export function papelTicketVenta(cfg: ConfigTicketVenta, d: DatosTicketVenta): string {
  const e = d.empresa;
  const razon = (e.razonSocial ?? "").trim() || null;
  const titulo = cfg.enc_nombre_fantasia ? e.nombre : cfg.enc_razon_social ? razon : null;
  // La factura lleva siempre razón social, RUC, dirección y cliente, aunque el ticket los oculte.
  const f = d.fiscal ?? null;
  const lineaRazon = (f || (cfg.enc_nombre_fantasia && cfg.enc_razon_social)) && razon && razon !== titulo ? razon : null;
  const emisor = [
    lineaRazon,
    (f || cfg.enc_ruc) && e.ruc ? `RUC ${e.ruc}` : null,
    f || cfg.enc_direccion ? e.ubicacion : null,
    cfg.enc_telefono && e.telefono ? `Tel. ${e.telefono}` : null,
  ].filter(Boolean).map((l) => escHtml(l)).join("<br>");
  const encLibre = cfg.encabezado_texto.trim();

  const caja = cfg.enc_sucursal ? (d.caja ?? "").trim() : "";
  const cajero = cfg.mostrar_cajero ? (d.cajero ?? "").trim() : "";

  const filas = d.items
    .map((it) => {
      const lista = Number(it.precioLista) || 0;
      const conDesc = lista > it.precio + 0.5;
      const desc = conDesc ? Math.round((lista - it.precio) * it.cantidad) : 0;
      const pct = conDesc ? Math.round((1 - it.precio / lista) * 1000) / 10 : 0;
      // Con coma y hasta 3 decimales (cuenta separada: 0,333 de pizza).
      const cant = Number(it.cantidad).toLocaleString("es-PY", { maximumFractionDigits: 3 });
      return `<tr><td class="qty"><strong>${cant}×</strong></td><td>${escHtml(it.nombre)}</td><td class="amt">${gs(it.total)}</td></tr>
        <tr class="sub"><td></td><td colspan="2">${cant} ×${conDesc ? `<s>${gs(lista)}</s> ` : ""}${gs(it.precio)}</td></tr>${conDesc ? `
        <tr class="sub"><td></td><td colspan="2">Desc. ${pct.toLocaleString("es-PY")} %: −${gs(desc)}</td></tr>` : ""}${(it.detalle ?? "").trim() ? `
        <tr class="sub"><td></td><td colspan="2">${escHtml((it.detalle ?? "").trim())}</td></tr>` : ""}`;
    })
    .join("");

  const filasPago = !cfg.mostrar_pago
    ? ""
    : "metodo" in d.pago
      ? `<tr><td class="lbl">Pago</td><td class="val">${escHtml(d.pago.metodo)}</td></tr>`
      : d.pago.detalle
          .map((pg) => {
            const ref = pg.referencia ? ` <span style="font-size:calc(var(--fs) - 2px)">(${escHtml(pg.referencia)})</span>` : "";
            let fila = `<tr><td class="lbl">${escHtml(pg.etiqueta)}${ref}</td><td class="val">${gs(pg.monto)}</td></tr>`;
            if (pg.efectivo && Number(pg.recibido) > 0) {
              fila += `<tr class="sub"><td class="lbl">Recibido</td><td class="val">${gs(Number(pg.recibido))}</td></tr>`;
              fila += `<tr><td class="lbl"><strong>Vuelto</strong></td><td class="val"><strong>${gs(Number(pg.vuelto) || 0)}</strong></td></tr>`;
            }
            return fila;
          })
          .join("");

  const pie = cfg.pie_texto.trim();
  const doc = f || cfg.mostrar_cliente_doc ? (d.cliente.documento ?? "").trim() : "";
  const vigencia = f && f.vigenciaHasta ? `${f.vigenciaDesde ? `${escHtml(f.vigenciaDesde)} al ` : "Hasta "}${escHtml(f.vigenciaHasta)}` : "";
  const fila = (etiqueta: string, monto: number) => `<tr><td class="lbl">${etiqueta}</td><td class="val">${gs(monto)}</td></tr>`;
  const filasIva = f
    ? [
        f.exenta ? fila("Exentas", f.exenta) : "",
        f.gravada5 ? fila("Gravadas 5 %", f.gravada5) : "",
        f.gravada10 ? fila("Gravadas 10 %", f.gravada10) : "",
        f.iva5 ? fila("IVA 5 %", f.iva5) : "",
        f.iva10 ? fila("IVA 10 %", f.iva10) : "",
      ].join("")
    : cfg.mostrar_iva
      ? `${fila("Subtotal", d.subtotal)}${fila("IVA", d.iva)}`
      : "";
  const leyenda = (f?.leyenda ?? "").trim();

  return `
    ${d.anulada ? `<div class="anulado-banner">ANULADO</div>` : ""}
    ${cfg.logo && e.logo ? `<img class="logo" src="${escHtml(e.logo)}" alt="">` : ""}
    ${titulo ? `<h1>${escHtml(titulo)}</h1>` : ""}
    ${emisor ? `<div class="emisor">${emisor}</div>` : ""}
    ${encLibre ? `<div class="emisor">${multilinea(encLibre)}</div>` : ""}
    <hr>
    ${f ? `<div class="meta"><strong>FACTURA N° ${escHtml(f.numero)}</strong><br>Timbrado N° ${escHtml(f.timbrado)}${vigencia ? `<br>Vigencia: ${vigencia}` : ""}<br>Condición: ${escHtml(f.condicion)}</div>
    <hr>` : ""}
    <div class="meta">${escHtml(d.numero)}<br>${escHtml(d.fecha)}${caja ? `<br>${escHtml(caja)}` : ""}${cajero ? ` · ${escHtml(cajero)}` : ""}</div>
    <hr>
    ${f || cfg.mostrar_cliente ? `<div class="cliente">Cliente: ${escHtml(d.cliente.nombre)}${doc ? `<br>${escHtml(doc)}` : ""}</div>
    <hr>` : ""}
    <table>${filas}</table>
    <hr>
    <table class="totales">
      ${filasIva}
      <tr class="total-row"><td class="lbl">TOTAL</td><td class="val">${gs(d.total)}</td></tr>
      ${filasPago}
    </table>
    <hr>
    <div class="footer">${pie ? `${multilinea(pie)}<br>` : ""}${f ? (leyenda ? multilinea(leyenda) : "") : "Comprobante interno — no válido como factura legal."}</div>
  `;
}

/** HTML completo del ticket de venta, respetando la config (ancho, letra, copias, etc.). */
export function htmlTicketVenta(cfg: ConfigTicketVenta, d: DatosTicketVenta, op: OpcionesDocumento = {}): string {
  return documentoTicket({
    titulo: `${d.fiscal ? `Factura ${d.fiscal.numero}` : `Ticket ${d.numero}`} — ${d.empresa.nombre}`,
    ancho: cfg.ancho_mm,
    fontPara: (w) => letraTicketPx(w, cfg.letra),
    papel: papelTicketVenta(cfg, d),
    copias: op.vistaPrevia ? 1 : cfg.copias,
    claseBody: d.anulada ? "anulada" : "",
    ...op,
  });
}

// ── Comanda de cocina ────────────────────────────────────────────────────────
export type DatosComanda = {
  /** "Mesa 4", "Para llevar", "Pedido #12"… (lo grande arriba). */
  titulo: string;
  /** Número / referencia del pedido (debajo del título). */
  referencia?: string | null;
  fecha: string;
  /** Estación de cocina (Parrilla, Bar…), opcional. */
  estacion?: string | null;
  cliente?: string | null;
  /** Receta 73: `mods` = modificadores del plato (SIN … en rojo, + EXTRA … en verde, opciones en negrita). */
  items: { nombre: string; cantidad: number; notas?: string | null; precio?: number | null; total?: number | null; mods?: ModsComanda | null }[];
  /** Nota general del pedido. */
  notas?: string | null;
  total?: number | null;
};

/** Modificadores de una línea de la comanda (ya como texto). */
export type ModsComanda = { opciones?: string[]; quitar?: string[]; extras?: string[] };

function filaMods(m: ModsComanda | null | undefined, cols: number): string {
  const partes = [
    ...(m?.opciones ?? []).map((o) => `<span class="cmd-opc">${escHtml(o)}</span>`),
    ...(m?.quitar ?? []).map((q) => `<span class="cmd-sin">SIN ${escHtml(q)}</span>`),
    ...(m?.extras ?? []).map((e) => `<span class="cmd-extra">+ ${escHtml(e)}</span>`),
  ];
  return partes.length ? `<tr class="cmd-mods"><td></td><td colspan="${cols}">${partes.join("<br>")}</td></tr>` : "";
}

export function papelComanda(cfg: ConfigComanda, d: DatosComanda): string {
  const filas = d.items
    .map((it) => {
      const precio = cfg.mostrar_precios && it.total != null ? `<td class="amt">${gs(Number(it.total))}</td>` : "";
      const nota = cfg.mostrar_notas && (it.notas ?? "").trim()
        ? `<tr class="cmd-nota"><td></td><td colspan="${precio ? 2 : 1}">→ ${multilinea((it.notas ?? "").trim())}</td></tr>`
        : "";
      return `<tr class="cmd-item"><td class="qty">${it.cantidad}×</td><td>${escHtml(it.nombre)}</td>${precio}</tr>${filaMods(it.mods, precio ? 2 : 1)}${nota}`;
    })
    .join("");
  const meta = [d.referencia, d.estacion].filter((x) => (x ?? "").trim()).map(escHtml).join(" · ");
  const cliente = cfg.mostrar_cliente ? (d.cliente ?? "").trim() : "";
  const notas = cfg.mostrar_notas ? (d.notas ?? "").trim() : "";
  const pie = cfg.pie_texto.trim();
  return `
    <div class="cmd-titulo">${escHtml(d.titulo)}</div>
    ${meta ? `<div class="cmd-meta">${meta}</div>` : ""}
    <div class="cmd-meta">${escHtml(d.fecha)}</div>
    ${cliente ? `<div class="cmd-meta">Cliente: ${escHtml(cliente)}</div>` : ""}
    <hr>
    <table>${filas}</table>
    ${notas ? `<div class="cmd-notas">${multilinea(notas)}</div>` : ""}
    ${cfg.mostrar_precios && d.total != null ? `<table class="totales" style="margin-top:1mm"><tr class="total-row"><td class="lbl">TOTAL</td><td class="val">${gs(Number(d.total))}</td></tr></table>` : ""}
    ${pie ? `<hr><div class="footer">${multilinea(pie)}</div>` : ""}
  `;
}

/** HTML completo de la comanda de cocina, respetando la config. */
export function htmlComanda(cfg: ConfigComanda, d: DatosComanda, op: OpcionesDocumento = {}): string {
  return documentoTicket({
    titulo: `Comanda — ${d.titulo}`,
    ancho: cfg.ancho_mm,
    fontPara: (w) => letraComandaPx(w, cfg.letra),
    papel: papelComanda(cfg, d),
    copias: op.vistaPrevia ? 1 : cfg.copias,
    ...op,
  });
}

// ── Datos de ejemplo (vista previa) ──────────────────────────────────────────
export function ejemploTicketVenta(empresa: EmpresaTicket): DatosTicketVenta {
  return {
    empresa,
    numero: "VTA-000123",
    fecha: "23/10/26 12:30",
    caja: "Caja 1 · Casa central",
    cajero: "María González",
    cliente: { nombre: "Juan Pérez", documento: "RUC: 4567890-1" },
    items: [
      { nombre: "Hamburguesa completa", cantidad: 2, precio: 35000, total: 70000, detalle: "sin cebolla · + extra queso (Gs. 5.000) · a punto" },
      { nombre: "Gaseosa 500 ml", cantidad: 2, precio: 7200, total: 14400, precioLista: 8000 },
      { nombre: "Papas fritas", cantidad: 1, precio: 15000, total: 15000 },
    ],
    subtotal: 90364,
    iva: 9036,
    total: 99400,
    pago: { detalle: [{ etiqueta: "Efectivo", monto: 99400, recibido: 150000, vuelto: 50600, efectivo: true }] },
  };
}

export const EJEMPLO_COMANDA: DatosComanda = {
  titulo: "Mesa 4",
  referencia: "Pedido #58",
  fecha: "23/10/26 12:30",
  estacion: "Cocina",
  cliente: "Juan Pérez",
  items: [
    { nombre: "Hamburguesa completa", cantidad: 2, notas: "Cortada al medio", precio: 35000, total: 70000, mods: { opciones: ["A punto"], quitar: ["cebolla"], extras: ["extra queso"] } },
    { nombre: "Papas fritas", cantidad: 1, precio: 15000, total: 15000 },
  ],
  notas: "Traer todo junto",
  total: 85000,
};
