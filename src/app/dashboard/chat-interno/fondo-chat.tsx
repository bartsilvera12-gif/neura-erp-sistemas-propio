"use client";

/**
 * Fondo de la conversación, elegido por cada persona y guardado en SU navegador: liso (el de
 * siempre), un color suave o una imagen propia. No se sube a ningún lado ni lo ven los demás.
 *
 * La imagen se achica antes de guardarla (lado mayor 1600 px, JPEG): una foto de celular pesa
 * varios MB y el almacenamiento del navegador es chico.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { Check, ImageIcon, Trash2, Upload } from "lucide-react";

const CLAVE = "neura_chat_fondo";
const EVENTO = "neura:chat-fondo";
const LISO = "#F3F5F5";

export type FondoChat = { tipo: "liso" } | { tipo: "color"; valor: string } | { tipo: "imagen"; url: string };

const COLORES = [
  { nombre: "Liso", valor: LISO },
  { nombre: "Arena", valor: "#F3EEE6" },
  { nombre: "Menta", valor: "#E6F2EC" },
  { nombre: "Cielo", valor: "#E6EFF7" },
  { nombre: "Lavanda", valor: "#ECE9F6" },
  { nombre: "Rosa", valor: "#F7E9EE" },
  { nombre: "Grafito", valor: "#DFE3E8" },
];

let crudoVisto: string | null | undefined;
let fondoVisto: FondoChat = { tipo: "liso" };
const FONDO_LISO: FondoChat = { tipo: "liso" };

function leer(): FondoChat {
  let crudo: string | null = null;
  try {
    crudo = localStorage.getItem(CLAVE);
  } catch {
    crudo = null;
  }
  if (crudo === crudoVisto) return fondoVisto;
  crudoVisto = crudo;
  fondoVisto = FONDO_LISO;
  try {
    const j = crudo ? (JSON.parse(crudo) as Partial<{ tipo: string; valor: string; url: string }>) : null;
    if (j?.tipo === "color" && typeof j.valor === "string" && /^#[0-9a-f]{6}$/i.test(j.valor)) fondoVisto = { tipo: "color", valor: j.valor };
    // Solo imágenes guardadas por este mismo componente: un `data:` de imagen, nunca una dirección de afuera.
    else if (j?.tipo === "imagen" && typeof j.url === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(j.url)) fondoVisto = { tipo: "imagen", url: j.url };
  } catch {
    fondoVisto = FONDO_LISO;
  }
  return fondoVisto;
}

/** Guarda el fondo. Devuelve false si no entró en el almacenamiento del navegador. */
function guardar(f: FondoChat): boolean {
  try {
    if (f.tipo === "liso") localStorage.removeItem(CLAVE);
    else localStorage.setItem(CLAVE, JSON.stringify(f));
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(EVENTO));
  return true;
}

function suscribir(f: () => void): () => void {
  window.addEventListener(EVENTO, f);
  window.addEventListener("storage", f);
  return () => {
    window.removeEventListener(EVENTO, f);
    window.removeEventListener("storage", f);
  };
}

export function estiloDeFondo(f: FondoChat): CSSProperties {
  if (f.tipo === "color") return { backgroundColor: f.valor };
  if (f.tipo === "imagen") {
    // Queda quieta mientras los mensajes pasan por encima.
    return { backgroundColor: LISO, backgroundImage: `url("${f.url}")`, backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat" };
  }
  return { backgroundColor: LISO };
}

/** El fondo elegido en este navegador, ya como estilo para la conversación. */
export function useFondoChat(): { fondo: FondoChat; estilo: CSSProperties } {
  const fondo = useSyncExternalStore(suscribir, leer, () => FONDO_LISO);
  return { fondo, estilo: estiloDeFondo(fondo) };
}

/** Achica la imagen y la devuelve como `data:` JPEG. */
async function prepararImagen(archivo: File): Promise<string> {
  const mapa = await createImageBitmap(archivo);
  const lado = 1600;
  let calidad = 0.82;
  let escala = Math.min(1, lado / Math.max(mapa.width, mapa.height));
  for (let intento = 0; intento < 5; intento++) {
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.max(1, Math.round(mapa.width * escala));
    lienzo.height = Math.max(1, Math.round(mapa.height * escala));
    const ctx = lienzo.getContext("2d");
    if (!ctx) throw new Error("sin lienzo");
    // Blanco debajo: una imagen con transparencia no queda negra al pasar a JPEG.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    ctx.drawImage(mapa, 0, 0, lienzo.width, lienzo.height);
    const url = lienzo.toDataURL("image/jpeg", calidad);
    // ~1,2 MB de texto: entra cómodo y deja lugar para el resto de lo guardado.
    if (url.length < 1_200_000) return url;
    calidad -= 0.12;
    escala *= 0.8;
  }
  throw new Error("muy pesada");
}

/** Botón de la cabecera del chat: abre el selector de fondo. */
export function BotonFondoChat() {
  const { fondo } = useFondoChat();
  const [abierto, setAbierto] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const cajaRef = useRef<HTMLDivElement>(null);
  const archivoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (!cajaRef.current?.contains(e.target as Node)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierto]);

  const subir = async (archivo: File | undefined) => {
    if (!archivo) return;
    if (!archivo.type.startsWith("image/")) return setAviso("Elegí una imagen (JPG, PNG o WebP).");
    setAviso(null);
    setCargando(true);
    try {
      const url = await prepararImagen(archivo);
      if (!guardar({ tipo: "imagen", url })) setAviso("No hay lugar en el navegador para guardar esa imagen. Probá con una más chica.");
    } catch {
      setAviso("No se pudo usar esa imagen. Probá con otra.");
    } finally {
      setCargando(false);
    }
  };

  const colorActual = fondo.tipo === "color" ? fondo.valor.toLowerCase() : fondo.tipo === "liso" ? LISO.toLowerCase() : null;

  return (
    <div ref={cajaRef} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        title="Fondo del chat"
        aria-label="Fondo del chat"
        aria-expanded={abierto}
        className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
          abierto ? "bg-[#4FAEB2]/15 text-[#2F6E71]" : "text-slate-500 hover:bg-slate-100 hover:text-[#2F6E71]"
        }`}
      >
        <ImageIcon className="h-4 w-4" />
      </button>

      {abierto ? (
        <div className="absolute right-0 top-full z-40 mt-1.5 w-[272px] rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xl shadow-slate-900/10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">Fondo del chat</p>
          <div className="mt-2.5 grid grid-cols-7 gap-1.5" role="radiogroup" aria-label="Color de fondo">
            {COLORES.map((c) => {
              const elegido = colorActual === c.valor.toLowerCase();
              return (
                <button
                  key={c.valor}
                  type="button"
                  role="radio"
                  aria-checked={elegido}
                  aria-label={c.nombre}
                  title={c.nombre}
                  onClick={() => { setAviso(null); guardar(c.valor === LISO ? { tipo: "liso" } : { tipo: "color", valor: c.valor }); }}
                  className={`flex aspect-square items-center justify-center rounded-lg border transition-transform hover:scale-110 ${elegido ? "border-slate-500" : "border-slate-200"}`}
                  style={{ backgroundColor: c.valor }}
                >
                  {elegido ? <Check aria-hidden className="h-3.5 w-3.5 text-slate-600" /> : null}
                </button>
              );
            })}
          </div>

          {fondo.tipo === "imagen" ? (
            <div className="mt-3 h-20 rounded-xl border border-slate-200 bg-cover bg-center" style={{ backgroundImage: `url("${fondo.url}")` }} aria-label="Tu imagen de fondo" role="img" />
          ) : null}

          <input ref={archivoRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { void subir(e.target.files?.[0]); e.target.value = ""; }} />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => archivoRef.current?.click()}
              disabled={cargando}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3 py-2 text-[12px] font-semibold text-white transition hover:bg-[#3F8E91] disabled:opacity-60"
            >
              <Upload aria-hidden className="h-3.5 w-3.5" />
              {cargando ? "Preparando…" : fondo.tipo === "imagen" ? "Cambiar imagen" : "Subir imagen"}
            </button>
            {fondo.tipo !== "liso" ? (
              <button
                type="button"
                onClick={() => { setAviso(null); guardar({ tipo: "liso" }); }}
                title="Quitar el fondo"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                <Trash2 aria-hidden className="h-3.5 w-3.5" />
                Quitar
              </button>
            ) : null}
          </div>
          {aviso ? <p className="mt-2 text-[11px] leading-snug text-rose-600">{aviso}</p> : null}
          <p className="mt-2 text-[11px] leading-snug text-slate-400">Se guarda en este navegador. Los demás no lo ven.</p>
        </div>
      ) : null}
    </div>
  );
}
