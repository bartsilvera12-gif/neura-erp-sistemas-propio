"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleDot, Plus, Star, Trash2 } from "lucide-react";
import { apiPersonal, fechaCorta } from "../api";
import { Chip, Modal, SeccionCard, inputCls, btnPrimario, btnSecundario } from "../compartido";
import type { Competencia, EvaluacionDTO } from "@/lib/personal/types";

function Estrellas({ puntaje }: { puntaje: number | null }) {
  if (puntaje == null) return <span className="text-[13px] text-slate-400">Sin puntaje</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-flex">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star key={n} className={`h-3.5 w-3.5 ${n <= Math.round(puntaje) ? "fill-amber-400 text-amber-400" : "text-slate-200"}`} aria-hidden />
        ))}
      </span>
      <span className="text-[13px] font-semibold text-slate-700">{puntaje.toFixed(1)}</span>
    </span>
  );
}

export default function DesempenoTab({ id, onCambio }: { id: string; onCambio: () => void }) {
  const [lista, setLista] = useState<EvaluacionDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState(false);

  const cargar = useCallback(async () => {
    try { setLista((await apiPersonal<{ evaluaciones: EvaluacionDTO[] }>(`/api/personal/${id}/desempeno`)).evaluaciones); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo cargar"); }
  }, [id]);
  useEffect(() => { void cargar(); }, [cargar]);

  const eliminar = async (evalId: string) => {
    if (!window.confirm("¿Eliminar esta evaluación?")) return;
    try { await apiPersonal(`/api/personal/${id}/desempeno/${evalId}`, { method: "DELETE" }); await cargar(); onCambio(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo eliminar"); }
  };

  return (
    <SeccionCard
      icon={CircleDot}
      colorIcono="bg-indigo-50 text-indigo-600"
      titulo="Evaluaciones de desempeño"
      subtitulo="Puntaje por competencias, fortalezas y oportunidades de mejora por período."
      accion={<button type="button" onClick={() => setModal(true)} className={btnPrimario}><Plus className="h-4 w-4" aria-hidden /> Nueva evaluación</button>}
    >
      {error ? <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</div> : null}

      <div className="mt-3 space-y-3">
        {lista == null ? <p className="py-8 text-center text-[13px] text-slate-400">Cargando…</p> :
         lista.length === 0 ? <p className="py-8 text-center text-[13px] text-slate-400">Sin evaluaciones registradas.</p> :
         lista.map((ev) => (
          <div key={ev.id} className="rounded-xl border border-slate-200 bg-white p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-[14px] font-bold text-slate-900">{ev.periodo}</h4>
                  {ev.estado === "borrador" ? <Chip className="bg-slate-100 text-slate-500 ring-slate-200">Borrador</Chip> : null}
                </div>
                <p className="text-[12px] text-slate-400">{fechaCorta(ev.fecha)}{ev.evaluador ? ` · por ${ev.evaluador}` : ""}</p>
              </div>
              <div className="flex items-center gap-2">
                <Estrellas puntaje={ev.puntaje} />
                <button type="button" onClick={() => void eliminar(ev.id)} className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600" aria-label="Eliminar" title="Eliminar"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
              </div>
            </div>
            {ev.competencias.length ? (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {ev.competencias.map((c, i) => (
                  <Chip key={i} className="bg-indigo-50 text-indigo-700 ring-indigo-200">{c.nombre}: {c.puntaje.toFixed(1)}</Chip>
                ))}
              </div>
            ) : null}
            {(ev.fortalezas || ev.mejoras || ev.comentario) ? (
              <div className="mt-2.5 grid gap-2 text-[13px] sm:grid-cols-2">
                {ev.fortalezas ? <div><p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Fortalezas</p><p className="text-slate-600">{ev.fortalezas}</p></div> : null}
                {ev.mejoras ? <div><p className="text-[11px] font-semibold uppercase tracking-wide text-amber-600">A mejorar</p><p className="text-slate-600">{ev.mejoras}</p></div> : null}
                {ev.comentario ? <div className="sm:col-span-2"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Comentario</p><p className="text-slate-600">{ev.comentario}</p></div> : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {modal ? <NuevaEvaluacionModal id={id} onCerrar={() => setModal(false)} onCreado={() => { setModal(false); void cargar(); onCambio(); }} /> : null}
    </SeccionCard>
  );
}

const COMPETENCIAS_SUGERIDAS = ["Responsabilidad", "Trabajo en equipo", "Calidad", "Proactividad", "Comunicación", "Puntualidad"];

function NuevaEvaluacionModal({ id, onCerrar, onCreado }: { id: string; onCerrar: () => void; onCreado: () => void }) {
  const [periodo, setPeriodo] = useState("");
  const [competencias, setCompetencias] = useState<Competencia[]>(COMPETENCIAS_SUGERIDAS.slice(0, 4).map((nombre) => ({ nombre, puntaje: 3 })));
  const [fortalezas, setFortalezas] = useState("");
  const [mejoras, setMejoras] = useState("");
  const [comentario, setComentario] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setComp = (i: number, patch: Partial<Competencia>) => setCompetencias((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const quitar = (i: number) => setCompetencias((cs) => cs.filter((_, j) => j !== i));
  const agregar = () => setCompetencias((cs) => [...cs, { nombre: "", puntaje: 3 }]);

  const promedio = competencias.length ? competencias.reduce((s, c) => s + c.puntaje, 0) / competencias.length : null;

  const guardar = async () => {
    if (!periodo.trim()) { setError("Indicá el período"); return; }
    setGuardando(true); setError(null);
    try {
      await apiPersonal(`/api/personal/${id}/desempeno`, {
        method: "POST",
        json: {
          periodo: periodo.trim(),
          competencias: competencias.filter((c) => c.nombre.trim()),
          fortalezas: fortalezas.trim() || undefined,
          mejoras: mejoras.trim() || undefined,
          comentario: comentario.trim() || undefined,
        },
      });
      onCreado();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo registrar"); setGuardando(false); }
  };

  return (
    <Modal titulo="Nueva evaluación de desempeño" ancho="max-w-lg" onCerrar={onCerrar} footer={
      <>
        <span className="mr-auto text-[12px] text-slate-400">Promedio: <b className="text-slate-700">{promedio != null ? promedio.toFixed(1) : "—"}</b> / 5</span>
        <button type="button" onClick={onCerrar} disabled={guardando} className={btnSecundario}>Cancelar</button>
        <button type="button" onClick={() => void guardar()} disabled={guardando} className={btnPrimario}><Plus className="h-4 w-4" aria-hidden /> {guardando ? "Guardando…" : "Guardar"}</button>
      </>
    }>
      <label className="block text-[12px] font-semibold text-slate-500">Período<input className={`${inputCls} mt-1`} value={periodo} onChange={(e) => setPeriodo(e.target.value)} placeholder="Ej.: 2º semestre 2026" /></label>

      <div>
        <p className="text-[12px] font-semibold text-slate-500">Competencias (0–5)</p>
        <div className="mt-1 space-y-1.5">
          {competencias.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className={`${inputCls} flex-1`} value={c.nombre} list="comp-sugeridas" onChange={(e) => setComp(i, { nombre: e.target.value })} placeholder="Competencia" />
              <input type="number" min={0} max={5} step={0.5} className={`${inputCls} w-20`} value={c.puntaje} onChange={(e) => setComp(i, { puntaje: Math.min(5, Math.max(0, Number(e.target.value))) })} />
              <button type="button" onClick={() => quitar(i)} className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600" aria-label="Quitar"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
            </div>
          ))}
        </div>
        <datalist id="comp-sugeridas">{COMPETENCIAS_SUGERIDAS.map((s) => <option key={s} value={s} />)}</datalist>
        <button type="button" onClick={agregar} className="mt-1.5 text-[12.5px] font-semibold text-[#2F8E92] hover:underline">+ Agregar competencia</button>
      </div>

      <label className="block text-[12px] font-semibold text-slate-500">Fortalezas<textarea className={`${inputCls} mt-1 min-h-14`} value={fortalezas} onChange={(e) => setFortalezas(e.target.value)} /></label>
      <label className="block text-[12px] font-semibold text-slate-500">A mejorar<textarea className={`${inputCls} mt-1 min-h-14`} value={mejoras} onChange={(e) => setMejoras(e.target.value)} /></label>
      <label className="block text-[12px] font-semibold text-slate-500">Comentario general<textarea className={`${inputCls} mt-1 min-h-14`} value={comentario} onChange={(e) => setComentario(e.target.value)} /></label>
      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p> : null}
    </Modal>
  );
}
