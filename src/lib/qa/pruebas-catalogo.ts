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
  | "auditoria_estatica"
  | "auditoria_funcional_negocio"
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
  // Fixture aislada para verificar runner end-to-end:
  "qa-fixture-app": "erp-neura",
};

export function codebaseDeProyecto(p: { slug: string }): CodebaseProyecto {
  return CODEBASE_POR_SLUG[p.slug] ?? "otro";
}

/**
 * Clase de efectos que puede producir una prueba. Se usa para gatear runs
 * sobre ERPs con credenciales productivas activas: sólo `lectura_anonima`
 * puede correrse contra un target donde `prod_safe=false` pero
 * `lectura_anonima_safe=true`. Las otras dos exigen `prod_safe=true`.
 */
export type EfectoPrueba =
  | "analisis_estatico"
  | "lectura_anonima"
  | "lectura_con_sesion"
  | "lectura_autenticada_estricta"
  | "escritura";

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
   * Clase de efectos. Si no se declara explícitamente, se deriva del flag
   * `requiere_credenciales` (false → lectura_anonima; true → lectura_con_sesion).
   * NUNCA debe quedar "escritura" implícitamente — hay que declararlo a mano.
   */
  efecto?: EfectoPrueba;
  /**
   * Marca que esta prueba JAMÁS envía POST ni toca formularios de creación /
   * edición / borrado. Específica de auditoría funcional del negocio. Habilita
   * el nivel de seguridad "authenticated_read_only" en runs 100% de este tipo.
   */
  solo_lectura_estricta?: boolean;
  /**
   * Módulo de negocio al que pertenece (Ventas, Compras, Caja, etc.). Se usa
   * en la UI y en los reportes para agrupar por área.
   */
  modulo_negocio?: string;
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

/**
 * Un proyecto es apto para auditoría estática si tenemos URL del repo:
 * ya sea declarada en la DB (resolvemos vía REPO_URL_OVERRIDE abajo) o
 * mapeada en el override para proyectos cuyo repo todavía no está en DB.
 * Para no romper acá la DI (el proyecto pasado al compatible_con no
 * trae `repo_url`), chequeamos sólo la presencia del slug en el override:
 * la DB se consulta más tarde al construir el job.
 */
function tieneRepoConocido(slug: string): boolean {
  return Object.prototype.hasOwnProperty.call(REPO_URL_OVERRIDE, slug) ||
    Object.prototype.hasOwnProperty.call(CODEBASE_POR_SLUG, slug);
}

export const CATALOGO_PRUEBAS: ReadonlyArray<PruebaDisponible> = [
  // ──────────────────────────────────────────────────────────────────────
  // Auditoría estática: corre sobre el repositorio Git del proyecto.
  // No toca el ERP publicado; no requiere env-assert. Compatible con
  // cualquier proyecto que declare repo_url (o esté mapeado al override).
  // ──────────────────────────────────────────────────────────────────────
  // Static-analysis: compatible con cualquier proyecto que tenga repo_url
  // conocido (en DB o vía REPO_URL_OVERRIDE). No depende del dominio.
  // Nota: el helper tieneRepoConocido se declara después; la llamada se
  // evalúa en tiempo de ejecución, no al definir el array.
  {
    spec_file: "static-secret-scan.spec.ts",
    nombre: "Estática · Secretos en el código",
    descripcion:
      "Busca JWT, SERVICE_ROLE, tokens de Stripe, AWS, GitHub y otras claves hardcodeadas en el repositorio.",
    tipo: "auditoria_estatica",
    tests: 1,
    requiere_credenciales: false,
    efecto: "analisis_estatico",
    compatible_con: (p) => tieneRepoConocido(p.slug),
  },
  {
    spec_file: "static-service-role-usage.spec.ts",
    nombre: "Estática · Uso de SERVICE_ROLE",
    descripcion:
      "Marca cada uso de SUPABASE_SERVICE_ROLE_KEY; bloqueador si aparece en rutas /api sin un guard de auth importado.",
    tipo: "auditoria_estatica",
    tests: 1,
    requiere_credenciales: false,
    efecto: "analisis_estatico",
    compatible_con: (p) => tieneRepoConocido(p.slug),
  },
  {
    spec_file: "static-unprotected-api-routes.spec.ts",
    nombre: "Estática · Rutas API sin guard",
    descripcion:
      "Revisa src/app/api/**/route.ts: si exporta GET/POST/… sin importar helpers de auth conocidos, lo reporta.",
    tipo: "auditoria_estatica",
    tests: 1,
    requiere_credenciales: false,
    efecto: "analisis_estatico",
    compatible_con: (p) => tieneRepoConocido(p.slug),
  },
  {
    spec_file: "static-npm-audit.spec.ts",
    nombre: "Estática · Dependencias vulnerables",
    descripcion:
      "Ejecuta npm audit --omit=dev contra el lockfile del repo y reporta cada vulnerabilidad high/critical como bloqueador.",
    tipo: "auditoria_estatica",
    tests: 1,
    requiere_credenciales: false,
    efecto: "analisis_estatico",
    compatible_con: (p) => tieneRepoConocido(p.slug),
  },
  {
    spec_file: "static-security-headers.spec.ts",
    nombre: "Estática · Cabeceras de seguridad",
    descripcion:
      "Verifica que middleware.ts o next.config declaren CSP, HSTS, X-Frame-Options, X-Content-Type-Options y Referrer-Policy.",
    tipo: "auditoria_estatica",
    tests: 1,
    requiere_credenciales: false,
    efecto: "analisis_estatico",
    compatible_con: (p) => tieneRepoConocido(p.slug),
  },
  {
    spec_file: "static-env-assert-contract.spec.ts",
    nombre: "Estática · Contrato env-assert",
    descripcion:
      "Chequea presencia y shape básico del endpoint /api/qa/env-assert en el código fuente. Su ausencia es info (no bloquea estática).",
    tipo: "auditoria_estatica",
    tests: 1,
    requiere_credenciales: false,
    efecto: "analisis_estatico",
    compatible_con: (p) => tieneRepoConocido(p.slug),
  },
  {
    spec_file: "static-sql-injection-patterns.spec.ts",
    nombre: "Estática · Patrones de SQL interpolada",
    descripcion:
      "Detecta template literals con interpolación dentro de queries (pg.query, supabase.rpc, sql`...`) — posibles sitios de inyección.",
    tipo: "auditoria_estatica",
    tests: 1,
    requiere_credenciales: false,
    efecto: "analisis_estatico",
    compatible_con: (p) => tieneRepoConocido(p.slug),
  },
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
    efecto: "lectura_anonima",
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
    efecto: "lectura_anonima",
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
    efecto: "lectura_anonima",
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
    efecto: "lectura_anonima",
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
    efecto: "lectura_anonima",
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
    efecto: "lectura_anonima",
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
    efecto: "lectura_anonima",
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

  // ──────────────────────────────────────────────────────────────────────
  // Auditoría funcional del negocio — 100% LECTURA ESTRICTA.
  // Un usuario QA con rol de sólo lectura inicia sesión, las specs consultan
  // endpoints GET y verifican consistencia de cálculos (totales, saldos,
  // stock, duplicados). NUNCA envían POST, nunca tocan botones de edición.
  // Compatible con cualquier proyecto del codebase neura-erp.
  // ──────────────────────────────────────────────────────────────────────
  {
    spec_file: "funcional/ventas.spec.ts",
    nombre: "Ventas · Últimas 20 operaciones se listan",
    descripcion: "Trae las últimas 20 ventas con GET y verifica que el endpoint responde sin error.",
    tipo: "auditoria_funcional_negocio",
    tests: 1,
    requiere_credenciales: true,
    efecto: "lectura_autenticada_estricta",
    solo_lectura_estricta: true,
    modulo_negocio: "Ventas",
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "funcional/ventas.spec.ts",
    nombre: "Ventas · El total coincide con la suma de ítems − descuento",
    descripcion: "Para cada venta: Σ(cantidad × precio) − descuento debe igualar el total informado.",
    tipo: "auditoria_funcional_negocio",
    tests: 1,
    requiere_credenciales: true,
    efecto: "lectura_autenticada_estricta",
    solo_lectura_estricta: true,
    modulo_negocio: "Ventas",
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "funcional/ventas.spec.ts",
    nombre: "Ventas · Cabecera y detalle son coherentes",
    descripcion: "Una venta tomada al azar tiene al menos un ítem y su cuerpo responde sin romper.",
    tipo: "auditoria_funcional_negocio",
    tests: 1,
    requiere_credenciales: true,
    efecto: "lectura_autenticada_estricta",
    solo_lectura_estricta: true,
    modulo_negocio: "Ventas",
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "funcional/ventas.spec.ts",
    nombre: "Ventas · Totales del día coinciden con el reporte",
    descripcion: "Si existe /api/reportes/ventas, debe responder 200 para el mes en curso.",
    tipo: "auditoria_funcional_negocio",
    tests: 1,
    requiere_credenciales: true,
    efecto: "lectura_autenticada_estricta",
    solo_lectura_estricta: true,
    modulo_negocio: "Ventas",
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "funcional/compras.spec.ts",
    nombre: "Compras · Últimas 20 se listan",
    descripcion: "GET /api/compras con limit=20 responde 200 y entrega un listado.",
    tipo: "auditoria_funcional_negocio",
    tests: 1,
    requiere_credenciales: true,
    efecto: "lectura_autenticada_estricta",
    solo_lectura_estricta: true,
    modulo_negocio: "Compras",
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "funcional/compras.spec.ts",
    nombre: "Compras · Total coincide con Σ (costo × cantidad) de ítems",
    descripcion: "Para cada compra: la suma de costo × cantidad por ítem debe igualar el total informado.",
    tipo: "auditoria_funcional_negocio",
    tests: 1,
    requiere_credenciales: true,
    efecto: "lectura_autenticada_estricta",
    solo_lectura_estricta: true,
    modulo_negocio: "Compras",
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "funcional/compras.spec.ts",
    nombre: "Compras · El proveedor cargado existe en el catálogo",
    descripcion: "El proveedor_id de una compra al azar debe existir en /api/proveedores.",
    tipo: "auditoria_funcional_negocio",
    tests: 1,
    requiere_credenciales: true,
    efecto: "lectura_autenticada_estricta",
    solo_lectura_estricta: true,
    modulo_negocio: "Compras",
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "funcional/inventario.spec.ts",
    nombre: "Inventario · Los productos listados tienen stock numérico",
    descripcion: "Los primeros 20 productos deben tener stock_actual como número finito.",
    tipo: "auditoria_funcional_negocio",
    tests: 1,
    requiere_credenciales: true,
    efecto: "lectura_autenticada_estricta",
    solo_lectura_estricta: true,
    modulo_negocio: "Inventario",
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "funcional/inventario.spec.ts",
    nombre: "Inventario · Stock actual = inicial + movimientos",
    descripcion: "Para un producto al azar, stock_actual debe igualar stock_inicial + Σ(movimientos.cantidad).",
    tipo: "auditoria_funcional_negocio",
    tests: 1,
    requiere_credenciales: true,
    efecto: "lectura_autenticada_estricta",
    solo_lectura_estricta: true,
    modulo_negocio: "Inventario",
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "funcional/inventario.spec.ts",
    nombre: "Inventario · Productos bajo mínimo se identifican",
    descripcion: "GET /api/inventario/bajo-minimo debe responder 200 y devolver JSON.",
    tipo: "auditoria_funcional_negocio",
    tests: 1,
    requiere_credenciales: true,
    efecto: "lectura_autenticada_estricta",
    solo_lectura_estricta: true,
    modulo_negocio: "Inventario",
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "funcional/caja.spec.ts",
    nombre: "Caja · Cierre del día = apertura + ingresos − egresos",
    descripcion: "El saldo declarado de cada caja debe igualar apertura + ingresos − egresos.",
    tipo: "auditoria_funcional_negocio",
    tests: 1,
    requiere_credenciales: true,
    efecto: "lectura_autenticada_estricta",
    solo_lectura_estricta: true,
    modulo_negocio: "Caja",
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "funcional/caja.spec.ts",
    nombre: "Caja · Cada movimiento tiene categoría",
    descripcion: "Ningún movimiento de caja puede tener la categoría vacía.",
    tipo: "auditoria_funcional_negocio",
    tests: 1,
    requiere_credenciales: true,
    efecto: "lectura_autenticada_estricta",
    solo_lectura_estricta: true,
    modulo_negocio: "Caja",
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "funcional/caja.spec.ts",
    nombre: "Caja · Máximo una caja abierta por sucursal",
    descripcion: "No puede haber dos cajas en estado abierta simultáneas en una misma sucursal.",
    tipo: "auditoria_funcional_negocio",
    tests: 1,
    requiere_credenciales: true,
    efecto: "lectura_autenticada_estricta",
    solo_lectura_estricta: true,
    modulo_negocio: "Caja",
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "funcional/clientes.spec.ts",
    nombre: "Clientes · Últimos 20 se listan",
    descripcion: "GET /api/clientes con limit=20 responde 200.",
    tipo: "auditoria_funcional_negocio",
    tests: 1,
    requiere_credenciales: true,
    efecto: "lectura_autenticada_estricta",
    solo_lectura_estricta: true,
    modulo_negocio: "Clientes",
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "funcional/clientes.spec.ts",
    nombre: "Clientes · Búsqueda por teléfono devuelve 1+ resultado",
    descripcion: "Buscar el teléfono de un cliente existente no puede devolver vacío.",
    tipo: "auditoria_funcional_negocio",
    tests: 1,
    requiere_credenciales: true,
    efecto: "lectura_autenticada_estricta",
    solo_lectura_estricta: true,
    modulo_negocio: "Clientes",
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "funcional/clientes.spec.ts",
    nombre: "Clientes · No hay documentos duplicados",
    descripcion: "En las últimas 200 fichas de cliente, ningún número de documento aparece dos veces.",
    tipo: "auditoria_funcional_negocio",
    tests: 1,
    requiere_credenciales: true,
    efecto: "lectura_autenticada_estricta",
    solo_lectura_estricta: true,
    modulo_negocio: "Clientes",
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "funcional/cobranzas.spec.ts",
    nombre: "Cobranzas · Últimos 20 pagos se listan",
    descripcion: "GET /api/pagos con limit=20 responde 200.",
    tipo: "auditoria_funcional_negocio",
    tests: 1,
    requiere_credenciales: true,
    efecto: "lectura_autenticada_estricta",
    solo_lectura_estricta: true,
    modulo_negocio: "Cobranzas",
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "funcional/cobranzas.spec.ts",
    nombre: "Cobranzas · Saldo de cliente = facturado − pagado",
    descripcion: "Para una cuenta corriente al azar, el saldo debe igualar facturado − pagado.",
    tipo: "auditoria_funcional_negocio",
    tests: 1,
    requiere_credenciales: true,
    efecto: "lectura_autenticada_estricta",
    solo_lectura_estricta: true,
    modulo_negocio: "Cobranzas",
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "funcional/cobranzas.spec.ts",
    nombre: "Cobranzas · Cuentas con saldo a favor del cliente se identifican",
    descripcion: "GET /api/cobros/cuentas?saldo=negativo debe responder 200 si el filtro existe.",
    tipo: "auditoria_funcional_negocio",
    tests: 1,
    requiere_credenciales: true,
    efecto: "lectura_autenticada_estricta",
    solo_lectura_estricta: true,
    modulo_negocio: "Cobranzas",
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "funcional/reportes.spec.ts",
    nombre: "Reportes · Total ventas del mes = suma de ventas individuales",
    descripcion: "El total agregado en /api/reportes/ventas?mes=X debe coincidir con la suma de ventas listadas en ese mes.",
    tipo: "auditoria_funcional_negocio",
    tests: 1,
    requiere_credenciales: true,
    efecto: "lectura_autenticada_estricta",
    solo_lectura_estricta: true,
    modulo_negocio: "Reportes",
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "funcional/reportes.spec.ts",
    nombre: "Reportes · Gastos del mes = compras + egresos de caja",
    descripcion: "GET /api/reportes/ingresos-egresos debe responder 200 para el mes en curso.",
    tipo: "auditoria_funcional_negocio",
    tests: 1,
    requiere_credenciales: true,
    efecto: "lectura_autenticada_estricta",
    solo_lectura_estricta: true,
    modulo_negocio: "Reportes",
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
  {
    spec_file: "funcional/reportes.spec.ts",
    nombre: "Reportes · Ningún total es NaN o null",
    descripcion: "En los reportes principales del mes, el JSON no debe contener NaN ni `\"total\": null`.",
    tipo: "auditoria_funcional_negocio",
    tests: 1,
    requiere_credenciales: true,
    efecto: "lectura_autenticada_estricta",
    solo_lectura_estricta: true,
    modulo_negocio: "Reportes",
    compatible_con: (p) => noEsProduccion(p) && esErpNeura(p),
  },
];

const ETIQUETAS_TIPO: Record<TipoDePrueba, { etiqueta: string; descripcion: string; orden: number }> = {
  auditoria_estatica: {
    etiqueta: "Auditoría estática de código",
    descripcion:
      "Análisis del repositorio Git sin tocar el ERP publicado. Secretos, dependencias, rutas API sin guard, cabeceras de seguridad, patrones de SQL interpolada y contrato env-assert.",
    orden: 0,
  },
  auditoria_funcional_negocio: {
    etiqueta: "Auditoría funcional del negocio",
    descripcion:
      "Pruebas de lectura sobre Ventas, Compras, Inventario, Caja, Clientes, Cobranzas y Reportes. Requieren un usuario QA de sólo lectura. Nunca escriben ni envían mensajes.",
    orden: 1,
  },
  disponibilidad: {
    etiqueta: "Disponibilidad",
    descripcion: "Que el sitio responda, que el servidor esté arriba, que no filtre secretos.",
    orden: 2,
  },
  inicio_sesion: {
    etiqueta: "Inicio de sesión",
    descripcion: "Que la página de login funcione y que el acceso con usuario esté operativo.",
    orden: 3,
  },
  navegacion: {
    etiqueta: "Navegación",
    descripcion: "Que las páginas internas abran correctamente tras loguear.",
    orden: 4,
  },
  seguridad: {
    etiqueta: "Seguridad y aislamiento",
    descripcion: "Que las rutas sensibles estén bloqueadas y las defensas estén activas.",
    orden: 5,
  },
  auditoria_integral: {
    etiqueta: "Auditoría integral del ERP",
    descripcion:
      "Cobertura amplia por módulo (disponibilidad, login, API, cabeceras, navegación, reportes, permisos). Reutilizable para todos los ERP del codebase Neura.",
    orden: 6,
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
 * Efecto declarado (o derivado) de una spec. Default seguro:
 * - requiere_credenciales=false  → "lectura_anonima"
 * - requiere_credenciales=true   → "lectura_con_sesion"
 * "escritura" NUNCA es default: hay que declararlo explícitamente.
 */
export function efectoDeSpec(spec_file: string): EfectoPrueba | null {
  const p = CATALOGO_PRUEBAS.find((x) => x.spec_file === spec_file);
  if (!p) return null;
  if (p.efecto) return p.efecto;
  return p.requiere_credenciales ? "lectura_con_sesion" : "lectura_anonima";
}

/**
 * Nivel de seguridad agregado de una lista de specs:
 * - "static_analysis"       → todas son analisis_estatico (sobre repo)
 * - "anonymous_read_only"   → todas son lectura_anonima (anónima runtime)
 * - "standard"              → al menos una es lectura_con_sesion
 * - "write_required"        → al menos una es escritura (no se permite ejecutar hoy)
 * - "mixed_analysis"        → mezcla analisis_estatico con otra clase (no permitido)
 * - null                    → alguna spec no está en el catálogo
 */
export type NivelSeguridadRun =
  | "static_analysis"
  | "anonymous_read_only"
  | "authenticated_read_only"
  | "standard"
  | "write_required"
  | "mixed_analysis";

export function nivelSeguridadDeSpecs(specs: ReadonlyArray<string>): NivelSeguridadRun | null {
  if (specs.length === 0) return null;
  let tieneSesion = false;
  let tieneEstatico = false;
  let tieneRuntime = false;
  let tieneROEstricto = false;
  let tieneSesionNoEstricta = false;
  for (const s of specs) {
    const entrada = CATALOGO_PRUEBAS.find((p) => p.spec_file === s && soloLecturaEstricta(p, s));
    const e = efectoDeSpec(s);
    if (!e) return null;
    if (e === "escritura") return "write_required";
    if (e === "analisis_estatico") {
      tieneEstatico = true;
      continue;
    }
    tieneRuntime = true;
    if (e === "lectura_autenticada_estricta" || (entrada && entrada.solo_lectura_estricta)) {
      tieneROEstricto = true;
    } else if (e === "lectura_con_sesion") {
      tieneSesion = true;
      tieneSesionNoEstricta = true;
    }
  }
  if (tieneEstatico && tieneRuntime) return "mixed_analysis";
  if (tieneEstatico) return "static_analysis";
  // Mezcla entre lectura_autenticada_estricta y lectura_con_sesion no-estricta
  // cae a "standard" por seguridad (la no-estricta puede tener efectos).
  if (tieneROEstricto && !tieneSesionNoEstricta) return "authenticated_read_only";
  return tieneSesion ? "standard" : "anonymous_read_only";
}

function soloLecturaEstricta(p: PruebaDisponible, spec: string): boolean {
  if (p.spec_file !== spec) return false;
  return p.solo_lectura_estricta === true || p.efecto === "lectura_autenticada_estricta";
}

/**
 * Override temporal del repo_url por slug de proyecto. Si la DB no tiene
 * `repo_url` configurado para el proyecto, acá se puede inyectar sin
 * modificar la columna.
 */
export const REPO_URL_OVERRIDE: Readonly<Record<string, string>> = {
  "erp-roldan-pendiente-entrega": "https://github.com/bartsilvera12-gif/neura-erp-roldan",
};

export function resolverRepoUrlProyecto(slug: string, repoUrl: string | null | undefined): string | null {
  const existente = (repoUrl ?? "").trim();
  if (existente.length > 0) return existente;
  return REPO_URL_OVERRIDE[slug] ?? null;
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
  auditoria_estatica: "estatic",
  auditoria_funcional_negocio: "funcneg",
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
