import path from "node:path";

// Ruta completa: el armado resuelve los plugins desde su propia carpeta, no desde la raíz
// del proyecto (que es desde donde siempre se corre `next dev` / `next build`).
const tema = path.join(process.cwd(), "postcss-tema.cjs");

const config = {
  plugins: {
    // optimize: false → Tailwind no "precalcula" los colores con transparencia (los dejaría fijos
    // en turquesa); la compresión del CSS la hace igual Next al compilar.
    "@tailwindcss/postcss": { optimize: false },
    // Después de Tailwind: vuelve variable el color de marca (ver postcss-tema.cjs).
    [tema]: {},
  },
};

export default config;
