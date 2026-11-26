"use client";

import { useState } from "react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { clienteConfig } from "@/erp2/cliente.config";
import { Modal } from "@/erp2/components/Modal";
import { Select } from "@/erp2/components/Select";
import { PIE_MODAL } from "@/erp2/modules/clientes/ui";
import type { Cliente } from "@/erp2/modules/caja/lib";
import { normalizarRuc, validarRuc } from "@/erp2/modules/empresa/tipos";
import { AyudaRuc, claseRuc, rucConError } from "@/erp2/modules/clientes/AyudaRuc";

const BRAND = clienteConfig.color;
const INPUT =
  "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";

/** Alta rápida de cliente. Se usa desde la página de Clientes y desde la caja. */
export function NuevoCliente({
  onClose,
  onCreado,
  inicial,
}: {
  onClose: () => void;
  onCreado: (c: Cliente) => void;
  /** Datos precargados (ej. desde la ficha de un chat: nombre y teléfono del contacto). */
  inicial?: { nombre?: string; telefono?: string };
}) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? "");
  const [tipo, setTipo] = useState<"persona" | "empresa">("persona");
  const [documento, setDocumento] = useState("");
  const [telefono, setTelefono] = useState(inicial?.telefono ?? "");
  const [condicion, setCondicion] = useState<"CONTADO" | "CREDITO">("CONTADO");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Con guion (o si es empresa) el documento es un RUC: se valida el dígito verificador.
  const pareceRuc = !!documento.trim() && (tipo === "empresa" || documento.includes("-"));
  const rucEmpresaMal = tipo === "empresa" && pareceRuc && rucConError(documento);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    // Empresa: el documento es su RUC y tiene que dar el dígito verificador (sin RUC válido no hay factura).
    if (rucEmpresaMal) { const v = validarRuc(documento); setError(`RUC: ${"mensaje" in v ? v.mensaje : "no es válido"}.`); return; }
    setBusy(true);
    setError(null);
    try {
      const c = await apiFetch<Cliente>("/api/clientes", {
        method: "POST",
        body: JSON.stringify({
          nombre: nombre.trim(),
          tipo_cliente: tipo,
          documento: documento.trim() ? (pareceRuc ? normalizarRuc(documento) : documento.trim()) : undefined,
          telefono: telefono.trim() || undefined,
          condicion_pago: condicion,
        }),
      });
      onCreado(c);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal titulo="Nuevo cliente" onClose={onClose}>
      <form onSubmit={guardar} className="space-y-4">
        <div className="flex gap-2">
          {(["persona", "empresa"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTipo(t)}
              className="min-h-11 flex-1 rounded-xl border-2 py-2 text-xs font-semibold capitalize transition-colors sm:min-h-0"
              style={tipo === t ? { borderColor: BRAND, backgroundColor: "var(--brand-50)", color: BRAND } : { borderColor: "#e2e8f0", color: "#64748b" }}
            >
              {t}
            </button>
          ))}
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">{tipo === "empresa" ? "Razón social / nombre *" : "Nombre *"}</span>
          <input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} className={INPUT} placeholder={tipo === "empresa" ? "Nombre de la empresa" : "Nombre y apellido"} />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">{tipo === "empresa" ? "RUC" : "Documento"}</span>
            <input value={documento} onChange={(e) => setDocumento(e.target.value)} className={`${INPUT} ${pareceRuc ? claseRuc(documento) : ""}`} placeholder="Opcional" aria-invalid={pareceRuc && rucConError(documento)} />
            {pareceRuc ? <AyudaRuc valor={documento} aviso={tipo !== "empresa"} onUsar={(r) => { setDocumento(r); setError(null); }} /> : null}
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Teléfono</span>
            <input type="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} className={INPUT} placeholder="Opcional" />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Condición</span>
            <Select value={condicion} onChange={(v) => setCondicion(v as "CONTADO" | "CREDITO")} block options={[["CONTADO", "Contado"], ["CREDITO", "Crédito"]]} etiqueta="Condición" />
          </div>
        </div>

        {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}

        <div className={PIE_MODAL}>
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy || !nombre.trim()}
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-40"
            style={{ backgroundColor: BRAND }}
          >
            {busy ? "Guardando…" : "Crear cliente"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
