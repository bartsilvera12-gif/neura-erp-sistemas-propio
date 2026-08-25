"use client";

import { useCallback, useRef, useState } from "react";
import {
  Bold,
  Italic,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link2,
  Minus,
  Eye,
  Pencil,
  Table,
} from "lucide-react";
import ArticuloMarkdown from "@/components/ayuda/ArticuloMarkdown";

/**
 * Editor de artículos para gente NO técnica.
 *
 * Guarda Markdown (texto plano: portable y ya renderizable con react-markdown),
 * pero nadie tiene que escribirlo a mano: la barra aplica el formato sobre lo
 * seleccionado y la vista previa muestra el resultado real al lado. Es el mismo
 * modelo de GitHub/Reddit y no arrastra ninguna dependencia nueva al bundle.
 */

type Props = {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /** Alto mínimo del área de escritura. */
  minHeightClassName?: string;
};

type Selection = { start: number; end: number };

/** Aplica `before`/`after` alrededor de la selección (o inserta el ejemplo si no hay nada seleccionado). */
function wrapInline(
  value: string,
  sel: Selection,
  before: string,
  after: string,
  placeholder: string
): { value: string; sel: Selection } {
  const selected = value.slice(sel.start, sel.end) || placeholder;
  const next = value.slice(0, sel.start) + before + selected + after + value.slice(sel.end);
  return {
    value: next,
    sel: { start: sel.start + before.length, end: sel.start + before.length + selected.length },
  };
}

/** Agrega (o saca, si ya estaba) un prefijo a cada línea tocada por la selección. */
function togglePrefix(
  value: string,
  sel: Selection,
  prefix: string,
  numbered = false
): { value: string; sel: Selection } {
  const lineStart = value.lastIndexOf("\n", Math.max(0, sel.start - 1)) + 1;
  const lineEndRaw = value.indexOf("\n", sel.end);
  const lineEnd = lineEndRaw === -1 ? value.length : lineEndRaw;

  const bloque = value.slice(lineStart, lineEnd) || "";
  const lineas = bloque.split("\n");
  const escapado = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const yaAplicado = lineas.every(
    (l) => l.trim() === "" || new RegExp(`^(${escapado}|\\d+\\. )`).test(l)
  );

  const nuevas = lineas.map((l, i) => {
    if (l.trim() === "") return l;
    if (yaAplicado) return l.replace(/^(#{1,6} |> |- |\d+\. )/, "");
    const limpia = l.replace(/^(#{1,6} |> |- |\d+\. )/, "");
    return numbered ? `${i + 1}. ${limpia}` : `${prefix}${limpia}`;
  });

  const bloqueNuevo = nuevas.join("\n");
  const next = value.slice(0, lineStart) + bloqueNuevo + value.slice(lineEnd);
  return { value: next, sel: { start: lineStart, end: lineStart + bloqueNuevo.length } };
}

/** Inserta un bloque propio (separador, tabla) en línea aparte. */
function insertBlock(value: string, sel: Selection, block: string): { value: string; sel: Selection } {
  const antes = value.slice(0, sel.start);
  const despues = value.slice(sel.end);
  const sep1 = antes && !antes.endsWith("\n\n") ? (antes.endsWith("\n") ? "\n" : "\n\n") : "";
  const sep2 = despues && !despues.startsWith("\n") ? "\n\n" : "";
  const next = antes + sep1 + block + sep2 + despues;
  const pos = (antes + sep1 + block).length;
  return { value: next, sel: { start: pos, end: pos } };
}

const TABLA_EJEMPLO = ["| Columna | Columna |", "| --- | --- |", "| Dato | Dato |"].join("\n");

/** Transformaciones puras: reciben texto + selección y devuelven texto + selección nuevos. */
const NEGRITA = (v: string, s: Selection) => wrapInline(v, s, "**", "**", "texto en negrita");
const CURSIVA = (v: string, s: Selection) => wrapInline(v, s, "_", "_", "texto en cursiva");
const ENLACE = (v: string, s: Selection) => wrapInline(v, s, "[", "](https://)", "texto del enlace");

const ACCIONES: {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  run: (value: string, sel: Selection) => { value: string; sel: Selection };
}[] = [
  { key: "h2", label: "Título", icon: Heading2, run: (v, s) => togglePrefix(v, s, "## ") },
  { key: "h3", label: "Subtítulo", icon: Heading3, run: (v, s) => togglePrefix(v, s, "### ") },
  { key: "bold", label: "Negrita (Ctrl+B)", icon: Bold, run: NEGRITA },
  { key: "italic", label: "Cursiva (Ctrl+I)", icon: Italic, run: CURSIVA },
  { key: "ul", label: "Lista con viñetas", icon: List, run: (v, s) => togglePrefix(v, s, "- ") },
  { key: "ol", label: "Lista numerada", icon: ListOrdered, run: (v, s) => togglePrefix(v, s, "1. ", true) },
  { key: "quote", label: "Nota destacada", icon: Quote, run: (v, s) => togglePrefix(v, s, "> ") },
  { key: "link", label: "Enlace (Ctrl+K)", icon: Link2, run: ENLACE },
  { key: "table", label: "Tabla", icon: Table, run: (v, s) => insertBlock(v, s, TABLA_EJEMPLO) },
  { key: "hr", label: "Separador", icon: Minus, run: (v, s) => insertBlock(v, s, "---") },
];

export default function EditorTexto({
  value,
  onChange,
  placeholder,
  minHeightClassName = "min-h-[360px]",
}: Props) {
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const [tab, setTab] = useState<"escribir" | "vista">("escribir");

  const aplicar = useCallback(
    (fn: (value: string, sel: Selection) => { value: string; sel: Selection }) => {
      const area = areaRef.current;
      if (!area) return;
      const sel: Selection = { start: area.selectionStart, end: area.selectionEnd };
      const res = fn(value, sel);
      onChange(res.value);
      /** El valor lo pinta React: hay que reposicionar el cursor DESPUÉS del re-render. */
      requestAnimationFrame(() => {
        const a = areaRef.current;
        if (!a) return;
        a.focus();
        a.setSelectionRange(res.sel.start, res.sel.end);
      });
    },
    [value, onChange]
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === "b") {
      e.preventDefault();
      aplicar(NEGRITA);
    } else if (k === "i") {
      e.preventDefault();
      aplicar(CURSIVA);
    } else if (k === "k") {
      e.preventDefault();
      aplicar(ENLACE);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      {/* Barra de formato */}
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 py-1.5">
        {ACCIONES.map((a) => (
          <button
            key={a.key}
            type="button"
            title={a.label}
            aria-label={a.label}
            onClick={() => aplicar(a.run)}
            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-white hover:text-[#3F8E91] hover:shadow-sm"
          >
            <a.icon className="h-4 w-4" />
          </button>
        ))}

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setTab("escribir")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
              tab === "escribir"
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <Pencil className="h-3.5 w-3.5" />
            Escribir
          </button>
          <button
            type="button"
            onClick={() => setTab("vista")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors lg:hidden ${
              tab === "vista" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            Vista previa
          </button>
        </div>
      </div>

      {/* Escritura + vista previa. En pantalla grande van lado a lado. */}
      <div className="grid grid-cols-1 lg:grid-cols-2">
        <div className={tab === "vista" ? "hidden lg:block" : "block"}>
          <textarea
            ref={areaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              placeholder ??
              "Escribí el proceso paso a paso.\n\nUsá los botones de arriba para poner títulos, listas y negritas: no hace falta saber nada técnico."
            }
            spellCheck
            className={`w-full resize-y border-0 px-4 py-3 font-mono text-[13px] leading-relaxed text-slate-800 focus:outline-none ${minHeightClassName}`}
          />
        </div>

        <div
          className={`border-slate-200 bg-slate-50/60 px-4 py-3 lg:block lg:border-l ${
            tab === "vista" ? "block" : "hidden"
          } ${minHeightClassName} overflow-y-auto`}
        >
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Así lo va a ver el asesor
          </p>
          {value.trim() ? (
            <ArticuloMarkdown>{value}</ArticuloMarkdown>
          ) : (
            <p className="text-sm text-slate-400">La vista previa aparece acá mientras escribís.</p>
          )}
        </div>
      </div>
    </div>
  );
}
