"use client";

/**
 * Cobro de la venta en el POS.
 *   · Contado: una o varias formas de pago (efectivo, débito, crédito, transferencia, QR /
 *     billetera, cheque). La PRIMERA línea se ajusta sola con lo que falta (agregás "Débito
 *     20.000" y el efectivo pasa a ser el resto); si la editás a mano, queda fija.
 *     Efectivo: lo que entrega el cliente → vuelto (solo sobre el efectivo). Tarjeta /
 *     transferencia / QR: referencia (y banco) opcionales.
 *   · Crédito: cliente, plazo, vencimiento (o las cuotas con sus vencimientos, receta 98) y cuánto
 *     le queda de su límite.
 * Teclado: Alt+1…6 cambia la forma de pago de la línea activa · Alt+M agrega otra forma
 * (pago mixto) · Enter confirma · Esc cancela.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Banknote, CreditCard, FileText, Landmark, Loader2, PiggyBank, Plus, QrCode, ReceiptText, ScrollText, Trash2, Wallet } from "lucide-react";
import MontoInput from "@/erp2/components/ui/MontoInput";
import { ALTO_MAX_MODAL, CapaModal } from "@/erp2/components/CapaModal";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { formatGs, type Cliente } from "@/erp2/modules/caja/lib";
import { fechaCorta, planCuotas, type CadaCuota } from "@/erp2/modules/caja/cuotas";
import { METODOS_VENTA, type MetodoVenta } from "@/erp2/modules/caja/turno";
import type { EstadoCuenta } from "@/erp2/modules/clientes/cobros";
import { clienteConfig } from "@/erp2/cliente.config";

const TEAL = clienteConfig.color;
/** Receta 99: además de las formas de la caja, el saldo a favor del cliente (no entra a la caja). */
type MetodoLinea = MetodoVenta | "saldo_favor";
const SALDO_FAVOR = { value: "saldo_favor" as const, label: "Saldo a favor", corto: "Saldo a favor", referencia: undefined, banco: undefined };
const ICONO: Record<MetodoLinea, React.ComponentType<{ className?: string }>> = {
  saldo_favor: PiggyBank,
  efectivo: Banknote,
  tarjeta_debito: CreditCard,
  tarjeta_credito: CreditCard,
  transferencia: Landmark,
  qr: QrCode,
  cheque: ScrollText,
};

export type PagoEnviar = { metodo_pago: MetodoLinea; monto: number; recibido?: number | null; referencia?: string | null; banco?: string | null };

type Linea = { id: string; metodo: MetodoLinea; monto: number; manual: boolean; referencia: string; banco: string };
const nuevoId = () => `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

/** Billetes "redondos" que el cliente probablemente entregue (para el vuelto). */
function sugerencias(monto: number): number[] {
  if (monto <= 0) return [];
  const out = new Set<number>();
  for (const paso of [1000, 5000, 10000, 50000, 100000]) {
    const v = Math.ceil(monto / paso) * paso;
    if (v > monto) out.add(v);
  }
  return [...out].sort((a, b) => a - b).slice(0, 4);
}

export function CobroModal({ total, cantItems, tipoVenta, plazoDias, cuotas = 1, cuotasCada = "mes", entrega, cliente, documento, imprimir = true, cobrando, error, onClose, onConfirmar }: {
  /** Receta 136: crédito con entrega inicial (se cobra ahora; las cuotas se arman sobre el resto). */
  entrega?: { monto: number; medio: string; recargo?: number };
  total: number;
  cantItems: number;
  tipoVenta: "CONTADO" | "CREDITO";
  /** días hasta el vencimiento (con cuotas: de la 1ª) */
  plazoDias: number;
  /** Receta 98: en cuántas cuotas y cada cuánto */
  cuotas?: number;
  cuotasCada?: CadaCuota;
  cliente: Cliente | null;
  /** qué se emite: factura (a nombre de… con RUC) o solo ticket; se muestra como chip arriba */
  documento?: { tipo: "factura"; nombre: string; ruc: string | null } | { tipo: "ticket" };
  /** Receta 71 (`ticket_venta.imprimir_al_cobrar`): si está apagado, el botón dice solo "Cobrar" */
  imprimir?: boolean;
  cobrando: boolean;
  error: string | null;
  onClose: () => void;
  onConfirmar: (pagos: PagoEnviar[]) => void;
}) {
  const [lineas, setLineas] = useState<Linea[]>([{ id: nuevoId(), metodo: "efectivo", monto: total, manual: false, referencia: "", banco: "" }]);
  const [activa, setActiva] = useState<string>(() => lineas[0].id);
  const [recibido, setRecibido] = useState<number | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cuenta, setCuenta] = useState<EstadoCuenta | null>(null);
  const recibidoRef = useRef<HTMLInputElement>(null);
  const dialogoRef = useRef<HTMLDivElement>(null);
  const confirmarRef = useRef<HTMLButtonElement>(null);
  const montoRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // La primera línea, mientras no se toque, absorbe lo que falta.
  const efectivas = useMemo(() => {
    const otras = lineas.slice(1).reduce((a, l) => a + (l.monto || 0), 0);
    return lineas.map((l, i) => (i === 0 && !l.manual ? { ...l, monto: Math.max(0, total - otras) } : l));
  }, [lineas, total]);
  const pagado = efectivas.reduce((a, l) => a + (l.monto || 0), 0);
  const restante = total - pagado;
  const efectivo = efectivas.filter((l) => l.metodo === "efectivo").reduce((a, l) => a + (l.monto || 0), 0);
  const vuelto = recibido != null && efectivo > 0 ? recibido - efectivo : null;
  const lineasConMonto = efectivas.filter((l) => l.monto > 0);

  // Crédito: deuda del cliente y su límite. Contado: su saldo a favor (receta 99).
  useEffect(() => {
    if (!cliente) return;
    apiFetch<EstadoCuenta>(`/api/clientes/${cliente.id}/estado-cuenta`).then(setCuenta).catch(() => {});
  }, [tipoVenta, cliente]);
  const saldoFavor = tipoVenta === "CONTADO" && cliente ? Number(cuenta?.saldo_favor ?? 0) : 0;
  const conSaldo = efectivas.filter((l) => l.metodo === "saldo_favor").reduce((a, l) => a + (l.monto || 0), 0);
  const limite = Number(cliente?.limite_credito ?? 0);
  const deuda = Number(cuenta?.deuda ?? 0);
  const disponible = limite > 0 ? limite - deuda : null;
  const montoEntrega = tipoVenta === "CREDITO" ? entrega?.monto ?? 0 : 0;
  // Receta 137: el recargo del plan se suma a lo financiado (lo absorben las cuotas).
  const recargo = tipoVenta === "CREDITO" ? entrega?.recargo ?? 0 : 0;
  const superaLimite = tipoVenta === "CREDITO" && disponible != null && cuenta != null && total - montoEntrega + recargo > disponible;
  const plan = useMemo(() => planCuotas(total - montoEntrega + recargo, cuotas, plazoDias, cuotasCada), [total, montoEntrega, recargo, cuotas, plazoDias, cuotasCada]);
  const vence = fechaCorta(plan[0].vence);

  const problema =
    tipoVenta === "CREDITO"
      ? superaLimite ? "Supera el límite de crédito del cliente." : null
      : restante > 0 ? `Falta asignar ${formatGs(restante)}.`
      : restante < 0 ? `Las formas de pago se pasan por ${formatGs(-restante)}.`
      : lineasConMonto.length === 0 ? "Cargá cómo paga."
      : conSaldo > saldoFavor ? `El cliente tiene ${formatGs(saldoFavor)} a favor: no alcanza.`
      : recibido != null && efectivo > 0 && recibido < efectivo ? `Con ${formatGs(recibido)} no alcanza el efectivo (${formatGs(efectivo)}).`
      : null;

  function confirmar() {
    if (cobrando) return;
    if (problema) { setAviso(problema); return; }
    if (tipoVenta === "CREDITO") { onConfirmar([]); return; }
    let recibidoUsado = false;
    onConfirmar(lineasConMonto.map((l) => {
      const p: PagoEnviar = { metodo_pago: l.metodo, monto: l.monto };
      if (l.metodo === "efectivo") {
        // Lo recibido va en la primera línea de efectivo (el vuelto es por todo el efectivo).
        if (!recibidoUsado && recibido != null && recibido > 0) {
          const otrasEf = efectivo - l.monto;
          p.recibido = Math.max(l.monto, recibido - otrasEf);
          recibidoUsado = true;
        }
      } else {
        p.referencia = l.referencia.trim() || null;
        p.banco = l.banco.trim() || null;
      }
      return p;
    }));
  }

  function usarSaldo() {
    const id = nuevoId();
    const monto = Math.min(saldoFavor, lineas[0].manual ? Math.max(0, restante) : total);
    setLineas((ls) => [...ls, { id, metodo: "saldo_favor", monto, manual: true, referencia: "", banco: "" }]);
    setActiva(id);
    setAviso(null);
  }
  function setMetodo(id: string, metodo: MetodoLinea) {
    setLineas((ls) => ls.map((l) => (l.id === id ? { ...l, metodo } : l)));
    setAviso(null);
  }
  function setMonto(id: string, monto: number) {
    setLineas((ls) => ls.map((l, i) => (l.id === id ? { ...l, monto: Math.max(0, Math.round(monto)), manual: i === 0 ? true : l.manual } : l)));
    setAviso(null);
  }
  function agregar(metodo?: MetodoVenta) {
    const usados = new Set(lineas.map((l) => l.metodo));
    const m = metodo ?? METODOS_VENTA.find((x) => !usados.has(x.value))?.value ?? "tarjeta_debito";
    const id = nuevoId();
    // Si la primera se ajusta sola, la nueva arranca en 0 (lo que escribas sale de la primera);
    // si no, toma lo que falta.
    const monto = lineas[0].manual ? Math.max(0, restante) : 0;
    setLineas((ls) => [...ls, { id, metodo: m, monto, manual: true, referencia: "", banco: "" }]);
    setActiva(id);
    setTimeout(() => montoRefs.current[id]?.focus(), 0);
  }
  function quitar(id: string) {
    setLineas((ls) => (ls.length <= 1 || ls[0].id === id ? ls : ls.filter((l) => l.id !== id)));
    setActiva((a) => (a === id ? lineas[0].id : a));
  }

  // Teclado del modal (el POS le deja Enter/Esc mientras está abierto).
  const kb = useRef({ confirmar, setMetodo, agregar, activa, onClose, cobrando });
  kb.current = { confirmar, setMetodo, agregar, activa, onClose, cobrando };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const s = kb.current;
      const el = document.activeElement as HTMLElement | null;
      if (e.key === "Escape") {
        if (document.querySelector("[role=listbox]")) return;
        e.preventDefault();
        if (!s.cobrando) s.onClose();
        return;
      }
      if (e.altKey && /^[1-6]$/.test(e.key)) {
        e.preventDefault();
        s.setMetodo(s.activa, METODOS_VENTA[Number(e.key) - 1].value);
        return;
      }
      if (e.altKey && (e.key === "m" || e.key === "M" || e.key === "+")) {
        e.preventDefault();
        s.agregar();
        return;
      }
      if (e.key === "Enter") {
        const tag = el?.tagName;
        // Un botón DE ESTA VENTANA hace lo suyo (Enter = clic). Si el foco quedó atrás (p. ej. en
        // "Aceptar y cobrar" del POS, como pasa a crédito), Enter confirma: antes no hacía nada útil.
        const fuera = !el || !dialogoRef.current?.contains(el);
        if (fuera) { e.preventDefault(); s.confirmar(); return; }
        if (tag === "BUTTON" || tag === "TEXTAREA" || el?.getAttribute("role") === "option" || el?.closest("[role=listbox]")) return;
        e.preventDefault();
        // Pantalla táctil: el "OK / Listo" del teclado en pantalla solo lo cierra (no cobra sin
        // tocar el botón). Con teclado / lector (puntero fino) Enter cobra, como siempre.
        if (tag === "INPUT" && !window.matchMedia("(pointer: fine)").matches) { el?.blur(); return; }
        s.confirmar();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    // Con teclado / lector: directo a "lo que entrega". En táctil no (el teclado en pantalla
    // taparía los billetes rápidos y el botón de cobrar).
    if (!window.matchMedia("(pointer: fine)").matches) return;
    // A crédito no hay nada que tipear: el foco va al botón de confirmar (Enter confirma).
    setTimeout(() => (tipoVenta === "CONTADO" ? recibidoRef.current : confirmarRef.current)?.focus(), 30);
  }, [tipoVenta]);

  const lineaActiva = efectivas.find((l) => l.id === activa) ?? efectivas[0];

  return (
    <CapaModal onClose={cobrando ? undefined : onClose} fondo="bg-slate-900/50 backdrop-blur-[2px]" cerrarConEscape={false}>
      <div ref={dialogoRef} role="dialog" aria-modal className={`flex w-full max-w-2xl ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`}
        style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        {/* Total */}
        <div className="flex shrink-0 items-end justify-between gap-4 px-4 pb-3 pt-3 sm:px-6 sm:pb-4 sm:pt-5" style={{ background: `linear-gradient(to right, ${TEAL}14, transparent)` }}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: TEAL }}>{tipoVenta === "CREDITO" ? "Venta a crédito" : "Cobrar"}</p>
              {documento ? (
                documento.tipo === "factura" ? (
                  <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-200"
                    title={`Factura a ${documento.nombre}${documento.ruc ? ` · RUC ${documento.ruc}` : ""}`}>
                    <FileText className="h-3 w-3 shrink-0" />
                    <span className="truncate">Factura{!cliente && documento.nombre ? <span className="font-medium"> a {documento.nombre}</span> : null}{documento.ruc ? <span className="font-medium"> · RUC {documento.ruc}</span> : null}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">
                    <ReceiptText className="h-3 w-3 shrink-0" /> Ticket
                  </span>
                )
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-xs text-slate-500">{Number(cantItems).toLocaleString("es-PY", { maximumFractionDigits: 3 })} unidad{cantItems === 1 ? "" : "es"}{cliente ? ` · ${cliente.nombre}` : ""}</p>
          </div>
          <p className="shrink-0 text-right text-[28px] font-extrabold leading-none tabular-nums tracking-tight text-slate-900 sm:text-3xl">
            {formatGs(total + recargo)}
            {recargo > 0 ? <span className="mt-1 block text-[11px] font-medium tracking-normal text-slate-500">con recargo · sin recargo {formatGs(total)}</span> : null}
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:space-y-5 sm:px-6">
          {tipoVenta === "CREDITO" ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
                <div className="col-span-2 sm:col-span-1"><Dato label="Cliente" valor={cliente?.nombre ?? "—"} /></div>
                {montoEntrega > 0 ? (
                  <div className="col-span-2 sm:col-span-3"><Dato label={`Entrega (se cobra ahora · ${entrega?.medio.replace(/_/g, " ")})`} valor={formatGs(montoEntrega)} /></div>
                ) : null}
                {recargo > 0 ? (
                  <div className="col-span-2 sm:col-span-3"><Dato label="Recargo por financiación (se suma a la venta)" valor={formatGs(recargo)} /></div>
                ) : null}
                {plan.length > 1 ? (
                  <>
                    <Dato label="Cuotas" valor={`${plan.length} × ${formatGs(plan[0].monto)}`} />
                    <Dato label="1ª vence" valor={vence} />
                  </>
                ) : (
                  <>
                    <Dato label="Plazo" valor={`${plazoDias} día${plazoDias === 1 ? "" : "s"}`} />
                    <Dato label="Vence" valor={vence} />
                  </>
                )}
              </div>
              {plan.length > 1 ? (
                <ul className="max-h-40 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 text-sm">
                  {plan.map((c) => (
                    <li key={c.n} className="flex items-center justify-between gap-3 px-3 py-1.5">
                      <span className="text-slate-500">Cuota {c.n} · vence {fechaCorta(c.vence)}</span>
                      <span className="font-semibold tabular-nums text-slate-900">{formatGs(c.monto)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {limite > 0 ? (
                <div className={`rounded-xl border px-4 py-3 text-sm ${superaLimite ? "border-rose-200 bg-rose-50 text-rose-800" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
                  <div className="flex justify-between"><span>Límite de crédito</span><span className="font-semibold tabular-nums">{formatGs(limite)}</span></div>
                  <div className="flex justify-between"><span>Debe hoy</span><span className="tabular-nums">{cuenta ? formatGs(deuda) : "…"}</span></div>
                  <div className="mt-1 flex justify-between border-t border-current/10 pt-1 font-semibold"><span>Disponible</span><span className="tabular-nums">{disponible != null && cuenta ? formatGs(disponible) : "…"}</span></div>
                  {superaLimite ? <p className="mt-1.5 text-xs font-semibold">Esta venta supera el límite: no se puede dar a crédito.</p> : null}
                </div>
              ) : (
                <p className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600">El cliente no tiene límite de crédito cargado.{cuenta ? ` Hoy debe ${formatGs(deuda)}.` : ""}</p>
              )}
              <p className="text-xs text-slate-500">Queda en la cuenta corriente del cliente; no entra plata a la caja ahora. Se cobra después desde Cobranzas o la ficha del cliente.</p>
            </div>
          ) : (
            <>
              {/* Formas de pago (Alt+1…6 sobre la línea activa) */}
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Forma de pago {lineas.length > 1 ? <span className="normal-case tracking-normal text-slate-400">· de la línea marcada</span> : null}
                </p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {METODOS_VENTA.map((m) => {
                    const Icono = ICONO[m.value];
                    const sel = lineaActiva?.metodo === m.value;
                    return (
                      <button key={m.value} type="button" onClick={() => setMetodo(lineaActiva.id, m.value)} title={`${m.label} (Alt+${m.tecla})`}
                        className="relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2.5 text-xs font-semibold transition sm:min-h-0 sm:text-[11px]"
                        style={sel ? { borderColor: TEAL, backgroundColor: `${TEAL}12`, color: TEAL } : { borderColor: "#e2e8f0", color: "#475569" }}>
                        <Icono className="h-4 w-4" />
                        <span className="leading-tight">{m.corto}</span>
                        <kbd className="absolute right-1 top-1 hidden text-[9px] font-medium text-slate-300 lg:block">{m.tecla}</kbd>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Líneas de pago */}
              <ul className="space-y-2">
                {efectivas.map((l, i) => {
                  const def = l.metodo === "saldo_favor" ? SALDO_FAVOR : METODOS_VENTA.find((m) => m.value === l.metodo)!;
                  const Icono = ICONO[l.metodo];
                  const esActiva = l.id === lineaActiva?.id;
                  return (
                    <li key={l.id} onMouseDown={() => setActiva(l.id)}
                      className={`rounded-xl border p-3 transition ${esActiva && efectivas.length > 1 ? "ring-2" : ""}`}
                      style={{ borderColor: esActiva && efectivas.length > 1 ? TEAL : "#e2e8f0", ["--tw-ring-color" as string]: `${TEAL}30` }}>
                      <div className="flex items-center gap-2 sm:gap-3">
                        <Icono className="h-4 w-4 shrink-0 text-slate-400" />
                        <span className="min-w-0 flex-1 text-sm font-semibold leading-tight text-slate-800">
                          {def.label}
                          {i === 0 && !l.manual && efectivas.length > 1 ? <span className="ml-2 text-[10px] font-medium text-slate-400">(el resto)</span> : null}
                        </span>
                        <MontoInput value={l.monto} onChange={(n) => setMonto(l.id, n)} decimals={false} onFocus={() => setActiva(l.id)}
                          ref={(el: HTMLInputElement | null) => { montoRefs.current[l.id] = el; }}
                          className="h-11 w-[8.5rem] shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-right text-base font-bold tabular-nums outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-100)] sm:h-auto sm:w-36" />
                        {i > 0 ? (
                          <button type="button" onClick={() => quitar(l.id)} aria-label="Quitar forma de pago" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-500 sm:h-auto sm:w-auto sm:p-1.5"><Trash2 className="h-4 w-4" /></button>
                        ) : <span className="hidden w-7 sm:block" />}
                      </div>
                      {l.metodo === "saldo_favor" ? (
                        <p className="mt-1.5 text-xs text-slate-500 sm:pl-7">Tiene {formatGs(saldoFavor)} a favor. No entra a la caja.</p>
                      ) : l.metodo !== "efectivo" ? (
                        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:pl-7">
                          <input value={l.referencia} onFocus={() => setActiva(l.id)} onChange={(e) => setLineas((ls) => ls.map((x) => (x.id === l.id ? { ...x, referencia: e.target.value } : x)))}
                            maxLength={120} placeholder={`${def.referencia ?? "Referencia"} (opcional)`}
                            className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs outline-none focus:border-[var(--brand)] sm:min-h-0" />
                          {def.banco ? (
                            <input value={l.banco} onFocus={() => setActiva(l.id)} onChange={(e) => setLineas((ls) => ls.map((x) => (x.id === l.id ? { ...x, banco: e.target.value } : x)))}
                              maxLength={80} placeholder="Banco (opcional)" className="min-h-11 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs outline-none focus:border-[var(--brand)] sm:min-h-0 sm:w-40" />
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {saldoFavor > 0 && conSaldo === 0 ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-sm text-emerald-900">
                  <span className="flex min-w-0 items-center gap-2"><PiggyBank className="h-4 w-4 shrink-0" /> <span>{cliente?.nombre} tiene <b className="tabular-nums">{formatGs(saldoFavor)}</b> a favor</span></span>
                  <button type="button" onClick={usarSaldo} className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100 [@media(pointer:coarse)]:min-h-11">Usar</button>
                </div>
              ) : null}
              <button type="button" onClick={() => agregar()} className="inline-flex items-center justify-center gap-1 text-xs font-semibold hover:underline max-sm:min-h-11 max-sm:w-full max-sm:rounded-xl max-sm:border max-sm:border-dashed max-sm:border-slate-300 max-sm:text-sm" style={{ color: TEAL }}>
                <Plus className="h-3.5 w-3.5" /> Agregar otra forma de pago (mixto) <kbd className="ml-1 hidden rounded border border-slate-200 px-1 font-mono text-[10px] text-slate-400 lg:inline">Alt+M</kbd>
              </button>

              {restante !== 0 ? (
                <p className={`rounded-lg px-3 py-2 text-sm font-semibold ${restante > 0 ? "bg-amber-50 text-amber-800" : "bg-rose-50 text-rose-700"}`}>
                  {restante > 0 ? `Falta asignar ${formatGs(restante)}` : `Te pasaste por ${formatGs(-restante)}`}
                </p>
              ) : null}

              {/* Efectivo recibido → vuelto */}
              {efectivo > 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4">
                  <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                    <label className="min-w-[200px] flex-1 max-sm:w-full max-sm:min-w-0 max-sm:flex-none">
                      <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600"><Wallet className="h-3.5 w-3.5" /> Efectivo que entrega <span className="text-slate-400">(para el vuelto)</span></span>
                      <MontoInput value={recibido ?? ""} onChange={(n) => { setRecibido(n > 0 ? Math.round(n) : null); setAviso(null); }} decimals={false}
                        ref={recibidoRef} placeholder={`${efectivo.toLocaleString("es-PY")} (justo)`}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-right text-xl font-bold tabular-nums outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-100)]" />
                    </label>
                    <div className="min-w-[150px] text-right max-sm:flex max-sm:w-full max-sm:min-w-0 max-sm:items-baseline max-sm:justify-between max-sm:gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Vuelto</p>
                      <p className={`text-3xl font-extrabold tabular-nums ${vuelto != null && vuelto < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                        {vuelto == null ? formatGs(0) : vuelto < 0 ? `Faltan ${formatGs(-vuelto)}` : formatGs(vuelto)}
                      </p>
                    </div>
                  </div>
                  {/* Billetes rápidos (en celular, grilla de botones grandes) */}
                  <div className="mt-2 grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:gap-1.5">
                    <Chip on={recibido === efectivo} onClick={() => setRecibido(efectivo)}>Justo</Chip>
                    {sugerencias(efectivo).map((v) => <Chip key={v} on={recibido === v} onClick={() => setRecibido(v)}>{formatGs(v)}</Chip>)}
                  </div>
                </div>
              ) : null}
            </>
          )}

          {aviso || error ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{aviso ?? error}</p> : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:px-6 sm:py-3.5">
          <p className="hidden text-[11px] text-slate-400 lg:block">
            <kbd className="rounded border border-slate-200 bg-white px-1 font-mono">Enter</kbd> confirmar · <kbd className="rounded border border-slate-200 bg-white px-1 font-mono">Esc</kbd> volver
            {tipoVenta === "CONTADO" ? <> · <kbd className="rounded border border-slate-200 bg-white px-1 font-mono">Alt+1…6</kbd> forma de pago</> : null}
          </p>
          <div className="flex gap-2 max-lg:w-full lg:ml-auto">
            <button type="button" onClick={onClose} disabled={cobrando} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 max-lg:flex-1">Volver</button>
            <button ref={confirmarRef} type="button" onClick={confirmar} disabled={cobrando || !!problema}
              className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40 max-lg:min-h-12 max-lg:flex-[2] max-lg:text-base" style={{ backgroundColor: TEAL }}>
              {cobrando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {cobrando ? "Registrando…" : tipoVenta === "CREDITO" ? (imprimir ? "Confirmar crédito e imprimir" : "Confirmar crédito") : imprimir ? "Cobrar e imprimir" : "Cobrar"}
            </button>
          </div>
        </div>
      </div>
    </CapaModal>
  );
}

function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold text-slate-800">{valor}</p>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-semibold tabular-nums transition max-sm:min-h-11 max-sm:rounded-xl max-sm:px-1 max-sm:text-sm ${on ? "border-[var(--brand)] bg-[var(--brand-50)] text-[var(--brand)]" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>
      {children}
    </button>
  );
}
