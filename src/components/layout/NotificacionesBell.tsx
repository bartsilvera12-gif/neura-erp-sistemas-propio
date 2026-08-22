"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlarmClock,
  Bell,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardList,
  PackageCheck,
  TimerOff,
  MoveRight,
  Volume2,
  VolumeX,
  XCircle,
} from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { createBrowserClientForSchema } from "@/lib/supabase";
import { fechaRelativa } from "@/app/dashboard/proyectos/components/qa/ui";
import {
  escribirSonidoActivado,
  leerSonidoActivado,
  reproducirSonidoNotificacion,
  reproducirSonidoReunion,
} from "@/lib/notificaciones/sonido";

type TipoNotificacion =
  | "qa_novedad"
  | "qa_aprobado"
  | "qa_rechazado"
  | "esqueleto_por_vencer"
  | "esqueleto_vencido"
  | "proyecto_estado_cambio"
  | "proyecto_entregado"
  | "agenda_recordatorio"
  | "qa_vence";

type Notificacion = {
  id: string;
  tipo: TipoNotificacion;
  titulo: string;
  cuerpo: string | null;
  proyecto_id: string | null;
  observacion_id: string | null;
  agrupadas: number;
  leida_at: string | null;
  created_at: string;
  /**
   * Aviso calculado en vivo por la API, sin fila en la base (compromiso de
   * esqueleto). No se puede marcar leído: se apaga cuando el proyecto avanza.
   */
  derivada?: boolean;
  /** Sólo en recordatorios de agenda: minutos que faltan para la reunión. */
  minutos_restantes?: number;
  /** Sólo en recordatorios de agenda: la cita a la que apunta. */
  cita_id?: string;
};

type ApiResp = {
  success: boolean;
  data?: { notificaciones: Notificacion[]; no_leidas: number };
  error?: string;
};

type UsuarioSesion = { id: string | null; data_schema: string | null };

/**
 * El Realtime de este ERP depende de que la RLS pueda resolver quién sos a
 * partir del JWT. Si esa cadena falla en algún tenant, el canal no entrega
 * nada y el contador se queda clavado en el valor que trajo la carga inicial —
 * un fallo silencioso. El polling de respaldo hace que la campanita funcione
 * igual, sólo que con hasta un minuto de demora.
 */
const POLL_MS = 60_000;

const ESTILO_TIPO: Record<
  TipoNotificacion,
  { icon: typeof Bell; wrap: string; label: string }
> = {
  qa_vence: {
    icon: AlarmClock,
    // Ámbar: es un plazo que se acerca, no un error todavía.
    wrap: "bg-amber-50 text-amber-600",
    label: "QA por vencer",
  },
  agenda_recordatorio: {
    icon: CalendarClock,
    // Teal de marca: es un aviso de agenda, no una alarma de error. El énfasis
    // lo pone el sonido, que sí es distinto del resto.
    wrap: "bg-[#4FAEB2]/12 text-[#3F8E91]",
    label: "Reunión próxima",
  },
  qa_novedad: {
    icon: ClipboardList,
    wrap: "bg-indigo-50 text-indigo-600",
    label: "Novedad de QA",
  },
  qa_aprobado: {
    icon: CheckCircle2,
    wrap: "bg-emerald-50 text-emerald-600",
    label: "QA aprobó",
  },
  qa_rechazado: {
    icon: XCircle,
    wrap: "bg-rose-50 text-rose-600",
    label: "QA rechazó",
  },
  esqueleto_por_vencer: {
    icon: AlarmClock,
    wrap: "bg-amber-50 text-amber-600",
    label: "Esqueleto por vencer",
  },
  esqueleto_vencido: {
    icon: TimerOff,
    wrap: "bg-rose-50 text-rose-600",
    label: "Esqueleto vencido",
  },
  proyecto_estado_cambio: {
    icon: MoveRight,
    wrap: "bg-sky-50 text-sky-600",
    label: "Cambio de estado",
  },
  proyecto_entregado: {
    icon: PackageCheck,
    wrap: "bg-emerald-50 text-emerald-600",
    label: "Proyecto entregado",
  },
};

export default function NotificacionesBell() {
  const [abierto, setAbierto] = useState(false);
  const [items, setItems] = useState<Notificacion[]>([]);
  const [noLeidas, setNoLeidas] = useState(0);
  /** Cuántos de los no leídos son avisos derivados (no se pueden marcar). */
  const derivadasRef = useRef(0);
  /**
   * Último `no_leidas` conocido, para saber si el sonido corresponde. `null`
   * marca "todavía no cargó nunca": la primera carga no debe sonar aunque ya
   * haya notificaciones sin leer, o sonaría cada vez que alguien abre la app.
   */
  const noLeidasPreviasRef = useRef<number | null>(null);
  /**
   * Ids de recordatorios de reunión por los que ya sonó la alerta. Como los
   * avisos se calculan en vivo, el mismo recordatorio vuelve en cada poll: sin
   * esto sonaría cada 60 segundos hasta que empiece la reunión.
   */
  const reunionesAvisadasRef = useRef<Set<string>>(new Set());
  const [sonidoActivado, setSonidoActivado] = useState(true);
  const [cargando, setCargando] = useState(false);
  const [sesion, setSesion] = useState<UsuarioSesion | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const cargarRef = useRef<() => Promise<void>>(undefined);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetchWithSupabaseSession("/api/notificaciones?limit=20", {
        cache: "no-store",
      });
      const j = (await res.json().catch(() => null)) as ApiResp | null;
      if (res.ok && j?.success && j.data) {
        setItems(j.data.notificaciones);
        setNoLeidas(j.data.no_leidas);
        derivadasRef.current = j.data.notificaciones.filter((n) => n.derivada).length;
        // Suena sólo si el total de no leídas SUBIÓ desde la última carga: una
        // notificación nueva de verdad, no el resultado de marcar algo leído
        // (que lo hace bajar) ni una recarga que trae lo mismo de antes.
        const previas = noLeidasPreviasRef.current;
        if (previas != null && j.data.no_leidas > previas) {
          // Los recordatorios de reunión llevan su propio sonido, más
          // insistente: tienen una hora encima y no pueden confundirse con el
          // aviso de una observación de QA.
          const idsReunion = new Set(
            j.data.notificaciones.filter((n) => n.tipo === "agenda_recordatorio").map((n) => n.id)
          );
          const hayReunionNueva = [...idsReunion].some((id) => !reunionesAvisadasRef.current.has(id));
          if (hayReunionNueva) {
            reproducirSonidoReunion();
          } else {
            reproducirSonidoNotificacion();
          }
          reunionesAvisadasRef.current = idsReunion;
        } else {
          // Se mantiene al día aunque no suene, para no volver a avisar por un
          // recordatorio que ya sonó.
          reunionesAvisadasRef.current = new Set(
            j.data.notificaciones.filter((n) => n.tipo === "agenda_recordatorio").map((n) => n.id)
          );
        }
        noLeidasPreviasRef.current = j.data.no_leidas;
      }
    } catch {
      // Sin conexión el header sigue funcionando: se reintenta en el próximo poll.
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargarRef.current = cargar;
  }, [cargar]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    setSonidoActivado(leerSonidoActivado());
  }, []);

  const alternarSonido = useCallback(() => {
    setSonidoActivado((prev) => {
      const next = !prev;
      escribirSonidoActivado(next);
      return next;
    });
  }, []);

  // Identidad + tenant para el canal de Realtime.
  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const res = await fetchWithSupabaseSession("/api/usuarios/me", { cache: "no-store" });
        const j = (await res.json().catch(() => null)) as { usuario?: UsuarioSesion } | null;
        if (vivo && j?.usuario) {
          setSesion({ id: j.usuario.id ?? null, data_schema: j.usuario.data_schema ?? null });
        }
      } catch {
        // Sin esto sólo se pierde el tiempo real; el polling cubre igual.
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    const usuarioId = sesion?.id;
    const schema = sesion?.data_schema;
    if (!usuarioId || !schema) return;
    const sb = createBrowserClientForSchema(schema);
    const channel = sb
      .channel(`usuario-notificaciones:${usuarioId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema,
          table: "usuario_notificaciones",
          filter: `usuario_id=eq.${usuarioId}`,
        },
        () => void cargarRef.current?.()
      )
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [sesion?.id, sesion?.data_schema]);

  useEffect(() => {
    const t = window.setInterval(() => void cargarRef.current?.(), POLL_MS);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!abierto) return;
    function onPointerDown(e: MouseEvent) {
      if (!panelRef.current?.contains(e.target as Node)) setAbierto(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setAbierto(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [abierto]);

  const marcarLeidas = useCallback(
    async (payload: { ids?: string[]; todas?: boolean }) => {
      // Optimista: el contador baja al instante y la recarga confirma.
      if (payload.todas) {
        // Los avisos derivados no se marcan: siguen encendidos hasta que el
        // proyecto avanza. Marcarlos acá sólo los apagaría hasta la recarga.
        setItems((prev) =>
          prev.map((n) => (n.derivada ? n : { ...n, leida_at: n.leida_at ?? new Date().toISOString() }))
        );
        // Quedan encendidos los avisos derivados, que no se apagan a mano.
        setNoLeidas(derivadasRef.current);
      } else if (payload.ids && payload.ids.length > 0) {
        const ids = payload.ids;
        const set = new Set(ids);
        setItems((prev) =>
          prev.map((n) => (set.has(n.id) ? { ...n, leida_at: n.leida_at ?? new Date().toISOString() } : n))
        );
        setNoLeidas((n) => Math.max(0, n - ids.length));
      }
      try {
        await fetchWithSupabaseSession("/api/notificaciones/marcar-leidas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } finally {
        void cargarRef.current?.();
      }
    },
    []
  );

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => {
          setAbierto((v) => !v);
          if (!abierto) void cargar();
        }}
        aria-label="Notificaciones"
        aria-expanded={abierto}
        className="relative rounded-lg p-2 text-[#475569] transition-colors hover:bg-slate-50 hover:text-[#0EA5E9]"
      >
        <Bell className="h-5 w-5" />
        {noLeidas > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#0EA5E9] px-1 text-[10px] font-bold text-white">
            {noLeidas > 99 ? "99+" : noLeidas}
          </span>
        ) : null}
      </button>

      {abierto ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-3.5 py-2.5">
            <span className="text-sm font-semibold text-slate-900">Notificaciones</span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={alternarSonido}
                title={sonidoActivado ? "Silenciar sonido de notificaciones" : "Activar sonido de notificaciones"}
                aria-label={sonidoActivado ? "Silenciar sonido de notificaciones" : "Activar sonido de notificaciones"}
                aria-pressed={sonidoActivado}
                className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                {sonidoActivado ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
              </button>
              {noLeidas > 0 ? (
                <button
                  type="button"
                  onClick={() => void marcarLeidas({ todas: true })}
                  className="text-[11px] font-semibold text-[#0EA5E9] transition-colors hover:text-[#0284c7]"
                >
                  Marcar todas como leídas
                </button>
              ) : null}
            </div>
          </div>

          <ul className="max-h-[26rem] divide-y divide-slate-100 overflow-y-auto">
            {items.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-slate-400">
                {cargando ? "Cargando…" : "No tenés notificaciones."}
              </li>
            ) : (
              items.map((n) => {
                const estilo = ESTILO_TIPO[n.tipo] ?? ESTILO_TIPO.qa_novedad;
                const Icono = estilo.icon;
                const noLeida = n.leida_at == null;
                // Los avisos derivados no tienen fila: mandar su id a
                // marcar-leidas rompería la consulta (no es un uuid).
                const marcable = noLeida && !n.derivada;
                const contenido = (
                  <div className={`flex gap-3 px-3.5 py-3 ${marcable ? "pr-9" : ""} ${noLeida ? "bg-sky-50/40" : ""}`}>
                    <span
                      className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${estilo.wrap}`}
                      aria-hidden="true"
                    >
                      <Icono className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 break-words text-[13px] font-semibold text-slate-900">
                          {n.titulo}
                        </span>
                        {noLeida ? (
                          <span
                            className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#0EA5E9]"
                            aria-label="Sin leer"
                          />
                        ) : null}
                      </div>
                      {n.cuerpo ? (
                        <p className="mt-0.5 break-words text-[12px] leading-snug text-slate-600">
                          {n.cuerpo}
                        </p>
                      ) : null}
                      <p className="mt-1 text-[11px] text-slate-400">
                        {estilo.label} · {fechaRelativa(n.created_at)}
                      </p>
                    </div>
                  </div>
                );

                return (
                  <li key={n.id} className="relative">
                    {n.proyecto_id || n.cita_id ? (
                      <Link
                        href={n.cita_id ? "/dashboard/agenda" : `/dashboard/proyectos/${n.proyecto_id}`}
                        onClick={() => {
                          setAbierto(false);
                          if (marcable) void marcarLeidas({ ids: [n.id] });
                        }}
                        className="block transition-colors hover:bg-slate-50"
                      >
                        {contenido}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => marcable && void marcarLeidas({ ids: [n.id] })}
                        className="block w-full text-left transition-colors hover:bg-slate-50"
                      >
                        {contenido}
                      </button>
                    )}
                    {/* Botón explícito, aparte del click en toda la fila (que en
                        las notificaciones con proyecto también navega). Es un
                        hermano del Link/botón de arriba y no un hijo — así el
                        click nunca dispara la navegación por accidente. */}
                    {marcable ? (
                      <button
                        type="button"
                        onClick={() => void marcarLeidas({ ids: [n.id] })}
                        title="Marcar como leída"
                        aria-label={`Marcar "${n.titulo}" como leída`}
                        className="absolute right-2.5 top-2.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm ring-1 ring-slate-200 transition-colors hover:text-emerald-600 hover:ring-emerald-300"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
