"use client";

/**
 * Alta / edición de un gasto operativo (modal).
 *   · Proveedor con búsqueda (o alta al vuelo). Al elegirlo se completa lo ÚLTIMO que se usó con
 *     él (subcategoría, comprobante, timbrado, condición, medio, cuenta, sucursal) — se puede cambiar.
 *   · Con comprobante fiscal (tipo, número 001-001-0000001, timbrado) o SIN comprobante (propina,
 *     peaje, viático, sueldo): sin IVA discriminado y no deducible.
 *   · Sucursal (centro de costo) del gasto y, si hace falta, por línea ("Repartir por sucursal").
 *   · Moneda Gs. o USD con tipo de cambio.
 *   · Contado (medio + cuenta bancaria propia de origen; el efectivo sale de la caja abierta) o
 *     crédito (plazo y vencimiento → deuda en Pagos a proveedores).
 *   · Líneas con subcategoría (Rubro › Subcategoría), descripción, monto IVA incluido, IVA y, en
 *     las de personal, el empleado.
 *   · Varios adjuntos (se suben al guardar) y notas.
 * Atajos: Ctrl+Enter confirma · Ctrl+S guarda borrador · Alt+N agrega una línea.
 * La clave de idempotencia evita que un doble clic cree dos documentos.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Info, Loader2, Paperclip, Plus, Sparkles, Split, Trash2, X } from "lucide-react";
import { apiFetch, apiForm } from "@/erp2/lib/api/client-fetch";
import { apiFetchCache, invalidar } from "@/erp2/lib/api/cache-cliente";
import { hoyPY } from "@/erp2/lib/fecha/paraguay";
import { ALTO_MAX_MODAL, CapaModal } from "@/erp2/components/CapaModal";
import { Select } from "@/erp2/components/Select";
import MontoInput from "@/erp2/components/ui/MontoInput";
import { cargarProveedores } from "@/erp2/modules/proveedores/cache";
import type { ProveedorMin } from "@/erp2/modules/proveedores/tipos";
import { SelectorProveedor } from "@/erp2/modules/proveedores/SelectorProveedor";
import { ACCEPT_COMPROBANTE, tamano, validarComprobante } from "@/erp2/modules/compras/Comprobantes";
import {
  MEDIOS_PAGO_GASTO, TIPOS_COMPROBANTE, URL_CATALOGOS, formatComprobante, gs, indiceCategorias, ivaDe, monto, nombreCuenta,
  requiereTimbrado, usaCuentaBancaria,
  type Catalogos, type DetalleGasto, type IvaTipo, type MedioPagoGasto, type Moneda, type TipoPago,
} from "@/erp2/modules/gastos/tipos";
import { SelectorFecha } from "@/erp2/components/SelectorFecha";

const INPUT = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 max-sm:py-2.5 text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:border-[var(--brand-400)] focus:ring-2 focus:ring-[var(--brand-400)]/20 disabled:bg-slate-50 disabled:text-slate-400";
const LABEL = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500";

type Linea = { key: string; categoria_id: string | null; descripcion: string; monto: number; iva_tipo: IvaTipo; sucursal_id: string | null; empleado_id: string | null };
type Form = {
  proveedor_id: string | null;
  sucursal_id: string;
  con_comprobante: boolean;
  tipo_comprobante: string;
  numero_comprobante: string;
  timbrado: string;
  fecha_comprobante: string;
  moneda: Moneda;
  tipo_cambio: number;
  tipo_pago: TipoPago;
  plazo_dias: string;
  fecha_vencimiento: string;
  medio_pago: MedioPagoGasto | "";
  cuenta_bancaria_id: string;
  referencia_pago: string;
  descripcion: string;
  observacion: string;
  items: Linea[];
};

export type GastoHecho = { id: string; numero: string | null; confirmado: boolean; total: number; moneda: Moneda; credito: boolean; caja: boolean; avisoAdjunto: string | null };

let seq = 0;
const nuevaLinea = (suc: string | null = null): Linea => ({ key: `l${++seq}`, categoria_id: null, descripcion: "", monto: 0, iva_tipo: "10%", sucursal_id: suc, empleado_id: null });
const sumarDias = (ymd: string, dias: number) => {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
};
const formVacio = (suc = ""): Form => ({
  proveedor_id: null, sucursal_id: suc, con_comprobante: true, tipo_comprobante: "Factura", numero_comprobante: "", timbrado: "",
  fecha_comprobante: hoyPY(), moneda: "GS", tipo_cambio: 0, tipo_pago: "contado", plazo_dias: "", fecha_vencimiento: "",
  medio_pago: "transferencia", cuenta_bancaria_id: "", referencia_pago: "", descripcion: "", observacion: "", items: [nuevaLinea()],
});

export function FormGasto({ gastoId, onClose, onHecho }: {
  /** Borrador a editar (abrir y confirmar); sin id es un alta. */
  gastoId?: string | null;
  onClose: () => void;
  onHecho: () => void;
}) {
  const [form, setForm] = useState<Form>(() => formVacio());
  const [cat, setCat] = useState<Catalogos | null>(null);
  const [proveedores, setProveedores] = useState<ProveedorMin[]>([]);
  const [cargando, setCargando] = useState(!!gastoId);
  const [busy, setBusy] = useState<"" | "borrador" | "confirmar">("");
  const [error, setError] = useState<string | null>(null);
  const [archivos, setArchivos] = useState<File[]>([]);
  const [adjuntosActuales, setAdjuntosActuales] = useState<string[]>([]);
  const [hecho, setHecho] = useState<GastoHecho | null>(null);
  const [porLinea, setPorLinea] = useState(false);
  const [autocompletado, setAutocompletado] = useState<string | null>(null);
  const [nuevaSub, setNuevaSub] = useState<{ fila: number; rubro: string; nombre: string; tipo: "fijo" | "variable" } | null>(null);
  const [programado, setProgramado] = useState<{ recurrente: string | null; fecha: string | null } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [idem, setIdem] = useState(() => crypto.randomUUID());

  useEffect(() => {
    void cargarProveedores().then(setProveedores);
    apiFetchCache<Catalogos>(URL_CATALOGOS)
      .then((c) => {
        setCat(c);
        if (!gastoId) setForm((f) => (f.sucursal_id ? f : { ...f, sucursal_id: c.mi_sucursal_id ?? c.sucursales[0]?.id ?? "" }));
      })
      .catch((e) => setError((e as Error).message));
  }, [gastoId]);

  useEffect(() => {
    if (!gastoId) return;
    apiFetch<DetalleGasto>(`/api/gastos/${gastoId}`)
      .then(({ gasto: g, items, adjuntos }) => {
        const lineas = items.length
          ? items.map((i) => ({ key: `l${++seq}`, categoria_id: i.categoria_id, descripcion: i.descripcion, monto: Number(i.monto), iva_tipo: i.iva_tipo, sucursal_id: i.sucursal_id, empleado_id: i.empleado_id }))
          : [nuevaLinea()];
        setForm({
          proveedor_id: g.proveedor_id,
          sucursal_id: g.sucursal_id ?? "",
          con_comprobante: g.con_comprobante,
          tipo_comprobante: g.tipo_comprobante ?? "Factura",
          numero_comprobante: g.numero_comprobante ?? "",
          timbrado: g.timbrado ?? "",
          fecha_comprobante: g.fecha_comprobante ?? (g.fecha_programada && g.fecha_programada <= hoyPY() ? g.fecha_programada : hoyPY()),
          moneda: g.moneda,
          tipo_cambio: g.moneda === "USD" ? Number(g.tipo_cambio) : 0,
          tipo_pago: g.tipo_pago ?? "contado",
          plazo_dias: g.plazo_dias != null ? String(g.plazo_dias) : "",
          fecha_vencimiento: g.fecha_vencimiento ?? "",
          medio_pago: g.medio_pago ?? (g.tipo_pago === "credito" ? "" : "transferencia"),
          cuenta_bancaria_id: g.cuenta_bancaria_id ?? "",
          referencia_pago: g.referencia_pago ?? "",
          descripcion: g.descripcion ?? "",
          observacion: g.observacion ?? "",
          items: lineas,
        });
        setPorLinea(lineas.some((l) => l.sucursal_id && l.sucursal_id !== g.sucursal_id));
        setAdjuntosActuales(adjuntos.map((a) => a.nombre));
        if (g.recurrente_id) setProgramado({ recurrente: g.recurrente_nombre, fecha: g.fecha_programada });
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setCargando(false));
  }, [gastoId]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setItem = (i: number, patch: Partial<Linea>) => setForm((f) => ({ ...f, items: f.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));

  const indice = useMemo(() => indiceCategorias(cat?.rubros ?? []), [cat]);
  const opcionesCat = useMemo<[string, string][]>(() => [
    ["", "(Elegir subcategoría)"],
    ...(cat?.rubros ?? []).flatMap((r) => r.subcategorias.map((s): [string, string] => [s.id, `${r.nombre} › ${s.nombre}`])),
    ["__nueva__", "+ Nueva subcategoría…"],
  ], [cat]);
  const sucursales = cat?.sucursales ?? [];
  const empleados = cat?.empleados ?? [];
  const cuentas = (cat?.cuentas_bancarias ?? []).filter((c) => c.activa);
  const usd = form.moneda === "USD";
  const credito = form.tipo_pago === "credito";

  function elegirProveedor(id: string | null) {
    const u = id ? cat?.ultimos[id] : undefined;
    const p = id ? proveedores.find((x) => x.id === id) : undefined;
    setForm((f) => {
      const n: Form = { ...f, proveedor_id: id };
      if (!id) return n;
      if (u) {
        if (u.tipo_comprobante) n.tipo_comprobante = u.tipo_comprobante;
        if (u.timbrado && !f.timbrado) n.timbrado = u.timbrado;
        if (u.tipo_pago) n.tipo_pago = u.tipo_pago;
        if (u.plazo_dias != null && !f.plazo_dias) n.plazo_dias = String(u.plazo_dias);
        if (u.medio_pago) n.medio_pago = u.medio_pago;
        if (u.cuenta_bancaria_id) n.cuenta_bancaria_id = u.cuenta_bancaria_id;
        if (u.moneda) n.moneda = u.moneda;
        if (u.sucursal_id && sucursales.some((s) => s.id === u.sucursal_id)) n.sucursal_id = u.sucursal_id;
        // La categoría habitual va en la primera línea si todavía está vacía.
        const l0 = f.items[0];
        if (l0 && !l0.categoria_id && u.categoria_id && indice.has(u.categoria_id)) {
          n.items = [{ ...l0, categoria_id: u.categoria_id, iva_tipo: u.iva_tipo ?? l0.iva_tipo, descripcion: l0.descripcion || u.descripcion || "" }, ...f.items.slice(1)];
        }
      } else if (p?.condicion_pago === "credito") {
        n.tipo_pago = "credito";
        if (!f.plazo_dias && p.plazo_pago_dias) n.plazo_dias = String(p.plazo_pago_dias);
      }
      if (p?.moneda === "USD" && !u) n.moneda = "USD";
      return n;
    });
    setAutocompletado(u ? "Completamos con lo último que cargaste para este proveedor. Revisalo y cambiá lo que haga falta." : null);
  }

  function elegirCategoria(i: number, id: string) {
    if (id === "__nueva__") { setNuevaSub({ fila: i, rubro: cat?.rubros[0]?.id ?? "", nombre: "", tipo: "variable" }); return; }
    const c = indice.get(id);
    setForm((f) => ({
      ...f,
      items: f.items.map((it, j) => (j === i ? {
        ...it, categoria_id: id || null,
        descripcion: it.descripcion.trim() ? it.descripcion : c?.nombre ?? "",
        iva_tipo: c && !c.deducible_iva && it.iva_tipo === "10%" && c.es_personal ? "exenta" : it.iva_tipo,
        empleado_id: c?.es_personal ? it.empleado_id : null,
      } : it)),
    }));
  }

  async function crearSubcategoria() {
    if (!nuevaSub || nuevaSub.nombre.trim().length < 2 || !nuevaSub.rubro) return;
    try {
      const r = await apiFetch<{ id: string; nombre: string }>("/api/gastos/categorias", {
        method: "POST", body: JSON.stringify({ nombre: nuevaSub.nombre.trim(), padre_id: nuevaSub.rubro, tipo_costo: nuevaSub.tipo }),
      });
      invalidar(URL_CATALOGOS);
      const c = await apiFetchCache<Catalogos>(URL_CATALOGOS, { fresco: true });
      setCat(c);
      const fila = nuevaSub.fila;
      setNuevaSub(null);
      setForm((f) => ({ ...f, items: f.items.map((it, j) => (j === fila ? { ...it, categoria_id: r.id, descripcion: it.descripcion.trim() ? it.descripcion : r.nombre } : it)) }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const vencSugerido = credito && form.fecha_comprobante ? sumarDias(form.fecha_comprobante, Number(form.plazo_dias) || 30) : "";

  const totales = useMemo(() => {
    let t10 = 0, i10 = 0, t5 = 0, i5 = 0, ex = 0;
    for (const it of form.items) {
      const m = Number(it.monto) || 0;
      const iva: IvaTipo = form.con_comprobante ? it.iva_tipo : "exenta";
      if (iva === "10%") { t10 += m; i10 += ivaDe(m, "10%", form.moneda); } else if (iva === "5%") { t5 += m; i5 += ivaDe(m, "5%", form.moneda); } else ex += m;
    }
    const total = t10 + t5 + ex;
    return { t10, i10, t5, i5, ex, iva: i10 + i5, sub: total - i10 - i5, total };
  }, [form.items, form.con_comprobante, form.moneda]);

  const hayEmpleados = empleados.some((e) => e.activo);
  // Mismos requisitos que valida la base para confirmar.
  const faltante = useMemo(() => {
    if (form.con_comprobante) {
      if (!form.proveedor_id) return "Elegí el proveedor";
      if (!form.tipo_comprobante) return "Elegí el tipo de comprobante";
      if (!form.numero_comprobante.trim()) return "Cargá el número de comprobante";
      if (requiereTimbrado(form.tipo_comprobante) && !form.timbrado.trim()) return "Cargá el timbrado";
    } else if (credito && !form.proveedor_id) return "A crédito elegí el proveedor";
    if (!form.fecha_comprobante) return "Cargá la fecha";
    if (form.fecha_comprobante > hoyPY()) return "La fecha no puede ser futura";
    if (usd && !(form.tipo_cambio > 0)) return "Cargá el tipo de cambio";
    if (!credito && !form.medio_pago) return "Elegí el medio de pago";
    if (!credito && usd && form.medio_pago === "efectivo") return "En dólares no se paga con efectivo de la caja";
    if (!credito && (form.medio_pago === "transferencia" || form.medio_pago === "cheque") && cuentas.length > 0 && !form.cuenta_bancaria_id) return "Elegí la cuenta bancaria de origen";
    if (form.items.length === 0) return "Cargá al menos una línea";
    if (!form.items.every((it) => it.categoria_id && it.descripcion.trim() && Number(it.monto) > 0)) return "Cada línea necesita subcategoría, descripción y monto";
    if (hayEmpleados && form.items.some((it) => it.categoria_id && indice.get(it.categoria_id)?.es_personal && !it.empleado_id)) return "Las líneas de personal llevan el empleado";
    return null;
  }, [form, credito, usd, cuentas.length, hayEmpleados, indice]);

  function cuerpo(confirmar: boolean) {
    return {
      confirmar,
      id: gastoId ?? null,
      idempotency_key: gastoId ? null : idem,
      proveedor_id: form.proveedor_id,
      sucursal_id: form.sucursal_id || null,
      con_comprobante: form.con_comprobante,
      tipo_comprobante: form.con_comprobante ? form.tipo_comprobante || null : null,
      numero_comprobante: form.numero_comprobante.trim() || null,
      timbrado: form.con_comprobante ? form.timbrado.trim() || null : null,
      fecha_comprobante: form.fecha_comprobante || null,
      moneda: form.moneda,
      tipo_cambio: usd ? form.tipo_cambio || null : null,
      tipo_pago: form.tipo_pago,
      plazo_dias: credito && form.plazo_dias ? Number(form.plazo_dias) : null,
      fecha_vencimiento: credito ? form.fecha_vencimiento || vencSugerido || null : null,
      medio_pago: !credito && form.medio_pago ? form.medio_pago : null,
      cuenta_bancaria_id: !credito && usaCuentaBancaria(form.medio_pago) ? form.cuenta_bancaria_id || null : null,
      referencia_pago: !credito ? form.referencia_pago.trim() || null : null,
      descripcion: form.descripcion.trim() || null,
      observacion: form.observacion.trim() || null,
      items: form.items.map((it) => ({
        categoria_id: it.categoria_id, descripcion: it.descripcion.trim(), monto: Number(it.monto) || 0,
        iva_tipo: form.con_comprobante ? it.iva_tipo : "exenta",
        sucursal_id: porLinea ? it.sucursal_id || form.sucursal_id || null : form.sucursal_id || null,
        empleado_id: it.categoria_id && indice.get(it.categoria_id)?.es_personal ? it.empleado_id : null,
      })),
    };
  }

  const guardar = useCallback(async (confirmar: boolean) => {
    if (busy || hecho) return; // evita doble clic
    if (confirmar && faltante) { setError(faltante); return; }
    for (const a of archivos) {
      const err = validarComprobante(a);
      if (err) { setError(err); return; }
    }
    setBusy(confirmar ? "confirmar" : "borrador");
    setError(null);
    try {
      const r = await apiFetch<{ id: string; numero?: string; total?: number; cxp_id?: string | null; caja_id?: string | null }>("/api/gastos", {
        method: "POST",
        body: JSON.stringify(cuerpo(confirmar)),
      });
      const fallidos: string[] = [];
      for (const a of archivos) {
        try {
          const fd = new FormData();
          fd.append("file", a);
          await apiForm(`/api/gastos/${r.id}/adjuntos`, fd);
        } catch (e) {
          fallidos.push(`${a.name}: ${(e as Error).message}`);
        }
      }
      invalidar(URL_CATALOGOS); // "lo último por proveedor" cambió
      setHecho({
        id: r.id, numero: r.numero ?? null, confirmado: confirmar, total: Number(r.total) || totales.total, moneda: form.moneda,
        credito: !!r.cxp_id, caja: !!r.caja_id,
        avisoAdjunto: fallidos.length ? `El gasto se guardó, pero no se pudo adjuntar: ${fallidos.join(" · ")}` : null,
      });
      onHecho();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, hecho, faltante, archivos, form, porLinea, idem, gastoId, totales.total]);

  // Atajos de teclado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (cargando) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void guardar(true); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) { e.preventDefault(); void guardar(false); }
      else if (e.altKey && (e.key === "n" || e.key === "N")) { e.preventDefault(); setForm((f) => ({ ...f, items: [...f.items, nuevaLinea(porLinea ? f.sucursal_id : null)] })); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [guardar, cargando, porLinea]);

  function otro() {
    const suc = form.sucursal_id;
    setForm(formVacio(suc));
    setArchivos([]);
    setHecho(null);
    setError(null);
    setAutocompletado(null);
    setPorLinea(false);
    setIdem(crypto.randomUUID());
  }

  const titulo = gastoId ? (programado ? "Completar gasto programado" : "Revisar y confirmar") : "Nuevo gasto operativo";
  const opcionesSuc: [string, string][] = sucursales.map((s) => [s.id, s.nombre]);
  const opcionesEmp: [string, string][] = [["", "(Empleado)"], ...empleados.filter((e) => e.activo).map((e): [string, string] => [e.id, `${e.nombre}${e.cargo ? ` · ${e.cargo}` : ""}`])];
  const mediosDisponibles = MEDIOS_PAGO_GASTO.filter((m) => !(usd && m.v === "efectivo"));

  return (
    <CapaModal onClose={busy ? undefined : onClose}>
      <div className={`flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${ALTO_MAX_MODAL}`} style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">{hecho ? (hecho.confirmado ? "Gasto confirmado" : "Borrador guardado") : titulo}</h2>
            {programado && !hecho ? <p className="text-xs text-slate-500">De la plantilla <b>{programado.recurrente}</b>{programado.fecha ? ` · vence el ${programado.fecha.split("-").reverse().join("/")}` : ""}</p> : null}
          </div>
          <button onClick={onClose} disabled={!!busy} aria-label="Cerrar" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"><X className="h-5 w-5" /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {hecho ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><CheckCircle2 className="h-8 w-8" /></div>
              {hecho.confirmado ? (
                <>
                  <p className="text-sm text-slate-500">Número generado: <b className="font-mono text-[var(--brand)]">{hecho.numero ?? "—"}</b> · {monto(hecho.total, hecho.moneda)}</p>
                  {hecho.credito ? (
                    <p className="text-sm text-slate-600">Quedó como deuda con el proveedor. Pagalo desde{" "}
                      <Link href="/compras/pagos" className="font-semibold text-[var(--brand)] hover:underline">Pagos a proveedores</Link>.</p>
                  ) : hecho.caja ? (
                    <p className="text-sm text-slate-600">El efectivo salió de la caja abierta (egreso registrado).</p>
                  ) : (
                    <p className="text-sm text-slate-600">Quedó registrado como pagado al contado.</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-600">Lo podés completar y confirmar después desde la lista.</p>
              )}
              {hecho.avisoAdjunto ? <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{hecho.avisoAdjunto}</p> : null}
            </div>
          ) : cargando || !cat ? (
            <p className="py-10 text-center text-sm text-slate-400">Cargando…</p>
          ) : (
            <>
              {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</div> : null}

              {/* ¿Con o sin comprobante fiscal? */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex rounded-xl bg-slate-100 p-1 max-sm:w-full" role="radiogroup" aria-label="Comprobante">
                  {([[true, "Con comprobante", " fiscal"], [false, "Sin comprobante", ""]] as const).map(([v, l, extra]) => (
                    <button key={l} type="button" role="radio" aria-checked={form.con_comprobante === v} onClick={() => set("con_comprobante", v)}
                      className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition max-sm:min-h-11 max-sm:flex-1 ${form.con_comprobante === v ? "bg-white text-[var(--brand)] shadow-sm" : "text-slate-500"}`}>{l}{extra ? <span className="max-sm:hidden">{extra}</span> : null}</button>
                  ))}
                </div>
                {!form.con_comprobante ? (
                  <p className="flex items-center gap-1.5 text-xs text-slate-500"><Info className="h-3.5 w-3.5" /> Propina, peaje, viático, sueldo… No deducible de IVA.</p>
                ) : null}
              </div>

              {/* Proveedor y comprobante */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
                <div className="sm:col-span-4">
                  <label className={LABEL}>Proveedor{form.con_comprobante || credito ? " *" : " (opcional)"}</label>
                  <SelectorProveedor value={form.proveedor_id} onChange={(id) => elegirProveedor(id)} />
                </div>
                <div className="sm:col-span-2">
                  <label className={LABEL}>{form.con_comprobante ? "Fecha del comprobante *" : "Fecha *"}</label>
                  <SelectorFecha block etiqueta={form.con_comprobante ? "Fecha del comprobante" : "Fecha"} max={hoyPY()} value={form.fecha_comprobante} onChange={(v) => set("fecha_comprobante", v)} claseBoton="rounded-xl px-3 py-2 text-slate-800" />
                </div>
                {autocompletado ? (
                  <p className="flex items-start gap-1.5 rounded-lg bg-[var(--brand-400)]/10 px-3 py-1.5 text-xs text-[#2f6f72] sm:col-span-6">
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {autocompletado}
                  </p>
                ) : null}
                {form.con_comprobante ? (
                  <>
                    <div className="sm:col-span-2">
                      <label className={LABEL}>Tipo de comprobante *</label>
                      <Select value={form.tipo_comprobante} onChange={(v) => set("tipo_comprobante", v)} options={TIPOS_COMPROBANTE.map((t): [string, string] => [t, t])} block />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={LABEL}>Número *</label>
                      <input className={`${INPUT} font-mono`} inputMode={requiereTimbrado(form.tipo_comprobante) ? "numeric" : "text"} placeholder={requiereTimbrado(form.tipo_comprobante) ? "001-001-0000001" : "N° del recibo"}
                        value={form.numero_comprobante}
                        onChange={(e) => set("numero_comprobante", requiereTimbrado(form.tipo_comprobante) ? formatComprobante(e.target.value) : e.target.value.slice(0, 40))} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={LABEL}>Timbrado{requiereTimbrado(form.tipo_comprobante) ? " *" : ""}</label>
                      <input className={`${INPUT} font-mono`} inputMode="numeric" maxLength={20} placeholder="12345678" value={form.timbrado} onChange={(e) => set("timbrado", e.target.value.replace(/\s/g, ""))} />
                    </div>
                  </>
                ) : (
                  <div className="sm:col-span-3">
                    <label className={LABEL}>Referencia (opcional)</label>
                    <input className={INPUT} maxLength={40} placeholder="Ticket, recibo interno…" value={form.numero_comprobante} onChange={(e) => set("numero_comprobante", e.target.value)} />
                  </div>
                )}
              </div>

              {/* Sucursal, moneda */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
                <div className="sm:col-span-3">
                  <label className={LABEL}>Sucursal (centro de costo) *</label>
                  <div className="flex gap-2">
                    <div className="min-w-0 flex-1"><Select value={form.sucursal_id} onChange={(v) => set("sucursal_id", v)} options={opcionesSuc} block /></div>
                    {sucursales.length > 1 ? (
                      <button type="button" onClick={() => {
                        setPorLinea((x) => !x);
                        setForm((f) => ({ ...f, items: f.items.map((it) => ({ ...it, sucursal_id: it.sucursal_id ?? f.sucursal_id })) }));
                      }} title="Repartir las líneas entre sucursales"
                        className={`inline-flex shrink-0 items-center gap-1 rounded-xl border px-2.5 text-xs font-semibold max-sm:min-h-11 ${porLinea ? "border-[var(--brand-400)] bg-[var(--brand-400)]/10 text-[var(--brand)]" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                        <Split className="h-3.5 w-3.5" /> Por línea
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="sm:col-span-3">
                  <label className={LABEL}>Moneda</label>
                  <div className="flex gap-2">
                    <div className="flex rounded-xl bg-slate-100 p-1">
                      {(["GS", "USD"] as const).map((m) => (
                        <button key={m} type="button" onClick={() => setForm((f) => ({ ...f, moneda: m, medio_pago: m === "USD" && f.medio_pago === "efectivo" ? "transferencia" : f.medio_pago }))}
                          className={`rounded-lg px-3 py-1 text-sm font-semibold max-sm:min-h-11 max-sm:px-4 ${form.moneda === m ? "bg-white text-[var(--brand)] shadow-sm" : "text-slate-500"}`}>{m === "GS" ? "Gs." : "USD"}</button>
                      ))}
                    </div>
                    {usd ? (
                      <div className="relative min-w-0 flex-1">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">1 USD = Gs.</span>
                        <MontoInput value={form.tipo_cambio || ""} onChange={(n) => set("tipo_cambio", n)} decimals placeholder="7.300" aria-label="Tipo de cambio" className={`${INPUT} pl-24 text-right tabular-nums`} />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Condición y pago */}
              <div className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-100 bg-slate-50/50 p-3 sm:grid-cols-6">
                <div className="sm:col-span-2">
                  <label className={LABEL}>Condición *</label>
                  <div className="flex rounded-xl bg-white p-1 ring-1 ring-slate-200">
                    {(["contado", "credito"] as const).map((t) => (
                      <button key={t} type="button" onClick={() => setForm((f) => ({ ...f, tipo_pago: t, medio_pago: t === "contado" && !f.medio_pago ? "transferencia" : f.medio_pago }))}
                        className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition max-sm:min-h-11 ${form.tipo_pago === t ? "bg-[var(--brand-400)] text-white shadow-sm" : "text-slate-500"}`}>
                        {t === "contado" ? "Contado" : "Crédito"}
                      </button>
                    ))}
                  </div>
                </div>
                {!credito ? (
                  <>
                    <div className="sm:col-span-2">
                      <label className={LABEL}>Medio de pago *</label>
                      <Select value={form.medio_pago} onChange={(v) => set("medio_pago", v as MedioPagoGasto)} block options={mediosDisponibles.map((m): [string, string] => [m.v, m.l])} />
                    </div>
                    {usaCuentaBancaria(form.medio_pago) ? (
                      <div className="sm:col-span-2">
                        <label className={LABEL}>Cuenta de origen{cuentas.length && form.medio_pago !== "tarjeta" ? " *" : ""}</label>
                        {cuentas.length ? (
                          <Select value={form.cuenta_bancaria_id} onChange={(v) => set("cuenta_bancaria_id", v)} block
                            options={[["", "(Elegir cuenta)"], ...cuentas.map((c): [string, string] => [c.id, nombreCuenta(c)])]} />
                        ) : (
                          <p className="pt-2 text-xs text-slate-500">Sin cuentas cargadas (Catálogos › Cuentas bancarias).</p>
                        )}
                      </div>
                    ) : <div className="sm:col-span-2" />}
                    {form.medio_pago !== "efectivo" ? (
                      <div className="sm:col-span-6">
                        <label className={LABEL}>Referencia del pago</label>
                        <input className={INPUT} maxLength={120} placeholder="N° de operación, cheque o voucher" value={form.referencia_pago} onChange={(e) => set("referencia_pago", e.target.value)} />
                      </div>
                    ) : (
                      <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:col-span-6">
                        Al confirmar, el efectivo <b>sale de la caja abierta</b> (necesitás tener una caja abierta).
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <div className="sm:col-span-2">
                      <label className={LABEL}>Plazo (días)</label>
                      <input type="number" inputMode="numeric" enterKeyHint="next" min={0} max={3650} className={INPUT} placeholder="30" value={form.plazo_dias}
                        onChange={(e) => setForm((f) => ({ ...f, plazo_dias: e.target.value, fecha_vencimiento: "" }))} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={LABEL}>Vencimiento</label>
                      <SelectorFecha block etiqueta="Vencimiento" min={form.fecha_comprobante || undefined} value={form.fecha_vencimiento || vencSugerido}
                        onChange={(v) => set("fecha_vencimiento", v)} claseBoton="rounded-xl px-3 py-2 text-slate-800" />
                    </div>
                    <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800 sm:col-span-6">
                      Al confirmar queda como deuda con el proveedor y se paga desde <b>Pagos a proveedores</b>.
                    </p>
                  </>
                )}
              </div>

              {/* Líneas */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Detalle{form.items.length > 1 ? ` (${form.items.length} líneas)` : ""}</h3>
                  <button type="button" onClick={() => set("items", [...form.items, nuevaLinea(porLinea ? form.sucursal_id : null)])}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-[var(--brand)] hover:bg-slate-50 max-sm:min-h-11 max-sm:px-3" title="Alt+N">
                    <Plus className="h-3.5 w-3.5" /> Agregar línea
                  </button>
                </div>
                <div className="space-y-2">
                  {form.items.map((it, i) => {
                    const c = it.categoria_id ? indice.get(it.categoria_id) : undefined;
                    const m = Number(it.monto) || 0;
                    const quitar = () => set("items", form.items.filter((_, j) => j !== i));
                    return (
                      <div key={it.key} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                        {/* Celular: encabezado de la tarjeta con "quitar" de 44 px */}
                        {form.items.length > 1 ? (
                          <div className="-mr-1.5 -mt-1.5 flex items-center justify-between sm:hidden">
                            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Línea {i + 1}</span>
                            <button type="button" onClick={quitar} aria-label={`Quitar la línea ${i + 1}`}
                              className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 active:bg-rose-50 active:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                          </div>
                        ) : null}
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                          <div className="sm:col-span-5">
                            <label className={LABEL}>Subcategoría *</label>
                            {nuevaSub?.fila === i ? (
                              <div className="space-y-1.5 rounded-xl border border-[var(--brand-400)]/40 bg-[var(--brand-400)]/5 p-2">
                                <Select value={nuevaSub.rubro} onChange={(v) => setNuevaSub({ ...nuevaSub, rubro: v })} block compacto
                                  options={(cat?.rubros ?? []).map((r): [string, string] => [r.id, `Rubro: ${r.nombre}`])} />
                                <div className="flex gap-1.5">
                                  <input autoFocus className={`${INPUT} min-w-0`} placeholder="Nombre (ej. Seguridad)" enterKeyHint="done" value={nuevaSub.nombre}
                                    onChange={(e) => setNuevaSub({ ...nuevaSub, nombre: e.target.value })}
                                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void crearSubcategoria(); } }} />
                                  <Select value={nuevaSub.tipo} onChange={(v) => setNuevaSub({ ...nuevaSub, tipo: v as "fijo" | "variable" })} compacto
                                    options={[["variable", "Variable"], ["fijo", "Fijo"]]} />
                                </div>
                                <div className="flex justify-end gap-1.5">
                                  <button type="button" onClick={() => setNuevaSub(null)} className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-white max-sm:min-h-11 max-sm:flex-1 max-sm:border max-sm:border-slate-200 max-sm:bg-white max-sm:text-sm">Cancelar</button>
                                  <button type="button" onClick={() => void crearSubcategoria()} className="rounded-lg bg-[var(--brand-400)] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[var(--brand)] max-sm:min-h-11 max-sm:flex-1 max-sm:text-sm">Crear</button>
                                </div>
                              </div>
                            ) : (
                              <Select value={it.categoria_id ?? ""} onChange={(v) => elegirCategoria(i, v)} options={opcionesCat} block />
                            )}
                            {c ? (
                              <p className="mt-1 flex flex-wrap gap-1 text-[10px] font-semibold">
                                <span className={`rounded px-1.5 py-0.5 ${c.tipo_costo === "fijo" ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-500"}`}>{c.tipo_costo === "fijo" ? "Fijo" : "Variable"}</span>
                                {!c.deducible_iva || !form.con_comprobante ? <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">No deducible</span> : null}
                              </p>
                            ) : null}
                          </div>
                          <div className="sm:col-span-7">
                            <label className={LABEL}>Descripción *</label>
                            <input className={INPUT} placeholder="Detalle de la línea" maxLength={300} enterKeyHint="next" value={it.descripcion} onChange={(e) => setItem(i, { descripcion: e.target.value })} />
                          </div>
                        </div>
                        {/* Celular: monto e IVA lado a lado (grilla de 2); empleado / sucursal y el total de la línea a todo el ancho */}
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-12">
                          <div className={form.con_comprobante ? "min-w-0 sm:col-span-4" : "col-span-2 sm:col-span-4"}>
                            <label className={LABEL}>Monto{form.con_comprobante ? <span className="max-sm:hidden"> (IVA incluido)</span> : null} *</label>
                            <div className="relative">
                              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">{usd ? "USD" : "Gs."}</span>
                              <MontoInput value={it.monto || ""} onChange={(n) => setItem(i, { monto: n })} decimals={usd} placeholder="0" enterKeyHint="done"
                                aria-label={`Monto de la línea ${i + 1}${form.con_comprobante ? " (IVA incluido)" : ""}`} className={`${INPUT} pl-12 text-right tabular-nums max-sm:pl-11`} />
                            </div>
                          </div>
                          {form.con_comprobante ? (
                            <div className="min-w-0 sm:col-span-2">
                              <label className={LABEL}>IVA<span className="sm:hidden"> (incluido)</span></label>
                              <Select value={it.iva_tipo} onChange={(v) => setItem(i, { iva_tipo: v as IvaTipo })} block etiqueta="IVA de la línea" options={[["10%", "10 %"], ["5%", "5 %"], ["exenta", "Exenta"]]} />
                            </div>
                          ) : null}
                          {c?.es_personal ? (
                            <div className="col-span-2 sm:col-span-3">
                              <label className={LABEL}>Empleado{hayEmpleados ? " *" : ""}</label>
                              {hayEmpleados ? <Select value={it.empleado_id ?? ""} onChange={(v) => setItem(i, { empleado_id: v || null })} options={opcionesEmp} block etiqueta="Empleado" />
                                : <p className="pt-2 text-xs text-slate-500">Cargá empleados en Catálogos.</p>}
                            </div>
                          ) : null}
                          {porLinea ? (
                            <div className="col-span-2 sm:col-span-3">
                              <label className={LABEL}>Sucursal</label>
                              <Select value={it.sucursal_id ?? form.sucursal_id} onChange={(v) => setItem(i, { sucursal_id: v })} options={opcionesSuc} block etiqueta="Sucursal de la línea" />
                            </div>
                          ) : null}
                          <div className="col-span-2 flex items-end justify-between gap-2 max-sm:border-t max-sm:border-slate-100 max-sm:pt-2 sm:col-span-12 sm:justify-end">
                            <span className="flex w-full flex-wrap items-baseline justify-between gap-x-3 text-xs text-slate-500 sm:w-auto sm:justify-end">
                              {form.con_comprobante && it.iva_tipo !== "exenta" ? <span>IVA {it.iva_tipo}: <b className="text-slate-700">{monto(ivaDe(m, it.iva_tipo, form.moneda), form.moneda)}</b><span className="max-sm:hidden"> · </span></span> : null}
                              <span className="max-sm:ml-auto">Línea: <b className="text-slate-800 max-sm:text-sm">{monto(m, form.moneda)}</b></span>
                            </span>
                            {form.items.length > 1 ? (
                              <button type="button" onClick={quitar} aria-label="Eliminar línea"
                                className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 max-sm:hidden"><Trash2 className="h-4 w-4" /></button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* Celular: agregar otra línea al final de la lista (sin volver arriba) */}
                <button type="button" onClick={() => set("items", [...form.items, nuevaLinea(porLinea ? form.sucursal_id : null)])}
                  className="mt-2 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 text-sm font-semibold text-[var(--brand)] active:bg-[var(--brand-400)]/5 sm:hidden">
                  <Plus className="h-4 w-4" /> Agregar otra línea
                </button>
              </div>

              <div className="rounded-xl bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-1 text-sm">
                  {form.con_comprobante ? <>
                    <span className="text-slate-500">Gravado: <b className="text-slate-800">{monto(totales.sub, form.moneda)}</b></span>
                    {totales.i10 ? <span className="text-slate-500">IVA 10 %: <b className="text-slate-800">{monto(totales.i10, form.moneda)}</b></span> : null}
                    {totales.i5 ? <span className="text-slate-500">IVA 5 %: <b className="text-slate-800">{monto(totales.i5, form.moneda)}</b></span> : null}
                    {totales.ex ? <span className="text-slate-500">Exentas: <b className="text-slate-800">{monto(totales.ex, form.moneda)}</b></span> : null}
                  </> : null}
                  <span className="text-slate-600">Total: <b className="text-base text-slate-900">{monto(totales.total, form.moneda)}</b></span>
                  {usd && form.tipo_cambio > 0 ? <span className="text-xs text-slate-500">≈ {gs(totales.total * form.tipo_cambio)}</span> : null}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={LABEL}>Adjuntos (fotos o PDF)</label>
                  <input ref={fileRef} type="file" multiple accept={ACCEPT_COMPROBANTE} className="hidden"
                    onChange={(e) => { const fs = Array.from(e.target.files ?? []); setArchivos((a) => [...a, ...fs].slice(0, 20)); e.target.value = ""; }} />
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="flex w-full items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-left text-sm text-slate-600 hover:border-[var(--brand-400)] hover:bg-[var(--brand-400)]/5 max-sm:min-h-11">
                    <Paperclip className="h-4 w-4 shrink-0 text-slate-400" />
                    <span>Factura, recibo, comprobante de transferencia…</span>
                  </button>
                  {adjuntosActuales.length ? <p className="mt-1 text-[11px] text-slate-500">Ya adjuntos: {adjuntosActuales.join(", ")}</p> : null}
                  {archivos.length ? (
                    <ul className="mt-1.5 space-y-1">
                      {archivos.map((a, i) => (
                        <li key={`${a.name}-${i}`} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-600">
                          <span className="min-w-0 flex-1 truncate">{a.name}</span><span className="text-slate-400">{tamano(a.size)}</span>
                          <button type="button" onClick={() => setArchivos((x) => x.filter((_, j) => j !== i))} aria-label={`Quitar ${a.name}`} className="inline-flex shrink-0 items-center justify-center text-slate-400 hover:text-rose-600 max-sm:-my-1 max-sm:-mr-2 max-sm:h-11 max-sm:w-11"><X className="h-3.5 w-3.5 max-sm:h-4 max-sm:w-4" /></button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <div className="space-y-3">
                  <div>
                    <label className={LABEL}>Descripción general</label>
                    <input className={INPUT} maxLength={500} enterKeyHint="next" placeholder="Ej. alquiler de octubre" value={form.descripcion} onChange={(e) => set("descripcion", e.target.value)} />
                  </div>
                  <div>
                    <label className={LABEL}>Notas</label>
                    <textarea rows={2} className={INPUT} maxLength={1000} value={form.observacion} onChange={(e) => set("observacion", e.target.value)} />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
          {hecho ? (
            <>
              {!gastoId ? <button onClick={otro} className="rounded-xl border border-[var(--brand-400)]/50 px-4 py-2 text-sm font-semibold text-[var(--brand)] hover:bg-[var(--brand-400)]/5 max-sm:flex-1">Cargar otro</button> : null}
              <button onClick={onClose} className="rounded-xl bg-[var(--brand-400)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--brand)] max-sm:flex-1">Cerrar</button>
            </>
          ) : (
            <>
              {/* Celular: el total y lo que falta, pegados a los botones (el pie queda fijo) */}
              <div className="flex w-full min-w-0 items-baseline justify-between gap-3 sm:mr-auto sm:w-auto sm:flex-1">
                <span className="min-w-0 text-xs text-slate-400">
                  {faltante && !cargando ? faltante : <span className="hidden sm:inline">Ctrl+Enter confirma · Ctrl+S borrador · Alt+N línea</span>}
                </span>
                {!cargando && cat ? (
                  <span className="shrink-0 text-sm text-slate-600 sm:hidden">Total <b className="text-base tabular-nums text-slate-900">{monto(totales.total, form.moneda)}</b></span>
                ) : null}
              </div>
              {/* En celular "Cancelar" se omite: la ✕ de arriba (44 px) cierra igual y los dos botones entran cómodos. */}
              <button onClick={onClose} disabled={!!busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 max-sm:hidden">Cancelar</button>
              <button onClick={() => void guardar(false)} disabled={!!busy || cargando}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[var(--brand-400)]/50 px-4 py-2 text-sm font-semibold text-[var(--brand)] hover:bg-[var(--brand-400)]/5 disabled:opacity-50 max-sm:flex-1 max-sm:px-3">
                {busy === "borrador" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar borrador
              </button>
              <button onClick={() => void guardar(true)} disabled={!!busy || cargando || !!faltante}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--brand-400)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--brand)] disabled:opacity-50 max-sm:flex-1 max-sm:px-3">
                {busy === "confirmar" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {busy === "confirmar" ? "Confirmando…" : "Confirmar gasto"}
              </button>
            </>
          )}
        </div>
      </div>
    </CapaModal>
  );
}
