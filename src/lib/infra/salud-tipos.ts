/**
 * Forma de los archivos que deja el colector de salud (uno por servidor, se
 * reescriben cada minuto). Los tipos están acá para que la API y la pantalla
 * lean exactamente lo mismo.
 */

export type EstadoContenedor = {
  name: string;
  domain: string;
  /** "running", "exited", "restarting"… lo que reporta Docker. */
  state: string;
  /** "healthy" | "unhealthy" | "starting" | "none" (none = sin healthcheck, NO es un problema). */
  health: string;
};

export type LimpiezaServidor = {
  last_run: string;
  ts: number;
  freed_mb: number;
  disk_pct: number;
  actions: string[];
};

export type SaludServidor = {
  server: string;
  /** Epoch en segundos de cuando se generó el archivo. */
  ts: number;
  generated_at: string;
  ram: { total_mb: number; used_mb: number; avail_mb: number };
  swap: { total_mb: number; used_mb: number; pct: number };
  disk: { used_kb: number; total_kb: number; pct: number };
  /**
   * `cpu_pct` es el uso real de CPU. `l1/l5/l15` son la carga del sistema y NO
   * se muestran como porcentaje: una carga de 6 en 8 núcleos es normal y
   * pintada de rojo sería una falsa alarma.
   */
  load: { cpu_pct: number; l1: number; l5: number; l15: number; vcpu: number };
  containers: EstadoContenedor[];
  cleanup: LimpiezaServidor | null;
};

/** Archivo que falta o vino roto: la pantalla lo muestra en gris, sin romper el resto. */
export type SaludServidorError = { server: string; error: true };

export type SaludServidorItem = SaludServidor | SaludServidorError;

export type RespuestaSaludInfra = {
  servers: SaludServidorItem[];
  /** Epoch en segundos del servidor, para medir si un archivo quedó viejo. */
  now: number;
};

export function esSaludConError(s: SaludServidorItem): s is SaludServidorError {
  return (s as SaludServidorError).error === true;
}

/** Los tres servidores, en el orden en que se muestran. */
export const SERVIDORES_INFRA = ["produccion", "build", "hostinger"] as const;

export const NOMBRE_SERVIDOR: Record<string, string> = {
  produccion: "Producción",
  build: "Build server",
  hostinger: "Hostinger · Supabase",
};
