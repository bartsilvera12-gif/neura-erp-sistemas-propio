/**
 * Helpers de grabación de nota de voz (MediaRecorder), compartidos entre el composer
 * de escritorio y el de la app móvil.
 *
 * Quirk de iOS: Safari y el WKWebView de iPhone **no soportan `audio/webm`** (ni opus);
 * solo graban `audio/mp4` (AAC). Android/Chrome sí soportan webm/opus. Si no se elige un
 * mime explícito soportado, iOS graba de forma menos confiable y el archivo termina mal
 * nombrado (`.webm` con contenido mp4). Por eso probamos webm primero (mejor para el
 * transcode) y caemos a mp4 para iOS.
 */

/** Candidatos en orden de preferencia. webm/opus es lo más liviano; mp4/aac cubre iOS. */
const RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/aac",
] as const;

/**
 * Devuelve el mejor `mimeType` soportado por este dispositivo para grabar, o `""` si
 * ninguno matchea (en ese caso el caller crea `MediaRecorder` sin opciones y usa el default).
 */
export function pickRecorderMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const c of RECORDER_MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* isTypeSupported puede lanzar en algunos navegadores viejos: ignorar y seguir. */
    }
  }
  return "";
}

/** Extensión de archivo según el mime real del blob grabado (iOS → mp4, Android → webm). */
export function extForAudioType(type: string | undefined | null): string {
  const t = (type || "").toLowerCase();
  if (t.includes("ogg")) return "ogg";
  if (t.includes("mp4") || t.includes("m4a") || t.includes("aac")) return "mp4";
  return "webm";
}
