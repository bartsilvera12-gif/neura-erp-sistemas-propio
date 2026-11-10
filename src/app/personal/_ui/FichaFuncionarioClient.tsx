"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, Briefcase, Calendar, CalendarCheck, CalendarClock, CircleDot, Clock,
  Download, FileText, Plus, Trash2, Trophy, Upload, UserRound, X,
} from "lucide-react";
import { apiPersonal, subirDocumento, fechaCorta, tamanoLegible } from "./api";
import { Select, Campo, EmptyState } from "./compartido";
import AsistenciaTab from "./tabs/AsistenciaTab";
import VacacionesTab from "./tabs/VacacionesTab";
import DesempenoTab from "./tabs/DesempenoTab";
import HistorialTab from "./tabs/HistorialTab";
import {
  ESTADO_INCIDENCIA_META, TIPO_INCIDENCIA_META, TIPOS_INCIDENCIA, ESTADOS_INCIDENCIA,
  type DocumentoDTO, type FichaFuncionario, type FuncionarioResumen, type IncidenciaDTO, type TipoIncidencia, type EstadoIncidencia,
} from "@/lib/personal/types";

const TABS = [
  { key: "datos", label: "Datos y contrato", icon: UserRound },
  { key: "asistencia", label: "Asistencia", icon: CalendarCheck },
  { key: "incidencias", label: "Incidencias", icon: AlertTriangle },
  { key: "desempeno", label: "Desempeño", icon: CircleDot },
  { key: "vacaciones", label: "Vacaciones", icon: CalendarClock },
  { key: "documentos", label: "Documentos", icon: FileText },
  { key: "historial", label: "Historial", icon: Clock },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-px text-[11px] font-semibold ring-1 ring-inset ${className ?? ""}`}>{children}</span>;
}

function IconoTipo({ tipo, className }: { tipo: TipoIncidencia; className?: string }) {
  const m = TIPO_INCIDENCIA_META[tipo].icono;
  const C = m === "reloj" ? Clock : m === "trofeo" ? Trophy : m === "ausencia" ? CalendarCheck : AlertTriangle;
  return <C className={className} aria-hidden />;
}

function KpiCard({ icon: Icon, label, valor, color }: { icon: typeof Clock; label: string; valor: string; color: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${color}`}><Icon className="h-5 w-5" aria-hidden /></span>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
        <p className="text-xl font-bold leading-tight text-slate-900">{valor}</p>
      </div>
    </div>
  );
}

function Placeholder({ titulo }: { titulo: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-14 text-center">
      <p className="text-sm font-semibold text-slate-500">{titulo}</p>
      <p className="mt-1 text-[13px] text-slate-400">Disponible en una próxima fase del módulo.</p>
    </div>
  );
}

export default function FichaFuncionarioClient({ id }: { id: string }) {
  const [ficha, setFicha] = useState<FichaFuncionario | null>(null);
  const [tab, setTab] = useState<TabKey>("datos");
  const [error, setError] = useState<string | null>(null);

  const cargarFicha = useCallback(async () => {
    try {
      const d = await apiPersonal<{ ficha: FichaFuncionario }>(`/api/personal/${id}`);
      setFicha(d.ficha);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar");
    }
  }, [id]);

  useEffect(() => { void cargarFicha(); }, [cargarFicha]);

  if (error) return <div className="mx-auto max-w-6xl p-6"><div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div></div>;
  if (!ficha) return <div className="py-24 text-center text-sm text-slate-400">Cargando…</div>;

  const ini = ficha.nombre.trim().split(/\s+/).slice(0, 2).map((p) => p[0] ?? "").join("").toUpperCase() || "?";
  const activo = (ficha.estado ?? "").toLowerCase() === "activo";

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="mb-3 flex items-center gap-1.5 text-[13px] text-slate-400">
        <Link href="/personal" className="inline-flex items-center gap-1 hover:text-[#2F8E92]"><ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Gestión de Personal</Link>
        <span>›</span><span className="text-slate-500">Ficha del funcionario</span>
      </div>

      {/* Header + KPIs */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-[#4FAEB2] to-[#2F8E92] text-xl font-bold text-white">{ini}</span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-slate-900">{ficha.nombre}</h1>
                <Chip className={activo ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-100 text-slate-500 ring-slate-200"}>{ficha.estado ?? "—"}</Chip>
              </div>
              <p className="text-[13.5px] text-slate-500">{[ficha.cargo, ficha.area].filter(Boolean).join(" · ") || "Sin cargo"}</p>
              <p className="mt-0.5 text-[12.5px] text-slate-400">
                {ficha.codigo_empleado ? <>Código <span className="font-semibold text-slate-500">{ficha.codigo_empleado}</span> · </> : null}
                Ingreso <span className="font-semibold text-slate-500">{fechaCorta(ficha.fecha_ingreso)}</span>
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:w-auto">
            <KpiCard icon={CalendarCheck} label="Asistencia" valor={ficha.kpis.asistencia != null ? `${ficha.kpis.asistencia}%` : "—"} color="bg-emerald-50 text-emerald-600" />
            <KpiCard icon={Clock} label="Llegadas tardías" valor={String(ficha.kpis.llegadas_tardias)} color="bg-amber-50 text-amber-600" />
            <KpiCard icon={AlertTriangle} label="Incidencias" valor={String(ficha.kpis.incidencias)} color="bg-rose-50 text-rose-600" />
            <KpiCard icon={Trophy} label="Reconocimientos" valor={String(ficha.kpis.reconocimientos)} color="bg-sky-50 text-sky-600" />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((t) => {
          const sel = tab === t.key;
          return (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13.5px] font-medium transition ${sel ? "border-[#2F8E92] text-[#2F8E92]" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
              <t.icon className="h-4 w-4" aria-hidden /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Contenido + sidebar */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          {tab === "incidencias" ? <IncidenciasTab id={id} onCambio={cargarFicha} /> :
           tab === "datos" ? <DatosTab ficha={ficha} onGuardado={cargarFicha} /> :
           tab === "asistencia" ? <AsistenciaTab id={id} onCambio={cargarFicha} /> :
           tab === "vacaciones" ? <VacacionesTab id={id} onCambio={cargarFicha} /> :
           tab === "desempeno" ? <DesempenoTab id={id} onCambio={cargarFicha} /> :
           tab === "historial" ? <HistorialTab id={id} /> :
           tab === "documentos" ? <DocumentosPanel id={id} grande /> :
           <Placeholder titulo={TABS.find((t) => t.key === tab)?.label ?? ""} />}
        </div>
        <aside className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 text-[13px] font-bold text-slate-900"><Briefcase className="h-4 w-4 text-[#2F8E92]" aria-hidden /> Información del cargo</h3>
            <dl className="space-y-2 text-[13px]">
              <Dato label="Área" valor={ficha.area} />
              <Dato label="Cargo" valor={ficha.cargo} />
              <Dato label="Supervisor" valor={ficha.supervisor?.nombre ?? null} />
              <Dato label="Modalidad" valor={ficha.modalidad} />
              <Dato label="Estado" valor={ficha.estado} chip={activo ? "emerald" : "slate"} />
            </dl>
          </div>
          <DocumentosPanel id={id} />
        </aside>
      </div>
    </div>
  );
}

function Dato({ label, valor, chip }: { label: string; valor: string | null | undefined; chip?: "emerald" | "slate" }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-400">{label}:</dt>
      {chip ? (
        <Chip className={chip === "emerald" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-100 text-slate-500 ring-slate-200"}>{valor ?? "—"}</Chip>
      ) : (
        <dd className="truncate text-right font-medium text-slate-700">{valor || "—"}</dd>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- Incidencias */
function IncidenciasTab({ id, onCambio }: { id: string; onCambio: () => void }) {
  const [lista, setLista] = useState<IncidenciaDTO[] | null>(null);
  const [tipo, setTipo] = useState("todos");
  const [estado, setEstado] = useState("todos");
  const [periodo, setPeriodo] = useState("12m");
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ tipo, estado, periodo }).toString();
      const d = await apiPersonal<{ incidencias: IncidenciaDTO[] }>(`/api/personal/${id}/incidencias?${qs}`);
      setLista(d.incidencias);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo cargar"); }
  }, [id, tipo, estado, periodo]);
  useEffect(() => { void cargar(); }, [cargar]);

  const eliminar = async (incId: string) => {
    if (!window.confirm("¿Eliminar esta incidencia? No se puede deshacer.")) return;
    try {
      await apiPersonal(`/api/personal/${id}/incidencias/${incId}`, { method: "DELETE" });
      await Promise.all([cargar(), Promise.resolve(onCambio())]);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo eliminar"); }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600"><AlertTriangle className="h-5 w-5" aria-hidden /></span>
          <div>
            <h3 className="text-[15px] font-bold text-slate-900">Incidencias y observaciones</h3>
            <p className="text-[12.5px] text-slate-500">Registro de ausencias, llegadas tardías, amonestaciones, suspensiones y reconocimientos.</p>
          </div>
        </div>
        <button type="button" onClick={() => setModal(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#3F8E91]">
          <Plus className="h-4 w-4" aria-hidden /> Registrar
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2.5">
        <Campo label="Tipo" className="w-44">
          <Select size="sm" value={tipo} onChange={setTipo} options={[{ value: "todos", label: "Todos" }, ...TIPOS_INCIDENCIA.map((t) => ({ value: t, label: TIPO_INCIDENCIA_META[t].label }))]} />
        </Campo>
        <Campo label="Estado" className="w-40">
          <Select size="sm" value={estado} onChange={setEstado} options={[{ value: "todos", label: "Todos" }, ...ESTADOS_INCIDENCIA.map((s) => ({ value: s, label: ESTADO_INCIDENCIA_META[s].label }))]} />
        </Campo>
        <Campo label="Período" className="w-44">
          <Select size="sm" value={periodo} onChange={setPeriodo} options={[
            { value: "3m", label: "Últimos 3 meses" }, { value: "6m", label: "Últimos 6 meses" },
            { value: "12m", label: "Últimos 12 meses" }, { value: "24m", label: "Últimos 24 meses" }, { value: "todos", label: "Todo" },
          ]} />
        </Campo>
      </div>

      {error ? <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</div> : null}

      <div className="mt-3 overflow-x-auto">
        {lista == null ? <p className="py-8 text-center text-[13px] text-slate-400">Cargando…</p> :
         lista.length === 0 ? <EmptyState icon={AlertTriangle} titulo="Sin incidencias en el período" descripcion="Registrá llegadas tardías, amonestaciones o reconocimientos con el botón Registrar." /> : (
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3">Fecha</th><th className="py-2 pr-3">Tipo</th><th className="py-2 pr-3">Descripción</th>
                <th className="py-2 pr-3">Estado</th><th className="py-2 pr-3">Registrado por</th><th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((i) => (
                <tr key={i.id} className="border-b border-slate-50 last:border-0">
                  <td className="whitespace-nowrap py-2.5 pr-3 text-slate-500">{fechaCorta(i.fecha)}</td>
                  <td className="py-2.5 pr-3">
                    <Chip className={TIPO_INCIDENCIA_META[i.tipo].chip}><IconoTipo tipo={i.tipo} className="mr-1 h-3 w-3" /> {TIPO_INCIDENCIA_META[i.tipo].label}</Chip>
                  </td>
                  <td className="py-2.5 pr-3 text-slate-700">{i.descripcion}</td>
                  <td className="py-2.5 pr-3"><Chip className={ESTADO_INCIDENCIA_META[i.estado].chip}>{ESTADO_INCIDENCIA_META[i.estado].label}</Chip></td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-slate-500">{i.registrado_por ?? "—"}</td>
                  <td className="py-2.5 text-right">
                    <button type="button" onClick={() => void eliminar(i.id)} className="rounded p-1 text-slate-300 transition hover:bg-rose-50 hover:text-rose-600" aria-label="Eliminar" title="Eliminar">
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal ? <RegistrarIncidenciaModal id={id} onCerrar={() => setModal(false)} onCreado={() => { setModal(false); void cargar(); onCambio(); }} /> : null}
    </div>
  );
}

function RegistrarIncidenciaModal({ id, onCerrar, onCreado }: { id: string; onCerrar: () => void; onCreado: () => void }) {
  const hoy = new Date().toISOString().slice(0, 10);
  const [tipo, setTipo] = useState<TipoIncidencia>("llegada_tardia");
  const [estado, setEstado] = useState<EstadoIncidencia>("finalizada");
  const [fecha, setFecha] = useState(hoy);
  const [descripcion, setDescripcion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);

  const guardar = async () => {
    if (!descripcion.trim()) { setError("Escribí una descripción"); return; }
    setGuardando(true); setError(null);
    try {
      await apiPersonal(`/api/personal/${id}/incidencias`, { method: "POST", json: { tipo, estado, fecha, descripcion: descripcion.trim() } });
      onCreado();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo registrar"); setGuardando(false); }
  };

  const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";
  const cuerpo = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h4 className="text-[15px] font-bold text-slate-900">Registrar incidencia</h4>
          <button type="button" onClick={onCerrar} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Cerrar"><X className="h-4 w-4" aria-hidden /></button>
        </div>
        <div className="space-y-3 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12px] font-semibold text-slate-500">Tipo
              <Select className="mt-1 w-full" value={tipo} onChange={(v) => setTipo(v as TipoIncidencia)} options={TIPOS_INCIDENCIA.map((t) => ({ value: t, label: TIPO_INCIDENCIA_META[t].label }))} />
            </label>
            <label className="block text-[12px] font-semibold text-slate-500">Fecha
              <input type="date" className={`${inputCls} mt-1`} value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} />
            </label>
          </div>
          <label className="block text-[12px] font-semibold text-slate-500">Estado
            <Select className="mt-1 w-full" value={estado} onChange={(v) => setEstado(v as EstadoIncidencia)} options={ESTADOS_INCIDENCIA.map((s) => ({ value: s, label: ESTADO_INCIDENCIA_META[s].label }))} />
          </label>
          <label className="block text-[12px] font-semibold text-slate-500">Descripción
            <textarea className={`${inputCls} mt-1 min-h-24`} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej.: Ingreso a las 08:27 (27 min de atraso)" autoFocus />
          </label>
          {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p> : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={onCerrar} disabled={guardando} className="rounded-lg px-3.5 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={() => void guardar()} disabled={guardando || !descripcion.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#3F8E91] disabled:opacity-50">
            <Plus className="h-4 w-4" aria-hidden /> {guardando ? "Guardando…" : "Registrar"}
          </button>
        </div>
      </div>
    </div>
  );
  if (!montado) return null;
  return createPortal(cuerpo, document.body);
}

/* ------------------------------------------------------------------- Datos tab */
const MODALIDADES = ["Tiempo completo", "Medio tiempo", "Por horas", "Remoto", "Híbrido", "Pasantía"];

function DatosTab({ ficha, onGuardado }: { ficha: FichaFuncionario; onGuardado: () => void }) {
  const [edit, setEdit] = useState(false);
  const [codigo, setCodigo] = useState(ficha.codigo_empleado ?? "");
  const [cargo, setCargo] = useState(ficha.cargo ?? "");
  const [modalidad, setModalidad] = useState(ficha.modalidad ?? "");
  const [area, setArea] = useState(ficha.area ?? "");
  const [supervisorId, setSupervisorId] = useState(ficha.supervisor?.id ?? "");
  const [diasVac, setDiasVac] = useState(ficha.dias_vacaciones_anuales != null ? String(ficha.dias_vacaciones_anuales) : "");
  const [colegas, setColegas] = useState<{ id: string; nombre: string }[]>([]);
  const [areasDisp, setAreasDisp] = useState<string[]>([]);
  const [areaManual, setAreaManual] = useState(false);
  const [cargado, setCargado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!edit || cargado) return;
    apiPersonal<{ funcionarios: FuncionarioResumen[] }>("/api/personal")
      .then((d) => {
        setColegas(d.funcionarios.filter((f) => f.id !== ficha.id).map((f) => ({ id: f.id, nombre: f.nombre })));
        const vistas = new Map<string, string>();
        for (const f of d.funcionarios) { const a = (f.area ?? "").trim(); if (a) vistas.set(a.toLowerCase(), a); }
        setAreasDisp([...vistas.values()].sort((a, b) => a.localeCompare(b, "es")));
        setCargado(true);
      })
      .catch(() => setCargado(true));
  }, [edit, cargado, ficha.id]);

  const guardar = async () => {
    setGuardando(true); setError(null);
    try {
      await apiPersonal(`/api/personal/${ficha.id}`, {
        method: "PATCH",
        json: {
          codigo_empleado: codigo, cargo, modalidad, area,
          supervisor_id: supervisorId || null,
          dias_vacaciones_anuales: diasVac === "" ? null : Number(diasVac),
        },
      });
      setEdit(false); onGuardado();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar"); } finally { setGuardando(false); }
  };

  const modalidadOpts = [
    ...(modalidad && !MODALIDADES.includes(modalidad) ? [{ value: modalidad, label: modalidad }] : []),
    { value: "", label: "— Sin definir —" },
    ...MODALIDADES.map((m) => ({ value: m, label: m })),
  ];
  const supervisorOpts = [{ value: "", label: "— Sin supervisor —" }, ...colegas.map((c) => ({ value: c.id, label: c.nombre }))];
  const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const areaConocida = !area || areasDisp.some((a) => a.toLowerCase() === area.toLowerCase());
  const areaOpts = [
    { value: "", label: "— Sin área —" },
    ...(area && !areaConocida ? [{ value: area, label: cap(area) }] : []),
    ...areasDisp.map((a) => ({ value: a, label: cap(a) })),
    { value: "__otra__", label: "Otra área…" },
  ];

  const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[15px] font-bold text-slate-900">Datos y contrato</h3>
        {!edit ? <button type="button" onClick={() => setEdit(true)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] font-semibold text-slate-600 hover:bg-slate-50">Editar</button> : null}
      </div>
      {!edit ? (
        <dl className="grid gap-x-8 gap-y-3 text-[13.5px] sm:grid-cols-2">
          <Dato label="Nombre" valor={ficha.nombre} />
          <Dato label="Código de empleado" valor={ficha.codigo_empleado} />
          <Dato label="Email" valor={ficha.email} />
          <Dato label="Teléfono" valor={ficha.telefono} />
          <Dato label="Cargo" valor={ficha.cargo} />
          <Dato label="Área" valor={ficha.area} />
          <Dato label="Modalidad" valor={ficha.modalidad} />
          <Dato label="Supervisor" valor={ficha.supervisor?.nombre ?? null} />
          <Dato label="Tipo de contrato" valor={ficha.tipo_contrato} />
          <Dato label="Cupo de vacaciones" valor={ficha.dias_vacaciones_anuales != null ? `${ficha.dias_vacaciones_anuales} días/año` : "12 días/año (por defecto)"} />
          <Dato label="Fecha de ingreso" valor={fechaCorta(ficha.fecha_ingreso)} />
          <Dato label="Fecha de nacimiento" valor={fechaCorta(ficha.fecha_nacimiento)} />
          <Dato label="Rol del sistema" valor={ficha.rol} />
        </dl>
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Campo label="Código de empleado"><input className={inputCls} value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ej.: EMP-014" /></Campo>
          <Campo label="Cargo"><input className={inputCls} value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Ej.: Project Manager" /></Campo>
          <Campo label="Área">
            {areaManual ? (
              <div className="flex items-center gap-1.5">
                <input className={inputCls} value={area} onChange={(e) => setArea(e.target.value)} placeholder="Nueva área" autoFocus />
                <button type="button" onClick={() => setAreaManual(false)} className="shrink-0 rounded-lg px-2.5 py-2 text-[12px] font-semibold text-slate-500 hover:bg-slate-100" title="Elegir de la lista">Lista</button>
              </div>
            ) : (
              <Select className="w-full" value={area} placeholder="Elegí un área"
                onChange={(v) => { if (v === "__otra__") { setArea(""); setAreaManual(true); } else setArea(v); }}
                options={areaOpts} />
            )}
          </Campo>
          <Campo label="Modalidad"><Select className="w-full" value={modalidad} onChange={setModalidad} options={modalidadOpts} placeholder="Elegí una modalidad" /></Campo>
          <Campo label="Supervisor"><Select className="w-full" value={supervisorId} onChange={setSupervisorId} options={supervisorOpts} placeholder="Elegí un supervisor" /></Campo>
          <Campo label="Cupo de vacaciones (días/año)"><input type="number" min={0} max={60} className={inputCls} value={diasVac} onChange={(e) => setDiasVac(e.target.value)} placeholder="12" /></Campo>
          {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700 sm:col-span-2">{error}</p> : null}
          <div className="flex items-center gap-2 sm:col-span-2">
            <button type="button" onClick={() => void guardar()} disabled={guardando} className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50">{guardando ? "Guardando…" : "Guardar"}</button>
            <button type="button" onClick={() => setEdit(false)} disabled={guardando} className="rounded-lg px-3.5 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100">Cancelar</button>
          </div>
        </div>
      )}
      <p className="mt-4 text-[11.5px] text-slate-400"><Calendar className="mr-1 inline h-3 w-3" aria-hidden />Los datos personales (nombre, email, contrato) se editan desde el módulo Usuarios; acá se gestionan los campos de RRHH.</p>
    </div>
  );
}

/* ------------------------------------------------------------------- Documentos */
function DocumentosPanel({ id, grande }: { id: string; grande?: boolean }) {
  const [docs, setDocs] = useState<DocumentoDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    try { setDocs((await apiPersonal<{ documentos: DocumentoDTO[] }>(`/api/personal/${id}/documentos`)).documentos); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudieron cargar"); }
  }, [id]);
  useEffect(() => { void cargar(); }, [cargar]);

  const subir = async (file: File) => {
    setSubiendo(true); setError(null);
    try { await subirDocumento(id, file); await cargar(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo subir"); }
    finally { setSubiendo(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const eliminar = async (docId: string) => {
    if (!window.confirm("¿Eliminar este documento?")) return;
    try { await apiPersonal(`/api/personal/${id}/documentos/${docId}`, { method: "DELETE" }); await cargar(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo eliminar"); }
  };

  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${grande ? "" : ""}`}>
      <h3 className="mb-3 flex items-center gap-2 text-[13px] font-bold text-slate-900"><FileText className="h-4 w-4 text-[#2F8E92]" aria-hidden /> Documentos</h3>
      {error ? <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{error}</p> : null}
      <ul className="space-y-1.5">
        {docs == null ? <li className="py-3 text-center text-[12.5px] text-slate-400">Cargando…</li> :
         docs.length === 0 ? <li className="py-3 text-center text-[12.5px] text-slate-400">Sin documentos.</li> :
         docs.map((d) => (
          <li key={d.id} className="flex items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-1.5">
            <FileText className="h-4 w-4 shrink-0 text-rose-400" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-medium text-slate-700">{d.nombre}</p>
              {d.size_bytes ? <p className="text-[11px] text-slate-400">{tamanoLegible(d.size_bytes)}</p> : null}
            </div>
            {d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-[#2F8E92]" aria-label="Descargar" title="Descargar"><Download className="h-4 w-4" aria-hidden /></a> : null}
            <button type="button" onClick={() => void eliminar(d.id)} className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600" aria-label="Eliminar" title="Eliminar"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
          </li>
        ))}
      </ul>
      <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void subir(f); }} />
      <button type="button" onClick={() => fileRef.current?.click()} disabled={subiendo} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#4FAEB2]/40 bg-[#4FAEB2]/5 py-2 text-[13px] font-semibold text-[#2F8E92] transition hover:bg-[#4FAEB2]/10 disabled:opacity-50">
        <Upload className="h-4 w-4" aria-hidden /> {subiendo ? "Subiendo…" : "Subir documento"}
      </button>
    </div>
  );
}
