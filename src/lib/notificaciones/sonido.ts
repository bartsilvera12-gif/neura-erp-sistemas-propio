/**
 * Sonidos de aviso del ERP: campanita general, recordatorio de reunión y
 * chat de cliente. Se reproduce el archivo /sounds/noti.mp3 servido desde
 * public/, el mismo tono unificado del inbox — así el operador reconoce el
 * aviso venga de donde venga.
 *
 * `prepararSonidos()` se llama al montar el layout para desbloquear la
 * reproducción con el primer gesto (algunos navegadores/WebViews bloquean
 * audio sin interacción previa). No mantiene AudioContext propio: HTMLAudio
 * ya maneja la política de autoplay con el mismo gate del gesto.
 */

const STORAGE_KEY = "neura_erp_proyectos_notification_sound";
const SOUND_URL = "/sounds/noti.mp3";

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

// Elemento único reutilizado: evita crear un Audio por aviso y permite que
// avisos casi simultáneos no se pisen entre sí (el segundo reinicia el clip).
let audioCompartido: HTMLAudioElement | null = null;

function obtenerAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  try {
    if (!audioCompartido) {
      audioCompartido = new Audio(SOUND_URL);
      audioCompartido.preload = "auto";
      audioCompartido.volume = 0.8;
    }
    return audioCompartido;
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
export function prepararSonidos(): void {
  if (typeof window === "undefined") return;
  const desbloquear = () => {
    const a = obtenerAudio();
    if (!a) return;
    const volPrev = a.volume;
    a.volume = 0;
    void a
      .play()
      .then(() => {
        a.pause();
        a.currentTime = 0;
        a.volume = volPrev;
        window.removeEventListener("pointerdown", desbloquear);
        window.removeEventListener("keydown", desbloquear);
      })
      .catch(() => {
        a.volume = volPrev;
      });
  };
  window.addEventListener("pointerdown", desbloquear, { passive: true });
  window.addEventListener("keydown", desbloquear);
}

function reproducir(): void {
  if (!leerSonidoActivado()) return;
  const a = obtenerAudio();
  if (!a) return;
  try {
    a.currentTime = 0;
    void a.play().catch(() => {});
  } catch {
    /* Sin audio disponible: el aviso igual llegó y se ve en el panel. */
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
