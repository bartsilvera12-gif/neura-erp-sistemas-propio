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
  | "seguridad"
  | "auditoria_integral";

/**
 * Codebase del proyecto. Lo asignamos explícitamente por slug — NO por dominio:
 * dos ERPs distintos pueden compartir TLD y no compartir código.
 */
export type CodebaseProyecto = "sistemas-propio" | "erp-neura" | "fake-app" | "otro";

/**
 * Mapa de slug → codebase. Única fuente de verdad de la compatibilidad.
 * Al registrar un proyecto nuevo del equipo Neura, agregar su slug acá.
 */
export const CODEBASE_POR_SLUG: Readonly<Record<string, CodebaseProyecto>> = {
  "sistemas-propio-qa": "sistemas-propio",
  "erp-neura": "sistemas-propio",
  "erp-local": "sistemas-propio",
  "demo-fake-app": "fake-app",
  // ERPs de cliente del codebase neura-erp:
  "erp-roldan-pendiente-entrega": "erp-neura",
};

export function codebaseDeProyecto(p: { slug: string }): CodebaseProyecto {
  return CODEBASE_POR_SLUG[p.slug] ?? "otro";
}

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
 * Compatibilidad por codebase declarado — no se infiere por dominio.
 */
function esSistemasPropio(p: { slug: string; target_base_url: string }): boolean {
  return codebaseDeProyecto(p) === "sistemas-propio";
}

/** Proyectos del codebase genérico neura-erp (ERPs de clientes). */
function esErpNeura(p: { slug: string; target_base_url: string }): boolean {
  const kind = codebaseDeProyecto(p);
  // sistemas-propio también deriva del codebase neura-erp y puede correr las
  // specs de auditoría integral; por eso ambos aceptan auditoria_integral.
  return kind === "erp-neura" || kind === "sistemas-propio";
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

  // ──────────────────────────────────────────────────────────────────────
  // Auditoría integral del ERP (codebase neura-erp y sistemas-propio).
  // 10 specs anónimas + autenticadas; las autenticadas se omiten si no hay
  // QA_TEST_USER_EMAIL/PASSWORD configuradas en el runner.
  // ──────────────────────────────────────────────────────────────────────
  {
    spec_file: "erp-neura-availability.spec.ts",
    nombre: "Auditoría · Disponibilidad y cabeceras",
    descripcion:
      "Verifica que la instancia responda, que las cabeceras no filtren JWT ni service-role y que las cookies de auth sean HttpOnly.",
    tipo: "auditoria_integral",
    tests: 3,
    requiere_credenciales: false,
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "erp-neura-login-page.spec.ts",
    nombre: "Auditoría · Página de login",
    descripcion:
      "Verifica que /login carga, el formulario está completo y credenciales inválidas no permiten entrar.",
    tipo: "auditoria_integral",
    tests: 3,
    requiere_credenciales: false,
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "erp-neura-api-contratos.spec.ts",
    nombre: "Auditoría · Contratos API (anónimo)",
    descripcion:
      "Verifica que endpoints protegidos devuelvan 401 JSON válido sin sesión y que no filtren data anónimamente (20 rutas revisadas en código antes de incluirse).",
    tipo: "auditoria_integral",
    tests: 3,
    requiere_credenciales: false,
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "erp-neura-headers-safety.spec.ts",
    nombre: "Auditoría · Cabeceras de seguridad",
    descripcion:
      "Verifica que ninguna cabecera filtre JWT, service-role, keys ni URLs de BD. Chequea Cache-Control en /login.",
    tipo: "auditoria_integral",
    tests: 2,
    requiere_credenciales: false,
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "erp-neura-rutas-publicas.spec.ts",
    nombre: "Auditoría · Rutas estáticas públicas",
    descripcion:
      "Verifica favicon, robots.txt (si existe) y manejo correcto de 404 sin crashear el server.",
    tipo: "auditoria_integral",
    tests: 3,
    requiere_credenciales: false,
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "erp-neura-env-assert.spec.ts",
    nombre: "Auditoría · Endpoint env-assert",
    descripcion:
      "Verifica que el ERP exponga /api/qa/env-assert con contrato correcto. Falla claramente si el ERP no lo tiene (prerrequisito de QA Center).",
    tipo: "auditoria_integral",
    tests: 2,
    requiere_credenciales: false,
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "erp-neura-deploy-info.spec.ts",
    nombre: "Auditoría · Metadata de deploy",
    descripcion:
      "Verifica que /api/deploy-info (si existe) devuelva JSON con metadata de versión.",
    tipo: "auditoria_integral",
    tests: 1,
    requiere_credenciales: false,
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "erp-neura-dashboard-render.spec.ts",
    nombre: "Auditoría · Dashboard tras login",
    descripcion:
      "Tras iniciar sesión, verifica que el dashboard cargue sin errores JS y que el menú lateral renderice. Omitida si no hay credenciales de prueba.",
    tipo: "auditoria_integral",
    tests: 2,
    requiere_credenciales: true,
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "erp-neura-navegacion-menu.spec.ts",
    nombre: "Auditoría · Navegación de módulos (listados)",
    descripcion:
      "Visita los listados de los 18 módulos principales (ventas, compras, inventario, clientes, reportes, etc.) y verifica que ninguno devuelva 500. 100% lectura, nunca abre /nueva ni /editar.",
    tipo: "auditoria_integral",
    tests: 18,
    requiere_credenciales: true,
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "erp-neura-reportes-listado.spec.ts",
    nombre: "Auditoría · Reportes (lectura pura)",
    descripcion:
      "Abre 5 reportes clave (ventas, libro-ventas, libro-compras, estado-cuenta, cuentas-por-pagar) y verifica que rendericen. No genera PDFs ni exporta.",
    tipo: "auditoria_integral",
    tests: 5,
    requiere_credenciales: true,
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "erp-neura-permisos.spec.ts",
    nombre: "Auditoría · Permisos del usuario QA",
    descripcion:
      "Verifica que el usuario QA (rol limitado) NO acceda a /admin/empresas, /admin/usuarios ni vea links de admin en el dashboard.",
    tipo: "auditoria_integral",
    tests: 3,
    requiere_credenciales: true,
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
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
  auditoria_integral: {
    etiqueta: "Auditoría integral del ERP",
    descripcion:
      "Cobertura amplia por módulo (disponibilidad, login, API, cabeceras, navegación, reportes, permisos). Reutilizable para todos los ERP del codebase Neura.",
    orden: 5,
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
/**
 * Códigos cortos kebab-safe para armar slugs dentro del límite de 40 chars.
 * Si se agrega un nuevo TipoDePrueba, declararlo acá también.
 */
const CODIGO_CORTO: Record<TipoDePrueba, string> = {
  disponibilidad: "disp",
  inicio_sesion: "login",
  navegacion: "nav",
  seguridad: "sec",
  auditoria_integral: "audit",
};

export function derivarSlugSuite(tipos: TipoDePrueba[], ahora: Date = new Date()): string {
  const ordenDe = (t: string): number =>
    (ETIQUETAS_TIPO as Record<string, { orden: number }>)[t]?.orden ?? 99;
  const codigos = (tipos.length ? [...new Set(tipos)] as string[] : ["suite"])
    .sort((a, b) => ordenDe(a) - ordenDe(b))
    .map((t) => (CODIGO_CORTO as Record<string, string>)[t] ?? "suite");
  const base = codigos.join("-");
  const ts = ahora.toISOString().replace(/[-:T]/g, "").slice(0, 12); // YYYYMMDDHHMM
  const candidato = `${base}-${ts}`.toLowerCase();
  // Doble red de seguridad: si por alguna razón la suma supera 40, recortamos.
  return candidato.length <= 40 ? candidato : candidato.slice(0, 40).replace(/-$/, "");
}
