import "server-only";
import type { Pool } from "pg";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";

/**
 * Roles del flujo de compra (Fase 5.2). Quién confirma / paga / recibe, por
 * empresa, guardado en `neura.compras_flujo_roles`. Se usa para rutear los avisos
 * y, a futuro, las bandejas por rol. Fallback: si un rol no tiene a nadie, cae en
 * los administradores (así nunca se pierde un aviso).
 */
export type UsuarioRol = {
  id: string;
  nombre: string | null;
  email: string | null;
  rol: string | null;
  es_admin: boolean;
  confirma: boolean;
  paga: boolean;
  recibe: boolean;
};

function esAdmin(rol: string): boolean {
  return rol === "super_admin" || esRolAdminEmpresaOGlobal(rol);
}

export async function listarRolesCompra(pool: Pool, empresaId: string): Promise<{ usuarios: UsuarioRol[] }> {
  const catalog = createServiceRoleClient();
  const { data: us } = await catalog.from("usuarios").select("id, nombre, email, rol, activo").eq("empresa_id", empresaId);
  const activos = (us ?? []).filter((u) => (u as { activo?: boolean }).activo !== false);
  const { rows } = await pool.query<{ usuario_id: string; confirma: boolean; paga: boolean; recibe: boolean }>(
    `SELECT usuario_id, confirma, paga, recibe FROM neura.compras_flujo_roles WHERE empresa_id = $1::uuid`,
    [empresaId]
  );
  const flags = new Map(rows.map((r) => [r.usuario_id, r]));
  const usuarios: UsuarioRol[] = activos.map((u) => {
    const uu = u as { id: string; nombre?: string | null; email?: string | null; rol?: string | null };
    const f = flags.get(uu.id);
    const rol = String(uu.rol ?? "");
    return {
      id: uu.id,
      nombre: uu.nombre ?? null,
      email: uu.email ?? null,
      rol,
      es_admin: esAdmin(rol),
      confirma: !!f?.confirma,
      paga: !!f?.paga,
      recibe: !!f?.recibe,
    };
  });
  usuarios.sort((a, b) => (a.nombre ?? a.email ?? "").localeCompare(b.nombre ?? b.email ?? ""));
  return { usuarios };
}

export async function guardarRolCompra(
  pool: Pool,
  empresaId: string,
  usuarioId: string,
  flags: { confirma: boolean; paga: boolean; recibe: boolean }
): Promise<{ ok: true }> {
  await pool.query(
    `INSERT INTO neura.compras_flujo_roles (empresa_id, usuario_id, confirma, paga, recibe, updated_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, now())
     ON CONFLICT (empresa_id, usuario_id)
       DO UPDATE SET confirma = EXCLUDED.confirma, paga = EXCLUDED.paga, recibe = EXCLUDED.recibe, updated_at = now()`,
    [empresaId, usuarioId, flags.confirma, flags.paga, flags.recibe]
  );
  return { ok: true };
}

/** Destinatarios por rol para rutear avisos. Cada rol cae en administradores si no tiene a nadie. */
export async function destinatariosFlujo(
  empresaId: string
): Promise<{ confirma: string[]; paga: string[]; recibe: string[]; admins: string[] }> {
  const catalog = createServiceRoleClient();
  const { data: us } = await catalog.from("usuarios").select("id, rol").eq("empresa_id", empresaId);
  const admins = (us ?? [])
    .filter((u) => esAdmin(String((u as { rol?: string | null }).rol ?? "")))
    .map((u) => (u as { id: string }).id);

  let confirma: string[] = [];
  let paga: string[] = [];
  let recibe: string[] = [];
  const pool = getChatPostgresPool();
  if (pool) {
    const { rows } = await pool.query<{ usuario_id: string; confirma: boolean; paga: boolean; recibe: boolean }>(
      `SELECT usuario_id, confirma, paga, recibe FROM neura.compras_flujo_roles WHERE empresa_id = $1::uuid`,
      [empresaId]
    );
    confirma = rows.filter((r) => r.confirma).map((r) => r.usuario_id);
    paga = rows.filter((r) => r.paga).map((r) => r.usuario_id);
    recibe = rows.filter((r) => r.recibe).map((r) => r.usuario_id);
  }
  return {
    confirma: confirma.length ? confirma : admins,
    paga: paga.length ? paga : admins,
    recibe: recibe.length ? recibe : admins,
    admins,
  };
}
