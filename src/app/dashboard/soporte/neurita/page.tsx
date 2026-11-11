"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bot, Wallet, CheckCircle2, Timer, RotateCcw, Repeat2, Flame, Server, Activity } from "lucide-react";
import { apiSoporte } from "../_ui/api";
import { Aviso, Cargando, Encabezado, Pagina, Tarjeta, Vacio } from "../_ui/ui";

type Ficha = { id: string | null; numero: number; asunto: string; cliente: string | null; estado_codigo: string | null; usd: number; vueltas: number };

type Resp = {
  agente: { id: string; nombre: string } | null;
  gasto: { hoy: number; mes: number; total: number; topeMes: number; vueltasHoy: number };
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

  useEffect(() => {
    let vivo = true;
    const traer = () =>
      apiSoporte<Resp>("/api/soporte/neurita")
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
  }, []);

  if (error) return <Pagina><Aviso>{error}</Aviso></Pagina>;
  if (!d) return <Pagina><Cargando /></Pagina>;

  const { gasto, trabajo } = d;
  const pctMes = gasto.topeMes > 0 ? Math.min(100, Math.round((gasto.mes / gasto.topeMes) * 100)) : 0;
  const pctVuelta = trabajo.resueltos > 0 ? Math.round((trabajo.volvieron / trabajo.resueltos) * 100) : null;
  const picoDia = Math.max(0.01, ...d.dias.map((x) => x.usd));

  return (
    <Pagina>
      <Encabezado titulo={d.agente?.nombre ?? "Neurita"} subtitulo="Qué hizo y cuánto costó el agente de IA" icono={Bot} tono="violeta" />

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Dato etiqueta="Gastó hoy" valor={usd(gasto.hoy)} pie={`${gasto.vueltasHoy} ${gasto.vueltasHoy === 1 ? "vuelta" : "vueltas"} del modelo`} icono={Wallet} tono="text-violet-500" />
        <Dato etiqueta="Este mes" valor={usd(gasto.mes)} pie={`${pctMes}% del tope de ${usd(gasto.topeMes)}`} icono={Wallet} tono="text-violet-500" />
        <Dato etiqueta="Total" valor={usd(gasto.total)} pie="desde que empezó a informar" icono={Wallet} />
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

      <Tarjeta titulo="Gasto de los últimos 14 días" icono={Activity} tono="violeta" className="mb-5">
        <div className="flex h-36 items-end gap-1.5">
          {d.dias.map((x) => (
            <div key={x.fecha} className="flex min-w-0 flex-1 flex-col items-center gap-1.5" title={`${diaCorto(x.fecha)} · ${usd(x.usd)} · ${x.vueltas} ${x.vueltas === 1 ? "vuelta" : "vueltas"}`}>
              <span className="text-[10px] tabular-nums text-slate-400">{x.usd > 0 ? x.usd.toFixed(0) : ""}</span>
              <div className="w-full rounded-t bg-violet-400/80" style={{ height: `${Math.max(x.usd > 0 ? 4 : 1, (x.usd / picoDia) * 100)}%` }} />
              <span className="text-[10px] tabular-nums text-slate-400">{diaCorto(x.fecha)}</span>
            </div>
          ))}
        </div>
      </Tarjeta>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Tarjeta titulo="En qué está ahora" icono={Bot} tono="violeta" padding="p-0">
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

        <Tarjeta titulo="Lo que trabajó hoy" icono={Bot} tono="violeta" padding="p-0">
          {d.hoy.length === 0 ? (
            <div className="p-5"><Vacio titulo="Hoy todavía no trabajó" icono={Bot} tono="violeta" /></div>
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
      </div>

      <p className="mt-5 text-[12px] leading-relaxed text-slate-400">
        El gasto se cuenta desde que el agente empezó a informarlo (11/11/2026): lo de antes no está. Los tickets resueltos, los tiempos y las
        reaperturas salen del historial y cubren todo. &quot;Vueltas&quot; es cuántas veces trabajó el modelo sobre ese ticket.
      </p>
    </Pagina>
  );
}
