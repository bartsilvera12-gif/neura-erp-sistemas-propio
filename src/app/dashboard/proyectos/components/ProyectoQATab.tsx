"use client";

/**
 * Punto de montaje histórico de la pestaña QA (lo usa `ProyectoDetalleInner`).
 * La implementación vive en `./qa/`: `QATabRoot` elige entre el registro de
 * observaciones y el checklist original.
 */
export { default } from "./qa/QATabRoot";
