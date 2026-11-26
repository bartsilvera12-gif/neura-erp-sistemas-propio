"use client";

/**
 * Retiro o ingreso de efectivo documentado (MC-000001): motivo (depósito en banco, retiro
 * del dueño, cambio…) y monto. Un retiro no puede superar lo que debería haber en la caja.
 * Las compras, gastos y pagos a proveedores salen de la caja desde sus propios módulos.
 */
import { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Loader2 } from "lucide-react";
import MontoInput from "@/erp2/components/ui/MontoInput";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, ET, INPUT, ModalDocumento, TEAL } from "@/erp2/modules/inventario/ui";
import { MOTIVOS_INGRESO, MOTIVOS_RETIRO, registrarMovimiento } from "@/erp2/modules/caja/turno";
import { formatGs } from "@/erp2/modules/caja/lib";

export function MovimientoModal({ cajaId, etiqueta, efectivoDisponible, tipoInicial = "retiro", onClose, onHecho }: {
  cajaId: string;
  etiqueta: string;
  /** efectivo que debería haber ahora (tope del retiro) */
  efectivoDisponible: number | null;
  tipoInicial?: "retiro" | "ingreso";
  onClose: () => void;
  onHecho: (numero: string) => void;
}) {
  const [tipo, setTipo] = useState<"retiro" | "ingreso">(tipoInicial);
  const [motivo, setMotivo] = useState<string>(tipoInicial === "retiro" ? "deposito_banco" : "cambio");
  const [detalle, setDetalle] = useState("");
  const [monto, setMonto] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const motivos = tipo === "retiro" ? MOTIVOS_RETIRO : MOTIVOS_INGRESO;
  const excede = tipo === "retiro" && efectivoDisponible != null && monto > efectivoDisponible;
  const falta = !(monto > 0) ? "el monto" : motivo === "otro" && !detalle.trim() ? "el motivo" : excede ? "un monto menor" : null;

  async function guardar(e?: React.FormEvent) {
    e?.preventDefault();
    if (falta || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await registrarMovimiento({ caja_id: cajaId, tipo, motivo, detalle: detalle.trim() || null, monto });
      onHecho(r.numero);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  function cambiarTipo(t: "retiro" | "ingreso") {
    setTipo(t);
    setMotivo(t === "retiro" ? "deposito_banco" : "cambio");
  }

  return (
    <ModalDocumento titulo={tipo === "retiro" ? "Retiro de efectivo" : "Ingreso de efectivo"} subtitulo={etiqueta} ancho="max-w-md"
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className={BOTON_SECUNDARIO}>Cancelar</button>
          <button type="submit" form="form-mov-caja" disabled={busy || !!falta} className={BOTON_PRIMARIO} style={{ backgroundColor: TEAL }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Registrar {tipo}
          </button>
        </>
      }>
      <form id="form-mov-caja" onSubmit={guardar} className="space-y-5">
        <div className="grid grid-cols-2 gap-2">
          {([["retiro", "Retiro", "Sale del cajón", ArrowUpFromLine], ["ingreso", "Ingreso", "Entra al cajón", ArrowDownToLine]] as const).map(([v, l, d, Icono]) => {
            const sel = tipo === v;
            return (
              <button key={v} type="button" onClick={() => cambiarTipo(v)}
                className="flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition"
                style={sel ? { borderColor: TEAL, backgroundColor: `${TEAL}10` } : { borderColor: "#e2e8f0" }}>
                <Icono className="h-4 w-4 shrink-0" style={{ color: sel ? TEAL : "#94a3b8" }} />
                <span>
                  <span className="block text-sm font-semibold text-slate-800">{l}</span>
                  <span className="block text-[11px] text-slate-500">{d}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div>
          <span className={ET}>Motivo</span>
          <div className="flex flex-wrap gap-1.5">
            {motivos.map((m) => (
              <button key={m.value} type="button" onClick={() => setMotivo(m.value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition max-sm:min-h-11 max-sm:px-4 max-sm:text-sm ${motivo === m.value ? "border-[var(--brand)] bg-[var(--brand-50)] text-[var(--brand)]" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className={ET}>Detalle {motivo === "otro" ? <span className="text-rose-500">*</span> : <span className="font-normal text-slate-400">(opcional)</span>}</span>
          <input value={detalle} onChange={(e) => setDetalle(e.target.value)} maxLength={200}
            placeholder={tipo === "retiro" ? "Ej. depósito Banco Itaú, boleta 4521" : "Ej. cambio traído del banco"} className={INPUT} />
        </label>

        <label className="block">
          <span className={ET}>Monto en efectivo</span>
          <MontoInput value={monto || ""} onChange={(n) => setMonto(Math.max(0, Math.round(n)))} decimals={false} autoFocus placeholder="0"
            className={`${INPUT} text-right text-xl font-bold tabular-nums ${excede ? "border-rose-300 bg-rose-50" : ""}`} />
          {tipo === "retiro" && efectivoDisponible != null ? (
            <span className={`mt-1 flex items-center justify-between text-[11px] ${excede ? "font-semibold text-rose-600" : "text-slate-500"}`}>
              <span>{excede ? "No hay tanto efectivo en la caja" : "Debería haber en la caja"}</span>
              <button type="button" onClick={() => setMonto(Math.max(0, efectivoDisponible))} className="font-semibold tabular-nums hover:underline max-sm:min-h-10 max-sm:px-1">{formatGs(efectivoDisponible)}</button>
            </span>
          ) : null}
        </label>
        {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
      </form>
    </ModalDocumento>
  );
}
