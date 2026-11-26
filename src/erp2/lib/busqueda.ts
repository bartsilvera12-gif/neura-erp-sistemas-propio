/**
 * Búsqueda INTELIGENTE en el navegador (regla de oro del 2.0), para listas que ya están
 * cargadas en pantalla. Mismas reglas que la búsqueda de la base (db/canonical/19_busqueda.sql):
 *   · ignora tildes y mayúsculas ("cafe" → "Café")
 *   · palabras en cualquier orden y partes de palabra ("coca 2" → "Coca-Cola 2L")
 *   · tolera errores de tipeo ("yerva" → "Yerba", "galeta" → "Galleta")
 *   · ignora separadores en códigos ("coccol2l" → "COC-COL-2L", RUC con o sin puntos/DV)
 *   · teléfonos en cualquier forma ("0981 555 123" = "0981555123" = "+595981555123")
 *   · documentos ("pre 2", "PRE-2", "2" → PRE-000002; con exacto, solo los exactos) y
 *     montos ("512170" = "512.170")
 *   · relevancia: código/documento/monto exacto > nombre igual > empieza con > contiene >
 *     parecido (lo que solo se parece va siempre debajo de lo que coincide tal cual)
 *
 * Rendimiento: normalizar es lo caro. Cada elemento se normaliza UNA vez (cache por objeto
 * en buscar/filtrar, o un índice armado con `indexar` para listas grandes como el catálogo
 * de la caja) y cada consulta se compila UNA vez (palabras + regex), no por elemento.
 */

/** Sin tildes y en minúsculas. */
export function normalizar(t: string | null | undefined): string {
  return (t ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Sin separadores: "COC-COL-2L" → "coccol2l". */
export function compactar(t: string | null | undefined): string {
  return normalizar(t).replace(/[^a-z0-9]+/g, "");
}

/**
 * Sube arriba (sin cambiar el orden del resto) los que coinciden TAL CUAL con lo escrito en
 * alguno de sus textos (nombre, documento…), ignorando tildes, mayúsculas y separadores.
 */
export function exactosPrimero<T>(items: T[], q: string, textos: (it: T) => (string | null | undefined)[]): T[] {
  const cq = compactar(q);
  if (!cq) return items;
  const exacto = (it: T) => textos(it).some((t) => !!t && compactar(t) === cq);
  const arriba = items.filter(exacto);
  return arriba.length ? [...arriba, ...items.filter((it) => !exacto(it))] : items;
}

/** Palabras de lo que se escribió (máx. 8). */
export function tokensBusqueda(q: string): string[] {
  return normalizar(q).split(/[^a-z0-9]+/).filter(Boolean).slice(0, 8);
}

// Filas de trabajo de `distancia`, reusadas entre llamadas (se llama miles de veces por tecla).
let filaA = new Int32Array(64);
let filaB = new Int32Array(64);
let filaC = new Int32Array(64);

/** Distancia de edición (Damerau-Levenshtein simplificada) con corte temprano. */
function distancia(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = b.length;
  if (filaA.length <= n) {
    filaA = new Int32Array(n + 1);
    filaB = new Int32Array(n + 1);
    filaC = new Int32Array(n + 1);
  }
  let prev2 = filaA;
  let prev = filaB;
  let cur = filaC;
  for (let j = 0; j <= n; j++) {
    prev2[j] = 0;
    prev[j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    const ai = a.charCodeAt(i - 1);
    cur[0] = i;
    let minFila = i;
    for (let j = 1; j <= n; j++) {
      const costo = ai === b.charCodeAt(j - 1) ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + costo);
      if (i > 1 && j > 1 && ai === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < minFila) minFila = v;
    }
    if (minFila > max) return max + 1;
    // la fila de hace dos pasa a ser la de trabajo; las otras corren un lugar
    const libre = prev2;
    prev2 = prev;
    prev = cur;
    cur = libre;
  }
  return prev[n];
}

/** Trigramas como los de Postgres (pg_trgm): "  y", " ye", "yer", … */
function trigramas(p: string): Set<string> {
  const t = `  ${p} `;
  const r = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) r.add(t.slice(i, i + 3));
  return r;
}

// Los trigramas de las palabras del texto se repiten entre consultas: se recuerdan.
const trigramasPalabra = new Map<string, Set<string>>();
function trigramasDe(p: string): Set<string> {
  let r = trigramasPalabra.get(p);
  if (!r) {
    if (trigramasPalabra.size >= 50_000) trigramasPalabra.clear();
    trigramasPalabra.set(p, (r = trigramas(p)));
  }
  return r;
}

/** Qué parte de los trigramas de la palabra escrita (a) aparecen en otra (b) (≈ word_similarity). */
function parecidoTrigramas(a: Set<string>, b: Set<string>): number {
  let comunes = 0;
  for (const x of a) if (b.has(x)) comunes++;
  return comunes / a.size;
}

/** Errores de tipeo tolerados según el largo de la palabra. */
const tolerancia = (n: number) => (n >= 8 ? 2 : n >= 4 ? 1 : 0);

export type CamposBusqueda = {
  /** Lo que más importa (el nombre): define "igual" y "empieza con". */
  principal?: string | null;
  /** Otros campos donde buscar (SKU, categoría, RUC, teléfono…). */
  otros?: (string | number | null | undefined)[];
  /** Códigos que, si se escriben exactos (con o sin separadores), van primero.
   *  Un RUC con DV ("80012345-6") también cuenta exacto escrito sin el DV ("80012345"). */
  codigos?: (string | null | undefined)[];
  /** Números de documento (VTA-000123, PRE-000002, #15…): "pre 2", "PRE-2" o "2" encuentran
   *  PRE-000002 exacto y, si lo hay, la lista muestra solo los exactos (sin basura). */
  documentos?: (string | number | null | undefined)[];
  /** Montos (total, saldo…): "512170" o "512.170" los encuentran exactos y van primero. */
  montos?: (number | string | null | undefined)[];
};

// ── Pre-cálculo ──────────────────────────────────────────────────────────────

/** Un elemento ya normalizado, listo para puntuar contra cualquier consulta. */
type Preparado = {
  principal: string;
  texto: string;
  /** Palabras del texto sin repetir (la repetida daría lo mismo que la primera). */
  palabras: string[];
  /** Códigos compactados (para "código exacto va primero"). */
  codigos: string[];
  /** Documentos: letras del prefijo + número sin ceros a la izquierda. */
  documentos: { letras: string; numero: string }[];
  montos: number[];
};

/**
 * Formas de un teléfono de Paraguay que se buscan igual: "0981 555 123", "0981555123",
 * "+595981555123" y "981555123" son el mismo número. Vacío si no parece un teléfono.
 */
function variantesTelefono(digitos: string): string[] {
  if (digitos.length < 7 || digitos.length > 15) return [];
  if (digitos.startsWith("595")) return [`0${digitos.slice(3)}`, digitos.slice(3)];
  if (digitos.startsWith("0")) return [`595${digitos.slice(1)}`, digitos.slice(1)];
  return [];
}

/** Documento "PRE-000002" → { letras: "pre", numero: "2" }; null si no tiene esa forma. */
function partesDocumento(t: string): { letras: string; numero: string } | null {
  const m = /^#?\s*([a-z]{0,12})[^a-z0-9]*0*(\d{1,15})$/.exec(normalizar(t).trim());
  return m ? { letras: m[1], numero: m[2] } : null;
}

/** "512170", "512.170", "Gs. 512.170" o "12,50" → número; null si no es un monto. */
function montoDe(q: string): number | null {
  const t = normalizar(q).trim().replace(/^(gs\.?|₲|\$|usd)\s*/, "");
  if (!/^(\d{1,3}(\.\d{3})+|\d{1,15})(,\d{1,2})?$/.test(t)) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Palabras genéricas de "número" que pueden ir antes del número ("n° 15", "nro 15"). */
const PALABRAS_NUMERO = new Set(["", "n", "nro", "num", "numero"]);

function preparar(c: CamposBusqueda): Preparado {
  const principal = normalizar(c.principal);
  const partes = [c.principal, ...(c.otros ?? []), ...(c.codigos ?? []), ...(c.documentos ?? [])].map((x) => (x == null ? "" : String(x)));
  const trozos: string[] = [];
  for (const p of partes) {
    const n = normalizar(p);
    const comp = compactar(p);
    trozos.push(n, comp);
    // teléfonos: también en sus otras formas (con 0 / con 595 / sin prefijo)
    if (/^\d+$/.test(comp)) trozos.push(...variantesTelefono(comp));
  }
  const texto = trozos.join(" ");
  const palabras = [...new Set(texto.split(/[^a-z0-9]+/).filter(Boolean))];
  const codigos: string[] = [];
  for (const cod of c.codigos ?? []) {
    if (!cod) continue;
    const comp = compactar(cod);
    codigos.push(comp);
    // RUC / CI con dígito verificador: exacto también sin el DV
    const sinDv = /^\s*([\d.]+)\s*-\s*\d\s*$/.exec(cod);
    if (sinDv) codigos.push(compactar(sinDv[1]));
    // teléfono: exacto en cualquiera de sus formas
    if (/^\d+$/.test(comp)) codigos.push(...variantesTelefono(comp));
  }
  const documentos: Preparado["documentos"] = [];
  for (const d of c.documentos ?? []) {
    if (d == null || d === "") continue;
    const p = partesDocumento(String(d));
    if (p) documentos.push(p);
  }
  const montos: number[] = [];
  for (const m of c.montos ?? []) {
    const n = m == null || m === "" ? NaN : Number(m);
    if (Number.isFinite(n)) montos.push(n);
  }
  return { principal, texto, palabras, codigos, documentos, montos };
}

type Token = {
  t: string;
  /** Errores de tipeo tolerados (0 = tiene que estar tal cual). */
  max: number;
  trig: Set<string> | null;
  /** Parecido ya calculado contra cada palabra: en un catálogo las palabras se repiten
   *  mucho entre elementos, así cada una se compara una sola vez por consulta. */
  memo: Map<string, number>;
  entera: RegExp;
  inicio: RegExp;
  /** Singulares posibles de una palabra en plural ("galletas" → "galleta", "panes" → "pan"): cuentan como coincidencia tal cual. */
  singulares: string[];
};

/** Lo escrito, compilado una vez: palabras (con sus regex), frase, código, documento y monto. */
type Consulta = {
  tokens: Token[];
  qn: string;
  qc: string;
  /** "pre 2" / "PRE-000002" / "#15" / "2": letras del prefijo y número sin ceros. */
  doc: { letras: string; numero: string } | null;
  monto: number | null;
};

// Puntajes de las coincidencias exactas (siempre por encima de cualquier parecido).
const P_CODIGO = 1000;
const P_DOCUMENTO = 950;
const P_MONTO = 900;

/** ¿El documento del elemento es el número escrito? El prefijo, si se escribió, tiene que
 *  ser el del documento: "pre 2", "p 2" o "presupuesto 2" traen PRE-000002, pero "aj 1" no
 *  trae PE-000001 y "rosa 2" no trae nada por número. "n°"/"nro" no se exigen. */
function documentoIgual(q: { letras: string; numero: string }, d: { letras: string; numero: string }): boolean {
  if (q.numero !== d.numero) return false;
  if (PALABRAS_NUMERO.has(q.letras)) return true;
  return !!d.letras && (d.letras.startsWith(q.letras) || q.letras.startsWith(d.letras));
}

function compilar(q: string): Consulta {
  const tokens = tokensBusqueda(q).map((t): Token => {
    // Los números (RUC, CI, teléfono, montos) no se "corrigen": tienen que coincidir.
    const max = /[a-z]/.test(t) ? tolerancia(t.length) : 0;
    return {
      t,
      max,
      trig: max ? trigramas(t) : null,
      memo: new Map(),
      // t solo tiene [a-z0-9] (sale de tokensBusqueda): es seguro dentro de la regex.
      entera: new RegExp(`(^|[^a-z0-9])${t}($|[^a-z0-9])`),
      inicio: new RegExp(`(^|[^a-z0-9])${t}`),
      singulares: /^[a-z]{4,}s$/.test(t) ? [t.slice(0, -1), ...(t.endsWith("es") && t.length > 4 ? [t.slice(0, -2)] : [])].filter((s) => s.length >= 3) : [],
    };
  });
  return { tokens, qn: normalizar(q).trim(), qc: compactar(q), doc: partesDocumento(q), monto: montoDe(q) };
}

/**
 * Qué tan bien coincide una palabra con el texto: 1 = contenida, 0.6 = parecida
 * (error de tipeo contra alguna palabra o el comienzo de una palabra), 0 = no.
 */
function coincidePalabra(tok: Token, e: Preparado): number {
  if (e.texto.includes(tok.t)) return 1;
  if (tok.singulares.some((s) => e.texto.includes(s))) return 1;
  if (!tok.max) return 0;
  for (const p of e.palabras) {
    let v = tok.memo.get(p);
    if (v === undefined) tok.memo.set(p, (v = parecida(tok, p)));
    if (v) return v;
  }
  return 0;
}

/** Parecido de la palabra escrita con UNA palabra del texto: 0.6, 0.5 o 0. */
function parecida(tok: Token, p: string): number {
  const { t, max } = tok;
  if (distancia(t, p, max) <= max) return 0.6;
  // mismo criterio que la base: la mitad de los trigramas en común ("galeta" → "galletitas")
  if (parecidoTrigramas(tok.trig!, trigramasDe(p)) >= 0.5) return 0.5;
  // la palabra escrita puede ser el comienzo (con error) de una más larga: "galet" → "galletas"
  if (p.length > t.length && (distancia(t, p.slice(0, t.length), max) <= max || distancia(t, p.slice(0, t.length + 1), max) <= max)) return 0.5;
  return 0;
}

/** Puntaje de un elemento preparado contra una consulta compilada (0 = no coincide). */
function puntaje(cq: Consulta, e: Preparado): number {
  if (!cq.tokens.length) return 1;
  if (cq.qc && e.codigos.includes(cq.qc)) return P_CODIGO;
  const { doc } = cq;
  if (doc && e.documentos.some((d) => documentoIgual(doc, d))) return P_DOCUMENTO;
  if (cq.monto != null && e.montos.includes(cq.monto)) return P_MONTO;

  let suma = 0;
  let todasReales = true;
  for (const tok of cq.tokens) {
    const m = coincidePalabra(tok, e);
    if (!m) return 0; // todas las palabras tienen que aparecer (o parecerse)
    // palabra entera en el nombre > comienzo de una palabra > contenida > parecida
    if (m === 1) {
      // El singular ("panes" → "pan") también puntúa como palabra entera / comienzo.
      const entera = tok.entera.test(e.principal) || tok.singulares.some((s) => new RegExp(`(^|[^a-z0-9])${s}($|[^a-z0-9])`).test(e.principal));
      const inicio = entera || tok.inicio.test(e.principal) || tok.singulares.some((s) => new RegExp(`(^|[^a-z0-9])${s}`).test(e.principal));
      suma += entera ? 40 : inicio ? 30 : 20;
    }
    else {
      suma += 10;
      todasReales = false;
    }
  }
  const { qn } = cq;
  const fraseDe = (f: string) => (e.principal === f ? 400 : e.principal.startsWith(f) ? 300 : e.principal.includes(f) ? 200 : 0);
  // También la frase en singular ("tomates" → "Tomate" va antes que "Salsa de tomate").
  const qs = qn.split(" ").map((w) => (/^[a-z]{4,}s$/.test(w) ? w.slice(0, -1) : w)).join(" ");
  const frase = Math.max(fraseDe(qn), qs !== qn ? fraseDe(qs) : 0);
  // lo que coincide tal cual va siempre antes que lo que solo se parece (error de tipeo)
  return frase + suma + (todasReales ? 100 : 0);
}

/** ¿Lo escrito es un número de la serie de este elemento? ("pre 9" y PRE-000001: sí). */
function deLaSerie(cq: Consulta, e: Preparado): boolean {
  const l = cq.doc?.letras;
  if (!l || PALABRAS_NUMERO.has(l)) return false;
  return e.documentos.some((d) => !!d.letras && (d.letras.startsWith(l) || l.startsWith(d.letras)));
}

/**
 * Con un número de documento exacto ("pre 2", "#15") la lista muestra solo los exactos; con
 * un número de la serie que no existe ("pre 9") no muestra nada (en vez de todo lo que tenga
 * "pre" y un 9 en algún lado).
 */
function soloExactos<T extends { p: number }>(cq: Consulta, r: T[], serie: boolean): T[] {
  if (!cq.doc || (!serie && !r.some((x) => x.p === P_DOCUMENTO))) return r;
  return r.filter((x) => x.p >= P_DOCUMENTO);
}

/**
 * Si algo coincide tal cual (todas las palabras escritas están, sin errores de tipeo), lo que
 * solo "se parece" no se muestra: "coca" trae Coca-Cola y no "Mate cocido". Si nada coincide
 * tal cual, quedan los parecidos ("galeta" sigue encontrando "Galletitas").
 */
function soloReales<T extends { p: number }>(r: T[]): T[] {
  return r.some((x) => x.p >= 100) ? r.filter((x) => x.p >= 100) : r;
}

// Cache por objeto para buscar/filtrar: el mismo elemento no se re-normaliza en cada tecla.
// La clave son los textos crudos: si el objeto cambió (o se busca con otros campos) se
// vuelve a preparar, así el resultado es siempre idéntico al de sin cache.
const SEP = "\u0001";
const cache = new WeakMap<object, { clave: string; e: Preparado }>();

function claveDe(c: CamposBusqueda): string {
  const s = (x: unknown) => (x == null ? "" : String(x));
  return [s(c.principal), (c.otros ?? []).map(s).join(SEP), (c.codigos ?? []).map(s).join(SEP),
    (c.documentos ?? []).map(s).join(SEP), (c.montos ?? []).map(s).join(SEP)].join(`${SEP}${SEP}`);
}

function preparado<T>(it: T, campos: (it: T) => CamposBusqueda): Preparado {
  const c = campos(it);
  if (typeof it !== "object" || it === null) return preparar(c);
  const clave = claveDe(c);
  const hit = cache.get(it);
  if (hit && hit.clave === clave) return hit.e;
  const e = preparar(c);
  cache.set(it, { clave, e });
  return e;
}

function ordenar<T>(items: T[], cq: Consulta, prep: (it: T, i: number) => Preparado, limite?: number): T[] {
  let r: { it: T; i: number; p: number }[] = [];
  let serie = false;
  for (let i = 0; i < items.length; i++) {
    const e = prep(items[i], i);
    const p = puntaje(cq, e);
    if (p > 0) r.push({ it: items[i], i, p });
    if (!serie && cq.doc && e.documentos.length) serie = deLaSerie(cq, e);
  }
  r = soloReales(soloExactos(cq, r, serie));
  r.sort((a, b) => b.p - a.p || a.i - b.i);
  const out = r.map((x) => x.it);
  return limite != null ? out.slice(0, limite) : out;
}

/** Puntaje de un elemento para la búsqueda (0 = no coincide). */
export function puntajeBusqueda(q: string, c: CamposBusqueda): number {
  const cq = compilar(q);
  if (!cq.tokens.length) return 1;
  return puntaje(cq, preparar(c));
}

/** Filtra y ORDENA por relevancia (para buscadores donde lo más parecido va primero). */
export function buscar<T>(items: T[], q: string, campos: (it: T) => CamposBusqueda): T[] {
  const cq = compilar(q);
  if (!cq.tokens.length) return items;
  return ordenar(items, cq, (it) => preparado(it, campos));
}

/**
 * Filtra sin cambiar el orden (para tablas con su propio orden elegido), salvo las
 * coincidencias exactas (código, documento, monto), que suben arriba de todo.
 */
export function filtrar<T>(items: T[], q: string, campos: (it: T) => CamposBusqueda): T[] {
  const cq = compilar(q);
  if (!cq.tokens.length) return items;
  let r: { it: T; i: number; p: number }[] = [];
  let serie = false;
  for (let i = 0; i < items.length; i++) {
    const e = preparado(items[i], campos);
    const p = puntaje(cq, e);
    if (p > 0) r.push({ it: items[i], i, p });
    if (!serie && cq.doc && e.documentos.length) serie = deLaSerie(cq, e);
  }
  r = soloReales(soloExactos(cq, r, serie));
  const exacta = (p: number) => (p >= P_MONTO ? 1 : 0);
  r.sort((a, b) => exacta(b.p) - exacta(a.p) || a.i - b.i);
  return r.map((x) => x.it);
}

/** ¿Coincide? (para resaltar o mostrar/ocultar algo puntual). */
export function coincide(q: string, campos: CamposBusqueda): boolean {
  return puntajeBusqueda(q, campos) > 0;
}

// ── Índice: listas grandes que se buscan en cada tecla (ej. el catálogo de la caja) ──

/** Lista normalizada una sola vez. Armala con useMemo (se rehace solo si cambia la lista). */
export type IndiceBusqueda<T> = { items: T[]; preparados: Preparado[] };

export function indexar<T>(items: T[], campos: (it: T) => CamposBusqueda): IndiceBusqueda<T> {
  return { items, preparados: items.map((it) => preparar(campos(it))) };
}

/** Igual que `buscar` (mismos resultados, mismo orden) pero sobre un índice; `limite` recorta. */
export function buscarEnIndice<T>(indice: IndiceBusqueda<T>, q: string, limite?: number): T[] {
  const cq = compilar(q);
  if (!cq.tokens.length) return limite != null ? indice.items.slice(0, limite) : indice.items;
  return ordenar(indice.items, cq, (_it, i) => indice.preparados[i], limite);
}
