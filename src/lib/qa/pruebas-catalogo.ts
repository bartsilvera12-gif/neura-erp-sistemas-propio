/**
 * NEURA QA CENTER — catálogo de pruebas disponibles.
 *
 * Única fuente de verdad del selector de pruebas de la UI. Cada entrada
 * representa un spec REAL que existe hoy en el runner (qa-runner/src/playwright/specs).
 * No agregamos entradas ficticias: si una categoría no tiene spec disponible,
 * simplemente no aparece.
 *
 * El backend valida que todo spec que llega en una suite exista en este
 * catálogo. Es la whitelist de defensa en profundidad complementaria al
 * regex de `validateSpecs()`.
 */

import type { QaProjectRow } from "@/lib/qa/db";

export type TipoDePrueba =
  | "disponibilidad"
  | "inicio_sesion"
  | "navegacion"
  | "seguridad";

export type PruebaDisponible = {
  /** Identificador interno estable (= archivo spec). */
  spec_file: string;
  /** Nombre visible en la UI, en español. */
  nombre: string;
  /** Descripción corta de qué verifica. */
  descripcion: string;
  /** Tipo (grupo) al que pertenece. */
  tipo: TipoDePrueba;
  /** Cantidad de tests individuales que ejecuta. */
  tests: number;
  /** Si requiere credenciales QA (QA_TEST_USER_EMAIL/PASSWORD en el runner). */
  requiere_credenciales: boolean;
  /**
   * Filtro de compatibilidad con el proyecto. Se evalúa contra el proyecto
   * seleccionado; devuelve `true` si la prueba puede correr contra él.
   * Si devuelve `false`, la prueba NO aparece como opción.
   */
  compatible_con: (project: Pick<QaProjectRow, "slug" | "target_base_url" | "target_env">) => boolean;
};

export type GrupoDePruebas = {
  tipo: TipoDePrueba;
  etiqueta: string;
  descripcion: string;
  pruebas: PruebaDisponible[];
};

/**
 * Proyectos considerados "sistemas-propio" (nuestro ERP Neura).
 * Las specs específicas de este ERP sólo se ofrecen si el target lo es.
 */
function esSistemasPropio(p: { slug: string; target_base_url: string }): boolean {
  const slug = (p.slug ?? "").toLowerCase();
  const host = safeHost(p.target_base_url);
  return (
    slug.includes("sistemas-propio") ||
    slug.includes("erp-neura") ||
    host === "qa-sistemas.neura.com.py" ||
    host === "localhost" ||
    host === "127.0.0.1"
  );
}

function safeHost(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

/** Nunca permitir contra producción (defensa adicional sobre validateTargetBaseUrl). */
function noEsProduccion(p: { target_env: string; target_base_url: string }): boolean {
  if (p.target_env === "production" as unknown as string) return false;
  const host = safeHost(p.target_base_url);
  const prodHosts = ["sistemas.neura.com.py", "sistemas-new.neura.com.py", "www.sistemas-new.neura.com.py"];
  return !prodHosts.includes(host);
}

export const CATALOGO_PRUEBAS: ReadonlyArray<PruebaDisponible> = [
  {
    spec_file: "availability.spec.ts",
    nombre: "Disponibilidad básica",
    descripcion:
      "Verifica que la página principal responda 200 y que las respuestas no expongan tokens ni claves de servicio en las cabeceras.",
    tipo: "disponibilidad",
    tests: 2,
    requiere_credenciales: false,
    compatible_con: (p) => noEsProduccion(p),
  },
  {
    spec_file: "sistemas-propio-login-page.spec.ts",
    nombre: "Página de inicio de sesión",
    descripcion:
      "Verifica que /login carga, muestra formulario (email, contraseña, botón), no expone claves en cabeceras y rechaza credenciales inválidas.",
    tipo: "inicio_sesion",
    tests: 4,
    requiere_credenciales: false,
    compatible_con: (p) => noEsProduccion(p) && esSistemasPropio(p),
  },
  {
    spec_file: "login.spec.ts",
    nombre: "Inicio de sesión genérico (requiere usuario de prueba)",
    descripcion:
      "Simula un login real con credenciales de prueba configuradas en el runner (QA_TEST_USER_EMAIL / QA_TEST_USER_PASSWORD). Si no están configuradas, la prueba se omite automáticamente.",
    tipo: "inicio_sesion",
    tests: 1,
    requiere_credenciales: true,
    compatible_con: (p) => noEsProduccion(p),
  },
  {
    spec_file: "navigation.spec.ts",
    nombre: "Navegación al dashboard (requiere usuario de prueba)",
    descripcion:
      "Tras loguear, intenta abrir /dashboard. Requiere credenciales en el runner; sin ellas la prueba se omite.",
    tipo: "navegacion",
    tests: 1,
    requiere_credenciales: true,
    compatible_con: (p) => noEsProduccion(p),
  },
  {
    spec_file: "sistemas-propio-seguridad.spec.ts",
    nombre: "Seguridad QA-only",
    descripcion:
      "Verifica que el gate server-side bloquea rutas ajenas a QA Center (404 con X-QA-Block), que endpoints protegidos devuelven 401 sin sesión, que métodos no permitidos devuelven 405, que env-assert cierra con 403 contra producción y que /api/qa/runner/claim sin HMAC devuelve 401.",
    tipo: "seguridad",
    tests: 5,
    requiere_credenciales: false,
    compatible_con: (p) => noEsProduccion(p) && esSistemasPropio(p),
  },
];

const ETIQUETAS_TIPO: Record<TipoDePrueba, { etiqueta: string; descripcion: string; orden: number }> = {
  disponibilidad: {
    etiqueta: "Disponibilidad",
    descripcion: "Que el sitio responda, que el servidor esté arriba, que no filtre secretos.",
    orden: 1,
  },
  inicio_sesion: {
    etiqueta: "Inicio de sesión",
    descripcion: "Que la página de login funcione y que el acceso con usuario esté operativo.",
    orden: 2,
  },
  navegacion: {
    etiqueta: "Navegación",
    descripcion: "Que las páginas internas abran correctamente tras loguear.",
    orden: 3,
  },
  seguridad: {
    etiqueta: "Seguridad y aislamiento",
    descripcion: "Que las rutas sensibles estén bloqueadas y las defensas estén activas.",
    orden: 4,
  },
};

/** Dado un proyecto, devuelve los grupos de pruebas compatibles con él. */
export function pruebasParaProyecto(
  project: Pick<QaProjectRow, "slug" | "target_base_url" | "target_env">
): GrupoDePruebas[] {
  const disponibles = CATALOGO_PRUEBAS.filter((p) => p.compatible_con(project));
  const grupos = new Map<TipoDePrueba, PruebaDisponible[]>();
  for (const p of disponibles) {
    const arr = grupos.get(p.tipo) ?? [];
    arr.push(p);
    grupos.set(p.tipo, arr);
  }
  return [...grupos.entries()]
    .map(([tipo, pruebas]) => ({
      tipo,
      etiqueta: ETIQUETAS_TIPO[tipo].etiqueta,
      descripcion: ETIQUETAS_TIPO[tipo].descripcion,
      pruebas,
    }))
    .sort((a, b) => ETIQUETAS_TIPO[a.tipo].orden - ETIQUETAS_TIPO[b.tipo].orden);
}

/** Set de spec_file autorizadas — usado por el backend como whitelist. */
export function specsPermitidas(): Set<string> {
  return new Set(CATALOGO_PRUEBAS.map((p) => p.spec_file));
}

/**
 * Deriva un slug legible y estable a partir de los tipos seleccionados y la fecha.
 * Ejemplo: tipos=[disponibilidad, seguridad] → "disponibilidad-seguridad-20261113-1430".
 */
export function derivarSlugSuite(tipos: TipoDePrueba[], ahora: Date = new Date()): string {
  const ordenDe = (t: string): number =>
    (ETIQUETAS_TIPO as Record<string, { orden: number }>)[t]?.orden ?? 99;
  const base = (tipos.length ? [...new Set(tipos)] as string[] : ["suite"])
    .sort((a, b) => ordenDe(a) - ordenDe(b))
    .join("-");
  const ts = ahora.toISOString().replace(/[-:T]/g, "").slice(0, 12); // YYYYMMDDHHMM
  return `${base}-${ts}`.toLowerCase();
}
