"use client";

/**
 * Botón "Es la misma persona que..." para la ficha del contacto.
 *
 * Al hacer clic abre un modal con un buscador. Al elegir destino + confirmar,
 * vincula el contacto actual como alias permanente del elegido (ver
 * `/api/chat/contactos/vincular-alias`). Las conversaciones del alias se mergean
 * en las del real, y futuros mensajes al mismo @lid caen directo al real sin
 * crear duplicados.
 *
 * Operación destructiva (unifica historial + mueve referencias), así que exige
 * confirmación explícita. Reversible solo con `UPDATE ... SET alias_de_contact_id = NULL`
 * — la asesora no puede deshacerlo desde la UI por ahora.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link2, Search, X, Loader2, AlertTriangle } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { esLidWhatsapp } from "@/lib/chat/wa-phone";

type ContactoResultado = {
  id: string;
  name: string | null;
  phone_number: string;
};

export function VincularAliasBoton({
  contactoActualId,
  contactoActualNombre,
  onVinculado,
  compacto = false,
}: {
  contactoActualId: string;
  contactoActualNombre: string | null;
  onVinculado?: (realId: string) => void;
  compacto?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<ContactoResultado[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [elegido, setElegido] = useState<ContactoResultado | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce 300 ms de la búsqueda — evita spamear la API con cada tecla.
  useEffect(() => {
    if (!abierto || !q || q.length < 2) {
      setResultados([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setBuscando(true);
      try {
        const res = await fetchWithSupabaseSession(
          `/api/chat/contactos/buscar?q=${encodeURIComponent(q)}&excluir=${contactoActualId}`
        );
        const j = (await res.json().catch(() => null)) as { success?: boolean; data?: { contactos?: ContactoResultado[] } } | null;
        setResultados(j?.data?.contactos ?? []);
      } catch {
        setResultados([]);
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, abierto, contactoActualId]);

  const cerrar = useCallback(() => {
    setAbierto(false);
    setQ("");
    setResultados([]);
    setElegido(null);
    setErr(null);
  }, []);

  const confirmar = useCallback(async () => {
    if (!elegido || enviando) return;
    setEnviando(true);
    setErr(null);
    try {
      const res = await fetchWithSupabaseSession("/api/chat/contactos/vincular-alias", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias_contact_id: contactoActualId, real_contact_id: elegido.id }),
      });
      const j = (await res.json().catch(() => null)) as { success?: boolean; data?: unknown; error?: string } | null;
      if (!res.ok || !j?.success) {
        setErr(j?.error || `Error ${res.status}`);
        setEnviando(false);
        return;
      }
      cerrar();
      onVinculado?.(elegido.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red");
      setEnviando(false);
    }
  }, [elegido, enviando, contactoActualId, cerrar, onVinculado]);

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={
          compacto
            ? "inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-[#4FAEB2]/50 hover:text-[#3F8E91]"
            : "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:border-[#4FAEB2]/50 hover:text-[#3F8E91]"
        }
        title="Vincular este contacto a otro — mergea el historial y evita duplicados futuros"
      >
        <Link2 className="h-3.5 w-3.5" />
        Es la misma persona que…
      </button>

      {abierto ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !enviando) cerrar();
          }}
        >
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" aria-hidden="true" />
          <div className="relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Vincular como alias</h2>
                <p className="text-[11px] leading-snug text-slate-500">
                  Elegí el contacto real al que corresponde este chat. Se unifica el historial y los
                  próximos mensajes caen directo acá, sin duplicados.
                </p>
              </div>
              <button
                type="button"
                onClick={cerrar}
                disabled={enviando}
                aria-label="Cerrar"
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="border-b border-slate-100 bg-slate-50 px-4 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Este contacto</p>
              <p className="truncate text-sm font-medium text-slate-800">
                {contactoActualNombre || "Sin nombre"}
                <span className="ml-2 text-[11px] font-normal text-slate-400">
                  (quedará vinculado al elegido)
                </span>
              </p>
            </div>

            <div className="shrink-0 border-b border-slate-100 px-3 py-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setElegido(null);
                  }}
                  autoFocus
                  placeholder="Nombre o teléfono…"
                  className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-sm focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
                  disabled={enviando}
                />
              </div>
            </div>

            <ul className="min-h-[180px] flex-1 divide-y divide-slate-100 overflow-y-auto">
              {buscando ? (
                <li className="flex items-center justify-center p-6 text-xs text-slate-400">
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Buscando…
                </li>
              ) : resultados.length === 0 ? (
                <li className="p-6 text-center text-xs text-slate-400">
                  {q.length < 2
                    ? "Escribí al menos 2 letras o 4 dígitos."
                    : "Sin resultados."}
                </li>
              ) : (
                resultados.map((c) => {
                  const activo = elegido?.id === c.id;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setElegido(c)}
                        disabled={enviando}
                        className={`flex w-full items-start gap-2 px-3 py-2 text-left transition-colors ${
                          activo ? "bg-[#4FAEB2]/10" : "hover:bg-slate-50"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-800">
                            {c.name || <span className="italic text-slate-400">Sin nombre</span>}
                          </p>
                          <p className="truncate text-[11px] text-slate-500">
                            {esLidWhatsapp(c.phone_number) ? "ID de WhatsApp" : c.phone_number}
                          </p>
                        </div>
                        {activo ? <span className="text-[#3F8E91]">✓</span> : null}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>

            {err ? (
              <div className="flex items-start gap-2 border-t border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{err}</span>
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-3 py-2.5">
              <button
                type="button"
                onClick={cerrar}
                disabled={enviando}
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-300 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmar}
                disabled={!elegido || enviando}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[#3F8E91] disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                {enviando ? "Vinculando…" : "Vincular"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
