/**
 * Avisos del sistema operativo (los que aparecen en la esquina de la pantalla).
 *
 * El sonido y la campanita sólo existen mientras la pestaña del ERP está a la
 * vista. Quien está en otra pestaña, en otro programa, o con el navegador
 * minimizado, no se entera de nada — y es justo la persona a la que hay que
 * avisarle. Esto sale de la pestaña.
 *
 * Reglas que se respetan a propósito:
 *
 *  - Sólo cuando la pestaña NO está visible. Si la persona está mirando el ERP,
 *    ya ve la campanita; un cartel encima sería ruido.
 *  - El permiso se pide con un gesto, no al cargar la página. Un navegador que
 *    recibe el pedido de entrada lo bloquea para siempre, y ahí ya no hay vuelta
 *    atrás sin ir a la configuración.
 *  - `tag` por notificación: si llegan tres avisos de la misma conversación, se
 *    reemplazan en vez de apilarse.
 */

const CLAVE_PEDIDO = "neura_erp_aviso_sistema_pedido";

export type EstadoPermiso = "granted" | "denied" | "default" | "no_soportado";

export function estadoPermisoAviso(): EstadoPermiso {
  if (typeof window === "undefined" || !("Notification" in window)) return "no_soportado";
  return Notification.permission as EstadoPermiso;
}

/**
 * Pide el permiso. Devuelve el estado final.
 *
 * Se llama desde un gesto del usuario. Si ya se pidió y lo negaron, no se
 * vuelve a molestar: el navegador ni siquiera mostraría el cartel.
 */
export async function pedirPermisoAviso(): Promise<EstadoPermiso> {
  const actual = estadoPermisoAviso();
  if (actual !== "default") return actual;
  try {
    window.localStorage.setItem(CLAVE_PEDIDO, "1");
  } catch {
    /* ignore */
  }
  try {
    return (await Notification.requestPermission()) as EstadoPermiso;
  } catch {
    return "denied";
  }
}

/**
 * Muestra el aviso, si corresponde.
 *
 * `destino` es a dónde llevar al hacer clic: se enfoca la ventana y se navega.
 * Devuelve `true` si se llegó a mostrar, para poder decidir qué hacer si no.
 */
export function mostrarAvisoSistema(args: {
  titulo: string;
  cuerpo: string;
  etiqueta?: string;
  destino?: string | null;
}): boolean {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission !== "granted") return false;
  // Con el ERP a la vista alcanza con la campanita.
  if (document.visibilityState === "visible") return false;

  try {
    const n = new Notification(args.titulo, {
      body: args.cuerpo,
      icon: "/icon.png",
      badge: "/icon.png",
      tag: args.etiqueta,
      // En silencio: el sonido lo pone el ERP, que distingue de qué tipo de
      // aviso se trata. Dos sonidos a la vez se escuchan como un ruido.
      silent: true,
    });
    n.onclick = () => {
      try {
        window.focus();
        if (args.destino) window.location.assign(args.destino);
      } catch {
        /* ignore */
      }
      n.close();
    };
    // No se quedan para siempre en pantalla.
    window.setTimeout(() => n.close(), 12_000);
    return true;
  } catch {
    return false;
  }
}
