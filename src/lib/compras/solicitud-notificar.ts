import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";

/**
 * Avisos de la campanita para el flujo de solicitudes de compra (Fase 5.1).
 * En cada handoff avisa a quien le toca actuar; el sonido lo pone solo la
 * campanita (es un tipo nuevo, cae en el sonido por defecto). Best-effort: nunca
 * lanza — si el aviso falla, la acción (confirmar/pagar) igual se completó.
 *
 * Sin tabla de roles todavía: los destinatarios son los administradores de la
 * empresa (Alan confirma, Guillermo paga) + el solicitante (comercial), que
 * recibe el ida y vuelta de su pedido. El ruteo fino por rol llega en Fase 5.2.
 *
 * El tipo `compra_solicitud` debe estar en el CHECK de `usuario_notificaciones`
 * (migración 20261126_notificaciones_compra_solicitud). El alta va con
 * service-role (fuera de RLS).
 */
export type EventoCompra = "nueva" | "confirmada" | "rechazada" | "pagada";

const gs = (v: unknown) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;

export async function notificarFlujoCompra(
  empresaId: string,
  ev: { evento: EventoCompra; ordenId: string; actorId: string | null; motivo?: string | null }
): Promise<void> {
  try {
    const sb = await getChatServiceClientForEmpresa(empresaId);
    const { data: o } = await sb
      .from("ordenes_compra")
      .select("numero, proveedor_nombre, total_estimado, solicitada_by")
      .eq("id", ev.ordenId)
      .maybeSingle();
    if (!o) return;
    const numero = String((o as { numero?: string }).numero ?? "");
    const resumen = [(o as { proveedor_nombre?: string | null }).proveedor_nombre, gs((o as { total_estimado?: number }).total_estimado)]
      .filter(Boolean)
      .join(" · ");
    const solicitante = ((o as { solicitada_by?: string | null }).solicitada_by ?? null) as string | null;

    // Administradores de la empresa (catálogo).
    const catalog = createServiceRoleClient();
    const { data: usuarios } = await catalog.from("usuarios").select("id, rol").eq("empresa_id", empresaId);
    const admins = (usuarios ?? [])
      .filter((u) => {
        const rol = String((u as { rol?: string | null }).rol ?? "").trim();
        return rol === "super_admin" || esRolAdminEmpresaOGlobal(rol);
      })
      .map((u) => (u as { id: string }).id);

    type Row = { empresa_id: string; usuario_id: string; tipo: string; titulo: string; cuerpo: string; actor_id: string | null; metadata: { orden_id: string; bandeja: string } };
    const rows: Row[] = [];
    const add = (uid: string | null, bandeja: string, titulo: string, cuerpo: string) => {
      if (!uid || uid === ev.actorId) return; // no te avises a vos mismo
      if (rows.some((r) => r.usuario_id === uid)) return; // un aviso por persona por evento
      rows.push({ empresa_id: empresaId, usuario_id: uid, tipo: "compra_solicitud", titulo, cuerpo, actor_id: ev.actorId, metadata: { orden_id: ev.ordenId, bandeja } });
    };

    if (ev.evento === "nueva") {
      for (const a of admins) add(a, "solicitudes", "Nueva solicitud de compra", `${numero} · ${resumen} — por confirmar.`);
    } else if (ev.evento === "confirmada") {
      for (const a of admins) add(a, "por-pagar", "Solicitud aprobada", `${numero} · ${resumen} — lista para pagar.`);
      add(solicitante, "solicitudes", "Tu solicitud fue aprobada", `${numero} · ${resumen}.`);
    } else if (ev.evento === "rechazada") {
      add(solicitante, "solicitudes", "Tu solicitud fue rechazada", `${numero}${ev.motivo ? ` — ${ev.motivo}` : ""}`);
    } else if (ev.evento === "pagada") {
      add(solicitante, "por-pagar", "Pago confirmado", `${numero} · ${resumen} — pagada, lista para recibir.`);
      for (const a of admins) add(a, "por-pagar", "Pago confirmado", `${numero} · ${resumen} — lista para recibir.`);
    }

    if (rows.length) await sb.from("usuario_notificaciones").insert(rows);
  } catch (e) {
    console.warn("[notificarFlujoCompra]", e instanceof Error ? e.message : e);
  }
}
