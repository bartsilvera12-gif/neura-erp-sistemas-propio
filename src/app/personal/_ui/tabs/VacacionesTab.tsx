"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Check, Plus, Trash2, X as XIcon } from "lucide-react";
import { apiPersonal, fechaCorta } from "../api";
import { Chip, Modal, SeccionCard, inputCls, btnPrimario, btnSecundario } from "../compartido";
import {
  ESTADO_VACACION_META, TIPO_VACACION_META, TIPOS_VACACION,
  type EstadoVacacion, type SaldoVacaciones, type TipoVacacion, type VacacionDTO,
} from "@/lib/personal/types";

function MiniStat({ label, valor, color }: { label: string; valor: string; color: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-center">
      <p className={`text-lg font-bold leading-tight ${color}`}>{valor}</p>
      <p className="text-[11px] font-medium text-slate-400">{label}</p>
    </div>
  );
}

export default function VacacionesTab({ id, onCambio }: { id: string; onCambio: () => void }) {
  const [lista, setLista] = useState<VacacionDTO[] | null>(null);
  const [saldo, setSaldo] = useState<SaldoVacaciones | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const d = await apiPersonal<{ vacaciones: VacacionDTO[]; saldo: SaldoVacaciones }>(`/api/personal/${id}/vacaciones`);
      setLista(d.vacaciones); setSaldo(d.saldo);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo cargar"); }
  }, [id]);
  useEffect(() => { void cargar(); }, [cargar]);

  const cambiarEstado = async (vacId: string, estado: EstadoVacacion) => {
    try { await apiPersonal(`/api/personal/${id}/vacaciones/${vacId}`, { method: "PATCH", json: { estado } }); await cargar(); onCambio(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo actualizar"); }
  };
  const eliminar = async (vacId: string) => {
    if (!window.confirm("¿Eliminar esta solicitud?")) return;
    try { await apiPersonal(`/api/personal/${id}/vacaciones/${vacId}`, { method: "DELETE" }); await cargar(); onCambio(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo eliminar"); }
  };

  return (
    <SeccionCard
      icon={CalendarClock}
      colorIcono="bg-teal-50 text-teal-600"
      titulo="Vacaciones y permisos"
      subtitulo="Solicitudes con flujo de aprobación y saldo anual de vacaciones."
      accion={<button type="button" onClick={() => setModal(true)} className={btnPrimario}><Plus className="h-4 w-4" aria-hidden /> Nueva solicitud</button>}
    >
      {saldo ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MiniStat label={`Cupo ${saldo.anio}`} valor={`${saldo.anuales} d`} color="text-slate-800" />
          <MiniStat label="Aprobados" valor={`${saldo.aprobados} d`} color="text-emerald-600" />
          <MiniStat label="Gozados" valor={`${saldo.gozados} d`} color="text-sky-600" />
          <MiniStat label="Disponibles" valor={`${saldo.disponibles} d`} color="text-teal-600" />
        </div>
      ) : null}

      {error ? <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</div> : null}

      <div className="mt-3 overflow-x-auto">
        {lista == null ? <p className="py-8 text-center text-[13px] text-slate-400">Cargando…</p> :
         lista.length === 0 ? <p className="py-8 text-center text-[13px] text-slate-400">Sin solicitudes registradas.</p> : (
          <table className="w-full min-w-[680px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3">Tipo</th><th className="py-2 pr-3">Desde</th><th className="py-2 pr-3">Hasta</th>
                <th className="py-2 pr-3">Días</th><th className="py-2 pr-3">Motivo</th><th className="py-2 pr-3">Estado</th><th className="py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((v) => (
                <tr key={v.id} className="border-b border-slate-50 last:border-0">
                  <td className="py-2.5 pr-3 font-medium text-slate-700">{TIPO_VACACION_META[v.tipo].label}</td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-slate-500">{fechaCorta(v.fecha_inicio)}</td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-slate-500">{fechaCorta(v.fecha_fin)}</td>
                  <td className="py-2.5 pr-3 text-slate-600">{v.dias}</td>
                  <td className="py-2.5 pr-3 text-slate-600">{v.motivo ?? "—"}</td>
                  <td className="py-2.5 pr-3"><Chip className={ESTADO_VACACION_META[v.estado].chip}>{ESTADO_VACACION_META[v.estado].label}</Chip></td>
                  <td className="py-2.5 text-right">
                    <div className="inline-flex items-center gap-1">
                      {v.estado === "solicitada" ? (
                        <>
                          <button type="button" onClick={() => void cambiarEstado(v.id, "aprobada")} className="rounded p-1 text-emerald-500 hover:bg-emerald-50" aria-label="Aprobar" title="Aprobar"><Check className="h-4 w-4" aria-hidden /></button>
                          <button type="button" onClick={() => void cambiarEstado(v.id, "rechazada")} className="rounded p-1 text-rose-400 hover:bg-rose-50" aria-label="Rechazar" title="Rechazar"><XIcon className="h-4 w-4" aria-hidden /></button>
                        </>
                      ) : null}
                      {v.estado === "aprobada" ? (
                        <button type="button" onClick={() => void cambiarEstado(v.id, "gozada")} className="rounded px-2 py-0.5 text-[12px] font-semibold text-sky-600 hover:bg-sky-50" title="Marcar como gozada">Gozada</button>
                      ) : null}
                      <button type="button" onClick={() => void eliminar(v.id)} className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600" aria-label="Eliminar" title="Eliminar"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal ? <NuevaSolicitudModal id={id} onCerrar={() => setModal(false)} onCreado={() => { setModal(false); void cargar(); onCambio(); }} /> : null}
    </SeccionCard>
  );
}

function NuevaSolicitudModal({ id, onCerrar, onCreado }: { id: string; onCerrar: () => void; onCreado: () => void }) {
  const hoy = new Date().toISOString().slice(0, 10);
  const [tipo, setTipo] = useState<TipoVacacion>("vacaciones");
  const [ini, setIni] = useState(hoy);
  const [fin, setFin] = useState(hoy);
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    if (fin < ini) { setError("La fecha de fin no puede ser anterior al inicio"); return; }
    setGuardando(true); setError(null);
    try {
      await apiPersonal(`/api/personal/${id}/vacaciones`, { method: "POST", json: { tipo, fecha_inicio: ini, fecha_fin: fin, motivo: motivo.trim() || undefined } });
      onCreado();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo registrar"); setGuardando(false); }
  };

  return (
    <Modal titulo="Nueva solicitud" onCerrar={onCerrar} footer={
      <>
        <button type="button" onClick={onCerrar} disabled={guardando} className={btnSecundario}>Cancelar</button>
        <button type="button" onClick={() => void guardar()} disabled={guardando} className={btnPrimario}><Plus className="h-4 w-4" aria-hidden /> {guardando ? "Guardando…" : "Solicitar"}</button>
      </>
    }>
      <label className="block text-[12px] font-semibold text-slate-500">Tipo
        <select className={`${inputCls} mt-1`} value={tipo} onChange={(e) => setTipo(e.target.value as TipoVacacion)}>
          {TIPOS_VACACION.map((t) => <option key={t} value={t}>{TIPO_VACACION_META[t].label}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-[12px] font-semibold text-slate-500">Desde<input type="date" className={`${inputCls} mt-1`} value={ini} onChange={(e) => setIni(e.target.value)} /></label>
        <label className="block text-[12px] font-semibold text-slate-500">Hasta<input type="date" className={`${inputCls} mt-1`} value={fin} min={ini} onChange={(e) => setFin(e.target.value)} /></label>
      </div>
      <p className="text-[11.5px] text-slate-400">Los días se calculan por días hábiles (lun–vie) del rango.</p>
      <label className="block text-[12px] font-semibold text-slate-500">Motivo<textarea className={`${inputCls} mt-1 min-h-16`} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Opcional" /></label>
      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p> : null}
    </Modal>
  );
}
