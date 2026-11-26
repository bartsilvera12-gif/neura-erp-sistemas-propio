/**
 * Consolidación de los TRES reportes del catálogo inicial en un único producto.
 *
 *   1. Productos        → código interno, código fábrica, descripción, stock,
 *                         costo, costo mayorista (algunos), precio venta, unidad.
 *   2. Stock General    → código fábrica, descripción, CATEGORÍA, código barras, stock.
 *   3. Stock Valorizado → código interno, código fábrica, descripción, código
 *                         barras, IVA, stock, costo unitario, precio venta.
 *
 * Cruce, en este orden (el primero que da match manda):
 *   1) código interno  2) código de barras  3) código de fábrica  4) descripción
 *
 * Un dato faltante en un reporte se completa con el de otro. Cuando dos reportes
 * traen el MISMO campo con valores distintos, se registra un conflicto para que
 * el usuario lo revise antes de importar (no se decide en silencio).
 */
/** trim + MAYÚSCULAS; null/undefined → "" (igual que en Ferretería). */
const normalizeUpperText = (v: unknown): string => (v == null ? "" : String(v).trim().toUpperCase());

export type Fuente = "productos" | "stock_general" | "stock_valorizado";

export const FUENTE_LABEL: Record<Fuente, string> = {
  productos: "Productos",
  stock_general: "Stock General",
  stock_valorizado: "Stock Valorizado",
};

/** Alias aceptados por columna. Se comparan normalizados (sin acentos/espacios). */
const ALIAS = {
  codigo_interno: ["CODIGOINTERNO", "CODINTERNO", "CODIGO", "COD", "INTERNO", "CODART", "CODIGOARTICULO"],
  codigo_fabrica: ["CODIGOFABRICA", "CODFABRICA", "CODIGODEFABRICA", "FABRICA", "CODIGOPROVEEDOR", "CODFAB", "CODIGOORIGINAL"],
  codigo_barras: ["CODIGOBARRAS", "CODBARRAS", "CODIGODEBARRAS", "BARRAS", "EAN", "CODIGOEAN", "BARCODE"],
  descripcion: ["DESCRIPCION", "DETALLE", "NOMBRE", "PRODUCTO", "ARTICULO", "DESCRIPCIONARTICULO"],
  categoria: ["CATEGORIA", "FAMILIA", "RUBRO", "CATEGORIAFAMILIA", "GRUPO", "LINEA"],
  unidad: ["UNIDAD", "UNIDADMEDIDA", "UNIDADDEMEDIDA", "UM", "MEDIDA"],
  stock: ["STOCK", "EXISTENCIA", "EXISTENCIAS", "CANTIDAD", "STOCKACTUAL", "SALDO"],
  costo: ["PRECIOCOSTO", "COSTO", "COSTOUNITARIO", "PRECIODECOSTO", "COSTOPROMEDIO", "PCOSTO"],
  costo_mayorista: ["PRECIOCOSTOMAYORISTA", "COSTOMAYORISTA", "PRECIODECOSTOMAYORISTA", "COSTOMAYOR"],
  precio_venta: ["PRECIOVENTA", "PRECIO", "PRECIODEVENTA", "PVENTA", "VENTA"],
  iva: ["IVA", "IMPUESTO", "ALICUOTA", "TIPOIVA"],
} as const;

type CampoAlias = keyof typeof ALIAS;

/** Normaliza un encabezado para comparar: sin acentos, sin separadores, mayúsculas. */
function normHeader(h: string): string {
  return String(h ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Mapa encabezado-del-archivo → campo lógico, resuelto por alias. */
export type MapeoColumnas = Partial<Record<CampoAlias, string>>;

export function detectarColumnas(headers: string[]): MapeoColumnas {
  const mapeo: MapeoColumnas = {};
  const usados = new Set<string>();
  const entradas = Object.entries(ALIAS) as [CampoAlias, readonly string[]][];

  // PASO 1 — match exacto. Va primero para TODOS los campos: si no, un alias
  // corto y goloso ("CODIGO" de código interno) se queda por prefijo con la
  // columna "CODIGO FABRICA", que tiene su propio alias exacto.
  for (const [campo, alias] of entradas) {
    const hit = headers.find((h) => !usados.has(h) && alias.includes(normHeader(h)));
    if (hit) { mapeo[campo] = hit; usados.add(hit); }
  }

  // PASO 2 — match por prefijo para lo que quedó sin resolver, probando
  // primero los alias más largos (más específicos).
  const pendientes = entradas
    .filter(([campo]) => !mapeo[campo])
    .flatMap(([campo, alias]) => alias.map((a) => ({ campo, a })))
    .sort((x, y) => y.a.length - x.a.length);

  for (const { campo, a } of pendientes) {
    if (mapeo[campo]) continue;
    const hit = headers.find((h) => !usados.has(h) && normHeader(h).startsWith(a));
    if (hit) { mapeo[campo] = hit; usados.add(hit); }
  }
  return mapeo;
}

function val(row: Record<string, string>, mapeo: MapeoColumnas, campo: CampoAlias): string {
  const col = mapeo[campo];
  if (!col) return "";
  return String(row[col] ?? "").trim();
}

/** Número tolerante a "1.234,56", "1,234.56", "Gs. 1.234" y vacío → null. */
export function parseNumero(raw: string): number | null {
  // Quitamos símbolos ("Gs.", "$") y los separadores sueltos que quedan en los
  // bordes, si no "Gs. 15.000" se convierte en ".15.000" y no parsea.
  const s = String(raw ?? "")
    .replace(/[^\d,.\-]/g, "")
    .replace(/^[^\d-]+/, "")
    .replace(/[.,]+$/, "")
    .trim();
  if (!s) return null;

  let limpio = s;
  const tieneComa = s.includes(",");
  const tienePunto = s.includes(".");
  // Dígitos que siguen al ÚLTIMO separador: si son exactamente 3, era de miles.
  const ultimoSep = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
  const cola = ultimoSep >= 0 ? s.slice(ultimoSep + 1) : "";

  if (tieneComa && tienePunto) {
    // El separador decimal es el último que aparece.
    limpio = s.lastIndexOf(",") > s.lastIndexOf(".")
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "");
  } else if (tieneComa) {
    limpio = cola.length === 3 ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (tienePunto) {
    limpio = cola.length === 3 ? s.replace(/\./g, "") : s;
  }
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

/** IVA a la representación del ERP. "10", "10%", "0,1" → "10%". */
export function parseIva(raw: string): "10%" | "5%" | "EXENTA" | null {
  const s = normHeader(raw);
  if (!s) return null;
  if (s.includes("EXENT") || s.includes("EXO")) return "EXENTA";
  const n = parseNumero(raw);
  if (n === null) return null;
  if (n === 0) return "EXENTA";
  if (n === 5 || n === 0.05) return "5%";
  if (n === 10 || n === 0.1) return "10%";
  return n < 1 ? (n <= 0.05 ? "5%" : "10%") : n <= 5 ? "5%" : "10%";
}

/** Unidad de medida normalizada. */
export function parseUnidad(raw: string): string {
  const s = normHeader(raw);
  if (!s) return "";
  if (s.startsWith("UNID") || s === "UN" || s === "U") return "UNIDAD";
  if (s.startsWith("METRO") || s === "MT" || s === "M") return "METRO";
  if (s.startsWith("KILO") || s === "KG" || s === "K") return "KILOGRAMO";
  if (s.startsWith("LITRO") || s === "LT" || s === "L") return "LITRO";
  return normalizeUpperText(raw);
}

/** Fila cruda ya normalizada de cualquiera de los 3 reportes. */
export interface FilaNormalizada {
  fuente: Fuente;
  fila: number;
  codigo_interno: string;
  codigo_fabrica: string;
  codigo_barras: string;
  descripcion: string;
  categoria: string;
  unidad: string;
  stock: number | null;
  costo: number | null;
  costo_mayorista: number | null;
  precio_venta: number | null;
  iva: "10%" | "5%" | "EXENTA" | null;
}

export function normalizarFilas(
  fuente: Fuente,
  headers: string[],
  rows: Record<string, string>[]
): { filas: FilaNormalizada[]; mapeo: MapeoColumnas } {
  const mapeo = detectarColumnas(headers);
  const filas = rows.map((r, i): FilaNormalizada => ({
    fuente,
    fila: i + 2, // +2: fila 1 son los encabezados
    codigo_interno: normalizeUpperText(val(r, mapeo, "codigo_interno")),
    codigo_fabrica: normalizeUpperText(val(r, mapeo, "codigo_fabrica")),
    codigo_barras: normalizeUpperText(val(r, mapeo, "codigo_barras")),
    descripcion: normalizeUpperText(val(r, mapeo, "descripcion")),
    categoria: normalizeUpperText(val(r, mapeo, "categoria")),
    unidad: parseUnidad(val(r, mapeo, "unidad")),
    stock: parseNumero(val(r, mapeo, "stock")),
    costo: parseNumero(val(r, mapeo, "costo")),
    costo_mayorista: parseNumero(val(r, mapeo, "costo_mayorista")),
    precio_venta: parseNumero(val(r, mapeo, "precio_venta")),
    iva: parseIva(val(r, mapeo, "iva")),
  }));
  return { filas, mapeo };
}

// ── Consolidación ───────────────────────────────────────────────────────────

export type CampoConsolidado =
  | "codigo_interno" | "codigo_fabrica" | "codigo_barras" | "descripcion"
  | "categoria" | "unidad" | "stock" | "costo" | "costo_mayorista"
  | "precio_venta" | "iva";

export interface Conflicto {
  campo: CampoConsolidado;
  /** Valor elegido (el de mayor prioridad de fuente). */
  elegido: string;
  /** Todos los valores vistos, por fuente. */
  valores: { fuente: Fuente; valor: string }[];
}

export type CriterioMatch = "codigo_interno" | "codigo_barras" | "codigo_fabrica" | "descripcion";

export interface ProductoConsolidado {
  clave: string;
  /** Cómo se cruzaron las filas de los distintos reportes. */
  matched_por: CriterioMatch[];
  fuentes: Fuente[];
  codigo_interno: string;
  codigo_fabrica: string;
  codigo_barras: string;
  descripcion: string;
  categoria: string;
  unidad: string;
  stock: number | null;
  costo: number | null;
  costo_mayorista: number | null;
  precio_venta: number | null;
  iva: "10%" | "5%" | "EXENTA";
  conflictos: Conflicto[];
  faltantes: CampoConsolidado[];
  errores: string[];
  /** Producto ya existente en el ERP con el que coincide (si lo hay). */
  match_existente_id?: string | null;
}

/**
 * Prioridad de fuente por campo: cuando hay conflicto, gana el reporte que es
 * "dueño" natural de ese dato. Igual se reporta el conflicto.
 */
const PRIORIDAD: Record<CampoConsolidado, Fuente[]> = {
  codigo_interno:  ["productos", "stock_valorizado", "stock_general"],
  codigo_fabrica:  ["productos", "stock_valorizado", "stock_general"],
  // El código de barras solo lo traen estos dos.
  codigo_barras:   ["stock_valorizado", "stock_general", "productos"],
  descripcion:     ["productos", "stock_valorizado", "stock_general"],
  // La categoría SOLO viene de Stock General.
  categoria:       ["stock_general", "productos", "stock_valorizado"],
  // La unidad SOLO viene de Productos.
  unidad:          ["productos", "stock_general", "stock_valorizado"],
  // Stock Valorizado es el corte contable: manda para stock y costo.
  stock:           ["stock_valorizado", "productos", "stock_general"],
  costo:           ["stock_valorizado", "productos", "stock_general"],
  costo_mayorista: ["productos", "stock_valorizado", "stock_general"],
  precio_venta:    ["stock_valorizado", "productos", "stock_general"],
  iva:             ["stock_valorizado", "productos", "stock_general"],
};

const CAMPOS_TEXTO: CampoConsolidado[] = [
  "codigo_interno", "codigo_fabrica", "codigo_barras", "descripcion", "categoria", "unidad",
];
const CAMPOS_NUM: CampoConsolidado[] = ["stock", "costo", "costo_mayorista", "precio_venta"];

/**
 * Campos donde una diferencia entre reportes SÍ es un conflicto a revisar
 * (los que pidió el cliente). La descripción y los códigos no entran: la
 * descripción difiere solo por truncado y los códigos son la propia llave.
 */
const CAMPOS_CONFLICTO = new Set<CampoConsolidado>([
  "stock", "costo", "costo_mayorista", "precio_venta", "iva", "codigo_barras", "unidad",
]);

/** Descripción normalizada para el match de último recurso. */
function claveDescripcion(d: string): string {
  return normHeader(d);
}

function fmt(campo: CampoConsolidado, v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (CAMPOS_NUM.includes(campo)) return String(v);
  return String(v);
}

/**
 * Cruza las filas de los 3 reportes y devuelve un catálogo consolidado.
 * Nunca genera duplicados: cada fila se suma a un grupo existente o crea uno.
 */
export function consolidar(todas: FilaNormalizada[]): ProductoConsolidado[] {
  interface Grupo {
    filas: FilaNormalizada[];
    matched_por: Set<CriterioMatch>;
    /** Identificadores ya vistos en el grupo, para detectar contradicciones. */
    internos: Set<string>;
    barras: Set<string>;
    fabricas: Set<string>;
  }
  const grupos: Grupo[] = [];
  // Índices para encontrar el grupo de una fila sin recorrer todo.
  const porInterno = new Map<string, Grupo>();
  const porBarras = new Map<string, Grupo>();
  const porFabrica = new Map<string, Grupo>();
  const porDescripcion = new Map<string, Grupo>();

  const indexar = (g: Grupo, f: FilaNormalizada) => {
    if (f.codigo_interno) { porInterno.set(f.codigo_interno, g); g.internos.add(f.codigo_interno); }
    if (f.codigo_barras) { porBarras.set(f.codigo_barras, g); g.barras.add(f.codigo_barras); }
    if (f.codigo_fabrica) { porFabrica.set(f.codigo_fabrica, g); g.fabricas.add(f.codigo_fabrica); }
    const cd = claveDescripcion(f.descripcion);
    if (cd) porDescripcion.set(cd, g);
  };

  /**
   * Un cruce por un criterio débil no puede unir dos productos que un
   * identificador MÁS FUERTE ya distingue: dos artículos que se llaman igual
   * pero tienen distinto código interno son productos distintos.
   * Solo se miran las claves más fuertes que la usada, así una diferencia de
   * código de barras entre reportes sigue siendo un conflicto a revisar y no
   * parte el producto en dos.
   */
  const contradice = (g: Grupo, f: FilaNormalizada, criterio: CriterioMatch): boolean => {
    const choca = (set: Set<string>, v: string) => !!v && set.size > 0 && !set.has(v);
    if (criterio === "codigo_interno") return false;
    if (choca(g.internos, f.codigo_interno)) return true;
    if (criterio === "codigo_barras") return false;
    if (choca(g.barras, f.codigo_barras)) return true;
    if (criterio === "codigo_fabrica") return false;
    return choca(g.fabricas, f.codigo_fabrica);
  };

  for (const f of todas) {
    // Orden de cruce pedido: interno → barras → fábrica → descripción.
    const candidatos: [CriterioMatch, Grupo | undefined][] = [
      ["codigo_interno", f.codigo_interno ? porInterno.get(f.codigo_interno) : undefined],
      ["codigo_barras", f.codigo_barras ? porBarras.get(f.codigo_barras) : undefined],
      ["codigo_fabrica", f.codigo_fabrica ? porFabrica.get(f.codigo_fabrica) : undefined],
      ["descripcion", porDescripcion.get(claveDescripcion(f.descripcion))],
    ];

    let g: Grupo | undefined;
    let criterio: CriterioMatch | null = null;
    for (const [c, cand] of candidatos) {
      if (cand && !contradice(cand, f, c)) { g = cand; criterio = c; break; }
    }

    if (g) {
      g.filas.push(f);
      if (criterio) g.matched_por.add(criterio);
    } else {
      g = { filas: [f], matched_por: new Set(), internos: new Set(), barras: new Set(), fabricas: new Set() };
      grupos.push(g);
    }
    indexar(g, f);
  }

  return grupos.map((g): ProductoConsolidado => {
    const conflictos: Conflicto[] = [];
    const faltantes: CampoConsolidado[] = [];
    const errores: string[] = [];

    /** Elige el valor de un campo según prioridad de fuente y detecta conflictos. */
    function elegir(campo: CampoConsolidado): unknown {
      const vistos: { fuente: Fuente; valor: string }[] = [];
      const porFuente = new Map<Fuente, unknown>();
      for (const f of g.filas) {
        const v = (f as unknown as Record<string, unknown>)[campo];
        if (v === null || v === undefined || v === "") continue;
        // Si la misma fuente repite el campo con distinto valor, gana el primero.
        if (!porFuente.has(f.fuente)) porFuente.set(f.fuente, v);
        vistos.push({ fuente: f.fuente, valor: fmt(campo, v) });
      }
      // costo_mayorista e iva son opcionales (default 10%): no son "faltantes".
      if (porFuente.size === 0) {
        if (campo !== "costo_mayorista" && campo !== "iva") faltantes.push(campo);
        return null;
      }

      let elegido: unknown = null;
      if (campo === "descripcion") {
        // El reporte Productos trunca la descripción; Valorizado la trae
        // completa. Nos quedamos con la más larga (la más informativa).
        for (const v of porFuente.values()) {
          if (elegido === null || String(v).length > String(elegido).length) elegido = v;
        }
      } else {
        // Valor ganador por prioridad de fuente.
        for (const fuente of PRIORIDAD[campo]) {
          if (porFuente.has(fuente)) { elegido = porFuente.get(fuente); break; }
        }
        if (elegido === null) elegido = [...porFuente.values()][0];
      }

      // Conflicto: más de un valor DISTINTO entre fuentes, solo en los campos
      // que el cliente quiere revisar (no la descripción ni los códigos-llave).
      if (CAMPOS_CONFLICTO.has(campo)) {
        const distintos = new Set(vistos.map((v) => v.valor));
        if (distintos.size > 1) {
          conflictos.push({ campo, elegido: fmt(campo, elegido), valores: vistos });
        }
      }
      return elegido;
    }

    const out: Record<string, unknown> = {};
    for (const campo of [...CAMPOS_TEXTO, ...CAMPOS_NUM, "iva" as CampoConsolidado]) {
      out[campo] = elegir(campo);
    }

    const descripcion = String(out.descripcion ?? "");
    if (!descripcion) errores.push("Sin descripción: no se puede crear el producto.");

    const clave =
      String(out.codigo_interno || "") ||
      String(out.codigo_barras || "") ||
      String(out.codigo_fabrica || "") ||
      claveDescripcion(descripcion);

    return {
      clave,
      matched_por: [...g.matched_por],
      fuentes: [...new Set(g.filas.map((f) => f.fuente))],
      codigo_interno: String(out.codigo_interno ?? ""),
      codigo_fabrica: String(out.codigo_fabrica ?? ""),
      codigo_barras: String(out.codigo_barras ?? ""),
      descripcion,
      categoria: String(out.categoria ?? ""),
      unidad: String(out.unidad ?? "") || "UNIDAD",
      stock: (out.stock as number | null) ?? null,
      costo: (out.costo as number | null) ?? null,
      costo_mayorista: (out.costo_mayorista as number | null) ?? null,
      precio_venta: (out.precio_venta as number | null) ?? null,
      // 99,9% de los productos van al 10%: es el default si el reporte no lo trae.
      iva: (out.iva as "10%" | "5%" | "EXENTA" | null) ?? "10%",
      conflictos,
      faltantes,
      errores,
    };
  });
}

/**
 * El ERP exige código de barras único (índice parcial). Los archivos del
 * cliente traen barcodes repetidos entre productos distintos (errores de
 * carga en origen). Conservamos el barcode en el primer producto y lo dejamos
 * en null en los siguientes: el producto conserva su identidad por código
 * interno. Devuelve cuántos barcodes se anularon.
 */
export function nullificarBarrasDuplicados(items: ProductoConsolidado[]): number {
  const vistos = new Set<string>();
  let anulados = 0;
  for (const it of items) {
    if (!it.codigo_barras) continue;
    if (vistos.has(it.codigo_barras)) {
      it.codigo_barras = "";
      anulados++;
    } else {
      vistos.add(it.codigo_barras);
    }
  }
  return anulados;
}

export interface ResumenConsolidacion {
  total: number;
  con_conflictos: number;
  con_faltantes: number;
  con_errores: number;
  nuevos: number;
  existentes: number;
  por_fuente: Record<Fuente, number>;
  /** Cuántos productos se cruzaron por cada criterio. */
  por_criterio: Record<CriterioMatch, number>;
}

export function resumir(items: ProductoConsolidado[]): ResumenConsolidacion {
  const por_fuente: Record<Fuente, number> = { productos: 0, stock_general: 0, stock_valorizado: 0 };
  const por_criterio: Record<CriterioMatch, number> = {
    codigo_interno: 0, codigo_barras: 0, codigo_fabrica: 0, descripcion: 0,
  };
  for (const it of items) {
    for (const f of it.fuentes) por_fuente[f]++;
    for (const c of it.matched_por) por_criterio[c]++;
  }
  return {
    total: items.length,
    con_conflictos: items.filter((i) => i.conflictos.length > 0).length,
    con_faltantes: items.filter((i) => i.faltantes.length > 0).length,
    con_errores: items.filter((i) => i.errores.length > 0).length,
    nuevos: items.filter((i) => !i.match_existente_id).length,
    existentes: items.filter((i) => !!i.match_existente_id).length,
    por_fuente,
    por_criterio,
  };
}
