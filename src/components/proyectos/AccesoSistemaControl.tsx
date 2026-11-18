"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Ban, CheckCircle2, Code2, Globe, Loader2, Lock, Plus, ShieldCheck, ShieldOff, X } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { normalizarDominio, type AccesoSistema, type AccesoSistemaAccion } from "@/lib/proyectos/acceso-sistema";

type ApiResp<T> = { success: boolean; data?: T; error?: string };

type Estado =
  | { tipo: "cargando" }
  | { tipo: "error"; mensaje: string }
  | { tipo: "listo"; acceso: AccesoSistema };

/**
 * Qué hace falta para que este sistema obedezca el botón la primera vez. Con
 * repositorio en Credenciales se activa por código (git); sin repositorio se
 * asume un sitio que se sube a mano (zip) a Hostinger.
 */
function avisoPrimeraVez(acceso: AccesoSistema): string {
  if (acceso.repositorio) {
    return `Este sistema todavía no tiene el bloqueo con botón. La primera vez hay que activarlo por código en el repositorio ${acceso.repositorio} (pedíselo a desarrollo); después ya se bloquea y desbloquea desde acá.`;
  }
  return "Este sistema todavía no tiene el bloqueo con botón y no tiene repositorio de GitHub en Credenciales: si es una web que se sube por zip a Hostinger, la primera vez hay que subir a mano los archivos del bloqueo (pedíselos a desarrollo). Después ya se bloquea y desbloquea desde acá.";
}

function avisoNoAplica(acceso: AccesoSistema): string {
  return `Figura bloqueado acá, pero el sistema del cliente todavía no consulta este botón: no se aplica hasta activarlo la primera vez (${
    acceso.repositorio ? `por código en ${acceso.repositorio}` : "subiendo por zip los archivos del bloqueo a Hostinger"
  }).`;
}

function fechaHora(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

function useAccesoSistema(proyectoId: string) {
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });
  const [guardando, setGuardando] = useState<AccesoSistemaAccion | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetchWithSupabaseSession(`/api/proyectos/${encodeURIComponent(proyectoId)}/acceso`, {
        cache: "no-store",
      });
      const j = (await res.json().catch(() => null)) as ApiResp<AccesoSistema> | null;
      if (!res.ok || !j?.success || !j.data) {
        setEstado({ tipo: "error", mensaje: j?.error ?? "No se pudo leer el estado del sistema." });
        return;
      }
      setEstado({ tipo: "listo", acceso: j.data });
    } catch {
      setEstado({ tipo: "error", mensaje: "No se pudo leer el estado del sistema." });
    }
  }, [proyectoId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const ejecutar = useCallback(
    async (accion: AccesoSistemaAccion, dominios?: string[]) => {
      setGuardando(accion);
      setErrorAccion(null);
      try {
        const res = await fetchWithSupabaseSession(`/api/proyectos/${encodeURIComponent(proyectoId)}/acceso`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(dominios ? { accion, dominios } : { accion }),
        });
        const j = (await res.json().catch(() => null)) as ApiResp<AccesoSistema> | null;
        if (!res.ok || !j?.success || !j.data) {
          setErrorAccion(j?.error ?? "No se pudo guardar.");
          return false;
        }
        setEstado({ tipo: "listo", acceso: j.data });
        return true;
      } catch {
        setErrorAccion("No se pudo guardar.");
        return false;
      } finally {
        setGuardando(null);
      }
    },
    [proyectoId]
  );

  return { estado, guardando, errorAccion, ejecutar };
}

function PillEstado({ suspendido }: { suspendido: boolean }) {
  return suspendido ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10.5px] font-semibold text-rose-700">
      <Ban className="h-3 w-3" aria-hidden /> Sistema bloqueado
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700">
      <CheckCircle2 className="h-3 w-3" aria-hidden /> Sistema activo
    </span>
  );
}

/**
 * Botón Bloquear / Desbloquear con un segundo clic de confirmación: una sola
 * pulsación accidental no deja a un cliente sin sistema.
 */
function BotonAcceso({
  suspendido,
  guardando,
  deshabilitado,
  onConfirmar,
  chico = false,
}: {
  suspendido: boolean;
  guardando: boolean;
  deshabilitado?: boolean;
  onConfirmar: () => void;
  chico?: boolean;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const tam = chico ? "px-2.5 py-1 text-[11px]" : "px-3.5 py-2 text-sm";

  if (guardando) {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-lg bg-slate-100 font-semibold text-slate-500 ${tam}`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Guardando…
      </span>
    );
  }

  if (confirmando) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className={chico ? "text-[11px] text-slate-600" : "text-sm text-slate-600"}>
          {suspendido ? "¿Desbloquear el sistema?" : "¿Bloquear el sistema del cliente?"}
        </span>
        <button
          type="button"
          onClick={() => {
            setConfirmando(false);
            onConfirmar();
          }}
          className={`inline-flex items-center gap-1 rounded-lg font-semibold text-white shadow-sm ${tam} ${
            suspendido ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"
          }`}
        >
          Sí, {suspendido ? "desbloquear" : "bloquear"}
        </button>
        <button
          type="button"
          onClick={() => setConfirmando(false)}
          className={`rounded-lg border border-slate-200 bg-white font-medium text-slate-600 hover:bg-slate-50 ${tam}`}
        >
          Cancelar
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={deshabilitado}
      onClick={() => setConfirmando(true)}
      className={`inline-flex items-center gap-1.5 rounded-lg border font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${tam} ${
        suspendido
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
      }`}
    >
      {suspendido ? <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> : <ShieldOff className="h-3.5 w-3.5" aria-hidden />}
      {suspendido ? "Desbloquear sistema" : "Bloquear sistema"}
    </button>
  );
}

/**
 * Versión de una línea para las tarjetas de Gestión de clientes: estado y
 * botón. Si el proyecto todavía no tiene dominio cargado, lleva a la pestaña
 * "Acceso" del proyecto para cargarlo.
 */
export function AccesoSistemaCompacto({ proyectoId }: { proyectoId: string }) {
  const { estado, guardando, errorAccion, ejecutar } = useAccesoSistema(proyectoId);

  if (estado.tipo === "cargando") {
    return <div className="h-7 w-40 animate-pulse rounded-lg bg-slate-100" />;
  }
  if (estado.tipo === "error") return null;

  const { acceso } = estado;
  const requiereCodigo = acceso.dominios.length > 0 && acceso.escucha === false;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <PillEstado suspendido={acceso.suspendido} />
        {acceso.puede_gestionar && requiereCodigo && !acceso.suspendido ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700"
            title={avisoPrimeraVez(acceso)}
          >
            <Code2 className="h-3 w-3" aria-hidden /> {acceso.repositorio ? "Requiere código la primera vez" : "Requiere subir zip la primera vez"}
          </span>
        ) : null}
        {acceso.puede_gestionar && acceso.dominios.length > 0 && !(requiereCodigo && !acceso.suspendido) ? (
          <BotonAcceso
            chico
            suspendido={acceso.suspendido}
            guardando={guardando !== null}
            onConfirmar={() => void ejecutar(acceso.suspendido ? "desbloquear" : "bloquear")}
          />
        ) : null}
        {acceso.puede_gestionar && requiereCodigo && acceso.suspendido ? (
          <span className="text-[10.5px] font-semibold text-amber-700" title={avisoNoAplica(acceso)}>
            El ERP todavía no lo aplica
          </span>
        ) : null}
        {acceso.puede_gestionar && acceso.dominios.length === 0 ? (
          <Link
            href={`/dashboard/proyectos/${proyectoId}?tab=acceso`}
            className="text-[11px] font-semibold text-[#3F8E91] hover:underline"
          >
            Configurar dominio para bloquear
          </Link>
        ) : null}
      </div>
      {acceso.dominios.length > 0 ? (
        <p className="truncate text-[10.5px] text-slate-400" title={acceso.dominios.join(", ")}>
          {acceso.dominios.join(" · ")}
        </p>
      ) : null}
      {errorAccion ? <p className="text-[11px] text-rose-600">{errorAccion}</p> : null}
    </div>
  );
}

/** Pestaña "Acceso" del proyecto: dominios del sistema + Bloquear / Desbloquear. */
export default function AccesoSistemaPanel({ proyectoId }: { proyectoId: string }) {
  const { estado, guardando, errorAccion, ejecutar } = useAccesoSistema(proyectoId);
  const [nuevo, setNuevo] = useState("");
  const [errorNuevo, setErrorNuevo] = useState<string | null>(null);

  if (estado.tipo === "cargando") {
    return <div className="h-48 animate-pulse rounded-2xl border border-slate-100 bg-white" />;
  }
  if (estado.tipo === "error") {
    return (
      <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{estado.mensaje}</p>
    );
  }

  const { acceso } = estado;
  const puede = acceso.puede_gestionar;
  const requiereCodigo = acceso.dominios.length > 0 && acceso.escucha === false;

  const agregar = async (raw: string) => {
    const d = normalizarDominio(raw);
    if (!d) {
      setErrorNuevo("No parece un dominio válido (ej. cliente.neura.com.py).");
      return;
    }
    setErrorNuevo(null);
    if (acceso.dominios.includes(d)) {
      setNuevo("");
      return;
    }
    if (await ejecutar("dominios", [...acceso.dominios, d])) setNuevo("");
  };

  const quitar = (d: string) => void ejecutar("dominios", acceso.dominios.filter((x) => x !== d));

  return (
    <div className="space-y-4">
      <section
        className={`rounded-2xl border bg-white p-5 shadow-sm ${acceso.suspendido ? "border-rose-200" : "border-slate-200"}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <h3 className="text-sm font-semibold text-slate-800">Acceso al sistema del cliente</h3>
            <PillEstado suspendido={acceso.suspendido} />
            {acceso.suspendido ? (
              <p className="text-xs text-slate-500">
                Bloqueado
                {fechaHora(acceso.suspendido_at) ? ` el ${fechaHora(acceso.suspendido_at)}` : ""}
                {acceso.suspendido_por_nombre ? ` por ${acceso.suspendido_por_nombre}` : ""}. Los usuarios del cliente ven
                “Acceso suspendido por falta de pago”.
              </p>
            ) : (
              <p className="text-xs text-slate-500">
                Al bloquear, el sistema del cliente muestra “Acceso suspendido por falta de pago” en menos de un minuto.
                Su web pública y sus datos no se tocan.
              </p>
            )}
          </div>
          {puede && requiereCodigo && !acceso.suspendido ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-sm font-semibold text-amber-800">
              <Code2 className="h-4 w-4" aria-hidden /> {acceso.repositorio ? "Requiere código la primera vez" : "Requiere subir zip la primera vez"}
            </span>
          ) : puede ? (
            <BotonAcceso
              suspendido={acceso.suspendido}
              guardando={guardando === "bloquear" || guardando === "desbloquear"}
              deshabilitado={!acceso.suspendido && acceso.dominios.length === 0}
              onConfirmar={() => void ejecutar(acceso.suspendido ? "desbloquear" : "bloquear")}
            />
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-slate-400">
              <Lock className="h-3.5 w-3.5" aria-hidden /> Sin permiso para bloquear
            </span>
          )}
        </div>
        {puede && requiereCodigo ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
            {acceso.suspendido ? avisoNoAplica(acceso) : avisoPrimeraVez(acceso)}
          </p>
        ) : null}
        {errorAccion ? <p className="mt-3 text-sm text-rose-600">{errorAccion}</p> : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          <Globe className="h-4 w-4 text-[#4FAEB2]" aria-hidden /> Dominios del sistema
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Dónde abre el ERP del cliente (ej. <span className="font-mono">cliente.neura.com.py</span>). El bloqueo aplica a
          todos los dominios de la lista.
        </p>

        <ul className="mt-3 flex flex-wrap gap-2">
          {acceso.dominios.length === 0 ? (
            <li className="text-xs italic text-slate-400">Sin dominios cargados.</li>
          ) : (
            acceso.dominios.map((d) => (
              <li
                key={d}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 py-1 pl-3 pr-1.5 font-mono text-xs text-slate-700"
              >
                {d}
                {puede ? (
                  <button
                    type="button"
                    onClick={() => quitar(d)}
                    disabled={guardando !== null}
                    className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-40"
                    aria-label={`Quitar ${d}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </li>
            ))
          )}
        </ul>

        {puede ? (
          <>
            <form
              className="mt-3 flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void agregar(nuevo);
              }}
            >
              <input
                value={nuevo}
                onChange={(e) => setNuevo(e.target.value)}
                placeholder="cliente.neura.com.py"
                className="min-w-[220px] flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
              />
              <button
                type="submit"
                disabled={!nuevo.trim() || guardando !== null}
                className="inline-flex items-center gap-1 rounded-xl bg-[#4FAEB2] px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#3F8E91] disabled:opacity-50"
              >
                <Plus className="h-4 w-4" aria-hidden /> Agregar
              </button>
            </form>
            {errorNuevo ? <p className="mt-2 text-xs text-rose-600">{errorNuevo}</p> : null}

            {acceso.sugeridos.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-400">De las credenciales:</span>
                {acceso.sugeridos.map((d) => (
                  <button
                    key={d}
                    type="button"
                    disabled={guardando !== null}
                    onClick={() => void agregar(d)}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-[#4FAEB2]/50 px-2.5 py-0.5 font-mono text-[11px] text-[#3F8E91] hover:bg-[#4FAEB2]/10 disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" aria-hidden /> {d}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}
