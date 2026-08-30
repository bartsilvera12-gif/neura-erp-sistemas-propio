import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";

/**
 * Aviso in-app (campanita) a los administradores de la empresa cuando entra un
 * cobro PENDIENTE de aprobación. Ellos son quienes aprueban/rechazan en
 * Conciliación bancaria. Best-effort: nunca lanza (no debe romper el registro
 * del cobro si la notificación falla).
 *
 * El `tipo` "cobro_pendiente" debe estar en el CHECK de `usuario_notificaciones`
 * (migración 20260830130000). El alta va con service-role (fuera de RLS).
 */
export async function notificarCobroPendiente(
  empresaId: string,
  data: { cobroId: string; facturaId: string | null; clienteId: string | null; monto: number; actorId: string | null }
): Promise<void> {
  try {
    // Destinatarios: administradores de la empresa (catálogo).
    const catalog = createServiceRoleClient();
    const { data: usuarios } = await catalog
      .from("usuarios")
      .select("id, rol")
      .eq("empresa_id", empresaId);
    const admins = (usuarios ?? []).filter((u) => {
      const rol = String((u as { rol?: string | null }).rol ?? "").trim();
      return rol === "super_admin" || esRolAdminEmpresaOGlobal(rol);
    });
    if (admins.length === 0) return;

    const sb = await getChatServiceClientForEmpresa(empresaId);

    // Enriquecer el cuerpo (cliente + factura) — best-effort.
    let clienteNombre: string | null = null;
    let numeroFactura: string | null = null;
    try {
      if (data.clienteId) {
        const { data: cl } = await sb
          .from("clientes")
          .select("razon_social, nombre, empresa")
          .eq("id", data.clienteId)
          .maybeSingle();
        const c = cl as { razon_social?: string | null; nombre?: string | null; empresa?: string | null } | null;
        clienteNombre =
          (c?.razon_social?.trim() || c?.nombre?.trim() || c?.empresa?.trim() || null) ?? null;
      }
      if (data.facturaId) {
        const { data: fa } = await sb
          .from("facturas")
          .select("numero_factura")
          .eq("id", data.facturaId)
          .maybeSingle();
        numeroFactura = (fa as { numero_factura?: string | null } | null)?.numero_factura ?? null;
      }
    } catch {
      /* enrich opcional: seguimos con lo que haya */
    }

    const montoFmt = `Gs. ${Math.round(Number(data.monto) || 0).toLocaleString("es-PY")}`;
    const partes = [clienteNombre, numeroFactura, montoFmt].filter(Boolean);
    const titulo = "Nuevo cobro por aprobar";
    const cuerpo = `${partes.join(" · ")} — pendiente de aprobación en Conciliación bancaria.`;

    const rows = admins.map((a) => ({
      empresa_id: empresaId,
      usuario_id: (a as { id: string }).id,
      tipo: "cobro_pendiente",
      titulo,
      cuerpo,
      actor_id: data.actorId,
      agrupadas: 1,
    }));
    await sb.from("usuario_notificaciones").insert(rows);
  } catch (e) {
    console.warn("[notificarCobroPendiente]", e instanceof Error ? e.message : e);
  }
}
