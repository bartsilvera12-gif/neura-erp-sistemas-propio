/**
 * Sonidos de aviso del ERP: campanita de proyectos, recordatorio de reunión y
 * chat de cliente. Tonos sintetizados con Web Audio, sin archivo externo: no
 * hay asset que servir ni CORS que resolver, y el volumen queda consistente sin
 * depender de cómo se grabó un .mp3.
 *
 * Tres cosas que hacen que se escuchen de verdad, y que antes no estaban:
 *
 *  1. UN SOLO `AudioContext`, compartido y reutilizado. Antes se creaba uno por
 *     aviso: el navegador los arranca en estado `suspended` y, sin un gesto del
 *     usuario en ese instante, muchos no llegaban a sonar nunca.
 *  2. Se DESBLOQUEA con la primera interacción de la persona en la página y se
 *     hace `resume()` antes de cada sonido. Un contexto suspendido —lo que pasa
 *     al volver de una pestaña de fondo— no emite nada y no avisa del problema.
 *  3. VOLUMEN de trabajo. Los valores anteriores (0.07) se perdían contra el
 *     ruido de una oficina; el equipo reportó que no los escuchaba.
 *
 * Todo pasa por un compresor: sube el volumen percibido sin que los picos
 * distorsionen, que es lo que suena "roto" cuando uno simplemente sube el gain.
 */

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

// --- El contexto compartido -------------------------------------------------

let ctxCompartido: AudioContext | null = null;
let compresor: DynamicsCompressorNode | null = null;

function obtenerContexto(): { ctx: AudioContext; salida: AudioNode } | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctxCompartido) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctxCompartido = new AC();
      const c = ctxCompartido.createDynamicsCompressor();
      // Techo firme: deja subir el volumen sin que los picos raspen.
      c.threshold.value = -18;
      c.knee.value = 12;
      c.ratio.value = 8;
      c.attack.value = 0.003;
      c.release.value = 0.2;
      c.connect(ctxCompartido.destination);
      compresor = c;
    }
    // `suspended` es lo normal al volver de una pestaña de fondo.
    if (ctxCompartido.state === "suspended") void ctxCompartido.resume().catch(() => {});
    return { ctx: ctxCompartido, salida: compresor ?? ctxCompartido.destination };
  } catch {
    return null;
  }
}

/**
 * Deja el audio listo aprovechando un gesto del usuario.
 *
 * Los navegadores sólo permiten arrancar audio a partir de una interacción. Si
 * el primer sonido llega cuando la persona está en otra pestaña, ya es tarde:
 * hay que haber desbloqueado antes. Se llama una vez, al montar el layout.
 */
export function prepararSonidos(): void {
  if (typeof window === "undefined") return;
  const desbloquear = () => {
    const c = obtenerContexto();
    if (c && c.ctx.state === "running") {
      window.removeEventListener("pointerdown", desbloquear);
      window.removeEventListener("keydown", desbloquear);
    }
  };
  window.addEventListener("pointerdown", desbloquear, { passive: true });
  window.addEventListener("keydown", desbloquear);
  // Al volver a la pestaña, el contexto suele quedar suspendido.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") obtenerContexto();
  });
}

type Nota = { freq: number; inicio: number; dur?: number };

/** Toca una secuencia de notas. Todo lo demás de este módulo se apoya acá. */
function tocar(
  notas: Nota[],
  opciones: { tipo: OscillatorType; volumen: number; filtro?: number }
): void {
  if (!leerSonidoActivado()) return;
  const c = obtenerContexto();
  if (!c) return;
  try {
    const { ctx, salida } = c;
    const ahora = ctx.currentTime + 0.02;
    for (const { freq, inicio, dur = 0.18 } of notas) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = opciones.tipo;
      osc.frequency.value = freq;

      let nodo: AudioNode = osc;
      if (opciones.filtro) {
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = opciones.filtro;
        osc.connect(f);
        nodo = f;
      }

      const t = ahora + inicio;
      // Envolvente: sin la rampa, encender y apagar un tono seco hace "click".
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(opciones.volumen, t + 0.012);
      gain.gain.setValueAtTime(opciones.volumen, t + dur * 0.55);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      nodo.connect(gain);
      gain.connect(salida);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
  } catch {
    /* Sin audio disponible: el aviso igual llegó y se ve en el panel. */
  }
}

/**
 * Una nota tipo campana/marimba: ataque instantáneo y caída larga.
 *
 * El carácter no lo da la melodía sino la forma del sonido. Un tono sostenido
 * "pita"; este arranca de golpe y se apaga solo, que es lo que el oído lee como
 * un toque y no como una alarma. El armónico de octava por encima, más bajito,
 * es lo que le da el timbre de campana en vez de un pitido pelado.
 */
function tocarCampana(
  notas: { freq: number; inicio: number; dur: number }[],
  volumen: number,
  /**
   * Cuánto tarda en llegar al máximo. Un ataque de 4 ms es un golpe; uno de
   * 30 ms es un sonido que "entra". Es la diferencia entre sobresaltar y
   * avisar, y no se nota como lentitud.
   */
  ataque = 0.004,
  /** Peso del armónico de octava: cuanto más alto, más metálico. */
  brillo = 0.12
): void {
  if (!leerSonidoActivado()) return;
  const c = obtenerContexto();
  if (!c) return;
  try {
    const { ctx, salida } = c;
    const base = ctx.currentTime + 0.02;
    for (const { freq, inicio, dur } of notas) {
      // Fundamental y octava. La segunda entra bajita: da cuerpo de campana,
      // pero subirla es lo que vuelve el sonido metálico y molesto.
      for (const [mult, peso] of [
        [1, 1],
        [2, brillo],
      ] as const) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq * mult;
        const t = base + inicio;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(volumen * peso, t + ataque);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(gain);
        gain.connect(salida);
        osc.start(t);
        osc.stop(t + dur + 0.02);
      }
    }
  } catch {
    /* Sin audio disponible: el aviso igual llegó y se ve en el panel. */
  }
}

/**
 * Campanita general (QA, cambios de estado, avisos de esqueleto).
 *
 * Un carillón suave: dos notas que BAJAN una tercera mayor (E5→C5) y se dejan
 * sonar juntas hasta apagarse solas.
 *
 * Tres decisiones, y las tres apuntan a lo mismo — que a la quincuagésima vez
 * del día siga sin molestar:
 *
 *  · BAJA en vez de subir. Un intervalo ascendente el oído lo lee como una
 *    pregunta o una llamada, y pide atención; uno descendente suena a algo que
 *    se cierra, y alcanza para enterarse.
 *  · Ataque de 30 ms. No golpea: entra.
 *  · Cola de más de un segundo, con las dos notas superpuestas. El volumen
 *    puede bajar porque lo que hace que se escuche es la duración, no el pico.
 */
export function reproducirSonidoNotificacion(): void {
  tocarCampana(
    [
      { freq: 659.25, inicio: 0, dur: 1.1 }, // E5
      { freq: 523.25, inicio: 0.16, dur: 1.4 }, // C5 — baja una tercera
    ],
    0.36,
    0.03,
    0.07
  );
}

/**
 * Recordatorio de REUNIÓN: el más insistente de los tres.
 *
 * Una reunión que arranca en 30 minutos no puede sonar igual que una
 * observación de QA. Tres repeticiones, salto de quinta (E5→B5) —un intervalo
 * que el oído lee como llamada y no como confirmación— y el volumen más alto.
 */
export function reproducirSonidoReunion(): void {
  const notas: Nota[] = [];
  for (const base of [0, 0.42, 0.84]) {
    notas.push({ freq: 659.25, inicio: base, dur: 0.2 });
    notas.push({ freq: 987.77, inicio: base + 0.12, dur: 0.24 });
  }
  tocar(notas, { tipo: "triangle", volumen: 0.5 });
}

/**
 * Chat de cliente esperando en la cola.
 *
 * Se distingue de los otros dos sin escucharlos al lado, cambiando las tres
 * cosas que el oído separa mejor: baja en vez de subir, timbre más "digital"
 * (cuadrada filtrada) y registro más grave.
 */
export function reproducirSonidoConversacion(): void {
  tocar(
    [
      { freq: 783.99, inicio: 0, dur: 0.2 }, // G5
      { freq: 523.25, inicio: 0.11, dur: 0.3 }, // C5 — baja
      { freq: 783.99, inicio: 0.42, dur: 0.2 },
      { freq: 523.25, inicio: 0.53, dur: 0.34 },
    ],
    { tipo: "square", volumen: 0.34, filtro: 2200 }
  );
}
