"use client";

/**
 * Piezas compartidas de Soporte en la app del asesor: la misma API que usa el módulo de
 * escritorio y la app nativa (Zentra Dev), y los colores por estado/prioridad de la nativa.
 */

export type PersonaSoporte = { nombre?: string | null; area?: string | null };

export type TicketMovil = {
  id: string;
  numero: number | null;
  asunto: string | null;
  descripcion?: string | null;
  estado_codigo: string;
  estado_nombre: string | null;
  prioridad_codigo: string | null;
  prioridad_nombre: string | null;
  cliente_nombre: string | null;
  responsable: PersonaSoporte | null;
  tipo_etiqueta?: string | null;
  clasificacion_nombre?: string | null;
  fecha_objetivo?: string | null;
  proxima_accion?: string | null;
  proyecto_titulo?: string | null;
  sla?: { estado?: string | null } | null;
};

export const PESTANAS = [
  { id: "todos", etiqueta: "Todos" },
  { id: "pendientes", etiqueta: "Pendientes" },
  { id: "en_proceso", etiqueta: "En proceso" },
  { id: "falta_informacion", etiqueta: "Falta información" },
  { id: "revision", etiqueta: "En revisión" },
  { id: "resueltos", etiqueta: "Resueltos" },
  { id: "cerrados", etiqueta: "Cerrados" },
] as const;

export type PestanaId = (typeof PESTANAS)[number]["id"];

/** Tono de un estado: color principal (texto/indicador) y fondo suave. Igual que la nativa. */
type Tono = { color: string; fondo: string; solido: string };

const TONOS = {
  marca: { color: "#0E97A8", fondo: "#C8F5FA", solido: "#3F8E91" },
  pendiente: { color: "#B7791F", fondo: "#FFF3D6", solido: "#FFB020" },
  enProceso: { color: "#2563EB", fondo: "#DBEAFE", solido: "#3B82F6" },
  faltaInfo: { color: "#9333EA", fondo: "#F3E8FF", solido: "#A855F7" },
  revision: { color: "#4F46E5", fondo: "#E0E7FF", solido: "#6366F1" },
  urgente: { color: "#E11D48", fondo: "#FFE1E4", solido: "#FF4757" },
  alta: { color: "#EA580C", fondo: "#FFEDD5", solido: "#F97316" },
  resuelto: { color: "#16A34A", fondo: "#DCFCE7", solido: "#22C55E" },
  normal: { color: "#64748B", fondo: "#E8EDF3", solido: "#64748B" },
} satisfies Record<string, Tono>;

export function tonoEstado(codigo: string | null | undefined): Tono {
  switch (codigo) {
    case "pendiente":
      return TONOS.pendiente;
    case "en_proceso":
    case "reabierto":
      return TONOS.enProceso;
    case "falta_informacion":
      return TONOS.faltaInfo;
    case "listo_revision":
      return TONOS.revision;
    case "resuelto":
    case "cerrado":
      return TONOS.resuelto;
    default:
      return TONOS.normal;
  }
}

export function tonoPrioridad(codigo: string | null | undefined): Tono {
  if (codigo === "urgente" || codigo === "critica") return TONOS.urgente;
  if (codigo === "alta") return TONOS.alta;
  return TONOS.normal;
}

export function tonoPestana(id: PestanaId): Tono {
  switch (id) {
    case "todos":
      return TONOS.marca;
    case "pendientes":
      return TONOS.pendiente;
    case "en_proceso":
      return TONOS.enProceso;
    case "falta_informacion":
      return TONOS.faltaInfo;
    case "revision":
      return TONOS.revision;
    default:
      return TONOS.resuelto;
  }
}

export function Chip({ texto, tono }: { texto: string; tono: Tono }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold"
      style={{ color: tono.color, backgroundColor: tono.fondo }}
    >
      {texto}
    </span>
  );
}

export const slaVencido = (t: TicketMovil) => (t.sla?.estado ?? "").toLowerCase() === "vencido";
