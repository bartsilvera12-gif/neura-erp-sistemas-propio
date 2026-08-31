import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { sendEmail } from "@/lib/email/mailer";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://sistemas.neura.com.py").replace(/\/+$/, "");

/**
 * Borra el aviso in-app de una transferencia cuando SUS cobros se resolvieron
 * (aprobados/rechazados). Un aviso puede referenciar VARIOS cobros (una
 * transferencia que cubre N facturas): se borra recién cuando ninguno de esos
 * cobros sigue pendiente. Best-effort. Soporta el formato viejo (metadata.cobro_id)
 * y el nuevo (metadata.cobro_ids array).
 */
export async function limpiarNotificacionesCobro(
  schemaRaw: string,
  empresaId: string,
  cobroId: string
): Promise<void> {
  try {
    const schema = assertAllowedChatDataSchema(schemaRaw);
    const pool = getChatPostgresPool();
    if (!pool) return;
    const t = quoteSchemaTable(schema, "usuario_notificaciones");
    const tCP = quoteSchemaTable(schema, "cobros_pendientes");
    await pool.query(
      `DELETE FROM ${t} un
        WHERE un.empresa_id=$1::uuid AND un.tipo='cobro_pendiente'
          AND (un.metadata->>'cobro_id' = $2 OR un.metadata->'cobro_ids' @> to_jsonb($2::text))
          AND NOT EXISTS (
            SELECT 1 FROM ${tCP} cp
            WHERE cp.empresa_id = un.empresa_id AND cp.estado = 'pendiente'
              AND (cp.id::text = un.metadata->>'cobro_id'
                   OR cp.id::text IN (SELECT jsonb_array_elements_text(un.metadata->'cobro_ids')))
          )`,
      [empresaId, cobroId]
    );
  } catch (e) {
    console.warn("[limpiarNotificacionesCobro]", e instanceof Error ? e.message : e);
  }
}

export type CobroNotifItem = { cobroId: string; facturaId: string | null; monto: number };

/**
 * Aviso in-app (campanita) + correo a los administradores cuando entra una
 * transferencia PENDIENTE de aprobación. UNA transferencia = UN aviso, aunque
 * cubra varias facturas (no spamea). Best-effort: nunca lanza.
 *
 * El `tipo` "cobro_pendiente" debe estar en el CHECK de `usuario_notificaciones`
 * (migración 20260830130000). El alta va con service-role (fuera de RLS).
 */
export async function notificarCobroPendiente(
  empresaId: string,
  data: { actorId: string | null; clienteId: string | null; cobros: CobroNotifItem[] }
): Promise<void> {
  try {
    const cobros = (data.cobros ?? []).filter((c) => c && c.cobroId);
    if (cobros.length === 0) return;

    // Destinatarios: administradores de la empresa (catálogo).
    const catalog = createServiceRoleClient();
    const { data: usuarios } = await catalog.from("usuarios").select("id, rol, email").eq("empresa_id", empresaId);
    const admins = (usuarios ?? []).filter((u) => {
      const rol = String((u as { rol?: string | null }).rol ?? "").trim();
      return rol === "super_admin" || esRolAdminEmpresaOGlobal(rol);
    });
    if (admins.length === 0) return;

    const sb = await getChatServiceClientForEmpresa(empresaId);

    // Enriquecer: nombre del cliente + (si es una sola factura) su número.
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
        clienteNombre = (c?.razon_social?.trim() || c?.nombre?.trim() || c?.empresa?.trim() || null) ?? null;
      }
      if (cobros.length === 1 && cobros[0].facturaId) {
        const { data: fa } = await sb
          .from("facturas")
          .select("numero_factura")
          .eq("id", cobros[0].facturaId)
          .maybeSingle();
        numeroFactura = (fa as { numero_factura?: string | null } | null)?.numero_factura ?? null;
      }
    } catch {
      /* enrich opcional */
    }

    const total = cobros.reduce((s, c) => s + (Number(c.monto) || 0), 0);
    const montoFmt = `Gs. ${Math.round(total).toLocaleString("es-PY")}`;
    const detalle = cobros.length === 1 ? numeroFactura : `${cobros.length} facturas`;
    const partes = [clienteNombre, detalle, montoFmt].filter(Boolean);
    const titulo = "Nuevo cobro por aprobar";
    const cuerpo = `${partes.join(" · ")} — pendiente de aprobación en Conciliación bancaria.`;
    const cobroIds = cobros.map((c) => c.cobroId);

    const rows = admins.map((a) => ({
      empresa_id: empresaId,
      usuario_id: (a as { id: string }).id,
      tipo: "cobro_pendiente",
      titulo,
      cuerpo,
      actor_id: data.actorId,
      agrupadas: cobros.length,
      // Todos los cobros de esta transferencia: el aviso se borra cuando todos se resuelven.
      metadata: { cobro_ids: cobroIds },
    }));
    await sb.from("usuario_notificaciones").insert(rows);

    // Correo (best-effort). Destinatarios: COBROS_NOTIFY_EMAILS o los emails de los admins.
    try {
      const fixed = (process.env.COBROS_NOTIFY_EMAILS ?? "").split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
      const adminEmails = admins
        .map((a) => String((a as { email?: string | null }).email ?? "").trim())
        .filter((e) => e.includes("@"));
      const to = fixed.length > 0 ? fixed : adminEmails;
      if (to.length > 0) {
        const link = `${APP_URL}/cobranzas/conciliacion`;
        const filaFactura =
          cobros.length === 1
            ? numeroFactura
              ? `<tr><td style="padding:2px 10px 2px 0;color:#64748b">Factura</td><td style="padding:2px 0">${numeroFactura}</td></tr>`
              : ""
            : `<tr><td style="padding:2px 10px 2px 0;color:#64748b">Facturas</td><td style="padding:2px 0">${cobros.length}</td></tr>`;
        const html = `
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a;line-height:1.5">
            <p style="margin:0 0 8px"><b>Nuevo cobro por aprobar</b></p>
            <p style="margin:0 0 12px">Entró un cobro por transferencia y está <b>pendiente de aprobación</b> en Conciliación bancaria.</p>
            <table style="border-collapse:collapse;margin:0 0 14px">
              ${clienteNombre ? `<tr><td style="padding:2px 10px 2px 0;color:#64748b">Cliente</td><td style="padding:2px 0"><b>${clienteNombre}</b></td></tr>` : ""}
              ${filaFactura}
              <tr><td style="padding:2px 10px 2px 0;color:#64748b">Monto</td><td style="padding:2px 0"><b>${montoFmt}</b></td></tr>
            </table>
            <a href="${link}" style="display:inline-block;background:#3F8E91;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;font-weight:600">Revisar en Conciliación bancaria</a>
            <p style="margin:14px 0 0;color:#94a3b8;font-size:12px">El saldo del cliente se actualiza recién cuando aprobás el cobro.</p>
          </div>`;
        const text = `Nuevo cobro por aprobar. ${partes.join(" · ")}. Pendiente en Conciliación bancaria: ${link}`;
        await sendEmail({ to, subject: `Confirmación de Pago — ${partes.join(" · ")}`, html, text });
      }
    } catch (mailErr) {
      console.warn("[notificarCobroPendiente:email]", mailErr instanceof Error ? mailErr.message : mailErr);
    }
  } catch (e) {
    console.warn("[notificarCobroPendiente]", e instanceof Error ? e.message : e);
  }
}
