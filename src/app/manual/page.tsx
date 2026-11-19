"use client";

/**
 * /manual — Manual de usuario, de a un paso por vez: portada con temas, lista de tareas del tema y cada
 * tarea como una secuencia de pantallas (una frase, la captura agrandada donde hay que tocar, Siguiente).
 * Es la pantalla del manual del ERP 2.0, con guías escritas para este ERP. Muestra solo las guías de
 * las pantallas que el menú le muestra a la persona.
 */
import { createContext, Suspense, useContext, useEffect, useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle, ArrowLeft, ArrowRight, BarChart3, Banknote, Check, ChevronRight, Expand, FolderKanban, Lightbulb, LifeBuoy, MessageCircle,
  Rocket, Search, Users, X, ArrowUp, IdCard,
} from "lucide-react";
import { GUIAS, LLEGAR, MENUS, PANELES, type Guia } from "@/lib/manual/contenido";
import marcasJson from "@/lib/manual/marcas.json";
import { useMenuVisible } from "@/lib/menu/menu-visible-store";

type RubroImagen = "comercio" | "gastronomia";
/** lado "der": la flecha entra desde la derecha, donde a la izquierda no hay lugar (el menú). */
type Punto = { x: number; y: number; lado?: "der" | "abajo"; z?: number };
/** Carpetas de capturas: comercio y gastronomía, más una por rubro de módulo (inmobiliaria…). */
const MARCAS = marcasJson as unknown as Record<string, Record<string, Record<string, Punto | null>>>;
/**
 * Las capturas son por rubro: se busca en orden (la carpeta del rubro de la empresa, si tiene, y
 * después comercio o gastronomía) y la de otra carpeta solo si la pantalla no existe en ninguna de esas.
 */
const carpetaDe = (_img: string, orden: string[]): string => orden[0];
/** Orden de carpetas de capturas para la empresa (ver carpetaDe). */
const ContextoRubro = createContext<string[]>(["neura"]);

const TEMAS: { grupo: string; titulo: string; detalle: string; Icono: ComponentType<{ className?: string }> }[] = [
  { grupo: "Atención al cliente", titulo: "Chats", detalle: "Responder, transferir y finalizar conversaciones", Icono: MessageCircle },
  { grupo: "Soporte", titulo: "Tickets de soporte", detalle: "Cargar un ticket y seguirlo hasta el cierre", Icono: LifeBuoy },
  { grupo: "Clientes y ventas", titulo: "Clientes y prospectos", detalle: "Cargar clientes, seguir prospectos y agendar", Icono: Users },
  { grupo: "Proyectos", titulo: "Proyectos", detalle: "Crear un proyecto y moverlo por sus etapas", Icono: FolderKanban },
  { grupo: "Cobros", titulo: "Cobranzas", detalle: "Quién debe y cómo va cada cuota", Icono: Banknote },
  { grupo: "Reportes", titulo: "Ver los números", detalle: "Reportes para mirar y bajar en Excel", Icono: BarChart3 },
  { grupo: "Equipo", titulo: "El equipo", detalle: "Usuarios, accesos y guardias", Icono: IdCard },
  { grupo: "Primeros pasos", titulo: "Lo básico", detalle: "Cómo moverte por el sistema", Icono: Rocket },
];

function norm(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function textoDeGuia(g: Guia) {
  return norm([g.titulo, g.resumen, ...g.bloques.flatMap((b) => [b.texto, b.consejo, b.ojo, ...(b.pasos ?? []).flatMap((p) => [p.t, p.d])])].filter(Boolean).join(" "));
}

type Nota = { tipo: "consejo" | "ojo"; texto: string };
type Diapositiva = { frase: string; aclara?: string; img?: string; alt?: string; marca?: string; intro?: string; notas: Nota[] };

/** Una guía se recorre de a una frase por pantalla. */
function diapositivas(g: Guia, rubro: RubroImagen): Diapositiva[] {
  const out: Diapositiva[] = [];
  const llegar = LLEGAR[g.id];
  if (llegar) {
    const [seccion, tarjeta] = llegar;
    out.push({ frase: `En el menú de la izquierda, tocá ${seccion}.`, aclara: "En el celular, el menú se abre con el botón de las tres rayitas.", img: MENUS[seccion] ?? "inicio", marca: seccion, notas: [] });
    if (tarjeta) out.push({ frase: `Tocá ${tarjeta}.`, img: PANELES[seccion], marca: tarjeta, notas: [] });
  }
  for (const b of g.bloques) {
    if (b.rubro && b.rubro !== rubro) continue;
    const pasos = b.pasos ?? [];
    if (b.texto && !pasos.length) out.push({ frase: b.texto, img: b.img, alt: b.alt, notas: [] });
    pasos.forEach((p, i) => out.push({ frase: p.t, aclara: p.d, img: b.img, alt: b.alt, marca: p.marca, intro: i === 0 ? b.texto : undefined, notas: [] }));
    const nota: Nota | null = b.consejo ? { tipo: "consejo", texto: b.consejo } : b.ojo ? { tipo: "ojo", texto: b.ojo } : null;
    if (nota) {
      if (out.length) out[out.length - 1].notas.push(nota);
      else out.push({ frase: nota.texto, notas: [] });
    }
  }
  return out;
}

const ZOOM = 2.1;
const PROP_VISOR = 10 / 16; // alto / ancho del visor

/** La imagen agrandada alrededor del lugar a tocar, con el resto oscurecido. */
function Visor({ d, onAmpliar }: { d: Diapositiva; onAmpliar: () => void }) {
  const rubro = useContext(ContextoRubro);
  const [proporcion, setProporcion] = useState<number | null>(null);
  if (!d.img) return null;
  const carpeta = carpetaDe(d.img, rubro);
  const src = `/guias/${carpeta}/${d.img}.webp`;
  const p = d.marca ? MARCAS[carpeta]?.[d.img]?.[d.marca] ?? null : null;
  const cargar = (e: React.SyntheticEvent<HTMLImageElement>) => setProporcion(e.currentTarget.naturalHeight / e.currentTarget.naturalWidth);

  if (!p) {
    return (
      <button type="button" onClick={onAmpliar} aria-label="Ver la pantalla completa" className="block h-full w-full cursor-zoom-in overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={d.alt ?? ""} className="block h-full w-full object-contain" />
      </button>
    );
  }
  const r = proporcion ?? 0.75;
  const zoom = p.z ?? ZOOM; // las zonas anchas llevan menos zoom, para verse enteras
  const altoImg = (zoom * r) / PROP_VISOR; // alto de la imagen, en altos de visor
  // El lugar a tocar queda a la izquierda del centro: lo señalado sigue hacia la derecha.
  // En la mitad derecha de la pantalla, más todavía, para no cortar montos ni botones anchos.
  const aLaDerecha = p.x >= 50;
  const izq = Math.min(0, Math.max(100 - 100 * zoom, (aLaDerecha ? 22 : 38) - p.x * zoom));
  const luz = ZOOM / zoom;
  const arriba = Math.min(0, Math.max(100 - 100 * altoImg, 50 - p.y * altoImg));
  const px = p.x * zoom + izq;
  const py = p.y * altoImg + arriba;
  const der = p.lado === "der";
  const abajo = p.lado === "abajo"; // entre botones o pestañas, la flecha no tapa al vecino
  return (
    <button type="button" onClick={onAmpliar} aria-label="Ver la pantalla completa"
      style={{ width: "min(100cqw, 160cqh)" }}
      className="relative mx-auto block aspect-[16/10] cursor-zoom-in overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={d.alt ?? ""} onLoad={cargar} className={`absolute max-w-none ${proporcion ? "" : "opacity-0"}`} style={{ width: `${zoom * 100}%`, left: `${izq}%`, top: `${arriba}%` }} />
      <span className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(ellipse ${(aLaDerecha ? 62 : 42) * luz}% ${38 * luz}% at ${der ? px - 6 : abajo ? px : aLaDerecha ? px + 26 : px + 13 * luz}% ${py}%, transparent 72%, rgba(15,23,42,.5) 100%)` }} />
      <span className={`pointer-events-none absolute ${abajo ? "-translate-x-1/2" : `-translate-y-1/2 ${der ? "" : "-translate-x-full"}`}`} style={{ left: `${der || abajo ? px : Math.max(px, 9)}%`, top: abajo ? `calc(${py}% + 4px)` : `${py}%` }}>
        <span className="relative grid h-9 w-9 place-items-center sm:h-11 sm:w-11">
          <span className="absolute inset-0 animate-ping rounded-full bg-rose-500/50" />
          <span className="relative grid h-full w-full place-items-center rounded-full bg-rose-600 text-white ring-2 ring-white">
            {abajo ? <ArrowUp className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden /> : der ? <ArrowLeft className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden /> : <ArrowRight className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden />}
          </span>
        </span>
      </span>
      <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-slate-900/70 px-2.5 py-1 text-xs font-medium text-white">
        <Expand className="h-3.5 w-3.5" aria-hidden /> Ver toda la pantalla
      </span>
    </button>
  );
}

/** Recorrido completo (botón "Empezá acá"): la guía es una de la serie y al terminar sigue la próxima. */
type Serie = { n: number; total: number; siguiente: Guia | null; proximoTema: { n: number; titulo: string } | null };

function Recorrido({ guia, rubro, serie }: { guia: Guia; rubro: RubroImagen; serie?: Serie }) {
  const lista = useMemo(() => diapositivas(guia, rubro), [guia, rubro]);
  const [i, setI] = useState(0);
  const [ampliada, setAmpliada] = useState(false);
  const fin = i >= lista.length;
  const d = lista[i];
  const tema = TEMAS.find((t) => t.grupo === guia.grupo);
  const orden = useContext(ContextoRubro);

  useEffect(() => {
    document.querySelector("main")?.scrollTo({ top: 0 });
    const siguiente = lista[i + 1];
    if (siguiente?.img) new Image().src = `/guias/${carpetaDe(siguiente.img, orden)}/${siguiente.img}.webp`;
  }, [i, lista, orden]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (ampliada) return;
      if (e.key === "ArrowRight") setI((x) => Math.min(lista.length, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [lista.length, ampliada]);

  // Terminó la última guía del recorrido completo: ya no hay nada que seguir.
  useEffect(() => {
    if (fin && serie && !serie.siguiente) {
      try { localStorage.removeItem("manual-recorrido"); } catch { /* sin almacenamiento */ }
    }
  }, [fin, serie]);

  const volver = serie ? "/manual" : tema ? `/manual?tema=${encodeURIComponent(tema.grupo)}` : "/manual";
  const router = useRouter();
  const irA = (n: number) => router.push(`/manual?recorrido=${n}`);

  return (
    // Todo entra en la pantalla de una: la imagen toma el alto que queda.
    <div className={`mx-auto flex max-w-4xl flex-col gap-3 ${d?.img ? "lg:h-[calc(100dvh-7.1rem)] lg:min-h-[480px]" : ""}`}>
      <Link href={volver} className="-my-2 inline-flex min-h-11 shrink-0 items-center gap-1.5 self-start text-sm font-medium text-slate-500 no-underline hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Volver
      </Link>
      <div className="shrink-0">
        {serie ? (
          <p className="mb-1 text-sm font-semibold text-[var(--brand)]">Recorrido completo · Guía {serie.n + 1} de {serie.total}{tema ? ` · ${tema.titulo}` : ""}</p>
        ) : null}
        <h1 className="text-2xl font-bold text-slate-900">{guia.titulo}</h1>
        {!fin ? (
          <div className="mt-2 flex items-center gap-3">
            <span className="shrink-0 text-sm font-semibold text-slate-600">Paso {i + 1} de {lista.length}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
              <span className="block h-full rounded-full bg-[var(--brand)] transition-all" style={{ width: `${((i + 1) / lista.length) * 100}%` }} />
            </span>
          </div>
        ) : null}
      </div>

      {fin && serie ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-600 text-white"><Check className="h-8 w-8" aria-hidden /></span>
          {serie.siguiente ? (
            <>
              <p className="mt-3 text-xl font-bold text-slate-900">¡Bien! Ya viste {serie.n + 1} de {serie.total}.</p>
              <p className="mt-1 text-base text-slate-600">Sigue: <span className="font-semibold text-slate-800">{serie.siguiente.titulo}</span></p>
              <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
                <button type="button" onClick={() => irA(serie.n + 1)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-6 text-base font-semibold text-white">
                  Seguir <ArrowRight className="h-5 w-5" />
                </button>
                {serie.proximoTema ? (
                  <button type="button" onClick={() => irA(serie.proximoTema!.n)} className="min-h-12 rounded-xl border border-slate-200 bg-white px-6 text-base font-medium text-slate-700">
                    Saltar a {serie.proximoTema.titulo}
                  </button>
                ) : null}
                <Link href="/manual" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-6 text-base font-medium text-slate-700 no-underline">Seguir otro día</Link>
              </div>
            </>
          ) : (
            <>
              <p className="mt-3 text-xl font-bold text-slate-900">¡Terminaste el recorrido!</p>
              <p className="mt-1 text-base text-slate-600">Viste las {serie.total} guías. Cuando quieras repasar algo, buscalo arriba en el manual.</p>
              <div className="mt-4 flex justify-center">
                <Link href="/manual" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[var(--brand)] px-6 text-base font-semibold text-white no-underline">Volver al manual</Link>
              </div>
            </>
          )}
        </div>
      ) : fin ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-600 text-white"><Check className="h-8 w-8" aria-hidden /></span>
          <p className="mt-3 text-xl font-bold text-slate-900">¡Listo! Eso es todo.</p>
          <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
            {guia.ruta && guia.ruta !== "/" ? (
              <Link href={guia.ruta} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-6 text-base font-semibold text-white no-underline">
                Hacerlo ahora <ArrowRight className="h-5 w-5" />
              </Link>
            ) : null}
            <button type="button" onClick={() => setI(0)} className="min-h-12 rounded-xl border border-slate-200 bg-white px-6 text-base font-medium text-slate-700">Verlo de nuevo</button>
            <Link href={volver} className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-6 text-base font-medium text-slate-700 no-underline">Ver otra guía</Link>
          </div>
        </div>
      ) : (
        <>
          {d.intro ? <p className="shrink-0 text-base leading-relaxed text-slate-600">{d.intro}</p> : null}
          <div className="shrink-0">
            <p className="text-xl font-semibold leading-snug text-slate-900 sm:text-2xl">{d.frase}</p>
            {d.aclara ? <p className="mt-1 text-base leading-relaxed text-slate-600">{d.aclara}</p> : null}
          </div>
          {d.img ? (
            <div className="aspect-[16/10] w-full flex-none lg:aspect-auto lg:min-h-[160px] lg:flex-1" style={{ containerType: "size" }}>
              <Visor key={`${i}-${d.img}`} d={d} onAmpliar={() => setAmpliada(true)} />
            </div>
          ) : null}
          {d.notas.map((n, k) => (
            <p key={k} className={`flex shrink-0 gap-3 rounded-xl border px-4 py-2.5 text-sm leading-relaxed sm:text-base ${n.tipo === "ojo" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
              {n.tipo === "ojo" ? <AlertTriangle className="mt-1 h-5 w-5 shrink-0" aria-hidden /> : <Lightbulb className="mt-1 h-5 w-5 shrink-0" aria-hidden />}
              <span>{n.texto}</span>
            </p>
          ))}
        </>
      )}

      {!fin ? (
        <div className="flex shrink-0 gap-2">
          {i > 0 ? (
            <button type="button" onClick={() => setI(i - 1)} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-base font-medium text-slate-700">
              <ArrowLeft className="h-5 w-5" /> Atrás
            </button>
          ) : null}
          <button type="button" onClick={() => setI(i + 1)} className="inline-flex min-h-14 flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-6 text-lg font-semibold text-white">
            {i === lista.length - 1 ? "Terminar" : "Siguiente"} <ArrowRight className="h-5 w-5" />
          </button>
        </div>
      ) : null}

      {ampliada && d?.img ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Pantalla completa"
          onClick={() => setAmpliada(false)}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/60 p-4 sm:p-6"
        >
          <div onClick={(e) => e.stopPropagation()} className="contents">
          <div className="relative max-h-[90dvh] w-full max-w-6xl overflow-auto rounded-xl bg-white shadow-xl">
            <button type="button" onClick={() => setAmpliada(false)} aria-label="Cerrar imagen" className="sticky left-full top-2 z-10 mr-2 mt-2 grid h-11 w-11 place-items-center rounded-full bg-slate-900/70 text-white">
              <X className="h-5 w-5" />
            </button>
            <PantallaCompleta d={d} />
          </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PantallaCompleta({ d }: { d: Diapositiva }) {
  const rubro = useContext(ContextoRubro);
  const carpeta = carpetaDe(d.img ?? "", rubro);
  const p = d.marca ? MARCAS[carpeta]?.[d.img ?? ""]?.[d.marca] ?? null : null;
  return (
    <span className="relative -mt-11 block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/guias/${carpeta}/${d.img}.webp`} alt={d.alt ?? ""} className="block h-auto w-full" />
      {p ? (
        <span className={`absolute grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-rose-600 text-white ring-2 ring-white ${p.lado === "der" ? "" : "-translate-x-full"}`} style={{ left: `${p.lado === "der" ? p.x : Math.max(p.x, 3)}%`, top: `${p.y}%` }}>
          {p.lado === "der" ? <ArrowLeft className="h-4 w-4" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
        </span>
      ) : null}
    </span>
  );
}

function FilaGuia({ g }: { g: Guia }) {
  return (
    <Link href={`/manual?guia=${g.id}`} className="flex min-h-16 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 no-underline transition hover:border-[var(--brand)]">
      <span className="min-w-0 flex-1 text-base font-semibold text-slate-800">{g.titulo}</span>
      <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
    </Link>
  );
}

export default function ManualPage() {
  return (
    <Suspense fallback={null}>
      <Manual />
    </Suspense>
  );
}

function Manual() {
  const menu = useMenuVisible();
  const me = menu.cargando ? null : menu;
  const router = useRouter();
  const params = useSearchParams();
  const idGuia = params.get("guia");
  const idTema = params.get("tema");
  const [q, setQ] = useState("");

  const rubroImagen: RubroImagen = "comercio";
  const ordenCarpetas = useMemo(() => ["neura"], []);
  /** Una guía se muestra si la pantalla que explica está en el menú de esta persona. */
  const guias = useMemo(() => {
    if (menu.cargando) return [];
    const rutas = menu.familias.flatMap((f) => f.pantallas.map((p) => p.href));
    return GUIAS.filter((g) => {
      if (!g.ruta || g.ruta === "/") return true;
      return rutas.some((r) => g.ruta === r || g.ruta!.startsWith(`${r}/`));
    });
  }, [menu]);

  // Recorrido completo: primero el día de trabajo, después lo básico y los temas en el orden de la portada.
  const recorrido = useMemo(() => {
    const orden = ["Primeros pasos", ...TEMAS.map((t) => t.grupo).filter((g) => g !== "Primeros pasos")];
    const pos = (g: Guia) => (g.id.startsWith("dia-") ? -1 : orden.indexOf(g.grupo) === -1 ? orden.length : orden.indexOf(g.grupo));
    return guias.map((g, i) => ({ g, i })).sort((a, b) => pos(a.g) - pos(b.g) || a.i - b.i).map((x) => x.g);
  }, [guias]);
  const nRecorrido = params.get("recorrido");
  const enRecorrido = nRecorrido !== null && /^\d+$/.test(nRecorrido) ? Math.min(Number(nRecorrido), Math.max(recorrido.length - 1, 0)) : null;
  useEffect(() => {
    if (enRecorrido === null || !recorrido.length) return;
    try { localStorage.setItem("manual-recorrido", String(enRecorrido)); } catch { /* sin almacenamiento: no pasa nada */ }
  }, [enRecorrido, recorrido.length]);
  const [guardado, setGuardado] = useState<number | null>(null);
  useEffect(() => {
    if (enRecorrido !== null) return; // se relee al volver a la portada
    try { const v = Number(localStorage.getItem("manual-recorrido")); setGuardado(Number.isFinite(v) && v > 0 ? v : null); } catch { setGuardado(null); }
  }, [enRecorrido]);

  if (enRecorrido !== null && recorrido[enRecorrido]) {
    const g = recorrido[enRecorrido];
    const proximo = recorrido.findIndex((x, k) => k > enRecorrido && x.grupo !== g.grupo);
    const temaProx = proximo > enRecorrido + 1 ? TEMAS.find((t) => t.grupo === recorrido[proximo].grupo) : null;
    return (
      <ContextoRubro.Provider value={ordenCarpetas}>
        <Recorrido key={`r-${enRecorrido}`} guia={g} rubro={rubroImagen}
          serie={{ n: enRecorrido, total: recorrido.length, siguiente: recorrido[enRecorrido + 1] ?? null, proximoTema: temaProx ? { n: proximo, titulo: temaProx.titulo } : null }} />
      </ContextoRubro.Provider>
    );
  }

  const guia = guias.find((g) => g.id === idGuia) ?? null;
  if (guia) {
    return (
      <ContextoRubro.Provider value={ordenCarpetas}>
        <Recorrido key={guia.id} guia={guia} rubro={rubroImagen} />
      </ContextoRubro.Provider>
    );
  }

  const tema = TEMAS.find((t) => t.grupo === idTema);
  if (tema) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 pb-12">
        <Link href="/manual" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-slate-500 no-underline hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> Volver
        </Link>
        <h1 className="flex items-center gap-3 text-2xl font-bold text-slate-900"><tema.Icono className="h-7 w-7 text-[var(--brand)]" /> {tema.titulo}</h1>
        <p className="text-base text-slate-600">Tocá lo que querés hacer.</p>
        <div className="space-y-2">
          {guias.filter((g) => g.grupo === tema.grupo).map((g) => <FilaGuia key={g.id} g={g} />)}
        </div>
      </div>
    );
  }

  const n = norm(q.trim());
  const encontradas = n ? guias.filter((g) => textoDeGuia(g).includes(n)) : [];
  const delDia = guias.find((g) => g.id.startsWith("dia-"));

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-12">
      <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">¿Qué querés hacer?</h1>
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Escribilo acá. Por ejemplo: cargar un cliente" aria-label="Buscar en el manual"
          className="min-h-14 w-full rounded-xl border border-slate-200 bg-white pl-12 pr-4 text-base text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-[var(--brand)]" />
      </div>

      {me === null ? <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white" /> : null}

      {n ? (
        encontradas.length ? (
          <div className="space-y-2">{encontradas.map((g) => <FilaGuia key={g.id} g={g} />)}</div>
        ) : (
          <p className="text-base text-slate-600">No encontramos eso. Probá con otra palabra, como «caja» o «stock», o elegí un tema.</p>
        )
      ) : (
        <>
          {recorrido.length ? (
            <div className="space-y-2">
              <button type="button" onClick={() => router.push("/manual?recorrido=0")} className="flex min-h-20 w-full items-center gap-4 rounded-2xl bg-[var(--brand)] p-4 text-left text-white">
                <Rocket className="h-8 w-8 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-bold">¿Es tu primera vez? Empezá acá</span>
                  <span className="block text-sm text-white/85">Un recorrido por todo el sistema, paso a paso ({recorrido.length} guías){delDia ? ", empezando por un día de trabajo" : ""}</span>
                </span>
                <ArrowRight className="h-6 w-6 shrink-0" aria-hidden />
              </button>
              {guardado !== null && guardado < recorrido.length ? (
                <button type="button" onClick={() => router.push(`/manual?recorrido=${guardado}`)} className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 text-left text-sm font-medium text-slate-700 transition hover:border-[var(--brand)]">
                  <span className="min-w-0 flex-1">Seguir el recorrido donde lo dejaste: <span className="font-semibold text-slate-900">guía {guardado + 1} de {recorrido.length}</span></span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-[var(--brand)]" aria-hidden />
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TEMAS.filter((t) => guias.some((g) => g.grupo === t.grupo)).map((t) => (
              <Link key={t.grupo} href={`/manual?tema=${encodeURIComponent(t.grupo)}`} className="flex min-h-24 items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 no-underline transition hover:border-[var(--brand)] sm:flex-col sm:items-start sm:gap-2">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-slate-100 text-[var(--brand)]"><t.Icono className="h-6 w-6" /></span>
                <span className="min-w-0">
                  <span className="block text-base font-bold text-slate-900">{t.titulo}</span>
                  <span className="block text-sm text-slate-500">{t.detalle}</span>
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
