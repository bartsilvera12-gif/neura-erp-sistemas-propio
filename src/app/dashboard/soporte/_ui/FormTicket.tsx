"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Clock, Info, ListChecks, Paperclip, Tags, UserRoundCheck, type LucideIcon } from "lucide-react";
import { FancySelect } from "@/app/dashboard/proyectos/components/FancySelect";
import { FechaSelect } from "@/components/ui/FechaSelect";
import { slaDe } from "@/lib/soporte/dominio";
import { apiSoporte, obtenerCatalogos, obtenerClientes, type CatalogosConEquipo } from "./api";
import ZonaArchivos from "./ZonaArchivos";
import { SelectorBuscable } from "./SelectorBuscable";
import { Aviso, Boton, Cargando, IconoTile, TONO_AREA, claseBoton, claseEtiqueta, claseInput, type Tono } from "./ui";

export type ValoresTicket = {
  cliente_id: string;
  proyecto_id: string;
  modulo: string;
  tipo_codigo: string;
  clasificacion_codigo: string;
  prioridad_codigo: string;
  asunto: string;
  descripcion: string;
  resultado_esperado: string;
  impacto_operativo: string;
  pasos_reproducir: string;
  criterios_aceptacion: string;
  responsable_id: string;
  proxima_accion: string;
  fecha_objetivo: string;
  version: string;
  entorno: string;
  navegador: string;
};

export const VALORES_VACIOS: ValoresTicket = {
  cliente_id: "",
  proyecto_id: "",
  modulo: "",
  tipo_codigo: "",
  clasificacion_codigo: "",
  prioridad_codigo: "normal",
  asunto: "",
  descripcion: "",
  resultado_esperado: "",
  impacto_operativo: "",
  pasos_reproducir: "",
  criterios_aceptacion: "",
  responsable_id: "",
  proxima_accion: "",
  fecha_objetivo: "",
  version: "",
  entorno: "Producción",
  navegador: "",
};

function Campo({ etiqueta, requerido, children, ayuda, className = "" }: { etiqueta: string; requerido?: boolean; children: React.ReactNode; ayuda?: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <span className={claseEtiqueta}>
        {etiqueta}
        {requerido ? <span className="text-rose-500"> *</span> : null}
      </span>
      {children}
      {ayuda ? <p className="mt-1 text-[11.5px] text-slate-400">{ayuda}</p> : null}
    </div>
  );
}

function Seccion({
  titulo,
  descripcion,
  icono,
  tono,
  children,
}: {
  titulo: string;
  descripcion?: string;
  icono: LucideIcon;
  tono: Tono;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-5 border-b border-slate-100 py-6 first:pt-0 last:border-0 last:pb-0 lg:grid-cols-[220px_1fr]">
      <div>
        <IconoTile icono={icono} tono={tono} />
        <h2 className="mt-2.5 text-sm font-bold text-slate-800">{titulo}</h2>
        {descripcion ? <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500">{descripcion}</p> : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/**
 * Formulario de ticket, para alta y edición.
 *
 * En el alta el SLA se muestra en vivo según la clasificación elegida, y la
 * prioridad se sugiere desde la clasificación (un error alto propone
 * "Urgente") sin pisar lo que la persona ya cambió a mano.
 */
export default function FormTicket({
  inicial,
  modo,
  cancelarHref,
  onGuardar,
}: {
  inicial: ValoresTicket;
  modo: "crear" | "editar";
  cancelarHref: string;
  onGuardar: (v: ValoresTicket, archivos: File[]) => Promise<void>;
}) {
  const [cat, setCat] = useState<CatalogosConEquipo | null>(null);
  const [clientes, setClientes] = useState<{ id: string; nombre: string }[]>([]);
  const [proyectos, setProyectos] = useState<{ id: string; titulo: string }[]>([]);
  const [v, setV] = useState<ValoresTicket>(inicial);
  const [archivos, setArchivos] = useState<File[]>([]);
  const [prioridadTocada, setPrioridadTocada] = useState(modo === "editar");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void obtenerCatalogos().then(setCat).catch((e: Error) => setError(e.message));
    void obtenerClientes()
      .then(setClientes)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!v.cliente_id) {
      setProyectos([]);
      return;
    }
    let vivo = true;
    apiSoporte<{ proyectos: { id: string; titulo: string }[] }>(`/api/soporte/opciones?cliente_id=${v.cliente_id}`)
      .then((r) => vivo && setProyectos(r.proyectos))
      .catch(() => vivo && setProyectos([]));
    return () => {
      vivo = false;
    };
  }, [v.cliente_id]);

  const set = <K extends keyof ValoresTicket>(k: K, valor: ValoresTicket[K]) => setV((prev) => ({ ...prev, [k]: valor }));

  const clasificaciones = useMemo(
    () => (cat?.clasificaciones ?? []).filter((c) => c.activo && c.tipo_codigo === v.tipo_codigo),
    [cat, v.tipo_codigo]
  );
  const sla = cat && v.tipo_codigo ? slaDe(cat, v.tipo_codigo, v.clasificacion_codigo || null) : null;

  if (!cat) return error ? <Aviso>{error}</Aviso> : <Cargando />;

  const tipoOpciones = [{ value: "", label: "Seleccionar…" }, ...cat.tipos.filter((t) => t.activo).map((t) => ({ value: t.codigo, label: t.nombre }))];
  const prioridadOpciones = cat.prioridades.filter((p) => p.activo).map((p) => ({ value: p.codigo, label: p.nombre }));
  const responsableOpciones = [
    { value: "", label: "Sin asignar" },
    ...cat.personas.map((u) => ({ value: u.id, label: u.nombre, detalle: u.area, tono: TONO_AREA[u.area] })),
  ];

  const faltantes: string[] = [];
  if (!v.cliente_id) faltantes.push("cliente");
  if (!v.tipo_codigo) faltantes.push("tipo de solicitud");
  if (clasificaciones.length > 0 && !v.clasificacion_codigo) faltantes.push("clasificación");
  if (!v.prioridad_codigo) faltantes.push("prioridad");
  if (!v.asunto.trim()) faltantes.push("asunto");
  if (!v.descripcion.trim()) faltantes.push("descripción");

  const enviar = async () => {
    if (faltantes.length) {
      setError(`Completá: ${faltantes.join(", ")}.`);
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await onGuardar(v, archivos);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
      setGuardando(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void enviar();
      }}
      className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.05),0_8px_24px_-12px_rgba(15,23,42,0.08)] md:p-7"
    >
      <Seccion icono={Tags} tono="violeta" titulo="Clasificación" descripcion="A quién corresponde y qué tipo de pedido es. La clasificación define el SLA.">
        <div className="grid gap-4 md:grid-cols-2">
          <Campo etiqueta="Cliente" requerido ayuda={modo === "editar" ? "El cliente no se cambia desde la edición." : undefined}>
            <SelectorBuscable
              ariaLabel="Cliente"
              avatares
              disabled={modo === "editar"}
              opciones={clientes.map((c) => ({ value: c.id, label: c.nombre }))}
              value={v.cliente_id}
              onChange={(id) => setV((p) => ({ ...p, cliente_id: id, proyecto_id: "" }))}
              placeholder="Seleccionar cliente…"
              buscarPlaceholder="Buscar cliente…"
              vacio="Ningún cliente coincide"
            />
          </Campo>
          <Campo etiqueta="Proyecto">
            <FancySelect
              ariaLabel="Proyecto"
              value={v.proyecto_id}
              onChange={(x) => set("proyecto_id", x)}
              disabled={modo === "editar" || !v.cliente_id || proyectos.length === 0}
              placeholder={!v.cliente_id ? "Elegí primero el cliente" : proyectos.length ? "Sin proyecto" : "El cliente no tiene proyectos"}
              options={[{ value: "", label: "Sin proyecto" }, ...proyectos.map((p) => ({ value: p.id, label: p.titulo }))]}
            />
          </Campo>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Campo etiqueta="Tipo de solicitud" requerido>
            <FancySelect
              ariaLabel="Tipo de solicitud"
              value={v.tipo_codigo}
              onChange={(x) => setV((p) => ({ ...p, tipo_codigo: x, clasificacion_codigo: "" }))}
              options={tipoOpciones}
            />
          </Campo>
          <Campo etiqueta="Clasificación" requerido={clasificaciones.length > 0}>
            <FancySelect
              ariaLabel="Clasificación"
              value={v.clasificacion_codigo}
              disabled={clasificaciones.length === 0}
              placeholder={v.tipo_codigo ? "No aplica" : "Elegí el tipo"}
              onChange={(x) => {
                const c = clasificaciones.find((y) => y.codigo === x);
                setV((p) => ({
                  ...p,
                  clasificacion_codigo: x,
                  // Sugerencia, no imposición: sólo si nadie tocó la prioridad.
                  prioridad_codigo: !prioridadTocada && c?.prioridad_sugerida ? c.prioridad_sugerida : p.prioridad_codigo,
                }));
              }}
              options={[
                { value: "", label: "Seleccionar…" },
                ...clasificaciones.map((c) => ({ value: c.codigo, label: c.nombre, description: `SLA ${c.sla_horas} h` })),
              ]}
            />
          </Campo>
          <Campo etiqueta="Prioridad" requerido>
            <FancySelect
              ariaLabel="Prioridad"
              value={v.prioridad_codigo}
              onChange={(x) => {
                setPrioridadTocada(true);
                set("prioridad_codigo", x);
              }}
              options={prioridadOpciones}
            />
          </Campo>
        </div>

        {v.tipo_codigo ? (
          <p className="flex items-center gap-2 rounded-lg bg-[#4FAEB2]/8 px-3 py-2 text-[12.5px] text-[#2F6E71]">
            <Clock className="h-4 w-4 shrink-0" aria-hidden />
            {sla != null ? (
              <span>
                Service level: <strong>{sla} horas laborales</strong>
                {modo === "editar" ? " — si cambiás la clasificación, el SLA se recalcula y queda en el historial." : ""}
              </span>
            ) : (
              <span>Este tipo de solicitud no tiene SLA configurado.</span>
            )}
          </p>
        ) : null}

        <Campo etiqueta="Módulo" ayuda="Parte del sistema afectada. Ej.: Ventas, Facturación electrónica.">
          <input className={claseInput} value={v.modulo} onChange={(e) => set("modulo", e.target.value)} maxLength={120} />
        </Campo>
      </Seccion>

      <Seccion icono={ListChecks} tono="celeste" titulo="Detalle" descripcion="Lo que QA y Desarrollo necesitan para reproducirlo y validarlo sin tener que preguntar.">
        <Campo etiqueta="Asunto" requerido>
          <input
            className={claseInput}
            value={v.asunto}
            onChange={(e) => set("asunto", e.target.value)}
            placeholder="Resumen breve del problema o solicitud"
            maxLength={200}
          />
        </Campo>
        <Campo etiqueta="Descripción" requerido>
          <textarea
            className={`${claseInput} min-h-32`}
            value={v.descripcion}
            onChange={(e) => set("descripcion", e.target.value)}
            placeholder="Describí en detalle el problema, solicitud o consulta…"
          />
        </Campo>
        <div className="grid gap-4 md:grid-cols-2">
          <Campo etiqueta="Pasos para reproducir">
            <textarea
              className={`${claseInput} min-h-28`}
              value={v.pasos_reproducir}
              onChange={(e) => set("pasos_reproducir", e.target.value)}
              placeholder={"1. Ir a Ventas\n2. Crear factura\n3. Presionar Emitir FE"}
            />
          </Campo>
          <Campo etiqueta="Resultado esperado">
            <textarea
              className={`${claseInput} min-h-28`}
              value={v.resultado_esperado}
              onChange={(e) => set("resultado_esperado", e.target.value)}
              placeholder="Qué debería pasar"
            />
          </Campo>
          <Campo etiqueta="Impacto operativo">
            <textarea
              className={`${claseInput} min-h-24`}
              value={v.impacto_operativo}
              onChange={(e) => set("impacto_operativo", e.target.value)}
              placeholder="A quién afecta y cuánto. Ej.: no pueden facturar."
            />
          </Campo>
          <Campo etiqueta="Criterios de aceptación / validación QA">
            <textarea
              className={`${claseInput} min-h-24`}
              value={v.criterios_aceptacion}
              onChange={(e) => set("criterios_aceptacion", e.target.value)}
              placeholder="Cómo se comprueba que quedó resuelto"
            />
          </Campo>
        </div>
      </Seccion>

      <Seccion icono={UserRoundCheck} tono="turquesa" titulo="Asignación" descripcion="Quién tiene la próxima acción y para cuándo.">
        <div className="grid gap-4 md:grid-cols-2">
          <Campo etiqueta="Responsable" ayuda={modo === "crear" ? "Con responsable, el ticket entra como Clasificado / Asignado." : undefined}>
            <SelectorBuscable ariaLabel="Responsable" avatares value={v.responsable_id} onChange={(x) => set("responsable_id", x)} opciones={responsableOpciones} buscarPlaceholder="Buscar persona o área…" vacio="Nadie coincide" />
          </Campo>
          <Campo etiqueta="Fecha objetivo">
            <FechaSelect value={v.fecha_objetivo} onChange={(e) => set("fecha_objetivo", e.target.value)} className={claseInput} anioDesde={2024} />
          </Campo>
        </div>
        <Campo etiqueta="Próxima acción">
          <input
            className={claseInput}
            value={v.proxima_accion}
            onChange={(e) => set("proxima_accion", e.target.value)}
            placeholder="Ej.: Corregir validación del timbrado"
            maxLength={500}
          />
        </Campo>
      </Seccion>

      <Seccion icono={Info} tono="indigo" titulo="Información adicional" descripcion="Contexto técnico del reporte.">
        <div className="grid gap-4 md:grid-cols-3">
          <Campo etiqueta="Versión">
            <input className={claseInput} value={v.version} onChange={(e) => set("version", e.target.value)} placeholder="v1.2.3" maxLength={60} />
          </Campo>
          <Campo etiqueta="Entorno">
            <FancySelect
              ariaLabel="Entorno"
              value={v.entorno}
              onChange={(x) => set("entorno", x)}
              options={["Producción", "Pruebas", "Desarrollo"].map((x) => ({ value: x, label: x }))}
            />
          </Campo>
          <Campo etiqueta="Navegador">
            <input className={claseInput} value={v.navegador} onChange={(e) => set("navegador", e.target.value)} placeholder="Chrome 128" maxLength={120} />
          </Campo>
        </div>
      </Seccion>

      {modo === "crear" ? (
        <Seccion icono={Paperclip} tono="ambar" titulo="Archivos / Evidencias" descripcion="Capturas, videos o documentos del problema.">
          <ZonaArchivos archivos={archivos} onCambio={setArchivos} deshabilitada={guardando} />
        </Seccion>
      ) : null}

      <div className="mt-6 space-y-3 border-t border-slate-100 pt-5">
        {error ? <Aviso>{error}</Aviso> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Link href={cancelarHref} className={claseBoton("secundario")} aria-disabled={guardando}>
            Cancelar
          </Link>
          <Boton type="submit" cargando={guardando}>
            {modo === "crear" ? "Crear ticket" : "Guardar cambios"}
          </Boton>
        </div>
      </div>
    </form>
  );
}
