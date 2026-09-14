"use client";

import Link from "next/link";
import {
  AlarmClock,
  Banknote,
  BellRing,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Headset,
  MessageSquare,
  MoveRight,
  PackageCheck,
  TimerOff,
  XCircle,
} from "lucide-react";
import { fechaRelativa } from "@/app/dashboard/proyectos/components/qa/ui";
import {
  destinoEnApp,
  useNotificaciones,
  type Notificacion,
  type NotificacionTipo,
} from "@/shared/hooks/useNotificaciones";
import { useMisModulos } from "@/shared/hooks/useMisModulos";
import AsesorTabBar from "../AsesorTabBar";

/** Ícono y etiqueta por tipo, en la misma línea que la campanita del escritorio. */
const ESTILO: Record<NotificacionTipo, { Icono: typeof BellRing; label: string; wrap: string }> = {
  qa_novedad: { Icono: ClipboardList, label: "QA", wrap: "bg-amber-50 text-amber-700" },
  qa_aprobado: { Icono: CheckCircle2, label: "QA", wrap: "bg-emerald-50 text-emerald-700" },
  qa_rechazado: { Icono: XCircle, label: "QA", wrap: "bg-red-50 text-red-700" },
  qa_vence: { Icono: TimerOff, label: "QA", wrap: "bg-amber-50 text-amber-700" },
  esqueleto_por_vencer: { Icono: AlarmClock, label: "Esqueleto", wrap: "bg-amber-50 text-amber-700" },
  esqueleto_vencido: { Icono: TimerOff, label: "Esqueleto", wrap: "bg-red-50 text-red-700" },
  proyecto_estado_cambio: { Icono: MoveRight, label: "Proyecto", wrap: "bg-slate-100 text-slate-600" },
  proyecto_entregado: { Icono: PackageCheck, label: "Proyecto", wrap: "bg-emerald-50 text-emerald-700" },
  cobro_pendiente: { Icono: Banknote, label: "Cobranza", wrap: "bg-amber-50 text-amber-700" },
  comentario_proyecto: { Icono: MessageSquare, label: "Comentario", wrap: "bg-sky-50 text-sky-700" },
  agenda_recordatorio: { Icono: CalendarClock, label: "Agenda", wrap: "bg-violet-50 text-violet-700" },
  chat_interno_mensaje: { Icono: Headset, label: "Chat interno", wrap: "bg-sky-50 text-sky-700" },
  conversacion_asignada: { Icono: Headset, label: "Conversación", wrap: "bg-[#4FAEB2]/15 text-[#3F8E91]" },
  conversacion_mensaje: { Icono: MessageSquare, label: "Conversación", wrap: "bg-[#4FAEB2]/15 text-[#3F8E91]" },
};

const FALLBACK = { Icono: BellRing, label: "Aviso", wrap: "bg-slate-100 text-slate-600" };

export default function MAsesorAvisosPage() {
  const { tieneModulo } = useMisModulos();
  const habilitado = tieneModulo("proyectos_movil");
  const { notificaciones, noLeidas, isLoading, error, marcarLeidas } = useNotificaciones();

  return (
    <div className="flex h-svh min-h-0 flex-col bg-slate-50">
      <header
        className="z-10 shrink-0 bg-[#3F8E91] px-4 pb-3 text-white shadow-sm"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base font-semibold">Avisos</h1>
            <p className="text-[11px] text-white/80">
              {noLeidas > 0 ? `${noLeidas} sin leer` : "Todo al día"}
            </p>
          </div>
          {noLeidas > 0 ? (
            <button
              type="button"
              onClick={() => void marcarLeidas({ todas: true })}
              className="min-h-[36px] shrink-0 rounded-full bg-white/95 px-3.5 text-[13px] font-semibold text-[#3F8E91] shadow-sm active:bg-white"
            >
              Marcar todo
            </button>
          ) : null}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
        {habilitado === false ? (
          <p className="p-6 text-center text-sm text-slate-500">
            Tu usuario no tiene habilitada esta vista.
          </p>
        ) : isLoading ? (
          <p className="p-6 text-center text-sm text-slate-400 animate-pulse">Cargando…</p>
        ) : error ? (
          <p className="m-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error.message}
          </p>
        ) : notificaciones.length === 0 ? (
          <div className="p-10 text-center">
            <BellRing className="mx-auto h-8 w-8 text-slate-300" aria-hidden />
            <p className="mt-2 text-sm text-slate-500">No tenés avisos.</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 bg-white">
            {notificaciones.map((n) => (
              <AvisoItem key={n.id} n={n} onMarcar={() => void marcarLeidas({ ids: [n.id] })} />
            ))}
          </ul>
        )}
      </main>

      <AsesorTabBar />
    </div>
  );
}

function AvisoItem({ n, onMarcar }: { n: Notificacion; onMarcar: () => void }) {
  const { Icono, label, wrap } = ESTILO[n.tipo] ?? FALLBACK;
  const noLeida = !n.leida_at;
  /* Las derivadas no tienen fila en la base: se apagan solas cuando el proyecto avanza. */
  const marcable = !n.derivada && noLeida;
  const destino = destinoEnApp(n);

  const contenido = (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${wrap}`} aria-hidden>
        <Icono className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1 break-words text-[13px] font-semibold text-slate-900">
            {n.titulo}
          </span>
          {noLeida ? (
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#0EA5E9]" aria-label="Sin leer" />
          ) : null}
        </div>
        {n.cuerpo ? (
          <p className="mt-0.5 break-words text-[12px] leading-snug text-slate-600">{n.cuerpo}</p>
        ) : null}
        <p className="mt-1 text-[11px] text-slate-400">
          {label} · {fechaRelativa(n.created_at)}
          {destino ? "" : " · solo lectura"}
        </p>
      </div>
    </div>
  );

  return (
    <li>
      {destino ? (
        <Link href={destino} onClick={() => marcable && onMarcar()} className="block active:bg-slate-50">
          {contenido}
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => marcable && onMarcar()}
          className="block w-full text-left active:bg-slate-50"
        >
          {contenido}
        </button>
      )}
    </li>
  );
}
