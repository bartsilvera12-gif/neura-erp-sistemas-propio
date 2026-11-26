"use client";

/**
 * Selector de proveedor con búsqueda inteligente: escribís parte del nombre, RUC o
 * vendedor y elegís. Si no existe, "+ Crear proveedor «X»" (o "+ Nuevo proveedor" sin texto)
 * abre el formulario completo (razón social, RUC, contacto, pago) y al guardar queda elegido.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Truck, X } from "lucide-react";
import { apiFetchCache } from "@/erp2/lib/api/cache-cliente";
import { ProveedorForm } from "@/erp2/modules/proveedores/ProveedorForm";
import type { CategoriaProveedor } from "@/erp2/modules/proveedores/tipos";
import { buscar } from "@/erp2/lib/busqueda";
import { nombreProveedor, type ProveedorMin as ProvMin } from "@/erp2/modules/proveedores/tipos";
// Una sola carga por pantalla aunque haya varios selectores (cache compartido con las
// pantallas de Compras: /api/proveedores?min=1).
import { cargarProveedores } from "@/erp2/modules/proveedores/cache";

export function SelectorProveedor({
  value,
  onChange,
  placeholder = "Buscar o crear proveedor…",
  permitirCrear = true,
}: {
  value: string | null;
  onChange: (id: string | null, nombre: string | null) => void;
  placeholder?: string;
  permitirCrear?: boolean;
}) {
  const [lista, setLista] = useState<ProvMin[]>([]);
  const [texto, setTexto] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [hi, setHi] = useState(0);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Alta con el formulario completo (null = cerrado).
  const [form, setForm] = useState<{ nombre: string; rubros: CategoriaProveedor[] } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { void cargarProveedores().then(setLista); }, []);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setAbierto(false);
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  const elegido = lista.find((p) => p.id === value) ?? null;
  const resultados = useMemo(() => {
    const activos = lista.filter((p) => p.activo);
    const r = texto.trim()
      ? buscar(activos, texto, (p) => ({ principal: nombreProveedor(p), otros: [p.nombre, p.contacto], codigos: [p.ruc] }))
      : activos;
    return r.slice(0, 8);
  }, [lista, texto]);
  const exacto = resultados.some((p) => nombreProveedor(p).toLowerCase() === texto.trim().toLowerCase() || p.nombre.toLowerCase() === texto.trim().toLowerCase());
  const puedeCrear = permitirCrear && !exacto;
  const opciones = resultados.length + (puedeCrear ? 1 : 0);

  function elegir(p: ProvMin) {
    onChange(p.id, nombreProveedor(p));
    setTexto("");
    setAbierto(false);
  }

  async function crear() {
    setCreando(true);
    setError(null);
    try {
      const r = await apiFetchCache<{ categorias: CategoriaProveedor[] }>("/api/proveedores/categorias").catch(() => ({ categorias: [] }));
      setForm({ nombre: texto.trim(), rubros: r.categorias ?? [] });
      setAbierto(false);
    } finally {
      setCreando(false);
    }
  }

  async function creado(id: string) {
    setForm(null);
    const nuevos = await cargarProveedores(true);
    setLista(nuevos);
    const p = nuevos.find((x) => x.id === id);
    onChange(id, p ? nombreProveedor(p) : null);
    setTexto("");
  }

  const modal = form ? (
    <ProveedorForm categorias={form.rubros} nombreInicial={form.nombre} onClose={() => setForm(null)} onSaved={(id) => void creado(id)} />
  ) : null;

  if (elegido) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2">
        {modal}
        <Truck className="h-4 w-4 shrink-0 text-slate-400" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-800">{nombreProveedor(elegido)}</p>
          {elegido.ruc ? <p className="font-mono text-[11px] text-slate-400">RUC {elegido.ruc}</p> : null}
        </div>
        <button type="button" onClick={() => onChange(null, null)} aria-label="Quitar proveedor" className="flex shrink-0 items-center justify-center rounded-lg p-1 text-slate-400 hover:bg-white hover:text-slate-700 max-sm:-my-2 max-sm:-mr-2 max-sm:h-11 max-sm:w-11">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <input
        value={texto}
        onChange={(e) => { setTexto(e.target.value); setAbierto(true); setHi(0); }}
        onFocus={() => setAbierto(true)}
        onKeyDown={(e) => {
          if (!abierto) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, opciones - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") {
            e.preventDefault();
            if (hi < resultados.length && resultados[hi]) elegir(resultados[hi]);
            else if (puedeCrear) void crear();
          } else if (e.key === "Escape") setAbierto(false);
        }}
        placeholder={placeholder}
        className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]"
      />
      {abierto && opciones > 0 ? (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {resultados.map((p, i) => (
            <li key={p.id}>
              <button type="button" onMouseEnter={() => setHi(i)} onClick={() => elegir(p)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm max-sm:min-h-11 ${hi === i ? "bg-[var(--brand-50)]" : ""}`}>
                <span className="min-w-0 truncate font-medium text-slate-800">{nombreProveedor(p)}</span>
                {p.ruc ? <span className="shrink-0 font-mono text-[11px] text-slate-400">{p.ruc}</span> : null}
              </button>
            </li>
          ))}
          {puedeCrear ? (
            <li>
              <button type="button" onMouseEnter={() => setHi(resultados.length)} onClick={() => void crear()} disabled={creando}
                className={`flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-left text-sm font-semibold text-[var(--brand)] max-sm:min-h-11 [overflow-wrap:anywhere] ${hi === resultados.length ? "bg-[var(--brand-50)]" : ""}`}>
                {creando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {texto.trim() ? <>Crear proveedor «{texto.trim()}»</> : "Nuevo proveedor"}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
      {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : null}
      {modal}
    </div>
  );
}
