"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck, Plus, Trash2 } from "lucide-react";
import { apiPersonal, fechaCorta } from "../api";
import { Chip, Modal, SeccionCard, inputCls, btnPrimario, btnSecundario } from "../compartido";
import {
  ESTADO_ASISTENCIA_META, ESTADOS_ASISTENCIA,
  type AsistenciaDTO, type EstadoAsistencia, type ResumenAsistencia,
} from "@/lib/personal/types";

function mesActual(): string {
  return new Date().toISOString().slice(0, 7);
}

function MiniStat({ label, valor, color }: { label: string; valor: string; color: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-center">
      <p className={`text-lg font-bold leading-tight ${color}`}>{valor}</p>
      <p className="text-[11px] font-medium text-slate-400">{label}</p>
    </div>
  );
}

export default function AsistenciaTab({ id, onCambio }: { id: string; onCambio: () => void }) {
  const [mes, setMes] = useState(mesActual());
  const [lista, setLista] = useState<AsistenciaDTO[] | null>(null);
  const [resumen, setResumen] = useState<ResumenAsistencia | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const d = await apiPersonal<{ asistencias: AsistenciaDTO[]; resumen: ResumenAsistencia }>(`/api/personal/${id}/asistencia?mes=${mes}`);
      setLista(d.asistencias);
      setResumen(d.resumen);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo cargar"); }
  }, [id, mes]);
  useEffect(() => { void cargar(); }, [cargar]);

  const eliminar = async (asisId: string) => {
    if (!window.confirm("¿Eliminar esta marca de asistencia?")) return;
    try { await apiPersonal(`/api/personal/${id}/asistencia/${asisId}`, { method: "DELETE" }); await cargar(); onCambio(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo eliminar"); }
  };

  return (
    <SeccionCard
      icon={CalendarCheck}
      colorIcono="bg-emerald-50 text-emerald-600"
      titulo="Asistencia"
      subtitulo="Marca diaria de jornada: presentes, llegadas tardías, ausencias y permisos."
      accion={
        <div className="flex items-center gap-2">
          <input type="month" className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-700 outline-none focus:border-[#4FAEB2]" value={mes} max={mesActual()} onChange={(e) => setMes(e.target.value)} />
          <button type="button" onClick={() => setModal(true)} className={btnPrimario}><Plus className="h-4 w-4" aria-hidden /> Registrar</button>
        </div>
      }
    >
      {resumen ? (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
          <MiniStat label="% asistencia" valor={resumen.porcentaje != null ? `${resumen.porcentaje}%` : "—"} color="text-emerald-600" />
          <MiniStat label="Presentes" valor={String(resumen.presentes)} color="text-slate-800" />
          <MiniStat label="Tardes" valor={String(resumen.tardes)} color="text-amber-600" />
          <MiniStat label="Ausentes" valor={String(resumen.ausentes)} color="text-rose-600" />
          <MiniStat label="Justificadas" valor={String(resumen.justificadas)} color="text-sky-600" />
        </div>
      ) : null}

      {error ? <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</div> : null}

      <div className="mt-3 overflow-x-auto">
        {lista == null ? <p className="py-8 text-center text-[13px] text-slate-400">Cargando…</p> :
         lista.length === 0 ? <p className="py-8 text-center text-[13px] text-slate-400">Sin marcas en el mes. Usá “Registrar” para cargar la jornada.</p> : (
          <table className="w-full min-w-[620px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3">Fecha</th><th className="py-2 pr-3">Estado</th><th className="py-2 pr-3">Entrada</th>
                <th className="py-2 pr-3">Salida</th><th className="py-2 pr-3">Atraso</th><th className="py-2 pr-3">Observación</th><th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((a) => (
                <tr key={a.id} className="border-b border-slate-50 last:border-0">
                  <td className="whitespace-nowrap py-2.5 pr-3 text-slate-500">{fechaCorta(a.fecha)}</td>
                  <td className="py-2.5 pr-3"><Chip className={ESTADO_ASISTENCIA_META[a.estado].chip}>{ESTADO_ASISTENCIA_META[a.estado].label}</Chip></td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-slate-600">{a.hora_entrada?.slice(0, 5) ?? "—"}</td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-slate-600">{a.hora_salida?.slice(0, 5) ?? "—"}</td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-slate-600">{a.estado === "tarde" && a.minutos_tarde ? `${a.minutos_tarde} min` : "—"}</td>
                  <td className="py-2.5 pr-3 text-slate-600">{a.observacion ?? "—"}</td>
                  <td className="py-2.5 text-right">
                    <button type="button" onClick={() => void eliminar(a.id)} className="rounded p-1 text-slate-300 transition hover:bg-rose-50 hover:text-rose-600" aria-label="Eliminar" title="Eliminar"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal ? <RegistrarJornadaModal id={id} onCerrar={() => setModal(false)} onCreado={() => { setModal(false); void cargar(); onCambio(); }} /> : null}
    </SeccionCard>
  );
}

function RegistrarJornadaModal({ id, onCerrar, onCreado }: { id: string; onCerrar: () => void; onCreado: () => void }) {
  const hoy = new Date().toISOString().slice(0, 10);
  const [fecha, setFecha] = useState(hoy);
  const [estado, setEstado] = useState<EstadoAsistencia>("presente");
  const [entrada, setEntrada] = useState("");
  const [salida, setSalida] = useState("");
  const [minutos, setMinutos] = useState("");
  const [observacion, setObservacion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    setGuardando(true); setError(null);
    try {
      await apiPersonal(`/api/personal/${id}/asistencia`, {
        method: "POST",
        json: {
          fecha, estado,
          hora_entrada: entrada || undefined,
          hora_salida: salida || undefined,
          minutos_tarde: estado === "tarde" ? Number(minutos || 0) : 0,
          observacion: observacion.trim() || undefined,
        },
      });
      onCreado();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo registrar"); setGuardando(false); }
  };

  return (
    <Modal titulo="Registrar jornada" onCerrar={onCerrar} footer={
      <>
        <button type="button" onClick={onCerrar} disabled={guardando} className={btnSecundario}>Cancelar</button>
        <button type="button" onClick={() => void guardar()} disabled={guardando} className={btnPrimario}><Plus className="h-4 w-4" aria-hidden /> {guardando ? "Guardando…" : "Registrar"}</button>
      </>
    }>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-[12px] font-semibold text-slate-500">Fecha<input type="date" className={`${inputCls} mt-1`} value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} /></label>
        <label className="block text-[12px] font-semibold text-slate-500">Estado
          <select className={`${inputCls} mt-1`} value={estado} onChange={(e) => setEstado(e.target.value as EstadoAsistencia)}>
            {ESTADOS_ASISTENCIA.map((s) => <option key={s} value={s}>{ESTADO_ASISTENCIA_META[s].label}</option>)}
          </select>
        </label>
      </div>
      {(estado === "presente" || estado === "tarde") ? (
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-[12px] font-semibold text-slate-500">Entrada<input type="time" className={`${inputCls} mt-1`} value={entrada} onChange={(e) => setEntrada(e.target.value)} /></label>
          <label className="block text-[12px] font-semibold text-slate-500">Salida<input type="time" className={`${inputCls} mt-1`} value={salida} onChange={(e) => setSalida(e.target.value)} /></label>
        </div>
      ) : null}
      {estado === "tarde" ? (
        <label className="block text-[12px] font-semibold text-slate-500">Minutos de atraso<input type="number" min={0} className={`${inputCls} mt-1`} value={minutos} onChange={(e) => setMinutos(e.target.value)} placeholder="Ej.: 27" /></label>
      ) : null}
      <label className="block text-[12px] font-semibold text-slate-500">Observación<textarea className={`${inputCls} mt-1 min-h-16`} value={observacion} onChange={(e) => setObservacion(e.target.value)} placeholder="Opcional" /></label>
      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p> : null}
    </Modal>
  );
}
