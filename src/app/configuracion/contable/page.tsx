"use client";

import { useCallback, useEffect, useState } from "react";
import { GlobalConfigSubpageShell } from "@/components/config/GlobalConfigSubpageShell";
import { ConfigFormCard, ConfigSectionTitle, F_LABEL } from "@/components/config/global-config-primitives";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { getCuentasContablesOpciones, type CuentaContableOpcion } from "@/lib/compras/storage";
import CuentaCombobox from "@/components/contabilidad/CuentaCombobox";

interface Config {
  cuenta_iva_credito_5_id: string | null;
  cuenta_iva_credito_10_id: string | null;
  cuenta_proveedores_id: string | null;
  cuenta_caja_id: string | null;
  cuenta_banco_id: string | null;
  cuenta_iva_debito_5_id: string | null;
  cuenta_iva_debito_10_id: string | null;
  cuenta_ventas_gravadas_id: string | null;
  cuenta_ventas_exentas_id: string | null;
  cuenta_ventas_servicios_id: string | null;
  cuenta_clientes_id: string | null;
}
interface Periodo { id: string; anio: number; mes: number; estado: string; cerrado_at: string | null }

const EMPTY: Config = {
  cuenta_iva_credito_5_id: null, cuenta_iva_credito_10_id: null, cuenta_proveedores_id: null,
  cuenta_caja_id: null, cuenta_banco_id: null,
  cuenta_iva_debito_5_id: null, cuenta_iva_debito_10_id: null, cuenta_ventas_gravadas_id: null,
  cuenta_ventas_exentas_id: null, cuenta_ventas_servicios_id: null, cuenta_clientes_id: null,
};

const FIELDS_COMPRAS: { key: keyof Config; label: string }[] = [
  { key: "cuenta_iva_credito_5_id", label: "Cuenta de IVA Crédito 5%" },
  { key: "cuenta_iva_credito_10_id", label: "Cuenta de IVA Crédito 10%" },
  { key: "cuenta_proveedores_id", label: "Cuenta general de Proveedores" },
  { key: "cuenta_caja_id", label: "Cuenta predeterminada de Caja" },
  { key: "cuenta_banco_id", label: "Cuenta predeterminada de Banco" },
];
const FIELDS_VENTAS: { key: keyof Config; label: string }[] = [
  { key: "cuenta_iva_debito_5_id", label: "Cuenta de IVA Débito 5%" },
  { key: "cuenta_iva_debito_10_id", label: "Cuenta de IVA Débito 10%" },
  { key: "cuenta_ventas_gravadas_id", label: "Cuenta de Ventas Gravadas" },
  { key: "cuenta_ventas_exentas_id", label: "Cuenta de Ventas Exentas" },
  { key: "cuenta_ventas_servicios_id", label: "Cuenta de Ventas de Servicios" },
  { key: "cuenta_clientes_id", label: "Cuenta general de Clientes (CxC)" },
];
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export default function ConfiguracionContablePage() {
  const [config, setConfig] = useState<Config>(EMPTY);
  const [cuentas, setCuentas] = useState<CuentaContableOpcion[]>([]);
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, per] = await Promise.all([apiFetch("/api/configuracion/contable"), apiFetch("/api/configuracion/contable/periodos")]);
      const jc = await cfg.json().catch(() => ({}));
      if (cfg.ok && jc?.success) setConfig(jc.data.config);
      else if (cfg.status === 403) setMsg({ ok: false, text: "Sin permiso de Contabilidad." });
      const jp = await per.json().catch(() => ({}));
      if (per.ok && jp?.success) setPeriodos(jp.data.periodos);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); getCuentasContablesOpciones().then(setCuentas).catch(() => {}); }, [load]);

  async function guardar() {
    setSaving(true); setMsg(null);
    try {
      const r = await apiFetch("/api/configuracion/contable", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) { setMsg({ ok: false, text: j?.error ?? `Error ${r.status}` }); return; }
      setConfig(j.data.config);
      setMsg({ ok: true, text: "Configuración contable guardada." });
    } finally { setSaving(false); }
  }

  async function togglePeriodo(anio: number, mes: number, estado: "abierto" | "cerrado") {
    setMsg(null);
    const r = await apiFetch("/api/configuracion/contable/periodos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ anio, mes, estado }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) { setMsg({ ok: false, text: j?.error ?? `Error ${r.status}` }); return; }
    await load();
  }

  const now = new Date();
  const [nAnio, setNAnio] = useState(now.getFullYear());
  const [nMes, setNMes] = useState(now.getMonth() + 1);

  return (
    <GlobalConfigSubpageShell title="Configuración Contable" description="Cuentas por defecto para los asientos automáticos y gestión de períodos contables." maxWidthClassName="max-w-4xl">
      {msg && <div className={`rounded-lg border p-3 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>{msg.text}</div>}

      <ConfigFormCard>
        <ConfigSectionTitle>Cuentas de Compras</ConfigSectionTitle>
        <p className="mb-4 text-xs text-slate-400">Solo se listan cuentas activas y asentables (imputables). Si falta una cuenta adecuada, creá una subcuenta asentable desde el Plan de Cuentas.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FIELDS_COMPRAS.map((f) => (
            <div key={f.key}>
              <label className={F_LABEL}>{f.label}</label>
              <CuentaCombobox cuentas={cuentas} value={(config[f.key] as string) ?? null}
                onChange={(id) => setConfig((c) => ({ ...c, [f.key]: id }))} placeholder="(Sin configurar)" />
            </div>
          ))}
        </div>

        <div className="mt-6 border-t border-slate-100 pt-5">
          <ConfigSectionTitle>Cuentas de Ventas</ConfigSectionTitle>
          <p className="mb-4 text-xs text-slate-400">Se usarán para los asientos de venta (IVA Débito y cuentas de ingreso). El Libro de Ventas no las requiere para listar.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {FIELDS_VENTAS.map((f) => (
              <div key={f.key}>
                <label className={F_LABEL}>{f.label}</label>
                <CuentaCombobox cuentas={cuentas} value={(config[f.key] as string) ?? null}
                  onChange={(id) => setConfig((c) => ({ ...c, [f.key]: id }))} placeholder="(Sin configurar)" />
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button onClick={guardar} disabled={saving || loading} className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50">{saving ? "Guardando…" : "Guardar configuración"}</button>
        </div>
      </ConfigFormCard>

      <ConfigFormCard>
        <ConfigSectionTitle>Períodos contables</ConfigSectionTitle>
        <p className="mb-3 text-xs text-slate-400">Un documento no puede contabilizarse en un período cerrado. Los períodos nuevos se crean abiertos automáticamente al contabilizar.</p>
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-slate-500">Año<input type="number" value={nAnio} onChange={(e) => setNAnio(Number(e.target.value))} className="mt-1 w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" /></label>
          <label className="text-xs font-semibold text-slate-500">Mes<select value={nMes} onChange={(e) => setNMes(Number(e.target.value))} className="mt-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm">{MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
          <button onClick={() => togglePeriodo(nAnio, nMes, "cerrado")} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100">Cerrar período</button>
          <button onClick={() => togglePeriodo(nAnio, nMes, "abierto")} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Abrir período</button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2 text-left">Período</th><th className="px-3 py-2 text-center">Estado</th><th className="px-3 py-2 text-right">Acción</th></tr></thead>
            <tbody>
              {periodos.length === 0 ? <tr><td colSpan={3} className="px-3 py-6 text-center text-slate-400">Aún no hay períodos registrados.</td></tr>
              : periodos.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="px-3 py-2">{MESES[p.mes - 1]} {p.anio}</td>
                  <td className="px-3 py-2 text-center"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.estado === "cerrado" ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-700"}`}>{p.estado}</span></td>
                  <td className="px-3 py-2 text-right">
                    {p.estado === "cerrado"
                      ? <button onClick={() => togglePeriodo(p.anio, p.mes, "abierto")} className="rounded px-2 py-1 text-xs font-semibold text-[#3F8E91] hover:bg-slate-100">Reabrir</button>
                      : <button onClick={() => togglePeriodo(p.anio, p.mes, "cerrado")} className="rounded px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">Cerrar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ConfigFormCard>
    </GlobalConfigSubpageShell>
  );
}
