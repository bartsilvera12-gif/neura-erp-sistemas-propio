"use client";

import { useEffect } from "react";
import { Select } from "@/erp2/components/Select";
import { OPCIONES_CADA, fechaCorta, planCuotas, recargoPlan, type CadaCuota } from "@/erp2/modules/caja/cuotas";
import { usePlanesCuota } from "@/erp2/modules/caja/usePlanesCuota";

const ADJ_CADA: Record<CadaCuota, string> = { mes: "cada mes", quincena: "cada 15 días", semana: "cada 7 días" };

/**
 * Receta 98: crédito en cuotas. Cuotas (1 = un solo vencimiento) · en cuántos días vence la 1ª ·
 * cada cuánto (mensual / quincenal / semanal) y debajo el plan: montos y vencimientos.
 * Con `propuesta` (presupuestos, receta 106) no hay fechas todavía: se cuentan desde la venta.
 * Con `monto` null no se muestra el valor de la cuota (presupuestos en dólares).
 */
/** Receta 136 (solo la caja): plan de cuotas y entrega inicial, con cómo paga la entrega. */
export type EntregaCredito = {
  planId: string; setPlanId: (v: string) => void;
  monto: number; setMonto: (v: number) => void;
  medio: string; setMedio: (v: string) => void;
  referencia: string; setReferencia: (v: string) => void;
};

const MEDIOS_ENTREGA: [string, string][] = [["efectivo", "Efectivo"], ["transferencia", "Transferencia"], ["tarjeta_debito", "Tarjeta de débito"], ["tarjeta_credito", "Tarjeta de crédito"], ["cheque", "Cheque"]];

export function CamposCredito({ total, cuotas, setCuotas, plazoDias, setPlazoDias, cada, setCada, monto, propuesta = false, entrega }: {
  total: number;
  cuotas: string; setCuotas: (v: string) => void;
  plazoDias: string; setPlazoDias: (v: string) => void;
  cada: CadaCuota; setCada: (v: CadaCuota) => void;
  monto: ((v: number) => string) | null;
  propuesta?: boolean;
  entrega?: EntregaCredito;
}) {
  const n = parseInt(cuotas) || 0;
  const dias = parseInt(plazoDias) || 0;
  // Receta 131: el tope es el de la empresa (120 por defecto, Configuración › Planes de cuotas).
  const { max_cuotas: max, planes } = usePlanesCuota();
  const activos = planes.filter((p) => p.activo);
  const planElegido = entrega ? activos.find((p) => p.id === entrega.planId) ?? null : null;
  const entregaMin = planElegido ? Math.round(total * Number(planElegido.entrega_pct) / 100) : 0;
  const montoEntrega = entrega?.monto ?? 0;
  const nOk = n >= 1 && n <= max;
  // Receta 137: el recargo del plan va sobre lo financiado y lo absorben las cuotas.
  const recargo = recargoPlan(Math.max(total - montoEntrega, 0), planElegido);
  const plan = nOk && dias >= 1 ? planCuotas(Math.max(total - montoEntrega, 0) + recargo, n, dias, cada) : null;
  // Con un plan elegido, si el total cambia y la entrega queda corta, sube al mínimo del plan.
  useEffect(() => {
    if (entrega && entregaMin > 0 && entrega.monto < entregaMin) entrega.setMonto(entregaMin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entregaMin]);
  const elegirPlan = (id: string) => {
    if (!entrega) return;
    entrega.setPlanId(id);
    const p = activos.find((x) => x.id === id);
    if (!p) return;
    setCuotas(String(p.cuotas)); setCada(p.cada); setPlazoDias(String(p.primera_dias));
    const min = Math.round(total * Number(p.entrega_pct) / 100);
    if (entrega.monto < min) entrega.setMonto(min);
  };
  const campo = (mal: boolean) =>
    `h-9 w-full rounded-lg border px-2.5 text-sm tabular-nums outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-100)] [@media(pointer:coarse)]:h-11 ${mal ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-white"}`;
  const etq = "mb-0.5 block text-[11px] font-medium text-slate-500";
  const ultima = plan?.[plan.length - 1];
  const hayMonto = !!monto && total > 0;
  return (
    <div className="mt-2 space-y-1.5">
      {entrega && activos.length ? (
        <div className="min-w-0">
          <span className={etq}>Plan</span>
          <Select chico block value={entrega.planId} onChange={elegirPlan} options={[["", "Sin plan (a mano)"], ...activos.map((p) => [p.id, p.nombre] as [string, string])]} etiqueta="Plan de cuotas" />
        </div>
      ) : null}
      {/* "Cada" va en su fila: en la columna angosta de la caja, tres campos juntos no dejaban ver los días. */}
      <div className="grid grid-cols-[4.5rem_1fr] gap-2">
        <label className="min-w-0">
          <span className={etq}>Cuotas</span>
          <input type="number" inputMode="numeric" pattern="[0-9]*" enterKeyHint="next" min={1} max={max} value={cuotas}
            onChange={(e) => { setCuotas(e.target.value.replace(/\D/g, "").slice(0, 3)); entrega?.setPlanId(""); }} className={campo(!nOk)} />
        </label>
        <label className="min-w-0">
          <span className={etq}>{n > 1 ? "1ª vence en" : "Vence en"}</span>
          <span className="relative block">
            <input type="number" inputMode="numeric" pattern="[0-9]*" enterKeyHint="done" min={1} value={plazoDias}
              onChange={(e) => setPlazoDias(e.target.value.replace(/\D/g, "").slice(0, 4))} className={`${campo(dias < 1)} pr-10`} />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">días</span>
          </span>
        </label>
        {n > 1 ? (
          // div y no label: un <label> le repite el click al botón del Select (abre y cierra).
          <div className="col-span-2 min-w-0">
            <span className={etq}>Cada</span>
            <Select chico block value={cada} onChange={(v) => setCada(v as CadaCuota)} options={OPCIONES_CADA} etiqueta="Cada cuánto se paga" />
          </div>
        ) : null}
      </div>
      <p className="text-[11px] leading-snug text-slate-500">
        {!nOk ? `Las cuotas van de 1 a ${max}.`
          : !plan ? "Cargá en cuántos días vence."
          : propuesta ? (
            plan.length === 1 ? <>Un solo pago, a <strong className="font-semibold text-slate-700">{dias} {dias === 1 ? "día" : "días"}</strong> de la venta.</> : (
              <>
                <strong className="font-semibold text-slate-700">{plan.length} cuotas{hayMonto ? ` de ${monto!(plan[0].monto)}` : ""}</strong>
                {hayMonto && ultima && ultima.monto !== plan[0].monto ? ` (la última ${monto!(ultima.monto)})` : ""}
                {" "}· la 1ª a {dias} {dias === 1 ? "día" : "días"} de la venta, después {ADJ_CADA[cada]}
              </>
            )
          )
          : plan.length === 1 ? <>Un solo pago: vence el <strong className="font-semibold text-slate-700">{fechaCorta(plan[0].vence)}</strong>.</>
          : (
            <>
              <strong className="font-semibold text-slate-700">{plan.length} cuotas{hayMonto ? ` de ${monto!(plan[0].monto)}` : ""}</strong>
              {hayMonto && ultima && ultima.monto !== plan[0].monto ? ` (la última ${monto!(ultima.monto)})` : ""}
              {" "}· del {fechaCorta(plan[0].vence)} al {fechaCorta(ultima!.vence)}
            </>
          )}
        {recargo > 0 && plan ? <> · incluye recargo de {monto ? monto(recargo) : recargo} ({Number(planElegido!.recargo_pct)} %)</> : null}
      </p>
      {entrega ? (
        <div className="space-y-1.5 border-t border-slate-100 pt-2">
          <div className={`grid gap-2 ${montoEntrega > 0 ? "grid-cols-2" : "grid-cols-1"}`}>
            <label className="min-w-0">
              <span className={etq}>Entrega inicial{entregaMin ? ` (mín. ${monto ? monto(entregaMin) : entregaMin})` : ""}</span>
              <input inputMode="numeric" value={montoEntrega ? montoEntrega.toLocaleString("es-PY") : ""} placeholder="Sin entrega"
                onChange={(e) => entrega.setMonto(Number(e.target.value.replace(/\D/g, "")) || 0)}
                className={`${campo(montoEntrega > 0 && (montoEntrega >= total || montoEntrega < entregaMin))} text-right`} />
            </label>
            {montoEntrega > 0 ? (
              <div className="min-w-0">
                <span className={etq}>Paga la entrega con</span>
                <Select chico block value={entrega.medio} onChange={entrega.setMedio} options={MEDIOS_ENTREGA} etiqueta="Cómo paga la entrega" />
              </div>
            ) : null}
          </div>
          {montoEntrega > 0 && entrega.medio !== "efectivo" ? (
            <input value={entrega.referencia} onChange={(e) => entrega.setReferencia(e.target.value)} maxLength={120} placeholder="Referencia (Nº de transferencia, voucher…)"
              className={campo(false)} />
          ) : null}
          {montoEntrega > 0 ? (
            <p className="text-[11px] text-slate-500">
              {montoEntrega >= total ? "La entrega tiene que ser menor que el total."
                : montoEntrega < entregaMin ? "El plan pide una entrega mayor."
                : `Se cobra ahora y las cuotas se arman sobre ${monto ? monto(total - montoEntrega) : total - montoEntrega}${recargo > 0 ? " más el recargo" : ""}.`}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
