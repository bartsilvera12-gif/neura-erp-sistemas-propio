"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarCheck, CheckCircle2, Headset, Loader2, X } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { fechaHoraPy, vencimientoSla, type SoporteClasificacion, type SoporteTipo } from "@/lib/soporte/dominio";
import { SelectorBuscable } from "@/app/dashboard/soporte/_ui/SelectorBuscable";
import ZonaArchivos from "@/app/dashboard/soporte/_ui/ZonaArchivos";
import { subirArchivos } from "@/app/dashboard/soporte/_ui/api";
import { numeroTicket } from "@/lib/soporte/dominio";

type Datos = {
  tipos: SoporteTipo[];
  clasificaciones: SoporteClasificacion[];
  asignacion: Record<"error" | "cambio", { responsable: { id: string; nombre: string; area: string } | null; motivo: "ordinario" | "guardia" | "guardia_sin_asignar" }>;
  clientes: { id: string; nombre: string }[];
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithSupabaseSession(url, { cache: "no-store", ...init });
  const j = (await res.json().catch(() => null)) as { success?: boolean; data?: T; error?: string } | null;
  if (!res.ok || !j?.success) throw new Error(j?.error || `Error ${res.status}`);
  return j.data as T;
}

/** ¿Quien mira puede cargar tickets desde Conversaciones? (PM o usuario de Soporte). */
export async function puedeCargarSoporte(): Promise<boolean> {
  try {
    await api<{ puede: boolean }>("/api/soporte/carga-rapida?verificar=1");
    return true;
  } catch {
    return false;
  }
}

const claseCampo =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 transition-colors placeholder:text-slate-400 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20";
const claseEtiqueta = "mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500";

/**
 * Carga de un ticket de Soporte sin salir del chat.
 *
 * Toma el cliente vinculado al contacto si lo hay. El ticket queda en Soporte
 * como cualquier otro (Pendiente, SLA y entrega por su nivel) y en el historial
 * del cliente, indicando que salió de Conversaciones.
 */
export default function SoporteTicketModal({
  conversationId,
  clienteId,
  contacto,
  telefono,
  alCerrar,
}: {
  conversationId: string;
  clienteId: string | null;
  contacto: string;
  /** Teléfono del contacto: con él (o el nombre) se busca su cliente si no está vinculado. */
  telefono: string | null;
  alCerrar: () => void;
}) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cliente, setCliente] = useState(clienteId ?? "");
  const [asociadoPor, setAsociadoPor] = useState<"vinculado" | "telefono" | "contacto" | "nombre" | null>(clienteId ? "vinculado" : null);
  const [contactoSecundario, setContactoSecundario] = useState<string | null>(null);
  const [proyectos, setProyectos] = useState<{ id: string; titulo: string }[]>([]);
  const [proyecto, setProyecto] = useState("");
  const [tipo, setTipo] = useState("error");
  const [nivel, setNivel] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [archivos, setArchivos] = useState<File[]>([]);
  const [avisoArchivos, setAvisoArchivos] = useState<string | null>(null);
  const [creado, setCreado] = useState<{ id: string; numero: number } | null>(null);

  useEffect(() => {
    let vivo = true;
    api<Datos>("/api/soporte/carga-rapida")
      .then((d) => vivo && setDatos(d))
      .catch((e: Error) => vivo && setError(e.message));
    return () => {
      vivo = false;
    };
  }, []);

  // Sin cliente vinculado: se busca por el teléfono o el nombre del contacto.
  useEffect(() => {
    if (clienteId) return;
    let vivo = true;
    const q = new URLSearchParams({ contacto_telefono: telefono ?? "", contacto_nombre: contacto });
    api<{ asociado: { cliente_id: string; via: "telefono" | "contacto" | "nombre"; contacto?: string } | null }>(`/api/soporte/carga-rapida?${q.toString()}`)
      .then((r) => {
        if (!vivo || !r.asociado) return;
        setCliente((actual) => actual || r.asociado!.cliente_id);
        setAsociadoPor(r.asociado.via);
        setContactoSecundario(r.asociado.contacto ?? null);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [clienteId, telefono, contacto]);

  // Proyectos del cliente. Si la carga falla (p. ej. la sesión se estaba
  // renovando) se reintenta una vez, y si vuelve a fallar se muestra el error:
  // no se confunde con "el cliente no tiene proyectos".
  const [proyectosEstado, setProyectosEstado] = useState<"cargando" | "listo" | "error">("listo");
  const [reintento, setReintento] = useState(0);
  useEffect(() => {
    let vivo = true;
    if (!cliente) {
      setProyectos([]);
      setProyectosEstado("listo");
      return;
    }
    setProyectosEstado("cargando");
    const pedir = () => api<{ proyectos: { id: string; titulo: string }[] }>(`/api/soporte/carga-rapida?cliente_id=${cliente}`).then((r) => r.proyectos);
    pedir()
      .catch(() => new Promise<{ id: string; titulo: string }[]>((ok, mal) => setTimeout(() => pedir().then(ok, mal), 800)))
      .then((p) => {
        if (!vivo) return;
        setProyectos(p);
        setProyectosEstado("listo");
        setProyecto((actual) => (p.some((x) => x.id === actual) ? actual : p.length === 1 ? p[0].id : ""));
      })
      .catch(() => {
        if (!vivo) return;
        setProyectos([]);
        setProyectosEstado("error");
      });
    return () => {
      vivo = false;
    };
  }, [cliente, reintento]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && !guardando && alCerrar();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [alCerrar, guardando]);

  const niveles = useMemo(() => (datos?.clasificaciones ?? []).filter((c) => c.tipo_codigo === tipo), [datos, tipo]);
  const nivelElegido = niveles.find((c) => c.codigo === nivel);
  const entrega = nivelElegido ? vencimientoSla(Date.now(), nivelElegido.sla_horas) : null;

  const faltan: string[] = [];
  if (!cliente) faltan.push("cliente");
  if (!proyecto) faltan.push("proyecto");
  if (!tipo) faltan.push("tipo");
  if (niveles.length > 0 && !nivel) faltan.push("clasificación");
  if (!descripcion.trim()) faltan.push("descripción");

  const guardar = async () => {
    if (faltan.length) {
      setError(`Completá: ${faltan.join(", ")}.`);
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const r = await api<{ id: string; numero: number }>("/api/soporte/carga-rapida", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          cliente_id: cliente,
          proyecto_id: proyecto || null,
          tipo_codigo: tipo,
          clasificacion_codigo: nivel || null,
          descripcion,
        }),
      });
      // El ticket ya existe: si alguna evidencia falla se avisa y se puede volver
      // a subir desde la pestaña Archivos del ticket.
      if (archivos.length) {
        const sub = await subirArchivos(r.id, archivos);
        if (sub.errores.length) setAvisoArchivos(`${sub.errores.length} archivo(s) no se subieron: ${sub.errores.join(" · ")}`);
      }
      setCreado(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el ticket");
    } finally {
      setGuardando(false);
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/40 p-4" role="presentation" onClick={() => !guardando && alCerrar()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="soporte-ticket-titulo"
        className="flex max-h-[min(92vh,760px)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[#4FAEB2]/25 bg-white shadow-2xl shadow-[#2F6E71]/15"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-[#4FAEB2]/20 bg-gradient-to-r from-violet-500/10 via-[#4FAEB2]/6 to-transparent px-5 py-4">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/12 text-violet-700">
            <Headset className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="soporte-ticket-titulo" className="text-[17px] font-semibold text-slate-900">
              Cargar ticket de soporte
            </h2>
            <p className="mt-0.5 truncate text-[13px] text-slate-600">Desde la conversación con {contacto}</p>
          </div>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-white/70 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        {creado ? (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-500" aria-hidden />
            <p className="text-lg font-semibold text-slate-900">Ticket {numeroTicket(creado.numero)} creado</p>
            <p className="text-sm text-slate-500">Quedó en Soporte como Pendiente y en el historial del cliente.</p>
            {avisoArchivos ? <p className="text-xs font-medium text-amber-700">{avisoArchivos}</p> : null}
            <div className="mt-2 flex gap-2">
              <Link
                href={`/dashboard/soporte/tickets/${creado.id}`}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-[#4FAEB2]/60 hover:text-[#2F6E71]"
              >
                Ver ticket
              </Link>
              <button type="button" onClick={alCerrar} className="rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91]">
                Listo
              </button>
            </div>
          </div>
        ) : !datos ? (
          <div className="flex items-center justify-center gap-2 px-6 py-12 text-sm text-slate-500">
            {error ? <span className="text-rose-600">{error}</span> : (<><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando…</>)}
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <span className={claseEtiqueta}>Cliente *</span>
                  <SelectorBuscable
                    ariaLabel="Cliente"
                    value={cliente}
                    onChange={(v) => {
                      setCliente(v);
                      setAsociadoPor(null);
                    }}
                    opciones={datos.clientes.map((c) => ({ value: c.id, label: c.nombre }))}
                    placeholder="Elegí el cliente"
                    buscarPlaceholder="Buscar cliente…"
                    vacio="Ningún cliente coincide"
                  />
                  {asociadoPor && cliente ? (
                    <p className="mt-1 text-[11.5px] font-medium text-emerald-600">
                      {asociadoPor === "vinculado"
                        ? "Cliente vinculado al contacto"
                        : asociadoPor === "telefono"
                          ? "Encontrado por el teléfono del contacto"
                          : asociadoPor === "contacto"
                            ? `Número de un contacto del cliente${contactoSecundario ? ` (${contactoSecundario})` : ""}`
                            : "Encontrado por el nombre del contacto"}
                    </p>
                  ) : null}
                </div>
                <div>
                  <span className={claseEtiqueta}>Proyecto *</span>
                  <SelectorBuscable
                    ariaLabel="Proyecto"
                    value={proyecto}
                    onChange={setProyecto}
                    disabled={!cliente || proyectos.length === 0}
                    opciones={proyectos.map((p) => ({ value: p.id, label: p.titulo }))}
                    placeholder={
                      !cliente
                        ? "Elegí el cliente"
                        : proyectosEstado === "cargando"
                          ? "Cargando proyectos…"
                          : proyectosEstado === "error"
                            ? "No se pudieron cargar"
                            : proyectos.length
                              ? "Elegí el proyecto"
                              : "El cliente no tiene proyectos"
                    }
                    buscarPlaceholder="Buscar proyecto…"
                    vacio="Ningún proyecto coincide"
                  />
                  {proyectosEstado === "error" ? (
                    <button type="button" onClick={() => setReintento((n) => n + 1)} className="mt-1 text-[11.5px] font-semibold text-rose-600 hover:underline">
                      No se pudieron cargar los proyectos · Reintentar
                    </button>
                  ) : null}
                </div>
              </div>

              <div>
                <span className={claseEtiqueta}>Tipo *</span>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Tipo">
                  {datos.tipos.map((t) => (
                    <button
                      key={t.codigo}
                      type="button"
                      role="radio"
                      aria-checked={tipo === t.codigo}
                      onClick={() => {
                        setTipo(t.codigo);
                        setNivel("");
                      }}
                      className={`rounded-xl border px-3 py-1.5 text-[13px] font-semibold transition ${
                        tipo === t.codigo ? "border-[#4FAEB2] bg-[#4FAEB2]/12 text-[#2F6E71]" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {t.nombre}
                    </button>
                  ))}
                </div>
              </div>

              {niveles.length > 0 ? (
                <div>
                  <span className={claseEtiqueta}>Clasificación *</span>
                  <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Clasificación">
                    {niveles.map((c) => (
                      <button
                        key={c.codigo}
                        type="button"
                        role="radio"
                        aria-checked={nivel === c.codigo}
                        onClick={() => setNivel(c.codigo)}
                        className={`rounded-xl border px-3 py-2 text-left transition ${
                          nivel === c.codigo ? "border-violet-300 bg-violet-50" : "border-slate-200 bg-white hover:bg-slate-50"
                        }`}
                      >
                        <span className={`block text-[13px] font-bold ${nivel === c.codigo ? "text-violet-700" : "text-slate-800"}`}>{c.nombre}</span>
                        <span className="block text-[11.5px] text-slate-500">SLA {c.sla_horas} h</span>
                      </button>
                    ))}
                  </div>
                  {entrega ? (
                    <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-rose-50 px-2.5 py-1 text-[12px] font-semibold text-rose-700">
                      <CalendarCheck className="h-3.5 w-3.5" aria-hidden /> Entrega: {fechaHoraPy(entrega)}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div>
                <span className={claseEtiqueta}>Descripción *</span>
                <textarea
                  className={`${claseCampo} min-h-28 resize-y`}
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  placeholder="Qué pasa, desde cuándo, qué mensaje aparece…"
                />
              </div>
              <div>
                <span className={claseEtiqueta}>Evidencias</span>
                <ZonaArchivos archivos={archivos} onCambio={setArchivos} compacta deshabilitada={guardando} />
              </div>
              {datos.asignacion?.[tipo === "cambio" ? "cambio" : "error"]?.responsable ? (
                <p className="rounded-xl bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">
                  Se asigna a <strong className="text-slate-800">{datos.asignacion[tipo === "cambio" ? "cambio" : "error"].responsable?.nombre}</strong> (
                  {({ ordinario: "Desarrollo de Soporte", guardia: "desarrollador de guardia", guardia_sin_asignar: "no hay guardia cargada esta semana" })[datos.asignacion[tipo === "cambio" ? "cambio" : "error"].motivo]}).
                </p>
              ) : null}
              {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p> : null}
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button type="button" onClick={alCerrar} disabled={guardando} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void guardar()}
                disabled={guardando}
                className="inline-flex items-center gap-2 rounded-xl bg-[#4FAEB2] px-5 py-2 text-sm font-semibold text-white shadow-sm shadow-[#4FAEB2]/20 hover:bg-[#3F8E91] disabled:opacity-60"
              >
                {guardando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {guardando && archivos.length ? "Creando y subiendo…" : "Crear ticket"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
