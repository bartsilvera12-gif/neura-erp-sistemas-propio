/**
 * Color del ERP, elegido por cada persona y guardado en SU navegador (no cambia lo que ven los
 * demás). Se elige en Configuración → Apariencia.
 *
 * Lo guardado (`neura_color`) es el nombre de un color de la lista o un color propio en hex
 * ("#3366cc"). Los de la lista están en globals.css (`:root[data-tema="…"]`); para uno propio
 * se calculan acá los mismos tonos (lateral, fuerte, claro…) con el matiz del color elegido.
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

function aHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn, l = (mx + mn) / 2;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h *= 60;
  return [h < 0 ? h + 360 : h, s, l];
}

function aRgb(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255)).join(" ");
}

/** Los tonos del turquesa original: de cada uno se conserva lo claro/oscuro y se le cambia el matiz. */
const TONOS: [string, string][] = [
  ["--tema-rgb", "#4faeb2"],
  ["--tema-fuerte-rgb", "#3f8e91"],
  ["--tema-oscuro-rgb", "#2f6e71"],
  ["--tema-claro-rgb", "#7dcfd2"],
  ["--tema-lateral-rgb", "#224e55"],
  ["--tema-lateral-alto-rgb", "#285c62"],
  ["--tema-fondo-rgb", "#0b3a3d"],
  ["--tema-fondo-alto-rgb", "#104a4e"],
];

/**
 * Variables de un color propio. Del color elegido se toma el matiz y qué tan vivo es; lo claro
 * u oscuro de cada tono queda como en el diseño, para que los textos se sigan leyendo.
 */
export function variablesDeColor(hex: string): [string, string][] {
  const [h, s] = aHsl(hexARgb(hex));
  // Tope de viveza: un color muy chillón dejaría el menú lateral demasiado intenso.
  const viveza = Math.min(1.5, s / aHsl(hexARgb(TONOS[0][1]))[1]);
  return TONOS.map(([nombre, base]) => {
    const [, s0, l0] = aHsl(hexARgb(base));
    return [nombre, aRgb(h, Math.min(1, s0 * viveza), l0)];
  });
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

  TONOS.forEach(([nombre]) => raiz.style.removeProperty(nombre));
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
)})||"";if(/^(--tema[a-z-]*rgb:\\d{1,3} \\d{1,3} \\d{1,3};){1,12}$/.test(c))d.style.cssText=c}}catch(e){}`;
