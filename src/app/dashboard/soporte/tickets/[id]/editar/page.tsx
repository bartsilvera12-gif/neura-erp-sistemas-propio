"use client";

import { useRouter } from "next/navigation";
import FormTicket, { type ValoresTicket } from "../../../_ui/FormTicket";
import { useTicket } from "../../../_ui/TicketContexto";
import { apiSoporte } from "../../../_ui/api";

/** Edición del ticket. Cada campo que cambia queda en el historial con su valor anterior. */
export default function TicketEditarPage() {
  const router = useRouter();
  const { ticket: t, recargar } = useTicket();
  const base = `/dashboard/soporte/tickets/${t.id}`;

  const inicial: ValoresTicket = {
    cliente_id: t.cliente_id ?? "",
    proyecto_id: t.proyecto_id ?? "",
    modulo: t.modulo ?? "",
    tipo_codigo: t.tipo_codigo,
    clasificacion_codigo: t.clasificacion_codigo ?? "",
    prioridad_codigo: t.prioridad_codigo,
    asunto: t.asunto,
    descripcion: t.descripcion,
    resultado_esperado: t.resultado_esperado ?? "",
    impacto_operativo: t.impacto_operativo ?? "",
    pasos_reproducir: t.pasos_reproducir ?? "",
    criterios_aceptacion: t.criterios_aceptacion ?? "",
    responsable_id: t.responsable_id ?? "",
    proxima_accion: t.proxima_accion ?? "",
    fecha_objetivo: t.fecha_objetivo ?? "",
    version: t.version ?? "",
    entorno: t.entorno ?? "",
    navegador: t.navegador ?? "",
  };

  return (
    <FormTicket
      modo="editar"
      inicial={inicial}
      cancelarHref={base}
      onGuardar={async (v) => {
        // Cliente y proyecto no se reasignan desde acá: mover un ticket de
        // cliente cambia de quién es la historia, y eso merece su propio flujo.
        const { cliente_id: _c, proyecto_id: _p, ...cambios } = v;
        void _c;
        void _p;
        await apiSoporte(`/api/soporte/tickets/${t.id}`, { method: "PATCH", json: cambios });
        await recargar();
        router.push(base);
      }}
    />
  );
}
