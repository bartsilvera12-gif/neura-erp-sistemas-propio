import "server-only";
import Anthropic from "@anthropic-ai/sdk";

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
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const s = v.replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
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

export function conciliar(
  aprobados: AprobadoLite[],
  extracto: { moneda: string | null; banco: string | null; transacciones: ExtractoTx[] }
): ConciliacionResult {
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
