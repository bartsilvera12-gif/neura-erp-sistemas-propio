import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import * as XLSX from "xlsx";

/**
 * Conciliación bancaria asistida por IA.
 *
 * 1) `extraerTransaccionesDeExtracto`: manda el PDF del extracto a Claude (lee texto + visual,
 *    sirve para PDFs digitales y escaneados) y devuelve las transacciones estructuradas.
 * 2) `conciliar`: cruza los créditos (ingresos) del extracto contra las transferencias APROBADAS
 *    del mes, y clasifica cada caso (conciliado / aprobado-sin-respaldo / ingreso-no-registrado /
 *    monto-difiere). No modifica nada: solo informa.
 *
 * Requiere `ANTHROPIC_API_KEY` en el entorno (ya seteada en prod). Nunca lanza hacia el cliente
 * sin mensaje controlado: el endpoint traduce los errores.
 */

const DEFAULT_MODEL = "claude-haiku-4-5";

export type ExtractoTx = {
  fecha: string | null; // YYYY-MM-DD
  monto: number;
  tipo: "credito" | "debito";
  referencia: string | null; // nº de operación / comprobante si el extracto lo trae
  descripcion: string | null;
};

export type AprobadoLite = {
  id: string;
  monto: number;
  fecha: string; // YYYY-MM-DD
  numero_operacion: string | null;
  banco_origen: string | null;
  titular: string | null;
  cliente_nombre: string | null;
  numero_factura: string | null;
  /** Si >1, esta fila representa VARIOS cobros del ERP agrupados por el mismo N° de operación. */
  agrupadas?: number;
};

export type ParMatch = { aprobado: AprobadoLite; credito: ExtractoTx };
export type ParDifiere = ParMatch & { diff: number };

export type ConciliacionResult = {
  moneda: string | null;
  banco_detectado: string | null;
  conciliados: ParMatch[];
  montos_difieren: ParDifiere[];
  aprobados_sin_extracto: AprobadoLite[];
  extracto_sin_registrar: ExtractoTx[];
  resumen: {
    aprobados: number;
    creditos_extracto: number;
    conciliados: number;
    difieren: number;
    sin_extracto: number;
    sin_registrar: number;
    monto_conciliado: number;
    monto_sin_extracto: number;
    monto_sin_registrar: number;
  };
};

const PROMPT_EXTRACCION = `Sos un extractor de datos de extractos bancarios de Paraguay. Te paso el PDF de un extracto de cuenta.

Devolvé SOLO un JSON válido (sin texto extra, sin markdown) con esta forma exacta:
{
  "moneda": "GS" | "USD" | null,
  "banco": string | null,
  "transacciones": [
    { "fecha": "YYYY-MM-DD", "monto": number, "tipo": "credito" | "debito", "referencia": string | null, "descripcion": string | null }
  ]
}

Reglas:
- Una entrada por cada movimiento de la tabla de transacciones. NO incluyas saldos, totales, encabezados ni resúmenes.
- "monto": número positivo SIN separador de miles ni símbolo (ej: 1500000, no "1.500.000 Gs"). Punto decimal si aplica.
- "tipo": "credito" para ingresos/créditos/depósitos/transferencias recibidas; "debito" para egresos/débitos/pagos/extracciones.
- "referencia": el número de operación / comprobante / documento del movimiento si aparece; si no, null.
- "fecha": normalizá a YYYY-MM-DD. Si no podés determinar el año, usá el del período del extracto.
- Si un monto no se puede leer con certeza, omití esa fila.
Devolvé ÚNICAMENTE el JSON.`;

function extractJson(text: string): unknown {
  const t = text.trim();
  // ```json ... ``` o ``` ... ```
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : t;
  // primer { ... último }
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  const json = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;
  return JSON.parse(json);
}

function toNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  let s = String(v ?? "").trim();
  if (!s) return NaN;
  s = s.replace(/[^\d.,-]/g, "");
  if (!s) return NaN;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // el separador más a la derecha es el decimal; el otro es de miles
    const dec = lastDot > lastComma ? "." : ",";
    const mil = dec === "." ? "," : ".";
    s = s.split(mil).join("").replace(dec, ".");
  } else if (lastComma >= 0) {
    // solo comas: miles si hay grupos de 3 sin cola decimal de 1-2; si no, decimal
    if (/,\d{3}(?:\D|$)/.test(s) && !/,\d{1,2}$/.test(s)) s = s.split(",").join("");
    else s = s.replace(",", ".");
  } else if (lastDot >= 0) {
    if (/\.\d{3}(?:\D|$)/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.split(".").join("");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Reintenta ante errores transitorios de la API (529 overloaded, 429, 503) con backoff. */
async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = (e as { status?: number })?.status;
      const msg = String((e as { message?: string })?.message ?? "");
      const transitorio = status === 529 || status === 429 || status === 503 || /overloaded/i.test(msg);
      if (!transitorio || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

export async function extraerTransaccionesDeExtracto(
  pdfBytes: Buffer,
  opts?: { model?: string }
): Promise<{ moneda: string | null; banco: string | null; transacciones: ExtractoTx[] }> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error("Falta ANTHROPIC_API_KEY en el servidor");
  }
  const anthropic = new Anthropic();
  const model = opts?.model || process.env.CONCILIACION_MODEL?.trim() || DEFAULT_MODEL;

  // La API puede devolver 529 (overloaded) o 429/503 transitorios; reintentar con backoff.
  const msg = await withRetry(() =>
    anthropic.messages.create({
      model,
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: pdfBytes.toString("base64") },
            },
            { type: "text", text: PROMPT_EXTRACCION },
          ],
        },
      ],
    })
  );

  const textPart = msg.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textPart) throw new Error("El modelo no devolvió texto");

  let parsed: unknown;
  try {
    parsed = extractJson(textPart.text);
  } catch {
    throw new Error("No se pudo interpretar la respuesta del modelo (JSON inválido)");
  }
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const rawTx = Array.isArray(obj.transacciones) ? obj.transacciones : [];
  const transacciones: ExtractoTx[] = rawTx
    .map((r) => {
      const t = (r ?? {}) as Record<string, unknown>;
      const monto = toNum(t.monto);
      const tipo = String(t.tipo ?? "").toLowerCase() === "debito" ? "debito" : "credito";
      const fecha = typeof t.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.fecha) ? t.fecha : null;
      return {
        fecha,
        monto,
        tipo: tipo as "credito" | "debito",
        referencia: t.referencia != null ? String(t.referencia).trim() || null : null,
        descripcion: t.descripcion != null ? String(t.descripcion).trim().slice(0, 200) || null : null,
      };
    })
    .filter((t) => Number.isFinite(t.monto) && t.monto > 0);

  return {
    moneda: typeof obj.moneda === "string" ? obj.moneda : null,
    banco: typeof obj.banco === "string" ? obj.banco : null,
    transacciones,
  };
}

// ---- Lectura de Excel/CSV (directa, sin IA cuando se reconocen las columnas) ----

function normHead(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase()
    .trim();
}

const ALIAS = {
  credito: ["haber", "credito", "credit", "abono", "ingreso", "creditos", "montocredito"],
  debito: ["debe", "debito", "debit", "cargo", "egreso", "debitos", "montodebito"],
  monto: ["monto", "importe", "valor", "amount", "montogs"],
  fecha: ["fechamovi", "fechacont", "fechamovimiento", "fechacontable", "fechaoperacion", "fecha", "date", "dia"],
  ref: ["comprobante", "operacion", "nrooperacion", "numerooperacion", "referencia", "orden", "documento", "comprob", "nrodoc"],
  desc: ["descripcion", "descrip", "concepto", "movimiento", "detalle", "description"],
};

function pickCol(headers: string[], aliases: string[]): number {
  for (const a of aliases) {
    const i = headers.findIndex((h) => h === a);
    if (i >= 0) return i;
  }
  // match parcial (contiene)
  for (const a of aliases) {
    const i = headers.findIndex((h) => h.includes(a));
    if (i >= 0) return i;
  }
  return -1;
}

function fechaDeCelda(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const s = String(v ?? "").trim();
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

/** Lee las filas del Excel/CSV como matriz (primera hoja). `raw:true` → números y fechas reales. */
function leerFilas(bytes: Buffer): unknown[][] {
  const wb = XLSX.read(bytes, { type: "buffer", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true }) as unknown[][];
}

/**
 * Parseo directo de un extracto Excel/CSV con columnas reconocibles (Debe/Haber o Monto +
 * Fecha + Comprobante). Devuelve null si no reconoce el formato (para caer al fallback IA).
 */
export function parseExtractoExcel(bytes: Buffer): { moneda: string | null; banco: string | null; transacciones: ExtractoTx[] } | null {
  const aoa = leerFilas(bytes);
  if (aoa.length < 2) return null;

  // Buscar la fila de encabezados en las primeras 15 filas.
  let headerRow = -1;
  let cols: Record<string, number> = {};
  for (let r = 0; r < Math.min(15, aoa.length); r++) {
    const headers = (aoa[r] ?? []).map(normHead);
    const c = {
      credito: pickCol(headers, ALIAS.credito),
      debito: pickCol(headers, ALIAS.debito),
      monto: pickCol(headers, ALIAS.monto),
      fecha: pickCol(headers, ALIAS.fecha),
      ref: pickCol(headers, ALIAS.ref),
      desc: pickCol(headers, ALIAS.desc),
    };
    const tieneImporte = c.credito >= 0 || c.debito >= 0 || c.monto >= 0;
    if (tieneImporte && (c.fecha >= 0 || c.desc >= 0)) {
      headerRow = r;
      cols = c;
      break;
    }
  }
  if (headerRow < 0) return null;

  const transacciones: ExtractoTx[] = [];
  for (let r = headerRow + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    const cell = (i: number) => (i >= 0 ? row[i] : undefined);
    const haber = cols.credito >= 0 ? toNum(cell(cols.credito)) : NaN;
    const debe = cols.debito >= 0 ? toNum(cell(cols.debito)) : NaN;
    let monto = NaN;
    let tipo: "credito" | "debito" = "credito";
    if (Number.isFinite(haber) && haber > 0) {
      monto = haber;
      tipo = "credito";
    } else if (Number.isFinite(debe) && debe > 0) {
      monto = debe;
      tipo = "debito";
    } else if (cols.monto >= 0) {
      monto = toNum(cell(cols.monto));
      tipo = "credito"; // sin columnas Debe/Haber no podemos distinguir; asumimos crédito
    }
    if (!Number.isFinite(monto) || monto <= 0) continue;
    transacciones.push({
      fecha: cols.fecha >= 0 ? fechaDeCelda(cell(cols.fecha)) : null,
      monto,
      tipo,
      referencia: cols.ref >= 0 && cell(cols.ref) != null ? String(cell(cols.ref)).trim() || null : null,
      descripcion: cols.desc >= 0 && cell(cols.desc) != null ? String(cell(cols.desc)).trim().slice(0, 200) || null : null,
    });
  }
  if (transacciones.length === 0) return null;
  return { moneda: null, banco: null, transacciones };
}

/** Fallback: manda el contenido (texto/CSV del Excel) a la IA para estructurarlo. */
async function extraerTransaccionesDeTexto(
  texto: string,
  opts?: { model?: string }
): Promise<{ moneda: string | null; banco: string | null; transacciones: ExtractoTx[] }> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new Error("Falta ANTHROPIC_API_KEY en el servidor");
  const anthropic = new Anthropic();
  const model = opts?.model || process.env.CONCILIACION_MODEL?.trim() || DEFAULT_MODEL;
  const msg = await withRetry(() =>
    anthropic.messages.create({
      model,
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: `${PROMPT_EXTRACCION}\n\n--- CONTENIDO DEL EXTRACTO ---\n${texto.slice(0, 120000)}` }],
        },
      ],
    })
  );
  const textPart = msg.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textPart) throw new Error("El modelo no devolvió texto");
  const obj = (extractJson(textPart.text) ?? {}) as Record<string, unknown>;
  const rawTx = Array.isArray(obj.transacciones) ? obj.transacciones : [];
  const transacciones: ExtractoTx[] = rawTx
    .map((r) => {
      const t = (r ?? {}) as Record<string, unknown>;
      return {
        fecha: typeof t.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.fecha) ? t.fecha : null,
        monto: toNum(t.monto),
        tipo: String(t.tipo ?? "").toLowerCase() === "debito" ? ("debito" as const) : ("credito" as const),
        referencia: t.referencia != null ? String(t.referencia).trim() || null : null,
        descripcion: t.descripcion != null ? String(t.descripcion).trim().slice(0, 200) || null : null,
      };
    })
    .filter((t) => Number.isFinite(t.monto) && t.monto > 0);
  return {
    moneda: typeof obj.moneda === "string" ? obj.moneda : null,
    banco: typeof obj.banco === "string" ? obj.banco : null,
    transacciones,
  };
}

/**
 * Punto de entrada: dispatch por tipo de archivo.
 *  - PDF → Claude lee el PDF (texto + visual).
 *  - Excel/CSV → parseo directo por columnas (gratis y exacto); si no se reconoce, fallback IA.
 */
export async function extraerTransacciones(
  bytes: Buffer,
  filename: string
): Promise<{ moneda: string | null; banco: string | null; transacciones: ExtractoTx[]; via: "pdf-ia" | "excel-directo" | "excel-ia" }> {
  const lower = (filename || "").toLowerCase();
  if (lower.endsWith(".pdf")) {
    return { ...(await extraerTransaccionesDeExtracto(bytes)), via: "pdf-ia" };
  }
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".csv")) {
    const directo = parseExtractoExcel(bytes);
    if (directo) return { ...directo, via: "excel-directo" };
    // No se reconocieron columnas → mandar el contenido como texto a la IA.
    const aoa = leerFilas(bytes);
    const texto = aoa.map((row) => row.map((c) => String(c ?? "")).join("\t")).join("\n");
    return { ...(await extraerTransaccionesDeTexto(texto)), via: "excel-ia" };
  }
  throw new Error("Formato no soportado (subí un PDF o un Excel)");
}

// ---- Matcheo / conciliación ----

function normRef(s: string | null | undefined): string {
  return String(s ?? "").replace(/[\s.\-/]/g, "").toLowerCase();
}
function diasEntre(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (Number.isNaN(da) || Number.isNaN(db)) return 0;
  return Math.abs(da - db) / 86400000;
}

const TOL_MONTO = 1; // GS: match exacto (tolerancia mínima por redondeo)
const TOL_DIAS = 3;

/**
 * Agrupa cobros del ERP que comparten el MISMO N° de operación (≥5 dígitos) en una sola fila
 * con el monto sumado. Ej: UMA 250k + STRATUM 250k con op 76382451 → un crédito de 500k en el
 * banco. Evita falsas alarmas de "monto difiere" / "sin respaldo" en pagos agrupados.
 */
function agruparPorOperacion(aprobados: AprobadoLite[]): AprobadoLite[] {
  const porOp = new Map<string, AprobadoLite[]>();
  const solos: AprobadoLite[] = [];
  for (const a of aprobados) {
    const op = normRef(a.numero_operacion);
    if (op.length >= 5) {
      const arr = porOp.get(op) ?? [];
      arr.push(a);
      porOp.set(op, arr);
    } else {
      solos.push(a);
    }
  }
  const out: AprobadoLite[] = [...solos];
  for (const arr of porOp.values()) {
    if (arr.length === 1) {
      out.push(arr[0]);
      continue;
    }
    const nombres = [...new Set(arr.map((x) => (x.cliente_nombre ?? x.titular ?? "").trim()).filter(Boolean))].join(" + ");
    out.push({
      ...arr[0],
      monto: arr.reduce((s, x) => s + x.monto, 0),
      cliente_nombre: nombres || arr[0].cliente_nombre,
      numero_factura: [...new Set(arr.map((x) => x.numero_factura).filter(Boolean))].join(", ") || null,
      agrupadas: arr.length,
    });
  }
  return out;
}

export function conciliar(
  aprobadosRaw: AprobadoLite[],
  extracto: { moneda: string | null; banco: string | null; transacciones: ExtractoTx[] }
): ConciliacionResult {
  const aprobados = agruparPorOperacion(aprobadosRaw);
  const creditos = extracto.transacciones.filter((t) => t.tipo === "credito");
  const usados = new Set<number>();
  const conciliados: ParMatch[] = [];
  const difieren: ParDifiere[] = [];
  const sinExtracto: AprobadoLite[] = [];

  for (const a of aprobados) {
    const aRef = normRef(a.numero_operacion);
    let idx = -1;

    // 1) Match fuerte por número de operación / referencia.
    if (aRef.length >= 3) {
      idx = creditos.findIndex((c, i) => {
        if (usados.has(i)) return false;
        const cRef = normRef(c.referencia);
        return cRef.length >= 3 && (cRef === aRef || cRef.includes(aRef) || aRef.includes(cRef));
      });
    }
    // 2) Match por monto exacto + fecha cercana.
    if (idx < 0) {
      idx = creditos.findIndex(
        (c, i) => !usados.has(i) && Math.abs(c.monto - a.monto) <= TOL_MONTO && diasEntre(c.fecha, a.fecha) <= TOL_DIAS
      );
    }

    if (idx >= 0) {
      usados.add(idx);
      const c = creditos[idx];
      const diff = Math.round(c.monto - a.monto);
      if (Math.abs(diff) > TOL_MONTO) difieren.push({ aprobado: a, credito: c, diff });
      else conciliados.push({ aprobado: a, credito: c });
    } else {
      sinExtracto.push(a);
    }
  }

  const sinRegistrar = creditos.filter((_, i) => !usados.has(i));
  const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0));

  return {
    moneda: extracto.moneda,
    banco_detectado: extracto.banco,
    conciliados,
    montos_difieren: difieren,
    aprobados_sin_extracto: sinExtracto,
    extracto_sin_registrar: sinRegistrar,
    resumen: {
      aprobados: aprobados.length,
      creditos_extracto: creditos.length,
      conciliados: conciliados.length,
      difieren: difieren.length,
      sin_extracto: sinExtracto.length,
      sin_registrar: sinRegistrar.length,
      monto_conciliado: sum(conciliados.map((p) => p.aprobado.monto)),
      monto_sin_extracto: sum(sinExtracto.map((a) => a.monto)),
      monto_sin_registrar: sum(sinRegistrar.map((c) => c.monto)),
    },
  };
}
