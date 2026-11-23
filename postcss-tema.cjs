/**
 * Color del ERP elegible por cada persona.
 *
 * El turquesa de la marca está escrito a mano en miles de clases (`bg-[#4FAEB2]`,
 * `border-[#4FAEB2]/30`…). En vez de reescribirlas una por una, este paso corre DESPUÉS de
 * Tailwind y, en el CSS ya generado, cambia cada color de marca por una variable:
 *
 *   #4FAEB2            →  rgb(var(--tema-rgb))
 *   #4FAEB21a          →  rgb(var(--tema-rgb) / 0.1)
 *   rgba(79,174,178,x) →  rgb(var(--tema-rgb) / x)
 *
 * Las variables valen, por defecto, exactamente esos mismos colores (ver globals.css): quien no
 * elige nada ve lo de siempre. Elegir un color es cambiar las variables (`data-tema` en <html>).
 * Solo se usa `rgb(… / …)` con variables, que anda en cualquier navegador y en la app.
 */
const TEMA = {
  "4faeb2": "--tema-rgb",
  "3f8e91": "--tema-fuerte-rgb",
  "2f6e71": "--tema-oscuro-rgb",
  "7dcfd2": "--tema-claro-rgb",
  "224e55": "--tema-lateral-rgb",
  "285c62": "--tema-lateral-alto-rgb",
  "0b3a3d": "--tema-fondo-rgb",
  "104a4e": "--tema-fondo-alto-rgb",
};
const POR_RGB = {};
for (const [hex, v] of Object.entries(TEMA)) {
  const n = parseInt(hex, 16);
  POR_RGB[`${n >> 16},${(n >> 8) & 255},${n & 255}`] = v;
}
const HEX = new RegExp(`#(${Object.keys(TEMA).join("|")})([0-9a-f]{2})?(?![0-9a-f])`, "gi");
const RGBA = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+%?)\s*)?\)/gi;
const MEZCLA = /color-mix\(in (?:oklab|srgb),\s*rgb\(var\((--tema[\w-]*)\)\)\s*([\d.]+)%,\s*transparent\)/gi;
const redondo = (x) => String(Math.round(x * 1000) / 1000);

function cambiar(valor) {
  return valor
    .replace(HEX, (_, hex, alfa) => {
      const v = TEMA[hex.toLowerCase()];
      return alfa ? `rgb(var(${v}) / ${redondo(parseInt(alfa, 16) / 255)})` : `rgb(var(${v}))`;
    })
    .replace(RGBA, (todo, r, g, b, a) => {
      const v = POR_RGB[`${+r},${+g},${+b}`];
      if (!v) return todo;
      return a === undefined ? `rgb(var(${v}))` : `rgb(var(${v}) / ${a})`;
    })
    // Tailwind escribe la transparencia como mezcla con transparente; es el mismo color con
    // alfa, y así no depende de `color-mix` (los teléfonos viejos no lo entienden).
    .replace(MEZCLA, (_, v, pct) => `rgb(var(${v}) / ${redondo(parseFloat(pct) / 100)})`);
}

function revisar(decl) {
  // Las propias variables del tema no se tocan (se definirían en círculo).
  if (decl.prop.startsWith("--tema")) return;
  const v = decl.value;
  if (!v || (v.indexOf("#") === -1 && v.indexOf("rgb") === -1)) return;
  const nuevo = cambiar(v);
  if (nuevo !== v) decl.value = nuevo;
}

module.exports = () => ({
  postcssPlugin: "neura-tema",
  // Al final de todo: Tailwind arma su CSS recién en su propio cierre, así que hay que pasar
  // después de él (por eso este plugin va último en postcss.config.mjs).
  OnceExit(root) {
    root.walkDecls(revisar);
  },
});
module.exports.postcss = true;
