/**
 * Color del ERP, elegido por cada persona y guardado en SU navegador (no cambia lo que ven los
 * demás). Los colores en sí están en globals.css (`:root[data-tema="…"]`).
 */
export const CLAVE_TEMA = "neura_color";
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

export function leerTema(): TemaId {
  try {
    const v = localStorage.getItem(CLAVE_TEMA);
    return TEMAS.some((t) => t.id === v) ? (v as TemaId) : TEMA_POR_DEFECTO;
  } catch {
    return TEMA_POR_DEFECTO;
  }
}

export function elegirTema(id: TemaId): void {
  try {
    if (id === TEMA_POR_DEFECTO) localStorage.removeItem(CLAVE_TEMA);
    else localStorage.setItem(CLAVE_TEMA, id);
  } catch {
    // sin almacenamiento: vale hasta recargar
  }
  if (id === TEMA_POR_DEFECTO) document.documentElement.removeAttribute("data-tema");
  else document.documentElement.setAttribute("data-tema", id);
  window.dispatchEvent(new Event(EVENTO_TEMA));
}

/**
 * Se ejecuta en el <head>, antes de pintar: así la página ya abre con el color elegido y no
 * parpadea en turquesa. Solo acepta nombres de la lista.
 */
export const SCRIPT_TEMA = `try{var t=localStorage.getItem(${JSON.stringify(CLAVE_TEMA)});if(${JSON.stringify(
  TEMAS.filter((t) => t.id !== TEMA_POR_DEFECTO).map((t) => t.id)
)}.indexOf(t)>-1)document.documentElement.setAttribute("data-tema",t)}catch(e){}`;
