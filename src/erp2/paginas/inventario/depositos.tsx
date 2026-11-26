"use client";

/**
 * /inventario/depositos — Sucursales y depósitos (ADMIN).
 *   · cada sucursal (dirección, ciudad, teléfono, establecimiento-punto de expedición para la
 *     numeración de las remisiones) con sus depósitos y lo que hay en cada uno
 *   · alta / edición / desactivación (la base no deja desactivar con stock o traslados en
 *     tránsito, ni dejar a una sucursal sin depósito principal)
 *   · en qué sucursal trabaja cada usuario (de ahí sale su depósito por defecto)
 */
import Link from "next/link";
import { useState } from "react";
import { Building2, Loader2, MapPin, Pencil, Phone, Plus, Star, Users, Warehouse } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { useUsuario } from "@/erp2/lib/sesion/ContextoUsuario";
import { Select } from "@/erp2/components/Select";
import { invalidarDepositos, useDepositos, type Deposito, type Sucursal } from "@/erp2/modules/inventario/depositos";
import { invalidarLista } from "@/erp2/modules/inventario/lista-cache";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, ET, INPUT, ModalDocumento, TEAL } from "@/erp2/modules/inventario/ui";
import { AccionesPagina, EncabezadoPagina } from "@/erp2/components/EncabezadoPagina";
import { cant, gs } from "@/erp2/modules/inventario/documentos";

export default function DepositosPage() {
  const esAdmin = useUsuario()?.rol === "ADMIN";
  const [recarga, setRecarga] = useState(0);
  const { datos, error, cargando } = useDepositos(recarga);
  const [sucursal, setSucursal] = useState<{ abierta: boolean; s: Sucursal | null }>({ abierta: false, s: null });
  const [deposito, setDeposito] = useState<{ abierto: boolean; d: Deposito | null; sucursalId: string }>({ abierto: false, d: null, sucursalId: "" });
  const [asignando, setAsignando] = useState<string | null>(null);
  const [errorUsuario, setErrorUsuario] = useState<string | null>(null);

  const refrescar = () => {
    invalidarDepositos();
    invalidarLista("/api/productos");
    setRecarga((k) => k + 1);
  };
  const sucursales = datos?.sucursales ?? [];
  const activas = sucursales.filter((s) => s.activa);

  async function asignar(usuarioId: string, sucursalId: string) {
    setAsignando(usuarioId);
    setErrorUsuario(null);
    try {
      await apiFetch("/api/inventario/sucursales/usuario", { method: "POST", body: JSON.stringify({ usuario_id: usuarioId, sucursal_id: sucursalId || null }) });
      refrescar();
    } catch (e) {
      setErrorUsuario((e as Error).message);
    } finally {
      setAsignando(null);
    }
  }

  if (!esAdmin && datos && !datos.es_admin) {
    return <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Solo un administrador configura sucursales y depósitos.</p>;
  }

  return (
    <div className="space-y-5 pb-10 sm:space-y-6">
      <EncabezadoPagina volver={{ href: "/inventario/panel", label: "Inventario" }} kicker="Inventario · Configuración" titulo="Sucursales y depósitos" subtitulo="Dónde está la mercadería: cada sucursal con sus depósitos"
        acciones={<AccionesPagina acciones={[{ etiqueta: "Nueva sucursal", icono: <Plus />, onClick: () => setSucursal({ abierta: true, s: null }), primaria: true }]} />} />

      {cargando ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : error ? (
        <p className="rounded-xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-700">No se pudieron cargar las sucursales.</p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {sucursales.map((s) => (
            <section key={s.id} className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${s.activa ? "" : "opacity-70"}`} style={{ borderColor: `${TEAL}33` }}>
              <div className="flex items-start justify-between gap-2 border-b py-3 pl-4 pr-2 sm:gap-3 sm:px-5 sm:py-4" style={{ borderColor: `${TEAL}22`, background: `linear-gradient(to right, ${TEAL}0d, transparent)` }}>
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${TEAL}1a`, color: TEAL }}>
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900 [overflow-wrap:anywhere]">
                      {s.nombre}
                      {s.es_principal ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200"><Star className="h-3 w-3" /> Principal</span> : null}
                      {!s.activa ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Inactiva</span> : null}
                    </h2>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                      {s.direccion || s.ciudad ? <span className="inline-flex min-w-0 items-start gap-1 [overflow-wrap:anywhere]"><MapPin className="mt-0.5 h-3 w-3 shrink-0" /> {[s.direccion, s.ciudad].filter(Boolean).join(", ")}</span> : <span className="italic text-slate-400">Sin dirección cargada</span>}
                      {s.telefono ? <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {s.telefono}</span> : null}
                      <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {s.usuarios} {s.usuarios === 1 ? "usuario" : "usuarios"}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      Remisiones: <span className="font-mono font-semibold text-slate-600">{s.establecimiento ?? "001"}-{s.punto_expedicion ?? "001"}-0000000</span>
                    </p>
                  </div>
                </div>
                <button onClick={() => setSucursal({ abierta: true, s })} title="Editar sucursal" aria-label={`Editar sucursal ${s.nombre}`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white hover:text-[var(--brand)] sm:h-9 sm:w-9">
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
              <ul className="divide-y divide-slate-100">
                {s.depositos.map((d) => (
                  <li key={d.id} className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5 pl-4 pr-2 sm:flex-nowrap sm:py-3 sm:pl-5 sm:pr-3 ${d.activo ? "" : "bg-slate-50/70"}`}>
                    <div className="flex min-w-0 flex-1 basis-full items-center gap-3 sm:basis-auto">
                      <Warehouse className={`h-4 w-4 shrink-0 ${d.activo ? "text-slate-400" : "text-slate-300"}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 [overflow-wrap:anywhere] sm:truncate">
                          {d.nombre}
                          {d.es_principal ? <span className="ml-1.5 rounded bg-[var(--brand-50)] px-1.5 py-0.5 align-middle text-[10px] font-semibold text-[var(--brand)]">Principal</span> : null}
                          {!d.activo ? <span className="ml-1.5 rounded bg-slate-200 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-slate-500">Inactivo</span> : null}
                        </p>
                        {d.descripcion ? <p className="text-[11px] text-slate-400 [overflow-wrap:anywhere] sm:truncate">{d.descripcion}</p> : null}
                      </div>
                    </div>
                    <div className="flex min-w-0 flex-1 items-center justify-between gap-2 pl-7 sm:flex-none sm:shrink-0 sm:justify-end sm:gap-4 sm:pl-0">
                      <Link href={`/inventario?deposito=${d.id}`} className="min-w-0 sm:text-right" title="Lo que hay en este depósito">
                        <p className="text-sm font-semibold tabular-nums text-slate-900">{cant(d.unidades)} <span className="text-[11px] font-normal text-slate-400">unid.</span></p>
                        <p className="text-[11px] tabular-nums text-slate-500">{d.productos} {d.productos === 1 ? "producto" : "productos"} · {gs(d.valor)}</p>
                      </Link>
                      <button onClick={() => setDeposito({ abierto: true, d, sucursalId: s.id })} title="Editar depósito" aria-label={`Editar depósito ${d.nombre}`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-[var(--brand-50)] hover:text-[var(--brand)] sm:h-9 sm:w-9">
                        <Pencil className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {s.activa ? (
                <div className="border-t border-slate-100 px-2 py-1.5 sm:px-5 sm:py-2.5">
                  <button onClick={() => setDeposito({ abierto: true, d: null, sucursalId: s.id })} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-semibold sm:min-h-0 sm:text-xs text-[var(--brand)] transition hover:bg-[var(--brand-50)]">
                    <Plus className="h-3.5 w-3.5" /> Agregar depósito
                  </button>
                </div>
              ) : null}
            </section>
          ))}
        </div>
      )}

      {/* Usuarios y su sucursal */}
      {datos && datos.usuarios.length ? (
        <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: `${TEAL}33` }}>
          <div className="border-b px-4 py-3.5 sm:px-5 sm:py-4" style={{ borderColor: `${TEAL}22`, background: `linear-gradient(to right, ${TEAL}0d, transparent)` }}>
            <h2 className="text-sm font-semibold text-slate-900">Dónde trabaja cada usuario</h2>
            <p className="text-[11px] text-slate-500">Las ventas, compras y pérdidas de un usuario usan el depósito principal de su sucursal (se puede elegir otro en cada compra). El administrador ve todas.</p>
          </div>
          <ul className="divide-y divide-slate-100">
            {datos.usuarios.map((u) => (
              <li key={u.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-5 sm:py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 [overflow-wrap:anywhere]">{u.nombre}</p>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">{u.rol}</p>
                </div>
                <div className="flex items-center gap-2 sm:shrink-0">
                  {asignando === u.id ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" /> : null}
                  <div className="min-w-0 flex-1 sm:w-[280px] sm:flex-none">
                  <Select value={u.sucursal_id ?? ""} onChange={(v) => asignar(u.id, v)} block etiqueta={`Sucursal de ${u.nombre}`}
                    options={[["", "Sin sucursal fija (usa la principal)"], ...activas.map((s): [string, string] => [s.id, s.nombre])]} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {errorUsuario ? <p className="border-t border-rose-100 bg-rose-50 px-5 py-2 text-xs text-rose-700">{errorUsuario}</p> : null}
        </section>
      ) : null}

      {sucursal.abierta ? (
        <ModalSucursal s={sucursal.s} onClose={() => setSucursal({ abierta: false, s: null })} onGuardado={() => { setSucursal({ abierta: false, s: null }); refrescar(); }} />
      ) : null}
      {deposito.abierto ? (
        <ModalDeposito d={deposito.d} sucursalId={deposito.sucursalId} sucursales={activas}
          onClose={() => setDeposito({ abierto: false, d: null, sucursalId: "" })}
          onGuardado={() => { setDeposito({ abierto: false, d: null, sucursalId: "" }); refrescar(); }} />
      ) : null}
    </div>
  );
}

function ModalSucursal({ s, onClose, onGuardado }: { s: Sucursal | null; onClose: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({
    nombre: s?.nombre ?? "",
    direccion: s?.direccion ?? "",
    ciudad: s?.ciudad ?? "",
    telefono: s?.telefono ?? "",
    establecimiento: s?.establecimiento ?? "",
    punto_expedicion: s?.punto_expedicion ?? "001",
    es_principal: s?.es_principal ?? false,
    activa: s?.activa ?? true,
    deposito_nombre: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const tres = (v: string) => v.replace(/\D/g, "").slice(0, 3);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.nombre.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/inventario/sucursales", {
        method: "POST",
        body: JSON.stringify({ ...f, id: s?.id ?? null, deposito_nombre: s ? null : f.deposito_nombre.trim() || null }),
      });
      onGuardado();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <ModalDocumento titulo={s ? "Editar sucursal" : "Nueva sucursal"} subtitulo={s ? s.nombre : "Un local de la empresa, con su depósito principal"} ancho="max-w-lg" onClose={busy ? undefined : onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className={`${BOTON_SECUNDARIO} max-sm:flex-1`}>Cancelar</button>
          <button type="submit" form="form-sucursal" disabled={busy || !f.nombre.trim()} className={`${BOTON_PRIMARIO} max-sm:flex-1`} style={{ backgroundColor: TEAL }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {s ? "Guardar cambios" : "Crear sucursal"}
          </button>
        </>
      }>
      <form id="form-sucursal" onSubmit={guardar} className="space-y-4">
        <label className="block">
          <span className={ET}>Nombre *</span>
          <input autoFocus value={f.nombre} onChange={(e) => set("nombre", e.target.value)} maxLength={80} placeholder="Ej. Sucursal Luque" className={INPUT} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 block">
            <span className={ET}>Dirección <span className="font-normal text-slate-400">(punto de partida/llegada de las remisiones)</span></span>
            <input value={f.direccion} onChange={(e) => set("direccion", e.target.value)} maxLength={200} placeholder="Ej. Ruta 2 km 15" className={INPUT} />
          </label>
          <label className="col-span-2 block sm:col-span-1">
            <span className={ET}>Ciudad</span>
            <input value={f.ciudad} onChange={(e) => set("ciudad", e.target.value)} maxLength={80} placeholder="Ej. Luque" className={INPUT} />
          </label>
          <label className="col-span-2 block sm:col-span-1">
            <span className={ET}>Teléfono</span>
            <input type="tel" inputMode="tel" value={f.telefono} onChange={(e) => set("telefono", e.target.value)} maxLength={40} className={INPUT} />
          </label>
          <label className="block">
            <span className={ET}>Establecimiento</span>
            <input inputMode="numeric" value={f.establecimiento} onChange={(e) => set("establecimiento", tres(e.target.value))} placeholder="002" className={`${INPUT} font-mono`} />
          </label>
          <label className="block">
            <span className={ET}>Punto de expedición</span>
            <input inputMode="numeric" value={f.punto_expedicion} onChange={(e) => set("punto_expedicion", tres(e.target.value))} placeholder="001" className={`${INPUT} font-mono`} />
          </label>
        </div>
        <p className="-mt-1 text-[11px] text-slate-500">
          Numeran las notas de remisión de los traslados que salen de esta sucursal ({f.establecimiento || "001"}-{f.punto_expedicion || "001"}-0000001). Son los del timbrado de la sucursal.
        </p>
        {!s ? (
          <label className="block">
            <span className={ET}>Nombre de su depósito principal</span>
            <input value={f.deposito_nombre} onChange={(e) => set("deposito_nombre", e.target.value)} maxLength={80} placeholder={`Depósito ${f.nombre.trim() || "…"}`} className={INPUT} />
            <span className="mt-1 block text-[11px] text-slate-400">Se crea junto con la sucursal. Después le podés agregar más depósitos.</span>
          </label>
        ) : null}
        <div className="space-y-2">
          <Check checked={f.es_principal} disabled={s?.es_principal} onChange={(v) => set("es_principal", v)} label="Sucursal principal (Casa central)" detalle={s?.es_principal ? "Para cambiarla, marcá otra como principal." : "Es la que se usa cuando un usuario no tiene sucursal fija."} />
          {s ? <Check checked={f.activa} disabled={s.es_principal} onChange={(v) => set("activa", v)} label="Activa" detalle="Desactivarla desactiva sus depósitos. No se puede si tiene stock o traslados en tránsito." /> : null}
        </div>
        {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
      </form>
    </ModalDocumento>
  );
}

function ModalDeposito({ d, sucursalId, sucursales, onClose, onGuardado }: {
  d: Deposito | null; sucursalId: string; sucursales: Sucursal[]; onClose: () => void; onGuardado: () => void;
}) {
  const [f, setF] = useState({
    sucursal_id: sucursalId,
    nombre: d?.nombre ?? "",
    descripcion: d?.descripcion ?? "",
    es_principal: d?.es_principal ?? false,
    activo: d?.activo ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.nombre.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/inventario/depositos", { method: "POST", body: JSON.stringify({ ...f, id: d?.id ?? null }) });
      onGuardado();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <ModalDocumento titulo={d ? "Editar depósito" : "Nuevo depósito"} subtitulo={d ? d.nombre : "Otro lugar donde se guarda mercadería"} ancho="max-w-lg" onClose={busy ? undefined : onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className={`${BOTON_SECUNDARIO} max-sm:flex-1`}>Cancelar</button>
          <button type="submit" form="form-deposito" disabled={busy || !f.nombre.trim()} className={`${BOTON_PRIMARIO} max-sm:flex-1`} style={{ backgroundColor: TEAL }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {d ? "Guardar cambios" : "Crear depósito"}
          </button>
        </>
      }>
      <form id="form-deposito" onSubmit={guardar} className="space-y-4">
        <label className="block">
          <span className={ET}>Nombre *</span>
          <input autoFocus value={f.nombre} onChange={(e) => set("nombre", e.target.value)} maxLength={80} placeholder="Ej. Depósito trasero" className={INPUT} />
        </label>
        <div>
          <span className={ET}>Sucursal</span>
          <Select value={f.sucursal_id} onChange={(v) => set("sucursal_id", v)} block disabled={!!d?.es_principal}
            options={sucursales.map((s): [string, string] => [s.id, s.nombre])} />
        </div>
        <label className="block">
          <span className={ET}>Descripción <span className="font-normal text-slate-400">(opcional)</span></span>
          <input value={f.descripcion} onChange={(e) => set("descripcion", e.target.value)} maxLength={300} placeholder="Ej. Cámara de frío, góndola, galpón" className={INPUT} />
        </label>
        <div className="space-y-2">
          <Check checked={f.es_principal} disabled={d?.es_principal} onChange={(v) => set("es_principal", v)} label="Depósito principal de la sucursal"
            detalle={d?.es_principal ? "Para cambiarlo, marcá otro como principal." : "De acá salen las ventas y entran las compras de la sucursal (por defecto)."} />
          {d ? <Check checked={f.activo} disabled={d.es_principal} onChange={(v) => set("activo", v)} label="Activo" detalle="No se puede desactivar si tiene stock, traslados en tránsito o pérdidas pendientes." /> : null}
        </div>
        {d && d.unidades > 0 ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">Tiene {cant(d.unidades)} unidades de {d.productos} productos ({gs(d.valor)} al costo).</p> : null}
        {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
      </form>
    </ModalDocumento>
  );
}

function Check({ checked, disabled, onChange, label, detalle }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string; detalle: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-left transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        <span className="block text-[11px] text-slate-400">{detalle}</span>
      </span>
      <span className="relative h-5 w-9 shrink-0 rounded-full transition-colors" style={{ backgroundColor: checked ? TEAL : "#cbd5e1" }}>
        <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all" style={{ left: checked ? 18 : 2 }} />
      </span>
    </button>
  );
}
