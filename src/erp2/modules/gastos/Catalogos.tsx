"use client";

/**
 * Catálogos de Gastos empresariales (modal con pestañas, solo ADMIN):
 *   · Categorías     rubros › subcategorías (fijo/variable, IVA deducible, personal). Desactivar
 *                    no borra: los gastos viejos conservan su categoría.
 *   · Empleados      nombre, CI, cargo y sucursal (para las líneas de sueldos / IPS / aguinaldo).
 *   · Cuentas bancarias  cuentas PROPIAS de donde salen transferencias, cheques y tarjetas.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, X } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { invalidar } from "@/erp2/lib/api/cache-cliente";
import { ALTO_MAX_MODAL, CapaModal } from "@/erp2/components/CapaModal";
import { ScrollHorizontal } from "@/erp2/components/ScrollHorizontal";
import { Select } from "@/erp2/components/Select";
import { TablaTarjetas } from "@/erp2/components/TablaResponsive";
import { URL_CATALOGOS, nombreCuenta, type Catalogos, type CuentaBancaria, type Empleado, type Rubro, type Subcategoria } from "@/erp2/modules/gastos/tipos";

const INPUT = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 max-sm:py-2.5 text-sm text-slate-800 outline-none transition focus:border-[var(--brand-400)] focus:ring-2 focus:ring-[var(--brand-400)]/20";
const LABEL = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500";
type Pestana = "categorias" | "empleados" | "cuentas";
/** Ícono de editar: chico en escritorio, 44 × 44 al dedo en celular. */
const BTN_ICONO = "inline-flex shrink-0 items-center justify-center rounded-lg p-1 text-slate-400 hover:text-slate-700 max-sm:h-11 max-sm:w-11";
const BTN_AGREGAR = "inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-[var(--brand)] hover:bg-slate-50 max-sm:min-h-11 max-sm:px-3";
/** Botones de los editores en línea (Cancelar / Guardar): en celular 44 px y se reparten el ancho. */
const BTN_ED = "max-sm:min-h-11 max-sm:flex-1 max-sm:justify-center max-sm:text-sm";
const CHECK = "flex items-center gap-1.5 text-xs text-slate-600 max-sm:min-h-11 max-sm:text-sm";

export function CatalogosGastos({ inicial = "categorias", onClose, onCambio }: { inicial?: Pestana; onClose: () => void; onCambio?: () => void }) {
  const [tab, setTab] = useState<Pestana>(inicial);
  const [cat, setCat] = useState<Catalogos | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    apiFetch<Catalogos>(`${URL_CATALOGOS}?todas=1`).then(setCat).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const guardado = () => { invalidar(URL_CATALOGOS); cargar(); onCambio?.(); };

  return (
    <CapaModal onClose={onClose}>
      <div className={`flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${ALTO_MAX_MODAL}`} style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
          <h2 className="text-lg font-semibold text-slate-800">Catálogos de gastos</h2>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
        </div>
        {/* Pestañas: si no entran (celular), scroll horizontal interno */}
        <div className="shrink-0 border-b border-slate-100 px-2 sm:px-6">
          <ScrollHorizontal role="tablist" ariaLabel="Catálogos" dependencias={[tab]}>
            {([["categorias", "Categorías"], ["empleados", "Empleados"], ["cuentas", "Cuentas bancarias"]] as const).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`relative shrink-0 whitespace-nowrap px-3 py-2.5 text-sm font-medium max-sm:min-h-11 ${tab === k ? "text-[var(--brand)]" : "text-slate-500 hover:text-slate-800"}`}>
                {l}<span className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full ${tab === k ? "bg-[var(--brand-400)]" : ""}`} />
              </button>
            ))}
          </ScrollHorizontal>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {error ? <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
          {!cat ? <p className="py-10 text-center text-sm text-slate-400">Cargando…</p>
            : tab === "categorias" ? <TabCategorias rubros={cat.rubros} onGuardado={guardado} onError={setError} />
            : tab === "empleados" ? <TabEmpleados empleados={cat.empleados} sucursales={cat.sucursales} onGuardado={guardado} onError={setError} />
            : <TabCuentas cuentas={cat.cuentas_bancarias} bancos={cat.bancos} onGuardado={guardado} onError={setError} />}
        </div>
      </div>
    </CapaModal>
  );
}

async function guardar(url: string, body: unknown, onGuardado: () => void, onError: (e: string | null) => void) {
  onError(null);
  try {
    await apiFetch(url, { method: "POST", body: JSON.stringify(body) });
    onGuardado();
    return true;
  } catch (e) {
    onError((e as Error).message);
    return false;
  }
}

// ── Categorías ───────────────────────────────────────────────────────────────
type EdCat = { id?: string; nombre: string; padre_id: string | null; tipo_costo: "fijo" | "variable"; deducible_iva: boolean; activo: boolean };

function TabCategorias({ rubros, onGuardado, onError }: { rubros: Rubro[]; onGuardado: () => void; onError: (e: string | null) => void }) {
  const [ed, setEd] = useState<EdCat | null>(null);
  const [busy, setBusy] = useState(false);
  async function ok() {
    if (!ed || busy) return;
    setBusy(true);
    if (await guardar("/api/gastos/categorias", ed, onGuardado, onError)) setEd(null);
    setBusy(false);
  }
  const editor = (
    <EditorCat ed={ed!} setEd={setEd} busy={busy} onOk={() => void ok()} />
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">Cada gasto se carga en una subcategoría. Los rubros agrupan para el resumen y el presupuesto.</p>
        <button onClick={() => setEd({ nombre: "", padre_id: null, tipo_costo: "variable", deducible_iva: true, activo: true })}
          className={`${BTN_AGREGAR}`}><Plus className="h-3.5 w-3.5" /> Rubro</button>
      </div>
      {ed && !ed.id && ed.padre_id === null ? editor : null}
      {rubros.map((r) => (
        <div key={r.id} className={`rounded-xl border border-slate-200 ${r.activo ? "" : "opacity-60"}`}>
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-3 py-2 max-sm:py-0.5 max-sm:pr-1">
            <p className="min-w-0 text-sm font-semibold text-slate-800 [overflow-wrap:anywhere]">{r.nombre}{!r.activo ? <span className="ml-2 text-[11px] font-normal text-slate-400">inactivo</span> : null}</p>
            <div className="flex shrink-0 gap-1">
              <button onClick={() => setEd({ id: r.id, nombre: r.nombre, padre_id: null, tipo_costo: "variable", deducible_iva: true, activo: r.activo })} aria-label={`Editar ${r.nombre}`}
                className={`${BTN_ICONO} hover:bg-white`}><Pencil className="h-3.5 w-3.5" /></button>
              <button onClick={() => setEd({ nombre: "", padre_id: r.id, tipo_costo: "variable", deducible_iva: !r.es_personal, activo: true })}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-semibold text-[var(--brand)] hover:bg-white max-sm:min-h-11"><Plus className="h-3.5 w-3.5" /> Subcategoría</button>
            </div>
          </div>
          {ed?.id === r.id ? <div className="p-2">{editor}</div> : null}
          <ul className="divide-y divide-slate-100">
            {r.subcategorias.map((s: Subcategoria) => (
              <li key={s.id} className={`px-3 py-1.5 max-sm:py-0 max-sm:pr-1 ${s.activo ? "" : "opacity-50"}`}>
                {ed?.id === s.id ? <div className="max-sm:-ml-2 max-sm:py-2">{editor}</div> : (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-slate-700">{s.nombre}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${s.tipo_costo === "fijo" ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-500"}`}>{s.tipo_costo === "fijo" ? "Fijo" : "Variable"}</span>
                    {!s.deducible_iva ? <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">No deducible</span> : null}
                    {s.usos ? <span className="shrink-0 text-[11px] text-slate-400 max-[400px]:hidden">{s.usos} usos</span> : null}
                    <button onClick={() => setEd({ id: s.id, nombre: s.nombre, padre_id: r.id, tipo_costo: s.tipo_costo, deducible_iva: s.deducible_iva, activo: s.activo })} aria-label={`Editar ${s.nombre}`}
                      className={`${BTN_ICONO} hover:bg-slate-50`}><Pencil className="h-3.5 w-3.5" /></button>
                  </div>
                )}
              </li>
            ))}
            {ed && !ed.id && ed.padre_id === r.id ? <li className="p-2">{editor}</li> : null}
          </ul>
        </div>
      ))}
    </div>
  );
}

function EditorCat({ ed, setEd, busy, onOk }: { ed: EdCat; setEd: (e: EdCat | null) => void; busy: boolean; onOk: () => void }) {
  const esRubro = ed.padre_id === null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--brand-400)]/40 bg-[var(--brand-400)]/5 p-2 max-sm:gap-x-3">
      <input autoFocus className={`${INPUT} min-w-[12rem] flex-1 max-sm:min-w-0 max-sm:basis-full`} enterKeyHint="done" placeholder={esRubro ? "Nombre del rubro" : "Nombre de la subcategoría"} value={ed.nombre}
        onChange={(e) => setEd({ ...ed, nombre: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") onOk(); if (e.key === "Escape") setEd(null); }} />
      {!esRubro ? (
        <>
          <Select value={ed.tipo_costo} onChange={(v) => setEd({ ...ed, tipo_costo: v as "fijo" | "variable" })} compacto etiqueta="Tipo de costo" options={[["variable", "Variable"], ["fijo", "Fijo"]]} />
          <label className={CHECK}>
            <input type="checkbox" checked={ed.deducible_iva} onChange={(e) => setEd({ ...ed, deducible_iva: e.target.checked })} className="accent-[var(--brand-400)] max-sm:h-5 max-sm:w-5" /> IVA deducible
          </label>
        </>
      ) : null}
      {ed.id ? (
        <label className={CHECK}>
          <input type="checkbox" checked={ed.activo} onChange={(e) => setEd({ ...ed, activo: e.target.checked })} className="accent-[var(--brand-400)] max-sm:h-5 max-sm:w-5" /> Activa
        </label>
      ) : null}
      <div className="contents max-sm:flex max-sm:basis-full max-sm:gap-2">
        <button onClick={() => setEd(null)} className={`rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-white max-sm:border max-sm:border-slate-200 max-sm:bg-white ${BTN_ED}`}>Cancelar</button>
        <button onClick={onOk} disabled={busy || ed.nombre.trim().length < 2} className={`inline-flex items-center gap-1 rounded-lg bg-[var(--brand-400)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--brand)] disabled:opacity-50 ${BTN_ED}`}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Guardar
        </button>
      </div>
    </div>
  );
}

// ── Empleados ────────────────────────────────────────────────────────────────
function TabEmpleados({ empleados, sucursales, onGuardado, onError }: {
  empleados: Empleado[]; sucursales: { id: string; nombre: string }[]; onGuardado: () => void; onError: (e: string | null) => void;
}) {
  const vacio = { id: undefined as string | undefined, nombre: "", ci: "", cargo: "", sucursal_id: "", activo: true };
  const [ed, setEd] = useState<typeof vacio | null>(null);
  const [busy, setBusy] = useState(false);
  async function ok() {
    if (!ed || busy) return;
    setBusy(true);
    if (await guardar("/api/gastos/empleados", { ...ed, sucursal_id: ed.sucursal_id || null, ci: ed.ci || null, cargo: ed.cargo || null }, onGuardado, onError)) setEd(null);
    setBusy(false);
  }
  const nombreSuc = (id: string | null) => sucursales.find((s) => s.id === id)?.nombre ?? "—";
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">Para imputar sueldos, IPS patronal y aguinaldo por persona. Sin liquidación de IPS: se carga como gasto.</p>
        <button onClick={() => setEd({ ...vacio })} className={BTN_AGREGAR}><Plus className="h-3.5 w-3.5" /> Empleado</button>
      </div>
      {ed ? (
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-[var(--brand-400)]/40 bg-[var(--brand-400)]/5 p-3 sm:grid-cols-4">
          <div className="col-span-2"><label className={LABEL}>Nombre *</label><input autoFocus className={INPUT} enterKeyHint="next" value={ed.nombre} onChange={(e) => setEd({ ...ed, nombre: e.target.value })} /></div>
          <div className="min-w-0"><label className={LABEL}>CI</label><input className={INPUT} inputMode="numeric" enterKeyHint="next" value={ed.ci} onChange={(e) => setEd({ ...ed, ci: e.target.value })} /></div>
          <div className="min-w-0"><label className={LABEL}>Cargo</label><input className={INPUT} enterKeyHint="done" value={ed.cargo} onChange={(e) => setEd({ ...ed, cargo: e.target.value })} /></div>
          <div className="col-span-2"><label className={LABEL}>Sucursal</label>
            <Select value={ed.sucursal_id} onChange={(v) => setEd({ ...ed, sucursal_id: v })} block etiqueta="Sucursal" options={[["", "(Sin sucursal fija)"], ...sucursales.map((s): [string, string] => [s.id, s.nombre])]} />
          </div>
          <div className="col-span-2 flex flex-wrap items-end justify-end gap-2">
            {ed.id ? <label className={`mr-auto ${CHECK} max-sm:basis-full`}><input type="checkbox" checked={ed.activo} onChange={(e) => setEd({ ...ed, activo: e.target.checked })} className="accent-[var(--brand-400)] max-sm:h-5 max-sm:w-5" /> Activo</label> : null}
            <button onClick={() => setEd(null)} className={`rounded-lg px-3 py-2 text-xs text-slate-500 hover:bg-white max-sm:border max-sm:border-slate-200 max-sm:bg-white ${BTN_ED}`}>Cancelar</button>
            <button onClick={() => void ok()} disabled={busy || ed.nombre.trim().length < 2} className={`inline-flex items-center gap-1 rounded-lg bg-[var(--brand-400)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--brand)] disabled:opacity-50 ${BTN_ED}`}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Guardar
            </button>
          </div>
        </div>
      ) : null}
      {/* Tabla en ≥ 768 px; en celular, una tarjeta por empleado (nombre, cargo, CI y sucursal) */}
      <TablaTarjetas
        filas={empleados}
        claveFila={(e) => e.id}
        vacio={<p className="py-6 text-center text-sm text-slate-400">Todavía no cargaste empleados.</p>}
        claseThead=""
        thBase="pb-2 pr-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400"
        tdBase="py-1.5 pr-3"
        claseFila={(e) => (e.activo ? "" : "opacity-50")}
        columnas={[
          { key: "nombre", titulo: "Nombre", claseTd: "text-slate-800", movil: "titulo", celda: (e) => e.nombre },
          { key: "ci", titulo: "CI", claseTd: "font-mono text-xs text-slate-500", movil: "dato", celda: (e) => e.ci ?? "—" },
          { key: "cargo", titulo: "Cargo", claseTd: "text-slate-600", movil: "subtitulo", celda: (e) => e.cargo ?? "—", celdaMovil: (e) => e.cargo ?? "Sin cargo" },
          { key: "sucursal", titulo: "Sucursal", claseTd: "text-slate-600", movil: "dato", celda: (e) => nombreSuc(e.sucursal_id) },
          {
            key: "editar", titulo: "", claseTd: "pr-0 text-right", movil: "acciones",
            celda: (e) => (
              <button onClick={() => setEd({ id: e.id, nombre: e.nombre, ci: e.ci ?? "", cargo: e.cargo ?? "", sucursal_id: e.sucursal_id ?? "", activo: e.activo })} aria-label={`Editar ${e.nombre}`}
                className={`${BTN_ICONO} hover:bg-slate-50`}><Pencil className="h-3.5 w-3.5" /></button>
            ),
          },
        ]}
      />
    </div>
  );
}

// ── Cuentas bancarias ────────────────────────────────────────────────────────
function TabCuentas({ cuentas, bancos, onGuardado, onError }: {
  cuentas: CuentaBancaria[]; bancos: { id: string; nombre: string }[]; onGuardado: () => void; onError: (e: string | null) => void;
}) {
  const vacio = { id: undefined as string | undefined, banco_id: bancos[0]?.id ?? "", banco_nombre: "", numero: "", moneda: "GS" as "GS" | "USD", titular: "", alias: "", activa: true };
  const [ed, setEd] = useState<typeof vacio | null>(null);
  const [busy, setBusy] = useState(false);
  async function ok() {
    if (!ed || busy) return;
    setBusy(true);
    const body = { ...ed, banco_id: ed.banco_id && ed.banco_id !== "__otro__" ? ed.banco_id : null, banco_nombre: ed.banco_id === "__otro__" || !ed.banco_id ? ed.banco_nombre : null,
      titular: ed.titular || null, alias: ed.alias || null };
    if (await guardar("/api/gastos/cuentas-bancarias", body, onGuardado, onError)) setEd(null);
    setBusy(false);
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">Las cuentas de la empresa: de dónde sale una transferencia, un cheque o un pago con tarjeta.</p>
        <button onClick={() => setEd({ ...vacio })} className={BTN_AGREGAR}><Plus className="h-3.5 w-3.5" /> Cuenta</button>
      </div>
      {ed ? (
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-[var(--brand-400)]/40 bg-[var(--brand-400)]/5 p-3 sm:grid-cols-4">
          <div className="col-span-2"><label className={LABEL}>Banco o entidad *</label>
            <Select value={ed.banco_id} onChange={(v) => setEd({ ...ed, banco_id: v })} block etiqueta="Banco o entidad" options={[...bancos.filter((b) => b.nombre !== "Otro").map((b): [string, string] => [b.id, b.nombre]), ["__otro__", "Otra entidad…"]]} />
          </div>
          {ed.banco_id === "__otro__" || !ed.banco_id ? (
            <div className="col-span-2"><label className={LABEL}>Nombre de la entidad *</label><input className={INPUT} enterKeyHint="next" value={ed.banco_nombre} onChange={(e) => setEd({ ...ed, banco_nombre: e.target.value })} /></div>
          ) : <div className="hidden sm:col-span-2 sm:block" />}
          <div className="col-span-2"><label className={LABEL}>Número de cuenta *</label><input autoFocus className={`${INPUT} font-mono`} enterKeyHint="next" value={ed.numero} onChange={(e) => setEd({ ...ed, numero: e.target.value })} /></div>
          <div className="min-w-0"><label className={LABEL}>Moneda</label><Select value={ed.moneda} onChange={(v) => setEd({ ...ed, moneda: v as "GS" | "USD" })} block etiqueta="Moneda" options={[["GS", "Guaraníes"], ["USD", "Dólares"]]} /></div>
          <div className="min-w-0"><label className={LABEL}>Alias</label><input className={INPUT} enterKeyHint="next" placeholder="Operativa" value={ed.alias} onChange={(e) => setEd({ ...ed, alias: e.target.value })} /></div>
          <div className="col-span-2"><label className={LABEL}>Titular</label><input className={INPUT} enterKeyHint="done" value={ed.titular} onChange={(e) => setEd({ ...ed, titular: e.target.value })} /></div>
          <div className="col-span-2 flex flex-wrap items-end justify-end gap-2">
            {ed.id ? <label className={`mr-auto ${CHECK} max-sm:basis-full`}><input type="checkbox" checked={ed.activa} onChange={(e) => setEd({ ...ed, activa: e.target.checked })} className="accent-[var(--brand-400)] max-sm:h-5 max-sm:w-5" /> Activa</label> : null}
            <button onClick={() => setEd(null)} className={`rounded-lg px-3 py-2 text-xs text-slate-500 hover:bg-white max-sm:border max-sm:border-slate-200 max-sm:bg-white ${BTN_ED}`}>Cancelar</button>
            <button onClick={() => void ok()} disabled={busy || !ed.numero.trim()} className={`inline-flex items-center gap-1 rounded-lg bg-[var(--brand-400)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--brand)] disabled:opacity-50 ${BTN_ED}`}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Guardar
            </button>
          </div>
        </div>
      ) : null}
      {cuentas.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">Todavía no cargaste cuentas bancarias.</p> : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {cuentas.map((c) => (
            <li key={c.id} className={`flex items-center gap-2 px-3 py-2 text-sm max-sm:py-0.5 max-sm:pr-1 ${c.activa ? "" : "opacity-50"}`}>
              <span className="min-w-0 flex-1 text-slate-700 max-sm:py-1.5 max-sm:[overflow-wrap:anywhere] sm:truncate">
                {nombreCuenta(c)}
                {c.titular ? <span className="block text-xs text-slate-400 sm:hidden">{c.titular}</span> : null}
              </span>
              {c.titular ? <span className="hidden text-xs text-slate-400 sm:inline">{c.titular}</span> : null}
              <button onClick={() => setEd({ id: c.id, banco_id: c.banco_id ?? "__otro__", banco_nombre: c.banco_nombre, numero: c.numero, moneda: c.moneda, titular: c.titular ?? "", alias: c.alias ?? "", activa: c.activa })}
                aria-label="Editar cuenta" className={`${BTN_ICONO} hover:bg-slate-50`}><Pencil className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
