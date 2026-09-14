"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, FolderKanban, LifeBuoy, Timer, X } from "lucide-react";
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
import { slaDe } from "@/lib/soporte/dominio";
import { apiSoporte, obtenerCatalogos, subirArchivos, type CatalogosConEquipo } from "@/app/dashboard/soporte/_ui/api";
import AccesosProyecto from "@/app/dashboard/soporte/_ui/AccesosProyecto";
import { SelectorBuscable } from "@/app/dashboard/soporte/_ui/SelectorBuscable";
import ZonaArchivos from "@/app/dashboard/soporte/_ui/ZonaArchivos";
import { TONO_AREA } from "@/app/dashboard/soporte/_ui/ui";

// ── Constantes ────────────────────────────────────────────────────────────────

/** El tipo que escala a Soporte. Su resultado es siempre "Escalar" (lo fija el servidor). */
const TIPO_ERROR: TipoGestion = "Error";

const claseCampo =
  "w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-500 transition-colors bg-white";
const claseArea =
  "w-full border border-gray-300 rounded-lg px-4 py-3 text-sm outline-none focus:border-gray-500 transition-colors resize-y";
const claseLabel = "block text-sm font-medium text-gray-700 mb-1.5";

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
  resultado_esperado: string;
  pasos_reproducir: string;
  impacto_operativo: string;
  clasificacion_codigo: string;
  prioridad_codigo: string;
  responsable_id: string;
};

const TICKET_VACIO: DatosTicket = {
  proyecto_id: "",
  modulo: "",
  asunto: "",
  descripcion: "",
  resultado_esperado: "",
  pasos_reproducir: "",
  impacto_operativo: "",
  clasificacion_codigo: "",
  prioridad_codigo: "",
  responsable_id: "",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatFechaHora(iso: string) {
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch { return ""; }
}

function duracionHoras(h: number | null): string {
  if (h == null) return "—";
  return h === 1 ? "1 hora" : `${h} horas`;
}

// ── Badges ────────────────────────────────────────────────────────────────────

function BadgeResultado({ resultado }: { resultado: ResultadoTipificacion }) {
  const cfg: Record<ResultadoTipificacion, string> = {
    Pendiente: "bg-amber-100 text-amber-700",
    Resuelto:  "bg-green-100 text-green-700",
    Escalar:   "bg-red-100 text-red-700",
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg[resultado] ?? "bg-gray-100 text-gray-600"}`}>
      {resultado}
    </span>
  );
}

function BadgeTipo({ tipo }: { tipo: TipoGestion }) {
  const error = tipo === TIPO_ERROR;
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${error ? "bg-rose-50 text-rose-700 border-rose-100" : "bg-blue-50 text-blue-700 border-blue-100"}`}>
      {tipo}
    </span>
  );
}

// ── Componente ────────────────────────────────────────────────────────────────

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
  const [prioridadTocada, setPrioridadTocada] = useState(false);

  // Datos de Soporte: sólo se piden cuando hace falta (tipo Error).
  const [cat, setCat] = useState<CatalogosConEquipo | null>(null);
  const [catError, setCatError] = useState<string | null>(null);
  const [proyectos, setProyectos] = useState<{ id: string; titulo: string }[] | null>(null);

  const [error, setError] = useState<string | null>(null);

  const esError = form.tipo_gestion === TIPO_ERROR;

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
      obtenerCatalogos()
        .then((c) => vivo && setCat(c))
        .catch((e: Error) => vivo && setCatError(e.message));
    }
    if (proyectos == null) {
      apiSoporte<{ proyectos: { id: string; titulo: string }[] }>(`/api/soporte/opciones?cliente_id=${id}`)
        .then((r) => vivo && setProyectos(r.proyectos))
        .catch((e: Error) => vivo && setCatError(e.message));
    }
    return () => { vivo = false; };
  }, [esError, listado?.puede_soporte, cat, proyectos, id]);

  const clasificaciones = useMemo(
    () => (cat?.clasificaciones ?? []).filter((c) => c.activo && c.tipo_codigo === "error"),
    [cat]
  );
  const slaHoras = cat && ticket.clasificacion_codigo ? slaDe(cat, "error", ticket.clasificacion_codigo) : null;
  const clasificacionElegida = clasificaciones.find((c) => c.codigo === ticket.clasificacion_codigo);

  function handleChange(
    e: React.ChangeEvent<HTMLSelectElement | HTMLTextAreaElement>
  ) {
    setError(null);
    setExito(null);
    const { name, value } = e.target;
    setForm((prev) => {
      const next = { ...prev, [name]: value };
      if (name === "tipo_gestion") {
        // Error siempre escala; al volver a otro tipo se restablece el valor habitual.
        if (value === TIPO_ERROR) next.resultado = "Escalar";
        else if (prev.tipo_gestion === TIPO_ERROR) next.resultado = "Pendiente";
      }
      return next as typeof prev;
    });
  }

  function setCampoTicket<K extends keyof DatosTicket>(k: K, v: DatosTicket[K]) {
    setError(null);
    setTicket((p) => ({ ...p, [k]: v }));
  }

  function reiniciar() {
    setForm({ tipo_gestion: "Consulta", resultado: "Pendiente", observacion: "" });
    setTicket(TICKET_VACIO);
    setArchivos([]);
    setPrioridadTocada(false);
  }

  async function handleGuardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setExito(null);

    if (!form.observacion.trim()) return setError("La observación es obligatoria.");

    if (esError) {
      if (!listado?.puede_soporte) return setError("Tu usuario no tiene habilitado el módulo Soporte para crear tickets.");
      const faltan: string[] = [];
      if (!ticket.proyecto_id) faltan.push("proyecto / servicio afectado");
      if (!ticket.asunto.trim()) faltan.push("asunto");
      if (!ticket.descripcion.trim()) faltan.push("descripción del error");
      if (clasificaciones.length && !ticket.clasificacion_codigo) faltan.push("clasificación");
      if (!ticket.prioridad_codigo) faltan.push("prioridad");
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
      } else {
        setExito("✓ Tipificación registrada correctamente.");
        setTimeout(() => setExito(null), 3000);
      }
      reiniciar();
      await cargarListado();
    } finally {
      setGuardando(false);
    }
  }

  if (notFound) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-800">Cliente no encontrado</h1>
        <button onClick={() => router.push("/clientes")} className="text-sm text-gray-500 underline">
          ← Volver a Clientes
        </button>
      </div>
    );
  }

  if (!cliente) return null;

  const tipificaciones = listado?.tipificaciones ?? [];
  const personaOpciones = [
    { value: "", label: "Sin asignar" },
    ...(cat?.personas ?? []).map((p) => ({ value: p.id, label: p.nombre, detalle: p.area, tono: TONO_AREA[p.area] })),
  ];

  return (
    <div className="space-y-6 max-w-4xl">

      {/* ── Breadcrumb ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <button onClick={() => router.push("/gestion-clientes")} className="hover:text-gray-600 transition-colors">
          Gestión de clientes
        </button>
        <span>›</span>
        <button onClick={() => router.push(`/clientes/${id}`)} className="hover:text-gray-600 transition-colors">
          {clienteNombre(cliente)}
        </button>
        <span>›</span>
        <span className="text-gray-600 font-medium">Tipificación</span>
      </div>

      {/* ── Header del cliente ────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{clienteNombre(cliente)}</h1>
            <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-gray-500">
              <span className="font-mono">{cliente.codigo_cliente}</span>
              {cliente.ruc && <span>RUC: {cliente.ruc}</span>}
              {cliente.telefono && <span>Tel: {cliente.telefono}</span>}
              {cliente.email && <span>{cliente.email}</span>}
            </div>
          </div>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
            cliente.estado === "activo" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
          }`}>
            {cliente.estado === "activo" ? "● Activo" : "● Inactivo"}
          </span>
        </div>
      </div>

      {/* ── Ticket creado ─────────────────────────────────────────────── */}
      {creado ? (
        <div className="relative rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <button type="button" onClick={() => setCreado(null)} aria-label="Cerrar" className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-md text-emerald-700 hover:bg-emerald-100">
            <X className="h-4 w-4" />
          </button>
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-800"><CheckCircle2 className="h-4 w-4" /> Tipificación registrada</p>
          <p className="mt-1 flex items-center gap-2 text-sm font-medium text-emerald-800"><CheckCircle2 className="h-4 w-4" /> Ticket #{creado.numero} creado correctamente</p>
          {creado.aviso ? <p className="mt-2 text-xs text-amber-700">{creado.aviso}</p> : null}
          <Link
            href={`/dashboard/soporte/tickets/${creado.id}`}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white no-underline hover:bg-emerald-700"
          >
            Ver ticket #{creado.numero} <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : null}

      {/* ── Formulario de nueva tipificación ─────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="bg-gray-50 border-b border-gray-200 px-6 py-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
            Nueva tipificación
          </p>
        </div>

        <form onSubmit={handleGuardar} className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">

            {/* Tipo de gestión */}
            <div>
              <label className={claseLabel}>
                Tipo de gestión <span className="text-red-500">*</span>
              </label>
              <select name="tipo_gestion" value={form.tipo_gestion} onChange={handleChange} className={claseCampo}>
                {TIPOS_GESTION.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            {/* Resultado */}
            <div>
              <label className={claseLabel}>
                Resultado <span className="text-red-500">*</span>
              </label>
              <select
                name="resultado"
                value={form.resultado}
                onChange={handleChange}
                disabled={esError}
                className={`${claseCampo} disabled:bg-gray-50 disabled:text-gray-600`}
              >
                {RESULTADOS_TIPIFICACION.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              {esError ? <p className="mt-1 text-xs text-gray-400">Un error se escala a Soporte con un ticket.</p> : null}
            </div>
          </div>

          {/* Observación */}
          <div className="mb-4">
            <label className={claseLabel}>
              Observación <span className="text-red-500">*</span>
            </label>
            <textarea
              name="observacion"
              value={form.observacion}
              onChange={handleChange}
              rows={3}
              placeholder={esError ? "Ej.: Cliente informa que no puede facturar" : "Describí la gestión realizada con el cliente..."}
              className={`${claseArea} resize-none`}
            />
          </div>

          {/* ── Ticket de soporte (sólo Error) ───────────────────────── */}
          {esError ? (
            <section className="mb-5 rounded-xl border border-[#4FAEB2]/30 bg-gradient-to-b from-[#4FAEB2]/[0.06] to-white">
              <div className="flex items-center gap-2 border-b border-[#4FAEB2]/20 px-5 py-3">
                <LifeBuoy className="h-4 w-4 text-[#3F8E91]" aria-hidden />
                <p className="text-xs font-semibold uppercase tracking-widest text-[#2F6E71]">Ticket de soporte</p>
              </div>

              <div className="space-y-4 p-5">
                {!listado?.puede_soporte ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Tu usuario no tiene habilitado el módulo Soporte, así que no puede crear el ticket. Pedíselo a un administrador.
                  </div>
                ) : catError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{catError}</div>
                ) : !cat || proyectos == null ? (
                  <p className="text-sm text-gray-400">Cargando datos de Soporte…</p>
                ) : (
                  <>
                    {/* Proyecto */}
                    <div>
                      <label className={claseLabel}>
                        Proyecto / servicio afectado <span className="text-red-500">*</span>
                      </label>
                      {proyectos.length === 0 ? (
                        <div className="flex items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-500">
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
                    </div>

                    <AccesosProyecto proyectoId={ticket.proyecto_id || null} />

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className={claseLabel}>Módulo afectado</label>
                        <input className={claseCampo} value={ticket.modulo} maxLength={120} onChange={(e) => setCampoTicket("modulo", e.target.value)} placeholder="Ej.: Facturación electrónica" />
                      </div>
                      <div>
                        <label className={claseLabel}>
                          Asunto <span className="text-red-500">*</span>
                        </label>
                        <input className={claseCampo} value={ticket.asunto} maxLength={200} onChange={(e) => setCampoTicket("asunto", e.target.value)} placeholder="Ej.: No permite emitir factura" />
                      </div>
                    </div>

                    <div>
                      <label className={claseLabel}>
                        Descripción del error <span className="text-red-500">*</span>
                      </label>
                      <textarea rows={4} className={claseArea} value={ticket.descripcion} onChange={(e) => setCampoTicket("descripcion", e.target.value)} placeholder="Qué pasa, desde cuándo, mensaje de error…" />
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className={claseLabel}>Resultado esperado</label>
                        <textarea rows={3} className={claseArea} value={ticket.resultado_esperado} onChange={(e) => setCampoTicket("resultado_esperado", e.target.value)} />
                      </div>
                      <div>
                        <label className={claseLabel}>Pasos para reproducir</label>
                        <textarea rows={3} className={claseArea} value={ticket.pasos_reproducir} onChange={(e) => setCampoTicket("pasos_reproducir", e.target.value)} placeholder={"1. …\n2. …"} />
                      </div>
                    </div>

                    <div>
                      <label className={claseLabel}>Impacto operativo</label>
                      <input className={claseCampo} value={ticket.impacto_operativo} onChange={(e) => setCampoTicket("impacto_operativo", e.target.value)} placeholder="Ej.: El cliente no puede facturar" />
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div>
                        <label className={claseLabel}>
                          Nivel / clasificación <span className="text-red-500">*</span>
                        </label>
                        <select
                          className={claseCampo}
                          value={ticket.clasificacion_codigo}
                          onChange={(e) => {
                            const c = clasificaciones.find((x) => x.codigo === e.target.value);
                            setTicket((p) => ({
                              ...p,
                              clasificacion_codigo: e.target.value,
                              // Sugerencia del catálogo, sólo si nadie tocó la prioridad.
                              prioridad_codigo: !prioridadTocada && c?.prioridad_sugerida ? c.prioridad_sugerida : p.prioridad_codigo,
                            }));
                          }}
                        >
                          <option value="">Seleccionar…</option>
                          {clasificaciones.map((c) => (
                            <option key={c.codigo} value={c.codigo}>{c.nombre}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={claseLabel}>
                          Prioridad <span className="text-red-500">*</span>
                        </label>
                        <select
                          className={claseCampo}
                          value={ticket.prioridad_codigo}
                          onChange={(e) => { setPrioridadTocada(true); setCampoTicket("prioridad_codigo", e.target.value); }}
                        >
                          <option value="">Seleccionar…</option>
                          {cat.prioridades.filter((p) => p.activo).map((p) => (
                            <option key={p.codigo} value={p.codigo}>{p.nombre}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <span className={claseLabel}>Service level</span>
                        <div className="flex h-[42px] items-center gap-2 rounded-lg border border-[#4FAEB2]/30 bg-white px-4 text-sm">
                          <Timer className="h-4 w-4 text-[#3F8E91]" aria-hidden />
                          <span className="font-semibold text-gray-800">{duracionHoras(slaHoras)}</span>
                          {clasificacionElegida ? <span className="truncate text-xs text-gray-400">· {clasificacionElegida.nombre}</span> : null}
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className={claseLabel}>Responsable</label>
                      <SelectorBuscable
                        ariaLabel="Responsable"
                        avatares
                        opciones={personaOpciones}
                        value={ticket.responsable_id}
                        onChange={(v) => setCampoTicket("responsable_id", v)}
                        buscarPlaceholder="Buscar persona o área…"
                        vacio="Nadie coincide"
                      />
                      <p className="mt-1 text-xs text-gray-400">Opcional. Sin responsable entra como Registrado; con responsable, Clasificado / Asignado.</p>
                    </div>

                    <div>
                      <span className={claseLabel}>Evidencias</span>
                      <ZonaArchivos archivos={archivos} onCambio={setArchivos} compacta deshabilitada={guardando} />
                    </div>
                  </>
                )}
              </div>
            </section>
          ) : null}

          {/* Aviso usuario */}
          <p className="text-xs text-gray-400 mb-4">
            👤 Se registrará como: <span className="font-semibold text-gray-600">{listado?.usuario_actual.nombre ?? "…"}</span>
          </p>

          {/* Error / Éxito */}
          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 mb-4">
              <span>⚠</span><span className="font-medium">{error}</span>
            </div>
          )}

          {exito && (
            <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 text-sm text-green-700 font-medium mb-4">
              {exito}
            </div>
          )}

          <button
            type="submit"
            disabled={guardando || !listado || (esError && (!listado.puede_soporte || !cat || !proyectos?.length))}
            className={`${esError ? "bg-[#3F8E91] hover:bg-[#2F6E71]" : "bg-gray-900 hover:bg-gray-700"} text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {guardando ? (esError ? "Creando ticket…" : "Guardando…") : esError ? "Crear ticket de soporte" : "Guardar tipificación"}
          </button>
        </form>
      </div>

      {/* ── Historial de tipificaciones ───────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="bg-gray-50 border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
            Historial de tipificaciones
          </p>
          <span className="text-xs font-bold text-gray-600 bg-white border border-gray-200 px-2 py-0.5 rounded-full">
            {tipificaciones.length}
          </span>
        </div>

        {tipificaciones.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">
            {listado ? "No hay tipificaciones registradas para este cliente." : "Cargando…"}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/40">
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Fecha</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Usuario</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Tipo</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Resultado</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Observación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tipificaciones.map((t) => (
                  <tr
                    key={t.id}
                    id={`tip-${t.id}`}
                    className={`align-top transition-colors ${resaltada === t.id ? "bg-[#4FAEB2]/10" : "hover:bg-gray-50/40"}`}
                  >
                    <td className="px-5 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {formatFechaHora(t.fecha)}
                    </td>
                    <td className="px-5 py-3 text-xs font-medium text-gray-700 whitespace-nowrap">
                      {t.usuario}
                    </td>
                    <td className="px-5 py-3">
                      <BadgeTipo tipo={t.tipo_gestion} />
                    </td>
                    <td className="px-5 py-3">
                      <BadgeResultado resultado={t.resultado} />
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-600 max-w-sm">
                      <p className="line-clamp-2" title={t.observacion}>{t.observacion}</p>
                      {t.ticket ? (
                        <div className="mt-2 rounded-lg border border-[#4FAEB2]/25 bg-[#4FAEB2]/[0.05] px-3 py-2 text-xs">
                          <p className="font-semibold text-gray-800">
                            Ticket #{t.ticket.numero} <span className="font-normal text-gray-500">· {t.ticket.asunto}</span>
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-gray-600">
                            <span><span className="text-gray-400">Proyecto:</span> {t.ticket.proyecto_titulo ?? "—"}</span>
                            <span className="inline-flex items-center gap-1">
                              <span className="text-gray-400">Estado:</span>
                              <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.ticket.estado_color ?? "#94a3b8" }} aria-hidden />
                              {t.ticket.estado_nombre}
                            </span>
                            <span><span className="text-gray-400">Prioridad:</span> {t.ticket.prioridad_nombre}</span>
                          </div>
                          {listado?.puede_soporte ? (
                            <Link
                              href={`/dashboard/soporte/tickets/${t.ticket.id}`}
                              className="mt-2 inline-flex items-center gap-1 font-semibold text-[#2F6E71] no-underline hover:underline"
                            >
                              Ver ticket <ExternalLink className="h-3 w-3" />
                            </Link>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
