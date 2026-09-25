"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type {
  FichaContacto,
  FichaConversacion,
  FichaEvento,
  FichaProyecto,
} from "@/lib/chat/ficha-contacto";

/**
 * Ficha del contacto en la app móvil: la misma que el escritorio, a pantalla completa.
 *
 * Comparte endpoint con el escritorio y con la app nativa, así que quién puede ver qué se
 * decide una sola vez, en el servidor.
 *
 * Lo único que cambia es el recorrido: en el escritorio es una tabla de cinco columnas, y en
 * un teléfono eso obliga a desplazarse en horizontal para leer cada fila. Acá cada paso es
 * una tarjeta con los mismos cinco datos, uno debajo del otro — igual que en la nativa.
 */

type Props = {
  conversationId: string;
  alCerrar: () => void;
};

export default function FichaContactoMovil({ conversationId, alCerrar }: Props) {
  const [ficha, setFicha] = useState<FichaContacto | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
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
  }, [conversationId]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-50">
      <header
        className="sticky top-0 z-10 flex items-center gap-2 bg-[#3F8E91] px-2 pb-2.5 text-white shadow-sm"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.625rem)" }}
      >
        <button
          onClick={alCerrar}
          aria-label="Cerrar"
          className="grid h-9 w-9 place-items-center rounded-full text-lg active:bg-white/15"
        >
          ‹
        </button>
        <h1 className="truncate text-sm font-semibold">Ficha del contacto</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {cargando ? (
          <p className="py-6 text-center text-sm text-slate-400">Cargando…</p>
        ) : error ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {error}
          </p>
        ) : ficha ? (
          <Contenido ficha={ficha} />
        ) : null}
      </div>
    </div>
  );
}

function Contenido({ ficha }: { ficha: FichaContacto }) {
  const { contacto, cliente, proyectos, ultima_tipificacion, conversaciones, linea_tiempo, notas } =
    ficha;

  return (
    <div className="flex flex-col gap-4">
      <section>
        <p className="text-base font-semibold text-slate-900">{contacto.nombre ?? "Sin nombre"}</p>
        <p className="font-mono text-xs tabular-nums text-slate-500">{contacto.telefono}</p>
        {contacto.creado_en ? (
          <p className="mt-0.5 text-[11px] text-slate-400">
            Primer contacto: {fechaLarga(contacto.creado_en)}
          </p>
        ) : null}
      </section>

      {ultima_tipificacion ? (
        <Seccion titulo="Último cierre">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-xs font-semibold text-slate-800">
              {ultima_tipificacion.estado ?? "—"}
              {ultima_tipificacion.subestado && ultima_tipificacion.subestado !== "—"
                ? ` · ${ultima_tipificacion.subestado}`
                : ""}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {fechaLarga(ultima_tipificacion.fecha)}
              {ultima_tipificacion.por ? ` · cerró ${ultima_tipificacion.por}` : ""}
            </p>
            {ultima_tipificacion.comentario ? (
              <p className="mt-1 text-[11px] text-slate-600">{ultima_tipificacion.comentario}</p>
            ) : null}
            {ultima_tipificacion.reabierta ? (
              <p className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1 text-[10px] text-amber-800">
                La conversación se reabrió después de este cierre, así que no refleja lo que está
                pasando ahora.
              </p>
            ) : !ultima_tipificacion.es_de_esta_conversacion ? (
              <p className="mt-1.5 text-[10px] italic text-slate-500">
                Corresponde a otra conversación de este contacto.
              </p>
            ) : null}
          </div>
        </Seccion>
      ) : null}

      <Seccion titulo="Cliente">
        {cliente ? (
          <div className="rounded-xl border border-[#4FAEB2]/30 bg-[#4FAEB2]/5 p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-semibold text-slate-900">{cliente.nombre}</p>
              <Link
                href={`/clientes/${cliente.id}`}
                className="shrink-0 text-[11px] font-semibold text-[#3F8E91]"
              >
                Abrir →
              </Link>
            </div>
            <dl className="mt-1.5 flex flex-col gap-1 text-[11px]">
              <Dato etiqueta="RUC" valor={cliente.ruc} />
              <Dato etiqueta="Teléfono" valor={cliente.telefono} />
              <Dato etiqueta="Email" valor={cliente.email} />
              <Dato etiqueta="Ciudad" valor={cliente.ciudad} />
              <Dato etiqueta="Dirección" valor={cliente.direccion} />
            </dl>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-200 bg-white p-3 text-[11px] text-slate-500">
            Sin cliente vinculado.
          </p>
        )}
      </Seccion>

      {proyectos ? (
        <Seccion titulo={`Proyectos${proyectos.length ? ` (${proyectos.length})` : ""}`}>
          {proyectos.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-white p-3 text-[11px] text-slate-500">
              Este cliente no tiene proyectos.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {proyectos.map((p) => (
                <FilaProyecto key={p.id} p={p} />
              ))}
            </ul>
          )}
        </Seccion>
      ) : null}

      {conversaciones.length > 0 ? (
        <Seccion titulo={`Conversaciones (${conversaciones.length})`}>
          <ul className="flex flex-col gap-1.5">
            {conversaciones.map((c) => (
              <FilaConversacion key={c.id} c={c} />
            ))}
          </ul>
        </Seccion>
      ) : null}

      {linea_tiempo.length > 0 ? (
        <Seccion titulo="Flujo / Acciones">
          <ul className="flex flex-col gap-1.5">
            {linea_tiempo.map((e) => (
              <FilaEvento key={e.id} e={e} />
            ))}
          </ul>
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
  const apagado = p.archivado || p.es_final;
  return (
    <li className={`rounded-xl border border-slate-200 p-3 ${apagado ? "bg-slate-50" : "bg-white"}`}>
      <p className={`text-xs font-semibold ${apagado ? "text-slate-500" : "text-slate-900"}`}>
        {p.nombre}
        {p.archivado ? (
          <span className="ml-1.5 text-[10px] font-normal uppercase text-slate-400">archivado</span>
        ) : null}
      </p>
      <div className="mt-1 flex flex-wrap gap-1">
        {p.estado ? (
          <span
            className="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
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
      className={`rounded-xl border p-2.5 ${
        c.actual ? "border-[#4FAEB2]/40 bg-[#4FAEB2]/8" : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-medium text-slate-700">
          {[c.canal, c.cola].filter(Boolean).join(" · ") || "Conversación"}
        </span>
        {c.actual ? (
          <span className="shrink-0 text-[10px] font-semibold text-[#3F8E91]">Actual</span>
        ) : null}
      </div>
      <div className="mt-0.5 flex items-center gap-2">
        <span
          className={`text-[10px] font-semibold ${
            c.estado === "closed" ? "text-slate-400" : "text-emerald-600"
          }`}
        >
          {c.estado === "closed" ? "Cerrada" : "Abierta"}
        </span>
        {c.agente ? <span className="truncate text-[10px] text-slate-500">{c.agente}</span> : null}
        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-slate-400">
          {fechaCorta(c.ultimo_mensaje_at)}
        </span>
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

function FilaEvento({ e }: { e: FichaEvento }) {
  const detalles: [string, string][] = (
    [
      ["Línea", e.linea],
      ["Usuario", e.usuario],
      ["Destino", e.destino],
    ] as [string, string | null][]
  ).filter((par): par is [string, string] => Boolean(par[1]));

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-2.5">
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${COLOR_EVENTO[e.tipo]}`} aria-hidden />
        <span className="text-[11px] font-semibold text-slate-800">{e.accion}</span>
        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-slate-400">
          {fechaLarga(e.fecha)}
        </span>
      </div>
      {detalles.map(([etiqueta, valor]) => (
        <p key={etiqueta} className="mt-0.5 flex gap-1.5 text-[10px] leading-snug">
          <span className="w-12 shrink-0 text-slate-400">{etiqueta}</span>
          <span className="text-slate-600">{valor}</span>
        </p>
      ))}
    </li>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {titulo}
      </h2>
      {children}
    </section>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
  if (!valor) return null;
  return (
    <div className="flex gap-1.5">
      <dt className="w-16 shrink-0 text-slate-400">{etiqueta}</dt>
      <dd className="min-w-0 break-words text-slate-700">{valor}</dd>
    </div>
  );
}

const FMT_LARGO = new Intl.DateTimeFormat("es-PY", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const FMT_CORTO = new Intl.DateTimeFormat("es-PY", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
});

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
