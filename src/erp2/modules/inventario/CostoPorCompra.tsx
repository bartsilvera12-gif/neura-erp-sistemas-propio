"use client";

/**
 * Sección "Costo por compra" de la ficha del producto (capas de costo PEPS, receta 79):
 * cada compra (o stock inicial, ajuste, traslado, lote) con su costo, cuántas se compraron y
 * cuántas QUEDAN, por depósito. La que sale primero lleva "Próxima". Totales: unidades,
 * valor del stock por capas y a cuánto sale la próxima unidad. "Ver agotadas": el historial.
 * Celular: cada capa es una tarjeta; desde sm, la tabla.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useListaCacheada } from "@/erp2/modules/inventario/lista-cache";
import { urlCapas } from "@/erp2/modules/inventario/ficha-cache";
import { fechaCorta } from "@/erp2/modules/inventario/vencimientos";

export type CapaCosto = {
  id: string;
  tipo: "capa" | "lote";
  fecha: string;
  origen: "compra" | "stock_inicial" | "ajuste" | "traslado" | "anulacion" | "lote" | "produccion";
  compra_numero: string | null;
  proveedor: string | null;
  documento_numero: string | null;
  deposito_id: string;
  deposito: string;
  deposito_origen: string | null;
  costo_unitario: number;
  compradas: number;
  quedan: number;
  valor: number;
  lote_numero: string | null;
  vencimiento: string | null;
  vencido: boolean;
  referencia: string | null;
  orden: number | null;
};
export type CapasProducto = {
  controla_lotes: boolean;
  costo_promedio: number;
  stock_total: number;
  resumen: { unidades: number; valor: number; costo_proxima: number | null; deposito_proxima: string | null };
  depositos: { deposito_id: string; deposito: string; unidades: number; valor: number; costo_proxima: number | null }[];
  capas: CapaCosto[];
  agotadas: number;
  faltante: number;
  descuadre: number;
};

const gs = (v: number | null | undefined) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const num = (v: number) => Number(v || 0).toLocaleString("es-PY", { maximumFractionDigits: 3 });

/** Qué entrada fue: "Compra COMP-000123", "Stock inicial", "Traslado TR-000004"… */
export function origenTexto(
  c: Pick<CapaCosto, "origen" | "compra_numero" | "documento_numero" | "proveedor" | "referencia" | "deposito_origen">,
): { titulo: string; detalle: string | null } {
  switch (c.origen) {
    case "compra":
      return { titulo: `Compra ${c.compra_numero ?? c.documento_numero ?? ""}`.trim(), detalle: c.proveedor };
    case "stock_inicial":
      return { titulo: "Stock inicial", detalle: c.documento_numero ?? (c.referencia ? "al costo promedio" : null) };
    case "traslado":
      return {
        titulo: `Traslado ${c.documento_numero ?? ""}`.trim(),
        detalle: [c.deposito_origen ? `desde ${c.deposito_origen}` : null, c.compra_numero ? `${c.compra_numero}${c.proveedor ? ` · ${c.proveedor}` : ""}` : c.proveedor]
          .filter(Boolean).join(" · ") || null,
      };
    case "anulacion":
      return { titulo: "Devolución", detalle: c.documento_numero ? `anulación ${c.documento_numero}` : c.referencia };
    case "lote":
      return { titulo: "Lote", detalle: c.referencia };
    case "produccion":
      return { titulo: `Producción ${c.documento_numero ?? ""}`.trim(), detalle: "costo de las materias primas" };
    default:
      return { titulo: `Ajuste ${c.documento_numero ?? ""}`.trim(), detalle: c.referencia };
  }
}

export function CostoPorCompra({ productoId, unidad }: { productoId: string; unidad: string }) {
  const [agotadas, setAgotadas] = useState(false);
  const { datos, cargando, error } = useListaCacheada<CapasProducto>(urlCapas(productoId, agotadas));
  const data = cargando && !datos ? null : datos;
  const u = unidad === "Unidad" ? "u." : unidad;

  if (error) return <p className="text-xs text-rose-600">No se pudo cargar el costo por compra.</p>;
  if (!data) return <p className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando costo por compra…</p>;

  const vigentes = data.capas.filter((c) => Number(c.quedan) > 0);
  const viejas = data.capas.filter((c) => Number(c.quedan) <= 0);
  const variosDep = new Set(data.capas.map((c) => c.deposito_id)).size > 1 || data.depositos.length > 1;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Cifra etiqueta="Unidades en stock" valor={`${num(data.resumen.unidades)} ${u}`} />
        <Cifra etiqueta="Valor del stock" valor={gs(data.resumen.valor)} detalle="según lo que costó cada compra" />
        <Cifra etiqueta="Próxima unidad sale a" valor={data.resumen.costo_proxima != null ? gs(data.resumen.costo_proxima) : "—"}
          detalle={data.resumen.deposito_proxima && variosDep ? `en ${data.resumen.deposito_proxima}` : `promedio ${gs(data.costo_promedio)}`}
          clase="max-sm:col-span-2" />
      </div>

      {variosDep && data.depositos.length > 1 ? (
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {data.depositos.map((d) => (
            <span key={d.deposito_id} className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">
              <strong className="font-semibold text-slate-800">{d.deposito}</strong> · {num(d.unidades)} {u} · {gs(d.valor)}
              {d.costo_proxima != null ? <> · próxima {gs(d.costo_proxima)}</> : null}
            </span>
          ))}
        </div>
      ) : null}

      {vigentes.length === 0 && !agotadas ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-xs text-slate-500">
          No hay unidades en stock. Cada compra que entre va a aparecer acá con su costo y cuántas quedan.
        </p>
      ) : (
        <Tabla capas={agotadas ? [...vigentes, ...viejas] : vigentes} unidad={u} variosDep={variosDep} />
      )}

      {Number(data.descuadre) !== 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          {num(Math.abs(data.descuadre))} {u} del stock no están en ninguna compra registrada: se valorizan al costo promedio.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500">
          {data.controla_lotes
            ? "Cada lote tiene su costo: la caja vende primero el que vence antes y la venta cuesta lo que costó ese lote."
            : "Sale primero lo que entró primero: el costo de cada venta es el de las compras de las que salió."}
        </p>
        {data.agotadas > 0 ? (
          <button type="button" onClick={() => setAgotadas((v) => !v)}
            className="whitespace-nowrap text-xs font-semibold text-[var(--brand)] hover:underline max-sm:min-h-11">
            {agotadas ? "Ocultar agotadas" : `Ver agotadas (${data.agotadas})`}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Tabla({ capas, unidad, variosDep }: { capas: CapaCosto[]; unidad: string; variosDep: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      {/* Celular: tarjetas */}
      <ul className="divide-y divide-slate-100 sm:hidden">
        {capas.map((c) => {
          const o = origenTexto(c);
          const agotada = Number(c.quedan) <= 0;
          return (
            <li key={c.id} className={`px-3 py-2.5 text-xs ${agotada ? "bg-slate-50/70 text-slate-400" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`font-semibold [overflow-wrap:anywhere] ${agotada ? "text-slate-500" : "text-slate-800"}`}>
                    {o.titulo} <Chips c={c} />
                  </p>
                  <p className="text-[11px] text-slate-400 [overflow-wrap:anywhere]">
                    {fechaCorta(c.fecha)}{o.detalle ? ` · ${o.detalle}` : ""}{variosDep ? ` · ${c.deposito}` : ""}
                  </p>
                  {c.lote_numero ? <p className="text-[11px] text-slate-500">Lote <span className="font-mono">{c.lote_numero}</span>{c.vencimiento ? ` · vence ${fechaCorta(c.vencimiento)}` : ""}</p> : null}
                </div>
                <div className="shrink-0 text-right">
                  <p className={`text-sm font-bold tabular-nums ${agotada ? "text-slate-400" : "text-slate-900"}`}>{num(c.quedan)} <span className="text-[11px] font-normal text-slate-400">de {num(c.compradas)}</span></p>
                  <p className="text-[11px] text-slate-400">quedan</p>
                </div>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2 tabular-nums">
                <span className="text-slate-600">{gs(c.costo_unitario)} c/{unidad}</span>
                <span className="font-semibold text-slate-800">{gs(c.valor)}</span>
              </div>
            </li>
          );
        })}
      </ul>
      {/* Desde sm: tabla */}
      <div className="max-sm:hidden overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-semibold">Fecha · Origen</th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">Costo c/u</th>
              <th className="px-3 py-2 text-right font-semibold">Compradas</th>
              <th className="px-3 py-2 text-right font-semibold">Quedan</th>
              <th className="px-3 py-2 text-right font-semibold">Valor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {capas.map((c) => {
              const o = origenTexto(c);
              const agotada = Number(c.quedan) <= 0;
              return (
                <tr key={c.id} className={agotada ? "bg-slate-50/70 text-slate-400" : "text-slate-700"}>
                  <td className="min-w-[10rem] px-3 py-2">
                    <p className={`font-medium ${agotada ? "text-slate-500" : "text-slate-800"}`}>{o.titulo} <Chips c={c} /></p>
                    <p className="text-[10px] text-slate-400">{[fechaCorta(c.fecha), o.detalle, variosDep ? c.deposito : null].filter(Boolean).join(" · ")}</p>
                    {c.lote_numero ? <p className="text-[10px] text-slate-500">Lote <span className="font-mono">{c.lote_numero}</span>{c.vencimiento ? ` · vence ${fechaCorta(c.vencimiento)}` : ""}</p> : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{gs(c.costo_unitario)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{num(c.compradas)}</td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums ${agotada ? "" : "text-slate-900"}`}>{num(c.quedan)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{gs(c.valor)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Chips({ c }: { c: CapaCosto }) {
  if (Number(c.quedan) <= 0) return <span className="ml-1 rounded bg-slate-200 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-slate-500">Agotada</span>;
  if (c.vencido) return <span className="ml-1 rounded bg-rose-50 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-rose-700">Vencido</span>;
  if (c.orden === 1) return <span className="ml-1 rounded bg-[var(--brand-50)] px-1.5 py-0.5 align-middle text-[10px] font-semibold text-[var(--brand)]">Próxima</span>;
  return null;
}

function Cifra({ etiqueta, valor, detalle, clase }: { etiqueta: string; valor: string; detalle?: string; clase?: string }) {
  return (
    <div className={`rounded-xl bg-slate-50 px-3 py-2.5 ${clase ?? ""}`}>
      <p className="text-[11px] text-slate-500">{etiqueta}</p>
      <p className="text-sm font-bold tabular-nums text-slate-900 [overflow-wrap:anywhere]">{valor}</p>
      {detalle ? <p className="truncate text-[11px] text-slate-400">{detalle}</p> : null}
    </div>
  );
}
