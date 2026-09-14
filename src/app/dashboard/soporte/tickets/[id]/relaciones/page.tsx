"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Link2, Unlink } from "lucide-react";
import { FancySelect } from "@/app/dashboard/proyectos/components/FancySelect";
import { TIPOS_RELACION } from "@/lib/soporte/dominio";
import { useTicket } from "../../../_ui/TicketContexto";
import { apiSoporte } from "../../../_ui/api";
import { Aviso, Boton, Cargando, Insignia, Tarjeta, Vacio, claseInput } from "../../../_ui/ui";

type Relacion = {
  id: string;
  tipo: string;
  tipo_nombre: string;
  inversa: boolean;
  ticket: { id: string; numero: number; asunto: string; estado_nombre: string; estado_color: string; cliente_nombre: string | null };
};

/**
 * Relaciones con otros tickets. El MVP usa "Relacionado con"; los demás tipos
 * (duplicado, bloquea, deriva de) ya están en la base y el selector.
 */
export default function TicketRelacionesPage() {
  const { ticket, recargar } = useTicket();
  const [lista, setLista] = useState<Relacion[] | null>(null);
  const [numero, setNumero] = useState("");
  const [tipo, setTipo] = useState("relacionado");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setLista(await apiSoporte<Relacion[]>(`/api/soporte/tickets/${ticket.id}/relaciones`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las relaciones");
    }
  }, [ticket.id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const vincular = async () => {
    const n = numero.replace(/^#/, "").trim();
    if (!n) return;
    setGuardando(true);
    setError(null);
    try {
      await apiSoporte(`/api/soporte/tickets/${ticket.id}/relaciones`, { method: "POST", json: { numero: n, tipo } });
      setNumero("");
      await Promise.all([cargar(), recargar()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo vincular");
    } finally {
      setGuardando(false);
    }
  };

  const quitar = async (r: Relacion) => {
    if (!window.confirm(`¿Quitar el vínculo con #${r.ticket.numero}?`)) return;
    try {
      await apiSoporte(`/api/soporte/tickets/${ticket.id}/relaciones?relacion_id=${r.id}`, { method: "DELETE" });
      await Promise.all([cargar(), recargar()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo quitar el vínculo");
    }
  };

  return (
    <div className="space-y-5">
      <Tarjeta titulo="Vincular ticket">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-52">
            <FancySelect ariaLabel="Tipo de relación" value={tipo} onChange={setTipo} options={TIPOS_RELACION.map((t) => ({ value: t.codigo, label: t.nombre }))} />
          </div>
          <label className="relative w-40">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">#</span>
            <input
              className={`${claseInput} pl-7`}
              inputMode="numeric"
              value={numero.replace(/^#/, "")}
              onChange={(e) => setNumero(e.target.value.replace(/[^\d]/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && void vincular()}
              placeholder="Número"
              aria-label="Número de ticket"
            />
          </label>
          <Boton onClick={() => void vincular()} cargando={guardando} disabled={!numero}>
            <Link2 className="h-4 w-4" aria-hidden /> Vincular
          </Boton>
        </div>
        {error ? <div className="mt-3"><Aviso>{error}</Aviso></div> : null}
      </Tarjeta>

      <Tarjeta padding="p-0">
        {lista == null ? (
          <Cargando />
        ) : lista.length === 0 ? (
          <Vacio titulo="Sin tickets relacionados" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-slate-100 text-[11.5px] text-slate-500">
                  <th className="px-5 py-2.5 font-medium">Relación</th>
                  <th className="px-3 py-2.5 font-medium">#</th>
                  <th className="px-3 py-2.5 font-medium">Asunto</th>
                  <th className="px-3 py-2.5 font-medium">Estado</th>
                  <th className="px-3 py-2.5 font-medium">Cliente</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {lista.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 text-slate-600">{r.tipo_nombre}{r.inversa ? <span className="text-slate-400"> (desde el otro)</span> : null}</td>
                    <td className="px-3 py-3 tabular-nums text-slate-500">#{r.ticket.numero}</td>
                    <td className="max-w-[300px] px-3 py-3">
                      <Link href={`/dashboard/soporte/tickets/${r.ticket.id}`} className="font-medium text-slate-900 no-underline hover:text-[#2F6E71]">
                        {r.ticket.asunto}
                      </Link>
                    </td>
                    <td className="px-3 py-3"><Insignia color={r.ticket.estado_color} punto>{r.ticket.estado_nombre}</Insignia></td>
                    <td className="px-3 py-3 text-slate-600">{r.ticket.cliente_nombre ?? "—"}</td>
                    <td className="px-5 py-3 text-right">
                      <button type="button" onClick={() => void quitar(r)} aria-label={`Quitar vínculo con #${r.ticket.numero}`} className="inline-grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                        <Unlink className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>
    </div>
  );
}
