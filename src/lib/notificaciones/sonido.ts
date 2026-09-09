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
  volumen: number
): void {
  if (!leerSonidoActivado()) return;
  const c = obtenerContexto();
  if (!c) return;
  try {
    const { ctx, salida } = c;
    const base = ctx.currentTime + 0.02;
    for (const { freq, inicio, dur } of notas) {
      // Fundamental y octava. La segunda entra al 28 %: lo justo para dar
      // brillo sin que se escuche como una nota aparte.
      for (const [mult, peso] of [
        [1, 1],
        [2, 0.28],
      ] as const) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq * mult;
        const t = base + inicio;
        gain.gain.setValueAtTime(0, t);
        // 4 ms de ataque: instantáneo para el oído, sin el "click" del corte seco.
        gain.gain.linearRampToValueAtTime(volumen * peso, t + 0.004);
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
 * Dos toques cortos que suben una cuarta, con caída larga: el "bloop-bloop"
 * de los mensajeros. No es el archivo de Discord —ese tiene dueño y meterlo
 * acá sería usar algo ajeno sin licencia—, sino el mismo tipo de sonido hecho
 * con osciladores: dos notas de campana, ataque seco y cola que se apaga sola.
 */
export function reproducirSonidoNotificacion(): void {
  tocarCampana(
    [
      { freq: 1046.5, inicio: 0, dur: 0.42 }, // C6
      { freq: 1396.9, inicio: 0.13, dur: 0.58 }, // F6
    ],
    0.5
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
