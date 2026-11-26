"use client";

/**
 * /inventario/traslados/nuevo — Nuevo traslado entre depósitos (ADMIN). Al guardarlo, la
 * mercadería SALE del origen y queda en tránsito hasta que se recibe en el destino.
 *   · productos con lo disponible en el depósito de origen; con lotes: automático (los que
 *     vencen primero) o elegidos a mano
 *   · datos de la nota de remisión (SIFEN): motivo, fechas, puntos de partida y llegada,
 *     vehículo, chofer y transportista
 * ?origen=<deposito>&producto=<id> precarga (desde la ficha del producto).
 */
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowLeftRight, CheckCircle2, FileDown, Loader2, Trash2, Truck } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { descargarArchivo } from "@/erp2/lib/api/client-blob";
import { hoyPY } from "@/erp2/lib/fecha/paraguay";
import { useUsuario } from "@/erp2/lib/sesion/ContextoUsuario";
import { Select } from "@/erp2/components/Select";
import { BuscadorProductos, MiniaturaProducto } from "@/erp2/modules/compras/partes";
import type { ProductoInventario } from "@/erp2/modules/inventario/tipos";
import type { StockProducto } from "@/erp2/modules/inventario/vencimientos";
import { depositosPlanos, invalidarDepositos, opcionesDepositos, useDepositos } from "@/erp2/modules/inventario/depositos";
import { invalidarLista } from "@/erp2/modules/inventario/lista-cache";
import { MOTIVOS_TRASLADO, cant, dia } from "@/erp2/modules/inventario/documentos";
import { BarraEnvio, BOTON_PRIMARIO, BOTON_SECUNDARIO, Cabecera, ET, INPUT, TEAL } from "@/erp2/modules/inventario/ui";
import { unidadCorta } from "@/erp2/modules/inventario/recetas";
import { SelectorFecha } from "@/erp2/components/SelectorFecha";

type Linea = {
  prod: ProductoInventario;
  stock: StockProducto | null;
  cantidad: string;
  manual: boolean;          // lotes elegidos a mano
  lotes: Record<string, string>; // lote_id → cantidad
};

export default function NuevoTrasladoPage() {
  return (
    <Suspense fallback={null}>
      <NuevoTraslado />
    </Suspense>
  );
}

function NuevoTraslado() {
  const router = useRouter();
  const sp = useSearchParams();
  const me = useUsuario();
  const deps = useDepositos();
  const planos = useMemo(() => depositosPlanos(deps.datos), [deps.datos]);
  const [origen, setOrigen] = useState(sp.get("origen") ?? "");
  const [destino, setDestino] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [r, setR] = useState({
    motivo_codigo: "7", motivo_descripcion: "", fecha_inicio: hoyPY(), fecha_fin_estimada: "",
    punto_partida: "", ciudad_partida: "", punto_llegada: "", ciudad_llegada: "",
    vehiculo_marca: "", vehiculo_chapa: "", chofer_nombre: "", chofer_documento: "",
    transportista_nombre: "", transportista_ruc: "", observacion: "",
  });
  const [idem, setIdem] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<{ id: string; numero: string; remision_numero: string } | null>(null);
  const setRem = <K extends keyof typeof r>(k: K, v: string) => setR((p) => ({ ...p, [k]: v }));

  // Origen por defecto: el depósito del usuario.
  const origenEf = origen || deps.datos?.mi_deposito_id || "";
  const dOrigen = planos.find((d) => d.id === origenEf);
  const dDestino = planos.find((d) => d.id === destino);

  // Producto precargado (?producto=).
  useEffect(() => {
    const id = sp.get("producto");
    if (!id) return;
    apiFetch<ProductoInventario>(`/api/productos/${id}`).then(agregar).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function agregar(p: ProductoInventario) {
    if (p.controla_stock === false) { setError(`"${p.nombre}" no controla stock: no se traslada.`); return; }
    setError(null);
    setLineas((ls) => (ls.some((l) => l.prod.id === p.id) ? ls : [...ls, { prod: p, stock: null, cantidad: "", manual: false, lotes: {} }]));
    apiFetch<StockProducto>(`/api/productos/${p.id}/stock`)
      .then((s) => setLineas((ls) => ls.map((l) => (l.prod.id === p.id ? { ...l, stock: s } : l))))
      .catch(() => {});
  }
  const cambiar = (id: string, patch: Partial<Linea>) => setLineas((ls) => ls.map((l) => (l.prod.id === id ? { ...l, ...patch } : l)));

  const num = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(",", ".")));
  const enOrigen = (l: Linea) => l.stock?.depositos.find((d) => d.deposito_id === origenEf);
  const problemas = lineas.map((l) => {
    const disp = Number(enOrigen(l)?.cantidad ?? 0);
    const c = l.manual ? Object.values(l.lotes).reduce((a, v) => a + (num(v) || 0), 0) : num(l.cantidad);
    if (!(c > 0)) return "Cargá la cantidad";
    if (l.stock && c > disp) return `En ${dOrigen?.nombre ?? "el origen"} hay ${cant(disp)}`;
    if (l.manual) {
      const lotes = enOrigen(l)?.lotes ?? [];
      for (const lo of lotes) if ((num(l.lotes[lo.id] ?? "") || 0) > Number(lo.cantidad)) return `Del lote ${lo.numero} hay ${cant(lo.cantidad)}`;
    }
    return null;
  });
  const listo = !!origenEf && !!destino && origenEf !== destino && lineas.length > 0 && problemas.every((p) => !p)
    && (r.motivo_codigo !== "99" || !!r.motivo_descripcion.trim());
  // Lo que todavía falta para poder enviar (se muestra en la barra flotante).
  const falta = !destino ? "Elegí el depósito de destino"
    : !lineas.length ? "Agregá al menos un producto"
    : problemas.some(Boolean) ? (problemas.filter(Boolean).length > 1 ? `Revisá ${problemas.filter(Boolean).length} productos: falta la cantidad o supera el stock` : `${lineas[problemas.findIndex(Boolean)].prod.nombre}: ${problemas.find(Boolean)}`)
    : r.motivo_codigo === "99" && !r.motivo_descripcion.trim() ? "Escribí cuál es el motivo del traslado"
    : null;

  async function guardar() {
    if (!listo || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ id: string; numero: string; remision_numero: string }>("/api/inventario/traslados", {
        method: "POST",
        body: JSON.stringify({
          ...r,
          motivo_codigo: Number(r.motivo_codigo),
          fecha_fin_estimada: r.fecha_fin_estimada || null,
          deposito_origen_id: origenEf,
          deposito_destino_id: destino,
          idempotency_key: idem,
          items: lineas.map((l) => l.manual
            ? {
                producto_id: l.prod.id,
                cantidad: Object.values(l.lotes).reduce((a, v) => a + (num(v) || 0), 0),
                lotes: Object.entries(l.lotes).filter(([, v]) => num(v) > 0).map(([k, v]) => ({ lote_id: k === "sin" ? null : k, cantidad: num(v) })),
              }
            : { producto_id: l.prod.id, cantidad: num(l.cantidad) }),
        }),
      });
      invalidarLista("/api/productos");
      invalidarLista("/api/inventario/movimientos");
      invalidarLista("/api/inventario/traslados");
      invalidarLista("/api/inventario/vencimientos");
      invalidarDepositos();
      setHecho(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Después de enviar: un traslado nuevo (mismo origen y destino, datos del transporte limpios). */
  function otro() {
    setHecho(null);
    setLineas([]);
    setIdem(crypto.randomUUID());
    setR((p) => ({ ...p, fecha_inicio: hoyPY(), fecha_fin_estimada: "", observacion: "" }));
    router.replace("/inventario/traslados/nuevo");
  }

  if (me && me.rol !== "ADMIN") {
    return <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Solo un administrador crea traslados. Los traslados hacia tu sucursal los recibís desde <Link href="/inventario/traslados" className="font-semibold text-[var(--brand)] hover:underline">Traslados</Link>.</p>;
  }

  if (hecho) {
    return (
      <div className="mx-auto max-w-lg space-y-5 py-10 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-8 ring-emerald-50/50"><CheckCircle2 className="h-7 w-7" /></div>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Traslado <span className="font-mono">{hecho.numero}</span> enviado</h1>
          <p className="mt-1 text-sm text-slate-500">
            Salió de <strong>{dOrigen?.nombre}</strong> y queda en tránsito hasta que se reciba en <strong>{dDestino?.nombre}</strong>.
            Nota de remisión <span className="font-mono font-semibold">{hecho.remision_numero}</span>.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2 max-sm:flex-col max-sm:[&>*]:min-h-11">
          <button onClick={() => void descargarArchivo(`/api/inventario/traslados/${hecho.id}/remision`, `remision-${hecho.remision_numero}.pdf`)} className={BOTON_PRIMARIO} style={{ backgroundColor: TEAL }}>
            <FileDown className="h-4 w-4" /> Descargar nota de remisión
          </button>
          <Link href={`/inventario/traslados?ver=${hecho.id}`} className={BOTON_SECUNDARIO}>Ver el traslado</Link>
          <button onClick={otro} className={BOTON_SECUNDARIO}>Otro traslado</button>
        </div>
      </div>
    );
  }

  const sinStock = (l: Linea) => l.stock && Number(enOrigen(l)?.cantidad ?? 0) <= 0;

  return (
    <div className="space-y-5 max-lg:pb-28 sm:space-y-6">
      <Cabecera kicker="Inventario · Traslados" titulo="Nuevo traslado" subtitulo="La mercadería sale del origen al guardar y entra al destino cuando la reciben">
        <Link href="/inventario/traslados" className={BOTON_SECUNDARIO}><ArrowLeft className="h-4 w-4" /> Traslados</Link>
      </Cabecera>

      {/* Origen → destino */}
      <section className="rounded-2xl border bg-white p-4 shadow-sm sm:p-5" style={{ borderColor: `${TEAL}33` }}>
        <div className="grid items-end gap-3 max-md:gap-2 md:grid-cols-[1fr_auto_1fr]">
          <div className="min-w-0">
            <span className={ET}>Sale de</span>
            <Select value={origenEf} onChange={(v) => { setOrigen(v); if (v === destino) setDestino(""); }} block etiqueta="Sale de" options={opcionesDepositos(deps.datos)} />
          </div>
          <button type="button" title="Invertir" aria-label="Invertir origen y destino" disabled={!destino} onClick={() => { const o = origenEf; setOrigen(destino); setDestino(o); }}
            className="mb-0.5 inline-flex h-10 w-10 items-center justify-center self-end rounded-xl border border-slate-200 text-slate-500 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:opacity-40 max-md:mb-0 max-md:h-11 max-md:w-11 max-md:rotate-90 max-md:justify-self-center">
            <ArrowLeftRight className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <span className={ET}>Llega a</span>
            <Select value={destino} onChange={setDestino} block etiqueta="Llega a" options={[["", "Elegí el depósito de destino"], ...opcionesDepositos(deps.datos, { excluir: origenEf })]} />
          </div>
        </div>
      </section>

      {/* Productos */}
      <section className="rounded-2xl border bg-white shadow-sm" style={{ borderColor: `${TEAL}33` }}>
        <div className="border-b px-4 py-4 sm:px-5" style={{ borderColor: `${TEAL}22` }}>
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Productos</h2>
          <BuscadorProductos onElegir={agregar} deposito={dOrigen ? { id: dOrigen.id, nombre: dOrigen.nombre } : null} conStockPrimero agregados={lineas.map((l) => l.prod.id)} />
        </div>
        {lineas.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-400">
            <Truck className="mx-auto mb-2 h-6 w-6 text-slate-300" />
            Buscá los productos que se trasladan.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {lineas.map((l, i) => {
              const dep = enOrigen(l);
              const lotes = dep?.lotes ?? [];
              const conLotes = !!l.prod.controla_lotes;
              return (
                <li key={l.prod.id} className="px-4 py-3 sm:px-5">
                  {/* Celular: nombre + quitar (44 px) arriba; modo de lotes y cantidad debajo, a todo el ancho */}
                  <div className="flex flex-wrap items-center gap-3 max-sm:gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-3 max-sm:basis-[calc(100%-3.25rem)]">
                      <MiniaturaProducto url={l.prod.imagen_url} nombre={l.prod.nombre} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-slate-800 max-sm:whitespace-normal max-sm:[overflow-wrap:anywhere]">{l.prod.nombre}</p>
                        <p className="text-[11px] text-slate-500">
                          <span className="font-mono">{l.prod.sku}</span> ·{" "}
                          {l.stock ? <>en {dOrigen?.nombre ?? "origen"}: <strong className={sinStock(l) ? "text-rose-600" : "text-slate-700"}>{cant(dep?.cantidad ?? 0)}</strong> {unidadCorta(l.prod.unidad_medida ?? "Unidad")}</> : <Loader2 className="inline h-3 w-3 animate-spin" />}
                        </p>
                      </div>
                    </div>
                    {conLotes ? (
                      <div className="flex rounded-lg bg-slate-100 p-0.5 text-[11px] font-semibold max-sm:order-2 max-sm:w-full max-sm:text-xs">
                        <button type="button" onClick={() => cambiar(l.prod.id, { manual: false })} className={`rounded-md px-2 py-1 max-sm:min-h-10 max-sm:flex-1 ${!l.manual ? "bg-white text-[var(--brand)] shadow-sm" : "text-slate-500"}`}>Vence primero</button>
                        <button type="button" onClick={() => cambiar(l.prod.id, { manual: true })} className={`rounded-md px-2 py-1 max-sm:min-h-10 max-sm:flex-1 ${l.manual ? "bg-white text-[var(--brand)] shadow-sm" : "text-slate-500"}`}>Elegir lotes</button>
                      </div>
                    ) : null}
                    {!l.manual ? (
                      <input inputMode="decimal" enterKeyHint="done" aria-label={`Cantidad de ${l.prod.nombre}`} value={l.cantidad} onChange={(e) => cambiar(l.prod.id, { cantidad: e.target.value.replace(/[^\d.,]/g, "") })}
                        placeholder="Cantidad" autoFocus={i === lineas.length - 1}
                        className={`w-28 rounded-xl border px-3 py-2 text-right text-sm tabular-nums outline-none focus:ring-4 max-sm:order-2 max-sm:min-h-11 max-sm:min-w-0 max-sm:flex-1 ${problemas[i] && l.cantidad ? "border-rose-300 focus:ring-rose-100" : "border-slate-200 focus:border-[var(--brand)] focus:ring-[var(--brand-100)]"}`} />
                    ) : null}
                    <button type="button" onClick={() => setLineas((ls) => ls.filter((x) => x.prod.id !== l.prod.id))} title="Quitar" aria-label={`Quitar ${l.prod.nombre}`} className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 max-sm:order-1 max-sm:inline-flex max-sm:h-11 max-sm:w-11 max-sm:items-center max-sm:justify-center max-sm:self-start">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  {conLotes && l.manual ? (
                    <div className="mt-2 overflow-hidden rounded-xl border border-slate-100">
                      {lotes.length === 0 && !(Number(dep?.sin_lote ?? 0) > 0) ? (
                        <p className="px-3 py-2 text-xs text-slate-500">No hay lotes con unidades en {dOrigen?.nombre}.</p>
                      ) : (
                        <table className="w-full text-xs">
                          <tbody className="divide-y divide-slate-100">
                            {lotes.map((lo) => (
                              <tr key={lo.id}>
                                <td className="px-3 py-1.5 max-sm:py-2">
                                  <span className="font-mono font-semibold text-slate-700">{lo.numero}</span>{" "}
                                  <span className="text-slate-400 max-sm:block">· vence {dia(lo.vencimiento)}{lo.vencimiento < hoyPY() ? " (vencido)" : ""}<span className="sm:hidden"> · hay {cant(lo.cantidad)}</span></span>
                                </td>
                                <td className="px-3 py-1.5 text-right text-slate-500 max-sm:hidden">hay {cant(lo.cantidad)}</td>
                                <td className="w-28 px-3 py-1.5 text-right max-sm:py-2">
                                  <input inputMode="decimal" enterKeyHint="next" aria-label={`Cantidad del lote ${lo.numero}`} value={l.lotes[lo.id] ?? ""} placeholder="0" onChange={(e) => cambiar(l.prod.id, { lotes: { ...l.lotes, [lo.id]: e.target.value.replace(/[^\d.,]/g, "") } })}
                                    className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-right tabular-nums outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-100)] max-sm:min-h-11" />
                                </td>
                              </tr>
                            ))}
                            {Number(dep?.sin_lote ?? 0) > 0 ? (
                              <tr>
                                <td className="px-3 py-1.5 text-slate-600 max-sm:py-2">Sin lote<span className="block text-slate-400 sm:hidden">hay {cant(dep?.sin_lote ?? 0)}</span></td>
                                <td className="px-3 py-1.5 text-right text-slate-500 max-sm:hidden">hay {cant(dep?.sin_lote ?? 0)}</td>
                                <td className="w-28 px-3 py-1.5 text-right max-sm:py-2">
                                  <input inputMode="decimal" enterKeyHint="next" aria-label="Cantidad sin lote" value={l.lotes.sin ?? ""} placeholder="0" onChange={(e) => cambiar(l.prod.id, { lotes: { ...l.lotes, sin: e.target.value.replace(/[^\d.,]/g, "") } })}
                                    className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-right tabular-nums outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-100)] max-sm:min-h-11" />
                                </td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ) : conLotes ? (
                    <p className="mt-1 text-[11px] text-slate-400">Salen primero los lotes vigentes que vencen antes; llegan al destino con el mismo número y vencimiento.</p>
                  ) : null}
                  {problemas[i] && (l.cantidad || l.manual) ? <p className="mt-1 text-[11px] font-medium text-rose-600">{problemas[i]}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Nota de remisión */}
      <section className="rounded-2xl border bg-white p-4 shadow-sm sm:p-5" style={{ borderColor: `${TEAL}33` }}>
        <h2 className="text-sm font-semibold text-slate-900">Nota de remisión</h2>
        <p className="mb-4 text-[11px] text-slate-500">Los datos que pide la remisión (SIFEN). Numeración de {dOrigen?.sucursal ?? "la sucursal de origen"}.</p>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          <div className="min-w-0 sm:col-span-2">
            <span className={ET}>Motivo del traslado</span>
            <Select value={r.motivo_codigo} onChange={(v) => setRem("motivo_codigo", v)} block etiqueta="Motivo del traslado" options={MOTIVOS_TRASLADO.map(([k, v]): [string, string] => [String(k), v])} />
          </div>
          <div className="block">
            <span className={ET}>Fecha de inicio</span>
            <SelectorFecha block etiqueta="Fecha de inicio" value={r.fecha_inicio} onChange={(v) => setRem("fecha_inicio", v)} />
          </div>
          <div className="block">
            <span className={ET}>Llegada estimada <span className="font-normal text-slate-400">(opc.)</span></span>
            <SelectorFecha block etiqueta="Llegada estimada" value={r.fecha_fin_estimada} min={r.fecha_inicio} onChange={(v) => setRem("fecha_fin_estimada", v)} />
          </div>
          {r.motivo_codigo === "99" ? (
            <label className="block sm:col-span-2 md:col-span-4">
              <span className={ET}>¿Cuál es el motivo? *</span>
              <input enterKeyHint="next" value={r.motivo_descripcion} onChange={(e) => setRem("motivo_descripcion", e.target.value)} maxLength={200} className={INPUT} />
            </label>
          ) : null}
          <label className="block md:col-span-3">
            <span className={ET}>Punto de partida</span>
            <input enterKeyHint="next" value={r.punto_partida} onChange={(e) => setRem("punto_partida", e.target.value)} maxLength={200} placeholder={dOrigen ? sucursalDir(deps.datos, dOrigen.sucursal_id) : ""} className={INPUT} />
          </label>
          <label className="block">
            <span className={ET}>Ciudad</span>
            <input enterKeyHint="next" value={r.ciudad_partida} onChange={(e) => setRem("ciudad_partida", e.target.value)} maxLength={80} placeholder={dOrigen ? sucursalCiudad(deps.datos, dOrigen.sucursal_id) : ""} className={INPUT} />
          </label>
          <label className="block md:col-span-3">
            <span className={ET}>Punto de llegada</span>
            <input enterKeyHint="next" value={r.punto_llegada} onChange={(e) => setRem("punto_llegada", e.target.value)} maxLength={200} placeholder={dDestino ? sucursalDir(deps.datos, dDestino.sucursal_id) : ""} className={INPUT} />
          </label>
          <label className="block">
            <span className={ET}>Ciudad</span>
            <input enterKeyHint="next" value={r.ciudad_llegada} onChange={(e) => setRem("ciudad_llegada", e.target.value)} maxLength={80} placeholder={dDestino ? sucursalCiudad(deps.datos, dDestino.sucursal_id) : ""} className={INPUT} />
          </label>
          <p className="-mt-1 text-[11px] text-slate-400 sm:col-span-2 md:col-span-4">Vacíos = la dirección cargada en cada sucursal.</p>
        </div>

        <h3 className="mb-3 mt-5 text-xs font-semibold uppercase tracking-wider text-slate-500">Transporte <span className="font-normal normal-case tracking-normal text-slate-400">(opcional)</span></h3>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          <label className="block"><span className={ET}>Vehículo (marca)</span><input enterKeyHint="next" value={r.vehiculo_marca} onChange={(e) => setRem("vehiculo_marca", e.target.value)} maxLength={60} placeholder="Ej. Toyota Hilux" className={INPUT} /></label>
          <label className="block"><span className={ET}>Chapa</span><input enterKeyHint="next" autoCapitalize="characters" value={r.vehiculo_chapa} onChange={(e) => setRem("vehiculo_chapa", e.target.value.toUpperCase())} maxLength={20} placeholder="ABC 123" className={`${INPUT} font-mono uppercase`} /></label>
          <label className="block"><span className={ET}>Chofer</span><input enterKeyHint="next" autoComplete="off" value={r.chofer_nombre} onChange={(e) => setRem("chofer_nombre", e.target.value)} maxLength={120} className={INPUT} /></label>
          <label className="block"><span className={ET}>CI del chofer</span><input enterKeyHint="next" autoComplete="off" value={r.chofer_documento} onChange={(e) => setRem("chofer_documento", e.target.value)} maxLength={20} className={INPUT} /></label>
          <label className="block md:col-span-2"><span className={ET}>Transportista (si es una empresa)</span><input enterKeyHint="next" autoComplete="off" value={r.transportista_nombre} onChange={(e) => setRem("transportista_nombre", e.target.value)} maxLength={120} className={INPUT} /></label>
          <label className="block"><span className={ET}>RUC del transportista</span><input enterKeyHint="next" autoComplete="off" value={r.transportista_ruc} onChange={(e) => setRem("transportista_ruc", e.target.value)} maxLength={20} className={INPUT} /></label>
        </div>
        <label className="mt-3 block">
          <span className={ET}>Observación <span className="font-normal text-slate-400">(sale en la remisión)</span></span>
          <input enterKeyHint="done" value={r.observacion} onChange={(e) => setRem("observacion", e.target.value)} maxLength={1000} className={INPUT} />
        </label>
      </section>

      <BarraEnvio
        chico={dOrigen && dDestino ? <>{dOrigen.nombre} → {dDestino.nombre}</> : "Origen y destino"}
        grande={lineas.length ? <>{lineas.length} {lineas.length === 1 ? "producto" : "productos"}</> : "Nuevo traslado"}
        resumen={lineas.length ? <>{lineas.length} {lineas.length === 1 ? "producto" : "productos"}{dOrigen && dDestino ? <> · {dOrigen.nombre} → {dDestino.nombre}</> : null}</> : null}
        falta={falta} error={error} etiqueta="Enviar traslado" icono={<Truck className="h-4 w-4 shrink-0" />}
        listo={listo} busy={busy} onEnviar={() => void guardar()} />
    </div>
  );
}

function sucursalDir(d: ReturnType<typeof useDepositos>["datos"], id: string) {
  const s = d?.sucursales.find((x) => x.id === id);
  return s?.direccion || s?.nombre || "";
}
function sucursalCiudad(d: ReturnType<typeof useDepositos>["datos"], id: string) {
  return d?.sucursales.find((x) => x.id === id)?.ciudad || "";
}
