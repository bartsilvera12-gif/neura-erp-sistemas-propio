/**
 * Convierte eventos crudos del runner (claves técnicas como `modo_produccion_lectura`
 * o `credenciales_resueltas`) a texto natural que un no-técnico pueda leer.
 *
 * La idea: nunca mostrar el identificador tal cual; si no hay mapeo, generamos
 * una versión capitalizada y sin guiones bajos.
 */

export type EventoCrudo = {
  fase: string;
  accion: string | null;
  mensaje: string | null;
  modulo: string | null;
  submodulo: string | null;
};

export type EventoHumano = {
  titulo: string;
  descripcion: string | null;
  icono: "login" | "nav" | "click" | "input" | "check" | "warn" | "fail" | "ok" | "info" | "wait";
};

const ACCION_A_TEXTO: Record<string, { titulo: string; icono: EventoHumano["icono"] }> = {
  job_claimed:                { titulo: "Agente listo",                       icono: "info" },
  modo_produccion_lectura:    { titulo: "Modo lectura seguro activado",       icono: "check" },
  credenciales_resueltas:     { titulo: "Credenciales obtenidas",             icono: "check" },
  ir_a_login:                 { titulo: "Abriendo la pantalla de login",      icono: "nav" },
  enviar_credenciales:        { titulo: "Ingresando usuario y contraseña",    icono: "input" },
  login_ok:                   { titulo: "Login exitoso",                       icono: "ok" },
  login_fail:                 { titulo: "No se pudo iniciar sesión",          icono: "fail" },
  mapear_navegacion:          { titulo: "Mapeando el menú del ERP",           icono: "nav" },
  navegar_modulo:             { titulo: "Visitando módulo",                   icono: "nav" },
  visitar:                    { titulo: "Entrando a",                         icono: "nav" },
  click:                      { titulo: "Click",                              icono: "click" },
  escribir:                   { titulo: "Escribiendo",                        icono: "input" },
  esperar:                    { titulo: "Esperando respuesta",                icono: "wait" },
  capturar_pantalla:          { titulo: "Captura de pantalla",                icono: "info" },
  verificar:                  { titulo: "Verificando estado",                 icono: "check" },
  reportar_error:             { titulo: "Error detectado",                    icono: "fail" },
  reportar_advertencia:       { titulo: "Advertencia",                        icono: "warn" },
  finalizar:                  { titulo: "Ejecución finalizada",               icono: "ok" },
};

const FASE_A_ETIQUETA: Record<string, string> = {
  general:     "General",
  login:       "Autenticación",
  interaction: "Interacción",
  navigation:  "Navegación",
  assert:      "Verificación",
  cleanup:     "Limpieza",
  runner:      "Runner",
};

function toTituloCasual(k: string): string {
  return k
    .replace(/[_-]+/g, " ")
    .replace(/\b([a-z])/g, (_m, c) => c.toUpperCase())
    .trim();
}

/** Hace legible una URL — quita protocolo, query, y recorta si es muy larga. */
function urlAmigable(valor: string): string {
  try {
    const u = new URL(valor);
    const path = u.pathname === "/" ? "" : u.pathname;
    const base = `${u.host}${path}`;
    return base.length > 60 ? base.slice(0, 57) + "…" : base;
  } catch {
    return valor.length > 60 ? valor.slice(0, 57) + "…" : valor;
  }
}

/** Mensaje del runner → descripción natural. Oculta tokens/emails/paths feos. */
function limpiarMensaje(mensaje: string | null): string | null {
  if (!mensaje) return null;
  // Las URLs quedan más legibles acortadas.
  const conUrls = mensaje.replace(/https?:\/\/[^\s)]+/g, (u) => urlAmigable(u));
  // Emails parciales (ad***@dominio) los dejamos: ya vienen ofuscados.
  return conUrls.length > 180 ? conUrls.slice(0, 177) + "…" : conUrls;
}

export function humanizarEvento(e: EventoCrudo): EventoHumano {
  const map = e.accion ? ACCION_A_TEXTO[e.accion] : null;
  const titulo = map?.titulo ?? (e.accion ? toTituloCasual(e.accion) : toTituloCasual(e.fase));
  return {
    titulo,
    descripcion: limpiarMensaje(e.mensaje),
    icono: map?.icono ?? "info",
  };
}

export function etiquetaDeFase(fase: string): string {
  return FASE_A_ETIQUETA[fase] ?? toTituloCasual(fase);
}

export function etiquetaDeModulo(modulo: string | null): string {
  if (!modulo || modulo === "__general__") return "General";
  return toTituloCasual(modulo);
}
