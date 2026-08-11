"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { createBrowserClientForSchema } from "@/lib/supabase";
import {
  QA_ESTADOS,
  QA_SEVERIDADES,
  qaSeveridadPeso,
  type QAObservacionEstado,
  type QAObservacionSeveridad,
} from "@/lib/proyectos/qa-observaciones-config";
import ClonarObservacionesModal from "./ClonarObservacionesModal";
import QAComposer from "./QAComposer";
import ObservacionCard from "./ObservacionCard";
import ObservacionModal from "./ObservacionModal";
import SeccionesManager from "./SeccionesManager";
import { copiarAlPortapapeles, imprimirObservaciones, textoWhatsApp } from "./exportar";
import type { QAApiResp, QAObservacion, QASeccion, QATabProps } from "./types";
import {
  AccionSecundaria,
  BTN_GHOST_CLS,
  BTN_PRIMARY_CLS,
  FiltroSelect,
  FiltroToggle,
  GrupoAcciones,
  INPUT_CLS,
  Segmentado,
  IconCheck,
  IconChevron,
  IconClonar,
  IconFiltro,
  IconCopy,
  IconGrupos,
  IconList,
  IconPlus,
  IconPrinter,
  IconSearch,
  IconSettings,
} from "./ui";

/** Clave de agrupación de las observaciones sin sección asignada. */
const SIN_SECCION = "sin_seccion";

type Agrupacion = "seccion" | "lista";

type Filtros = {
  q: string;
  estado: "" | QAObservacionEstado;
  seccionId: string;
  severidad: "" | QAObservacionSeveridad;
  asignadoA: string;
  ocultarResueltas: boolean;
};

const FILTROS_INICIALES: Filtros = {
  q: "",
  estado: "",
  seccionId: "",
  severidad: "",
  asignadoA: "",
  ocultarResueltas: false,
};

const CERRADAS: QAObservacionEstado[] = ["resuelto", "verificado", "descartado"];

/** Bloque renderizable: un acordeón por sección, o uno solo en modo lista. */
type Grupo = {
  key: string;
  nombre: string;
  seccion: QASeccion | null;
  items: QAObservacion[];
};

export default function ObservacionesBoard({
  projectId,
  dataSchema,
  usuarios,
  projectTitle,
}: QATabProps) {
  const [observaciones, setObservaciones] = useState<QAObservacion[]>([]);
  const [secciones, setSecciones] = useState<QASeccion[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [filtros, setFiltros] = useState<Filtros>(FILTROS_INICIALES);
  const [agrupacion, setAgrupacion] = useState<Agrupacion>("seccion");
  const [colapsadas, setColapsadas] = useState<Set<string>>(new Set());
  const [seccionesOpen, setSeccionesOpen] = useState(false);
  const [clonarOpen, setClonarOpen] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  // Se guarda el id, no la fila: así el modal siempre lee la versión vigente
  // del estado (realtime, guardados, adjuntos) sin quedar desincronizado.
  const [abiertaId, setAbiertaId] = useState<string | null>(null);

  const [altaOpen, setAltaOpen] = useState(false);
  const [filtrosOpen, setFiltrosOpen] = useState(false);

  const usuariosMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of usuarios) {
      m.set(u.id, (u.nombre ?? "").trim() || (u.email ?? "").trim() || "Usuario");
    }
    return m;
  }, [usuarios]);

  // Se traen todas las observaciones del proyecto y el filtrado es en memoria:
  // los volúmenes son de decenas y así los contadores y la búsqueda responden
  // sin ida y vuelta. Los filtros del endpoint quedan para otros consumidores.
  const cargar = useCallback(async () => {
    const [resObs, resSec] = await Promise.all([
      fetchWithSupabaseSession(`/api/proyectos/${projectId}/qa/observaciones`, { cache: "no-store" }),
      fetchWithSupabaseSession(`/api/proyectos/${projectId}/qa/secciones`, { cache: "no-store" }),
    ]);
    const jObs = (await resObs.json().catch(() => null)) as QAApiResp<{
      observaciones: QAObservacion[];
    }> | null;
    const jSec = (await resSec.json().catch(() => null)) as QAApiResp<{
      secciones: QASeccion[];
    }> | null;

    if (!resObs.ok || !jObs?.success || !jObs.data) {
      setErr(jObs?.error ?? "Error al cargar las observaciones");
      setLoading(false);
      return;
    }
    setObservaciones(jObs.data.observaciones);
    setSecciones(jSec?.success && jSec.data ? jSec.data.secciones : []);
    setErr(null);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const cargarRef = useRef(cargar);
  useEffect(() => {
    cargarRef.current = cargar;
  }, [cargar]);

  // Realtime: cualquier cambio en las 4 tablas del módulo re-carga.
  useEffect(() => {
    if (!projectId || !dataSchema) return;
    const sb = createBrowserClientForSchema(dataSchema);
    const filtro = `proyecto_id=eq.${projectId}`;
    const channel = sb
      .channel(`proyecto-qa-obs:${projectId}`)
      .on("postgres_changes", { event: "*", schema: dataSchema, table: "proyecto_qa_observaciones", filter: filtro }, () => void cargarRef.current?.())
      .on("postgres_changes", { event: "*", schema: dataSchema, table: "proyecto_qa_secciones", filter: filtro }, () => void cargarRef.current?.())
      .on("postgres_changes", { event: "*", schema: dataSchema, table: "proyecto_qa_observacion_archivos", filter: filtro }, () => void cargarRef.current?.())
      .on("postgres_changes", { event: "*", schema: dataSchema, table: "proyecto_qa_observacion_comentarios", filter: filtro }, () => void cargarRef.current?.())
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [projectId, dataSchema]);

  const seccionesMap = useMemo(() => new Map(secciones.map((s) => [s.id, s])), [secciones]);

  const abierta = useMemo(
    () => (abiertaId ? observaciones.find((o) => o.id === abiertaId) ?? null : null),
    [abiertaId, observaciones]
  );

  const conteoPorSeccion = useMemo(() => {
    const m: Record<string, number> = {};
    for (const o of observaciones) {
      const k = o.seccion_id ?? SIN_SECCION;
      m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  }, [observaciones]);

  const contadores = useMemo(() => {
    const m: Record<string, number> = {};
    for (const o of observaciones) m[o.estado] = (m[o.estado] ?? 0) + 1;
    return m;
  }, [observaciones]);

  const filtradas = useMemo(() => {
    const q = filtros.q.trim().toLowerCase();
    return observaciones.filter((o) => {
      if (filtros.estado && o.estado !== filtros.estado) return false;
      if (filtros.severidad && o.severidad !== filtros.severidad) return false;
      if (filtros.asignadoA && o.asignado_a !== filtros.asignadoA) return false;
      if (filtros.seccionId) {
        const k = o.seccion_id ?? SIN_SECCION;
        if (k !== filtros.seccionId) return false;
      }
      if (filtros.ocultarResueltas && CERRADAS.includes(o.estado)) return false;
      if (q) {
        const heno = `${o.numero} ${o.titulo} ${o.descripcion ?? ""}`.toLowerCase();
        if (!heno.includes(q)) return false;
      }
      return true;
    });
  }, [observaciones, filtros]);

  /** Lista plana: primero lo más grave, y dentro de eso lo más viejo. */
  const ordenPlano = useCallback((a: QAObservacion, b: QAObservacion) => {
    const sev = qaSeveridadPeso(a.severidad) - qaSeveridadPeso(b.severidad);
    if (sev !== 0) return sev;
    const fa = a.fecha_limite ?? "9999-12-31";
    const fb = b.fecha_limite ?? "9999-12-31";
    if (fa !== fb) return fa < fb ? -1 : 1;
    return a.numero - b.numero;
  }, []);

  const grupos = useMemo<Grupo[]>(() => {
    if (agrupacion === "lista") {
      return [{ key: "todas", nombre: "Todas", seccion: null, items: [...filtradas].sort(ordenPlano) }];
    }
    const porSeccion = new Map<string, QAObservacion[]>();
    for (const o of filtradas) {
      const k = o.seccion_id ?? SIN_SECCION;
      const lista = porSeccion.get(k) ?? [];
      lista.push(o);
      porSeccion.set(k, lista);
    }
    const ordenadas: Grupo[] = [...secciones]
      .sort((a, b) => a.sort_order - b.sort_order)
      .filter((s) => (porSeccion.get(s.id) ?? []).length > 0)
      .map((s) => ({
        key: s.id,
        nombre: s.nombre,
        seccion: s,
        items: (porSeccion.get(s.id) ?? []).sort((a, b) => a.sort_order - b.sort_order || a.numero - b.numero),
      }));
    const sueltas = porSeccion.get(SIN_SECCION) ?? [];
    if (sueltas.length > 0) {
      ordenadas.push({
        key: SIN_SECCION,
        nombre: "Sin sección",
        seccion: null,
        items: sueltas.sort((a, b) => a.sort_order - b.sort_order || a.numero - b.numero),
      });
    }
    return ordenadas;
  }, [agrupacion, filtradas, secciones, ordenPlano]);

  function toggleColapsada(key: string) {
    setColapsadas((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // --- Mutaciones -----------------------------------------------------------

  /** Igual que el checklist: la UI ya se movió, esto confirma o revierte. */
  async function mutar(url: string, init: RequestInit, rollback: () => void): Promise<unknown> {
    const res = await fetchWithSupabaseSession(url, init);
    const j = (await res.json().catch(() => null)) as QAApiResp<unknown> | null;
    if (!res.ok || !j?.success) {
      rollback();
      setErr(j?.error ?? "Error");
      return null;
    }
    setErr(null);
    return j.data;
  }

  async function toggleResuelto(obs: QAObservacion) {
    const marcada = obs.estado === "resuelto" || obs.estado === "verificado";
    const destino: QAObservacionEstado = marcada ? "pendiente" : "resuelto";
    const snapshot = observaciones;

    setObservaciones((prev) =>
      prev.map((o) => (o.id === obs.id ? { ...o, estado: destino } : o))
    );

    const data = await mutar(
      `/api/proyectos/${projectId}/qa/observaciones/${obs.id}/estado`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: destino }),
      },
      () => setObservaciones(snapshot)
    );

    // La respuesta trae los sellos (quién y cuándo) que el optimismo no conoce.
    const fresca = data as QAObservacion | null;
    if (fresca?.id) {
      setObservaciones((prev) => prev.map((o) => (o.id === fresca.id ? fresca : o)));
    }
  }

  const reemplazar = useCallback((obs: QAObservacion) => {
    setObservaciones((prev) => prev.map((o) => (o.id === obs.id ? obs : o)));
  }, []);

  /** Exporta lo que está viendo el usuario, en el orden en que lo ve. */
  const visiblesEnOrden = useCallback(
    () => grupos.flatMap((g) => g.items),
    [grupos]
  );

  function exportarPdf() {
    const ok = imprimirObservaciones(
      (projectTitle ?? "").trim() || "Proyecto",
      visiblesEnOrden(),
      seccionesMap
    );
    setAviso(ok ? null : "El navegador bloqueó la ventana de impresión");
  }

  async function copiarTexto() {
    const texto = textoWhatsApp(visiblesEnOrden(), seccionesMap);
    const ok = await copiarAlPortapapeles(texto);
    setAviso(ok ? "Listado copiado al portapapeles" : "No se pudo copiar");
    window.setTimeout(() => setAviso(null), 2500);
  }

  const actualizarConteoComentarios = useCallback((obsId: string, total: number) => {
    setObservaciones((prev) =>
      prev.map((o) => (o.id === obsId ? { ...o, comentarios_count: total } : o))
    );
  }, []);

  // --- Render ---------------------------------------------------------------

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Cargando observaciones…</div>;
  }

  // Cuántos filtros están recortando el listado (la búsqueda no cuenta: está
  // siempre a la vista y se nota sola).
  const filtrosActivos =
    [filtros.estado, filtros.seccionId, filtros.severidad, filtros.asignadoA].filter(Boolean)
      .length + (filtros.ocultarResueltas ? 1 : 0);
  const hayFiltros = filtrosActivos > 0 || filtros.q.trim() !== "";

  if (observaciones.length === 0 && !seccionesOpen) {
    return (
      <div className="flex flex-col items-center justify-center gap-5 rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#4FAEB2]/10 text-[#3F8E91]">
          <IconCheck size={24} />
        </div>
        <div>
          <h3 className="text-base font-semibold text-slate-900">Observaciones de QA</h3>
          <p className="mt-1 max-w-md text-sm text-slate-500">
            Registrá acá los ajustes pendientes: pegás la captura, escribís qué hay que corregir y
            le asignás una <strong>sección</strong> y una <strong>severidad</strong>. Todo queda
            auditado para la ida y vuelta con el cliente.
          </p>
        </div>
        {err ? <p className="text-xs text-rose-600">{err}</p> : null}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setAltaOpen(true)}
            className={BTN_PRIMARY_CLS}
          >
            <IconPlus />
            Cargar primera observación
          </button>
          <button type="button" onClick={() => setSeccionesOpen(true)} className={BTN_GHOST_CLS}>
            Definir secciones
          </button>
          <button type="button" onClick={() => setClonarOpen(true)} className={BTN_GHOST_CLS}>
            Clonar desde otro proyecto
          </button>
        </div>
        {clonarOpen ? (
          <ClonarObservacionesModal
            projectId={projectId}
            onClose={() => setClonarOpen(false)}
            onClonado={cargar}
          />
        ) : null}
        {altaOpen ? (
          <div className="w-full pt-2 text-left">
            <QAComposer
              projectId={projectId}
              secciones={secciones}
              usuarios={usuarios}
              onCreada={(nueva) => setObservaciones((prev) => [...prev, nueva])}
              onSeccionCreada={(s) => setSecciones((prev) => [...prev, s])}
              onCerrar={() => setAltaOpen(false)}
            />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Fila única de trabajo. Los filtros y las acciones ocasionales se
          despliegan bajo demanda: la pantalla es para las observaciones. */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setAltaOpen((v) => !v)} className={BTN_PRIMARY_CLS}>
          <IconPlus />
          Nueva observación
        </button>

        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <IconSearch />
          </span>
          <input
            value={filtros.q}
            onChange={(e) => setFiltros((f) => ({ ...f, q: e.target.value }))}
            placeholder="Buscar…"
            className={`${INPUT_CLS} pl-9`}
          />
        </div>

        <FiltroToggle
          activo={filtrosOpen || filtrosActivos > 0}
          onClick={() => setFiltrosOpen((v) => !v)}
          title="Mostrar u ocultar los filtros"
        >
          <IconFiltro />
          Filtros
          {filtrosActivos > 0 ? (
            <span className="rounded-full bg-[#4FAEB2] px-1.5 text-[10px] font-semibold text-white">
              {filtrosActivos}
            </span>
          ) : null}
        </FiltroToggle>

        <Segmentado
          valor={agrupacion}
          onChange={setAgrupacion}
          opciones={[
            { id: "seccion", label: "Secciones", icono: <IconGrupos />, title: "Agrupar por sección" },
            { id: "lista", label: "Lista", icono: <IconList />, title: "Lista plana por severidad" },
          ]}
        />

        <div className="ml-auto">
          <GrupoAcciones>
            <AccionSecundaria
              onClick={() => void copiarTexto()}
              title="Copiar el listado visible como texto (formato WhatsApp)"
            >
              <IconCopy />
              Copiar
            </AccionSecundaria>
            <AccionSecundaria
              onClick={exportarPdf}
              title="Abrir el listado visible para imprimir o guardar como PDF"
            >
              <IconPrinter />
              Exportar
            </AccionSecundaria>
            <AccionSecundaria
              onClick={() => setClonarOpen(true)}
              title="Clonar observaciones desde otro proyecto"
            >
              <IconClonar />
              Clonar
            </AccionSecundaria>
            <AccionSecundaria
              onClick={() => setSeccionesOpen(true)}
              title="Administrar las secciones del proyecto"
            >
              <IconSettings size={13} />
              Secciones
            </AccionSecundaria>
          </GrupoAcciones>
        </div>
      </div>

      {/* Filtros, solo cuando se piden o cuando hay alguno aplicado. */}
      <div
        className={`flex-wrap items-center gap-2 ${
          filtrosOpen || filtrosActivos > 0 ? "flex" : "hidden"
        }`}
      >
        <FiltroSelect
          etiqueta="Filtrar por estado"
          valor={filtros.estado}
          activo={filtros.estado !== ""}
          onChange={(v) => setFiltros((f) => ({ ...f, estado: v as Filtros["estado"] }))}
        >
          <option value="">Estado: todos</option>
          {QA_ESTADOS.map((e) => (
            <option key={e.codigo} value={e.codigo}>
              {e.label}
            </option>
          ))}
        </FiltroSelect>

        <FiltroSelect
          etiqueta="Filtrar por sección"
          valor={filtros.seccionId}
          activo={filtros.seccionId !== ""}
          onChange={(v) => setFiltros((f) => ({ ...f, seccionId: v }))}
        >
          <option value="">Sección: todas</option>
          {secciones.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
          <option value={SIN_SECCION}>Sin sección</option>
        </FiltroSelect>

        <FiltroSelect
          etiqueta="Filtrar por severidad"
          valor={filtros.severidad}
          activo={filtros.severidad !== ""}
          onChange={(v) => setFiltros((f) => ({ ...f, severidad: v as Filtros["severidad"] }))}
        >
          <option value="">Severidad: toda</option>
          {QA_SEVERIDADES.map((s) => (
            <option key={s.codigo} value={s.codigo}>
              {s.label}
            </option>
          ))}
        </FiltroSelect>

        <FiltroSelect
          etiqueta="Filtrar por asignado"
          valor={filtros.asignadoA}
          activo={filtros.asignadoA !== ""}
          onChange={(v) => setFiltros((f) => ({ ...f, asignadoA: v }))}
        >
          <option value="">Asignado: cualquiera</option>
          {usuarios.map((u) => (
            <option key={u.id} value={u.id}>
              {usuariosMap.get(u.id)}
            </option>
          ))}
        </FiltroSelect>

        <FiltroToggle
          activo={filtros.ocultarResueltas}
          onClick={() => setFiltros((f) => ({ ...f, ocultarResueltas: !f.ocultarResueltas }))}
          title="Dejar a la vista solo lo que falta"
        >
          Ocultar resueltas
        </FiltroToggle>
      </div>

      {/* Contadores + composer */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
        <span className="font-medium tabular-nums text-amber-600">
          {contadores.pendiente ?? 0} pendientes
        </span>
        <span>·</span>
        <span className="tabular-nums text-sky-600">{contadores.en_curso ?? 0} en curso</span>
        <span>·</span>
        <span className="tabular-nums text-emerald-600">{contadores.resuelto ?? 0} resueltas</span>
        {contadores.verificado ? (
          <>
            <span>·</span>
            <span className="tabular-nums text-[#3F8E91]">{contadores.verificado} verificadas</span>
          </>
        ) : null}
        {contadores.descartado ? (
          <>
            <span>·</span>
            <span className="tabular-nums text-slate-400">{contadores.descartado} descartadas</span>
          </>
        ) : null}
        {hayFiltros ? (
          <>
            <span>·</span>
            <button
              type="button"
              onClick={() => setFiltros(FILTROS_INICIALES)}
              className="font-medium text-[#3F8E91] underline-offset-2 hover:underline"
            >
              Limpiar filtros ({filtradas.length} visibles)
            </button>
          </>
        ) : null}
      </div>

      {err ? <p className="text-xs text-rose-600">{err}</p> : null}
      {aviso ? <p className="text-xs text-[#3F8E91]">{aviso}</p> : null}

      {altaOpen ? (
        <QAComposer
          projectId={projectId}
          secciones={secciones}
          usuarios={usuarios}
          seccionInicial={filtros.seccionId && filtros.seccionId !== SIN_SECCION ? filtros.seccionId : null}
          onCreada={(nueva) => setObservaciones((prev) => [...prev, nueva])}
          onSeccionCreada={(s) => setSecciones((prev) => [...prev, s])}
          onCerrar={() => setAltaOpen(false)}
        />
      ) : null}

      {/* Grupos */}
      {grupos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
          Ninguna observación coincide con los filtros.
        </div>
      ) : null}

      {grupos.map((g) => {
        const abierta = !colapsadas.has(g.key);
        const pendientes = g.items.filter((o) => !CERRADAS.includes(o.estado)).length;
        return (
          <section key={g.key} className="space-y-2">
            {agrupacion === "seccion" ? (
              <button
                type="button"
                onClick={() => toggleColapsada(g.key)}
                className="flex w-full items-center gap-2 rounded-xl px-1 py-1 text-left transition-colors hover:bg-slate-50"
              >
                <IconChevron open={abierta} />
                <span className="text-sm font-semibold text-slate-900">{g.nombre}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600">
                  {pendientes > 0 ? `${pendientes}/${g.items.length}` : g.items.length}
                </span>
                {g.seccion?.color ? (
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: g.seccion.color }}
                    aria-hidden
                  />
                ) : null}
              </button>
            ) : null}

            {abierta ? (
              <ul className="space-y-2">
                {g.items.map((o) => (
                  <ObservacionCard
                    key={o.id}
                    obs={o}
                    seccion={o.seccion_id ? seccionesMap.get(o.seccion_id) ?? null : null}
                    onAbrir={(obs) => setAbiertaId(obs.id)}
                    onToggleResuelto={(obs) => void toggleResuelto(obs)}
                  />
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}

      {abierta ? (
        <ObservacionModal
          projectId={projectId}
          obs={abierta}
          secciones={secciones}
          usuarios={usuarios}
          onClose={() => setAbiertaId(null)}
          onActualizada={reemplazar}
          onEliminada={(id) => {
            setObservaciones((prev) => prev.filter((o) => o.id !== id));
            setAbiertaId(null);
          }}
          onSeccionCreada={(s) => setSecciones((prev) => [...prev, s])}
          onComentariosCambio={actualizarConteoComentarios}
        />
      ) : null}

      {seccionesOpen ? (
        <SeccionesManager
          projectId={projectId}
          secciones={secciones}
          conteoPorSeccion={conteoPorSeccion}
          onClose={() => setSeccionesOpen(false)}
          onCambio={cargar}
        />
      ) : null}

      {clonarOpen ? (
        <ClonarObservacionesModal
          projectId={projectId}
          onClose={() => setClonarOpen(false)}
          onClonado={cargar}
        />
      ) : null}
    </div>
  );
}
