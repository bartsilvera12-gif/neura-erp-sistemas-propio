"use client";

/**
 * Propuestas — armador de propuestas comerciales.
 *
 * A la izquierda el catálogo de piezas (servicios) por sección, con buscador; a la derecha la
 * plantilla tal como sale el PDF. Una pieza entra a la plantilla arrastrándola o con su «+».
 * En la plantilla se reordenan arrastrando y se quitan con la ✕. El PDF es esta misma hoja
 * impresa (Descargar PDF → «Guardar como PDF»), así lo que se ve es lo que sale.
 */
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Download, FilePlus2, GripVertical, Pencil, Plus, Save, Search, Trash2, X } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { supabase } from "@/lib/supabase";
import { getClientes, clienteNombre } from "@/lib/clientes/storage";
import type { Cliente } from "@/lib/clientes/types";
import { MODULO_QUE_HABILITA, puedeVerPropuestas } from "@/lib/propuestas/acceso";
import { CONDICIONES_POR_DEFECTO, type Pieza, type PiezaEnPropuesta, type Propuesta } from "@/lib/propuestas/tipos";
import { SelectorBuscable } from "@/app/dashboard/soporte/_ui/SelectorBuscable";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const soloDigitos = (s: string) => s.replace(/[^\d]/g, "");
const miles = (n: number | null) => (n === null ? "" : new Intl.NumberFormat("es-PY").format(n));
const fechaLarga = (d: Date) =>
  new Intl.DateTimeFormat("es-PY", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Asuncion" }).format(d);

type Borrador = {
  id: string | null;
  cliente_id: string | null;
  cliente_nombre: string;
  titulo: string;
  bajada: string;
  piezas: PiezaEnPropuesta[];
  inversion_total: number | null;
  cuota_mensual: number | null;
  condiciones: string;
  clientes_bandera: string[];
};

const VACIO: Borrador = {
  id: null, cliente_id: null, cliente_nombre: "", titulo: "", bajada: "", piezas: [],
  inversion_total: null, cuota_mensual: null, condiciones: CONDICIONES_POR_DEFECTO, clientes_bandera: [],
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithSupabaseSession(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const json = (await res.json().catch(() => null)) as { success?: boolean; data?: T; error?: string } | null;
  if (!res.ok || !json?.success) throw new Error(json?.error || `No se pudo completar (${res.status})`);
  return json.data as T;
}

export default function PropuestasPage() {
  const [acceso, setAcceso] = useState<boolean | null>(null);
  const [piezas, setPiezas] = useState<Pieza[]>([]);
  const [guardadas, setGuardadas] = useState<Propuesta[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [q, setQ] = useState("");
  /** Secciones abiertas a mano. Por defecto vienen todas cerradas; al buscar se abren las que coinciden. */
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({});
  const [b, setB] = useState<Borrador>(VACIO);
  const [sucio, setSucio] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [sobre, setSobre] = useState<number | "fin" | null>(null);
  const [editor, setEditor] = useState<{ id: string | null; seccion: string; titulo: string; descripcion: string } | null>(null);
  const [hoy, setHoy] = useState<Date | null>(null);
  const [banderaTexto, setBanderaTexto] = useState("");
  const arrastre = useRef<{ tipo: "pieza"; id: string } | { tipo: "item"; i: number } | null>(null);

  useEffect(() => { setHoy(new Date()); }, []);

  // El menú ya esconde el módulo; acá se evita mostrar la pantalla a quien entra por la dirección.
  useEffect(() => {
    // Misma regla que el menú: correo de la lista, o el módulo CRM Funnel entre los propios.
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (puedeVerPropuestas(data.session?.user?.email)) return setAcceso(true);
      try {
        const res = await fetchWithSupabaseSession("/api/empresas/module-access", { cache: "no-store" });
        const j = (await res.json()) as { superAdmin?: boolean; slugs?: string[] };
        setAcceso(Boolean(j.superAdmin) || (j.slugs ?? []).includes(MODULO_QUE_HABILITA));
      } catch {
        setAcceso(false);
      }
    })();
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [p, g] = await Promise.all([api<Pieza[]>("/api/propuestas/piezas"), api<Propuesta[]>("/api/propuestas")]);
      setPiezas(p);
      setGuardadas(g);
      // Los clientes bandera casi no cambian: una propuesta nueva arranca con los de la última guardada.
      const ultimos = g[0]?.clientes_bandera ?? [];
      if (ultimos.length) setB((x) => (x.id === null && x.clientes_bandera.length === 0 ? { ...x, clientes_bandera: ultimos } : x));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (acceso !== true) return;
    void cargar();
    void getClientes().then(setClientes).catch(() => setClientes([]));
  }, [acceso, cargar]);

  useEffect(() => {
    if (!aviso) return;
    const t = window.setTimeout(() => setAviso(null), 3500);
    return () => window.clearTimeout(t);
  }, [aviso]);

  const cambiar = useCallback((p: Partial<Borrador>) => { setB((x) => ({ ...x, ...p })); setSucio(true); }, []);

  // ── Catálogo ──────────────────────────────────────────────────────────────────────────
  const secciones = useMemo(() => {
    const n = norm(q.trim());
    const mapa = new Map<string, Pieza[]>();
    for (const p of piezas) {
      if (n && !norm(`${p.titulo} ${p.descripcion} ${p.seccion}`).includes(n)) continue;
      mapa.set(p.seccion, [...(mapa.get(p.seccion) ?? []), p]);
    }
    return [...mapa.entries()];
  }, [piezas, q]);
  const nombresSeccion = useMemo(() => [...new Set(piezas.map((p) => p.seccion))], [piezas]);
  const usadas = useMemo(() => new Set(b.piezas.map((p) => p.pieza_id).filter(Boolean) as string[]), [b.piezas]);

  const agregar = useCallback((p: Pieza, en?: number) => {
    setB((x) => {
      if (x.piezas.some((y) => y.pieza_id === p.id)) return x;
      const nueva = { pieza_id: p.id, titulo: p.titulo, descripcion: p.descripcion };
      const lista = [...x.piezas];
      lista.splice(en ?? lista.length, 0, nueva);
      return { ...x, piezas: lista };
    });
    setSucio(true);
  }, []);

  const mover = useCallback((de: number, a: number) => {
    setB((x) => {
      const lista = [...x.piezas];
      const [it] = lista.splice(de, 1);
      lista.splice(a > de ? a - 1 : a, 0, it);
      return { ...x, piezas: lista };
    });
    setSucio(true);
  }, []);

  /**
   * Dónde caería lo que se arrastra sobre la pieza `i`: antes de ella si el cursor está en su
   * mitad de arriba, después si está en la de abajo. Sin esto, soltar una pieza sobre la
   * siguiente (la 6 sobre la 7) significaba "antes de la 7", que es donde ya estaba.
   */
  const lugarSobre = (e: React.DragEvent<HTMLElement>, i: number) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY > r.top + r.height / 2 ? i + 1 : i;
  };

  const soltar = (en: number) => {
    const a = arrastre.current;
    arrastre.current = null;
    setSobre(null);
    if (!a) return;
    if (a.tipo === "pieza") {
      const p = piezas.find((x) => x.id === a.id);
      if (p) agregar(p, en);
    } else if (a.i !== en && a.i + 1 !== en) mover(a.i, en);
  };

  // ── Guardar / abrir ───────────────────────────────────────────────────────────────────
  const guardar = async () => {
    if (!b.titulo.trim()) { setError("Poné el título de la propuesta antes de guardar."); return; }
    setGuardando(true);
    setError(null);
    try {
      const cuerpo = JSON.stringify({ ...b, id: undefined });
      const p = b.id
        ? await api<Propuesta>(`/api/propuestas/${b.id}`, { method: "PATCH", body: cuerpo })
        : await api<Propuesta>("/api/propuestas", { method: "POST", body: cuerpo });
      setGuardadas((g) => [p, ...g.filter((x) => x.id !== p.id)]);
      setB((x) => ({ ...x, id: p.id }));
      setSucio(false);
      setAviso("Propuesta guardada");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  const abrir = (id: string) => {
    const p = guardadas.find((x) => x.id === id);
    if (!p) return;
    if (sucio && !window.confirm("Hay cambios sin guardar en esta propuesta. ¿Abrir la otra igual?")) return;
    setB({ id: p.id, cliente_id: p.cliente_id, cliente_nombre: p.cliente_nombre, titulo: p.titulo, bajada: p.bajada, piezas: p.piezas ?? [],
      inversion_total: p.inversion_total, cuota_mensual: p.cuota_mensual, condiciones: p.condiciones, clientes_bandera: p.clientes_bandera ?? [] });
    setSucio(false);
  };

  /** Saca la propuesta abierta de la lista de guardadas (queda archivada, no se borra). */
  const archivar = async () => {
    if (!b.id) return;
    if (!window.confirm("¿Sacar esta propuesta de las guardadas?")) return;
    try {
      await api(`/api/propuestas/${b.id}`, { method: "DELETE" });
      setGuardadas((g) => g.filter((x) => x.id !== b.id));
      setB(VACIO);
      setSucio(false);
      setAviso("Propuesta archivada");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo archivar");
    }
  };

  const nueva = () => {
    if (sucio && !window.confirm("Hay cambios sin guardar. ¿Empezar una propuesta nueva igual?")) return;
    setB({ ...VACIO, clientes_bandera: guardadas[0]?.clientes_bandera ?? [] });
    setSucio(false);
  };

  const sumarBandera = (nombre: string) => {
    const n = nombre.trim().slice(0, 60);
    if (!n) return;
    setB((x) => (x.clientes_bandera.some((y) => y.toLowerCase() === n.toLowerCase()) || x.clientes_bandera.length >= 12 ? x : { ...x, clientes_bandera: [...x.clientes_bandera, n] }));
    setSucio(true);
  };

  // ── Piezas: alta y edición ────────────────────────────────────────────────────────────
  const guardarPieza = async () => {
    if (!editor) return;
    try {
      const cuerpo = JSON.stringify({ seccion: editor.seccion, titulo: editor.titulo, descripcion: editor.descripcion });
      if (editor.id) {
        const p = await api<Pieza>(`/api/propuestas/piezas/${editor.id}`, { method: "PATCH", body: cuerpo });
        setPiezas((l) => l.map((x) => (x.id === p.id ? p : x)));
      } else {
        const p = await api<Pieza>("/api/propuestas/piezas", { method: "POST", body: cuerpo });
        setPiezas((l) => [...l, p]);
      }
      setEditor(null);
      setAviso("Pieza guardada");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la pieza");
    }
  };

  const quitarPieza = async (p: Pieza) => {
    if (!window.confirm(`¿Sacar «${p.titulo}» del catálogo? Las propuestas ya armadas no cambian.`)) return;
    try {
      await api(`/api/propuestas/piezas/${p.id}`, { method: "DELETE" });
      setPiezas((l) => l.filter((x) => x.id !== p.id));
      setEditor(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo sacar la pieza");
    }
  };

  const opcionesCliente = useMemo(
    () => clientes.map((c) => ({ value: c.id, label: clienteNombre(c) || "Sin nombre", detalle: c.ruc ?? undefined })),
    [clientes]
  );
  const opcionesGuardadas = useMemo(
    () => guardadas.map((p) => ({ value: p.id, label: p.titulo || "Sin título", detalle: [p.cliente_nombre, `N.º ${p.numero}`].filter(Boolean).join(" · ") })),
    [guardadas]
  );

  if (acceso === null) return <div className="h-40 animate-pulse rounded-2xl bg-slate-200/70" />;
  if (!acceso) {
    return (
      <div className="mx-auto mt-10 max-w-md rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center">
        <p className="text-sm font-semibold text-slate-800">Propuestas está habilitado para quienes tienen el módulo CRM Funnel.</p>
      </div>
    );
  }

  const campo = "w-full rounded-lg border border-transparent bg-transparent outline-none transition placeholder:text-slate-300 hover:border-slate-200 focus:border-[#4FAEB2] focus:bg-white focus:ring-2 focus:ring-[#4FAEB2]/15 print:border-transparent";

  return (
    <div className="space-y-5 pb-10">
      {/*
        Impresión (el PDF). Dos cosas que importan:
        · La hoja tiene que FLUIR por las páginas: nada de `position: fixed` (lo que no entra en la
          primera página se cortaba). Se esconde todo lo que no es la hoja y a sus contenedores se
          les saca el alto fijo y el recorte.
        · Los campos de texto no se imprimen: se imprime su texto en elementos comunes
          (.solo-imprimir). Un campo no parte renglones y, además, una regla global los fuerza a
          16 px en anchos chicos, que es el ancho de una hoja: por eso el título salía chiquito.
      */}
      <style>{`
        .solo-imprimir, .solo-imprimir-linea, .pie-impreso, .pie-reserva, .cabeza-reserva { display: none; }
        @media print {
          /* Todas las páginas iguales y sin margen: lo fijo (franja de arriba y pie) se ubica igual en todas. */
          @page { size: A4; margin: 0; }
          html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
          body *:not(:has(#propuesta-hoja)):not(#propuesta-hoja):not(#propuesta-hoja *) { display: none !important; }
          *:has(#propuesta-hoja) { display: block !important; position: static !important; overflow: visible !important; height: auto !important; max-height: none !important; min-height: 0 !important; width: auto !important; max-width: none !important; margin: 0 !important; padding: 0 !important; border: 0 !important; transform: none !important; box-shadow: none !important; background: #fff !important; }
          #propuesta-hoja { width: 210mm !important; max-width: none !important; margin: 0 !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; overflow: visible !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          #propuesta-hoja > .propuesta-cuerpo { min-height: 270mm !important; padding-top: 14px !important; padding-bottom: 0 !important; }
          #propuesta-hoja .propuesta-franja { position: fixed; top: 0; left: 0; width: 210mm; }
          #propuesta-hoja .cabeza-reserva { display: table-header-group !important; height: 10mm; break-inside: avoid; }
          /* El pie va pegado al borde de abajo de la hoja, en todas las páginas, haya poco o mucho
             contenido, y la franja de color arriba. Para que nada se les escriba encima, la hoja se
             arma como tabla con un encabezado y un pie vacíos: el navegador los repite en cada
             página y reserva esos lugares. */
          #propuesta-hoja { display: table !important; }
          #propuesta-hoja .pie-reserva { display: table-footer-group !important; height: 16mm; break-inside: avoid; }
          #propuesta-hoja .pie-impreso { display: block !important; position: fixed; left: 0; bottom: 0; width: 210mm; box-sizing: border-box; padding: 0 8%; font-size: 11px; background: #fff; }
          #propuesta-hoja .pie-impreso .pie-fila { height: 16mm; border-top: 1px solid #e2e8f0; }
          /* Con clientes bandera el pie es más alto: arriba van ellos, en texto. */
          #propuesta-hoja .pie-impreso .pie-clientes { height: 11mm; }
          #propuesta-hoja.con-banderas .pie-reserva { height: 27mm; }
          #propuesta-hoja.con-banderas > .propuesta-cuerpo { min-height: 259mm !important; }
          /* Cada pieza entera en una página; y precios, condiciones, clientes y pie viajan juntos:
             si no entran, pasan todos a la página siguiente (nunca queda el pie solo). */
          #propuesta-hoja li, #propuesta-hoja .propuesta-cierre { break-inside: avoid; }
          /* Un poco más apretado que en pantalla, para que una propuesta normal entre en una hoja. */
          #propuesta-hoja ol > li { padding-top: 11px !important; padding-bottom: 11px !important; }
          #propuesta-hoja .propuesta-cierre { padding-top: 18px !important; }
          .no-imprimir { display: none !important; }
          .solo-imprimir { display: block !important; }
          .solo-imprimir-linea { display: inline !important; }
        }
      `}</style>

      {/* Encabezado */}
      <div className="no-imprimir flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#4FAEB2] shadow-[0_0_0_3px_rgba(79,174,178,0.18)]" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Comercial</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Propuestas</h1>
          <p className="mt-1 text-sm text-slate-500">Elegí las piezas, poné el cliente y los precios, y bajá la propuesta en PDF.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-64">
            <SelectorBuscable opciones={opcionesGuardadas} value={b.id ?? ""} onChange={abrir} placeholder="Propuestas guardadas" ariaLabel="Abrir una propuesta guardada" buscarPlaceholder="Buscar propuesta…" vacio="Todavía no hay propuestas guardadas" />
          </div>
          <button type="button" onClick={nueva} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:text-[#3F8E91]">
            <FilePlus2 className="h-4 w-4" /> Nueva
          </button>
          {b.id ? (
            <button type="button" onClick={() => void archivar()} aria-label="Archivar esta propuesta" title="Sacar de las guardadas"
              className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600">
              <Trash2 className="h-4 w-4" />
            </button>
          ) : null}
          <button type="button" onClick={() => void guardar()} disabled={guardando} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:text-[#3F8E91] disabled:opacity-60">
            <Save className="h-4 w-4" /> {guardando ? "Guardando…" : sucio || !b.id ? "Guardar" : "Guardada"}
          </button>
          <button type="button" onClick={() => { (document.activeElement as HTMLElement | null)?.blur(); window.print(); }} className="inline-flex items-center gap-1.5 rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#3F8E91]">
            <Download className="h-4 w-4" /> Descargar PDF
          </button>
        </div>
      </div>

      {error ? (
        <div role="alert" className="no-imprimir flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Cerrar aviso" className="shrink-0 text-rose-500 hover:text-rose-700"><X className="h-4 w-4" /></button>
        </div>
      ) : null}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(340px,430px)_minmax(0,1fr)]">
        {/* ── Catálogo de piezas ── */}
        <aside className="no-imprimir overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm xl:sticky xl:top-0 xl:max-h-[calc(100svh-7rem)] xl:overflow-y-auto">
          <div className="sticky top-0 z-10 space-y-3 border-b border-slate-100 bg-white/95 p-4 backdrop-blur">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Piezas</h2>
                <p className="text-xs text-slate-500">{piezas.length} servicios en {nombresSeccion.length} secciones</p>
              </div>
              <button type="button" onClick={() => setEditor({ id: null, seccion: nombresSeccion[0] ?? "", titulo: "", descripcion: "" })} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-[#4FAEB2]/60 hover:text-[#3F8E91]">
                <Plus className="h-3.5 w-3.5" /> Nueva pieza
              </button>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar pieza: stock, WhatsApp, reparto…" aria-label="Buscar pieza"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-9 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#4FAEB2] focus:bg-white focus:ring-2 focus:ring-[#4FAEB2]/15" />
              {q ? (
                <button type="button" onClick={() => setQ("")} aria-label="Limpiar búsqueda" className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
              ) : null}
            </div>
          </div>

          <div className="p-2">
            {cargando ? (
              <div className="space-y-2 p-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-100" />)}</div>
            ) : secciones.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-slate-500">{q ? "Ninguna pieza coincide. Probá con otra palabra o creá una nueva." : "Todavía no hay piezas cargadas."}</p>
            ) : (
              secciones.map(([sec, lista]) => {
                const abierta = q.trim() ? true : !!abiertas[sec];
                return (
                  <section key={sec} className="mb-1">
                    <button type="button" onClick={() => setAbiertas((c) => ({ ...c, [sec]: !c[sec] }))} aria-expanded={abierta}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-slate-50">
                      <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${abierta ? "" : "-rotate-90"}`} aria-hidden />
                      <span className="flex-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">{sec}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">{lista.length}</span>
                    </button>
                    {abierta ? (
                      <ul className="m-0 list-none space-y-1 p-0 pb-1">
                        {lista.map((p) => {
                          const ya = usadas.has(p.id);
                          return (
                            <li key={p.id} draggable={!ya}
                              onDragStart={(e) => { arrastre.current = { tipo: "pieza", id: p.id }; e.dataTransfer.effectAllowed = "copy"; e.dataTransfer.setData("text/plain", p.titulo); }}
                              onDragEnd={() => { arrastre.current = null; setSobre(null); }}
                              className={`group/pieza flex items-start gap-2 rounded-xl border px-3 py-2.5 transition-colors ${ya ? "border-transparent bg-slate-50" : "cursor-grab border-slate-100 bg-white hover:border-[#4FAEB2]/40 hover:shadow-sm active:cursor-grabbing"}`}>
                              <div className="min-w-0 flex-1">
                                <p className={`text-[13px] font-semibold leading-snug ${ya ? "text-slate-400" : "text-slate-800"}`}>{p.titulo}</p>
                                {p.descripcion ? <p className={`mt-0.5 text-xs leading-snug ${ya ? "text-slate-400" : "text-slate-500"}`}>{p.descripcion}</p> : null}
                              </div>
                              <button type="button" onClick={() => setEditor({ id: p.id, seccion: p.seccion, titulo: p.titulo, descripcion: p.descripcion })} aria-label={`Editar ${p.titulo}`} title="Editar pieza"
                                className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-300 opacity-0 transition hover:bg-slate-100 hover:text-slate-600 focus:opacity-100 group-hover/pieza:opacity-100">
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              {ya ? (
                                <span title="Ya está en la propuesta" className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><Check className="h-4 w-4" /></span>
                              ) : (
                                <button type="button" onClick={() => agregar(p)} aria-label={`Agregar ${p.titulo} a la propuesta`} title="Agregar a la propuesta"
                                  className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#4FAEB2] text-white shadow-sm transition hover:bg-[#3F8E91]">
                                  <Plus className="h-4 w-4" />
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </section>
                );
              })
            )}
          </div>
        </aside>

        {/* ── La plantilla (es lo que se imprime) ── */}
        <div className="min-w-0">
          <div className="no-imprimir mb-3 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Cliente</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <SelectorBuscable opciones={opcionesCliente} value={b.cliente_id ?? ""} ariaLabel="Elegir un cliente cargado" placeholder="Elegí un cliente" buscarPlaceholder="Buscar cliente por nombre o RUC…"
                  onChange={(v) => cambiar({ cliente_id: v || null, cliente_nombre: opcionesCliente.find((o) => o.value === v)?.label ?? "" })} />
                {/* Para quien todavía no es cliente: se escribe el nombre a mano (deja de estar atado a un cliente cargado). */}
                <input value={b.cliente_nombre} onChange={(e) => cambiar({ cliente_nombre: e.target.value, cliente_id: null })} maxLength={160}
                  placeholder="O escribí el nombre" aria-label="Nombre del cliente, escrito a mano"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/15" />
              </div>
            </div>
            <p className="self-end text-xs text-slate-500 sm:max-w-[16rem]">Arrastrá piezas a la hoja o tocá su <span className="font-semibold text-[#3F8E91]">+</span>. En la hoja se reordenan arrastrando.</p>
          </div>

          <article id="propuesta-hoja" className={`${b.clientes_bandera.length > 0 ? "con-banderas " : ""}mx-auto w-full max-w-[820px] overflow-hidden rounded-2xl border border-slate-200 bg-white text-[#27365a] shadow-sm`}>
            <div className="cabeza-reserva" aria-hidden />
            <div className="propuesta-franja h-2.5 bg-[#5ab3b0]" />
            <div className="propuesta-cuerpo flex min-h-[1060px] flex-col px-[8%] pb-8 pt-8">
              <header className="flex items-start justify-between gap-6 border-b border-slate-200 pb-5">
                <Image src="/brand/neura-consultora.png" alt="Neura · Consultora estratégica" width={900} height={288} priority className="h-auto w-[44%] max-w-[330px]" />
                <div className="pt-3 text-right">
                  <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-slate-500">Propuesta comercial</p>
                  <p className="mt-2 text-[13px] text-slate-500">{hoy ? fechaLarga(hoy) : ""}</p>
                  {b.cliente_nombre ? <p className="mt-2 text-[13px] font-semibold text-[#27365a]">Para: {b.cliente_nombre}</p> : null}
                </div>
              </header>

              <div className="mt-5">
                <input value={b.titulo} onChange={(e) => cambiar({ titulo: e.target.value })} placeholder="Título de la propuesta" aria-label="Título de la propuesta"
                  className={`${campo} no-imprimir -mx-2 px-2 py-1 text-[26px] font-bold leading-tight text-[#27365a]`} />
                <h1 className="solo-imprimir text-[26px] font-bold leading-tight text-[#27365a]">{b.titulo}</h1>
                <input value={b.bajada} onChange={(e) => cambiar({ bajada: e.target.value })} placeholder="Una línea que resuma la solución" aria-label="Bajada de la propuesta"
                  className={`${campo} no-imprimir -mx-2 mt-0.5 px-2 py-1 text-[13px] text-slate-500`} />
                {b.bajada ? <p className="solo-imprimir mt-2 text-[13px] text-slate-500">{b.bajada}</p> : null}
              </div>

              <div className="mt-6 flex items-center gap-3">
                <span aria-hidden="true" className="h-5 w-1.5 rounded-full bg-[#5ab3b0]" />
                <h2 className="text-[14px] font-bold uppercase tracking-[0.04em] text-[#27365a]">Servicios incluidos</h2>
              </div>

              <ol className="m-0 mt-4 list-none p-0" onDragOver={(e) => e.preventDefault()}>
                {b.piezas.map((p, i) => (
                  <li key={`${p.pieza_id ?? "x"}-${i}`}
                    draggable
                    onDragStart={(e) => { arrastre.current = { tipo: "item", i }; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", p.titulo); }}
                    onDragEnd={() => { arrastre.current = null; setSobre(null); }}
                    onDragOver={(e) => { e.preventDefault(); setSobre(lugarSobre(e, i)); }}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); soltar(lugarSobre(e, i)); }}
                    className={`group/item relative flex items-center gap-4 rounded-xl px-3 py-4 ${i % 2 === 0 ? "bg-[#f4f5f7]" : "bg-white"} ${sobre === i ? "shadow-[inset_0_3px_0_0_#5ab3b0]" : sobre === i + 1 && i === b.piezas.length - 1 ? "shadow-[inset_0_-3px_0_0_#5ab3b0]" : ""}`}>
                    <GripVertical aria-hidden className="no-imprimir absolute -left-5 top-1/2 h-4 w-4 -translate-y-1/2 cursor-grab text-slate-300 opacity-0 transition group-hover/item:opacity-100" />
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#5ab3b0] text-[13px] font-bold text-white">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-bold leading-snug text-[#27365a]">{p.titulo}</span>
                      {p.descripcion ? <span className="mt-1 block text-[12px] leading-snug text-slate-500">{p.descripcion}</span> : null}
                    </span>
                    <button type="button" onClick={() => cambiar({ piezas: b.piezas.filter((_, k) => k !== i) })} aria-label={`Quitar ${p.titulo}`} title="Quitar de la propuesta"
                      className="no-imprimir inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-300 opacity-0 transition hover:bg-rose-50 hover:text-rose-600 focus:opacity-100 group-hover/item:opacity-100">
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
                <li onDragOver={(e) => { e.preventDefault(); setSobre("fin"); }} onDrop={(e) => { e.preventDefault(); soltar(b.piezas.length); }}
                  className={`no-imprimir mt-2 rounded-xl border-2 border-dashed px-4 text-center text-xs transition-colors ${b.piezas.length === 0 ? "py-10" : "py-3"} ${sobre === "fin" ? "border-[#5ab3b0] bg-[#5ab3b0]/10 text-[#3F8E91]" : "border-slate-200 text-slate-400"}`}>
                  {b.piezas.length === 0 ? "Soltá acá las piezas, o tocá su + en la lista de la izquierda." : "Soltá acá para agregar al final"}
                </li>
              </ol>

              <div className="propuesta-cierre mt-auto pt-8">
                {/* Un precio vacío no sale en el PDF; sin ninguno, tampoco el bloque. */}
                <section className={`grid grid-cols-2 rounded-2xl bg-[#27365a] px-8 py-7 text-white ${b.inversion_total === null && b.cuota_mensual === null ? "no-imprimir" : ""}`}>
                  <div className={`pr-6 ${b.inversion_total === null ? "no-imprimir" : ""}`}>
                    <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-slate-300">Inversión total</p>
                    <p className="mt-3 flex items-baseline gap-2 text-[26px] font-bold">
                      <span>G.</span>
                      <input inputMode="numeric" value={miles(b.inversion_total)} onChange={(e) => { const d = soloDigitos(e.target.value); cambiar({ inversion_total: d ? Number(d) : null }); }} placeholder="0" aria-label="Inversión total en guaraníes"
                        className="no-imprimir w-full min-w-0 rounded-lg border border-transparent bg-transparent px-1 font-bold outline-none placeholder:text-white/30 hover:border-white/20 focus:border-white/50" />
                      <span className="solo-imprimir-linea">{miles(b.inversion_total)}</span>
                    </p>
                    <p className="mt-3 text-[12px] text-slate-200">Pago único por el proyecto</p>
                  </div>
                  <div className={`border-l border-white/25 pl-8 ${b.cuota_mensual === null ? "no-imprimir" : ""} ${b.inversion_total === null ? "print:border-l-0 print:pl-0" : ""}`}>
                    <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-slate-300">Cuota mensual</p>
                    <p className="mt-3 flex items-baseline gap-2 text-[26px] font-bold">
                      <span>G.</span>
                      <input inputMode="numeric" value={miles(b.cuota_mensual)} onChange={(e) => { const d = soloDigitos(e.target.value); cambiar({ cuota_mensual: d ? Number(d) : null }); }} placeholder="0" aria-label="Cuota mensual en guaraníes"
                        className="no-imprimir w-full min-w-0 rounded-lg border border-transparent bg-transparent px-1 font-bold outline-none placeholder:text-white/30 hover:border-white/20 focus:border-white/50" />
                      <span className="solo-imprimir-linea">{miles(b.cuota_mensual)}</span>
                    </p>
                    <p className="mt-3 text-[12px] text-slate-200">Abono mensual</p>
                  </div>
                </section>

                <textarea value={b.condiciones} onChange={(e) => cambiar({ condiciones: e.target.value })} rows={2} aria-label="Condiciones"
                  className={`${campo} no-imprimir -mx-2 mt-4 resize-none px-2 py-1 text-[11px] leading-relaxed text-slate-500`} />
                {b.condiciones ? <p className="solo-imprimir mt-4 whitespace-pre-line text-[11px] leading-relaxed text-slate-500">{b.condiciones}</p> : null}

                {/* Clientes bandera: se eligen de los clientes cargados o se escriben. Sin ninguno, no sale en el PDF. */}
                {/* Clientes bandera: acá se cargan (de la lista o escritos). En la hoja salen como texto, en el pie. */}
                <section className="no-imprimir mt-5 rounded-xl border border-dashed border-slate-200 px-3 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Confían en nosotros <span className="font-medium normal-case tracking-normal text-slate-400">· salen en el pie de la hoja</span></p>
                  {b.clientes_bandera.length > 0 ? (
                    <ul className="m-0 mt-2 flex list-none flex-wrap gap-x-2 gap-y-1.5 p-0">
                      {b.clientes_bandera.map((n) => (
                        <li key={n} className="inline-flex items-center gap-1 rounded-full bg-[#f4f5f7] px-3 py-1 text-[11px] font-semibold text-[#27365a]">
                          {n}
                          <button type="button" onClick={() => cambiar({ clientes_bandera: b.clientes_bandera.filter((x) => x !== n) })} aria-label={`Quitar ${n}`} title="Quitar"
                            className="-mr-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:bg-rose-100 hover:text-rose-600">
                            <X className="h-3 w-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="no-imprimir mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <SelectorBuscable opciones={opcionesCliente} value="" ariaLabel="Agregar un cliente bandera de la lista" placeholder="Elegir de los clientes" buscarPlaceholder="Buscar cliente…" tam="sm"
                      onChange={(v) => { const o = opcionesCliente.find((x) => x.value === v); if (o) sumarBandera(o.label); }} />
                    <input value={banderaTexto} onChange={(e) => setBanderaTexto(e.target.value)} maxLength={60} placeholder="O escribí el nombre y Enter" aria-label="Escribir un cliente bandera"
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sumarBandera(banderaTexto); setBanderaTexto(""); } }}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/15" />
                    <button type="button" onClick={() => { sumarBandera(banderaTexto); setBanderaTexto(""); }} disabled={!banderaTexto.trim()}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] font-semibold text-slate-600 hover:border-[#4FAEB2]/60 hover:text-[#3F8E91] disabled:opacity-40">Agregar</button>
                  </div>
                </section>

                <footer className="no-imprimir mt-5 text-[11px]">
                  {b.clientes_bandera.length > 0 ? (
                  <p className="flex pb-3 items-center justify-center overflow-hidden text-center text-[10.5px] leading-[1.45] text-slate-500">
                    <span className="line-clamp-2"><span className="font-bold uppercase tracking-[0.1em] text-[#27365a]">Confían en nosotros:</span> {b.clientes_bandera.join(" · ")}</span>
                  </p>
                ) : null}
                  <div className="flex items-center justify-between border-t border-slate-200 pt-4">
                    <span className="font-bold tracking-wide text-[#27365a]">NEURA</span>
                    <span className="text-slate-500">Consultora estratégica | Paraguay</span>
                  </div>
                </footer>
              </div>
            </div>
            {/* El pie del PDF: fijo al borde de abajo de cada página (ver estilos de impresión). */}
            <div className="pie-reserva" aria-hidden />
            <div className="pie-impreso">
              {b.clientes_bandera.length > 0 ? (
              <p className="pie-clientes flex items-center justify-center overflow-hidden text-center text-[10.5px] leading-[1.45] text-slate-500">
                <span className="line-clamp-2"><span className="font-bold uppercase tracking-[0.1em] text-[#27365a]">Confían en nosotros:</span> {b.clientes_bandera.join(" · ")}</span>
              </p>
            ) : null}
              <div className="pie-fila flex items-center justify-between">
                <span className="font-bold tracking-wide text-[#27365a]">NEURA</span>
                <span className="text-slate-500">Consultora estratégica | Paraguay</span>
              </div>
            </div>
          </article>
        </div>
      </div>

      {/* Alta / edición de pieza */}
      {editor ? (
        <div role="dialog" aria-modal="true" aria-label={editor.id ? "Editar pieza" : "Nueva pieza"} onClick={() => setEditor(null)}
          className="no-imprimir fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">{editor.id ? "Editar pieza" : "Nueva pieza"}</h2>
              <button type="button" onClick={() => setEditor(null)} aria-label="Cerrar" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Sección</span>
                <input list="propuestas-secciones" value={editor.seccion} onChange={(e) => setEditor({ ...editor, seccion: e.target.value })} placeholder="Elegí una o escribí una nueva"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/15" />
                <datalist id="propuestas-secciones">{nombresSeccion.map((s) => <option key={s} value={s} />)}</datalist>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Título</span>
                <input value={editor.titulo} onChange={(e) => setEditor({ ...editor, titulo: e.target.value })} placeholder="Ej: Sistema CRM omnicanal" maxLength={120}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/15" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Descripción (una línea)</span>
                <textarea value={editor.descripcion} onChange={(e) => setEditor({ ...editor, descripcion: e.target.value })} rows={2} maxLength={300} placeholder="Qué hace, en una frase para el cliente."
                  className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/15" />
              </label>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
              {editor.id ? (
                <button type="button" onClick={() => { const p = piezas.find((x) => x.id === editor.id); if (p) void quitarPieza(p); }} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50">
                  <Trash2 className="h-3.5 w-3.5" /> Sacar del catálogo
                </button>
              ) : <span />}
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditor(null)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancelar</button>
                <button type="button" onClick={() => void guardarPieza()} disabled={!editor.titulo.trim() || !editor.seccion.trim()} className="rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:cursor-not-allowed disabled:opacity-50">Guardar pieza</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {aviso ? (
        <div role="status" className="no-imprimir fixed bottom-5 left-1/2 z-[130] -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-xl">{aviso}</div>
      ) : null}
    </div>
  );
}
