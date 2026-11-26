"use client";

/**
 * Panel lateral para crear o editar un proveedor. Bloques: Datos (razón social, nombre
 * comercial, RUC, rubros), Contacto y Condiciones de pago. Solo la razón social es
 * obligatoria. Los rubros se eligen tocando o se crean escribiéndolos.
 */
import { useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { clienteConfig } from "@/erp2/cliente.config";
import { Drawer } from "@/erp2/components/Drawer";
import type { CategoriaProveedor, Proveedor } from "@/erp2/modules/proveedores/tipos";
import { invalidarProveedores } from "@/erp2/modules/proveedores/cache";

const BRAND = clienteConfig.color;
const INPUT = "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";
const ET = "mb-1 block text-xs font-medium text-slate-600";
const OPC = <span className="font-normal text-slate-400">(opcional)</span>;

export function ProveedorForm({
  proveedor,
  categorias,
  nombreInicial,
  onClose,
  onSaved,
}: {
  proveedor?: Proveedor | null;
  /** Alta desde el selector: arranca con lo que se escribió en la búsqueda. */
  nombreInicial?: string;
  categorias: CategoriaProveedor[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const editando = !!proveedor;
  const [f, setF] = useState({
    nombre: proveedor?.nombre ?? nombreInicial ?? "",
    nombre_comercial: proveedor?.nombre_comercial ?? "",
    ruc: proveedor?.ruc ?? "",
    telefono: proveedor?.telefono ?? "",
    email: proveedor?.email ?? "",
    direccion: proveedor?.direccion ?? "",
    ciudad: proveedor?.ciudad ?? "",
    contacto: proveedor?.contacto ?? "",
    contacto_telefono: proveedor?.contacto_telefono ?? "",
    condicion_pago: proveedor?.condicion_pago ?? "contado",
    plazo_pago_dias: proveedor?.plazo_pago_dias ? String(proveedor.plazo_pago_dias) : "30",
    moneda: proveedor?.moneda ?? "GS",
    observaciones: proveedor?.observaciones ?? "",
  });
  const [catIds, setCatIds] = useState<string[]>(proveedor?.categorias.map((c) => c.id) ?? []);
  const [nuevos, setNuevos] = useState<string[]>([]);
  const [rubro, setRubro] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const toggleCat = (id: string) => setCatIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  function agregarRubro() {
    const n = rubro.trim();
    if (!n) return;
    const existente = categorias.find((c) => c.nombre.toLowerCase() === n.toLowerCase());
    if (existente) {
      if (!catIds.includes(existente.id)) setCatIds((p) => [...p, existente.id]);
    } else if (!nuevos.some((x) => x.toLowerCase() === n.toLowerCase())) {
      setNuevos((p) => [...p, n]);
    }
    setRubro("");
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.nombre.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const body = JSON.stringify({
        ...f,
        plazo_pago_dias: f.condicion_pago === "credito" ? Number(f.plazo_pago_dias) || null : null,
        categoria_ids: catIds,
        categorias_nuevas: nuevos,
      });
      const r = editando
        ? await apiFetch<{ id: string }>(`/api/proveedores/${proveedor!.id}`, { method: "PATCH", body })
        : await apiFetch<{ id: string }>("/api/proveedores", { method: "POST", body });
      invalidarProveedores(); // el selector y los filtros de Compras vuelven a cargar
      onSaved(r.id);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const visibles = categorias.filter((c) => c.activo || catIds.includes(c.id));

  return (
    <Drawer
      titulo={editando ? "Editar proveedor" : "Nuevo proveedor"}
      subtitulo={editando ? proveedor!.nombre : "Solo la razón social es obligatoria"}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 max-sm:flex-1">Cancelar</button>
          <button type="submit" form="prov-form" disabled={busy || !f.nombre.trim()} className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-2.5 max-sm:flex-[2] max-sm:px-4 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-40" style={{ backgroundColor: BRAND }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? "Guardando…" : editando ? "Guardar cambios" : "Crear proveedor"}
          </button>
        </>
      }
    >
      <form id="prov-form" onSubmit={guardar} className="space-y-7">
        <Bloque titulo="Datos">
          <label className="block">
            <span className={ET}>Razón social *</span>
            <input autoFocus value={f.nombre} onChange={(e) => set("nombre", e.target.value)} maxLength={200} placeholder="Ej: Distribuidora Paresa S.A." className={INPUT} />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={ET}>Nombre comercial {OPC}</span>
              <input value={f.nombre_comercial} onChange={(e) => set("nombre_comercial", e.target.value)} maxLength={200} placeholder="Ej: Paresa" className={INPUT} />
            </label>
            <label className="block">
              <span className={ET}>RUC {OPC}</span>
              <input value={f.ruc} onChange={(e) => set("ruc", e.target.value)} maxLength={30} placeholder="Ej: 80012345-6" className={`${INPUT} font-mono`} />
            </label>
          </div>
          <div>
            <span className={ET}>Rubros {OPC}</span>
            <div className="flex flex-wrap gap-1.5">
              {visibles.map((c) => {
                const on = catIds.includes(c.id);
                return (
                  <button key={c.id} type="button" onClick={() => toggleCat(c.id)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition max-sm:min-h-11 max-sm:px-4 max-sm:text-[13px] ${on ? "text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}
                    style={on ? { backgroundColor: BRAND, borderColor: BRAND } : undefined}>
                    {c.nombre}
                  </button>
                );
              })}
              {nuevos.map((n) => (
                <span key={n} className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold text-white max-sm:min-h-11 max-sm:pr-1 max-sm:text-[13px]" style={{ backgroundColor: BRAND }}>
                  {n}
                  <button type="button" onClick={() => setNuevos((p) => p.filter((x) => x !== n))} aria-label={`Quitar ${n}`} className="flex items-center justify-center opacity-80 hover:opacity-100 max-sm:h-9 max-sm:w-9"><X className="h-3 w-3 max-sm:h-4 max-sm:w-4" /></button>
                </span>
              ))}
              <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 py-0.5 pl-3 pr-1 max-sm:min-h-11 max-sm:w-full max-sm:py-0 max-sm:pr-0">
                <input value={rubro} onChange={(e) => setRubro(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); agregarRubro(); } }}
                  placeholder={visibles.length || nuevos.length ? "Otro rubro…" : "Ej: Bebidas"} maxLength={60} enterKeyHint="done"
                  className="w-28 bg-transparent text-xs outline-none placeholder:text-slate-400 max-sm:min-w-0 max-sm:flex-1" />
                <button type="button" onClick={agregarRubro} disabled={!rubro.trim()} aria-label="Agregar rubro" className="flex items-center justify-center rounded-full p-1 text-slate-400 hover:text-[var(--brand)] disabled:opacity-40 max-sm:h-11 max-sm:w-11"><Plus className="h-3.5 w-3.5 max-sm:h-5 max-sm:w-5" /></button>
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">Tocá para elegir, o escribí uno nuevo y Enter. Sirve para filtrar y buscar.</p>
          </div>
        </Bloque>

        <Bloque titulo="Contacto">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={ET}>Teléfono {OPC}</span>
              <input value={f.telefono} onChange={(e) => set("telefono", e.target.value)} maxLength={40} placeholder="Ej: 021 555 000" className={INPUT} />
            </label>
            <label className="block">
              <span className={ET}>Email {OPC}</span>
              <input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} maxLength={120} placeholder="ventas@proveedor.com.py" className={INPUT} />
            </label>
            <label className="block">
              <span className={ET}>Vendedor / contacto {OPC}</span>
              <input value={f.contacto} onChange={(e) => set("contacto", e.target.value)} maxLength={120} placeholder="Ej: Juan Pérez" className={INPUT} />
            </label>
            <label className="block">
              <span className={ET}>Teléfono del vendedor {OPC}</span>
              <input value={f.contacto_telefono} onChange={(e) => set("contacto_telefono", e.target.value)} maxLength={40} placeholder="Ej: 0981 000 000" className={INPUT} />
            </label>
            <label className="block">
              <span className={ET}>Dirección {OPC}</span>
              <input value={f.direccion} onChange={(e) => set("direccion", e.target.value)} maxLength={200} className={INPUT} />
            </label>
            <label className="block">
              <span className={ET}>Ciudad {OPC}</span>
              <input value={f.ciudad} onChange={(e) => set("ciudad", e.target.value)} maxLength={80} placeholder="Ej: Asunción" className={INPUT} />
            </label>
          </div>
        </Bloque>

        <Bloque titulo="Condiciones de pago">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <span className={ET}>Cómo le pagás</span>
              <Segmentado valor={f.condicion_pago} onChange={(v) => set("condicion_pago", v as "contado" | "credito")} opciones={[["contado", "Contado"], ["credito", "Crédito"]]} />
            </div>
            <div>
              <span className={ET}>Moneda</span>
              <Segmentado valor={f.moneda} onChange={(v) => set("moneda", v as "GS" | "USD")} opciones={[["GS", "Guaraníes"], ["USD", "Dólares"]]} />
            </div>
          </div>
          {f.condicion_pago === "credito" ? (
            <label className="block">
              <span className={ET}>Plazo para pagar</span>
              <div className="flex flex-wrap items-center gap-2">
                <input inputMode="numeric" value={f.plazo_pago_dias} onChange={(e) => set("plazo_pago_dias", e.target.value.replace(/\D/g, "").slice(0, 4))} className={`${INPUT} w-24 text-right tabular-nums`} />
                <span className="text-sm text-slate-500">días</span>
                <div className="flex gap-1 sm:ml-2">
                  {["15", "30", "60", "90"].map((d) => (
                    <button key={d} type="button" onClick={() => set("plazo_pago_dias", d)} className={`rounded-lg px-2 py-1 text-xs font-semibold transition max-sm:min-h-11 max-sm:min-w-11 max-sm:text-sm ${f.plazo_pago_dias === d ? "bg-[var(--brand-50)] text-[var(--brand)]" : "text-slate-500 hover:bg-slate-100"}`}>{d}</button>
                  ))}
                </div>
              </div>
            </label>
          ) : null}
          <label className="block">
            <span className={ET}>Observaciones {OPC}</span>
            <textarea value={f.observaciones} onChange={(e) => set("observaciones", e.target.value)} rows={3} maxLength={1000} placeholder="Ej: entrega los martes, pedido mínimo Gs. 500.000" className={INPUT} />
          </label>
        </Bloque>

        {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
      </form>
    </Drawer>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2 border-b border-slate-100 pb-2">
        <span className="block h-4 w-1 rounded-full" style={{ backgroundColor: BRAND }} />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{titulo}</h3>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Segmentado({ valor, onChange, opciones }: { valor: string; onChange: (v: string) => void; opciones: [string, string][] }) {
  return (
    <div className="flex rounded-xl bg-slate-100 p-1">
      {opciones.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          className={`flex-1 rounded-lg py-1.5 text-sm font-semibold transition max-sm:min-h-11 ${valor === v ? "bg-white shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          style={valor === v ? { color: BRAND } : undefined}>
          {l}
        </button>
      ))}
    </div>
  );
}
