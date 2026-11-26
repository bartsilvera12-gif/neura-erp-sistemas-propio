"use client";

/**
 * /inventario/ajustes/nuevo?tipo=ajuste|perdida&deposito=&producto= — Nuevo documento.
 *   · AJUSTE (solo ADMIN): por CONTEO (se carga el stock real y el sistema calcula la
 *     diferencia al guardar) o por DIFERENCIA (+/−). Lo que entra en un producto con lotes
 *     pide lote y vencimiento; lo que sale, del lote elegido o del que vence primero.
 *   · PÉRDIDA: unidades que se pierden (vencimiento, rotura, devolución no revendible…),
 *     valorizadas al costo. Si la carga alguien que no es ADMIN queda pendiente de aprobación.
 */
import Link from "next/link";
import { unidadCorta } from "@/erp2/modules/inventario/recetas";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, ClipboardCheck, Loader2, PackageMinus, Trash2 } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { hoyPY } from "@/erp2/lib/fecha/paraguay";
import { useUsuario } from "@/erp2/lib/sesion/ContextoUsuario";
import { Select } from "@/erp2/components/Select";
import { BuscadorProductos, MiniaturaProducto } from "@/erp2/modules/compras/partes";
import type { ProductoInventario } from "@/erp2/modules/inventario/tipos";
import { loteAutomatico, type StockProducto } from "@/erp2/modules/inventario/vencimientos";
import { invalidarDepositos, opcionesDepositos, useDepositos } from "@/erp2/modules/inventario/depositos";
import { invalidarLista } from "@/erp2/modules/inventario/lista-cache";
import { MOTIVOS_AJUSTE, MOTIVOS_PERDIDA, cant, dia, gs } from "@/erp2/modules/inventario/documentos";
import { BarraEnvio, BOTON_PRIMARIO, BOTON_SECUNDARIO, Cabecera, ET, INPUT, TEAL } from "@/erp2/modules/inventario/ui";
import { SelectorFecha } from "@/erp2/components/SelectorFecha";

type Linea = {
  prod: ProductoInventario;
  stock: StockProducto | null;
  modo: "conteo" | "diferencia";
  signo: 1 | -1;
  cantidad: string;
  lote_id: string;   // "" = automático (vence primero)
  lote: string;      // lote nuevo que entra
  vencimiento: string;
};

export default function NuevoAjustePage() {
  return (
    <Suspense fallback={null}>
      <NuevoAjuste />
    </Suspense>
  );
}

function NuevoAjuste() {
  const router = useRouter();
  const sp = useSearchParams();
  const me = useUsuario();
  const esAdmin = me?.rol === "ADMIN";
  const deps = useDepositos();
  const [tipo, setTipo] = useState<"ajuste" | "perdida">(sp.get("tipo") === "perdida" ? "perdida" : "ajuste");
  const [deposito, setDeposito] = useState(sp.get("deposito") ?? "");
  const [motivo, setMotivo] = useState(tipo === "perdida" ? "vencimiento" : "conteo_fisico");
  const [detalle, setDetalle] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [idem, setIdem] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<{ id: string; numero: string; estado: string } | null>(null);

  // Sin permiso de ajuste (no ADMIN): solo pérdidas.
  useEffect(() => { if (me && !esAdmin && tipo === "ajuste") { setTipo("perdida"); setMotivo("vencimiento"); } }, [me, esAdmin, tipo]);
  const depEf = deposito || deps.datos?.mi_deposito_id || "";
  const depNombre = opcionesDepositos(deps.datos, { soloActivos: false }).find(([id]) => id === depEf)?.[1] ?? "el depósito";

  useEffect(() => {
    const id = sp.get("producto");
    if (!id) return;
    apiFetch<ProductoInventario>(`/api/productos/${id}`).then(agregar).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function agregar(p: ProductoInventario) {
    if (p.controla_stock === false) { setError(`"${p.nombre}" no controla stock.`); return; }
    setError(null);
    setLineas((ls) => (ls.some((l) => l.prod.id === p.id) ? ls : [...ls, {
      prod: p, stock: null, modo: tipo === "ajuste" && motivo === "conteo_fisico" ? "conteo" : "diferencia",
      signo: tipo === "ajuste" && motivo === "inventario_inicial" ? 1 : -1, cantidad: "", lote_id: "", lote: loteAutomatico(hoyPY()), vencimiento: "",
    }]));
    apiFetch<StockProducto>(`/api/productos/${p.id}/stock`)
      .then((s) => setLineas((ls) => ls.map((l) => (l.prod.id === p.id ? { ...l, stock: s } : l))))
      .catch(() => {});
  }
  const cambiar = (id: string, patch: Partial<Linea>) => setLineas((ls) => ls.map((l) => (l.prod.id === id ? { ...l, ...patch } : l)));

  const num = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(",", ".")));
  const enDep = (l: Linea) => l.stock?.depositos.find((d) => d.deposito_id === depEf);
  /** Diferencia que va a quedar (+ entra, − sale). */
  const difDe = (l: Linea) => {
    const c = num(l.cantidad);
    if (!Number.isFinite(c)) return NaN;
    if (tipo === "perdida") return -c;
    if (l.modo === "conteo") return c - Number(enDep(l)?.cantidad ?? 0);
    return l.signo * c;
  };
  const costoDe = (l: Linea) => {
    const lote = enDep(l)?.lotes.find((x) => x.id === l.lote_id);
    return Number(lote && Number(lote.costo_unitario) > 0 ? lote.costo_unitario : l.prod.costo_promedio ?? 0);
  };
  const problema = (l: Linea): string | null => {
    const c = num(l.cantidad);
    if (!Number.isFinite(c) || c < 0 || (l.modo !== "conteo" && c === 0)) return l.modo === "conteo" ? "Cargá lo que contaste" : "Cargá la cantidad";
    const dif = difDe(l);
    const disp = Number(enDep(l)?.cantidad ?? 0);
    if (l.stock && dif < 0 && -dif > disp) return `En ${depNombre} hay ${cant(disp)}`;
    const lote = enDep(l)?.lotes.find((x) => x.id === l.lote_id);
    if (dif < 0 && lote && -dif > Number(lote.cantidad)) return `Del lote ${lote.numero} quedan ${cant(lote.cantidad)}`;
    if (dif > 0 && l.prod.controla_lotes && !l.vencimiento) return "Cargá el vencimiento del lote que entra";
    return null;
  };
  const problemas = lineas.map(problema);
  const listo = !!depEf && lineas.length > 0 && problemas.every((p) => !p) && (motivo !== "otro" || !!detalle.trim());
  // Lo que todavía falta para poder guardar (se muestra en la barra flotante).
  const falta = !depEf ? "Elegí el depósito"
    : !lineas.length ? "Agregá al menos un producto"
    : problemas.some(Boolean) ? (problemas.filter(Boolean).length > 1 ? `Revisá ${problemas.filter(Boolean).length} productos: faltan datos` : `${lineas[problemas.findIndex(Boolean)].prod.nombre}: ${problemas.find(Boolean)}`)
    : motivo === "otro" && !detalle.trim() ? "Escribí el detalle del motivo"
    : null;
  const valorTotal = lineas.reduce((a, l) => { const d = difDe(l); return a + (Number.isFinite(d) ? d * costoDe(l) : 0); }, 0);

  async function guardar() {
    if (!listo || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ id: string; numero: string; estado: string }>("/api/inventario/ajustes", {
        method: "POST",
        body: JSON.stringify({
          tipo,
          deposito_id: depEf,
          motivo,
          detalle: detalle.trim() || null,
          idempotency_key: idem,
          items: lineas.map((l) => {
            const dif = difDe(l);
            return {
              producto_id: l.prod.id,
              modo: tipo === "perdida" ? "diferencia" : l.modo,
              cantidad: tipo === "perdida" || l.modo === "conteo" ? num(l.cantidad) : l.signo * num(l.cantidad),
              lote_id: l.prod.controla_lotes && l.lote_id && !(dif > 0) ? l.lote_id : null,
              lote: l.prod.controla_lotes && dif > 0 ? l.lote.trim() || null : null,
              vencimiento: l.prod.controla_lotes && dif > 0 ? l.vencimiento : null,
            };
          }),
        }),
      });
      invalidarLista("/api/productos");
      invalidarLista("/api/inventario/movimientos");
      invalidarLista("/api/inventario/ajustes");
      invalidarLista("/api/inventario/vencimientos");
      invalidarDepositos();
      setHecho(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function otro() {
    setHecho(null);
    setLineas([]);
    setDetalle("");
    setIdem(crypto.randomUUID());
    router.replace(`/inventario/ajustes/nuevo?tipo=${tipo}`);
  }

  if (hecho) {
    const pendiente = hecho.estado === "pendiente";
    return (
      <div className="mx-auto max-w-lg space-y-5 py-10 text-center">
        <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ring-8 ${pendiente ? "bg-amber-50 text-amber-600 ring-amber-50/50" : "bg-emerald-50 text-emerald-600 ring-emerald-50/50"}`}><CheckCircle2 className="h-7 w-7" /></div>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{tipo === "perdida" ? "Pérdida" : "Ajuste"} <span className="font-mono">{hecho.numero}</span> {pendiente ? "cargada" : "aplicado"}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {pendiente ? "Queda pendiente: un administrador tiene que aprobarla para que baje el stock." : `El stock de ${depNombre} ya quedó actualizado y en el kardex.`}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2 max-sm:flex-col max-sm:[&>*]:min-h-11">
          <Link href={`/inventario/ajustes?ver=${hecho.id}`} className={BOTON_PRIMARIO} style={{ backgroundColor: TEAL }}>Ver el documento</Link>
          <button onClick={otro} className={BOTON_SECUNDARIO}>Cargar otro</button>
        </div>
      </div>
    );
  }

  const motivos = tipo === "perdida" ? MOTIVOS_PERDIDA : MOTIVOS_AJUSTE;
  return (
    <div className="space-y-5 max-lg:pb-28 sm:space-y-6">
      <Cabecera kicker="Inventario · Ajustes y pérdidas" titulo={tipo === "perdida" ? "Nueva pérdida" : "Nuevo ajuste de inventario"}
        subtitulo={tipo === "perdida" ? "Mercadería que se pierde: baja del stock valorizada al costo" : "Corregí el stock con un conteo físico o una diferencia documentada"}>
        <Link href="/inventario/ajustes" className={BOTON_SECUNDARIO}><ArrowLeft className="h-4 w-4" /> Ajustes y pérdidas</Link>
      </Cabecera>

      <section className="rounded-2xl border bg-white p-4 shadow-sm sm:p-5" style={{ borderColor: `${TEAL}33` }}>
        <div className="grid gap-4 max-sm:gap-3 sm:grid-cols-2 md:grid-cols-[auto_1fr_1fr]">
          <div className="sm:col-span-2 md:col-span-1">
            <span className={ET}>Documento</span>
            <div className="flex rounded-xl bg-slate-100 p-1 text-sm font-semibold">
              <button type="button" disabled={!esAdmin} onClick={() => { setTipo("ajuste"); setMotivo("conteo_fisico"); }}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition disabled:cursor-not-allowed disabled:opacity-40 max-md:min-h-10 max-md:flex-1 max-md:justify-center ${tipo === "ajuste" ? "bg-white text-[var(--brand)] shadow-sm" : "text-slate-500"}`}>
                <ClipboardCheck className="h-4 w-4" /> Ajuste
              </button>
              <button type="button" onClick={() => { setTipo("perdida"); setMotivo("vencimiento"); }}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition max-md:min-h-10 max-md:flex-1 max-md:justify-center ${tipo === "perdida" ? "bg-white text-rose-600 shadow-sm" : "text-slate-500"}`}>
                <PackageMinus className="h-4 w-4" /> Pérdida
              </button>
            </div>
          </div>
          <div className="min-w-0">
            <span className={ET}>Depósito</span>
            <Select value={depEf} onChange={setDeposito} block etiqueta="Depósito" options={opcionesDepositos(deps.datos)} />
          </div>
          <div className="min-w-0">
            <span className={ET}>Motivo</span>
            <Select value={motivo} onChange={(v) => {
              setMotivo(v);
              if (tipo === "ajuste") setLineas((ls) => ls.map((l) => ({ ...l, modo: v === "conteo_fisico" ? "conteo" : "diferencia", signo: v === "inventario_inicial" ? 1 : l.signo })));
            }} block etiqueta="Motivo" options={motivos} />
          </div>
        </div>
        <label className="mt-3 block">
          <span className={ET}>Detalle {motivo === "otro" ? "*" : <span className="font-normal text-slate-400">(opcional)</span>}</span>
          <input enterKeyHint="done" value={detalle} onChange={(e) => setDetalle(e.target.value)} maxLength={500}
            placeholder={tipo === "perdida" ? "Ej. Se cortó la luz y se perdió la cadena de frío" : "Ej. Conteo de fin de mes, pasillo 3"} className={INPUT} />
        </label>
        {!esAdmin && tipo === "perdida" ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">La pérdida queda <strong>pendiente</strong> hasta que un administrador la apruebe.</p>
        ) : null}
      </section>

      <section className="rounded-2xl border bg-white shadow-sm" style={{ borderColor: `${TEAL}33` }}>
        <div className="border-b px-4 py-4 sm:px-5" style={{ borderColor: `${TEAL}22` }}>
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Productos</h2>
          <BuscadorProductos onElegir={agregar} deposito={depEf ? { id: depEf, nombre: depNombre } : null} agregados={lineas.map((l) => l.prod.id)} />
        </div>
        {lineas.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400 sm:px-5">Buscá los productos {tipo === "perdida" ? "que se perdieron" : "a ajustar"}.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {lineas.map((l, i) => {
              const dep = enDep(l);
              const dif = difDe(l);
              const conLotes = !!l.prod.controla_lotes;
              const lotesDep = dep?.lotes ?? [];
              return (
                <li key={l.prod.id} className="px-4 py-3 sm:px-5">
                  {/* Celular: nombre + quitar (44 px) arriba; modo a todo el ancho; cantidad | diferencia en 2 col. */}
                  <div className="flex flex-wrap items-center gap-3 max-sm:gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-3 max-sm:basis-[calc(100%-3.25rem)]">
                      <MiniaturaProducto url={l.prod.imagen_url} nombre={l.prod.nombre} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-slate-800 max-sm:whitespace-normal max-sm:[overflow-wrap:anywhere]">{l.prod.nombre}</p>
                        <p className="text-[11px] text-slate-500">
                          <span className="font-mono">{l.prod.sku}</span> · en el sistema: {l.stock ? <strong className="text-slate-700">{cant(dep?.cantidad ?? 0)}</strong> : <Loader2 className="inline h-3 w-3 animate-spin" />} {unidadCorta(l.prod.unidad_medida ?? "Unidad")}
                        </p>
                      </div>
                    </div>
                    {tipo === "ajuste" ? (
                      <div className="flex rounded-lg bg-slate-100 p-0.5 text-[11px] font-semibold max-sm:order-2 max-sm:w-full max-sm:text-xs">
                        <button type="button" onClick={() => cambiar(l.prod.id, { modo: "conteo" })} className={`rounded-md px-2 py-1 max-sm:min-h-10 max-sm:flex-1 ${l.modo === "conteo" ? "bg-white text-[var(--brand)] shadow-sm" : "text-slate-500"}`}>Conteo</button>
                        <button type="button" onClick={() => cambiar(l.prod.id, { modo: "diferencia", signo: 1 })} className={`rounded-md px-2 py-1 max-sm:min-h-10 max-sm:flex-1 ${l.modo === "diferencia" && l.signo === 1 ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500"}`}>+ Sumar</button>
                        <button type="button" onClick={() => cambiar(l.prod.id, { modo: "diferencia", signo: -1 })} className={`rounded-md px-2 py-1 max-sm:min-h-10 max-sm:flex-1 ${l.modo === "diferencia" && l.signo === -1 ? "bg-white text-red-600 shadow-sm" : "text-slate-500"}`}>− Restar</button>
                      </div>
                    ) : null}
                    <div className="text-right max-sm:order-3 max-sm:min-w-0 max-sm:flex-1">
                      <input inputMode="decimal" enterKeyHint="done" aria-label={`${tipo === "ajuste" && l.modo === "conteo" ? "Contado" : "Cantidad"} de ${l.prod.nombre}`} value={l.cantidad} autoFocus={i === lineas.length - 1}
                        onChange={(e) => cambiar(l.prod.id, { cantidad: e.target.value.replace(/[^\d.,]/g, "") })}
                        placeholder={tipo === "ajuste" && l.modo === "conteo" ? "Contado" : "Cantidad"}
                        className={`w-28 rounded-xl border px-3 py-2 text-right text-sm tabular-nums outline-none focus:ring-4 max-sm:min-h-11 max-sm:w-full ${problemas[i] && l.cantidad ? "border-rose-300 focus:ring-rose-100" : "border-slate-200 focus:border-[var(--brand)] focus:ring-[var(--brand-100)]"}`} />
                    </div>
                    <div className="w-24 text-right max-sm:order-4 max-sm:w-auto max-sm:min-w-0 max-sm:flex-1">
                      {Number.isFinite(dif) ? (
                        <>
                          <p className={`text-sm font-bold tabular-nums ${dif > 0 ? "text-emerald-700" : dif < 0 ? "text-red-600" : "text-slate-400"}`}>{dif > 0 ? "+" : dif < 0 ? "−" : "±"}{cant(Math.abs(dif))}</p>
                          <p className="text-[11px] tabular-nums text-slate-400">{gs(Math.abs(dif) * costoDe(l))}</p>
                        </>
                      ) : <p className="text-xs text-slate-300">—</p>}
                    </div>
                    <button type="button" onClick={() => setLineas((ls) => ls.filter((x) => x.prod.id !== l.prod.id))} title="Quitar" aria-label={`Quitar ${l.prod.nombre}`} className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 max-sm:order-1 max-sm:inline-flex max-sm:h-11 max-sm:w-11 max-sm:items-center max-sm:justify-center max-sm:self-start">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {conLotes && dif > 0 ? (
                    <div className="mt-2 grid gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-3 sm:grid-cols-2">
                      <label className="block">
                        <span className={ET}>Lote que entra <span className="font-normal text-slate-400">(editable)</span></span>
                        <input enterKeyHint="next" autoCapitalize="characters" autoComplete="off" value={l.lote} onChange={(e) => cambiar(l.prod.id, { lote: e.target.value.slice(0, 40) })} className={`${INPUT} font-mono uppercase`} />
                      </label>
                      <div className="block">
                        <span className={ET}>Vencimiento *</span>
                        <SelectorFecha block etiqueta="Vencimiento del lote" min={hoyPY()} value={l.vencimiento} onChange={(v) => cambiar(l.prod.id, { vencimiento: v })} />
                      </div>
                    </div>
                  ) : conLotes && (dif < 0 || tipo === "perdida") ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 max-sm:flex-col max-sm:items-stretch max-sm:gap-1">
                      <span className="text-[11px] text-slate-500">Sale de:</span>
                      <Select value={l.lote_id} onChange={(v) => cambiar(l.prod.id, { lote_id: v })} minWidth={260} etiqueta="Lote del que sale" className="max-sm:!min-w-0 max-sm:w-full"
                        options={[["", "Automático (el que vence primero)"], ...lotesDep.map((x): [string, string] => [x.id, `${x.numero} · vence ${dia(x.vencimiento)} · hay ${cant(x.cantidad)}${x.vencimiento < hoyPY() ? " (vencido)" : ""}`])]} />
                    </div>
                  ) : null}
                  {problemas[i] && l.cantidad ? <p className="mt-1 text-[11px] font-medium text-rose-600">{problemas[i]}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <BarraEnvio
        chico={lineas.length ? `${lineas.length} ${lineas.length === 1 ? "producto" : "productos"} · al costo` : "Valor al costo"}
        grande={<span className={`tabular-nums ${valorTotal < 0 ? "text-red-600" : valorTotal > 0 ? "text-emerald-700" : ""}`}>{valorTotal < 0 ? "−" : ""}{gs(Math.abs(valorTotal))}</span>}
        resumen={lineas.length ? <>{lineas.length} {lineas.length === 1 ? "producto" : "productos"} · valor <span className={valorTotal < 0 ? "text-red-600" : "text-emerald-700"}>{valorTotal < 0 ? "−" : ""}{gs(Math.abs(valorTotal))}</span> al costo</> : null}
        falta={falta} error={error} etiqueta={tipo === "perdida" ? (esAdmin ? "Registrar pérdida" : "Enviar para aprobación") : "Aplicar ajuste"}
        icono={tipo === "perdida" ? <PackageMinus className="h-4 w-4 shrink-0" /> : <ClipboardCheck className="h-4 w-4 shrink-0" />}
        listo={listo} busy={busy} onEnviar={() => void guardar()} color={tipo === "perdida" ? "#e11d48" : TEAL} />
    </div>
  );
}
