"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Sparkles, Wallet, CheckCircle2, Timer, RotateCcw, Repeat2 } from "lucide-react";
import { apiSoporte } from "../_ui/api";
import { Aviso, Cargando, Encabezado, Insignia, Pagina, Tarjeta, Vacio } from "../_ui/ui";

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
  hoy: { numero: number; id: string | null; asunto: string; cliente: string | null; estado_codigo: string | null; usd: number; vueltas: number }[];
  comparativo: { id: string; nombre: string; resueltos: number; medianaMinutos: number | null; esAgente: boolean }[];
};

const usd = (n: number) => `US$ ${n.toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** 95 → "1 h 35 min". Los minutos sueltos no se leen cuando pasan de la hora. */
function duracion(min: number | null): string {
  if (min == null) return "—";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

function Dato({
  etiqueta,
  valor,
  pie,
  icono: Icono,
  tono = "text-slate-400",
}: {
  etiqueta: string;
  valor: string;
  pie?: string;
  icono: typeof Wallet;
  tono?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="mb-2 flex items-center gap-2">
        <Icono className={`h-4 w-4 ${tono}`} aria-hidden />
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{etiqueta}</p>
      </div>
      <p className="text-[22px] font-semibold leading-none text-slate-800">{valor}</p>
      {pie ? <p className="mt-1.5 text-[12px] text-slate-400">{pie}</p> : null}
    </div>
  );
}

export default function NeuritaPage() {
  const [d, setD] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    const traer = () =>
      apiSoporte<Resp>("/api/soporte/neurita")
        .then((r) => vivo && (setD(r), setError(null)))
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
  // De los que cerró, cuántos volvieron. Es el número que dice si el arreglo servía.
  const pctVuelta = trabajo.resueltos > 0 ? Math.round((trabajo.volvieron / trabajo.resueltos) * 100) : null;

  return (
    <Pagina>
      <Encabezado
        titulo={d.agente?.nombre ?? "Neurita"}
        subtitulo="Qué hizo y cuánto costó el agente de IA"
        icono={Sparkles}
        tono="violeta"
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Dato etiqueta="Gastó hoy" valor={usd(gasto.hoy)} pie={`${gasto.vueltasHoy} ${gasto.vueltasHoy === 1 ? "vuelta" : "vueltas"}`} icono={Wallet} tono="text-violet-500" />
        <Dato etiqueta="Este mes" valor={usd(gasto.mes)} pie={`${pctMes}% del tope de ${usd(gasto.topeMes)}`} icono={Wallet} tono="text-violet-500" />
        <Dato etiqueta="Total" valor={usd(gasto.total)} pie="desde que empezó a informar" icono={Wallet} tono="text-slate-400" />
        <Dato etiqueta="Resueltos" valor={String(trabajo.resueltos)} pie={trabajo.abiertos ? `${trabajo.abiertos} abiertos ahora` : "ninguno abierto"} icono={CheckCircle2} tono="text-emerald-500" />
        <Dato
          etiqueta="Costo por ticket"
          valor={trabajo.costoPorTicket == null ? "—" : usd(trabajo.costoPorTicket)}
          pie="todo lo gastado ÷ resueltos"
          icono={Wallet}
          tono="text-slate-400"
        />
        <Dato
          etiqueta="Le volvieron"
          valor={pctVuelta == null ? "—" : `${pctVuelta}%`}
          pie={`${trabajo.volvieron} de ${trabajo.resueltos} se reabrieron`}
          icono={RotateCcw}
          tono={trabajo.volvieron > 0 ? "text-rose-500" : "text-slate-400"}
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Dato
          etiqueta="Tarda (mediana)"
          valor={duracion(trabajo.medianaMinutos)}
          pie="desde que lo toma hasta que lo resuelve"
          icono={Timer}
          tono="text-sky-500"
        />
        <Dato
          etiqueta="Vueltas por ticket (mediana)"
          valor={trabajo.vueltasMediana == null ? "—" : String(trabajo.vueltasMediana)}
          pie={`sobre ${trabajo.ticketsConGasto} ${trabajo.ticketsConGasto === 1 ? "ticket" : "tickets"} con gasto informado`}
          icono={Repeat2}
          tono="text-amber-500"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Tarjeta titulo="Lo que trabajó hoy" icono={Sparkles} tono="violeta" padding="p-0">
          {d.hoy.length === 0 ? (
            <div className="p-5">
              <Vacio titulo="Hoy todavía no trabajó" detalle="Acá aparecen los tickets que tocó, con lo que costó cada uno." icono={Sparkles} tono="violeta" />
            </div>
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-2.5">Ticket</th>
                  <th className="px-3 py-2.5">Cliente</th>
                  <th className="px-3 py-2.5 text-right">Vueltas</th>
                  <th className="px-5 py-2.5 text-right">Costo</th>
                </tr>
              </thead>
              <tbody>
                {d.hoy.map((t) => (
                  <tr key={t.numero} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3">
                      {t.id ? (
                        <Link href={`/dashboard/soporte/tickets/${t.id}`} className="font-semibold text-[#2F7F83] hover:underline">
                          #{String(t.numero).padStart(4, "0")}
                        </Link>
                      ) : (
                        <span className="font-semibold text-slate-400">#{String(t.numero).padStart(4, "0")}</span>
                      )}
                      <p className="mt-0.5 line-clamp-1 text-[12px] text-slate-500">{t.asunto}</p>
                    </td>
                    <td className="px-3 py-3 text-slate-600">{t.cliente ?? <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-600">{t.vueltas}</td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums text-slate-700">{usd(t.usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Tarjeta>

        <Tarjeta titulo="Contra el equipo" icono={CheckCircle2} tono="turquesa" padding="p-0">
          {d.comparativo.length === 0 ? (
            <div className="p-5">
              <Vacio titulo="Sin tickets resueltos todavía" icono={CheckCircle2} />
            </div>
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-2.5">Quién</th>
                  <th className="px-3 py-2.5 text-right">Resueltos</th>
                  <th className="px-5 py-2.5 text-right">Tarda (mediana)</th>
                </tr>
              </thead>
              <tbody>
                {d.comparativo.map((p) => (
                  <tr key={p.id} className={`border-b border-slate-100 last:border-0 ${p.esAgente ? "bg-violet-50/40" : ""}`}>
                    <td className="px-5 py-3">
                      <span className="font-medium text-slate-700">{p.nombre}</span>
                      {p.esAgente ? (
                        <span className="ml-2 align-middle">
                          <Insignia color="#8b5cf6">IA</Insignia>
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-600">{p.resueltos}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-600">{duracion(p.medianaMinutos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Tarjeta>
      </div>

      <p className="mt-5 text-[12px] leading-relaxed text-slate-400">
        El gasto se cuenta desde que el agente empezó a informarlo (11/11/2026): lo anterior no está. Los tickets resueltos y los tiempos
        salen del historial y sí cubren todo. &quot;Vueltas&quot; es cuántas veces trabajó el modelo sobre ese ticket.
      </p>
    </Pagina>
  );
}
