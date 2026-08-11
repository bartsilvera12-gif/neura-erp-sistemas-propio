/**
 * Formas que devuelve `/api/proyectos/[id]/qa/observaciones` y `.../qa/secciones`.
 * Espejan los tipos server-side de `qa-shared.ts` (que no se pueden importar acá:
 * ese módulo es `server-only`). Los códigos de estado/severidad/origen sí vienen
 * del módulo isomórfico `qa-observaciones-config`.
 */

import type {
  QAObservacionEstado,
  QAObservacionOrigen,
  QAObservacionSeveridad,
} from "@/lib/proyectos/qa-observaciones-config";

export type QAUsuario = { id: string; nombre?: string | null; email?: string | null };

export type QASeccion = {
  id: string;
  proyecto_id: string;
  nombre: string;
  color: string | null;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type QAArchivo = {
  id: string;
  observacion_id: string;
  nombre: string;
  mime_type: string | null;
  size_bytes: number | null;
  sort_order: number;
  uploaded_by: string | null;
  created_at: string;
  /** Signed URL de 1 hora; `null` si el bucket no la pudo generar. */
  url: string | null;
};

export type QAComentario = {
  id: string;
  observacion_id: string;
  texto: string;
  autor_id: string | null;
  created_at: string;
  updated_at: string;
  autor_nombre: string | null;
};

export type QAObservacion = {
  id: string;
  proyecto_id: string;
  seccion_id: string | null;
  numero: number;
  titulo: string;
  descripcion: string | null;
  estado: QAObservacionEstado;
  severidad: QAObservacionSeveridad;
  origen: QAObservacionOrigen;
  url_referencia: string | null;
  asignado_a: string | null;
  fecha_limite: string | null;
  resuelto_por: string | null;
  resuelto_at: string | null;
  verificado_por: string | null;
  verificado_at: string | null;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archivos: QAArchivo[];
  comentarios_count: number;
  asignado_nombre: string | null;
  resuelto_por_nombre: string | null;
  verificado_por_nombre: string | null;
  created_by_nombre: string | null;
};

/** Props que `ProyectoDetalleInner` le pasa a la pestaña. */
export type QATabProps = {
  projectId: string;
  dataSchema: string;
  usuarios: QAUsuario[];
  /** Encabezado del PDF exportable. */
  projectTitle?: string | null;
};

export type QAApiResp<T> = { success?: boolean; data?: T; error?: string };
