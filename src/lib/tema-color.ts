/**
 * Color del ERP, elegido por cada persona y guardado en SU navegador (no cambia lo que ven los
 * demás). Se elige en Configuración → Apariencia.
 *
 * Lo guardado (`neura_color`) es el nombre de un color de la lista o un color propio en hex
 * ("#3366cc"). Los de la lista están en globals.css (`:root[data-tema="…"]`); uno propio se
 * aplica tal cual, sin límites (ver `variablesDeColor`). Aparte se elige el color de las letras
 * que van sobre ese color (`neura_letras`).
 */
export const CLAVE_TEMA = "neura_color";
/** Las variables ya calculadas de un color propio, para aplicarlas antes de pintar. */
export const CLAVE_TEMA_CSS = "neura_color_css";
export const EVENTO_TEMA = "neura:color";

export const TEMAS = [
  { id: "turquesa", nombre: "Turquesa", muestra: "#4FAEB2" },
  { id: "azul", nombre: "Azul", muestra: "#4879B9" },
  { id: "violeta", nombre: "Violeta", muestra: "#724AB7" },
  { id: "rosa", nombre: "Rosa", muestra: "#B94878" },
  { id: "verde", nombre: "Verde", muestra: "#4FB283" },
  { id: "naranja", nombre: "Naranja", muestra: "#C76F31" },
  { id: "grafito", nombre: "Grafito", muestra: "#78808A" },
] as const;

export type TemaId = (typeof TEMAS)[number]["id"];
export const TEMA_POR_DEFECTO: TemaId = "turquesa";

const HEX = /^#[0-9a-f]{6}$/i;

/** "#abc", "abc", "#aabbcc", "aabbcc" o "rgb(1, 2, 3)" / "1, 2, 3" → "#aabbcc"; si no se entiende, null. */
export function normalizarColor(texto: string): string | null {
  const t = texto.trim().toLowerCase();
  const h = t.replace(/^#/, "");
  if (/^[0-9a-f]{6}$/.test(h)) return `#${h}`;
  if (/^[0-9a-f]{3}$/.test(h)) return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  const m = t.match(/^(?:rgb\()?\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*\)?$/);
  if (m && m.slice(1).every((n) => Number(n) <= 255)) {
    return `#${m.slice(1).map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
  }
  return null;
}

export function hexARgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

/** Las variables del tema (ver globals.css). */
const TONOS = [
  "--tema-rgb",
  "--tema-fuerte-rgb",
  "--tema-oscuro-rgb",
  "--tema-claro-rgb",
  "--tema-lateral-rgb",
  "--tema-lateral-alto-rgb",
  "--tema-fondo-rgb",
  "--tema-fondo-alto-rgb",
] as const;

const mezclar = (c: [number, number, number], con: number, parte: number): string =>
  c.map((v) => Math.round(v + (con - v) * parte)).join(" ");

/**
 * Variables de un color propio, sin límites: el menú lateral y los botones toman EXACTAMENTE el
 * color elegido (también negro, blanco o uno muy claro). Los demás tonos son ese mismo color un
 * poco más oscuro o más claro. Para que las letras se lean sobre un color claro está el "color
 * de las letras".
 */
export function variablesDeColor(hex: string): [string, string][] {
  const c = hexARgb(hex);
  const exacto = c.join(" ");
  const claroDeBase = luminancia(hex) > 0.5;
  return [
    ["--tema-rgb", exacto],
    ["--tema-fuerte-rgb", mezclar(c, 0, 0.18)],
    ["--tema-oscuro-rgb", mezclar(c, 0, 0.36)],
    ["--tema-claro-rgb", mezclar(c, 255, 0.4)],
    ["--tema-lateral-rgb", exacto],
    // La franja del logo, apenas distinta del resto del menú.
    ["--tema-lateral-alto-rgb", claroDeBase ? mezclar(c, 0, 0.05) : mezclar(c, 255, 0.07)],
    ["--tema-fondo-rgb", mezclar(c, 0, 0.3)],
    ["--tema-fondo-alto-rgb", mezclar(c, 0, 0.2)],
  ];
}

/** Qué tan claro se ve un color (0 negro … 1 blanco). */
export function luminancia(hex: string): number {
  const [r, g, b] = hexARgb(hex).map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ── Color de las letras sobre el color del sistema ────────────────────────────
export const CLAVE_LETRAS = "neura_letras";
export const LETRAS = [
  { id: "blanco", nombre: "Blanco", muestra: "#ffffff" },
  { id: "gris", nombre: "Gris", muestra: "#646973" },
  { id: "negro", nombre: "Negro", muestra: "#111111" },
] as const;
/** "original" = sin elegir: las letras de siempre (blancas con sus grises suaves). */
export type LetraId = (typeof LETRAS)[number]["id"] | "original";
export const LETRA_POR_DEFECTO: LetraId = "original";

export function leerLetras(): LetraId {
  try {
    const v = localStorage.getItem(CLAVE_LETRAS);
    return v === "negro" || v === "gris" || v === "blanco" ? v : LETRA_POR_DEFECTO;
  } catch {
    return LETRA_POR_DEFECTO;
  }
}

export function elegirLetras(id: LetraId): void {
  const raiz = document.documentElement;
  if (id === LETRA_POR_DEFECTO) raiz.removeAttribute("data-letras");
  else raiz.setAttribute("data-letras", id);
  try {
    if (id === LETRA_POR_DEFECTO) localStorage.removeItem(CLAVE_LETRAS);
    else localStorage.setItem(CLAVE_LETRAS, id);
  } catch {
    // sin almacenamiento: vale hasta recargar
  }
  window.dispatchEvent(new Event(EVENTO_TEMA));
}

// ── Mis colores: los propios que la persona guardó en la lista ───────────────
export const CLAVE_GUARDADOS = "neura_colores_guardados";
const MAX_GUARDADOS = 12;

export function leerGuardados(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE_GUARDADOS) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && HEX.test(x)).slice(0, MAX_GUARDADOS) : [];
  } catch {
    return [];
  }
}

function escribirGuardados(lista: string[]): void {
  try {
    if (lista.length) localStorage.setItem(CLAVE_GUARDADOS, JSON.stringify(lista));
    else localStorage.removeItem(CLAVE_GUARDADOS);
  } catch {
    // sin almacenamiento: no se guarda
  }
  window.dispatchEvent(new Event(EVENTO_TEMA));
}

/** Suma un color propio a "Mis colores" (al principio; si ya estaba, no lo repite). */
export function guardarColor(hex: string): void {
  const c = hex.toLowerCase();
  if (!HEX.test(c)) return;
  escribirGuardados([c, ...leerGuardados().filter((x) => x !== c)].slice(0, MAX_GUARDADOS));
}

export function borrarColor(hex: string): void {
  escribirGuardados(leerGuardados().filter((x) => x !== hex.toLowerCase()));
}

// ── Color de las estrellas de favoritos ──────────────────────────────────────
export const CLAVE_ESTRELLA = "neura_estrella";
/** "original" = el amarillo de siempre. */
export const ESTRELLA_POR_DEFECTO = "original";
export const ESTRELLAS = [
  { id: "original", nombre: "Amarillo", muestra: "#fcd34d" },
  { id: "#ffffff", nombre: "Blanco", muestra: "#ffffff" },
  { id: "#fb923c", nombre: "Naranja", muestra: "#fb923c" },
  { id: "#f87171", nombre: "Rojo", muestra: "#f87171" },
  { id: "#f472b6", nombre: "Rosa", muestra: "#f472b6" },
  { id: "#7dd3fc", nombre: "Celeste", muestra: "#7dd3fc" },
  { id: "#86efac", nombre: "Verde", muestra: "#86efac" },
] as const;

/** "original" o "#rrggbb". */
export function leerEstrella(): string {
  try {
    const v = localStorage.getItem(CLAVE_ESTRELLA) ?? "";
    return HEX.test(v) ? v : ESTRELLA_POR_DEFECTO;
  } catch {
    return ESTRELLA_POR_DEFECTO;
  }
}

export function elegirEstrella(valor: string): void {
  const raiz = document.documentElement;
  const c = HEX.test(valor) ? valor.toLowerCase() : null;
  if (c) raiz.style.setProperty("--estrella-rgb", hexARgb(c).join(" "));
  else raiz.style.removeProperty("--estrella-rgb");
  try {
    if (c) localStorage.setItem(CLAVE_ESTRELLA, c);
    else localStorage.removeItem(CLAVE_ESTRELLA);
  } catch {
    // sin almacenamiento: vale hasta recargar
  }
  window.dispatchEvent(new Event(EVENTO_TEMA));
}

/** Lo elegido en este navegador: nombre de la lista o "#rrggbb". */
export function leerTema(): string {
  try {
    const v = localStorage.getItem(CLAVE_TEMA) ?? "";
    return TEMAS.some((t) => t.id === v) || HEX.test(v) ? v : TEMA_POR_DEFECTO;
  } catch {
    return TEMA_POR_DEFECTO;
  }
}

/** Elige un color de la lista (`"azul"`), uno propio (`"#3366cc"`) o vuelve al original (`"turquesa"`). */
export function elegirTema(valor: string): void {
  const raiz = document.documentElement;
  const propio = HEX.test(valor) ? valor.toLowerCase() : null;
  const id = propio ? null : TEMAS.some((t) => t.id === valor) ? valor : TEMA_POR_DEFECTO;
  const vars = propio ? variablesDeColor(propio) : [];

  TONOS.forEach((nombre) => raiz.style.removeProperty(nombre));
  vars.forEach(([nombre, v]) => raiz.style.setProperty(nombre, v));
  if (id && id !== TEMA_POR_DEFECTO) raiz.setAttribute("data-tema", id);
  else raiz.removeAttribute("data-tema");

  try {
    if (propio) {
      localStorage.setItem(CLAVE_TEMA, propio);
      localStorage.setItem(CLAVE_TEMA_CSS, vars.map(([n, v]) => `${n}:${v};`).join(""));
    } else {
      localStorage.removeItem(CLAVE_TEMA_CSS);
      if (id === TEMA_POR_DEFECTO) localStorage.removeItem(CLAVE_TEMA);
      else localStorage.setItem(CLAVE_TEMA, id as string);
    }
  } catch {
    // sin almacenamiento: vale hasta recargar
  }
  window.dispatchEvent(new Event(EVENTO_TEMA));
}

/**
 * Se ejecuta en el <head>, antes de pintar: así la página ya abre con el color elegido y no
 * parpadea en turquesa. Solo acepta nombres de la lista o variables con la forma exacta que
 * escribe `elegirTema` (nada de lo guardado se ejecuta ni se inserta como HTML).
 */
export const SCRIPT_TEMA = `try{var d=document.documentElement,t=localStorage.getItem(${JSON.stringify(CLAVE_TEMA)})||"";if(${JSON.stringify(
  TEMAS.filter((t) => t.id !== TEMA_POR_DEFECTO).map((t) => t.id)
)}.indexOf(t)>-1)d.setAttribute("data-tema",t);else if(t.charAt(0)=="#"){var c=localStorage.getItem(${JSON.stringify(
  CLAVE_TEMA_CSS
)})||"";if(/^(--tema[a-z-]*rgb:\\d{1,3} \\d{1,3} \\d{1,3};){1,12}$/.test(c))d.style.cssText=c}var l=localStorage.getItem(${JSON.stringify(CLAVE_LETRAS)});if(l=="negro"||l=="gris"||l=="blanco")d.setAttribute("data-letras",l);var s=localStorage.getItem(${JSON.stringify(
  CLAVE_ESTRELLA
)})||"";if(/^#[0-9a-f]{6}$/i.test(s))d.style.setProperty("--estrella-rgb",parseInt(s.slice(1,3),16)+" "+parseInt(s.slice(3,5),16)+" "+parseInt(s.slice(5,7),16))}catch(e){}`;
