/**
 * Guardrail anti-regresión (Fase 5) — "nombre del cliente para mostrar".
 *
 * El criterio del nombre de cliente vive en UN solo lugar:
 *   src/lib/clientes/display-name.ts  → nombreClienteDisplay / clienteDisplayNameSql
 *
 * Este checker recorre src/ y falla si encuentra derivaciones ad-hoc del nombre
 * (combinar empresa/razon_social/nombre_contacto/nombre con ?? o || para armar un
 * nombre) fuera del helper. Así nadie vuelve a inventar el criterio y las pantallas
 * no se desincronizan (bug ELECTROSAN).
 *
 * Correr:  npx tsx scripts/check-cliente-display-name.ts
 *
 * Si tenés un caso legítimamente distinto (fiscal/SIFEN, proveedores —otra entidad—,
 * o un comparador de búsqueda que a propósito matchea varios campos), agregalo al
 * ALLOWLIST con una nota del por qué.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = join(process.cwd(), "src");

// Patrones que delatan una derivación ad-hoc del nombre de cliente.
const PATTERNS: RegExp[] = [
  /(empresa|razon_social)\b[^\n;]{0,40}(\?\?|\|\|)[^\n;]{0,60}(nombre_contacto|nombre)\b/,
  /(nombre_contacto|nombre)\b[^\n;]{0,40}(\?\?|\|\|)[^\n;]{0,60}(empresa|razon_social)\b/,
  /COALESCE\([^)]*\b(razon_social|nombre|empresa)\b[^)]*\b(razon_social|nombre|empresa)\b/i,
];

/**
 * Rutas donde el patrón es legítimo (no es "nombre para mostrar" unificable):
 * - el helper mismo;
 * - SIFEN/facturación electrónica: usa razon_social fiscal por norma;
 * - proveedores: otra entidad, no clientes;
 * - libro de ventas: reporte fiscal, muestra la razón social a propósito;
 * - búsquedas: matchear empresa Y contacto a la vez es deseable.
 */
const ALLOWLIST: RegExp[] = [
  /clientes[\\/]display-name\.ts$/,
  /[\\/]sifen[\\/]/,
  /[\\/]proveedores[\\/]/,
  /proveedores/i,
  /libro-ventas/i,
  // Buscadores: incluir varios campos como tokens es correcto para filtrar.
  /ProyectosKanbanClient\.tsx$/,
  /assistant[\\/]chat[\\/]route\.ts$/,
  // Alta de EMPRESA/tenant (no cliente): valida nombre_empresa/nombre, no deriva nombre de cliente.
  /admin[\\/]crear-empresa[\\/]route\.ts$/,
];

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
}

const files: string[] = [];
walk(ROOT, files);

const hits: { file: string; line: number; text: string }[] = [];
for (const file of files) {
  if (ALLOWLIST.some((re) => re.test(file))) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((ln, i) => {
    if (ln.trimStart().startsWith("*") || ln.trimStart().startsWith("//")) return; // comentarios
    if (PATTERNS.some((re) => re.test(ln))) {
      hits.push({ file: relative(process.cwd(), file), line: i + 1, text: ln.trim() });
    }
  });
}

if (hits.length === 0) {
  console.log("✅ Sin derivaciones ad-hoc del nombre de cliente. Todo usa el helper canónico.");
  process.exit(0);
}

console.error(`❌ ${hits.length} derivación(es) ad-hoc del nombre de cliente (usá nombreClienteDisplay / clienteDisplayNameSql de src/lib/clientes/display-name.ts):\n`);
for (const h of hits) console.error(`  ${h.file}:${h.line}\n     ${h.text}`);
console.error("\nSi es un caso legítimo (fiscal/SIFEN, proveedores, búsqueda), agregalo al ALLOWLIST del checker con una nota.");
process.exit(1);
