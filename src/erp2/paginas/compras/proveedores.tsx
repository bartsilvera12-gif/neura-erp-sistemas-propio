"use client";

/**
 * /proveedores — maestro de proveedores (Fase 1 de Compras, portado de Ferretería).
 * Lista con búsqueda inteligente (nombre, RUC, vendedor, teléfono, rubro…), filtro por
 * rubro e inactivos, exportar a Excel y panel lateral para crear/editar. Un proveedor
 * con compras registradas no se borra: se desactiva.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ALTO_MAX_MODAL, CapaModal } from "@/erp2/components/CapaModal";
import { Ban, CheckCircle2, Download, Loader2, MoreHorizontal, Pencil, Plus, ReceiptText, Search, Trash2, Truck, Upload, X } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { apiFetchCache, invalidar } from "@/erp2/lib/api/cache-cliente";
import { invalidarProveedores } from "@/erp2/modules/proveedores/cache";
import { useUsuario } from "@/erp2/lib/sesion/ContextoUsuario";
import { descargarArchivo } from "@/erp2/lib/api/client-blob";
import { buscar } from "@/erp2/lib/busqueda";
import { clienteConfig } from "@/erp2/cliente.config";
import { Select } from "@/erp2/components/Select";
import { MenuAcciones } from "@/erp2/components/MenuAcciones";
import { AccionesPagina, BarraFiltros, EncabezadoPagina } from "@/erp2/components/EncabezadoPagina";
import { TablaTarjetas, type ColumnaTabla } from "@/erp2/components/TablaResponsive";
import { ProveedorForm } from "@/erp2/modules/proveedores/ProveedorForm";
import { EstadoCuentaProveedor } from "@/erp2/modules/proveedores/EstadoCuentaProveedor";
import { ExcelImportWizard } from "@/erp2/modules/inventario/ExcelImportWizard";
import { condicionTexto, nombreProveedor, type CategoriaProveedor, type Proveedor } from "@/erp2/modules/proveedores/tipos";
import { TZ_PY } from "@/erp2/lib/fecha/paraguay";

const TEAL = clienteConfig.color;
const fechaCorta = (iso: string) => new Date(iso).toLocaleDateString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "short", year: "numeric" });

export default function ProveedoresPage() {
  const [lista, setLista] = useState<Proveedor[]>([]);
  const [categorias, setCategorias] = useState<CategoriaProveedor[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const esAdmin = useUsuario()?.rol === "ADMIN";
  const [busqueda, setBusqueda] = useState("");
  const [rubro, setRubro] = useState("");
  const [verInactivos, setVerInactivos] = useState(false);
  const [form, setForm] = useState<{ open: boolean; prov: Proveedor | null }>({ open: false, prov: null });
  const [borrando, setBorrando] = useState<Proveedor | null>(null);
  const [cuenta, setCuenta] = useState<Proveedor | null>(null);
  const [exportando, setExportando] = useState(false);
  const [importando, setImportando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([
        apiFetch<{ proveedores: Proveedor[] }>("/api/proveedores"),
        apiFetchCache<{ categorias: CategoriaProveedor[] }>("/api/proveedores/categorias"),
      ]);
      setLista(p.proveedores);
      setCategorias(c.categorias);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function cambiarEstado(p: Proveedor) {
    setError(null);
    try {
      await apiFetch(`/api/proveedores/${p.id}`, { method: "PATCH", body: JSON.stringify({ activo: !p.activo }) });
      invalidarProveedores();
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const visibles = useMemo(() => {
    const base = lista.filter((p) => (verInactivos || p.activo) && (!rubro || p.categorias.some((c) => c.id === rubro)));
    // Búsqueda inteligente: sin tildes, errores de tipeo, RUC con o sin guion.
    return buscar(base, busqueda, (p) => ({
      principal: nombreProveedor(p),
      otros: [p.nombre, p.contacto, p.ciudad, p.email, ...p.categorias.map((c) => c.nombre)],
      codigos: [p.ruc, p.telefono, p.contacto_telefono],
    }));
  }, [lista, busqueda, rubro, verInactivos]);

  const activos = lista.filter((p) => p.activo).length;
  const inactivos = lista.length - activos;

  async function exportar() {
    setExportando(true);
    try {
      await descargarArchivo("/api/proveedores/export", "proveedores.xlsx");
    } catch {
      /* best-effort */
    } finally {
      setExportando(false);
    }
  }

  const accionesFila = (p: Proveedor) => {
    const nombre = nombreProveedor(p);
    return (
      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => setCuenta(p)} title="Estado de cuenta" className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 max-md:px-3.5 max-md:text-[13px]">
          <ReceiptText className="h-3.5 w-3.5" /> Estado de cuenta
        </button>
        {esAdmin ? (
          <MenuAcciones
            etiqueta={`Acciones de ${nombre}`}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            items={[
              { etiqueta: "Editar", icono: <Pencil className="h-4 w-4" />, onClick: () => setForm({ open: true, prov: p }) },
              p.activo
                ? { etiqueta: "Desactivar", icono: <Ban className="h-4 w-4" />, onClick: () => cambiarEstado(p), tono: "peligro" }
                : { etiqueta: "Activar", icono: <CheckCircle2 className="h-4 w-4" />, onClick: () => cambiarEstado(p), tono: "exito" },
              ...(p.compras === 0 ? [{ etiqueta: "Eliminar", icono: <Trash2 className="h-4 w-4" />, onClick: () => setBorrando(p), tono: "peligro" as const }] : []),
            ]}
          >
            <MoreHorizontal className="h-5 w-5" />
          </MenuAcciones>
        ) : null}
      </div>
    );
  };

  const condicion = (p: Proveedor) => (
    <>
      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${p.condicion_pago === "credito" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{condicionTexto(p)}</span>
      {p.moneda === "USD" ? <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">USD</span> : null}
    </>
  );
  const rubros = (p: Proveedor) => (
    <div className="flex flex-wrap gap-1">
      {p.categorias.length ? p.categorias.map((c) => (
        <span key={c.id} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{c.nombre}</span>
      )) : <span className="text-xs text-slate-400">—</span>}
    </div>
  );

  // Tabla en ≥ 768 px; en celular cada proveedor es una tarjeta (tocar = editar, si sos admin).
  const columnas: ColumnaTabla<Proveedor>[] = [
    {
      key: "proveedor", titulo: "Proveedor", movil: "titulo", claseTh: "pl-5", claseTd: "pl-5",
      celda: (p) => {
        const nombre = nombreProveedor(p);
        return (
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ backgroundColor: `${TEAL}1a`, color: TEAL }}>
              {nombre.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 max-w-[18rem] xl:max-w-[24rem]">
              <p className="truncate font-bold text-slate-900">
                {nombre}
                {!p.activo ? <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-slate-500">Inactivo</span> : null}
              </p>
              {p.nombre_comercial && p.nombre_comercial.trim() !== p.nombre ? <p className="truncate text-[11px] text-slate-500">{p.nombre}</p> : null}
            </div>
          </div>
        );
      },
      celdaMovil: (p) => (
        <>
          {nombreProveedor(p)}
          {!p.activo ? <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-slate-500">Inactivo</span> : null}
          {p.nombre_comercial && p.nombre_comercial.trim() !== p.nombre ? <span className="block text-[12px] font-normal text-slate-500">{p.nombre}</span> : null}
        </>
      ),
    },
    { key: "ruc", titulo: "RUC", movil: "subtitulo", claseTd: "whitespace-nowrap font-mono text-xs text-slate-600", celda: (p) => p.ruc ?? "—", celdaMovil: (p) => (p.ruc ? <span className="font-mono text-[12px]">RUC {p.ruc}</span> : null) },
    {
      key: "contacto", titulo: "Contacto", movil: "dato", claseTd: "whitespace-nowrap text-xs text-slate-600",
      celda: (p) => (
        <>
          <p>{p.contacto ?? (p.telefono ? "" : "—")}</p>
          <p className="text-slate-400">{p.contacto_telefono || p.telefono || ""}</p>
        </>
      ),
      celdaMovil: (p) => {
        const tel = p.contacto_telefono || p.telefono;
        return tel ? <a href={`tel:${tel}`} onClick={(e) => e.stopPropagation()} className="font-medium text-[var(--brand)] [@media(pointer:coarse)]:-my-3 [@media(pointer:coarse)]:inline-flex [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:items-center">{tel}</a> : p.contacto ?? null;
      },
    },
    { key: "condicion", titulo: "Condición", movil: "chip", celda: condicion },
    { key: "rubros", titulo: "Rubros", movil: "detalle", celda: rubros, celdaMovil: (p) => (p.categorias.length ? rubros(p) : "—") },
    {
      key: "compras", titulo: "Compras", movil: "dato", claseTh: "text-right", claseTd: "text-right",
      celda: (p) => (
        <>
          <p className="font-semibold tabular-nums text-slate-800">{p.compras}</p>
          {p.ultima_compra ? <p className="text-[11px] text-slate-400">última {fechaCorta(p.ultima_compra)}</p> : null}
        </>
      ),
      celdaMovil: (p) => `${p.compras} ${Number(p.compras) === 1 ? "compra" : "compras"}`,
    },
    { key: "acciones", titulo: "", movil: "acciones", claseTh: "w-px pr-5", claseTd: "pr-5", celda: accionesFila },
  ];

  const filtrosActivos = (rubro ? 1 : 0) + (verInactivos ? 1 : 0);
  const conteo = <>{visibles.length} de {verInactivos ? lista.length : activos}</>;

  return (
    <div className="space-y-4 pb-10 sm:space-y-6">
      <EncabezadoPagina
        titulo="Proveedores"
        subtitulo="A quién le comprás: datos de contacto, rubros y condiciones de pago."
        acciones={
          <AccionesPagina acciones={[
            { etiqueta: "Exportar Excel", icono: <Download />, onClick: () => void exportar(), cargando: exportando, deshabilitada: lista.length === 0 },
            ...(esAdmin ? [
              { etiqueta: "Importar Excel", icono: <Upload />, onClick: () => setImportando(true) },
              { etiqueta: "Nuevo proveedor", icono: <Plus />, onClick: () => setForm({ open: true, prov: null }), primaria: true },
            ] : []),
          ]} />
        }
      />

      {error ? (
        <div className="flex items-start justify-between gap-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span className="min-w-0 [overflow-wrap:anywhere]">{error}</span>
          <button onClick={() => setError(null)} aria-label="Cerrar" className="-m-1 flex shrink-0 items-center justify-center rounded-lg p-1 text-rose-400 hover:text-rose-600 max-sm:-m-3 max-sm:h-11 max-sm:w-11"><X className="h-4 w-4" /></button>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-3 py-3 sm:px-5">
          <BarraFiltros
            plano
            activos={filtrosActivos}
            onLimpiar={() => { setRubro(""); setVerInactivos(false); }}
            busqueda={
              <div className="relative md:min-w-[240px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre, RUC, vendedor, teléfono o rubro…" aria-label="Buscar proveedores" enterKeyHint="search"
                  className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)] max-md:h-11 max-md:py-0" />
              </div>
            }
            extra={<p className="shrink-0 text-xs text-slate-500 max-md:hidden">{conteo}</p>}
          >
            {categorias.length || inactivos > 0 ? (
              <>
                {categorias.length ? (
                  <Select value={rubro} onChange={setRubro} minWidth={170} etiqueta="Rubro" options={[["", "Todos los rubros"], ...categorias.map((c): [string, string] => [c.id, c.nombre])]} />
                ) : null}
                {inactivos > 0 ? (
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600 max-md:min-h-11 max-md:text-sm">
                    <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} className="h-4 w-4 accent-[var(--brand)] max-md:h-5 max-md:w-5" />
                    Ver inactivos ({inactivos})
                  </label>
                ) : null}
              </>
            ) : undefined}
          </BarraFiltros>
          <p className="mt-2 px-1 text-xs text-slate-500 md:hidden">{conteo} proveedores</p>
        </div>

        {cargando ? (
          <p className="px-5 py-12 text-center text-sm text-slate-400">Cargando…</p>
        ) : lista.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <Truck className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-medium text-slate-700">Todavía no cargaste proveedores</p>
            <p className="mt-1 text-xs text-slate-500">Cargalos para registrar a quién le comprás y a qué precio.</p>
            {esAdmin ? (
              <button onClick={() => setForm({ open: true, prov: null })} className="mt-4 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white max-sm:min-h-11" style={{ backgroundColor: TEAL }}>
                <Plus className="h-4 w-4" /> Nuevo proveedor
              </button>
            ) : null}
          </div>
        ) : (
          <TablaTarjetas
            filas={visibles}
            columnas={columnas}
            claveFila={(p) => p.id}
            onFila={esAdmin ? (p) => setForm({ open: true, prov: p }) : undefined}
            claseFila={(p) => (p.activo ? "" : "opacity-60")}
            minAncho={820}
            claseTabla="w-full text-left text-sm"
            claseThead="border-b-2 border-[var(--brand-100)] bg-[var(--brand-50)]"
            thBase="whitespace-nowrap px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[var(--brand)]"
            tdBase="px-3 py-3"
            vacio={<p className="px-5 py-12 text-center text-sm text-slate-400">Ningún proveedor coincide con la búsqueda.</p>}
          />
        )}
      </section>

      {form.open ? (
        <ProveedorForm
          proveedor={form.prov}
          categorias={categorias}
          onClose={() => setForm({ open: false, prov: null })}
          onSaved={() => { setForm({ open: false, prov: null }); invalidar("/api/proveedores/categorias"); void cargar(); }}
        />
      ) : null}

      {importando ? (
        <ExcelImportWizard
          entidad="proveedores"
          previewUrl="/api/proveedores/importar/preview"
          commitUrl="/api/proveedores/importar/commit"
          templateUrl="/api/proveedores/importar/plantilla"
          etiquetas={{ INSERT: "Nuevo", UPDATE: "Actualiza", SKIP: "Sin cambios", ERROR: "Error" }}
          textoConfirmar={(s) => {
            const n = s.insertar + s.actualizar;
            return `Importar ${n.toLocaleString("es-PY")} ${n === 1 ? "proveedor" : "proveedores"}`;
          }}
          onClose={() => setImportando(false)}
          onCompleted={() => {
            invalidarProveedores();
            invalidar("/api/proveedores/categorias");
            void cargar();
          }}
        />
      ) : null}

      {cuenta ? (
        <EstadoCuentaProveedor proveedorId={cuenta.id} proveedorNombre={nombreProveedor(cuenta)} puedePagar={esAdmin} onClose={() => setCuenta(null)} />
      ) : null}

      {borrando ? (
        <ConfirmarBorrado
          nombre={nombreProveedor(borrando)}
          onCancelar={() => setBorrando(null)}
          onConfirmar={async () => {
            await apiFetch(`/api/proveedores/${borrando.id}`, { method: "DELETE" });
            invalidarProveedores();
            setBorrando(null);
            await cargar();
          }}
        />
      ) : null}
    </div>
  );
}

function ConfirmarBorrado({ nombre, onCancelar, onConfirmar }: { nombre: string; onCancelar: () => void; onConfirmar: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <CapaModal onClose={busy ? undefined : onCancelar} z="z-[120]" fondo="bg-slate-900/40 backdrop-blur-sm">
      <div onClick={(e) => e.stopPropagation()} className={`flex w-full max-w-sm ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`} style={{ animation: "rb-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <h3 className="shrink-0 px-6 pt-6 text-lg font-semibold text-slate-900">¿Eliminar a {nombre}?</h3>
        <div className="min-h-0 flex-1 overflow-y-auto px-6">
          <p className="mt-1 text-sm text-slate-500">No tiene compras registradas, así que se puede borrar. No se puede deshacer.</p>
          {error ? <p className="mt-3 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
        </div>
        <div className="flex shrink-0 justify-end gap-2 px-6 pt-5 pb-6">
          <button onClick={onCancelar} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 max-sm:flex-1">Cancelar</button>
          <button
            disabled={busy}
            onClick={async () => { setBusy(true); setError(null); try { await onConfirmar(); } catch (e) { setError((e as Error).message); setBusy(false); } }}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50 max-sm:flex-1"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Eliminar
          </button>
        </div>
      </div>
    </CapaModal>
  );
}
