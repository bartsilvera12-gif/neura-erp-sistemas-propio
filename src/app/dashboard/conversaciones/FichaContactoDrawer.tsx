"use client";

import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type {
  FichaContacto,
  FichaConversacion,
  FichaEvento,
  FichaProyecto,
} from "@/lib/chat/ficha-contacto";

/**
 * Ficha del contacto, al costado derecho del chat.
 *
 * Va superpuesta sobre el panel de mensajes en vez de ocupar una columna propia: el inbox es
 * un layout de columnas con bastante historia encima, y meterle una tercera obligaría a
 * reacomodar todo. Superpuesto, cerrado no existe y abierto no mueve nada de lugar.
 *
 * Los datos se piden una sola vez por conversación y quedan cacheados en memoria mientras la
 * pantalla siga montada, así reabrir es instantáneo.
 */

type Props = {
  conversationId: string;
  abierto: boolean;
  alCerrar: () => void;
};

export default function FichaContactoDrawer({ conversationId, abierto, alCerrar }: Props) {
  return (
    <LimiteDeError alCerrar={alCerrar}>
      <FichaPanel conversationId={conversationId} abierto={abierto} alCerrar={alCerrar} />
    </LimiteDeError>
  );
}

function FichaPanel({ conversationId, abierto, alCerrar }: Props) {
  const [ficha, setFicha] = useState<FichaContacto | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef(new Map<string, FichaContacto>());

  useEffect(() => {
    if (!abierto || !conversationId) return;
    const enCache = cache.current.get(conversationId);
    if (enCache) {
      setFicha(enCache);
      setError(null);
      return;
    }
    let vigente = true;
    setCargando(true);
    setError(null);
    setFicha(null);
    fetchWithSupabaseSession(
      `/api/chat/contactos/ficha?conversation_id=${encodeURIComponent(conversationId)}`,
      { cache: "no-store" }
    )
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as
          | { ok: true; ficha: FichaContacto }
          | { ok: false; error?: string }
          | null;
        if (!vigente) return;
        if (!r.ok || !j || j.ok !== true) {
          setError(j && "error" in j && j.error ? j.error : "No se pudo cargar la ficha");
          return;
        }
        cache.current.set(conversationId, j.ficha);
        setFicha(j.ficha);
      })
      .catch(() => {
        if (vigente) setError("No se pudo cargar la ficha");
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [abierto, conversationId]);

  // Escape cierra, como cualquier panel del sistema.
  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") alCerrar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abierto, alCerrar]);

  if (!abierto) return null;

  return (
    <>
      {/* Telón: solo captura el clic, sin oscurecer, para no perder de vista el chat. */}
      <button
        type="button"
        aria-label="Cerrar ficha"
        onClick={alCerrar}
        className="absolute inset-0 z-20 cursor-default bg-slate-900/10"
      />
      <aside
        role="dialog"
        aria-label="Ficha del contacto"
        className="absolute inset-y-0 right-0 z-30 flex w-1/2 min-w-[24rem] max-w-[92vw] flex-col border-l border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Ficha del contacto</h2>
          <button
            type="button"
            onClick={alCerrar}
            aria-label="Cerrar"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {cargando ? <Esqueleto /> : null}
          {error && !cargando ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {error}
            </p>
          ) : null}
          {ficha && !cargando ? <Contenido ficha={ficha} /> : null}
        </div>
      </aside>
    </>
  );
}

function Contenido({ ficha }: { ficha: FichaContacto }) {
  const { contacto, cliente, proyectos, ultima_tipificacion, conversaciones, linea_tiempo, notas } =
    ficha;

  return (
    <div className="flex flex-col gap-4">
      {/* Identidad */}
      <section>
        <p className="text-base font-semibold leading-tight text-slate-900">
          {contacto.nombre ?? "Sin nombre"}
        </p>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="font-mono text-xs tabular-nums text-slate-500">{contacto.telefono}</span>
          <BotonCopiar valor={contacto.telefono} />
        </div>
        {contacto.creado_en ? (
          <p className="mt-1 text-[11px] text-slate-400">
            Primer contacto: {fechaLarga(contacto.creado_en)}
          </p>
        ) : null}
      </section>

      {/* Última tipificación */}
      {ultima_tipificacion ? (
        <Seccion titulo="Último estado">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs font-semibold text-slate-800">
              {ultima_tipificacion.estado ?? "—"}
              {ultima_tipificacion.subestado && ultima_tipificacion.subestado !== "—" ? (
                <span className="font-normal text-slate-500"> · {ultima_tipificacion.subestado}</span>
              ) : null}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {fechaLarga(ultima_tipificacion.fecha)}
              {ultima_tipificacion.por ? ` · ${ultima_tipificacion.por}` : ""}
            </p>
            {ultima_tipificacion.comentario ? (
              <p className="mt-1 text-[11px] leading-snug text-slate-600">
                {ultima_tipificacion.comentario}
              </p>
            ) : null}
          </div>
        </Seccion>
      ) : null}

      {/* Cliente */}
      <Seccion titulo="Cliente">
        {cliente ? (
          <div className="rounded-xl border border-[#4FAEB2]/30 bg-[#4FAEB2]/5 px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-semibold text-slate-900">{cliente.nombre}</p>
              <Link
                href={`/clientes/${cliente.id}`}
                className="shrink-0 text-[11px] font-semibold text-[#3F8E91] hover:underline"
              >
                Abrir →
              </Link>
            </div>
            <dl className="mt-1.5 grid gap-x-3 gap-y-1 text-[11px] sm:grid-cols-2">
              <Dato etiqueta="RUC" valor={cliente.ruc} />
              <Dato etiqueta="Teléfono" valor={cliente.telefono} />
              <Dato etiqueta="Email" valor={cliente.email} />
              <Dato etiqueta="Ciudad" valor={cliente.ciudad} />
              <Dato etiqueta="Dirección" valor={cliente.direccion} />
            </dl>
            {cliente.via !== "guardado" ? (
              <p className="mt-1.5 text-[10px] italic text-slate-500">
                {cliente.via === "contacto" && cliente.contacto
                  ? `Vinculado por el contacto ${cliente.contacto}`
                  : cliente.via === "nombre"
                    ? "Coincidencia por nombre, sin confirmar"
                    : "Vinculado por teléfono"}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-200 px-3 py-2 text-[11px] text-slate-500">
            Sin cliente vinculado.
          </p>
        )}
      </Seccion>

      {/* Proyectos: null = sin permiso al módulo, no se muestra la sección. */}
      {proyectos ? (
        <Seccion titulo={`Proyectos${proyectos.length ? ` (${proyectos.length})` : ""}`}>
          {proyectos.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 px-3 py-2 text-[11px] text-slate-500">
              Este cliente no tiene proyectos.
            </p>
          ) : (
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {proyectos.map((p) => (
                <FilaProyecto key={p.id} p={p} />
              ))}
            </ul>
          )}
        </Seccion>
      ) : null}

      {/* Conversaciones */}
      {conversaciones.length > 0 ? (
        <Seccion titulo={`Conversaciones (${conversaciones.length})`}>
          <ul className="flex flex-col gap-1">
            {conversaciones.map((c) => (
              <FilaConversacion key={c.id} c={c} />
            ))}
          </ul>
        </Seccion>
      ) : null}

      {/* Recorrido */}
      {linea_tiempo.length > 0 ? (
        <Seccion titulo="Recorrido">
          <ol className="flex flex-col">
            {linea_tiempo.map((e, i) => (
              <FilaEvento key={e.id} e={e} ultimo={i === linea_tiempo.length - 1} />
            ))}
          </ol>
        </Seccion>
      ) : null}

      {notas.map((n) => (
        <p key={n} className="text-[10px] leading-snug text-slate-400">
          {n}
        </p>
      ))}
    </div>
  );
}

function FilaProyecto({ p }: { p: FichaProyecto }) {
  return (
    <li
      className={`rounded-xl border px-3 py-2 ${
        p.archivado || p.es_final ? "border-slate-200 bg-slate-50/60" : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className={`text-xs font-semibold ${
            p.archivado || p.es_final ? "text-slate-500" : "text-slate-900"
          }`}
        >
          {p.nombre}
          {p.archivado ? (
            <span className="ml-1.5 font-normal text-[10px] uppercase text-slate-400">
              archivado
            </span>
          ) : null}
        </p>
        <Link
          href={`/dashboard/proyectos?proyecto=${p.id}`}
          className="shrink-0 text-[11px] font-semibold text-[#3F8E91] hover:underline"
        >
          Ver →
        </Link>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {p.estado ? (
          <span
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
            style={
              p.estado_color
                ? {
                    borderColor: `${p.estado_color}55`,
                    backgroundColor: `${p.estado_color}14`,
                    color: p.estado_color,
                  }
                : undefined
            }
          >
            {p.estado}
          </span>
        ) : null}
        {p.tipo ? (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600">
            {p.tipo}
          </span>
        ) : null}
      </div>
      {p.project_manager || p.responsable_tecnico ? (
        <p className="mt-1 text-[10px] text-slate-500">
          {[
            p.project_manager ? `PM: ${p.project_manager}` : null,
            p.responsable_tecnico ? `Técnico: ${p.responsable_tecnico}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
    </li>
  );
}

function FilaConversacion({ c }: { c: FichaConversacion }) {
  return (
    <li
      className={`rounded-lg border px-2.5 py-1.5 ${
        c.actual ? "border-[#4FAEB2]/40 bg-[#4FAEB2]/8" : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-medium text-slate-700">
          {c.canal ?? c.canal_tipo ?? "Canal"}
          {c.cola ? <span className="text-slate-400"> · {c.cola}</span> : null}
        </span>
        <span className="shrink-0 text-[10px] tabular-nums text-slate-400">
          {fechaCorta(c.ultimo_mensaje_at)}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5">
        <span
          className={`text-[10px] font-semibold uppercase ${
            c.estado === "closed" ? "text-slate-400" : "text-emerald-600"
          }`}
        >
          {c.estado === "closed" ? "Cerrada" : "Abierta"}
        </span>
        {c.agente ? <span className="truncate text-[10px] text-slate-500">{c.agente}</span> : null}
        {c.actual ? (
          <span className="ml-auto shrink-0 text-[10px] font-semibold text-[#3F8E91]">Actual</span>
        ) : null}
      </div>
    </li>
  );
}

const COLOR_EVENTO: Record<FichaEvento["tipo"], string> = {
  ingreso: "bg-slate-300",
  asignado: "bg-sky-400",
  tomado: "bg-emerald-500",
  transferido: "bg-violet-500",
  cola: "bg-amber-500",
  cerrado: "bg-slate-500",
  sistema: "bg-slate-200",
};

function FilaEvento({ e, ultimo }: { e: FichaEvento; ultimo: boolean }) {
  return (
    <li className="flex gap-2.5">
      <div className="flex flex-col items-center pt-1">
        <span className={`h-2 w-2 shrink-0 rounded-full ${COLOR_EVENTO[e.tipo]}`} aria-hidden />
        {!ultimo ? <span className="w-px flex-1 bg-slate-200" aria-hidden /> : null}
      </div>
      <div className={ultimo ? "pb-0" : "pb-3"}>
        <p className="text-[11px] font-medium leading-snug text-slate-800">{e.titulo}</p>
        {e.detalle ? <p className="text-[10px] leading-snug text-slate-500">{e.detalle}</p> : null}
        <p className="text-[10px] tabular-nums text-slate-400">{fechaLarga(e.fecha)}</p>
      </div>
    </li>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {titulo}
      </h3>
      {children}
    </section>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
  if (!valor) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-slate-400">{etiqueta}</dt>
      <dd className="truncate text-[11px] text-slate-700" title={valor}>
        {valor}
      </dd>
    </div>
  );
}

function BotonCopiar({ valor }: { valor: string }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = useCallback(() => {
    navigator.clipboard
      ?.writeText(valor)
      .then(() => {
        setCopiado(true);
        setTimeout(() => setCopiado(false), 1200);
      })
      .catch(() => undefined);
  }, [valor]);
  return (
    <button
      type="button"
      onClick={copiar}
      title="Copiar número"
      className="text-[10px] font-semibold text-slate-400 transition-colors hover:text-[#3F8E91]"
    >
      {copiado ? "copiado" : "copiar"}
    </button>
  );
}

function Esqueleto() {
  return (
    <div className="flex animate-pulse flex-col gap-3" aria-hidden>
      <div className="h-4 w-2/3 rounded bg-slate-200" />
      <div className="h-3 w-1/3 rounded bg-slate-100" />
      <div className="h-16 rounded-xl bg-slate-100" />
      <div className="h-24 rounded-xl bg-slate-100" />
      <div className="h-20 rounded-xl bg-slate-100" />
    </div>
  );
}

const FMT_LARGO = new Intl.DateTimeFormat("es-PY", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const FMT_CORTO = new Intl.DateTimeFormat("es-PY", { day: "2-digit", month: "2-digit", year: "2-digit" });

function fechaLarga(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : FMT_LARGO.format(d);
}

function fechaCorta(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : FMT_CORTO.format(d);
}

/**
 * Si la ficha explota, muere sola. Sin esto, una excepción acá desmonta todo el árbol de React
 * y el asesor se queda con el chat en blanco en medio de una conversación.
 */
class LimiteDeError extends Component<
  { children: ReactNode; alCerrar: () => void },
  { rompio: boolean }
> {
  state = { rompio: false };

  static getDerivedStateFromError() {
    return { rompio: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[ficha-contacto] la ficha falló:", error);
  }

  render() {
    if (!this.state.rompio) return this.props.children;
    return (
      <aside className="absolute inset-y-0 right-0 z-30 flex w-1/2 min-w-[24rem] max-w-[92vw] flex-col border-l border-slate-200 bg-white p-4 shadow-2xl">
        <p className="text-xs text-slate-600">No se pudo mostrar la ficha.</p>
        <button
          type="button"
          onClick={this.props.alCerrar}
          className="mt-2 self-start rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-slate-300"
        >
          Cerrar
        </button>
      </aside>
    );
  }
}
