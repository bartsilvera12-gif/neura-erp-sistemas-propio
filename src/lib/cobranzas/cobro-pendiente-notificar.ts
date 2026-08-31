import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { sendEmail } from "@/lib/email/mailer";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

/**
 * Borra los avisos in-app de un cobro pendiente cuando el cobro se aprueba o
 * rechaza (así no quedan registros "en vano" en la campanita). Best-effort.
 * Requiere que el aviso se haya creado con metadata.cobro_id (ver arriba).
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
    await pool.query(
      `DELETE FROM ${t} WHERE empresa_id=$1::uuid AND tipo='cobro_pendiente' AND metadata->>'cobro_id'=$2`,
      [empresaId, cobroId]
    );
  } catch (e) {
    console.warn("[limpiarNotificacionesCobro]", e instanceof Error ? e.message : e);
  }
}

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://sistemas.neura.com.py").replace(/\/+$/, "");

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
      .select("id, rol, email")
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
      // Guardamos el cobro para poder limpiar el aviso cuando se apruebe/rechace.
      metadata: { cobro_id: data.cobroId },
    }));
    await sb.from("usuario_notificaciones").insert(rows);

    // Correo a los admins (best-effort). Destinatarios: la lista fija de
    // COBROS_NOTIFY_EMAILS si está definida; si no, los emails de los admins.
    try {
      const fixed = (process.env.COBROS_NOTIFY_EMAILS ?? "")
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const adminEmails = admins
        .map((a) => String((a as { email?: string | null }).email ?? "").trim())
        .filter((e) => e.includes("@"));
      const to = fixed.length > 0 ? fixed : adminEmails;
      if (to.length > 0) {
        const link = `${APP_URL}/cobranzas/conciliacion`;
        const html = `
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a;line-height:1.5">
            <p style="margin:0 0 8px"><b>Nuevo cobro por aprobar</b></p>
            <p style="margin:0 0 12px">Entró un cobro por transferencia y está <b>pendiente de aprobación</b> en Conciliación bancaria.</p>
            <table style="border-collapse:collapse;margin:0 0 14px">
              ${clienteNombre ? `<tr><td style="padding:2px 10px 2px 0;color:#64748b">Cliente</td><td style="padding:2px 0"><b>${clienteNombre}</b></td></tr>` : ""}
              ${numeroFactura ? `<tr><td style="padding:2px 10px 2px 0;color:#64748b">Factura</td><td style="padding:2px 0">${numeroFactura}</td></tr>` : ""}
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
