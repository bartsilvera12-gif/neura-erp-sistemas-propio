"use client";

/**
 * /inventario/categorias — Categorías de productos en LISTA LIMPIA: una fila por categoría
 * con su color, sus subcategorías como etiquetas (del mismo color) y la cantidad de
 * productos. Al tocar la categoría se despliega su árbol (subcategorías y cuántos productos tienen).
 * Las acciones viven en el menú ⋯ (y en cada etiqueta), así la pantalla no se
 * llena de botones repetidos. Dos niveles: Bebidas › Gaseosas.
 * No hay borrado (como Ferretería): una categoría con productos se desactiva.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Ban, CheckCircle2, ChevronRight, Loader2, MoreHorizontal, Palette, Pencil, Plus, Search, Tags, X } from "lucide-react";
import { coincide } from "@/erp2/lib/busqueda";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { invalidar } from "@/erp2/lib/api/cache-cliente";
import { useUsuario } from "@/erp2/lib/sesion/ContextoUsuario";
import { clienteConfig } from "@/erp2/cliente.config";
import { Select } from "@/erp2/components/Select";
import { EncabezadoPagina } from "@/erp2/components/EncabezadoPagina";
import { ColorPicker } from "@/erp2/components/ColorPicker";
import { ALTO_MAX_MODAL, CapaModal } from "@/erp2/components/CapaModal";
import { MenuAcciones, type ItemMenu } from "@/erp2/components/MenuAcciones";
import { ArbolCategoria } from "@/erp2/modules/inventario/ArbolCategoria";
import { colorLibre, coloresPorCategoria, tonosDe, type Categoria } from "@/erp2/modules/inventario/categorias";
import { useEstaciones } from "@/erp2/modules/mesas/useEstaciones";
import { nombreEstacion, type Estacion } from "@/erp2/modules/mesas/tipos";

const TEAL = clienteConfig.color;
const INPUT = "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";
const ET = "mb-1 block text-xs font-medium text-slate-600";

/** El contenedor que scrollea (en el layout es el <main>, no la ventana). */
function contenedorScroll(el: HTMLElement): HTMLElement {
  let e: HTMLElement | null = el.parentElement;
  while (e) {
    const o = getComputedStyle(e).overflowY;
    if (o === "auto" || o === "scroll") return e;
    e = e.parentElement;
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement;
}

// Última lista vista en esta pestaña: al volver a la pantalla se pinta en el primer render
// (sin "Cargando") y se refresca igual que antes. Se olvida si cambia el usuario.
let ultimaVista: { usuario: string | undefined; categorias: Categoria[]; conteo: Record<string, number> } | null = null;

const sinTildes = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const nProductos = (n: number) => (n === 1 ? "1 producto" : `${n} productos`);

export default function CategoriasPage() {
  const usuario = useUsuario();
  const vista = ultimaVista && usuario && ultimaVista.usuario === usuario.usuarioId ? ultimaVista : null;
  const [categorias, setCategorias] = useState<Categoria[]>(vista?.categorias ?? []);
  const [conteo, setConteo] = useState<Record<string, number>>(vista?.conteo ?? {});
  const [cargando, setCargando] = useState(!vista);
  const esAdmin = usuario?.rol === "ADMIN";
  const usuarioId = useRef(usuario?.usuarioId);
  usuarioId.current = usuario?.usuarioId;
  const [nombre, setNombre] = useState("");
  const [padre, setPadre] = useState("");
  const [colorNuevo, setColorNuevo] = useState<string | null>(null); // null = el libre que propone el sistema
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<Categoria | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [agregandoEn, setAgregandoEn] = useState<string | null>(null);
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const relleno = useRef<HTMLDivElement>(null);
  // Receta 70: estación de cocina de cada categoría (para las comandas de las mesas).
  const estaciones = useEstaciones() ?? [];
  const estacionPorId = useMemo(() => new Map(estaciones.map((e) => [e.id, e])), [estaciones]);

  // "+ Subcategoría": abre el árbol de la categoría y suma una rama para escribir la nueva.
  function agregarSub(id: string) {
    setAgregandoEn(id);
    setAbiertas((s) => new Set(s).add(id));
  }

  // Al CERRAR un árbol la página se achica y el navegador sube la vista sola (la fila
  // tocada salta). Para que no pase: se mide la fila antes y después y, si se movió, se
  // agrega espacio abajo y se corrige el scroll, así queda exactamente donde estaba.
  function alternar(id: string, fila?: HTMLElement) {
    const cerrando = abiertas.has(id);
    if (cerrando && agregandoEn === id) setAgregandoEn(null);
    const cambiar = () => setAbiertas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const sc = fila ? contenedorScroll(fila) : null;
    if (!cerrando || !fila || !sc || !relleno.current) { cambiar(); return; }
    const antes = fila.getBoundingClientRect().top;
    flushSync(cambiar);
    const corrimiento = fila.getBoundingClientRect().top - antes;
    if (corrimiento > 0.5) {
      relleno.current.style.height = `${relleno.current.offsetHeight + corrimiento}px`;
      sc.scrollTop += corrimiento;
    }
  }

  // El espacio extra se va solo a medida que el usuario sube: se saca solo lo que sobra
  // por encima del scroll actual, así sacarlo nunca mueve la vista.
  useEffect(() => {
    const el = relleno.current;
    const sc = el ? contenedorScroll(el) : null;
    if (!el || !sc) return;
    const recortar = () => {
      const h = el.offsetHeight;
      if (!h) return;
      // Arriba de todo no hay nada que mover; si no, solo lo que queda debajo del scroll.
      if (sc.scrollTop <= 0) { el.style.height = "0px"; return; }
      const sobra = sc.scrollHeight - sc.clientHeight - sc.scrollTop;
      if (sobra > 0) el.style.height = `${Math.max(0, h - sobra)}px`;
    };
    let frame = 0;
    const alScroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(recortar); };
    sc.addEventListener("scroll", alScroll, { passive: true });
    sc.addEventListener("scrollend", recortar);
    return () => { cancelAnimationFrame(frame); sc.removeEventListener("scroll", alScroll); sc.removeEventListener("scrollend", recortar); };
  }, []);

  // Siempre fresco (esta pantalla es la que las cambia); de paso se olvida el cache
  // compartido de categorías para que Inventario y Reportes vean los cambios.
  const cargar = useCallback(async () => {
    invalidar("/api/inventario/categorias");
    try {
      const r = await apiFetch<{ categorias: Categoria[]; conteo?: Record<string, number> }>("/api/inventario/categorias?todas=1&conteo=1");
      setCategorias(r.categorias);
      setConteo(r.conteo ?? {});
      ultimaVista = { usuario: usuarioId.current, categorias: r.categorias, conteo: r.conteo ?? {} };
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function crearCategoria(nombreNuevo: string, parentId: string | null, color: string | null = null) {
    await apiFetch("/api/inventario/categorias", {
      method: "POST",
      body: JSON.stringify({ nombre: nombreNuevo.trim(), parent_id: parentId, color: parentId ? null : color }),
    });
    await cargar();
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    setCreando(true);
    setError(null);
    try {
      await crearCategoria(nombre, padre || null, colorElegido);
      setNombre("");
      setColorNuevo(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreando(false);
    }
  }

  async function toggle(c: Categoria) {
    setError(null);
    try {
      await apiFetch(`/api/inventario/categorias/${c.id}`, { method: "PATCH", body: JSON.stringify({ activo: !c.activo }) });
      await cargar();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Principales ordenadas con sus subcategorías. Una sub cuya madre no está (datos viejos)
  // se muestra como principal para que no desaparezca.
  const arbol = useMemo(() => {
    const ids = new Set(categorias.map((c) => c.id));
    const orden = [...categorias].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    const raices = orden.filter((c) => !c.parent_id || !ids.has(c.parent_id));
    return raices.map((r) => ({ cat: r, hijas: orden.filter((c) => c.parent_id === r.id) }));
  }, [categorias]);

  const colores = useMemo(() => coloresPorCategoria(categorias), [categorias]);
  const q = sinTildes(busqueda.trim());
  const visibles = useMemo(() => {
    if (!q) return arbol;
    // Búsqueda inteligente (sin tildes, errores de tipeo): la categoría o alguna subcategoría.
    return arbol.filter(({ cat, hijas }) => coincide(busqueda, { principal: cat.nombre }) || hijas.some((h) => coincide(busqueda, { principal: h.nombre })));
  }, [arbol, q, busqueda]);

  const principalesActivas = categorias.filter((c) => !c.parent_id && c.activo);
  const padreElegido = principalesActivas.find((c) => c.id === padre);
  const colorElegido = colorNuevo ?? colorLibre(categorias);
  const totalSubs = categorias.filter((c) => c.parent_id).length;
  const hexDe = (id: string) => colores.get(id)?.dot ?? "#94a3b8";

  return (
    <div className="space-y-5 pb-10 sm:space-y-6">
      <EncabezadoPagina
        volver={{ href: "/inventario/panel", label: "Inventario" }}
        kicker="Operaciones · Stock"
        titulo="Categorías de productos"
        subtitulo={<>Ordená tus productos en categorías y, si querés, en subcategorías. Ej: <strong className="font-semibold text-slate-700">Bebidas › Gaseosas</strong>.</>}
      />

      {esAdmin ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="block h-5 w-1 rounded-full" style={{ backgroundColor: TEAL }} />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">Nueva categoría</h2>
          </div>
          <form onSubmit={crear} className="grid gap-3 md:grid-cols-[2fr_1.5fr_1fr_auto] md:items-end">
            <label className="block">
              <span className={ET}>Nombre</span>
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} required placeholder={padreElegido ? "Ej: Gaseosas" : "Ej: Bebidas"} className={INPUT} />
            </label>
            <label className="block">
              <span className={ET}>Ubicación</span>
              <Select
                value={padre}
                onChange={setPadre}
                block
                options={[["", "Es una categoría principal"], ...principalesActivas.map((c): [string, string] => [c.id, `Dentro de ${c.nombre}`])]}
              />
            </label>
            <div>
              <span className={ET}>Color</span>
              {padreElegido ? (
                <p className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs text-slate-500 md:h-[42px] md:min-h-0" title="Las subcategorías usan el color de su categoría">
                  <span className="h-4 w-4 shrink-0 rounded-md" style={{ backgroundColor: hexDe(padreElegido.id) }} />
                  El de {padreElegido.nombre}
                </p>
              ) : (
                <ColorPicker value={colorElegido} onChange={setColorNuevo} block />
              )}
            </div>
            <button type="submit" disabled={creando || !nombre.trim()} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-white md:h-[42px] transition hover:brightness-95 disabled:opacity-50" style={{ backgroundColor: TEAL }}>
              {creando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {creando ? "Creando..." : padreElegido ? "Crear subcategoría" : "Crear categoría"}
            </button>
          </form>
          {padreElegido && nombre.trim() ? (
            <p className="mt-2 text-[11px] text-slate-400">Va a quedar como <strong className="font-semibold text-slate-600">{padreElegido.nombre} › {nombre.trim()}</strong></p>
          ) : null}
        </section>
      ) : null}

      {error ? (
        <div className="flex items-start justify-between gap-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Cerrar" className="text-rose-400 hover:text-rose-600"><X className="h-4 w-4" /></button>
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-100 px-3 py-3 sm:px-5">
          <div className="relative min-w-0 flex-1 basis-full sm:basis-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input type="search" enterKeyHint="search" aria-label="Buscar categorías" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar categoría o subcategoría..." className={`${INPUT} pl-9`} />
          </div>
          <p className="text-xs text-slate-500">
            {arbol.length} {arbol.length === 1 ? "categoría" : "categorías"} · {totalSubs} {totalSubs === 1 ? "subcategoría" : "subcategorías"}
          </p>
        </div>

        {cargando ? (
          <p className="px-5 py-12 text-center text-sm text-slate-400">Cargando...</p>
        ) : categorias.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <Tags className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm text-slate-500">Todavía no cargaste categorías. Creá la primera arriba.</p>
          </div>
        ) : visibles.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-400">Ninguna categoría coincide con «{busqueda}».</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visibles.map(({ cat, hijas }) => {
              const hex = hexDe(cat.id);
              const tono = tonosDe(hex);
              const abierta = abiertas.has(cat.id);
              const total = (conteo[cat.id] ?? 0) + hijas.reduce((a, h) => a + (conteo[h.id] ?? 0), 0);
              const menu: ItemMenu[] = [
                ...(cat.activo && !cat.parent_id ? [{ etiqueta: "Agregar subcategoría", icono: <Plus className="h-4 w-4" />, onClick: () => agregarSub(cat.id) }] : []),
                { etiqueta: "Editar", icono: <Pencil className="h-4 w-4" />, onClick: () => setEditando(cat) },
                ...(!cat.parent_id ? [{ etiqueta: "Cambiar color", icono: <Palette className="h-4 w-4" />, onClick: () => setEditando(cat) }] : []),
                cat.activo
                  ? { etiqueta: "Desactivar", icono: <Ban className="h-4 w-4" />, onClick: () => toggle(cat), tono: "peligro" as const }
                  : { etiqueta: "Activar", icono: <CheckCircle2 className="h-4 w-4" />, onClick: () => toggle(cat), tono: "exito" as const },
              ];
              return (
                <li key={cat.id}>
                  <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 py-2 pl-2 pr-2 transition-colors hover:bg-slate-50/70 sm:px-5 sm:py-3.5 ${abierta ? "bg-slate-50/70" : ""}`}>
                  {/* Nombre y cantidad: al tocarlo se despliega el árbol de la categoría. En celular
                      el menú ⋯ va en la misma línea (44 px), a la derecha. */}
                  <div className="flex w-full min-w-0 items-center gap-1 sm:w-56">
                  <button
                    type="button"
                    onClick={(e) => alternar(cat.id, e.currentTarget)}
                    aria-expanded={abierta}
                    title={abierta ? "Ocultar subcategorías" : "Ver subcategorías"}
                    className={`group flex min-h-11 w-full min-w-0 flex-1 items-center gap-3 rounded-lg px-1.5 text-left sm:min-h-0 sm:px-0 ${cat.activo ? "" : "opacity-50"}`}
                  >
                    <ChevronRight className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 group-hover:text-slate-700 ${abierta ? "rotate-90" : ""}`} />
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: hex, boxShadow: `0 0 0 4px ${tono.fondo}` }} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 [overflow-wrap:anywhere] sm:truncate">
                        <Resaltado texto={cat.nombre} q={q} />
                        {!cat.activo ? <EtiquetaInactiva /> : null}
                      </p>
                      <p className="text-xs text-slate-500">
                        {nProductos(total)}
                        {cat.estacion_id && estacionPorId.get(cat.estacion_id) ? (
                          <span className="ml-1.5 whitespace-nowrap text-slate-400" title="Estación de cocina">· {nombreEstacion(estacionPorId.get(cat.estacion_id)!)}</span>
                        ) : null}
                      </p>
                    </div>
                  </button>
                  {esAdmin ? (
                    <MenuAcciones
                      items={menu}
                      etiqueta={`Acciones de ${cat.nombre}`}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition active:bg-slate-100 sm:hidden"
                    >
                      <MoreHorizontal className="h-5 w-5" />
                    </MenuAcciones>
                  ) : null}
                  </div>

                  {/* Cerrada: las subcategorías como etiquetas. Abierta: se ven en el árbol de abajo. */}
                  <div className={`min-w-0 flex-1 flex-wrap items-center gap-1.5 max-sm:pl-[42px] ${abierta ? "hidden sm:flex" : "flex"}`}>
                    {abierta ? null : hijas.length ? (
                      hijas.map((h) => (
                        <EtiquetaSub
                          key={h.id}
                          sub={h}
                          tono={tono}
                          cantidad={conteo[h.id] ?? 0}
                          q={q}
                          esAdmin={esAdmin}
                          onEditar={() => setEditando(h)}
                          onToggle={() => toggle(h)}
                        />
                      ))
                    ) : (
                      <span className="text-xs text-slate-400">Sin subcategorías</span>
                    )}
                  </div>

                  {esAdmin ? (
                    <div className={`ml-auto flex shrink-0 items-center gap-1.5 ${cat.activo && !cat.parent_id ? "" : "max-sm:hidden"}`}>
                      {cat.activo && !cat.parent_id ? (
                        <button
                          onClick={() => agregarSub(cat.id)}
                          className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:border-[var(--brand)] hover:text-[var(--brand)] max-sm:min-h-11 max-sm:px-3.5 max-sm:text-[13px]"
                        >
                          <Plus className="h-3 w-3" /> Subcategoría
                        </button>
                      ) : null}
                      <MenuAcciones
                        items={menu}
                        etiqueta={`Acciones de ${cat.nombre}`}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 max-sm:hidden"
                      >
                        <MoreHorizontal className="h-5 w-5" />
                      </MenuAcciones>
                    </div>
                  ) : null}
                  </div>
                  {abierta ? (
                    <div className="border-t border-slate-100 bg-slate-50/60 sm:pl-10">
                      <ArbolCategoria
                        categoria={cat}
                        hijas={hijas}
                        conteo={conteo}
                        tono={tono}
                        renderSub={(h) => (
                          <EtiquetaSub
                            sub={h}
                            tono={tono}
                            q={q}
                            esAdmin={esAdmin}
                            onEditar={() => setEditando(h)}
                            onToggle={() => toggle(h)}
                          />
                        )}
                        extra={
                          agregandoEn === cat.id ? (
                            <NuevaSub
                              madre={cat.nombre}
                              onCancelar={() => setAgregandoEn(null)}
                              onCrear={async (n) => { await crearCategoria(n, cat.id); setAgregandoEn(null); }}
                            />
                          ) : undefined
                        }
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div ref={relleno} aria-hidden style={{ height: 0 }} />

      {editando ? (
        <EditarCategoria
          categoria={editando}
          categorias={categorias}
          estaciones={estaciones}
          colorActual={colores.get(editando.id)?.dot}
          onClose={() => setEditando(null)}
          onGuardado={() => { setEditando(null); void cargar(); }}
        />
      ) : null}
    </div>
  );
}

/** Subcategoría como etiqueta del color de su categoría; al tocarla, sus acciones. */
function EtiquetaSub({ sub, tono, cantidad, q, esAdmin, onEditar, onToggle }: {
  sub: Categoria;
  tono: ReturnType<typeof tonosDe>;
  cantidad?: number;
  q: string;
  esAdmin: boolean;
  onEditar: () => void;
  onToggle: () => void;
}) {
  const resaltar = !!q && coincide(q, { principal: sub.nombre });
  const contenido = (
    <>
      <Resaltado texto={sub.nombre} q={q} />
      {cantidad !== undefined ? <span className="font-normal opacity-70">· {cantidad}</span> : null}
      {!sub.activo ? <span className="font-normal opacity-70">(inactiva)</span> : null}
    </>
  );
  const estilo = {
    backgroundColor: sub.activo ? tono.fondo : "transparent",
    borderColor: resaltar ? tono.dot : tono.borde,
    color: tono.texto,
  };
    // En celular cada etiqueta es un objetivo de 44 px; los nombres largos parten en varias líneas.
  const clase = `inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-left text-xs font-semibold [overflow-wrap:anywhere] transition max-sm:min-h-11 max-sm:px-3.5 max-sm:text-[13px] ${sub.activo ? "" : "border-dashed opacity-60"}`;
  if (!esAdmin) return <span className={clase} style={estilo}>{contenido}</span>;
  return (
    <MenuAcciones
      etiqueta={`Acciones de ${sub.nombre}`}
      className={`${clase} hover:brightness-95`}
      style={estilo}
      items={[
        { etiqueta: "Editar", icono: <Pencil className="h-4 w-4" />, onClick: onEditar },
        sub.activo
          ? { etiqueta: "Desactivar", icono: <Ban className="h-4 w-4" />, onClick: onToggle, tono: "peligro" }
          : { etiqueta: "Activar", icono: <CheckCircle2 className="h-4 w-4" />, onClick: onToggle, tono: "exito" },
      ]}
    >
      {contenido}
    </MenuAcciones>
  );
}

function EtiquetaInactiva() {
  return <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-slate-500">Inactiva</span>;
}

/** Marca en el nombre lo que coincide con la búsqueda. */
function Resaltado({ texto, q }: { texto: string; q: string }) {
  if (!q) return <>{texto}</>;
  const i = sinTildes(texto).indexOf(q);
  if (i < 0) return <>{texto}</>;
  return (
    <>
      {texto.slice(0, i)}
      <mark className="rounded bg-amber-100 px-0.5 text-inherit">{texto.slice(i, i + q.length)}</mark>
      {texto.slice(i + q.length)}
    </>
  );
}

/** Campo para crear una subcategoría ahí mismo, en la fila. Enter crea, Esc cancela. */
function NuevaSub({ madre, onCrear, onCancelar }: { madre: string; onCrear: (nombre: string) => Promise<void>; onCancelar: () => void }) {
  const [nombre, setNombre] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCrear(nombre);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={enviar} className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
      <input
        ref={ref}
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") onCancelar(); }}
        placeholder={`Nueva en ${madre}`}
        aria-label={`Nueva subcategoría en ${madre}`}
        className="w-48 rounded-full border border-[var(--brand)] px-3 py-1 text-xs outline-none focus:ring-4 focus:ring-[var(--brand-100)] max-sm:h-11 max-sm:min-w-0 max-sm:w-full max-sm:basis-full"
      />
      <button type="submit" disabled={busy || !nombre.trim()} className="inline-flex items-center justify-center gap-1 rounded-full px-3 py-1 text-xs font-semibold text-white transition hover:brightness-95 disabled:opacity-50 max-sm:min-h-11 max-sm:flex-1 max-sm:text-sm" style={{ backgroundColor: TEAL }}>
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Agregar
      </button>
      <button type="button" onClick={onCancelar} className="rounded-full px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 max-sm:min-h-11 max-sm:flex-1 max-sm:border max-sm:border-slate-200 max-sm:text-sm">Cancelar</button>
      {error ? <span className="w-full text-xs text-rose-600">{error}</span> : null}
    </form>
  );
}

function EditarCategoria({ categoria, categorias, estaciones, colorActual, onClose, onGuardado }: {
  categoria: Categoria;
  categorias: Categoria[];
  estaciones: Estacion[];
  colorActual?: string;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [nombre, setNombre] = useState(categoria.nombre);
  const [codigo, setCodigo] = useState(categoria.codigo ?? "");
  const [padre, setPadre] = useState(categoria.parent_id ?? "");
  const [color, setColor] = useState(categoria.color ?? colorActual ?? "#3b82f6");
  const [estacion, setEstacion] = useState(categoria.estacion_id ?? "");
  const [busy, setBusy] = useState(false);
  // Sin estación propia: una subcategoría usa la de su madre; una principal va a Cocina general.
  const madre = padre ? categorias.find((c) => c.id === padre) : undefined;
  const deMadre = madre?.estacion_id ? estaciones.find((e) => e.id === madre.estacion_id) : undefined;
  const opcionesEstacion: [string, string][] = [
    ["", madre ? `La de ${madre.nombre} (${deMadre ? nombreEstacion(deMadre) : "Cocina general"})` : "Sin estación (Cocina general)"],
    ...estaciones.filter((e) => e.activa || e.id === estacion).map((e): [string, string] => [e.id, `${nombreEstacion(e)}${e.activa ? "" : " (inactiva)"}`]),
  ];
  const [error, setError] = useState<string | null>(null);
  // Dos niveles: una categoría con subcategorías no puede quedar dentro de otra.
  const tieneHijas = categorias.some((c) => c.parent_id === categoria.id);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/inventario/categorias/${categoria.id}`, {
        method: "PATCH",
        body: JSON.stringify({ nombre: nombre.trim(), codigo: codigo.trim() || null, parent_id: padre || null, color: padre ? null : color, estacion_id: estacion || null }),
      });
      onGuardado();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <CapaModal onClose={busy ? undefined : onClose} z="z-[120]" fondo="bg-slate-900/40 backdrop-blur-sm">
        <form onSubmit={guardar} onClick={(e) => e.stopPropagation()} className={`flex w-full max-w-md ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5`} style={{ animation: "rb-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
          <h3 className="shrink-0 px-4 pt-5 text-lg font-semibold text-slate-900 sm:px-6 sm:pt-6">{categoria.parent_id ? "Editar subcategoría" : "Editar categoría"}</h3>
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-4 py-1 sm:px-6">
          <div className="space-y-3">
            <label className="block">
              <span className={ET}>Nombre</span>
              <input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} required className={INPUT} />
            </label>
            <label className="block">
              <span className={ET}>Ubicación</span>
              {tieneHijas ? (
                <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500">Categoría principal (tiene subcategorías adentro)</p>
              ) : (
                <Select
                  value={padre}
                  onChange={setPadre}
                  block
                  options={[["", "Es una categoría principal"], ...categorias.filter((c) => !c.parent_id && c.activo && c.id !== categoria.id).map((c): [string, string] => [c.id, `Dentro de ${c.nombre}`])]}
                />
              )}
            </label>
            {padre ? (
              <p className="text-xs text-slate-500">Como subcategoría, usa el color de su categoría.</p>
            ) : (
              <div>
                <span className={ET}>Color</span>
                <ColorPicker value={color} onChange={setColor} block />
              </div>
            )}
            <label className="block">
              <span className={ET}>Código <span className="font-normal text-slate-400">(opcional)</span></span>
              <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ej: BEB" className={INPUT} />
            </label>
            {estaciones.length ? (
              <div>
                <span className={ET}>Estación de cocina</span>
                <Select value={estacion} onChange={setEstacion} block etiqueta="Estación de cocina" options={opcionesEstacion} />
                <p className="mt-1 text-[11px] text-slate-400">Dónde se preparan los pedidos de las mesas con productos de esta categoría. Un producto puede tener su propia estación.</p>
              </div>
            ) : null}
          </div>
          {error ? <p className="mt-3 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
          </div>
          <div className="flex shrink-0 justify-end gap-2 px-4 pt-4 pb-5 sm:px-6 sm:pb-6 max-sm:[&>button]:flex-1">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
            <button type="submit" disabled={busy || !nombre.trim()} className="rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50" style={{ backgroundColor: TEAL }}>
              {busy ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </form>
    </CapaModal>
  );
}
