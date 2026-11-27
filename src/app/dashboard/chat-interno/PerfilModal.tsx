"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Building2,
  Cake,
  Camera,
  ImagePlus,
  Info,
  Loader2,
  MessageSquare,
  Network,
  Palette,
  Pencil,
  X,
} from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { inicialesNombre, nombreCapitular, nombreCorto } from "@/lib/format/nombres";

/**
 * Perfil de una persona en el chat interno. El propio se edita (foto, nombre del chat,
 * cumpleaños y banner); el de los demás sólo se ve. Cargo, supervisor y equipo salen
 * del organigrama y se cambian allá, no acá: así no hay dos versiones del mismo dato.
 */

type Persona = { usuario_id: string | null; nombre: string; cargo: string; avatar_url: string | null };

type PerfilCompleto = {
  usuario_id: string;
  propio: boolean;
  nombre: string;
  nombre_completo: string;
  avatar_url: string | null;
  banner_color: string | null;
  banner_url: string | null;
  area: string | null;
  cumple_mes: number | null;
  cumple_dia: number | null;
  cumple_disponible: boolean;
  /** Sólo en el propio: la fecha completa (AAAA-MM-DD). */
  fecha_nacimiento: string | null;
  cargo: string | null;
  supervisores: Persona[];
  equipo: Persona[];
  en_linea: boolean;
  ultima_actividad: string | null;
};

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** "1995-03-14" → "14 de marzo de 1995 (31 años)". */
function fechaLarga(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  const hoy = new Date();
  let edad = hoy.getFullYear() - a;
  if (hoy.getMonth() + 1 < m || (hoy.getMonth() + 1 === m && hoy.getDate() < d)) edad -= 1;
  return `${d} de ${MESES[m - 1]} de ${a} (${edad} años)`;
}

/** Colores del banner: los de la marca, oscuros lo justo para que el nombre blanco se lea. */
export const COLORES_BANNER = ["#7C6FD8", "#4FAEB2", "#2F9BD8", "#22A06B", "#E0784A", "#D9477E", "#E0A526", "#475569"];
const BANNER_POR_DEFECTO = "#7C6FD8";

const COLORES_AVATAR = ["#4FAEB2", "#8b5cf6", "#f59e0b", "#ec4899", "#22c55e", "#0ea5e9"];
function colorDe(texto: string): string {
  let h = 0;
  for (let i = 0; i < texto.length; i++) h = (h * 31 + texto.charCodeAt(i)) >>> 0;
  return COLORES_AVATAR[h % COLORES_AVATAR.length];
}

function Cara({ nombre, url, size }: { nombre: string; url: string | null; size: number }) {
  const px = `${size}px`;
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={nombre} style={{ width: px, height: px }} className="shrink-0 rounded-full object-cover" />;
  }
  return (
    <span
      style={{ width: px, height: px, background: colorDe(nombre), fontSize: size * 0.36 }}
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
    >
      {inicialesNombre(nombre)}
    </span>
  );
}

function haceCuanto(iso: string | null): string {
  if (!iso) return "Sin actividad registrada";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 2) return "Activo ahora";
  if (min < 60) return `Activo hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `Activo hace ${h} h`;
  const d = new Date(iso);
  return `Activo el ${d.toLocaleDateString("es-PY", { day: "numeric", month: "long" })} a las ${d.toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Recorta la imagen del banner a 3:1 y la achica: un banner de 8 MB no aporta nada. */
async function prepararBanner(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, mal) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => mal(new Error("No se pudo leer la imagen"));
      i.src = url;
    });
    const W = 1200;
    const H = 400;
    const escala = Math.max(W / img.width, H / img.height);
    const w = img.width * escala;
    const h = img.height * escala;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    c.getContext("2d")!.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    return await new Promise<Blob>((ok, mal) => c.toBlob((b) => (b ? ok(b) : mal(new Error("No se pudo preparar la imagen"))), "image/jpeg", 0.85));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function PerfilModal({
  usuarioId,
  onCerrar,
  onCambio,
  onEnviarMensaje,
  onAbrirPerfil,
}: {
  usuarioId: string;
  onCerrar: () => void;
  /** El propio perfil cambió (foto, nombre, cumpleaños): el resto del chat lo recarga. */
  onCambio?: () => void;
  onEnviarMensaje?: (usuarioId: string, nombre: string) => void;
  /** Tocar al supervisor o a alguien del equipo abre su perfil. */
  onAbrirPerfil?: (usuarioId: string) => void;
}) {
  const [p, setP] = useState<PerfilCompleto | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState<string | null>(null);
  /** Fecha de nacimiento mientras se edita (AAAA-MM-DD); `null` = cerrado. */
  const [editCumple, setEditCumple] = useState<string | null>(null);
  const [editArea, setEditArea] = useState<string | null>(null);
  const [verColores, setVerColores] = useState(false);
  const fotoRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    const r = await fetchWithSupabaseSession(`/api/chat-interno/perfil/${usuarioId}`, { cache: "no-store" });
    const j = (await r.json().catch(() => ({}))) as { success?: boolean; data?: PerfilCompleto; error?: string };
    if (!r.ok || !j.success || !j.data) {
      setErr(j.error ?? "No se pudo cargar el perfil");
      return;
    }
    setP(j.data);
  }, [usuarioId]);

  useEffect(() => {
    setP(null);
    setErr(null);
    setEditNombre(null);
    setEditCumple(null);
    setVerColores(false);
    void cargar();
  }, [cargar]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onCerrar]);

  async function guardar(cuerpo: Record<string, unknown>, que: string) {
    setOcupado(que);
    setErr(null);
    try {
      const r = await fetchWithSupabaseSession("/api/chat-interno/perfil", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!r.ok || !j.success) {
        setErr(j.error ?? "No se pudo guardar");
        return false;
      }
      await cargar();
      onCambio?.();
      return true;
    } finally {
      setOcupado(null);
    }
  }

  async function subir(file: File | Blob, tipo: "foto" | "banner") {
    setOcupado(tipo);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file, tipo === "banner" ? "banner.jpg" : (file as File).name || "foto.jpg");
      if (tipo === "banner") fd.append("tipo", "banner");
      const r = await fetchWithSupabaseSession("/api/chat-interno/perfil", { method: "POST", body: fd });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!r.ok || !j.success) {
        setErr(j.error ?? "No se pudo subir la imagen");
        return;
      }
      await cargar();
      onCambio?.();
    } finally {
      setOcupado(null);
    }
  }

  const propio = !!p?.propio;
  const nombre = p ? nombreCapitular(p.nombre) : "";
  /** El color de la persona: pinta el banner, el botón y los recuadros. */
  const acento = p?.banner_color || BANNER_POR_DEFECTO;
  const fondo = p?.banner_url ? undefined : acento;
  const suave = `color-mix(in srgb, ${acento} 10%, white)`;
  const area = p?.area ? p.area.charAt(0).toUpperCase() + p.area.slice(1) : null;
  const subtitulo = [p?.cargo, area].filter(Boolean).join(" · ");
  const vieneDelOrganigrama = !!p && (!!p.cargo || p.supervisores.length > 0 || p.equipo.length > 0);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/45 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}
    >
      <div className="relative max-h-[92vh] w-full max-w-[24rem] overflow-y-auto rounded-[20px] bg-white shadow-2xl">
        {/* Banner */}
        <div
          className="relative h-28 bg-cover bg-center"
          style={{ background: fondo, backgroundImage: p?.banner_url ? `url(${p.banner_url})` : undefined }}
        >
          {!p?.banner_url ? (
            <div
              aria-hidden
              className="absolute inset-0 opacity-20"
              style={{ backgroundImage: "radial-gradient(#fff 1.5px, transparent 1.5px)", backgroundSize: "14px 14px" }}
            />
          ) : null}
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="absolute right-2.5 top-2.5 rounded-full bg-black/25 p-1.5 text-white hover:bg-black/40"
          >
            <X className="h-4 w-4" />
          </button>
          {propio ? (
            <button
              type="button"
              onClick={() => setVerColores((v) => !v)}
              title="Cambiar el fondo"
              className="absolute right-11 top-2.5 rounded-full bg-black/25 p-1.5 text-white hover:bg-black/40"
            >
              {ocupado === "banner" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Palette className="h-4 w-4" />}
            </button>
          ) : null}
          {verColores && propio ? (
            <div className="absolute right-2.5 top-11 z-10 w-56 rounded-xl border border-slate-200 bg-white p-2.5 shadow-xl">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fondo</p>
              <div className="grid grid-cols-4 gap-1.5">
                {COLORES_BANNER.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Color ${c}`}
                    onClick={() => void guardar({ banner_color: c }, "banner").then(() => setVerColores(false))}
                    style={{ background: c }}
                    className={`h-8 rounded-lg ring-offset-1 ${p?.banner_color === c && !p?.banner_url ? "ring-2 ring-slate-800" : ""}`}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => bannerRef.current?.click()}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-50"
              >
                <ImagePlus className="h-3.5 w-3.5" /> Subir una imagen
              </button>
              {p?.banner_url || p?.banner_color ? (
                <button
                  type="button"
                  onClick={() => void guardar({ banner_color: null }, "banner").then(() => setVerColores(false))}
                  className="mt-1 w-full py-1 text-[11.5px] text-slate-400 hover:text-slate-600"
                >
                  Volver al fondo original
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="px-5 pb-5">
          {/* Foto a la izquierda y las acciones a la derecha, sobre el borde del banner */}
          <div className="-mt-10 flex items-end justify-between gap-3">
            <div className="relative rounded-full border-4 border-white bg-white">
              {p ? <Cara nombre={p.nombre} url={p.avatar_url} size={80} /> : <span className="block h-20 w-20 rounded-full bg-slate-100" />}
              {p ? (
                <span
                  title={p.en_linea ? "En línea" : haceCuanto(p.ultima_actividad)}
                  className={`absolute bottom-1 right-1 h-3.5 w-3.5 rounded-full border-[3px] border-white ${
                    p.en_linea || propio ? "bg-emerald-500" : "bg-slate-400"
                  }`}
                />
              ) : null}
              {propio ? (
                <button
                  type="button"
                  onClick={() => fotoRef.current?.click()}
                  title="Cambiar mi foto"
                  style={{ background: acento }}
                  className="absolute -left-0.5 -bottom-0.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-white hover:opacity-90"
                >
                  {ocupado === "foto" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                </button>
              ) : null}
            </div>
            {p ? (
              <div className="mb-1.5 flex items-center gap-1.5">
                {!propio && onEnviarMensaje ? (
                  <button
                    type="button"
                    onClick={() => onEnviarMensaje(p.usuario_id, p.nombre)}
                    style={{ background: acento }}
                    className="flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold text-white shadow-sm hover:opacity-90"
                  >
                    <MessageSquare className="h-4 w-4" /> Mensaje
                  </button>
                ) : null}
                <a
                  href="/organigrama"
                  title="Ver en el organigrama"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                >
                  <Network className="h-4 w-4" />
                </a>
              </div>
            ) : null}
          </div>

          {/* Nombre, cargo · área y actividad */}
          {editNombre !== null ? (
            <input
              autoFocus
              value={editNombre}
              maxLength={60}
              onChange={(e) => setEditNombre(e.target.value)}
              onBlur={() => void guardar({ nombre: editNombre }, "nombre").then(() => setEditNombre(null))}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditNombre(null);
              }}
              placeholder={p?.nombre_completo ?? ""}
              style={{ borderColor: acento }}
              className="mt-2.5 w-full rounded-lg border px-2 py-1 text-[18px] font-semibold text-slate-800 focus:outline-none"
            />
          ) : (
            <button
              type="button"
              disabled={!propio}
              onClick={() => setEditNombre(p?.nombre ?? "")}
              title={propio ? "Cambiar cómo me ven en el chat" : undefined}
              className="group/nombre mt-2.5 flex items-center gap-1.5 text-left text-[19px] font-semibold leading-tight text-slate-800 disabled:cursor-default"
            >
              {p ? nombre : "…"}
              {propio ? <Pencil className="h-3.5 w-3.5 text-slate-300 group-hover/nombre:text-slate-500" /> : null}
            </button>
          )}
          {subtitulo ? (
            <p className="mt-0.5 text-[13.5px] font-medium" style={{ color: acento }}>
              {subtitulo}
            </p>
          ) : null}
          {p ? (
            <p className="mt-1 text-[12px] text-slate-500">
              {propio ? "En línea" : p.en_linea ? "En línea" : haceCuanto(p.ultima_actividad)}
            </p>
          ) : null}

          {err ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-1.5 text-[12px] text-rose-600">{err}</p> : null}
          {!p && !err ? (
            <p className="flex items-center justify-center gap-2 py-6 text-[13px] text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </p>
          ) : null}

          {p ? (
            <>
              {/* Cumpleaños y área, en dos recuadros */}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Recuadro
                  icono={<Cake className="h-3.5 w-3.5" />}
                  etiqueta={propio ? "Nacimiento" : "Cumpleaños"}
                  acento={acento}
                  suave={suave}
                  ancho={editCumple !== null}
                  onEditar={propio && p.cumple_disponible && editCumple === null ? () => setEditCumple(p.fecha_nacimiento ?? "") : undefined}
                >
                  {editCumple !== null ? (
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      <input
                        type="date"
                        value={editCumple}
                        min="1920-01-01"
                        max={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => setEditCumple(e.target.value)}
                        className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[13px]"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          void guardar({ fecha_nacimiento: editCumple || null }, "cumple").then((ok) => ok && setEditCumple(null))
                        }
                        style={{ background: acento }}
                        className="rounded-md px-2 py-0.5 text-[12px] font-semibold text-white"
                      >
                        {ocupado === "cumple" ? "…" : "Listo"}
                      </button>
                      <button type="button" onClick={() => setEditCumple(null)} className="text-[12px] text-slate-400">
                        Cancelar
                      </button>
                    </span>
                  ) : propio && p.fecha_nacimiento ? (
                    fechaLarga(p.fecha_nacimiento)
                  ) : p.cumple_mes && p.cumple_dia ? (
                    `${p.cumple_dia} de ${MESES[p.cumple_mes - 1]}`
                  ) : (
                    <span className="font-normal text-slate-400">Sin cargar</span>
                  )}
                </Recuadro>
                <Recuadro
                  icono={<Building2 className="h-3.5 w-3.5" />}
                  etiqueta="Área"
                  acento={acento}
                  suave={suave}
                  ancho={editArea !== null}
                  onEditar={propio && editArea === null ? () => setEditArea(p.area ?? "") : undefined}
                >
                  {editArea !== null ? (
                    <span className="mt-1 flex items-center gap-1.5">
                      <input
                        autoFocus
                        value={editArea}
                        maxLength={60}
                        onChange={(e) => setEditArea(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void guardar({ area: editArea }, "area").then((ok) => ok && setEditArea(null));
                          if (e.key === "Escape") setEditArea(null);
                        }}
                        placeholder="Ej: Soporte"
                        className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[13px] font-normal"
                      />
                      <button
                        type="button"
                        onClick={() => void guardar({ area: editArea }, "area").then((ok) => ok && setEditArea(null))}
                        style={{ background: acento }}
                        className="rounded-md px-2 py-0.5 text-[12px] font-semibold text-white"
                      >
                        {ocupado === "area" ? "…" : "Listo"}
                      </button>
                    </span>
                  ) : (
                    area ?? <span className="font-normal text-slate-400">Sin cargar</span>
                  )}
                </Recuadro>
              </div>

              {/* A quién reporta */}
              {p.supervisores.length > 0 ? (
                <>
                  <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Reporta a</p>
                  <div className="flex flex-col gap-2">
                    {p.supervisores.map((s) => (
                      <PersonaChip key={`${s.cargo}-${s.nombre}`} persona={s} onAbrir={onAbrirPerfil} />
                    ))}
                  </div>
                </>
              ) : null}

              {/* Su equipo */}
              {p.equipo.length > 0 ? (
                <>
                  <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                    A su cargo · {p.equipo.length}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {p.equipo.map((s) => (
                      <PersonaChip key={`${s.cargo}-${s.nombre}`} persona={s} onAbrir={onAbrirPerfil} compacto />
                    ))}
                  </div>
                </>
              ) : null}

              {vieneDelOrganigrama ? (
                <p className="mt-5 flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Info className="h-3.5 w-3.5" /> Cargo y supervisores salen del organigrama
                </p>
              ) : propio ? (
                <p className="mt-5 flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Info className="h-3.5 w-3.5" /> Todavía no estás en el organigrama
                </p>
              ) : null}
            </>
          ) : null}
        </div>

        <input
          ref={fotoRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void subir(f, "foto");
          }}
        />
        <input
          ref={bannerRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            void prepararBanner(f)
              .then((b) => subir(b, "banner"))
              .then(() => setVerColores(false))
              .catch((x: unknown) => setErr(x instanceof Error ? x.message : "No se pudo usar esa imagen"));
          }}
        />
      </div>
    </div>
  );
}

/** Un dato en un recuadro de color suave (cumpleaños, área). Al editar ocupa todo el ancho. */
function Recuadro({
  icono,
  etiqueta,
  acento,
  suave,
  ancho,
  onEditar,
  children,
}: {
  icono: React.ReactNode;
  etiqueta: string;
  acento: string;
  suave: string;
  ancho?: boolean;
  onEditar?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`group/rec relative rounded-xl px-3 py-2.5 ${ancho ? "col-span-2" : ""}`} style={{ background: suave }}>
      <p className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: acento }}>
        {icono}
        {etiqueta}
      </p>
      <div className="mt-0.5 text-[13.5px] font-semibold leading-snug text-slate-800">{children}</div>
      {onEditar ? (
        <button
          type="button"
          onClick={onEditar}
          aria-label={`Cambiar ${etiqueta.toLowerCase()}`}
          className="absolute right-2 top-2 rounded-md p-1 text-slate-400 opacity-60 hover:bg-white/70 hover:text-slate-700 group-hover/rec:opacity-100"
        >
          <Pencil className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

function PersonaChip({
  persona,
  onAbrir,
  compacto,
}: {
  persona: Persona;
  onAbrir?: (usuarioId: string) => void;
  compacto?: boolean;
}) {
  const puede = !!persona.usuario_id && !!onAbrir;
  return (
    <button
      type="button"
      disabled={!puede}
      onClick={() => persona.usuario_id && onAbrir?.(persona.usuario_id)}
      title={persona.cargo}
      className={`inline-flex min-w-0 max-w-full items-center text-left ${
        compacto ? "gap-1.5 rounded-full border border-slate-200 py-0.5 pl-0.5 pr-2.5" : "gap-2.5 rounded-xl px-1 py-0.5 -mx-1"
      } ${puede ? "hover:bg-slate-50" : "cursor-default"}`}
    >
      <Cara nombre={persona.nombre} url={persona.avatar_url} size={compacto ? 22 : 34} />
      {compacto ? (
        <span className="truncate text-[12.5px] text-slate-700">{nombreCorto(persona.nombre)}</span>
      ) : (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[13.5px] font-medium text-slate-800">{nombreCorto(persona.nombre)}</span>
          <span className="truncate text-[11.5px] text-slate-500">{persona.cargo}</span>
        </span>
      )}
    </button>
  );
}
