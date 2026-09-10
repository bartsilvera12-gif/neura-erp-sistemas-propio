/**
 * Sonidos de aviso del ERP: campanita general, recordatorio de reunión y
 * chat de cliente. Reproduce el tono elegido por el operador (12 opciones
 * personalizables desde el dropdown de la campanita); default: Tono 1.
 *
 * `prepararSonidos()` se llama al montar el layout para desbloquear la
 * reproducción con el primer gesto (WebViews / autoplay policies).
 */

import { obtenerUrlTonoActual } from "@/lib/notificaciones/tono-preferencia";

const STORAGE_KEY = "neura_erp_proyectos_notification_sound";

export function leerSonidoActivado(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === null) return true;
    return v === "1" || v === "true";
  } catch {
    return true;
  }
}

export function escribirSonidoActivado(activado: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, activado ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/**
 * Volumen de trabajo, como CONSTANTE y no leído del elemento.
 *
 * Antes el desbloqueo hacía `volPrev = a.volume` → `a.volume = 0` → play() →
 * restaurar en el `.then()`. Con dos clics seguidos —o sea, siempre— el segundo
 * leía el volumen que el primero ya había puesto en 0 y lo "restauraba" a 0. El
 * elemento quedaba mudo para siempre, sin ningún error: la notificación
 * llegaba, `play()` resolvía bien, y no se escuchaba nada.
 */
const VOLUMEN = 0.8;

// Cache de un HTMLAudioElement por URL para no crear uno por aviso. Al cambiar
// de tono en la config, la próxima llamada carga el nuevo y descarta el viejo.
let audioActual: { url: string; el: HTMLAudioElement } | null = null;

function obtenerAudio(url: string): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  try {
    if (!audioActual || audioActual.url !== url) {
      const el = new Audio(url);
      el.preload = "auto";
      el.volume = VOLUMEN;
      audioActual = { url, el };
    }
    const el = audioActual.el;
    // Cinturón: si algo lo dejó mudo, se corrige antes de cada uso. Es barato y
    // es la diferencia entre un aviso que se oye y uno que no.
    el.muted = false;
    if (el.volume !== VOLUMEN) el.volume = VOLUMEN;
    return el;
  } catch {
    return null;
  }
}

/**
 * Desbloquea el audio con el primer gesto del usuario. Los WebViews y algunos
 * navegadores no dejan reproducir sonido sin una interacción previa; hacemos
 * un play()+pause() silencioso en el primer pointerdown/keydown para que los
 * avisos posteriores suenen sin fricción.
 */
let desbloqueando = false;
let armado = false;

export function prepararSonidos(): void {
  if (typeof window === "undefined" || armado) return;
  armado = true;

  const desbloquear = () => {
    // Sin esto, dos clics seguidos se pisan: el segundo entra mientras el
    // primero todavía tiene el elemento en silencio.
    if (desbloqueando) return;
    desbloqueando = true;

    const a = obtenerAudio(obtenerUrlTonoActual());
    if (!a) {
      desbloqueando = false;
      return;
    }
    // Se silencia con `muted` y no bajando el volumen: es un booleano, no un
    // valor que haya que acordarse de restaurar al número correcto.
    a.muted = true;
    void a
      .play()
      .then(() => {
        a.pause();
        a.currentTime = 0;
        window.removeEventListener("pointerdown", desbloquear);
        window.removeEventListener("keydown", desbloquear);
      })
      .catch(() => {
        // Sigue armado: el próximo gesto vuelve a intentar.
      })
      .finally(() => {
        a.muted = false;
        a.volume = VOLUMEN;
        desbloqueando = false;
      });
  };

  window.addEventListener("pointerdown", desbloquear, { passive: true });
  window.addEventListener("keydown", desbloquear);
}

function reproducir(): void {
  if (!leerSonidoActivado()) return;
  const a = obtenerAudio(obtenerUrlTonoActual());
  if (!a) return;
  try {
    a.currentTime = 0;
    void a.play().catch((e: unknown) => {
      // Se registra en vez de tragarse el error. Un aviso que no suena y no
      // deja rastro es imposible de diagnosticar después: fue exactamente lo
      // que pasó acá.
      console.warn("[sonido] no se pudo reproducir el aviso", e);
    });
  } catch (e) {
    console.warn("[sonido] no se pudo reproducir el aviso", e);
  }
}

/** Reproduce el tono elegido, para probarlo desde la configuración. */
export function probarSonido(): void {
  const a = obtenerAudio(obtenerUrlTonoActual());
  if (!a) return;
  try {
    a.currentTime = 0;
    void a.play().catch((e: unknown) => {
      console.warn("[sonido] no se pudo reproducir la prueba", e);
    });
  } catch (e) {
    console.warn("[sonido] no se pudo reproducir la prueba", e);
  }
}

/** Campanita general (QA, cambios de estado, avisos de esqueleto). */
export function reproducirSonidoNotificacion(): void {
  reproducir();
}

/** Recordatorio de reunión. */
export function reproducirSonidoReunion(): void {
  reproducir();
}

/** Chat de cliente esperando en la cola. */
export function reproducirSonidoConversacion(): void {
  reproducir();
}
