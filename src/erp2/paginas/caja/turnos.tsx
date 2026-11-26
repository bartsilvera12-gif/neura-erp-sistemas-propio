"use client";

/**
 * Caja › Apertura y cierre. Estado de cada caja de la sucursal (ADMIN: de todas):
 *   · abierta: turno, quién la abrió, ventas y efectivo esperado → ver turno, retiro /
 *     ingreso de efectivo, cerrar con arqueo
 *   · cerrada: último cierre → abrir un turno nuevo
 *   · resumen del día y los últimos cierres (con su PDF)
 *   · ADMIN: alta / edición de cajas (nombre, sucursal, depósito de salida)
 * ?abrir=1 abre la ventana de apertura; ?cerrar=<turno> la de cierre (links del POS).
 */
import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftRight, Building2, Clock, Eye, Loader2, Lock, Printer, Settings2, ShoppingCart, Unlock, Wallet } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { imprimirArchivo } from "@/erp2/lib/api/client-blob";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, Cabecera, TEAL } from "@/erp2/modules/inventario/ui";
import { AccionesPagina } from "@/erp2/components/EncabezadoPagina";
import { TablaTarjetas } from "@/erp2/components/TablaResponsive";
import { desdeTurno, fechaHora, hora, invalidarCajas, useEstadoCajas, type CajaPunto, type EstadoCajas } from "@/erp2/modules/caja/turno";
import { formatGs } from "@/erp2/modules/caja/lib";
import { AperturaModal } from "@/erp2/modules/caja/AperturaModal";
import { MovimientoModal } from "@/erp2/modules/caja/MovimientoModal";
import { CierreModal } from "@/erp2/modules/caja/CierreModal";
import { TurnoModal } from "@/erp2/modules/caja/TurnoModal";
import { ConfigurarCajasModal } from "@/erp2/modules/caja/ConfigurarCajas";
import { AvisoTurnoViejo } from "@/erp2/modules/caja/AvisoTurnoViejo";

type Dia = {
  fecha: string;
  totales: { turnos: number; abiertos: number; total_vendido: number; ventas_contado: number; ventas_credito: number; cobros: number; efectivo_esperado: number; diferencia: number };
  /** Receta 92: lo vendido / cobrado en el día por la fecha de cada venta (null si falta la receta). */
  hoy?: { total_vendido: number; ventas_contado: number; ventas_credito: number; cantidad_ventas: number; cobros: number } | null;
};

export default function TurnosPage() {
  return (
    <Suspense>
      <TurnosContenido />
    </Suspense>
  );
}

function TurnosContenido() {
  const sp = useSearchParams();
  const router = useRouter();
  const [recarga, setRecarga] = useState(0);
  const { datos, error, cargando } = useEstadoCajas(recarga);
  const [dia, setDia] = useState<Dia | null>(null);
  const [abrir, setAbrir] = useState<{ punto: string | null } | null>(null);
  const [mov, setMov] = useState<{ turno: string; etiqueta: string; efectivo: number } | null>(null);
  const [cerrar, setCerrar] = useState<string | null>(null);
  const [ver, setVer] = useState<string | null>(null);
  const [config, setConfig] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const refrescar = useCallback(() => {
    invalidarCajas();
    setRecarga((k) => k + 1);
  }, []);

  useEffect(() => {
    apiFetch<Dia>("/api/caja/dia").then(setDia).catch(() => {});
  }, [recarga]);

  // Pedidos por URL (desde el POS o el menú).
  useEffect(() => {
    if (!datos) return;
    const c = sp.get("cerrar");
    if (c) setCerrar(c);
    if (sp.get("abrir") === "1") setAbrir({ punto: sp.get("punto") });
    if (c || sp.get("abrir")) router.replace("/caja/turnos", { scroll: false });
  }, [datos, sp, router]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 5000);
    return () => clearTimeout(t);
  }, [aviso]);

  const sucursales = (datos?.sucursales ?? []).filter((s) => s.activa || s.cajas.some((c) => c.turno));
  const abiertas = datos?.abiertas.length ?? 0;
  // Lo vendido en el día (receta 92); sin la receta, los totales de los turnos abiertos hoy.
  const hoy = dia ? (dia.hoy ?? dia.totales) : null;

  return (
    <div className="space-y-6 pb-10">
      <Cabecera volver={{ href: "/caja/panel", label: "Caja" }} kicker="Caja" titulo="Apertura y cierre"
        subtitulo={datos ? (datos.es_admin ? "Las cajas de todas las sucursales: abrí, mové efectivo y cerrá con arqueo" : `Las cajas de ${sucursales[0]?.nombre ?? "tu sucursal"}`) : "Cargando cajas…"}>
        {/* Celular: "Abrir caja" e "Ir a vender" a la vista; configurar en "⋯". */}
        <div className="w-full sm:w-auto"><AccionesPagina acciones={[
          { etiqueta: "Abrir caja", icono: <Unlock />, onClick: () => setAbrir({ punto: null }), primaria: true, deshabilitada: !datos },
          { etiqueta: "Ir a vender", icono: <ShoppingCart />, href: "/caja/nueva", primaria: true },
          ...(datos?.es_admin ? [{ etiqueta: "Configurar cajas", icono: <Settings2 />, onClick: () => setConfig(true) }] : []),
        ]} /></div>
      </Cabecera>

      {aviso ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-800">{aviso}</p> : null}

      {/* Resumen del día */}
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-sm sm:grid-cols-3 lg:grid-cols-5 [&>*]:bg-white">
        <Cifra label="Cajas abiertas" valor={String(abiertas)} icono={Wallet} />
        <Cifra label="Vendido hoy" valor={hoy ? formatGs(hoy.total_vendido) : "…"} icono={ShoppingCart} destacado />
        <Cifra label="Contado" valor={hoy ? formatGs(hoy.ventas_contado) : "…"} icono={Wallet} />
        <Cifra label="Crédito" valor={hoy ? formatGs(hoy.ventas_credito) : "…"} icono={Clock} />
        <Cifra label="Cobros de cuentas" valor={hoy ? formatGs(hoy.cobros) : "…"} icono={ArrowLeftRight} />
      </section>
      <p className="-mt-4 text-[11px] text-slate-400">
        {dia?.hoy ? `Lo vendido hoy${dia.hoy.cantidad_ventas ? ` (${dia.hoy.cantidad_ventas.toLocaleString("es-PY")} venta${dia.hoy.cantidad_ventas === 1 ? "" : "s"})` : ""}, sin las anuladas. El detalle del turno, en cada caja.` : "Turnos abiertos hoy. El resto del detalle, en cada caja."}
      </p>

      {cargando ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : error ? (
        <p className="rounded-xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-700">No se pudieron cargar las cajas: {error}</p>
      ) : (
        sucursales.map((s) => (
          <section key={s.id}>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Building2 className="h-4 w-4" style={{ color: TEAL }} /> {s.nombre}
              {s.es_principal ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">Principal</span> : null}
            </h2>
            {s.cajas.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
                Esta sucursal no tiene cajas.
                {datos?.es_admin ? <button type="button" onClick={() => setConfig(true)} className="ml-1 font-semibold text-[var(--brand)] hover:underline">Crear una</button> : " Pedile a un administrador que cree una."}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {s.cajas.filter((c) => c.activo || c.turno).map((c) => (
                  <TarjetaCaja key={c.id} c={c} estado={datos!}
                    onAbrir={() => setAbrir({ punto: c.id })}
                    onVer={() => c.turno && setVer(c.turno.id)}
                    onMov={() => c.turno && setMov({ turno: c.turno.id, etiqueta: `${c.nombre} · ${s.nombre} · Turno N° ${c.turno.numero_caja}`, efectivo: c.turno.efectivo_esperado })}
                    onCerrar={() => c.turno && setCerrar(c.turno.id)} />
                ))}
              </div>
            )}
          </section>
        ))
      )}

      {/* Últimos cierres */}
      {datos && datos.recientes.length ? (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">Últimos cierres</h2>
            {/* Neura: el reporte de todos los cierres todavía no está. */}
          </div>
          {/* Celular: cada cierre es una tarjeta (caja + diferencia; ver / PDF al pie). */}
          <TablaTarjetas
            filas={datos.recientes}
            claveFila={(t) => t.id}
            onFila={(t) => setVer(t.id)}
            claseThead="bg-slate-50"
            thBase="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"
            tdBase="px-4 py-2.5"
            columnas={[
              { key: "turno", titulo: "Turno", claseTd: "font-mono text-xs text-slate-500", movil: "subtitulo", celda: (t) => `N° ${t.numero_caja}` },
              { key: "caja", titulo: "Caja", claseTd: "text-slate-800", movil: "titulo", celda: (t) => <>{t.punto_nombre} <span className="font-normal text-slate-400">· {t.sucursal_nombre}</span></> },
              { key: "fechas", titulo: "Apertura → cierre", claseTd: "text-xs tabular-nums text-slate-500", movil: "dato", etiquetaMovil: "Apertura → cierre", celda: (t) => <>{fechaHora(t.fecha_apertura)} → {t.fecha_cierre ? hora(t.fecha_cierre) : "—"}</> },
              { key: "cerro", titulo: "Cerró", claseTd: "text-xs text-slate-600", movil: "dato", celda: (t) => t.cerrada_por_nombre ?? "—" },
              { key: "vendido", titulo: "Vendido", claseTh: "!text-right", claseTd: "text-right font-semibold tabular-nums text-slate-800", movil: "valor", celda: (t) => formatGs(t.total_vendido) },
              {
                key: "dif", titulo: "Diferencia", claseTh: "!text-right", claseTd: "text-right text-xs font-semibold tabular-nums", movil: "chip",
                celda: (t) => {
                  const dif = (t.diferencia ?? 0) + (t.diferencia_otros ?? 0);
                  return (
                    <span className={`max-md:rounded-full max-md:px-2 max-md:py-0.5 max-md:text-[11px] max-md:font-semibold ${t.diferencia == null ? "text-slate-400 max-md:bg-slate-100" : dif === 0 ? "text-emerald-600 max-md:bg-emerald-50" : dif < 0 ? "text-rose-600 max-md:bg-rose-50" : "text-amber-600 max-md:bg-amber-50"}`}>
                      {t.diferencia == null ? "—" : dif === 0 ? "Cuadra" : `${dif > 0 ? "+" : "−"} ${formatGs(Math.abs(dif))}`}
                    </span>
                  );
                },
              },
              {
                key: "acc", titulo: "", claseTh: "w-24", claseTd: "px-3 py-2 text-right whitespace-nowrap", movil: "acciones",
                celda: (t) => (
                  <>
                    <button type="button" onClick={(e) => { e.stopPropagation(); setVer(t.id); }} title="Ver turno" aria-label="Ver turno" className="inline-flex items-center justify-center rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 max-md:hidden"><Eye className="h-4 w-4" /></button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); imprimirArchivo(`/api/caja/turnos/${t.id}/pdf`, `cierre-caja-${t.numero_caja}.pdf`).catch(() => {}); }} title="Imprimir cierre" aria-label="Imprimir cierre" className="inline-flex items-center justify-center rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Printer className="h-4 w-4" /></button>
                  </>
                ),
              },
            ]}
          />
        </section>
      ) : null}

      {abrir && datos ? (
        <AperturaModal estado={datos} puntoInicial={abrir.punto} onClose={() => setAbrir(null)}
          onAbierta={() => { setAbrir(null); setAviso("Caja abierta. Ya podés vender."); refrescar(); }} />
      ) : null}
      {mov ? (
        <MovimientoModal cajaId={mov.turno} etiqueta={mov.etiqueta} efectivoDisponible={mov.efectivo} onClose={() => setMov(null)}
          onHecho={(n) => { setMov(null); setAviso(`Movimiento ${n} registrado.`); refrescar(); }} />
      ) : null}
      {cerrar ? <CierreModal turnoId={cerrar} onClose={() => setCerrar(null)} onCerrada={refrescar} /> : null}
      {ver ? <TurnoModal turnoId={ver} onClose={() => setVer(null)} onCambio={refrescar} onCerrar={() => { const id = ver; setVer(null); setCerrar(id); }} /> : null}
      {config && datos ? <ConfigurarCajasModal estado={datos} onClose={() => setConfig(false)} onCambio={refrescar} /> : null}
    </div>
  );
}

function TarjetaCaja({ c, estado, onAbrir, onVer, onMov, onCerrar }: {
  c: CajaPunto; estado: EstadoCajas; onAbrir: () => void; onVer: () => void; onMov: () => void; onCerrar: () => void;
}) {
  const t = c.turno;
  const mia = t && t.abierta_por === estado.mi_usuario_id;
  if (!t) {
    const u = c.ultimo_cierre;
    const dif = u ? (u.diferencia ?? 0) + (u.diferencia_otros ?? 0) : 0;
    return (
      <div className={`flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${c.activo ? "" : "opacity-60"}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="flex items-center gap-2 text-base font-semibold text-slate-900">{c.nombre}
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{c.activo ? "Cerrada" : "Inactiva"}</span>
            </p>
            <p className="mt-0.5 text-xs text-slate-500">Sale de {c.deposito_nombre}</p>
          </div>
          <Lock className="h-4 w-4 text-slate-300" />
        </div>
        <p className="mt-3 flex-1 text-xs text-slate-500">
          {u?.fecha_cierre ? <>Último cierre {fechaHora(u.fecha_cierre)}{u.cerrada_por_nombre ? ` · ${u.cerrada_por_nombre}` : ""} · <span className={dif === 0 ? "text-emerald-600" : "text-rose-600"}>{dif === 0 ? "cuadró" : `diferencia ${formatGs(dif)}`}</span></> : "Todavía no tuvo turnos."}
        </p>
        {c.activo ? (
          <button type="button" onClick={onAbrir} className={`${BOTON_PRIMARIO} mt-4 w-full max-sm:min-h-11`} style={{ backgroundColor: TEAL }}><Unlock className="h-4 w-4" /> Abrir caja</button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm ring-1 ring-emerald-500/5">
      <div className="bg-gradient-to-r from-emerald-50/80 to-white px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold text-slate-900">
              <span className="relative flex h-2.5 w-2.5 shrink-0"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" /></span>
              {c.nombre}
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">Abierta</span>
            </p>
            <p className="mt-0.5 text-xs text-slate-500 sm:truncate">Turno N° {t.numero_caja} · {t.abierta_por_nombre ?? "—"}{mia ? " (vos)" : ""} · desde {desdeTurno(t.fecha_apertura)}</p>
          </div>
          <button type="button" onClick={onVer} title="Ver turno" aria-label="Ver turno" className="-mr-1.5 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-slate-700 sm:m-0 sm:h-auto sm:w-auto sm:p-1.5"><Eye className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="grid grid-cols-3 divide-x divide-slate-100 border-y border-slate-100 text-center">
        <Mini label="Inicial" valor={formatGs(t.monto_apertura)} />
        <Mini label={`Ventas del turno (${t.ventas_cantidad})`} valor={formatGs(t.ventas_total)} />
        <Mini label="Efectivo esperado" valor={formatGs(t.efectivo_esperado)} destacado />
      </div>
      <AvisoTurnoViejo fechaApertura={t.fecha_apertura} onCerrar={onCerrar} compacto className="mx-3 mt-3" />
      <div className="flex gap-2 p-3">
        <button type="button" onClick={onMov} className={`${BOTON_SECUNDARIO} flex-1 max-sm:min-h-11`}><ArrowLeftRight className="h-4 w-4" /> Retiro / ingreso</button>
        <button type="button" onClick={onCerrar} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3.5 py-2 text-sm max-sm:min-h-11 font-semibold text-rose-600 shadow-sm transition hover:bg-rose-50">
          <Lock className="h-4 w-4" /> Cerrar
        </button>
      </div>
      <p className="px-4 pb-3 text-[11px] text-slate-400">Sale de {c.deposito_nombre}</p>
    </div>
  );
}

function Mini({ label, valor, destacado }: { label: string; valor: string; destacado?: boolean }) {
  return (
    <div className="px-2 py-2.5" style={destacado ? { backgroundColor: `${TEAL}10` } : undefined}>
      <p className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-[13px] font-bold tabular-nums [overflow-wrap:anywhere] sm:truncate sm:text-sm" style={{ color: destacado ? TEAL : "#0f172a" }}>{valor}</p>
    </div>
  );
}

function Cifra({ label, valor, icono: Icono, destacado }: { label: string; valor: string; icono: React.ComponentType<{ className?: string }>; destacado?: boolean }) {
  return (
    <div className="min-w-0 px-4 py-3.5" style={destacado ? { backgroundColor: `${TEAL}12` } : undefined}>
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500"><Icono className="h-3 w-3" /> {label}</p>
      <p className="mt-1 truncate text-base font-bold tabular-nums sm:text-lg" style={{ color: destacado ? TEAL : "#0f172a" }}>{valor}</p>
    </div>
  );
}

