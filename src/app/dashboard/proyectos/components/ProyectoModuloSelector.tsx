"use client";

import { useMemo, useState } from "react";

export type ProyectoModuloCatalogo = { id: string; nombre: string; slug: string };

type ProyectoModuloSelectorProps = {
  modulos: ProyectoModuloCatalogo[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  variant?: "light" | "dark";
  /**
   * "list": lista de checkboxes (comportamiento clásico, usado en la ficha del proyecto).
   * "chips": módulos como chips ovalados agrupados por familia; el nombre de la familia
   *          marca/desmarca todo su grupo. Se usa en el popup de crear un proyecto.
   */
  layout?: "list" | "chips";
};

/**
 * Agrupamiento de módulos por familia (mismo criterio que el menú lateral:
 * Sidebar.tsx · MENU_FAMILIES). Es solo presentación: cualquier módulo cuyo
 * slug no esté acá cae automáticamente en la familia "Otros" (nada se oculta).
 */
const FAMILIAS: { id: string; title: string; slugs: string[] }[] = [
  { id: "inicio", title: "Inicio", slugs: ["dashboard", "tableros", "chat_interno", "gerencia"] },
  {
    id: "comercial",
    title: "Comercial",
    slugs: ["clientes", "crm", "gestion-clientes", "comisiones", "planes", "agenda", "proyectos", "proyectos_movil"],
  },
  {
    id: "finanzas",
    title: "Finanzas",
    slugs: ["ventas", "cobranzas", "pagos", "gastos", "compras", "notas_credito", "reportes", "contabilidad", "movimientos"],
  },
  { id: "operaciones", title: "Operaciones", slugs: ["inventario", "produccion"] },
  {
    id: "omnicanal",
    title: "Omnicanal",
    slugs: [
      "conversaciones",
      "conversaciones-finalizadas",
      "monitoreo",
      "historial-omnicanal",
      "campanas",
      "etiquetas",
      "omnicanal",
    ],
  },
  { id: "marketing", title: "Marketing y Automatización", slugs: ["marketing", "marketing_ops", "sorteos"] },
  { id: "soporte", title: "Soporte", slugs: ["soporte"] },
  { id: "administracion", title: "Administración", slugs: ["usuarios", "guardias", "configuracion"] },
];

const FAMILIA_POR_SLUG = new Map<string, string>();
for (const fam of FAMILIAS) for (const slug of fam.slugs) FAMILIA_POR_SLUG.set(slug, fam.id);

type Grupo = { id: string; title: string; modulos: ProyectoModuloCatalogo[] };

export function ProyectoModuloSelector({
  modulos,
  selectedIds,
  onChange,
  layout = "list",
}: ProyectoModuloSelectorProps) {
  const [query, setQuery] = useState("");
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedModules = useMemo(
    () => modulos.filter((modulo) => selectedSet.has(modulo.id)),
    [modulos, selectedSet]
  );
  const filteredModules = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return modulos;
    return modulos.filter((modulo) =>
      [modulo.nombre, modulo.slug].some((value) => value.toLowerCase().includes(q))
    );
  }, [modulos, query]);

  // Agrupa los módulos (ya filtrados) por familia, respetando el orden de FAMILIAS
  // y dejando al final una familia "Otros" con lo que no esté mapeado.
  const grupos = useMemo<Grupo[]>(() => {
    const porFamilia = new Map<string, ProyectoModuloCatalogo[]>();
    const otros: ProyectoModuloCatalogo[] = [];
    for (const modulo of filteredModules) {
      const famId = FAMILIA_POR_SLUG.get(modulo.slug);
      if (!famId) {
        otros.push(modulo);
        continue;
      }
      const list = porFamilia.get(famId) ?? [];
      list.push(modulo);
      porFamilia.set(famId, list);
    }
    const ordenados: Grupo[] = [];
    for (const fam of FAMILIAS) {
      const list = porFamilia.get(fam.id);
      if (list && list.length > 0) {
        list.sort((a, b) => fam.slugs.indexOf(a.slug) - fam.slugs.indexOf(b.slug));
        ordenados.push({ id: fam.id, title: fam.title, modulos: list });
      }
    }
    if (otros.length > 0) {
      otros.sort((a, b) => a.nombre.localeCompare(b.nombre));
      ordenados.push({ id: "otros", title: "Otros", modulos: otros });
    }
    return ordenados;
  }, [filteredModules]);

  function toggle(id: string) {
    if (selectedSet.has(id)) onChange(selectedIds.filter((current) => current !== id));
    else onChange([...selectedIds, id]);
  }

  function remove(id: string) {
    onChange(selectedIds.filter((current) => current !== id));
  }

  function toggleFamilia(grupo: Grupo) {
    const ids = grupo.modulos.map((m) => m.id);
    const todosSeleccionados = ids.every((id) => selectedSet.has(id));
    if (todosSeleccionados) {
      const quitar = new Set(ids);
      onChange(selectedIds.filter((id) => !quitar.has(id)));
    } else {
      onChange(Array.from(new Set([...selectedIds, ...ids])));
    }
  }

  const buscador = (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[#4FAEB2]"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </span>
      <input
        className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar módulo..."
      />
    </div>
  );

  // ----- Vista chips por familia (popup de crear) -----
  if (layout === "chips") {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-slate-500">
            {selectedIds.length === 1
              ? "1 módulo seleccionado"
              : `${selectedIds.length} módulos seleccionados`}
          </p>
          {selectedIds.length > 0 ? (
            <button
              type="button"
              className="text-xs font-medium text-slate-400 transition-colors hover:text-[#3F8E91]"
              onClick={() => onChange([])}
            >
              Limpiar
            </button>
          ) : null}
        </div>

        {buscador}

        <div className="max-h-72 space-y-4 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          {modulos.length === 0 ? (
            <p className="px-1 py-3 text-sm text-slate-500">No hay módulos disponibles en el catálogo.</p>
          ) : grupos.length === 0 ? (
            <p className="px-1 py-3 text-sm text-slate-500">No hay módulos que coincidan con la búsqueda.</p>
          ) : (
            grupos.map((grupo) => {
              const ids = grupo.modulos.map((m) => m.id);
              const seleccionados = ids.filter((id) => selectedSet.has(id)).length;
              const todos = seleccionados === ids.length;
              return (
                <div key={grupo.id} className="space-y-2">
                  <button
                    type="button"
                    onClick={() => toggleFamilia(grupo)}
                    className="group flex w-full items-center gap-2"
                    title={todos ? "Quitar toda la familia" : "Seleccionar toda la familia"}
                  >
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 transition-colors group-hover:text-[#3F8E91]">
                      {grupo.title}
                    </span>
                    <span className="text-[11px] font-medium text-slate-400">
                      {seleccionados}/{ids.length}
                    </span>
                    <span className="ml-auto text-[11px] font-medium text-[#4FAEB2] opacity-0 transition-opacity group-hover:opacity-100">
                      {todos ? "Quitar todos" : "Seleccionar todos"}
                    </span>
                  </button>
                  <div className="flex flex-wrap gap-1.5">
                    {grupo.modulos.map((modulo) => {
                      const checked = selectedSet.has(modulo.id);
                      return (
                        <button
                          key={modulo.id}
                          type="button"
                          onClick={() => toggle(modulo.id)}
                          aria-pressed={checked}
                          className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                            checked
                              ? "border-[#4FAEB2] bg-[#4FAEB2] text-white shadow-sm"
                              : "border-slate-200 bg-white text-slate-700 hover:border-[#4FAEB2]/60 hover:bg-[#4FAEB2]/5 hover:text-[#3F8E91]"
                          }`}
                        >
                          {modulo.nombre}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  // ----- Vista lista de checkboxes (clásica: ficha del proyecto) -----
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">
          {selectedIds.length === 1
            ? "1 módulo seleccionado"
            : `${selectedIds.length} módulos seleccionados`}
        </p>
      </div>

      {selectedModules.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selectedModules.map((modulo) => (
            <span
              key={modulo.id}
              className="inline-flex items-center gap-1 rounded-full border border-[#4FAEB2]/30 bg-[#4FAEB2]/10 px-2.5 py-1 text-xs font-medium text-[#3F8E91]"
            >
              {modulo.nombre}
              <button
                type="button"
                className="rounded-full px-1 leading-none text-[#3F8E91]/70 transition-colors hover:bg-[#4FAEB2]/20 hover:text-[#3F8E91]"
                onClick={() => remove(modulo.id)}
                aria-label={`Quitar ${modulo.nombre}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500">Todavía no seleccionaste módulos.</p>
      )}

      {buscador}

      <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
        {modulos.length === 0 ? (
          <p className="px-3 py-4 text-sm text-slate-500">No hay módulos disponibles en el catálogo.</p>
        ) : filteredModules.length === 0 ? (
          <p className="px-3 py-4 text-sm text-slate-500">No hay módulos que coincidan con la búsqueda.</p>
        ) : (
          filteredModules.map((modulo) => {
            const checked = selectedSet.has(modulo.id);
            return (
              <label
                key={modulo.id}
                className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  checked
                    ? "bg-[#4FAEB2]/8 text-[#3F8E91]"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-[#4FAEB2] accent-[#4FAEB2] focus:ring-[#4FAEB2]/30"
                  checked={checked}
                  onChange={() => toggle(modulo.id)}
                />
                <span className="flex-1 font-medium">{modulo.nombre}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
