"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeftRight,
  Bug,
  CalendarCheck,
  CalendarClock,
  CircleCheckBig,
  ClipboardPen,
  ExternalLink,
  FileText,
  Flag,
  FolderKanban,
  HandCoins,
  Headset,
  History,
  Mail,
  MessageCircle,
  MessageSquareWarning,
  Paperclip,
  PenTool,
  Phone,
  Send,
  Timer,
  UserRound,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import CountUp from "@/components/reactbits/CountUp";
import { getCliente, clienteNombre } from "@/lib/clientes/storage";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type { Cliente } from "@/lib/clientes/types";
import {
  RESULTADOS_TIPIFICACION,
  TIPOS_GESTION,
  type ResultadoTipificacion,
  type Tipificacion,
  type TipoGestion,
} from "@/lib/gestion-clientes/types";
import { fechaHoraPy, vencimientoSla, type SoporteClasificacion, type SoporteTipo } from "@/lib/soporte/dominio";
import { apiSoporte, subirArchivos } from "@/app/dashboard/soporte/_ui/api";
import { FancySelect } from "@/app/dashboard/proyectos/components/FancySelect";
import AccesosProyecto from "@/app/dashboard/soporte/_ui/AccesosProyecto";
import { SelectorBuscable } from "@/app/dashboard/soporte/_ui/SelectorBuscable";
import ZonaArchivos from "@/app/dashboard/soporte/_ui/ZonaArchivos";
import {
  Avatar,
  Boton,
  Encabezado,
  IconoTile,
  Pagina,
  TONOS,
  claseEtiqueta,
  claseInput,
  type Tono,
} from "@/app/dashboard/soporte/_ui/ui";

// ── Constantes ────────────────────────────────────────────────────────────────

/**
 * Tipos que crean un ticket de Soporte, con el tipo de ticket de cada uno. Su
 * resultado es siempre "Escalar" (lo fija el servidor).
 */
const TIPO_TICKET: Partial<Record<TipoGestion, "error" | "cambio">> = { Error: "error", Cambio: "cambio" };

/** Lo que devuelve `/api/soporte/carga-rapida` para armar el ticket. */
type DatosSoporte = {
  tipos: SoporteTipo[];
  clasificaciones: SoporteClasificacion[];
  a_cargo: { id: string; nombre: string; area: string }[];
  responsable: { id: string; nombre: string; area: string } | null;
};

const TIPO_UI: Record<TipoGestion, { icono: LucideIcon; tono: Tono }> = {
  Consulta: { icono: MessageCircle, tono: "celeste" },
  Reclamo: { icono: MessageSquareWarning, tono: "naranja" },
  Seguimiento: { icono: CalendarClock, tono: "indigo" },
  "Promesa de pago": { icono: HandCoins, tono: "verde" },
  "Soporte técnico": { icono: Wrench, tono: "violeta" },
  "Cambio plan": { icono: ArrowLeftRight, tono: "azul" },
  Error: { icono: Bug, tono: "rosa" },
  Cambio: { icono: PenTool, tono: "ambar" },
};

const RESULTADO_TONO: Record<ResultadoTipificacion, Tono> = {
  Pendiente: "ambar",
  Resuelto: "verde",
  Escalar: "rosa",
};

const claseArea = `${claseInput} resize-none leading-relaxed`;
const sombra = "shadow-[0_1px_3px_rgba(15,23,42,0.05),0_8px_24px_-12px_rgba(15,23,42,0.08)]";

type Listado = {
  usuario_actual: { id: string | null; nombre: string };
  puede_soporte: boolean;
  tipificaciones: Tipificacion[];
};

type DatosTicket = {
  proyecto_id: string;
  modulo: string;
  asunto: string;
  descripcion: string;
  clasificacion_codigo: string;
  prioridad_codigo: string;
  responsable_id: string;
};

const TICKET_VACIO: DatosTicket = {
  proyecto_id: "",
  modulo: "",
  asunto: "",
  descripcion: "",
  clasificacion_codigo: "",
  prioridad_codigo: "normal",
  responsable_id: "",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatFechaHora(iso: string) {
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch { return ""; }
}

/** Tono del nivel según su SLA: cuanto más corto, más urgente se ve. */
function tonoSla(horas: number): Tono {
  if (horas <= 2) return "rosa";
  if (horas <= 5) return "ambar";
  return "verde";
}

// ── Piezas ────────────────────────────────────────────────────────────────────

function Seccion({
  titulo,
  detalle,
  icono,
  tono,
  children,
}: {
  titulo: string;
  detalle?: string;
  icono: LucideIcon;
  tono: Tono;
  children: React.ReactNode;
}) {
  return (
    <section className={`rounded-2xl border border-slate-200/80 bg-white ${sombra}`}>
      <header className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
        <IconoTile icono={icono} tono={tono} tam="sm" />
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold text-slate-800">{titulo}</h2>
          {detalle ? <p className="text-[12.5px] text-slate-500">{detalle}</p> : null}
        </div>
      </header>
      <div className="space-y-5 p-5">{children}</div>
    </section>
  );
}

function Campo({ etiqueta, requerido, ayuda, children }: { etiqueta: string; requerido?: boolean; ayuda?: string; children: React.ReactNode }) {
  return (
    <div>
      <span className={claseEtiqueta}>
        {etiqueta} {requerido ? <span className="text-rose-500">*</span> : null}
      </span>
      {children}
      {ayuda ? <p className="mt-1 text-[11.5px] text-slate-400">{ayuda}</p> : null}
    </div>
  );
}

/** Opción en forma de píldora con color propio: se elige de un vistazo, sin abrir menús. */
function Pildora({
  activa,
  tono,
  icono: Icono,
  children,
  onClick,
  disabled,
}: {
  activa: boolean;
  tono: Tono;
  icono?: LucideIcon;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  const t = TONOS[tono];
  return (
    <button
      type="button"
      role="radio"
      aria-checked={activa}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-[13px] font-semibold transition disabled:cursor-not-allowed ${
        activa
          ? `${t.suave} ${t.texto} ${t.borde} shadow-sm ring-2 ring-offset-1 ring-offset-white`
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
      }`}
      style={activa ? ({ ["--tw-ring-color" as string]: `${t.hex}40` } as React.CSSProperties) : undefined}
    >
      {Icono ? <Icono className="h-4 w-4" aria-hidden /> : null}
      {children}
    </button>
  );
}

function FilaResumen({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 text-[13px]">
      <span className="shrink-0 text-slate-500">{etiqueta}</span>
      <span className="min-w-0 text-right font-semibold text-slate-800">{children}</span>
    </div>
  );
}

// ── Página ────────────────────────────────────────────────────────────────────

export default function TipificacionPage() {
  const params = useParams();
  const router = useRouter();
  const id = (params?.id as string | undefined) ?? "";

  const [cliente,  setCliente]  = useState<Cliente | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [listado,  setListado]  = useState<Listado | null>(null);
  const [exito,    setExito]    = useState<string | null>(null);
  const [creado,   setCreado]   = useState<{ id: string; numero: number; aviso: string | null } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [resaltada, setResaltada] = useState<string | null>(null);

  const [form, setForm] = useState<{
    tipo_gestion: TipoGestion;
    resultado:    ResultadoTipificacion;
    observacion:  string;
  }>({
    tipo_gestion: "Consulta",
    resultado:    "Pendiente",
    observacion:  "",
  });
  const [ticket, setTicket] = useState<DatosTicket>(TICKET_VACIO);
  const [archivos, setArchivos] = useState<File[]>([]);

  // Datos de Soporte: sólo se piden cuando hace falta (tipo Error).
  const [cat, setCat] = useState<DatosSoporte | null>(null);
  const [catError, setCatError] = useState<string | null>(null);
  const [proyectos, setProyectos] = useState<{ id: string; titulo: string }[] | null>(null);

  const [error, setError] = useState<string | null>(null);

  const tipoTicket = TIPO_TICKET[form.tipo_gestion] ?? null;
  const esError = tipoTicket != null;
  const esCambio = tipoTicket === "cambio";

  const cargarListado = useCallback(async () => {
    const res = await fetchWithSupabaseSession(`/api/clientes/${id}/tipificaciones`, { cache: "no-store" });
    const j = (await res.json().catch(() => null)) as { success?: boolean; data?: Listado; error?: string } | null;
    if (res.ok && j?.success && j.data) setListado(j.data);
    else setError(j?.error ?? "No se pudo cargar el historial de tipificaciones.");
  }, [id]);

  useEffect(() => {
    if (!id) { setNotFound(true); return; }
    void (async () => {
      const c = await getCliente(id);
      if (!c) { setNotFound(true); return; }
      setCliente(c);
      await cargarListado();
    })();
  }, [id, cargarListado]);

  // Llegada desde un ticket (#tip-<id>): se resalta y se lleva a la vista.
  useEffect(() => {
    if (!listado || typeof window === "undefined") return;
    const m = window.location.hash.match(/^#tip-([0-9a-f-]{36})$/i);
    if (!m) return;
    setResaltada(m[1]);
    requestAnimationFrame(() => document.getElementById(`tip-${m[1]}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }, [listado]);

  useEffect(() => {
    if (!esError || !listado?.puede_soporte) return;
    let vivo = true;
    if (!cat) {
      apiSoporte<DatosSoporte>("/api/soporte/carga-rapida")
        .then((c) => vivo && setCat(c))
        .catch((e: Error) => vivo && setCatError(e.message));
    }
    if (proyectos == null) {
      apiSoporte<{ proyectos: { id: string; titulo: string }[] }>(`/api/soporte/carga-rapida?cliente_id=${id}`)
        .then((r) => {
          if (!vivo) return;
          setProyectos(r.proyectos);
          // Un solo proyecto: se elige solo, y con él se ven sus accesos.
          if (r.proyectos.length === 1) setTicket((p) => (p.proyecto_id ? p : { ...p, proyecto_id: r.proyectos[0].id }));
        })
        .catch((e: Error) => vivo && setCatError(e.message));
    }
    return () => { vivo = false; };
  }, [esError, listado?.puede_soporte, cat, proyectos, id]);

  const clasificaciones = useMemo(
    () => (cat?.clasificaciones ?? []).filter((c) => c.activo && c.tipo_codigo === tipoTicket),
    [cat, tipoTicket]
  );
  const clasificacionElegida = clasificaciones.find((c) => c.codigo === ticket.clasificacion_codigo);
  const slaHoras = clasificacionElegida ? Number(clasificacionElegida.sla_horas) : null;
  const entrega = slaHoras != null ? vencimientoSla(Date.now(), slaHoras) : null;
  const proyectoElegido = proyectos?.find((p) => p.id === ticket.proyecto_id);

  function elegirTipo(tipo: TipoGestion) {
    setError(null);
    setExito(null);
    setForm((prev) => ({
      ...prev,
      tipo_gestion: tipo,
      // Error y Cambio siempre escalan; al volver a otro tipo se restablece el valor habitual.
      resultado: TIPO_TICKET[tipo] ? "Escalar" : TIPO_TICKET[prev.tipo_gestion] ? "Pendiente" : prev.resultado,
    }));
    // La clasificación es de cada tipo de ticket: al cambiar de tipo se vuelve a elegir.
    if (TIPO_TICKET[tipo] !== TIPO_TICKET[form.tipo_gestion]) setTicket((p) => ({ ...p, clasificacion_codigo: "", prioridad_codigo: "normal" }));
  }

  function setCampoTicket<K extends keyof DatosTicket>(k: K, v: DatosTicket[K]) {
    setError(null);
    setTicket((p) => ({ ...p, [k]: v }));
  }

  function elegirClasificacion(codigo: string) {
    const c = clasificaciones.find((x) => x.codigo === codigo);
    setError(null);
    setTicket((p) => ({
      ...p,
      clasificacion_codigo: codigo,
      // La prioridad la pone el nivel (sugerida del catálogo); no se elige a mano.
      prioridad_codigo: c?.prioridad_sugerida || "normal",
    }));
  }

  function reiniciar() {
    setForm({ tipo_gestion: "Consulta", resultado: "Pendiente", observacion: "" });
    // Se conserva el proyecto si es el único del cliente.
    setTicket({ ...TICKET_VACIO, proyecto_id: proyectos?.length === 1 ? proyectos[0].id : "" });
    setArchivos([]);
  }

  async function handleGuardar(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setExito(null);

    if (!form.observacion.trim()) return setError("La observación es obligatoria.");

    if (esError) {
      if (!listado?.puede_soporte) return setError("Tu usuario no puede cargar tickets de Soporte.");
      const faltan: string[] = [];
      if (!ticket.proyecto_id) faltan.push("proyecto / servicio afectado");
      if (!ticket.asunto.trim()) faltan.push("asunto");
      if (!ticket.descripcion.trim()) faltan.push(esCambio ? "descripción del cambio" : "descripción del error");
      if (clasificaciones.length && !ticket.clasificacion_codigo) faltan.push("clasificación");
      if (faltan.length) return setError(`Completá: ${faltan.join(", ")}.`);
    }

    setGuardando(true);
    try {
      const res = await fetchWithSupabaseSession(`/api/clientes/${id}/tipificaciones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo_gestion: form.tipo_gestion,
          resultado: form.resultado,
          observacion: form.observacion.trim(),
          ...(esError ? { ticket } : {}),
        }),
      });
      const j = (await res.json().catch(() => null)) as
        | { success?: boolean; error?: string; data?: { tipificacion_id: string; ticket: { id: string; numero: number } | null } }
        | null;
      if (!res.ok || !j?.success || !j.data) {
        setError(j?.error ?? (esError ? "No se pudo crear el ticket. No se guardó la tipificación." : "Error al guardar la tipificación."));
        return;
      }

      if (j.data.ticket) {
        // El ticket ya existe. Si una evidencia falla se avisa: se puede volver a
        // subir desde la pestaña Archivos del ticket, no se pierde nada.
        let aviso: string | null = null;
        if (archivos.length) {
          const r = await subirArchivos(j.data.ticket.id, archivos);
          if (r.errores.length) aviso = `${r.errores.length} archivo(s) no se subieron: ${r.errores.join(" · ")}`;
        }
        setCreado({ ...j.data.ticket, aviso });
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        setExito("Tipificación registrada correctamente.");
        setTimeout(() => setExito(null), 3500);
      }
      reiniciar();
      await cargarListado();
    } finally {
      setGuardando(false);
    }
  }

  if (notFound) {
    return (
      <Pagina>
        <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <h1 className="text-xl font-bold text-slate-800">Cliente no encontrado</h1>
          <button onClick={() => router.push("/clientes")} className="mt-3 text-sm font-medium text-[#2F6E71] underline">
            ← Volver a Clientes
          </button>
        </div>
      </Pagina>
    );
  }

  if (!cliente) return null;

  const tipificaciones = listado?.tipificaciones ?? [];
  const puedeEnviar = !guardando && !!listado && (!esError || (listado.puede_soporte && !!cat && !!proyectos?.length));
  const tipoUi = TIPO_UI[form.tipo_gestion];

  return (
    <div className="min-h-full bg-[radial-gradient(1200px_500px_at_0%_-10%,rgba(79,174,178,0.12),transparent_60%),radial-gradient(900px_420px_at_100%_0%,rgba(14,165,233,0.08),transparent_55%)] bg-slate-50/70">
      <Pagina ancho="max-w-[1500px]">
        <Encabezado
          titulo="Tipificación"
          subtitulo="Registrá la gestión con el cliente. Un error o un cambio se escala a Soporte con su ticket."
          icono={ClipboardPen}
          tono="turquesa"
          migas={[
            { etiqueta: "Gestión de clientes", href: "/gestion-clientes" },
            { etiqueta: clienteNombre(cliente), href: `/clientes/${id}` },
            { etiqueta: "Tipificación" },
          ]}
        />

        {/* ── Cliente: una línea chica, el formulario es lo importante ─── */}
        <div className="-mt-2 mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-slate-500">
          <span className="font-semibold text-slate-800">{clienteNombre(cliente)}</span>
          {cliente.codigo_cliente ? <span className="font-mono text-[11.5px]">{cliente.codigo_cliente}</span> : null}
          {cliente.ruc ? <span>RUC {cliente.ruc}</span> : null}
          {cliente.telefono ? <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" aria-hidden />{cliente.telefono}</span> : null}
          {cliente.email ? <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" aria-hidden />{cliente.email}</span> : null}
          <span className={`rounded-full px-2 py-px text-[11px] font-bold ${cliente.estado === "activo" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
            {cliente.estado === "activo" ? "Activo" : "Inactivo"}
          </span>
        </div>

        {/* ── Ticket creado ───────────────────────────────────────────── */}
        <AnimatePresence>
          {creado ? (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="relative mb-6 overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-[#4FAEB2]/10 px-6 py-5 shadow-sm"
            >
              <button type="button" onClick={() => setCreado(null)} aria-label="Cerrar" className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg text-emerald-700 hover:bg-emerald-100">
                <X className="h-4 w-4" />
              </button>
              <div className="flex flex-wrap items-center justify-between gap-4 pr-8">
                <div className="flex items-center gap-4">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-500 text-white shadow-[0_8px_20px_-8px_rgba(16,185,129,0.8)]">
                    <CircleCheckBig className="h-6 w-6" aria-hidden />
                  </span>
                  <div className="space-y-0.5 text-[14px] font-semibold text-emerald-800">
                    <p>✓ Tipificación registrada</p>
                    <p>✓ Ticket #{creado.numero} creado correctamente</p>
                    {creado.aviso ? <p className="text-xs font-medium text-amber-700">{creado.aviso}</p> : null}
                  </div>
                </div>
                <Link href={`/dashboard/soporte/tickets/${creado.id}`} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white no-underline shadow-[0_8px_20px_-10px_rgba(5,150,105,0.9)] hover:bg-emerald-700">
                  Ver ticket #{creado.numero} <ExternalLink className="h-4 w-4" />
                </Link>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <form onSubmit={handleGuardar} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          {/* ── Columna principal ───────────────────────────────────────── */}
          <div className="min-w-0 space-y-6">
            <Seccion titulo="Nueva tipificación" detalle="¿Qué gestión se hizo con el cliente?" icono={ClipboardPen} tono="turquesa">
              <Campo etiqueta="Tipo de gestión" requerido>
                <div className="max-w-md">
                  <FancySelect
                    ariaLabel="Tipo de gestión"
                    value={form.tipo_gestion}
                    onChange={(v) => elegirTipo(v as TipoGestion)}
                    options={TIPOS_GESTION.map((t) => ({
                      value: t,
                      label: t,
                      description: TIPO_TICKET[t] ? "Crea un ticket de Soporte" : undefined,
                    }))}
                  />
                </div>
              </Campo>

              <Campo etiqueta="Resultado" requerido ayuda={esError ? `${esCambio ? "Un cambio" : "Un error"} se escala a Soporte con un ticket.` : undefined}>
                <div role="radiogroup" aria-label="Resultado" className="flex flex-wrap gap-2">
                  {RESULTADOS_TIPIFICACION.map((r) => (
                    <Pildora
                      key={r}
                      activa={form.resultado === r}
                      tono={RESULTADO_TONO[r]}
                      disabled={esError && r !== "Escalar"}
                      onClick={() => setForm((p) => ({ ...p, resultado: r }))}
                    >
                      {r}
                    </Pildora>
                  ))}
                </div>
              </Campo>

              <Campo etiqueta="Observación" requerido>
                <textarea
                  value={form.observacion}
                  onChange={(e) => { setError(null); setExito(null); setForm((p) => ({ ...p, observacion: e.target.value })); }}
                  rows={3}
                  placeholder={esCambio ? "Ej.: Cliente pide cambiar el logo de la factura" : esError ? "Ej.: Cliente informa que no puede facturar" : "Describí la gestión realizada con el cliente…"}
                  className={claseArea}
                />
              </Campo>
            </Seccion>

            {/* ── Ticket de soporte (Error o Cambio) ───────────────────── */}
            <AnimatePresence initial={false}>
              {esError ? (
                <motion.div
                  key="ticket"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 12 }}
                  transition={{ duration: 0.22 }}
                  className="space-y-6"
                >
                  {!listado?.puede_soporte ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
                      Tu usuario no puede cargar tickets de Soporte (lo pueden los PM y quienes usan Soporte). Pedíselo a un administrador.
                    </div>
                  ) : catError ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{catError}</div>
                  ) : !cat || proyectos == null ? (
                    <div className={`rounded-2xl border border-slate-200/80 bg-white p-6 ${sombra}`}>
                      <div className="h-4 w-48 animate-pulse rounded bg-slate-100" />
                      <div className="mt-4 h-10 w-full animate-pulse rounded-xl bg-slate-100" />
                      <div className="mt-3 h-24 w-full animate-pulse rounded-xl bg-slate-100" />
                    </div>
                  ) : (
                    <>
                      <Seccion titulo="Proyecto afectado" detalle="Sólo los proyectos de este cliente" icono={FolderKanban} tono="celeste">
                        <Campo etiqueta="Proyecto / servicio afectado" requerido>
                          {proyectos.length === 0 ? (
                            <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                              <FolderKanban className="h-4 w-4" aria-hidden /> No hay proyectos asociados a este cliente.
                            </div>
                          ) : (
                            <SelectorBuscable
                              ariaLabel="Proyecto / servicio afectado"
                              opciones={proyectos.map((p) => ({ value: p.id, label: p.titulo }))}
                              value={ticket.proyecto_id}
                              onChange={(v) => setCampoTicket("proyecto_id", v)}
                              placeholder="Seleccionar proyecto…"
                              buscarPlaceholder="Buscar proyecto…"
                              vacio="Ningún proyecto coincide"
                            />
                          )}
                        </Campo>
                        <AccesosProyecto proyectoId={ticket.proyecto_id || null} />
                      </Seccion>

                      <Seccion titulo={esCambio ? "Detalle del cambio" : "Detalle del error"} detalle={esCambio ? "Qué hay que cambiar y en qué módulo" : "Qué pasa y en qué módulo"} icono={FileText} tono="violeta">
                        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                          <Campo etiqueta="Módulo afectado">
                            <input className={claseInput} value={ticket.modulo} maxLength={120} onChange={(e) => setCampoTicket("modulo", e.target.value)} placeholder="Ej.: Facturación electrónica" />
                          </Campo>
                          <Campo etiqueta="Asunto" requerido>
                            <input className={claseInput} value={ticket.asunto} maxLength={200} onChange={(e) => setCampoTicket("asunto", e.target.value)} placeholder={esCambio ? "Ej.: Cambiar el logo de la factura" : "Ej.: No permite emitir factura"} />
                          </Campo>
                        </div>
                        <Campo etiqueta={esCambio ? "Descripción del cambio" : "Descripción del error"} requerido>
                          <textarea rows={4} className={claseArea} value={ticket.descripcion} onChange={(e) => setCampoTicket("descripcion", e.target.value)} placeholder={esCambio ? "Qué hay que cambiar, cómo debería quedar…" : "Qué pasa, desde cuándo, qué mensaje aparece…"} />
                        </Campo>
                      </Seccion>

                      <Seccion titulo="Clasificación" detalle="La clasificación define el service level y la fecha de entrega" icono={Flag} tono="ambar">
                        <Campo etiqueta="Clasificación" requerido ayuda={entrega ? `Entrega: ${fechaHoraPy(entrega)}` : undefined}>
                          <div role="radiogroup" aria-label="Clasificación" className="grid gap-3 sm:grid-cols-3">
                            {clasificaciones.map((c) => {
                              const t = TONOS[tonoSla(c.sla_horas)];
                              const activa = ticket.clasificacion_codigo === c.codigo;
                              return (
                                <button
                                  key={c.codigo}
                                  type="button"
                                  role="radio"
                                  aria-checked={activa}
                                  onClick={() => elegirClasificacion(c.codigo)}
                                  className={`relative overflow-hidden rounded-2xl border px-4 py-3.5 text-left transition ${
                                    activa ? `${t.borde} ${t.suave} shadow-sm` : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                                  }`}
                                >
                                  <span className={`absolute inset-y-0 left-0 w-1 ${activa ? t.solido : "bg-transparent"}`} aria-hidden />
                                  <p className={`text-[14px] font-bold ${activa ? t.texto : "text-slate-800"}`}>{c.nombre}</p>
                                  <p className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-slate-500">
                                    <Timer className="h-3.5 w-3.5" aria-hidden /> SLA {c.sla_horas} h
                                  </p>
                                </button>
                              );
                            })}
                          </div>
                        </Campo>


                        <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[13px] text-slate-600">
                          <UserRound className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                          {cat?.responsable ? (
                            <span>Se asigna a <strong className="text-slate-800">{cat.responsable.nombre}</strong> (Desarrollo de Soporte). Entra como Pendiente.</span>
                          ) : (
                            <span>Entra como Pendiente, sin responsable.</span>
                          )}
                        </div>
                      </Seccion>

                      <Seccion titulo="Evidencias" detalle="Capturas, videos o documentos. Quedan en el ticket." icono={Paperclip} tono="indigo">
                        <ZonaArchivos archivos={archivos} onCambio={setArchivos} deshabilitada={guardando} />
                      </Seccion>
                    </>
                  )}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          {/* ── Resumen fijo ────────────────────────────────────────────── */}
          <aside className="xl:sticky xl:top-6 xl:self-start">
            <div className={`overflow-hidden rounded-2xl border border-slate-200/80 bg-white ${sombra}`}>
              <div className="px-5 pb-4 pt-5" style={{ backgroundImage: `linear-gradient(135deg, ${TONOS[tipoUi.tono].hex}1f, transparent 70%)` }}>
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Resumen</p>
                <div className="mt-3 flex items-center gap-3">
                  <IconoTile icono={tipoUi.icono} tono={tipoUi.tono} />
                  <div>
                    <p className="text-[16px] font-bold text-slate-900">{form.tipo_gestion}</p>
                    <p className="text-[12.5px] text-slate-500">{esError ? "Se crea un ticket de Soporte" : "Tipificación del cliente"}</p>
                  </div>
                </div>
              </div>

              <div className="divide-y divide-slate-100 px-5">
                <FilaResumen etiqueta="Cliente">{clienteNombre(cliente)}</FilaResumen>
                <FilaResumen etiqueta="Resultado">
                  <span className={`rounded-full px-2 py-0.5 text-[12px] ${TONOS[RESULTADO_TONO[form.resultado]].suave} ${TONOS[RESULTADO_TONO[form.resultado]].texto}`}>{form.resultado}</span>
                </FilaResumen>
                {esError ? (
                  <>
                    <FilaResumen etiqueta="Proyecto">{proyectoElegido?.titulo ?? <span className="font-normal text-slate-400">Sin elegir</span>}</FilaResumen>
                    <FilaResumen etiqueta="Clasificación">{clasificacionElegida?.nombre ?? <span className="font-normal text-slate-400">Sin elegir</span>}</FilaResumen>
                    <FilaResumen etiqueta="Entrega">
                      {entrega ? (
                        <span className="inline-flex items-center gap-1.5"><CalendarCheck className="h-3.5 w-3.5 text-rose-500" aria-hidden />{fechaHoraPy(entrega)}</span>
                      ) : <span className="font-normal text-slate-400">Sin elegir</span>}
                    </FilaResumen>
                    <FilaResumen etiqueta="Responsable">{cat?.responsable?.nombre ?? <span className="font-normal text-slate-400">Sin asignar</span>}</FilaResumen>
                    <FilaResumen etiqueta="Evidencias">{archivos.length || <span className="font-normal text-slate-400">Ninguna</span>}</FilaResumen>
                  </>
                ) : null}
              </div>

              {esError ? (
                <div className={`mx-5 mb-1 mt-3 rounded-2xl px-4 py-3.5 ${slaHoras == null ? "bg-slate-50" : `${TONOS[tonoSla(slaHoras)].suave}`}`}>
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <Timer className="h-3.5 w-3.5" aria-hidden /> Service level
                  </p>
                  {slaHoras == null ? (
                    <p className="mt-1 text-[13px] text-slate-400">Elegí la clasificación para ver el SLA.</p>
                  ) : (
                    <p className={`mt-0.5 text-3xl font-extrabold tabular-nums ${TONOS[tonoSla(slaHoras)].texto}`}>
                      <CountUp key={slaHoras} to={slaHoras} duration={0.5} /> <span className="text-base font-bold">{slaHoras === 1 ? "hora" : "horas"}</span>
                    </p>
                  )}
                </div>
              ) : null}

              <div className="space-y-3 p-5">
                <div className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5">
                  {listado ? <Avatar nombre={listado.usuario_actual.nombre} tam={30} /> : <UserRound className="h-5 w-5 text-slate-400" />}
                  <div className="min-w-0 text-[12.5px]">
                    <p className="text-slate-500">Se registrará como</p>
                    <p className="truncate font-semibold text-slate-800">{listado?.usuario_actual.nombre ?? "…"}</p>
                  </div>
                </div>

                <AnimatePresence>
                  {error ? (
                    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] font-medium text-rose-700">
                      {error}
                    </motion.p>
                  ) : null}
                  {exito ? (
                    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] font-semibold text-emerald-700">
                      <CircleCheckBig className="h-4 w-4" aria-hidden /> {exito}
                    </motion.p>
                  ) : null}
                </AnimatePresence>

                <Boton type="submit" cargando={guardando} disabled={!puedeEnviar} className="w-full py-3 text-[15px]">
                  {esError ? <Headset className="h-4 w-4" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                  {guardando ? (esError ? "Creando ticket…" : "Guardando…") : esError ? "Crear ticket de soporte" : "Guardar tipificación"}
                </Boton>
              </div>
            </div>
          </aside>
        </form>

        {/* ── Historial de tipificaciones ─────────────────────────────── */}
        <section className={`mt-8 overflow-hidden rounded-2xl border border-slate-200/80 bg-white ${sombra}`}>
          <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div className="flex items-center gap-3">
              <IconoTile icono={History} tono="indigo" tam="sm" />
              <h2 className="text-[15px] font-bold text-slate-800">Historial de tipificaciones</h2>
            </div>
            <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-bold tabular-nums text-indigo-700">
              <CountUp to={tipificaciones.length} duration={0.5} />
            </span>
          </header>

          {tipificaciones.length === 0 ? (
            <div className="py-14 text-center text-sm text-slate-400">
              {listado ? "No hay tipificaciones registradas para este cliente." : "Cargando…"}
            </div>
          ) : (
            <ol className="divide-y divide-slate-100">
              {tipificaciones.map((t) => {
                const ui = TIPO_UI[t.tipo_gestion] ?? TIPO_UI.Consulta;
                const tt = TONOS[ui.tono];
                const rt = TONOS[RESULTADO_TONO[t.resultado] ?? "pizarra"];
                const Icono = ui.icono;
                return (
                  <li
                    key={t.id}
                    id={`tip-${t.id}`}
                    className={`grid gap-3 px-5 py-4 transition-colors md:grid-cols-[170px_minmax(0,1fr)] ${resaltada === t.id ? "bg-[#4FAEB2]/10" : "hover:bg-slate-50/60"}`}
                  >
                    <div className="flex items-start gap-3 md:block">
                      <p className="text-[12px] tabular-nums text-slate-400">{formatFechaHora(t.fecha)}</p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700">
                        <Avatar nombre={t.usuario} tam={20} /> <span className="truncate">{t.usuario}</span>
                      </p>
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-bold ${tt.suave} ${tt.texto}`}>
                          <Icono className="h-3.5 w-3.5" aria-hidden /> {t.tipo_gestion}
                        </span>
                        <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-bold ${rt.suave} ${rt.texto}`}>{t.resultado}</span>
                      </div>
                      <p className="mt-1.5 whitespace-pre-line text-[13.5px] leading-relaxed text-slate-700">{t.observacion}</p>

                      {t.ticket ? (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#4FAEB2]/25 bg-gradient-to-r from-[#4FAEB2]/[0.07] to-transparent px-4 py-3">
                          <div className="min-w-0">
                            <p className="text-[13px] font-bold text-slate-800">
                              Ticket #{t.ticket.numero} <span className="font-medium text-slate-500">· {t.ticket.asunto}</span>
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-slate-600">
                              <span className="inline-flex items-center gap-1"><FolderKanban className="h-3.5 w-3.5 text-slate-400" aria-hidden />{t.ticket.proyecto_titulo ?? "—"}</span>
                              <span className="inline-flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full" style={{ background: t.ticket.estado_color ?? "#94a3b8" }} aria-hidden />
                                {t.ticket.estado_nombre}
                              </span>
                            </div>
                          </div>
                          {listado?.puede_soporte ? (
                            <Link
                              href={`/dashboard/soporte/tickets/${t.ticket.id}`}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#2F6E71] no-underline shadow-sm ring-1 ring-[#4FAEB2]/30 hover:bg-[#4FAEB2]/10"
                            >
                              Ver ticket <ExternalLink className="h-3.5 w-3.5" />
                            </Link>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </Pagina>
    </div>
  );
}
