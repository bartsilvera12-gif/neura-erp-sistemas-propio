"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MontoInput from "@/components/ui/MontoInput";
import { saveCompra, uploadCompraComprobante, getCuentasContablesOpciones, type CuentaContableOpcion } from "@/lib/compras/storage";
import CuentaCombobox from "@/components/contabilidad/CuentaCombobox";
import SmartCombobox, { type ComboOption } from "@/components/ui/SmartCombobox";
import { getProveedores, proveedorExiste, createProveedor } from "@/lib/proveedores/storage";
import { getProductos, productoExiste, saveProducto } from "@/lib/inventario/storage";
import type { TipoIva, TipoPago, Moneda } from "@/lib/compras/types";
import type { Proveedor } from "@/lib/proveedores/types";
import type { Producto } from "@/lib/inventario/types";

const fmt = (v: number) => `₲ ${Math.round(v).toLocaleString("es-PY")}`;
function margenColor(m: number) {
  if (m >= 40) return "text-emerald-600";
  if (m >= 20) return "text-amber-600";
  return "text-red-600";
}
function genIdemKey(): string {
  try { if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID(); } catch {}
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
/** Máscara del N° de factura: 3-3-7 (001-001-0000001). */
function formatComprobante(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 13);
  let out = d.slice(0, 3);
  if (d.length > 3) out += "-" + d.slice(3, 6);
  if (d.length > 6) out += "-" + d.slice(6, 13);
  return out;
}
const TIPOS_COMPROBANTE = ["Factura", "Factura Electrónica", "Factura Virtual", "Factura de Exportación", "Autofactura", "Boleta", "Otro"];
const MAX_COMPROBANTE_MB = 8;
const ALLOWED_COMPROBANTE = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

const INPUT = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/40 focus:border-[#4FAEB2] bg-white";
const LABEL = "mb-1 block text-xs font-semibold text-slate-500";
const SUBLABEL = "mb-1 block text-[11px] font-medium text-slate-500";

function Seg<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-slate-200">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={`flex-1 py-2 text-xs font-semibold transition-colors ${
            value === o.value ? "bg-[#4FAEB2] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Titulo({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden className="block h-4 w-1 rounded-full bg-[#4FAEB2]" />
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{children}</h3>
    </div>
  );
}

/** Modal compacto de alta de compra directa (misma lógica que /compras/nueva, estilo ERP). */
export default function NuevaCompraModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cuentas, setCuentas] = useState<CuentaContableOpcion[]>([]);
  const [idempotencyKey] = useState(genIdemKey);

  const [form, setForm] = useState({
    proveedor_id: "", producto_id: "", nro_timbrado: "",
    tipo_comprobante: "Factura", numero_comprobante: "",
    cantidad: "", moneda: "PYG" as Moneda, tipo_cambio: "", costo_unitario_input: "",
    iva_tipo: "10" as TipoIva, precio_venta: "", tipo_pago: "contado" as TipoPago,
    plazo_dias: "", cuenta_contable_id: "", cuenta_contrapartida_id: "",
  });
  const set = (patch: Partial<typeof form>) => setForm((p) => ({ ...p, ...patch }));

  // Foto/PDF de la factura (se sube después de crear la compra).
  const [archivo, setArchivo] = useState<File | null>(null);
  const [errArchivo, setErrArchivo] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [errorSubmit, setErrorSubmit] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Inline: proveedor
  const [nvProv, setNvProv] = useState(false);
  const [fProv, setFProv] = useState({ nombre: "", ruc: "", telefono: "", email: "", contacto: "" });
  const [errRuc, setErrRuc] = useState<string | null>(null);
  // Inline: producto
  const [nvProd, setNvProd] = useState(false);
  const [fProd, setFProd] = useState({ nombre: "", sku: "", unidad_medida: "Unidad", stock_minimo: "0" });
  const [errSku, setErrSku] = useState<string | null>(null);

  async function recargarProveedores() {
    const d = await getProveedores();
    setProveedores(d.filter((p) => p.estado === "activo"));
  }
  const recargarProductos = () => getProductos().then(setProductos);

  useEffect(() => {
    recargarProveedores();
    recargarProductos();
    getCuentasContablesOpciones().then(setCuentas);
    (async () => {
      try {
        const { apiFetch } = await import("@/lib/api/fetch-with-supabase-session");
        const r = await apiFetch("/api/configuracion/contable");
        const j = await r.json().catch(() => ({}));
        const def = j?.data?.config?.cuenta_caja_id ?? j?.data?.config?.cuenta_banco_id ?? null;
        if (def) setForm((prev) => (prev.cuenta_contrapartida_id ? prev : { ...prev, cuenta_contrapartida_id: def }));
      } catch {}
    })();
  }, []);

  // Cálculos
  const cantidadNum = parseFloat(form.cantidad) || 0;
  const costoInputNum = parseFloat(form.costo_unitario_input) || 0;
  const tipoCambioNum = form.moneda === "USD" ? (parseFloat(form.tipo_cambio) || 0) : 1;
  const costoUnitarioPYG = costoInputNum * tipoCambioNum;
  const precioVentaNum = parseFloat(form.precio_venta) || 0;
  const bruto = cantidadNum > 0 && costoUnitarioPYG > 0 ? cantidadNum * costoUnitarioPYG : 0;
  const montoIva = form.iva_tipo === "exenta" ? 0
    : form.iva_tipo === "5" ? Math.round(bruto * (5 / 105)) : Math.round(bruto * (10 / 110));
  const subtotal = bruto - montoIva;
  const total = bruto;
  const margenVenta = precioVentaNum > 0 && costoUnitarioPYG > 0
    ? ((precioVentaNum - costoUnitarioPYG) / precioVentaNum) * 100 : null;
  const calculosListos = subtotal > 0 && precioVentaNum > 0;
  const productoSel = productos.find((p) => p.id === form.producto_id);

  const provOpts: ComboOption[] = useMemo(
    () => proveedores.map((p) => ({ id: p.id, label: p.nombre, sub: p.ruc ? `RUC ${p.ruc}` : null })), [proveedores]);
  const prodOpts: ComboOption[] = useMemo(
    () => productos.map((p) => ({ id: p.id, label: p.nombre, sub: `${p.sku} · stock ${p.stock_actual}` })), [productos]);

  function seleccionarProducto(id: string | null) {
    const p = productos.find((x) => x.id === id);
    set({ producto_id: id ?? "", costo_unitario_input: p ? String(p.costo_promedio) : form.costo_unitario_input,
          precio_venta: p ? String(p.precio_venta) : form.precio_venta });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorSubmit(null);
    if (!form.proveedor_id) return setErrorSubmit("Seleccioná o agregá un proveedor.");
    if (!form.producto_id) return setErrorSubmit("Seleccioná o agregá un producto.");
    if (cantidadNum <= 0) return setErrorSubmit("La cantidad debe ser mayor a 0.");
    if (costoUnitarioPYG <= 0) return setErrorSubmit("El costo unitario debe ser mayor a 0.");
    if (precioVentaNum <= 0) return setErrorSubmit("El precio de venta debe ser mayor a 0.");
    if (!form.nro_timbrado?.trim()) return setErrorSubmit("Ingresá el N° de timbrado.");
    if (!form.cuenta_contable_id) return setErrorSubmit("Seleccioná la cuenta contable de la compra.");
    if (form.tipo_pago === "contado" && !form.cuenta_contrapartida_id) return setErrorSubmit("Seleccioná la cuenta de pago (contado).");

    const todosProductos = await getProductos();
    const proveedor = proveedores.find((p) => String(p.id) === form.proveedor_id);
    const producto = todosProductos.find((p) => p.id === form.producto_id);
    if (!proveedor) return setErrorSubmit("Proveedor no encontrado. Recargá e intentá de nuevo.");
    if (!producto) return setErrorSubmit("Producto no encontrado. Recargá e intentá de nuevo.");

    setSubmitting(true);
    try {
      const res = await saveCompra({
        proveedor_id: String(proveedor.id), proveedor_nombre: proveedor.nombre,
        producto_id: producto.id, producto_nombre: producto.nombre,
        cantidad: cantidadNum, moneda: form.moneda, tipo_cambio: tipoCambioNum,
        costo_unitario_original: costoInputNum, costo_unitario: costoUnitarioPYG,
        iva_tipo: form.iva_tipo, subtotal, monto_iva: montoIva, total,
        precio_venta: precioVentaNum, margen_venta: margenVenta ?? 0, tipo_pago: form.tipo_pago,
        plazo_dias: form.tipo_pago === "credito" && form.plazo_dias ? parseInt(form.plazo_dias) : undefined,
        nro_timbrado: form.nro_timbrado,
        numero_comprobante: form.numero_comprobante.trim() || null,
        tipo_comprobante: form.tipo_comprobante || "Factura",
        cuenta_contable_id: form.cuenta_contable_id || null,
        cuenta_contrapartida_id: form.tipo_pago === "contado" ? (form.cuenta_contrapartida_id || null) : null,
        cuenta_contable_label: null,
      }, idempotencyKey);
      if (!res.success) { setErrorSubmit(res.error); return; }

      // Subir la foto/PDF de la factura (best-effort: la compra ya quedó guardada).
      if (archivo) {
        const up = await uploadCompraComprobante(res.compra.id, archivo);
        if (!up.ok) {
          alert(`La compra se guardó, pero no se pudo adjuntar el comprobante: ${up.error}. Podés volver a adjuntarlo desde el detalle.`);
        }
      }
      if (res.warning) alert(res.warning);
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  function elegirArchivo(f: File | null) {
    setErrArchivo(null);
    if (!f) { setArchivo(null); return; }
    if (!ALLOWED_COMPROBANTE.has(f.type)) { setErrArchivo("Formato no permitido. Usá JPG, PNG, WebP o PDF."); return; }
    if (f.size > MAX_COMPROBANTE_MB * 1024 * 1024) { setErrArchivo(`El archivo supera ${MAX_COMPROBANTE_MB} MB.`); return; }
    setArchivo(f);
  }

  async function agregarProveedor() {
    if (!fProv.nombre.trim() || !fProv.ruc.trim()) return;
    setErrRuc(null);
    const dup = await proveedorExiste(fProv.ruc);
    if (dup) { setErrRuc(`RUC ya registrado para "${dup.nombre}".`); return; }
    const r = await createProveedor({
      nombre: fProv.nombre.trim().toUpperCase(), ruc: fProv.ruc.trim(), telefono: fProv.telefono.trim(),
      email: fProv.email.trim(), contacto: fProv.contacto.trim().toUpperCase(), direccion: "", estado: "activo",
    });
    if (!r.ok) { setErrRuc(r.error); return; }
    await recargarProveedores();
    set({ proveedor_id: String(r.proveedor.id) });
    setNvProv(false);
    setFProv({ nombre: "", ruc: "", telefono: "", email: "", contacto: "" });
  }

  async function agregarProducto() {
    if (!fProd.nombre.trim() || !fProd.sku.trim()) return;
    setErrSku(null);
    const dup = await productoExiste(fProd.sku, fProd.nombre);
    if (dup) { setErrSku(`Ya existe un producto con ese SKU o nombre ("${dup.nombre}" — ${dup.sku}).`); return; }
    const creado = await saveProducto({
      nombre: fProd.nombre.trim().toUpperCase(), sku: fProd.sku.trim().toUpperCase(),
      unidad_medida: fProd.unidad_medida.toUpperCase(), metodo_valuacion: "CPP",
      stock_actual: 0, stock_minimo: parseInt(fProd.stock_minimo) || 0,
      // El precio de venta se toma del campo del formulario principal al guardar la compra.
      costo_promedio: costoUnitarioPYG || 0, precio_venta: 0,
    });
    if (!creado) return;
    await recargarProductos();
    set({ producto_id: creado.id });
    setNvProd(false);
    setFProd({ nombre: "", sku: "", unidad_medida: "Unidad", stock_minimo: "0" });
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center bg-slate-900/60 px-0 pt-0 backdrop-blur-sm sm:px-4 sm:pt-8" onClick={onClose}>
      <form onSubmit={handleSubmit}
        className="flex h-[100dvh] max-h-[100dvh] w-full max-w-3xl flex-col rounded-none border-0 bg-white shadow-2xl sm:h-auto sm:max-h-[90dvh] sm:rounded-2xl sm:border"
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[#4FAEB2] shadow-[0_0_0_3px_rgba(79,174,178,0.18)]" />
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Operaciones · Compras</p>
            </div>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Nueva compra</h2>
          </div>
          <button type="button" onClick={onClose}
            className="rounded-lg px-2 py-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700">✕</button>
        </div>

        {/* Cuerpo */}
        <div className="flex-1 space-y-5 overflow-y-auto p-5">

          {/* Comprobante + Proveedor + Cuenta contable */}
          <section className="space-y-3">
            <Titulo>Comprobante y proveedor</Titulo>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={LABEL}>Tipo de comprobante</label>
                <select value={form.tipo_comprobante} onChange={(e) => set({ tipo_comprobante: e.target.value })} className={INPUT}>
                  {TIPOS_COMPROBANTE.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={LABEL}>N° de factura</label>
                <input value={form.numero_comprobante} inputMode="numeric"
                  onChange={(e) => set({ numero_comprobante: formatComprobante(e.target.value) })}
                  placeholder="Ej: 001-001-0000001" className={INPUT} />
              </div>
              <div>
                <label className={LABEL}>N° de timbrado <span className="text-red-500">*</span></label>
                <input value={form.nro_timbrado} inputMode="numeric"
                  onChange={(e) => set({ nro_timbrado: e.target.value.replace(/\D/g, "").slice(0, 8) })}
                  placeholder="Ej: 12345678 (8 dígitos)" className={INPUT} />
              </div>
              <div>
                <label className={LABEL}>Proveedor <span className="text-red-500">*</span></label>
                <SmartCombobox options={provOpts} value={form.proveedor_id || null}
                  onChange={(id) => set({ proveedor_id: id ?? "" })} placeholder="Seleccionar proveedor…" />
                {!nvProv ? (
                  <button type="button" onClick={() => setNvProv(true)}
                    className="mt-1.5 text-[11px] text-slate-400 underline underline-offset-2 transition-colors hover:text-[#3F8E91]">
                    ¿No encontrás el proveedor? Crear nuevo
                  </button>
                ) : null}
              </div>
            </div>

            {/* Foto / PDF de la factura */}
            <div>
              <label className={LABEL}>Foto de la factura (opcional)</label>
              {!archivo ? (
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm font-semibold text-[#3F8E91] transition-colors hover:bg-[#4FAEB2]/5">
                  <span className="text-base leading-none">📎</span> Adjuntar foto o PDF
                </button>
              ) : (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
                  <span className="truncate text-slate-700">📄 {archivo.name}</span>
                  <button type="button" onClick={() => { setArchivo(null); if (fileRef.current) fileRef.current.value = ""; }}
                    className="shrink-0 rounded px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">Quitar</button>
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden"
                onChange={(e) => elegirArchivo(e.target.files?.[0] ?? null)} />
              {errArchivo && <p className="mt-1 text-[11px] text-red-600">{errArchivo}</p>}
              <p className="mt-1 text-[11px] text-slate-400">JPG, PNG, WebP o PDF · máx. {MAX_COMPROBANTE_MB} MB.</p>
            </div>

            {nvProv && (
              <InlineBox titulo="Nuevo proveedor" onCancel={() => { setNvProv(false); setErrRuc(null); }}
                onSave={agregarProveedor} saveDisabled={!fProv.nombre.trim() || !fProv.ruc.trim()}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div><label className={SUBLABEL}>Nombre / Razón social *</label>
                    <input value={fProv.nombre} onChange={(e) => setFProv((p) => ({ ...p, nombre: e.target.value.toUpperCase() }))}
                      placeholder="Ej: TEXTILES DEL SUR S.A." className={`${INPUT} uppercase`} /></div>
                  <div><label className={SUBLABEL}>RUC *</label>
                    <input value={fProv.ruc} onChange={(e) => { setErrRuc(null); setFProv((p) => ({ ...p, ruc: e.target.value })); }}
                      placeholder="Ej: 80012345-1" className={`${INPUT} ${errRuc ? "border-red-300 bg-red-50" : ""}`} />
                    {errRuc && <p className="mt-1 text-[11px] text-red-600">{errRuc}</p>}</div>
                  <div><label className={SUBLABEL}>Teléfono</label>
                    <input value={fProv.telefono} onChange={(e) => setFProv((p) => ({ ...p, telefono: e.target.value }))}
                      placeholder="Ej: 0981 111 222" className={INPUT} /></div>
                  <div><label className={SUBLABEL}>Email</label>
                    <input value={fProv.email} onChange={(e) => setFProv((p) => ({ ...p, email: e.target.value.toLowerCase() }))}
                      placeholder="Ej: ventas@empresa.com" className={INPUT} /></div>
                  <div className="sm:col-span-2"><label className={SUBLABEL}>Persona de contacto</label>
                    <input value={fProv.contacto} onChange={(e) => setFProv((p) => ({ ...p, contacto: e.target.value.toUpperCase() }))}
                      placeholder="Ej: CARLOS MENDOZA" className={`${INPUT} uppercase`} /></div>
                </div>
              </InlineBox>
            )}

            <div>
              <label className={LABEL}>Cuenta contable <span className="text-red-500">*</span></label>
              <CuentaCombobox cuentas={cuentas} value={form.cuenta_contable_id || null}
                onChange={(id) => set({ cuenta_contable_id: id ?? "" })} placeholder="Buscar por código o denominación…" />
              <p className="mt-1 text-[11px] text-slate-400">Solo cuentas activas e imputables (asentables).</p>
            </div>
          </section>

          {/* Producto */}
          <section className="space-y-3">
            <Titulo>Producto</Titulo>
            <div>
              <label className={LABEL}>Producto <span className="text-red-500">*</span></label>
              <SmartCombobox options={prodOpts} value={form.producto_id || null}
                onChange={seleccionarProducto} placeholder="Seleccionar producto…" />
              {productoSel && (
                <p className="mt-1.5 text-[11px] text-slate-400">
                  Costo promedio: {fmt(productoSel.costo_promedio)} · Precio de venta: {fmt(productoSel.precio_venta)}
                </p>
              )}
              {!nvProd ? (
                <button type="button" onClick={() => setNvProd(true)}
                  className="mt-1.5 text-[11px] text-slate-400 underline underline-offset-2 transition-colors hover:text-[#3F8E91]">
                  ¿No encontrás el producto? Crear nuevo
                </button>
              ) : null}
            </div>

            {nvProd && (
              <InlineBox titulo="Nuevo producto" onCancel={() => { setNvProd(false); setErrSku(null); }}
                onSave={agregarProducto} saveDisabled={!fProd.nombre.trim() || !fProd.sku.trim()}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div><label className={SUBLABEL}>Nombre *</label>
                    <input value={fProd.nombre} onChange={(e) => setFProd((p) => ({ ...p, nombre: e.target.value.toUpperCase() }))}
                      placeholder="Ej: REMERA OVERSIZE BLANCA" className={`${INPUT} uppercase`} /></div>
                  <div><label className={SUBLABEL}>SKU / Código *</label>
                    <input value={fProd.sku} onChange={(e) => { setErrSku(null); setFProd((p) => ({ ...p, sku: e.target.value.toUpperCase() })); }}
                      placeholder="Ej: OOTD-005" className={`${INPUT} uppercase ${errSku ? "border-red-300 bg-red-50" : ""}`} />
                    {errSku && <p className="mt-1 text-[11px] text-red-600">{errSku}</p>}</div>
                  <div><label className={SUBLABEL}>Unidad de medida</label>
                    <select value={fProd.unidad_medida} onChange={(e) => setFProd((p) => ({ ...p, unidad_medida: e.target.value }))} className={INPUT}>
                      {["Unidad", "Par", "Caja", "Kg", "Litro", "Metro"].map((u) => <option key={u} value={u}>{u}</option>)}
                    </select></div>
                  <div><label className={SUBLABEL}>Stock mínimo</label>
                    <input type="number" min={0} value={fProd.stock_minimo}
                      onChange={(e) => setFProd((p) => ({ ...p, stock_minimo: e.target.value }))} placeholder="Ej: 5" className={INPUT} /></div>
                </div>
                <p className="text-[11px] text-slate-400">El costo y el precio de venta se toman de los campos de la compra.</p>
              </InlineBox>
            )}
          </section>

          {/* Moneda, costos y precio de venta */}
          <section className="space-y-3">
            <Titulo>Moneda, costos y precio</Titulo>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={LABEL}>Moneda</label>
                <Seg<Moneda> value={form.moneda}
                  options={[{ value: "PYG", label: "Guaraníes (₲)" }, { value: "USD", label: "Dólares (USD)" }]}
                  onChange={(v) => set({ moneda: v, tipo_cambio: "" })} />
                {form.moneda === "USD" && (
                  <div className="mt-2">
                    <label className={SUBLABEL}>Tipo de cambio (USD → Gs.) <span className="text-red-500">*</span></label>
                    <MontoInput value={form.tipo_cambio} onChange={(nn) => set({ tipo_cambio: String(nn) })}
                      placeholder="Ej: 7500" className={INPUT} decimals={false} />
                  </div>
                )}
              </div>
              <div><label className={LABEL}>Cantidad <span className="text-red-500">*</span></label>
                <input type="number" min={1} step={1} value={form.cantidad}
                  onChange={(e) => set({ cantidad: e.target.value })} placeholder="Ej: 50" className={INPUT} /></div>

              {/* Par costo ↔ precio, siempre lado a lado */}
              <div><label className={LABEL}>Costo unitario ({form.moneda === "USD" ? "USD" : "Gs."}) <span className="text-red-500">*</span></label>
                <MontoInput value={form.costo_unitario_input} onChange={(nn) => set({ costo_unitario_input: String(nn) })}
                  placeholder={form.moneda === "USD" ? "Ej: 12" : "Ej: 35000"} className={INPUT} decimals={form.moneda === "USD"} />
                {form.moneda === "USD" && costoInputNum > 0 && tipoCambioNum > 0 && (
                  <p className="mt-1 text-[11px] text-slate-400">≈ {fmt(costoUnitarioPYG)} por unidad</p>
                )}
              </div>
              <div><label className={LABEL}>Precio de venta (Gs.) <span className="text-red-500">*</span></label>
                <MontoInput value={form.precio_venta} onChange={(nn) => set({ precio_venta: String(nn) })}
                  placeholder="Ej: 75000" className={INPUT} decimals={false} />
                <p className="mt-1 text-[11px] text-slate-400">Se actualizará en inventario al guardar.</p>
              </div>
            </div>

            {margenVenta !== null && calculosListos && (
              <div className={`flex items-center justify-between rounded-lg border px-4 py-2.5 ${
                margenVenta < 0 ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"}`}>
                <span className="text-sm text-slate-600">Margen sobre venta</span>
                <span className={`text-lg font-bold tabular-nums ${margenColor(margenVenta)}`}>
                  {margenVenta < 0 ? "⚠ " : ""}{margenVenta.toFixed(2)}%
                </span>
              </div>
            )}

            {/* IVA */}
            <div>
              <label className={LABEL}>IVA (incluido en el costo)</label>
              <Seg<TipoIva> value={form.iva_tipo}
                options={[{ value: "exenta", label: "Exenta" }, { value: "5", label: "IVA 5%" }, { value: "10", label: "IVA 10%" }]}
                onChange={(v) => set({ iva_tipo: v })} />
            </div>

            {subtotal > 0 && (
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Subtotal" value={fmt(subtotal)} />
                <Stat label="IVA" value={form.iva_tipo === "exenta" ? "—" : fmt(montoIva)} />
                <Stat label="Total" value={fmt(total)} highlight />
              </div>
            )}
          </section>

          {/* Condiciones de pago */}
          <section className="space-y-3">
            <Titulo>Condiciones de pago</Titulo>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><label className={LABEL}>Tipo de pago</label>
                <Seg<TipoPago> value={form.tipo_pago}
                  options={[{ value: "contado", label: "Contado" }, { value: "credito", label: "Crédito" }]}
                  onChange={(v) => set({ tipo_pago: v })} /></div>
              {form.tipo_pago === "contado" ? (
                <div><label className={LABEL}>Cuenta de pago <span className="text-red-500">*</span></label>
                  <CuentaCombobox cuentas={cuentas} value={form.cuenta_contrapartida_id || null}
                    onChange={(id) => set({ cuenta_contrapartida_id: id ?? "" })} placeholder="Caja, Banco…" />
                </div>
              ) : (
                <div><label className={LABEL}>Plazo (días)</label>
                  <input type="number" min={1} value={form.plazo_dias}
                    onChange={(e) => set({ plazo_dias: e.target.value })} placeholder="Ej: 30" className={INPUT} /></div>
              )}
            </div>
          </section>

          {calculosListos && productoSel && (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700">
              <span className="mt-0.5 leading-none">✓</span>
              <span>Al guardar se registrará una <strong>entrada de {cantidadNum} unidades</strong> de <strong>{productoSel.nombre}</strong> en inventario.</span>
            </div>
          )}

          {errorSubmit && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{errorSubmit}</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button type="button" onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50">
            Cancelar
          </button>
          <button type="submit" disabled={!calculosListos || submitting}
            className="rounded-xl bg-[#4FAEB2] px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91] disabled:cursor-not-allowed disabled:opacity-40">
            {submitting ? "Guardando…" : "Guardar compra"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg px-3 py-2.5 text-center ${highlight ? "bg-[#4FAEB2] text-white" : "border border-slate-200 bg-slate-50"}`}>
      <p className={`mb-0.5 text-[11px] ${highlight ? "text-white/80" : "text-slate-400"}`}>{label}</p>
      <p className={`text-sm font-bold tabular-nums ${highlight ? "" : "text-slate-700"}`}>{value}</p>
    </div>
  );
}

function InlineBox({ titulo, children, onSave, onCancel, saveDisabled }: {
  titulo: string; children: React.ReactNode; onSave: () => void; onCancel: () => void; saveDisabled: boolean;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{titulo}</p>
      {children}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onSave} disabled={saveDisabled}
          className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#3F8E91] disabled:cursor-not-allowed disabled:opacity-40">
          Guardar {titulo.toLowerCase()}
        </button>
        <button type="button" onClick={onCancel}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50">
          Cancelar
        </button>
      </div>
    </div>
  );
}
