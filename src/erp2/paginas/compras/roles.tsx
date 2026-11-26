"use client";

/**
 * /compras/roles — roles del flujo de solicitudes de compra (Fase 5.2, solo admin).
 *
 * Define quién CONFIRMA (Alan), quién PAGA (Guillermo) y quién RECIBE. Los avisos
 * de la campanita en cada handoff van a quien tenga el rol; si un rol no tiene a
 * nadie, cae en los administradores. Crear una solicitud lo puede cualquiera con
 * el módulo Compras (no se configura).
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { clienteConfig } from "@/erp2/cliente.config";

const TEAL = clienteConfig.color;

type UsuarioRol = {
  id: string;
  nombre: string | null;
  email: string | null;
  rol: string | null;
  es_admin: boolean;
  confirma: boolean;
  paga: boolean;
  recibe: boolean;
};
type Campo = "confirma" | "paga" | "recibe";
const COLUMNAS: { campo: Campo; label: string; ayuda: string }[] = [
  { campo: "confirma", label: "Confirma", ayuda: "Aprueba o rechaza las solicitudes" },
  { campo: "paga", label: "Paga", ayuda: "Confirma el pago de las órdenes" },
  { campo: "recibe", label: "Recibe", ayuda: "Recibe la mercadería" },
];

export default function RolesComprasPage() {
  const [rows, setRows] = useState<UsuarioRol[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);

  const cargar = useCallback(() => {
    setCargando(true);
    apiFetch<{ usuarios: UsuarioRol[] }>("/api/v2/compras/roles")
      .then((d) => { setRows(d.usuarios ?? []); setError(null); })
      .catch((e) => setError((e as Error).message))
      .finally(() => setCargando(false));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function toggle(u: UsuarioRol, campo: Campo) {
    const nuevo = { ...u, [campo]: !u[campo] };
    setRows((rs) => rs.map((r) => (r.id === u.id ? nuevo : r))); // optimista
    setGuardando(u.id);
    setError(null);
    try {
      await apiFetch("/api/v2/compras/roles", {
        method: "PUT",
        body: JSON.stringify({ usuario_id: u.id, confirma: nuevo.confirma, paga: nuevo.paga, recibe: nuevo.recibe }),
      });
    } catch (e) {
      setRows((rs) => rs.map((r) => (r.id === u.id ? u : r))); // revertir
      setError((e as Error).message);
    } finally {
      setGuardando(null);
    }
  }

  const sinRol = (campo: Campo) => rows.length > 0 && !rows.some((r) => r[campo]);

  return (
    <div className="space-y-5 pb-10 sm:space-y-6">
      <header className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Compras</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Roles del flujo de compra</h1>
        <p className="mt-1 text-[13px] text-slate-500 sm:text-sm">Quién recibe el aviso en cada paso. Si un rol queda sin nadie, el aviso va a los administradores.</p>
      </header>

      {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left">Usuario</th>
              {COLUMNAS.map((c) => (
                <th key={c.campo} className="px-3 py-2.5 text-center">
                  <span className="block">{c.label}</span>
                  <span className="block text-[10px] font-normal normal-case text-slate-400">{c.ayuda}</span>
                  {sinRol(c.campo) ? <span className="mt-0.5 block text-[10px] font-semibold normal-case text-amber-600">→ admins</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={4} className="px-3 py-10 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-12 text-center">
                <ShieldCheck className="mx-auto h-7 w-7 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">No hay usuarios para configurar.</p>
              </td></tr>
            ) : rows.map((u) => (
              <tr key={u.id} className="border-b last:border-0 hover:bg-slate-50/60">
                <td className="px-3 py-2.5">
                  <span className="block font-medium text-slate-800">{u.nombre ?? u.email ?? "—"}</span>
                  <span className="block text-[11px] text-slate-400">{u.es_admin ? "Administrador" : (u.rol || "—")}{guardando === u.id ? " · guardando…" : ""}</span>
                </td>
                {COLUMNAS.map((c) => (
                  <td key={c.campo} className="px-3 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={u[c.campo]}
                      onChange={() => toggle(u, c.campo)}
                      aria-label={`${c.label} — ${u.nombre ?? u.email ?? u.id}`}
                      className="h-5 w-5 cursor-pointer rounded border-slate-300 accent-[var(--brand)]"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">Los avisos suenan en la campanita y llevan a la bandeja que corresponde (Solicitudes / Órdenes por pagar).</p>
    </div>
  );
}
