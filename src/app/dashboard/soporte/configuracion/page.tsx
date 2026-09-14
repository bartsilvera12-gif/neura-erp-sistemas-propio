"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Bell, Check, CircleDot, Flag, Plus, Settings2, Tags, Timer, Users, type LucideIcon } from "lucide-react";
import { FancySelect } from "@/app/dashboard/proyectos/components/FancySelect";
import { apiSoporte, invalidarCatalogos, obtenerCatalogos, type CatalogosConEquipo } from "../_ui/api";
import { Aviso, Avatar, Boton, Cargando, Encabezado, Pagina, TONOS, Tarjeta, claseInput, type Tono } from "../_ui/ui";

type Catalogo = "estados" | "tipos" | "clasificaciones" | "prioridades";

const PESTANAS: readonly { id: string; etiqueta: string; icono: LucideIcon; tono: Tono }[] = [
  { id: "estados", etiqueta: "Estados", icono: CircleDot, tono: "celeste" },
  { id: "tipos", etiqueta: "Tipos de solicitud", icono: Tags, tono: "violeta" },
  { id: "prioridades", etiqueta: "Prioridades", icono: Flag, tono: "ambar" },
  { id: "sla", etiqueta: "SLA", icono: Timer, tono: "verde" },
  { id: "equipos", etiqueta: "Equipos", icono: Users, tono: "turquesa" },
  { id: "notificaciones", etiqueta: "Notificaciones", icono: Bell, tono: "rosa" },
];

function Interruptor({ activo, onCambio, etiqueta }: { activo: boolean; onCambio: (v: boolean) => void; etiqueta: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      aria-label={etiqueta}
      onClick={() => onCambio(!activo)}
      className={`relative h-5 w-9 rounded-full transition-colors ${activo ? "bg-[#4FAEB2]" : "bg-slate-300"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${activo ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

/** Guarda un cambio de un campo al salir de él. El `codigo` nunca se toca. */
function useGuardar(recargar: () => Promise<void>) {
  const [guardado, setGuardado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const guardar = useCallback(
    async (catalogo: Catalogo, codigo: string | null, campos: Record<string, unknown>, extra?: Record<string, unknown>) => {
      setError(null);
      try {
        await apiSoporte("/api/soporte/catalogos", { method: "PUT", json: { catalogo, codigo, ...campos, ...extra } });
        invalidarCatalogos();
        await recargar();
        setGuardado(codigo ?? "nuevo");
        window.setTimeout(() => setGuardado(null), 1500);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo guardar");
        return false;
      }
    },
    [recargar]
  );
  return { guardar, guardado, error };
}

function CeldaTexto({ valor, onGuardar, tipo = "text", ancho = "" }: { valor: string | number | null; onGuardar: (v: string) => void; tipo?: string; ancho?: string }) {
  const [v, setV] = useState(valor == null ? "" : String(valor));
  useEffect(() => setV(valor == null ? "" : String(valor)), [valor]);
  return (
    <input
      type={tipo}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== (valor == null ? "" : String(valor)) && onGuardar(v)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className={`${claseInput} py-1.5 ${ancho}`}
    />
  );
}

function Tabla({ columnas, children }: { columnas: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-[13px]">
        <thead>
          <tr className="border-b border-slate-100 text-[11.5px] text-slate-500">
            {columnas.map((c) => (
              <th key={c} className="px-3 py-2.5 font-medium first:pl-0">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Contenido() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = PESTANAS.find((p) => p.id === params.get("tab"))?.id ?? "estados";
  const [cat, setCat] = useState<CatalogosConEquipo | null>(null);
  const [cargaError, setCargaError] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    try {
      setCat(await obtenerCatalogos(true));
    } catch (e) {
      setCargaError(e instanceof Error ? e.message : "No se pudo cargar la configuración");
    }
  }, []);
  useEffect(() => {
    void recargar();
  }, [recargar]);

  const { guardar, guardado, error } = useGuardar(recargar);
  const [nuevo, setNuevo] = useState({ nombre: "", tipo_codigo: "error", sla_horas: "" });

  if (cargaError) return <Aviso>{cargaError}</Aviso>;
  if (!cat) return <Cargando />;
  if (!cat.puede_configurar) return <Aviso>Sólo un administrador puede configurar Soporte.</Aviso>;

  const ok = (codigo: string) => (guardado === codigo ? <Check className="h-4 w-4 text-emerald-500" aria-label="Guardado" /> : null);

  const agregar = async (catalogo: Catalogo, campos: Record<string, unknown>) => {
    if (await guardar(catalogo, null, campos)) setNuevo({ nombre: "", tipo_codigo: "error", sla_horas: "" });
  };

  const tituloTab = PESTANAS.find((p) => p.id === tab)?.etiqueta;

  return (
    <>
      <nav className="mb-5 flex gap-1.5 overflow-x-auto pb-1" aria-label="Secciones de configuración">
        {PESTANAS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => router.replace(`${pathname}?tab=${p.id}`, { scroll: false })}
            aria-current={tab === p.id ? "page" : undefined}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition ${
              tab === p.id
                ? `${TONOS[p.tono].suave} ${TONOS[p.tono].texto} ${TONOS[p.tono].borde} shadow-sm`
                : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-800"
            }`}
          >
            <p.icono className="h-3.5 w-3.5" aria-hidden />
            {p.etiqueta}
          </button>
        ))}
      </nav>

      {error ? <div className="mb-4"><Aviso>{error}</Aviso></div> : null}

      {tab === "estados" ? (
        <Tarjeta titulo="Estados de ticket" icono={CircleDot} tono="celeste" accion={<span className="text-[12px] text-slate-400">Los cambios se guardan al salir de cada campo</span>}>
          <Tabla columnas={["Nombre", "Tipo", "Área de la próxima acción", "Color", "Orden", "Detiene SLA", "Activo", ""]}>
            {cat.estados.map((e) => (
              <tr key={e.codigo} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-3"><CeldaTexto valor={e.nombre} onGuardar={(v) => void guardar("estados", e.codigo, { nombre: v })} /></td>
                <td className="px-3 py-2 w-32">
                  <FancySelect size="sm" ariaLabel="Tipo" value={e.tipo} onChange={(v) => void guardar("estados", e.codigo, { tipo: v })} options={[{ value: "abierto", label: "Abierto" }, { value: "cerrado", label: "Cerrado" }]} />
                </td>
                <td className="px-3 py-2"><CeldaTexto valor={e.area} onGuardar={(v) => void guardar("estados", e.codigo, { area: v })} /></td>
                <td className="px-3 py-2">
                  <input type="color" value={e.color} onChange={(ev) => void guardar("estados", e.codigo, { color: ev.target.value })} className="h-8 w-10 cursor-pointer rounded border border-slate-200 bg-white p-0.5" aria-label={`Color de ${e.nombre}`} />
                </td>
                <td className="px-3 py-2"><CeldaTexto tipo="number" ancho="w-20" valor={e.sort_order} onGuardar={(v) => void guardar("estados", e.codigo, { sort_order: Number(v) })} /></td>
                <td className="px-3 py-2"><Interruptor etiqueta="Detiene SLA" activo={e.detiene_sla} onCambio={(v) => void guardar("estados", e.codigo, { detiene_sla: v })} /></td>
                <td className="px-3 py-2"><Interruptor etiqueta="Activo" activo={e.activo} onCambio={(v) => void guardar("estados", e.codigo, { activo: v })} /></td>
                <td className="w-6 py-2">{ok(e.codigo)}</td>
              </tr>
            ))}
          </Tabla>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <input className={`${claseInput} max-w-xs`} placeholder="Nombre del nuevo estado" value={nuevo.nombre} onChange={(e) => setNuevo((n) => ({ ...n, nombre: e.target.value }))} />
            <Boton onClick={() => void agregar("estados", { nombre: nuevo.nombre, tipo: "abierto", color: "#94a3b8", sort_order: cat.estados.length + 1, activo: true })} disabled={!nuevo.nombre.trim()}>
              <Plus className="h-4 w-4" aria-hidden /> Nuevo estado
            </Boton>
            <p className="w-full text-[12px] text-slate-400">
              Un estado nuevo no tiene reglas de flujo propias: se puede pasar libremente desde y hacia él. Los siete estados del proceso oficial conservan sus transiciones.
            </p>
          </div>
        </Tarjeta>
      ) : null}

      {tab === "tipos" ? (
        <Tarjeta titulo="Tipos de solicitud" icono={Tags} tono="violeta">
          <Tabla columnas={["Nombre", "SLA propio (h)", "Orden", "Activo", ""]}>
            {cat.tipos.map((t) => {
              const tieneClasif = cat.clasificaciones.some((c) => c.tipo_codigo === t.codigo);
              return (
                <tr key={t.codigo} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-3"><CeldaTexto valor={t.nombre} onGuardar={(v) => void guardar("tipos", t.codigo, { nombre: v })} /></td>
                  <td className="px-3 py-2 w-40">
                    {tieneClasif ? (
                      <span className="text-[12px] text-slate-400">Por clasificación</span>
                    ) : (
                      <CeldaTexto tipo="number" valor={t.sla_horas} onGuardar={(v) => void guardar("tipos", t.codigo, { sla_horas: v === "" ? null : Number(v) })} />
                    )}
                  </td>
                  <td className="px-3 py-2"><CeldaTexto tipo="number" ancho="w-20" valor={t.sort_order} onGuardar={(v) => void guardar("tipos", t.codigo, { sort_order: Number(v) })} /></td>
                  <td className="px-3 py-2"><Interruptor etiqueta="Activo" activo={t.activo} onCambio={(v) => void guardar("tipos", t.codigo, { activo: v })} /></td>
                  <td className="w-6 py-2">{ok(t.codigo)}</td>
                </tr>
              );
            })}
          </Tabla>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <input className={`${claseInput} max-w-xs`} placeholder="Nombre del nuevo tipo" value={nuevo.nombre} onChange={(e) => setNuevo((n) => ({ ...n, nombre: e.target.value }))} />
            <Boton onClick={() => void agregar("tipos", { nombre: nuevo.nombre, sort_order: cat.tipos.length + 1, activo: true })} disabled={!nuevo.nombre.trim()}>
              <Plus className="h-4 w-4" aria-hidden /> Nuevo tipo
            </Boton>
          </div>
        </Tarjeta>
      ) : null}

      {tab === "prioridades" ? (
        <Tarjeta titulo="Prioridades" icono={Flag} tono="ambar">
          <Tabla columnas={["Nombre", "Color", "Orden", "Activo", ""]}>
            {cat.prioridades.map((p) => (
              <tr key={p.codigo} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-3"><CeldaTexto valor={p.nombre} onGuardar={(v) => void guardar("prioridades", p.codigo, { nombre: v })} /></td>
                <td className="px-3 py-2">
                  <input type="color" value={p.color} onChange={(ev) => void guardar("prioridades", p.codigo, { color: ev.target.value })} className="h-8 w-10 cursor-pointer rounded border border-slate-200 bg-white p-0.5" aria-label={`Color de ${p.nombre}`} />
                </td>
                <td className="px-3 py-2"><CeldaTexto tipo="number" ancho="w-20" valor={p.sort_order} onGuardar={(v) => void guardar("prioridades", p.codigo, { sort_order: Number(v) })} /></td>
                <td className="px-3 py-2"><Interruptor etiqueta="Activo" activo={p.activo} onCambio={(v) => void guardar("prioridades", p.codigo, { activo: v })} /></td>
                <td className="w-6 py-2">{ok(p.codigo)}</td>
              </tr>
            ))}
          </Tabla>
        </Tarjeta>
      ) : null}

      {tab === "sla" ? (
        <Tarjeta titulo="Clasificaciones y service level" icono={Timer} tono="verde" accion={<span className="text-[12px] text-slate-400">Horas laborales · proceso oficial de Gestión de Soporte</span>}>
          <Tabla columnas={["Tipo", "Clasificación", "SLA (horas)", "Prioridad sugerida", "Activo", ""]}>
            {cat.clasificaciones.map((c) => (
              <tr key={c.codigo} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-3 text-slate-600">{cat.tipos.find((t) => t.codigo === c.tipo_codigo)?.nombre ?? c.tipo_codigo}</td>
                <td className="px-3 py-2"><CeldaTexto valor={c.nombre} onGuardar={(v) => void guardar("clasificaciones", c.codigo, { nombre: v })} /></td>
                <td className="px-3 py-2"><CeldaTexto tipo="number" ancho="w-24" valor={c.sla_horas} onGuardar={(v) => void guardar("clasificaciones", c.codigo, { sla_horas: Number(v) })} /></td>
                <td className="px-3 py-2 w-40">
                  <FancySelect size="sm" ariaLabel="Prioridad sugerida" value={c.prioridad_sugerida ?? ""} onChange={(v) => void guardar("clasificaciones", c.codigo, { prioridad_sugerida: v || null })} options={[{ value: "", label: "Ninguna" }, ...cat.prioridades.map((p) => ({ value: p.codigo, label: p.nombre }))]} />
                </td>
                <td className="px-3 py-2"><Interruptor etiqueta="Activo" activo={c.activo} onCambio={(v) => void guardar("clasificaciones", c.codigo, { activo: v })} /></td>
                <td className="w-6 py-2">{ok(c.codigo)}</td>
              </tr>
            ))}
          </Tabla>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <div className="w-40">
              <FancySelect size="sm" ariaLabel="Tipo" value={nuevo.tipo_codigo} onChange={(v) => setNuevo((n) => ({ ...n, tipo_codigo: v }))} options={cat.tipos.map((t) => ({ value: t.codigo, label: t.nombre }))} />
            </div>
            <input className={`${claseInput} max-w-xs`} placeholder="Nombre de la clasificación" value={nuevo.nombre} onChange={(e) => setNuevo((n) => ({ ...n, nombre: e.target.value }))} />
            <input type="number" className={`${claseInput} w-28`} placeholder="Horas" value={nuevo.sla_horas} onChange={(e) => setNuevo((n) => ({ ...n, sla_horas: e.target.value }))} />
            <Boton
              onClick={() => void guardar("clasificaciones", null, { nombre: nuevo.nombre, sla_horas: Number(nuevo.sla_horas), sort_order: cat.clasificaciones.length + 1, activo: true }, { tipo_codigo: nuevo.tipo_codigo }).then((r) => r && setNuevo({ nombre: "", tipo_codigo: "error", sla_horas: "" }))}
              disabled={!nuevo.nombre.trim() || !(Number(nuevo.sla_horas) > 0)}
            >
              <Plus className="h-4 w-4" aria-hidden /> Nueva clasificación
            </Boton>
            <p className="w-full text-[12px] text-slate-400">
              Cambiar un SLA afecta a los tickets nuevos. Los tickets existentes conservan el SLA con el que se crearon.
            </p>
          </div>
        </Tarjeta>
      ) : null}

      {tab === "equipos" ? (
        <Tarjeta titulo="Equipos" icono={Users} tono="turquesa" accion={<span className="text-[12px] text-slate-400">Se toman de los tildes de Usuarios</span>}>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {(["PM", "Desarrollo", "QA", "Admin"] as const).map((area) => {
              const gente = cat.personas.filter((p) => p.area === area);
              return (
                <div key={area}>
                  <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">
                    {area} <span className="font-normal text-slate-400">({gente.length})</span>
                  </p>
                  {gente.length ? (
                    <ul className="space-y-2">
                      {gente.map((p) => (
                        <li key={p.id} className="flex items-center gap-2 text-[13px] text-slate-700">
                          <Avatar nombre={p.nombre} tam={26} /> {p.nombre}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[12.5px] text-slate-400">Nadie con ese rol.</p>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-5 border-t border-slate-100 pt-4 text-[12.5px] text-slate-500">
            Los equipos salen de Usuarios (tildes PM, técnico y QA), los mismos que usa Proyectos. Al cambiar de estado un ticket, el sistema sugiere responsables del área que corresponde.
          </p>
        </Tarjeta>
      ) : null}

      {tab === "notificaciones" ? (
        <Tarjeta titulo={tituloTab} icono={Bell} tono="rosa">
          <div className="flex gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-rose-100 text-rose-500">
              <Bell className="h-4 w-4" aria-hidden />
            </span>
            <div className="text-[13px] leading-relaxed text-slate-600">
              <p className="font-medium text-slate-800">Todavía no hay avisos automáticos de Soporte.</p>
              <p className="mt-1">
                Mientras el módulo sea sólo de administradores, los cambios se ven en el Dashboard, en Mis tickets y en el historial de cada ticket. Cuando se habilite a PM, Desarrollo y QA, los avisos a la campanita (asignación, entrega a QA, devolución, SLA en riesgo) se configuran acá.
              </p>
            </div>
          </div>
        </Tarjeta>
      ) : null}
    </>
  );
}

export default function SoporteConfiguracionPage() {
  return (
    <Pagina>
      <Encabezado titulo="Configuración de Soporte" subtitulo="Parámetros y catálogos del módulo" icono={Settings2} tono="pizarra" />
      <Suspense fallback={<Cargando />}>
        <Contenido />
      </Suspense>
    </Pagina>
  );
}
