"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlarmClock,
  Banknote,
  Bell,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardList,
  BellRing,
  Headset,
  MessageSquare,
  Music2,
  PackageCheck,
  Play,
  TimerOff,
  MoveRight,
  Volume2,
  VolumeX,
  XCircle,
} from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { createBrowserClientForSchema } from "@/lib/supabase";
import { autenticarRealtime } from "@/lib/realtime/autenticar";
import { fechaRelativa } from "@/app/dashboard/proyectos/components/qa/ui";
import {
  escribirSonidoActivado,
  leerSonidoActivado,
  reproducirSonidoNotificacion,
  reproducirSonidoReunion,
  reproducirSonidoConversacion,
  prepararSonidos,
} from "@/lib/notificaciones/sonido";
import {
  TONOS,
  escribirTonoSeleccionado,
  leerTonoSeleccionado,
} from "@/lib/notificaciones/tono-preferencia";
import {
  estadoPermisoAviso,
  mostrarAvisoSistema,
  pedirPermisoAviso,
  type EstadoPermiso,
} from "@/lib/notificaciones/aviso-sistema";

type TipoNotificacion =
  | "qa_novedad"
  | "qa_aprobado"
  | "qa_rechazado"
  | "esqueleto_por_vencer"
  | "esqueleto_vencido"
  | "proyecto_estado_cambio"
  | "proyecto_entregado"
  | "cobro_pendiente"
  | "comentario_proyecto"
  | "agenda_recordatorio"
  | "qa_vence"
  | "chat_interno_mensaje"
  | "conversacion_asignada"
  | "conversacion_mensaje";

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
  /** Sólo en comentarios: canal al que apunta, para abrir la sección correcta. */
  metadata?: {
    canal?: string;
    sala_id?: string;
    mencion?: boolean;
    conversation_id?: string;
  } | null;
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

/**
 * Cuántos chats de cliente esperan sin abrir.
 *
 * Lo publica la campanita y lo consume el contador de la pestaña, que ya cuenta
 * el chat interno. Un solo número en la pestaña —"tenés N cosas"— y la
 * distinción de qué es cada una donde se puede mostrar: el icono y el color en
 * la campanita, y el sonido al llegar.
 */
export const EVENTO_CONVERSACIONES_PENDIENTES = "conversaciones:pendientes";

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
  chat_interno_mensaje: {
    icon: MessageSquare,
    wrap: "bg-[#4FAEB2]/12 text-[#3F8E91]",
    label: "Chat interno",
  },
  conversacion_mensaje: {
    // Mismo look que la asignación: para quien mira, las dos cosas son "un
    // cliente te está esperando". Cambia el texto, no la categoría.
    icon: Headset,
    wrap: "bg-violet-50 text-violet-600",
    label: "Mensaje de cliente",
  },
  conversacion_asignada: {
    // Distinto del chat interno a propósito, y en las dos señales que se leen
    // sin pensar: el icono (un contacto, no un globo) y el color. Un chat de
    // cliente y un mensaje de un compañero no se atienden igual.
    icon: Headset,
    wrap: "bg-violet-50 text-violet-600",
    label: "Chat de cliente",
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
  cobro_pendiente: {
    icon: Banknote,
    // Ámbar: requiere una acción (aprobar/rechazar en Conciliación).
    wrap: "bg-amber-50 text-amber-600",
    label: "Cobro por aprobar",
  },
  comentario_proyecto: {
    icon: MessageSquare,
    wrap: "bg-[#4FAEB2]/12 text-[#3F8E91]",
    label: "Nuevo comentario",
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
  /** Chats de cliente ya avisados, para no repetir el sonido por el mismo. */
  const chatsAvisadosRef = useRef<Set<string>>(new Set());
  /** Avisos del sistema ya mostrados, para no repetirlos en cada recarga. */
  const avisadosFueraRef = useRef<Set<string>>(new Set());
  const [permisoAviso, setPermisoAviso] = useState<EstadoPermiso>("default");

  useEffect(() => {
    // El audio se desbloquea con el primer gesto de la persona. Si se espera al
    // primer aviso, ya es tarde: para entonces suele estar en otra pestaña.
    prepararSonidos();
    setPermisoAviso(estadoPermisoAviso());
  }, []);
  const [sonidoActivado, setSonidoActivado] = useState(true);
  const [tonoAbierto, setTonoAbierto] = useState(false);
  const [tonoSel, setTonoSel] = useState<string>("1");
  const [cargando, setCargando] = useState(false);
  const [sesion, setSesion] = useState<UsuarioSesion | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const cargarRef = useRef<() => Promise<void>>(undefined);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      // `solo_no_leidas`: la campanita es una bandeja de pendientes, no un
      // historial. Lo ya leído deja de aparecer; lo que pasó queda en el
      // historial del proyecto, que es donde se busca a propósito.
      const res = await fetchWithSupabaseSession("/api/notificaciones?limit=20&solo_no_leidas=1", {
        cache: "no-store",
      });
      const j = (await res.json().catch(() => null)) as ApiResp | null;
      if (res.ok && j?.success && j.data) {
        setItems(j.data.notificaciones);
        setNoLeidas(j.data.no_leidas);
        // La pestaña suma esto a su contador. Se publica desde acá y no con
        // otro pedido: la campanita ya tiene el dato, preguntarlo dos veces
        // sería pagar dos veces por lo mismo.
        window.dispatchEvent(
          new CustomEvent(EVENTO_CONVERSACIONES_PENDIENTES, {
            detail: {
              n: j.data.notificaciones.filter(
                (n) =>
                  (n.tipo === "conversacion_asignada" ||
                    n.tipo === "conversacion_mensaje") &&
                  !n.leida_at
              ).length,
            },
          })
        );
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
          // Un chat de cliente que cae en la cola tiene su propio sonido:
          // descendente y más grave. Quien está trabajando oye uno solo y
          // tiene que saber de qué es sin mirar la pantalla.
          const idsChat = new Set(
            j.data.notificaciones
              .filter(
                (n) =>
                  n.tipo === "conversacion_asignada" || n.tipo === "conversacion_mensaje"
              )
              .map((n) => n.id)
          );
          const hayChatNuevo = [...idsChat].some((id) => !chatsAvisadosRef.current.has(id));
          if (hayReunionNueva) {
            reproducirSonidoReunion();
          } else if (hayChatNuevo) {
            reproducirSonidoConversacion();
          } else {
            reproducirSonidoNotificacion();
          }
          chatsAvisadosRef.current = idsChat;

          // Y afuera de la pestaña. Quien está en otro programa no ve la
          // campanita ni oye nada si el navegador está minimizado; esto es lo
          // único que sale de acá.
          for (const n of j.data.notificaciones) {
            if (n.leida_at || avisadosFueraRef.current.has(n.id)) continue;
            const mostrado = mostrarAvisoSistema({
              titulo: n.titulo,
              cuerpo: n.cuerpo ?? "",
              etiqueta: n.tipo,
              destino:
                n.tipo === "chat_interno_mensaje"
                  ? "/dashboard/chat-interno"
                  : n.tipo === "conversacion_asignada" || n.tipo === "conversacion_mensaje"
                    ? "/dashboard/conversaciones"
                    : null,
            });
            if (mostrado) avisadosFueraRef.current.add(n.id);
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
    setTonoSel(leerTonoSeleccionado());
  }, []);

  const alternarSonido = useCallback(() => {
    setSonidoActivado((prev) => {
      const next = !prev;
      escribirSonidoActivado(next);
      return next;
    });
  }, []);

  const elegirTono = useCallback((id: string) => {
    escribirTonoSeleccionado(id);
    setTonoSel(id);
    // Previsualiza el tono elegido para que la persona escuche lo que guardó.
    try {
      const url = TONOS.find((t) => t.id === id)?.url;
      if (url) {
        const a = new Audio(url);
        a.volume = 0.8;
        void a.play().catch(() => {});
      }
    } catch {
      /* ignore */
    }
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
    let vivo = true;
    let channel: ReturnType<typeof sb.channel> | null = null;
    void (async () => {
      // Sin autenticar el socket, RLS no deja pasar ni un evento y la
      // suscripción queda "conectada" sin recibir nunca nada.
      await autenticarRealtime(sb);
      if (!vivo) return;
      channel = sb
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
    })();
    return () => {
      vivo = false;
      if (channel) void sb.removeChannel(channel);
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
      // Optimista: la notificación se va de la lista al instante y la recarga
      // confirma. Los avisos DERIVADOS se quedan: no son filas que se puedan
      // marcar, se calculan en vivo y volverían en el próximo poll — sacarlos
      // los haría parpadear.
      if (payload.todas) {
        setItems((prev) => prev.filter((n) => n.derivada));
        setNoLeidas(derivadasRef.current);
      } else if (payload.ids && payload.ids.length > 0) {
        const ids = payload.ids;
        const set = new Set(ids);
        setItems((prev) => prev.filter((n) => n.derivada || !set.has(n.id)));
        setNoLeidas((n) => Math.max(derivadasRef.current, n - ids.length));
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
              <button
                type="button"
                onClick={() => setTonoAbierto((v) => !v)}
                title="Elegir tono de notificación"
                aria-label="Elegir tono de notificación"
                aria-expanded={tonoAbierto}
                className={`rounded-md p-1 transition-colors hover:bg-slate-100 hover:text-slate-600 ${
                  tonoAbierto ? "bg-slate-100 text-slate-700" : "text-slate-400"
                }`}
              >
                <Music2 className="h-3.5 w-3.5" />
              </button>
              {/*
                El permiso del navegador se pide DESDE ACÁ, con un clic, y no al
                cargar la página: un navegador que recibe el pedido de entrada lo
                bloquea para siempre, y después no hay vuelta atrás sin ir a la
                configuración.
              */}
              {permisoAviso === "default" ? (
                <button
                  type="button"
                  onClick={() => void pedirPermisoAviso().then(setPermisoAviso)}
                  title="Avisarme aunque esté en otra pestaña o programa"
                  aria-label="Activar avisos del sistema"
                  className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                >
                  <BellRing className="h-3.5 w-3.5" />
                </button>
              ) : null}
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

          {tonoAbierto ? (
            <div className="border-b border-slate-100 bg-slate-50/60 px-3.5 py-2.5">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Tono de notificación
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {TONOS.map((t) => {
                  const activo = tonoSel === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => elegirTono(t.id)}
                      title={`Usar ${t.nombre}`}
                      aria-pressed={activo}
                      className={`flex items-center justify-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                        activo
                          ? "border-[#0EA5E9] bg-[#0EA5E9] text-white"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
                      }`}
                    >
                      <Play className="h-3 w-3" />
                      {t.id}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[10px] leading-tight text-slate-400">
                Se guarda en este navegador. Tocá un tono para probarlo y elegirlo.
              </p>
            </div>
          ) : null}

          <ul className="max-h-[26rem] divide-y divide-slate-100 overflow-y-auto">
            {items.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-slate-400">
                {cargando ? "Cargando…" : "Estás al día. No hay notificaciones pendientes."}
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

                const destino = n.cita_id
                  ? "/dashboard/agenda"
                  // Al chat se entra a LA conversación del aviso, no a la
                  // bandeja: si no, hay que buscar de nuevo lo que te avisaron.
                  : n.tipo === "chat_interno_mensaje"
                  ? `/dashboard/chat-interno${
                      n.metadata?.sala_id ? `?sala=${n.metadata.sala_id}` : ""
                    }`
                  // Al inbox, y abriendo LA conversación del aviso.
                  : n.tipo === "conversacion_asignada" || n.tipo === "conversacion_mensaje"
                  ? `/dashboard/conversaciones${
                      n.metadata?.conversation_id ? `?c=${n.metadata.conversation_id}` : ""
                    }`
                  : n.tipo === "cobro_pendiente"
                  ? "/cobranzas/conciliacion"
                  : n.tipo === "comentario_proyecto" && n.proyecto_id
                  ? // Abre el MODAL del proyecto en el Kanban, directo en la solapa
                    // Comentarios y en la sección del canal (para PM/QA que ven
                    // ambas). El Kanban lee ?proyecto/tab/cc y abre el modal.
                    `/dashboard/proyectos?proyecto=${n.proyecto_id}&tab=comentarios${
                      n.metadata?.canal ? `&cc=${n.metadata.canal}` : ""
                    }`
                  : n.proyecto_id
                  ? `/dashboard/proyectos/${n.proyecto_id}`
                  : null;

                return (
                  <li key={n.id} className="relative">
                    {destino ? (
                      <Link
                        href={destino}
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
