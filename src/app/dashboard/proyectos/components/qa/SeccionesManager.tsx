"use client";

import { useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type { QAApiResp, QASeccion } from "./types";
import {
  BTN_GHOST_CLS,
  BTN_PRIMARY_CLS,
  INPUT_CLS,
  IconPlus,
  IconTrash,
  textoSobre,
} from "./ui";

type Props = {
  projectId: string;
  secciones: QASeccion[];
  conteoPorSeccion: Record<string, number>;
  onClose: () => void;
  onCambio: () => void | Promise<void>;
};

/** Paleta corta para que las secciones se distingan de un vistazo. */
const COLORES = ["#4FAEB2", "#8b5cf6", "#f97316", "#0ea5e9", "#22c55e", "#f43f5e", "#64748b"];

export default function SeccionesManager({
  projectId,
  secciones,
  conteoPorSeccion,
  onClose,
  onCambio,
}: Props) {
  const [nombre, setNombre] = useState("");
  const [color, setColor] = useState<string>(COLORES[0]);
  const [err, setErr] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function llamar(url: string, init: RequestInit): Promise<boolean> {
    setEnviando(true);
    try {
      const res = await fetchWithSupabaseSession(url, init);
      const j = (await res.json().catch(() => null)) as QAApiResp<unknown> | null;
      if (!res.ok || !j?.success) {
        setErr(j?.error ?? "Error");
        return false;
      }
      setErr(null);
      await onCambio();
      return true;
    } finally {
      setEnviando(false);
    }
  }

  async function crear() {
    const n = nombre.trim();
    if (!n || enviando) return;
    const ok = await llamar(`/api/proyectos/${projectId}/qa/secciones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: n, color }),
    });
    if (ok) setNombre("");
  }

  async function renombrar(s: QASeccion) {
    const n = window.prompt("Nuevo nombre de la sección:", s.nombre);
    if (n === null) return;
    const limpio = n.trim();
    if (!limpio || limpio === s.nombre) return;
    await llamar(`/api/proyectos/${projectId}/qa/secciones/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: limpio }),
    });
  }

  async function pintar(s: QASeccion, nuevo: string) {
    await llamar(`/api/proyectos/${projectId}/qa/secciones/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color: nuevo }),
    });
  }

  async function eliminar(s: QASeccion) {
    const cuantas = conteoPorSeccion[s.id] ?? 0;
    const aviso =
      cuantas > 0
        ? `¿Eliminar la sección "${s.nombre}"? Sus ${cuantas} observaciones quedan en "Sin sección".`
        : `¿Eliminar la sección "${s.nombre}"?`;
    if (!window.confirm(aviso)) return;
    await llamar(`/api/proyectos/${projectId}/qa/secciones/${s.id}`, { method: "DELETE" });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Secciones de QA"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="h-5 w-1 rounded-full bg-[#4FAEB2]" />
            <h2 className="text-sm font-semibold text-slate-900">Secciones del proyecto</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
          >
            Cerrar
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <p className="text-xs text-slate-500">
            Agrupá las observaciones por pantalla o módulo: <strong>Home</strong>,{" "}
            <strong>Checkout</strong>, <strong>Panel admin</strong>. Podés crearlas también desde el
            combo de sección al cargar una observación.
          </p>

          <ul className="space-y-2">
            {secciones.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2"
              >
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={
                    s.color
                      ? { backgroundColor: s.color, color: textoSobre(s.color) }
                      : { backgroundColor: "#f1f5f9", color: "#475569" }
                  }
                >
                  {s.nombre}
                </span>
                <span className="text-[11px] tabular-nums text-slate-400">
                  {conteoPorSeccion[s.id] ?? 0}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  {COLORES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => void pintar(s, c)}
                      aria-label={`Pintar ${s.nombre}`}
                      className={`h-4 w-4 rounded-full border transition-transform hover:scale-110 ${
                        s.color === c ? "border-slate-900" : "border-transparent"
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => void renombrar(s)}
                    className="ml-1 rounded-md px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                  >
                    Renombrar
                  </button>
                  <button
                    type="button"
                    onClick={() => void eliminar(s)}
                    aria-label={`Eliminar ${s.nombre}`}
                    className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                  >
                    <IconTrash />
                  </button>
                </div>
              </li>
            ))}
            {secciones.length === 0 ? (
              <li className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                Todavía no hay secciones. Creá la primera acá abajo.
              </li>
            ) : null}
          </ul>
        </div>

        <div className="space-y-2 border-t border-slate-200 px-5 py-4">
          {err ? <p className="text-xs text-rose-600">{err}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void crear();
                }
              }}
              placeholder="Nombre de la sección"
              className={`${INPUT_CLS} min-w-0 flex-1`}
            />
            <div className="flex items-center gap-1">
              {COLORES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Color ${c}`}
                  className={`h-5 w-5 rounded-full border-2 transition-transform hover:scale-110 ${
                    color === c ? "border-slate-900" : "border-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => void crear()}
              disabled={!nombre.trim() || enviando}
              className={BTN_PRIMARY_CLS}
            >
              <IconPlus />
              Crear
            </button>
            <button type="button" onClick={onClose} className={BTN_GHOST_CLS}>
              Listo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
