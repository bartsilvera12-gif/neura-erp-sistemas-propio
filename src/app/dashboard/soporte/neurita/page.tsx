"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bot, Wallet, CheckCircle2, Timer, RotateCcw, Repeat2, Flame, Server, Activity, Download, Loader2, CalendarDays, X } from "lucide-react";
import { apiSoporte } from "../_ui/api";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { Aviso, Cargando, Encabezado, Pagina, Tarjeta, Vacio, claseBoton } from "../_ui/ui";

type Ficha = { id: string | null; numero: number; asunto: string; cliente: string | null; estado_codigo: string | null; usd: number; vueltas: number };

type Resp = {
  agente: { id: string; nombre: string } | null;
  rango: { desde: string | null; hasta: string | null; activo: boolean; diasGrafico: number };
  gasto: { hoy: number; mes: number; total: number; topeMes: number; vueltasHoy: number; periodo: number; vueltasPeriodo: number };
  trabajo: {
    resueltos: number;
    abiertos: number;
    costoPorTicket: number | null;
    medianaMinutos: number | null;
    vueltasMediana: number | null;
    volvieron: number;
    ticketsConGasto: number;
  };
  hoy: Ficha[];
  dias: { fecha: string; usd: number; vueltas: number }[];
  sistemas: { nombre: string; usd: number; vueltas: number; tickets: number }[];
  volvieronLista: Ficha[];
  abiertos: (Ficha & { desde: string })[];
  caros: Ficha[];
  resueltos: (Ficha & { resuelto_at: string; volvio: boolean })[];
};

const usd = (n: number) => `US$ ${n.toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nro = (n: number) => `#${String(n).padStart(4, "0")}`;

/** 95 → "1 h 35 min". Los minutos sueltos no se leen cuando pasan de la hora. */
function duracion(min: number | null): string {
  if (min == null) return "—";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "2026-11-11" → "11/11". Dos dígitos alcanzan para un eje de catorce días. */
const diaCorto = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

function desdeHace(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const min = ms / 60_000;
  if (min < 60) return `hace ${Math.round(min)} min`;
  const h = min / 60;
  if (h < 48) return `hace ${Math.round(h)} h`;
  return `hace ${Math.round(h / 24)} días`;
}

function Dato({ etiqueta, valor, pie, icono: Icono, tono = "text-slate-400" }: { etiqueta: string; valor: string; pie?: string; icono: typeof Wallet; tono?: string }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="mb-2 flex items-center gap-2">
        <Icono className={`h-4 w-4 ${tono}`} aria-hidden />
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{etiqueta}</p>
      </div>
      <p className="text-[22px] font-semibold leading-none text-slate-800">{valor}</p>
      {pie ? <p className="mt-1.5 text-[12px] leading-snug text-slate-400">{pie}</p> : null}
    </div>
  );
}

/** Ticket con su número, asunto y cliente: la fila que se repite en todas las listas. */
function FilaTicket({ t, extra }: { t: Ficha; extra?: React.ReactNode }) {
  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="px-5 py-3">
        {t.id ? (
          <Link href={`/dashboard/soporte/tickets/${t.id}`} className="font-semibold text-[#2F7F83] hover:underline">
            {nro(t.numero)}
          </Link>
        ) : (
          <span className="font-semibold text-slate-400">{nro(t.numero)}</span>
        )}
        <p className="mt-0.5 line-clamp-1 text-[12px] text-slate-500">{t.asunto}</p>
        {t.cliente ? <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-400">{t.cliente}</p> : null}
      </td>
      {extra}
    </tr>
  );
}

export default function NeuritaPage() {
  const [d, setD] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bajando, setBajando] = useState(false);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  /** `?desde=…&hasta=…` o vacío. Lo usan la consulta y la descarga del PDF. */
  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    const q = p.toString();
    return q ? `?${q}` : "";
  }, [desde, hasta]);

  /** Día de hoy en hora local, que es la que ve quien usa la pantalla. */
  const diaISO = (resta = 0) => {
    const d = new Date();
    d.setDate(d.getDate() - resta);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const atajo = (dias: number | "mes") => {
    if (dias === "mes") {
      setDesde(diaISO().slice(0, 8) + "01");
      setHasta(diaISO());
      return;
    }
    setDesde(diaISO(dias));
    setHasta(diaISO());
  };

  /**
   * El PDF lo arma el servidor con los mismos datos de la pantalla. Se pide con
   * la sesión (no es una URL pública) y se entrega como descarga.
   */
  const descargar = async () => {
    setBajando(true);
    try {
      const r = await fetchWithSupabaseSession(`/api/soporte/neurita/pdf${query}`, { cache: "no-store" });
      if (!r || !r.ok) throw new Error("No se pudo generar el PDF");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `neurita-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      // Sin revoke, el blob queda en memoria mientras viva la pestaña.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar el PDF");
    } finally {
      setBajando(false);
    }
  };

  useEffect(() => {
    let vivo = true;
    const traer = () =>
      apiSoporte<Resp>(`/api/soporte/neurita${query}`)
        .then((r) => {
          if (!vivo) return;
          setD(r);
          setError(null);
        })
        .catch((e) => vivo && setError(e instanceof Error ? e.message : "No se pudo leer"));
    traer();
    const t = setInterval(traer, 60_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [query]);

  if (error) return <Pagina><Aviso>{error}</Aviso></Pagina>;
  if (!d) return <Pagina><Cargando /></Pagina>;

  const { gasto, trabajo } = d;
  const pctMes = gasto.topeMes > 0 ? Math.min(100, Math.round((gasto.mes / gasto.topeMes) * 100)) : 0;
  const pctVuelta = trabajo.resueltos > 0 ? Math.round((trabajo.volvieron / trabajo.resueltos) * 100) : null;
  const picoDia = Math.max(0.01, ...d.dias.map((x) => x.usd));

  return (
    <Pagina>
      <Encabezado
        titulo={d.agente?.nombre ?? "Neurita"}
        subtitulo="Qué hizo y cuánto costó el agente de IA"
        icono={Bot}
        tono="violeta"
        acciones={
          <button type="button" onClick={descargar} disabled={bajando} className={claseBoton("secundario")}>
            {bajando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
            {bajando ? "Generando…" : "Descargar PDF"}
          </button>
        }
      />

      {/* Filtro de fechas: los atajos cubren el 90% y las dos cajas el resto. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        {([["Hoy", 0], ["7 días", 6], ["30 días", 29], ["Este mes", "mes"]] as const).map(([et, v]) => (
          <button
            key={et}
            type="button"
            onClick={() => atajo(v as number | "mes")}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-[12px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
          >
            {et}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
        <label className="sr-only" htmlFor="neurita-desde">Desde</label>
        <input
          id="neurita-desde"
          type="date"
          value={desde}
          max={hasta || undefined}
          onChange={(e) => setDesde(e.target.value)}
          className="rounded-lg border border-slate-200 px-2 py-1 text-[12px] text-slate-700 outline-none focus:border-[#7DCFD2]"
        />
        <span className="text-[12px] text-slate-400">a</span>
        <label className="sr-only" htmlFor="neurita-hasta">Hasta</label>
        <input
          id="neurita-hasta"
          type="date"
          value={hasta}
          min={desde || undefined}
          onChange={(e) => setHasta(e.target.value)}
          className="rounded-lg border border-slate-200 px-2 py-1 text-[12px] text-slate-700 outline-none focus:border-[#7DCFD2]"
        />
        {(desde || hasta) && (
          <button
            type="button"
            onClick={() => {
              setDesde("");
              setHasta("");
            }}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-3.5 w-3.5" aria-hidden /> Todo el historial
          </button>
        )}
        <span className="ml-auto text-[11px] text-slate-400">
          {d.rango.activo ? "Los números de abajo son del período elegido" : "Sin filtro: todo el historial"}
        </span>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Dato
          etiqueta={d.rango.activo ? "Gasto del período" : "Gastó hoy"}
          valor={usd(d.rango.activo ? gasto.periodo : gasto.hoy)}
          pie={`${d.rango.activo ? gasto.vueltasPeriodo : gasto.vueltasHoy} ${(d.rango.activo ? gasto.vueltasPeriodo : gasto.vueltasHoy) === 1 ? "vuelta" : "vueltas"} del modelo`}
          icono={Wallet}
          tono="text-violet-500"
        />
        <Dato etiqueta="Este mes" valor={usd(gasto.mes)} pie={`${pctMes}% del tope de ${usd(gasto.topeMes)}`} icono={Wallet} tono="text-violet-500" />
        <Dato etiqueta="Total histórico" valor={usd(gasto.total)} pie="no cambia con el filtro" icono={Wallet} />
        <Dato etiqueta="Resueltos" valor={String(trabajo.resueltos)} pie={trabajo.abiertos ? `${trabajo.abiertos} abiertos ahora` : "ninguno abierto"} icono={CheckCircle2} tono="text-emerald-500" />
        <Dato etiqueta="Costo por ticket" valor={trabajo.costoPorTicket == null ? "—" : usd(trabajo.costoPorTicket)} pie="todo lo gastado ÷ resueltos" icono={Wallet} />
        <Dato
          etiqueta="Le volvieron"
          valor={pctVuelta == null ? "—" : `${pctVuelta}%`}
          pie={`${trabajo.volvieron} de ${trabajo.resueltos} se reabrieron`}
          icono={RotateCcw}
          tono={trabajo.volvieron > 0 ? "text-rose-500" : "text-slate-400"}
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Dato etiqueta="Tarda (mediana)" valor={duracion(trabajo.medianaMinutos)} pie="desde que lo toma hasta que lo resuelve" icono={Timer} tono="text-sky-500" />
        <Dato
          etiqueta="Vueltas por ticket (mediana)"
          valor={trabajo.vueltasMediana == null ? "—" : String(trabajo.vueltasMediana)}
          pie={`sobre ${trabajo.ticketsConGasto} ${trabajo.ticketsConGasto === 1 ? "ticket" : "tickets"} con gasto informado`}
          icono={Repeat2}
          tono="text-amber-500"
        />
      </div>

      <Tarjeta titulo={d.rango.activo ? `Gasto por día (${d.rango.diasGrafico} días)` : "Gasto de los últimos 14 días"} icono={Activity} tono="violeta" className="mb-5">
        <div className="flex h-40 gap-1.5">
          {d.dias.map((x) => (
            <div
              key={x.fecha}
              className="flex h-full min-w-0 flex-1 flex-col items-center gap-1"
              title={`${diaCorto(x.fecha)} · ${usd(x.usd)} · ${x.vueltas} ${x.vueltas === 1 ? "vuelta" : "vueltas"}`}
            >
              <span className="h-4 text-[10px] tabular-nums leading-4 text-slate-500">{x.usd > 0 ? x.usd.toFixed(2) : ""}</span>
              {/* La caja marca el alto; la barra se apoya en su piso. */}
              <div className="relative w-full flex-1">
                <div
                  className={`absolute bottom-0 w-full rounded-t ${x.usd > 0 ? "bg-violet-400" : "bg-slate-100"}`}
                  style={{ height: x.usd > 0 ? `${Math.max(6, (x.usd / picoDia) * 100)}%` : "2px" }}
                />
              </div>
              <span className="text-[10px] tabular-nums text-slate-400">{diaCorto(x.fecha)}</span>
            </div>
          ))}
        </div>
      </Tarjeta>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Tarjeta titulo="En qué está ahora" icono={Bot} tono="violeta" padding="p-0" accion={<span className="text-[11px] text-slate-400">no depende del filtro</span>}>
          {d.abiertos.length === 0 ? (
            <div className="p-5"><Vacio titulo="No tiene nada abierto" detalle="Cuando tome un ticket aparece acá, con cuánto hace que lo tiene." icono={Bot} tono="violeta" /></div>
          ) : (
            <table className="w-full text-left text-[13px]">
              <tbody>
                {d.abiertos.map((t) => (
                  <FilaTicket
                    key={t.numero}
                    t={t}
                    extra={
                      <td className="px-5 py-3 text-right">
                        <p className="text-[12px] font-medium text-slate-600">{desdeHace(t.desde)}</p>
                        <p className="mt-0.5 text-[11px] text-slate-400">{t.vueltas} {t.vueltas === 1 ? "vuelta" : "vueltas"} · {usd(t.usd)}</p>
                      </td>
                    }
                  />
                ))}
              </tbody>
            </table>
          )}
        </Tarjeta>

        <Tarjeta titulo="Los que le volvieron" icono={RotateCcw} tono="rosa" padding="p-0">
          {d.volvieronLista.length === 0 ? (
            <div className="p-5"><Vacio titulo="Ninguno volvió" detalle="Los tickets que dio por resueltos y después se reabrieron aparecen acá." icono={RotateCcw} tono="rosa" /></div>
          ) : (
            <table className="w-full text-left text-[13px]">
              <tbody>
                {d.volvieronLista.map((t) => (
                  <FilaTicket key={t.numero} t={t} extra={<td className="px-5 py-3 text-right tabular-nums text-[12px] text-slate-500">{t.vueltas} {t.vueltas === 1 ? "vuelta" : "vueltas"}</td>} />
                ))}
              </tbody>
            </table>
          )}
        </Tarjeta>

        <Tarjeta titulo={d.rango.activo ? "Lo que trabajó en el período" : "Lo que trabajó hoy"} icono={Bot} tono="violeta" padding="p-0">
          {d.hoy.length === 0 ? (
            <div className="p-5"><Vacio titulo={d.rango.activo ? "No trabajó nada en ese período" : "Hoy todavía no trabajó"} icono={Bot} tono="violeta" /></div>
          ) : (
            <table className="w-full text-left text-[13px]">
              <tbody>
                {d.hoy.map((t) => (
                  <FilaTicket
                    key={t.numero}
                    t={t}
                    extra={
                      <td className="px-5 py-3 text-right">
                        <p className="font-semibold tabular-nums text-slate-700">{usd(t.usd)}</p>
                        <p className="mt-0.5 text-[11px] text-slate-400">{t.vueltas} {t.vueltas === 1 ? "vuelta" : "vueltas"}</p>
                      </td>
                    }
                  />
                ))}
              </tbody>
            </table>
          )}
        </Tarjeta>

        <Tarjeta titulo="Los que más costaron" icono={Flame} tono="ambar" padding="p-0">
          {d.caros.length === 0 ? (
            <div className="p-5"><Vacio titulo="Todavía no hay gasto por ticket" icono={Flame} tono="ambar" /></div>
          ) : (
            <table className="w-full text-left text-[13px]">
              <tbody>
                {d.caros.map((t) => (
                  <FilaTicket
                    key={t.numero}
                    t={t}
                    extra={
                      <td className="px-5 py-3 text-right">
                        <p className="font-semibold tabular-nums text-slate-700">{usd(t.usd)}</p>
                        <p className="mt-0.5 text-[11px] text-slate-400">{t.vueltas} {t.vueltas === 1 ? "vuelta" : "vueltas"}</p>
                      </td>
                    }
                  />
                ))}
              </tbody>
            </table>
          )}
        </Tarjeta>

        <Tarjeta titulo="En qué sistemas gastó" icono={Server} tono="celeste" padding="p-0" className="xl:col-span-2">
          {d.sistemas.length === 0 ? (
            <div className="p-5"><Vacio titulo="Sin gasto informado todavía" icono={Server} tono="celeste" /></div>
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-2.5">Sistema</th>
                  <th className="px-3 py-2.5 text-right">Tickets</th>
                  <th className="px-3 py-2.5 text-right">Vueltas</th>
                  <th className="px-5 py-2.5 text-right">Gasto</th>
                </tr>
              </thead>
              <tbody>
                {d.sistemas.map((s) => (
                  <tr key={s.nombre} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 font-medium text-slate-700">{s.nombre}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-600">{s.tickets || "—"}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-600">{s.vueltas}</td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums text-slate-700">{usd(s.usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Tarjeta>

        <Tarjeta titulo={`Todo lo que resolvió (${d.resueltos.length})`} icono={CheckCircle2} tono="verde" padding="p-0" className="xl:col-span-2">
          {d.resueltos.length === 0 ? (
            <div className="p-5"><Vacio titulo="Todavía no resolvió ninguno" icono={CheckCircle2} tono="verde" /></div>
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-2.5">Ticket</th>
                  <th className="px-3 py-2.5">Lo resolvió</th>
                  <th className="px-5 py-2.5 text-right">Costo</th>
                </tr>
              </thead>
              <tbody>
                {d.resueltos.map((t) => (
                  <FilaTicket
                    key={t.numero}
                    t={t}
                    extra={
                      <>
                        <td className="px-3 py-3 text-[12px] text-slate-500">
                          {new Date(t.resuelto_at).toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit" })}
                          {t.volvio ? <span className="ml-2 rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-600">volvió</span> : null}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {t.usd > 0 ? (
                            <>
                              <p className="font-semibold tabular-nums text-slate-700">{usd(t.usd)}</p>
                              <p className="mt-0.5 text-[11px] text-slate-400">{t.vueltas} {t.vueltas === 1 ? "vuelta" : "vueltas"}</p>
                            </>
                          ) : (
                            <span className="text-[12px] text-slate-300" title="Se resolvió antes de que el agente empezara a informar su gasto">sin dato</span>
                          )}
                        </td>
                      </>
                    }
                  />
                ))}
              </tbody>
            </table>
          )}
        </Tarjeta>
      </div>

      <p className="mt-5 text-[12px] leading-relaxed text-slate-400">
        El gasto se cuenta desde que el agente empezó a informarlo (11/11/2026): lo de antes no está. Los tickets resueltos, los tiempos y las
        reaperturas salen del historial y cubren todo. &quot;Vueltas&quot; es cuántas veces trabajó el modelo sobre ese ticket.
      </p>
    </Pagina>
  );
}
