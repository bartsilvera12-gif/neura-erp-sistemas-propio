"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertCircle, FolderKanban, Plus, Search } from "lucide-react";
import { useEstadosProyecto, useProyectos, type ProyectoCard } from "@/shared/hooks/useProyectos";
import { nombreClienteDisplay } from "@/lib/clientes/display-name";

/**
 * Proyectos mobile — vista por etapa.
 *
 *  Como el Kanban con scroll horizontal no funciona en mobile, lo reemplazo por:
 *   - Tabs scrollables horizontales arriba (uno por estado).
 *   - El tab muestra el nombre del estado + count de proyectos.
 *   - El usuario toca un estado y ve las cards de proyecto de esa columna apiladas verticalmente.
 *   - Botón "Nuevo" en el header.
 *   - Búsqueda transversal (filtra dentro del estado activo).
 *   - Tap en card → /dashboard/proyectos/{id} (detalle desktop, full-width en mobile via responsive).
 *
 *  Las cards muestran lo esencial: prioridad chip, título, cliente, fecha prometida.
 */

export default function ProyectosMobile({
  variant = "dashboard",
}: {
  /**
   * "dashboard" (por defecto) = entrando desde el navegador a /dashboard/proyectos. El shell
   * de alrededor ya pone su propio encabezado, así que acá alcanza una caja con padding.
   * Se ve exactamente igual que antes de agregar esta prop.
   *
   * "app" = dentro de la app del asesor (/m/asesor/proyectos), donde NO hay shell: el título
   * y el botón Nuevo quedaban metidos abajo de la barra de estado del iPhone. Esta variante
   * pone el encabezado verde de la app respetando `env(safe-area-inset-top)`, y mete adentro
   * el buscador y el botón, igual que la pantalla de conversaciones.
   */
  variant?: "dashboard" | "app";
}) {
  const { proyectos, isLoading: loadingP, error } = useProyectos();
  const { estados, isLoading: loadingE } = useEstadosProyecto();
  const [estadoActivoId, setEstadoActivoId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const isLoading = loadingP || loadingE;
  const app = variant === "app";

  // Estados visibles: los que tengan al menos un proyecto, o el inicial.
  const estadosVisibles = useMemo(() => {
    const conteo = new Map<string, number>();
    for (const p of proyectos) {
      const id = String(p.estado_id);
      conteo.set(id, (conteo.get(id) ?? 0) + 1);
    }
    return estados.map((e) => ({ ...e, count: conteo.get(e.id) ?? 0 }));
  }, [estados, proyectos]);

  // Estado activo: primer estado con count > 0, o el primero.
  const estadoActivo = useMemo(() => {
    if (estadoActivoId) return estadosVisibles.find((e) => e.id === estadoActivoId) ?? estadosVisibles[0];
    return estadosVisibles.find((e) => (e.count ?? 0) > 0) ?? estadosVisibles[0];
  }, [estadosVisibles, estadoActivoId]);

  const proyectosFiltrados = useMemo(() => {
    if (!estadoActivo) return [];
    const q = query.trim().toLowerCase();
    return proyectos
      .filter((p) => p.estado_id === estadoActivo.id)
      .filter((p) => {
        if (!q) return true;
        const cliente = nombreClienteDisplay(p.cliente, "");
        return p.titulo.toLowerCase().includes(q) || cliente.toLowerCase().includes(q);
      })
      .slice()
      .sort((a, b) => (b.last_activity_at ?? "").localeCompare(a.last_activity_at ?? ""));
  }, [proyectos, estadoActivo, query]);

  const resumen =
    proyectos.length === 0 ? "Sin proyectos cargados." : `${proyectos.length} proyectos activos`;

  /* Chips de estado. En la app sangran hasta el borde (-mx-3) para que se note que siguen. */
  const tabsEstado = (
    <div
      className={`flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
        app ? "-mx-3 px-3" : "-mx-1 px-1"
      }`}
    >
      {estadosVisibles.map((e) => {
        const active = estadoActivo?.id === e.id;
        return (
          <button
            key={e.id}
            type="button"
            onClick={() => setEstadoActivoId(e.id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              active ? "bg-[#4FAEB2] text-white" : "border border-slate-200 bg-white text-slate-600"
            }`}
            style={active && e.color ? { backgroundColor: e.color, borderColor: e.color } : undefined}
          >
            {e.nombre}
            {e.count > 0 ? (
              <span className={`ml-1.5 text-[10px] ${active ? "text-white/85" : "text-slate-400"}`}>
                {e.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );

  const listado = (
    <>
      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          No se pudieron cargar los proyectos.
        </div>
      ) : null}

      {isLoading ? (
        <SkeletonList />
      ) : proyectos.length === 0 ? (
        <EmptyState />
      ) : proyectosFiltrados.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
          <FolderKanban className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm font-medium text-slate-700">
            {query.trim() ? "Sin resultados" : "No hay proyectos en este estado"}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {proyectosFiltrados.map((p) => (
            <ProyectoCardItem key={p.id} proyecto={p} />
          ))}
        </ul>
      )}
    </>
  );

  if (app) {
    return (
      <>
        <header
          className="sticky top-0 z-10 shrink-0 bg-[#3F8E91] px-4 pb-3 text-white shadow-sm"
          // Mismo cálculo que la bandeja: sin esto el título queda abajo del notch.
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-base font-semibold">Proyectos</h1>
              <p className="text-[11px] text-white/80">{resumen}</p>
            </div>
            <Link
              href="/dashboard/proyectos/nuevo"
              className="flex min-h-[36px] shrink-0 items-center gap-1 rounded-full bg-white/95 px-3.5 text-[13px] font-semibold text-[#3F8E91] shadow-sm active:bg-white"
            >
              <Plus className="h-4 w-4" />
              Nuevo
            </Link>
          </div>
          <input
            type="search"
            inputMode="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar en este estado…"
            aria-label="Buscar proyecto"
            className="mt-2 w-full rounded-xl border border-white/20 bg-white/95 px-3 py-2 text-[13px] text-slate-800 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-white/40"
          />
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 pb-4 pt-3">
          <div className="mb-3">{tabsEstado}</div>
          {listado}
        </main>
      </>
    );
  }

  return (
    <div className="mx-auto max-w-md p-4 pb-24">
      <header className="mb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Proyectos</h1>
            <p className="mt-0.5 text-xs text-slate-500">{resumen}</p>
          </div>
          <Link
            href="/dashboard/proyectos/nuevo"
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#0EA5E9] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors active:bg-[#0284C7]"
          >
            <Plus className="h-4 w-4" />
            Nuevo
          </Link>
        </div>
      </header>

      <div className="mb-3">{tabsEstado}</div>

      {/* Búsqueda dentro del estado */}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          placeholder="Buscar en este estado…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#0EA5E9]/40 focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]/30"
        />
      </div>

      {listado}
    </div>
  );
}

function ProyectoCardItem({ proyecto }: { proyecto: ProyectoCard }) {
  const cliente = nombreClienteDisplay(proyecto.cliente, "Sin cliente");
  const fechaPrometida = proyecto.fecha_prometida;
  const promExpired = fechaPrometida ? fechaPrometida < new Date().toISOString().slice(0, 10) : false;
  return (
    <li>
      <Link
        href={`/dashboard/proyectos/${proyecto.id}`}
        className="block rounded-2xl border border-slate-200 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-transform active:scale-[0.99]"
      >
        <div className="flex items-start gap-2">
          <PrioridadIndicator prioridad={proyecto.prioridad} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">{proyecto.titulo}</p>
            <p className="truncate text-[11px] text-slate-500">{cliente}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {proyecto.proyecto_tipo?.nombre ? (
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                  {proyecto.proyecto_tipo.nombre}
                </span>
              ) : null}
              {fechaPrometida ? (
                <span
                  className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                    promExpired ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {promExpired ? <AlertCircle className="h-2.5 w-2.5" /> : null}
                  {formatFecha(fechaPrometida)}
                </span>
              ) : null}
              {proyecto.bloqueado ? (
                <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                  Bloqueado
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
}

function PrioridadIndicator({ prioridad }: { prioridad: string }) {
  const cfg: Record<string, { color: string; label: string }> = {
    urgente: { color: "bg-red-500", label: "U" },
    alta: { color: "bg-orange-500", label: "A" },
    normal: { color: "bg-slate-300", label: "N" },
    baja: { color: "bg-slate-200", label: "B" },
  };
  const c = cfg[prioridad?.toLowerCase()] ?? cfg.normal;
  return (
    <span
      className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${c.color} text-[10px] font-bold text-white`}
      title={`Prioridad ${prioridad ?? "normal"}`}
    >
      {c.label}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
      <FolderKanban className="mx-auto h-8 w-8 text-slate-300" />
      <p className="mt-2 text-sm font-medium text-slate-700">Sin proyectos cargados</p>
      <p className="mt-1 text-xs text-slate-500">
        Tocá <span className="font-semibold">Nuevo</span> para crear el primero.
      </p>
    </div>
  );
}

function SkeletonList() {
  return (
    <ul className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="rounded-2xl border border-slate-200 bg-white p-3.5">
          <div className="flex items-start gap-2">
            <div className="mt-1 h-5 w-5 shrink-0 animate-pulse rounded-md bg-slate-100" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="h-3.5 w-2/3 animate-pulse rounded bg-slate-100" />
              <div className="h-2.5 w-1/2 animate-pulse rounded bg-slate-100" />
              <div className="h-2.5 w-1/3 animate-pulse rounded bg-slate-100" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function formatFecha(ymd: string): string {
  if (!ymd) return "";
  const [, m, d] = ymd.split("-");
  if (!m || !d) return ymd;
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${d} ${meses[parseInt(m, 10) - 1] ?? m}`;
}
