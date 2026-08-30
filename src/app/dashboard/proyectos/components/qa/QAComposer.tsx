"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import {
  QA_ORIGENES,
  QA_SEVERIDADES,
  type QAObservacionOrigen,
  type QAObservacionSeveridad,
} from "@/lib/proyectos/qa-observaciones-config";
import QAImageDropzone from "./QAImageDropzone";
import type { QAApiResp, QAArchivo, QAObservacion, QASeccion, QAUsuario } from "./types";
import {
  BTN_GHOST_CLS,
  BTN_PRIMARY_CLS,
  FiltroSelect,
  INPUT_CLS,
  IconPlus,
  IconTrash,
} from "./ui";
import { FechaSelect } from "@/components/ui/FechaSelect";

type Props = {
  projectId: string;
  secciones: QASeccion[];
  usuarios: QAUsuario[];
  /** Sección preseleccionada cuando se carga desde el encabezado de un grupo. */
  seccionInicial?: string | null;
  /**
   * Ronda a la que entran las observaciones nuevas. La decide el board (la
   * revisión abierta, o la siguiente si QA arrancó una nueva). Si no viene, el
   * servidor la resuelve solo.
   */
  ronda?: number;
  onCreada: (obs: QAObservacion) => void;
  onSeccionCreada: (seccion: QASeccion) => void;
  onCerrar: () => void;
};

/** Captura pendiente: todavía no existe la observación contra la cual subirla. */
type Pendiente = { file: File; preview: string; id: string };

const LABEL_CLS = "text-[11px] font-medium uppercase tracking-wide text-slate-500";

/**
 * Alta completa en un solo paso.
 *
 * En QA se carga con el problema a la vista: la captura, el detalle, a quién le
 * toca y para cuándo tienen que entrar en el mismo momento. Crear primero y
 * completar después obliga a volver sobre cada observación, que es justo lo que
 * hace que no se use.
 *
 * Las capturas se retienen en memoria porque el endpoint de adjuntos necesita
 * una observación existente: al guardar, primero se crea y después se suben.
 * Tras guardar el formulario se limpia y queda abierto, para encadenar cargas.
 */
export default function QAComposer({
  projectId,
  secciones,
  usuarios,
  seccionInicial,
  ronda,
  onCreada,
  onSeccionCreada,
  onCerrar,
}: Props) {
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [seccionId, setSeccionId] = useState(seccionInicial ?? "");
  const [nuevaSeccion, setNuevaSeccion] = useState("");
  const [severidad, setSeveridad] = useState<QAObservacionSeveridad>("media");
  const [origen, setOrigen] = useState<QAObservacionOrigen>("interno");
  const [asignadoA, setAsignadoA] = useState("");
  const [fechaLimite, setFechaLimite] = useState("");
  const [urlRef, setUrlRef] = useState("");
  const [pendientes, setPendientes] = useState<Pendiente[]>([]);

  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [avisoAlta, setAvisoAlta] = useState<string | null>(null);
  const tituloRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    tituloRef.current?.focus();
  }, []);

  // Las object URL de las previsualizaciones se liberan al desmontar.
  const pendientesRef = useRef<Pendiente[]>([]);
  pendientesRef.current = pendientes;
  useEffect(
    () => () => {
      for (const p of pendientesRef.current) URL.revokeObjectURL(p.preview);
    },
    []
  );

  const agregarArchivos = useCallback((archivos: File[]) => {
    setPendientes((prev) => [
      ...prev,
      ...archivos.map((file) => ({
        file,
        preview: URL.createObjectURL(file),
        id: crypto.randomUUID(),
      })),
    ]);
  }, []);

  function quitarPendiente(p: Pendiente) {
    URL.revokeObjectURL(p.preview);
    setPendientes((prev) => prev.filter((x) => x.id !== p.id));
  }

  function limpiar() {
    for (const p of pendientes) URL.revokeObjectURL(p.preview);
    setTitulo("");
    setDescripcion("");
    setUrlRef("");
    setPendientes([]);
    setNuevaSeccion("");
    // Sección, severidad, origen, asignado y fecha se mantienen: cargando en
    // tanda casi siempre se repiten.
    tituloRef.current?.focus();
  }

  async function guardar() {
    const t = titulo.trim();
    if (!t || guardando) return;
    setGuardando(true);
    setErr(null);
    try {
      // 1. Si se tipeó una sección nueva, se crea antes para poder referenciarla.
      let seccionFinal = seccionId;
      const nombreNuevo = nuevaSeccion.trim();
      if (nombreNuevo) {
        const resSec = await fetchWithSupabaseSession(`/api/proyectos/${projectId}/qa/secciones`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nombre: nombreNuevo }),
        });
        const jSec = (await resSec.json().catch(() => null)) as QAApiResp<QASeccion> | null;
        if (!resSec.ok || !jSec?.success || !jSec.data) {
          setErr(jSec?.error ?? "No se pudo crear la sección");
          return;
        }
        onSeccionCreada(jSec.data);
        seccionFinal = jSec.data.id;
        setSeccionId(jSec.data.id);
        setNuevaSeccion("");
      }

      // 2. La observación.
      const res = await fetchWithSupabaseSession(`/api/proyectos/${projectId}/qa/observaciones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ronda,
          titulo: t,
          descripcion: descripcion.trim() || null,
          seccion_id: seccionFinal || null,
          severidad,
          origen,
          asignado_a: asignadoA || null,
          fecha_limite: fechaLimite || null,
          url_referencia: urlRef.trim() || null,
        }),
      });
      const j = (await res.json().catch(() => null)) as QAApiResp<QAObservacion> | null;
      if (!res.ok || !j?.success || !j.data) {
        setErr(j?.error ?? "No se pudo cargar la observación");
        return;
      }
      const creada = j.data;

      // 3. Recién ahora se pueden subir las capturas.
      const subidos: QAArchivo[] = [];
      for (const p of pendientes) {
        const form = new FormData();
        form.append("file", p.file);
        const resA = await fetchWithSupabaseSession(
          `/api/proyectos/${projectId}/qa/observaciones/${creada.id}/archivos`,
          { method: "POST", body: form }
        );
        const jA = (await resA.json().catch(() => null)) as QAApiResp<QAArchivo> | null;
        if (resA.ok && jA?.success && jA.data) subidos.push(jA.data);
        else setErr(jA?.error ?? `No se pudo subir "${p.file.name}"`);
      }

      onCreada({ ...creada, archivos: [...creada.archivos, ...subidos] });
      setAvisoAlta(`QA-${String(creada.numero).padStart(3, "0")} cargada`);
      window.setTimeout(() => setAvisoAlta(null), 2500);
      limpiar();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-[#4FAEB2]/40 bg-[#4FAEB2]/5 p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <span className="h-4 w-1 rounded-full bg-[#4FAEB2]" />
        <h3 className="text-sm font-semibold text-slate-900">Nueva observación</h3>
        {avisoAlta ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            {avisoAlta}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onCerrar}
          className="ml-auto rounded-lg px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-white hover:text-slate-800"
        >
          Cerrar
        </button>
      </div>

      <input
        ref={tituloRef}
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void guardar();
          }
        }}
        placeholder="Qué hay que ajustar…"
        className={`${INPUT_CLS} text-base font-medium`}
      />

      <textarea
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void guardar();
          }
        }}
        rows={2}
        placeholder="Detalle (opcional). Pegá la captura acá con Ctrl/Cmd+V."
        className={`${INPUT_CLS} min-h-[60px] resize-y`}
      />

      {/* Capturas pendientes de subida. */}
      {pendientes.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {pendientes.map((p) => (
            <li key={p.id} className="group relative">
              <span className="block h-16 w-16 overflow-hidden rounded-lg border border-slate-200 bg-white">
                {p.file.type.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.preview} alt={p.file.name} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center px-1 text-[9px] text-slate-500">
                    {p.file.name.slice(-12)}
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => quitarPendiente(p)}
                aria-label={`Quitar ${p.file.name}`}
                className="absolute -right-1.5 -top-1.5 rounded-full bg-white p-1 text-slate-400 shadow-sm transition-colors hover:text-rose-600"
              >
                <IconTrash size={11} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <QAImageDropzone
        id="composer"
        capturarPaste
        compacto
        onArchivos={agregarArchivos}
        subiendo={0}
      />

      {/* Todo lo que define la observación, sin abrir nada más. */}
      <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {/* La sección ocupa dos columnas: son dos controles (elegir o crear). */}
        <div className="sm:col-span-2">
          <span className={LABEL_CLS}>Sección</span>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
            <div className="min-w-0 flex-1">
              <FiltroSelect
                etiqueta="Sección"
                valor={seccionId}
                activo={seccionId !== ""}
                bloque
                onChange={(v) => {
                  setNuevaSeccion("");
                  setSeccionId(v);
                }}
              >
                <option value="">Sin sección</option>
                {secciones.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </FiltroSelect>
            </div>
            <span className="shrink-0 text-xs text-slate-400">o</span>
            <input
              value={nuevaSeccion}
              onChange={(e) => {
                setNuevaSeccion(e.target.value);
                if (e.target.value.trim()) setSeccionId("");
              }}
              placeholder="crear una nueva…"
              className={`${INPUT_CLS} min-w-0 flex-1 py-2`}
            />
          </div>
        </div>

        <div>
          <span className={LABEL_CLS}>Severidad</span>
          <div className="mt-1">
            <FiltroSelect
              etiqueta="Severidad"
              valor={severidad}
              activo={severidad === "bloqueante" || severidad === "alta"}
              bloque
              onChange={(v) => setSeveridad(v as QAObservacionSeveridad)}
            >
              {QA_SEVERIDADES.map((s) => (
                <option key={s.codigo} value={s.codigo}>
                  {s.label}
                </option>
              ))}
            </FiltroSelect>
          </div>
        </div>

        <div>
          <span className={LABEL_CLS}>Origen</span>
          <div className="mt-1">
            <FiltroSelect
              etiqueta="Origen"
              valor={origen}
              activo={origen === "cliente"}
              bloque
              onChange={(v) => setOrigen(v as QAObservacionOrigen)}
            >
              {QA_ORIGENES.map((o) => (
                <option key={o.codigo} value={o.codigo}>
                  {o.label}
                </option>
              ))}
            </FiltroSelect>
          </div>
        </div>

        <div>
          <span className={LABEL_CLS}>Asignada a</span>
          <div className="mt-1">
            <FiltroSelect
              etiqueta="Asignada a"
              valor={asignadoA}
              activo={asignadoA !== ""}
              bloque
              onChange={setAsignadoA}
            >
              <option value="">Sin asignar</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {(u.nombre ?? "").trim() || (u.email ?? "").trim() || "Usuario"}
                </option>
              ))}
            </FiltroSelect>
          </div>
        </div>

        <div>
          <span className={LABEL_CLS}>Fecha límite</span>
          <FechaSelect
            value={fechaLimite}
            onChange={(e) => setFechaLimite(e.target.value)}
            className={`${INPUT_CLS} mt-1 py-2`}
/>
        </div>

        <div>
          <span className={LABEL_CLS}>URL de referencia</span>
          <input
            value={urlRef}
            onChange={(e) => setUrlRef(e.target.value)}
            placeholder="https://…"
            className={`${INPUT_CLS} mt-1 py-2`}
          />
        </div>
      </div>

      {err ? <p className="text-xs text-rose-600">{err}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void guardar()}
          disabled={!titulo.trim() || guardando}
          className={BTN_PRIMARY_CLS}
        >
          <IconPlus />
          {guardando ? "Cargando…" : "Cargar observación"}
        </button>
        <button type="button" onClick={limpiar} className={BTN_GHOST_CLS}>
          Limpiar
        </button>
        <span className="text-[11px] text-slate-500">
          <kbd className="rounded border border-slate-300 bg-white px-1">Enter</kbd> guarda y deja el
          formulario listo para la siguiente.
        </span>
      </div>
    </div>
  );
}
