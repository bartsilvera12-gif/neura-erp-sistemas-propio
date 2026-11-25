"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Briefcase,
  Building2,
  Cake,
  Camera,
  Clock,
  ImagePlus,
  Loader2,
  MessageSquare,
  Network,
  Palette,
  Pencil,
  Users,
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
  const fondo = p?.banner_url ? undefined : p?.banner_color || BANNER_POR_DEFECTO;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/45 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}
    >
      <div className="relative w-full max-w-[24rem] overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Banner */}
        <div
          className="relative h-28 bg-cover bg-center"
          style={{ background: fondo, backgroundImage: p?.banner_url ? `url(${p.banner_url})` : undefined }}
        >
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

        {/* Foto, nombre, cargo y estado */}
        <div className="-mt-11 flex flex-col items-center px-5 text-center">
          <div className="relative rounded-full border-4 border-white bg-white">
            {p ? <Cara nombre={p.nombre} url={p.avatar_url} size={84} /> : <span className="block h-[84px] w-[84px] rounded-full bg-slate-100" />}
            {propio ? (
              <button
                type="button"
                onClick={() => fotoRef.current?.click()}
                title="Cambiar mi foto"
                className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[#7C6FD8] text-white hover:opacity-90"
              >
                {ocupado === "foto" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
              </button>
            ) : null}
          </div>

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
              className="mt-2 w-full rounded-lg border border-[#7C6FD8] px-2 py-1 text-center text-[17px] font-semibold text-slate-800 focus:outline-none"
            />
          ) : (
            <button
              type="button"
              disabled={!propio}
              onClick={() => setEditNombre(p?.nombre ?? "")}
              title={propio ? "Cambiar cómo me ven en el chat" : undefined}
              className="mt-2 inline-flex items-center gap-1.5 text-[18px] font-semibold text-slate-800 disabled:cursor-default"
            >
              {p ? nombre : "…"}
              {propio ? <Pencil className="h-3.5 w-3.5 text-slate-300" /> : null}
            </button>
          )}
          {p?.cargo ? <p className="text-[13px] font-medium text-[#6A5CC9]">{p.cargo}</p> : null}
          {p ? (
            <span
              className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ${
                p.en_linea ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${p.en_linea ? "bg-emerald-500" : "bg-slate-400"}`} />
              {p.en_linea ? "En línea" : haceCuanto(p.ultima_actividad)}
            </span>
          ) : null}
        </div>

        {/* Datos */}
        <div className="px-5 pb-5 pt-3">
          {err ? <p className="mb-2 rounded-lg bg-rose-50 px-3 py-1.5 text-[12px] text-rose-600">{err}</p> : null}
          {!p && !err ? (
            <p className="flex items-center justify-center gap-2 py-6 text-[13px] text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </p>
          ) : null}
          {p ? (
            <ul className="divide-y divide-slate-100">
              <Fila icono={<Briefcase className="h-4 w-4" />} etiqueta="Cargo" fuente="Organigrama">
                {p.cargo ?? <span className="text-slate-400">Sin puesto en el organigrama</span>}
              </Fila>
              <Fila icono={<Network className="h-4 w-4" />} etiqueta={p.supervisores.length > 1 ? "Supervisores" : "Supervisor"} fuente="Organigrama">
                {p.supervisores.length === 0 ? (
                  <span className="text-slate-400">—</span>
                ) : (
                  <span className="flex flex-col gap-1.5 py-0.5">
                    {p.supervisores.map((s) => (
                      <PersonaChip key={`${s.cargo}-${s.nombre}`} persona={s} onAbrir={onAbrirPerfil} />
                    ))}
                  </span>
                )}
              </Fila>
              {p.equipo.length > 0 ? (
                <Fila icono={<Users className="h-4 w-4" />} etiqueta={`A cargo (${p.equipo.length})`} fuente="Organigrama">
                  <span className="flex flex-wrap gap-1">
                    {p.equipo.map((s) => (
                      <PersonaChip key={`${s.cargo}-${s.nombre}`} persona={s} onAbrir={onAbrirPerfil} compacto />
                    ))}
                  </span>
                </Fila>
              ) : null}
              <Fila icono={<Cake className="h-4 w-4" />} etiqueta={propio ? "Fecha de nacimiento" : "Cumpleaños"}>
                {editCumple !== null ? (
                  <span className="flex items-center gap-1.5">
                    <input
                      type="date"
                      value={editCumple}
                      min="1920-01-01"
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => setEditCumple(e.target.value)}
                      className="rounded-md border border-slate-200 px-1.5 py-0.5 text-[13px]"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        void guardar({ fecha_nacimiento: editCumple || null }, "cumple").then((ok) => ok && setEditCumple(null))
                      }
                      className="rounded-md bg-[#7C6FD8] px-2 py-0.5 text-[12px] font-semibold text-white"
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
                  <span className="text-slate-400">Sin cargar</span>
                )}
                {propio && p.cumple_disponible && editCumple === null ? (
                  <button
                    type="button"
                    onClick={() => setEditCumple(p.fecha_nacimiento ?? "")}
                    aria-label="Cambiar mi fecha de nacimiento"
                    className="ml-auto text-slate-300 hover:text-slate-500"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </Fila>
              {p.area ? (
                <Fila icono={<Building2 className="h-4 w-4" />} etiqueta="Área">
                  {nombreCapitular(p.area)}
                </Fila>
              ) : null}
              <Fila icono={<Clock className="h-4 w-4" />} etiqueta="Última vez activo">
                {propio ? "Ahora" : haceCuanto(p.ultima_actividad).replace(/^Activo /, "")}
              </Fila>
            </ul>
          ) : null}

          {p && !propio && onEnviarMensaje ? (
            <button
              type="button"
              onClick={() => onEnviarMensaje(p.usuario_id, p.nombre)}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#7C6FD8] py-2.5 text-[13.5px] font-semibold text-white hover:opacity-90"
            >
              <MessageSquare className="h-4 w-4" /> Enviar mensaje
            </button>
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

function Fila({
  icono,
  etiqueta,
  fuente,
  children,
}: {
  icono: React.ReactNode;
  etiqueta: string;
  fuente?: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">{icono}</span>
      <div className="min-w-0 flex-1">
        {/* La fuente va al lado del título y no en una columna aparte: ahí se encimaba con el dato. */}
        <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
          {etiqueta}
          {fuente ? (
            <span className="rounded-full bg-violet-50 px-1.5 py-px text-[9.5px] font-medium text-violet-500">{fuente}</span>
          ) : null}
        </p>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-[13.5px] text-slate-700">{children}</div>
      </div>
    </li>
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
      className={`inline-flex min-w-0 max-w-full items-center gap-2 text-left ${
        compacto ? "rounded-full bg-slate-50 py-0.5 pl-0.5 pr-2" : ""
      } ${puede ? "hover:text-[#6A5CC9]" : "cursor-default"}`}
    >
      <Cara nombre={persona.nombre} url={persona.avatar_url} size={compacto ? 20 : 28} />
      {compacto ? (
        <span className="truncate text-[12.5px]">{nombreCorto(persona.nombre)}</span>
      ) : (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[13px] font-medium">{nombreCorto(persona.nombre)}</span>
          <span className="truncate text-[11.5px] text-slate-400">{persona.cargo}</span>
        </span>
      )}
    </button>
  );
}
