/**
 * Borrador de "Nueva observación" por proyecto.
 *
 * Quien carga QA cambia de pestaña o sale del proyecto a mitad de una
 * observación; al volver tiene que encontrar lo que escribió. Los textos y
 * selectores van a localStorage (sobreviven a recargar la página). Las capturas
 * pegadas son archivos en memoria: se retienen mientras la pestaña del
 * navegador siga abierta, pero no a una recarga completa.
 */

export type BorradorQA = {
  titulo: string;
  descripcion: string;
  seccionId: string;
  nuevaSeccion: string;
  severidad: string;
  origen: string;
  asignadoA: string;
  fechaLimite: string;
  urlRef: string;
};

export type CapturaPendiente = { file: File; preview: string; id: string };

const clave = (projectId: string) => `neura_qa_borrador:${projectId}`;
const capturas = new Map<string, CapturaPendiente[]>();

export function leerBorradorQA(projectId: string): BorradorQA | null {
  try {
    const raw = window.localStorage.getItem(clave(projectId));
    return raw ? (JSON.parse(raw) as BorradorQA) : null;
  } catch {
    return null;
  }
}

/** Guarda sólo si hay algo escrito; un formulario vacío borra el borrador. */
export function guardarBorradorQA(projectId: string, b: BorradorQA, pendientes: CapturaPendiente[]): void {
  const tieneTexto = !!(b.titulo.trim() || b.descripcion.trim() || b.nuevaSeccion.trim() || b.urlRef.trim());
  if (pendientes.length) capturas.set(projectId, pendientes);
  else capturas.delete(projectId);
  try {
    if (tieneTexto) window.localStorage.setItem(clave(projectId), JSON.stringify(b));
    else window.localStorage.removeItem(clave(projectId));
  } catch {
    /* sin almacenamiento: el borrador dura lo que el formulario abierto */
  }
}

export function capturasBorradorQA(projectId: string): CapturaPendiente[] {
  return capturas.get(projectId) ?? [];
}

export function borrarBorradorQA(projectId: string): void {
  capturas.delete(projectId);
  try {
    window.localStorage.removeItem(clave(projectId));
  } catch {
    /* nada que borrar */
  }
}

/** Hay algo a medio cargar (texto o capturas) para reabrir el formulario. */
export function hayBorradorQA(projectId: string): boolean {
  return capturasBorradorQA(projectId).length > 0 || leerBorradorQA(projectId) != null;
}
