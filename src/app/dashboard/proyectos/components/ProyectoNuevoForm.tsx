"use client";

import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { ClienteSearchSelect } from "@/app/dashboard/proyectos/components/ClienteSearchSelect";
import { FancySelect } from "@/app/dashboard/proyectos/components/FancySelect";
import { FechaSelect } from "@/components/ui/FechaSelect";

type Tipo = { id: string; nombre: string; codigo: string };
type Estado = { id: string; nombre: string };
type Cliente = {
  id: string;
  empresa?: string | null;
  nombre_contacto?: string | null;
  telefono?: string | null;
  telefono_secundario?: string | null;
};
type Usuario = { id: string; nombre?: string | null };

export type ProyectoNuevoFormProps = {
  variant?: "page" | "modal";
  onCreated: (id: string) => void;
  onCancel?: () => void;
};

const INPUT_CLS =
  "mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20";
const LABEL_CLS = "text-xs font-medium uppercase tracking-wide text-slate-500";

export default function ProyectoNuevoForm({
  variant = "page",
  onCreated,
  onCancel,
}: ProyectoNuevoFormProps) {
  const [tipos, setTipos] = useState<Tipo[]>([]);
  const [estados, setEstados] = useState<Estado[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [tipoId, setTipoId] = useState("");
  const [estadoId, setEstadoId] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [titulo, setTitulo] = useState("");
  const [prioridad, setPrioridad] = useState("normal");
  const [rc, setRc] = useState("");
  const [rt, setRt] = useState("");
  const [fechaIngreso, setFechaIngreso] = useState(() => new Date().toISOString().slice(0, 10));
  const [fechaProm, setFechaProm] = useState("");
  // WhatsApp / contacto del proyecto. Se autocompleta con el teléfono del cliente
  // elegido y queda editable. (El resto del brief se completa en el detalle.)
  const [contactoWhatsapp, setContactoWhatsapp] = useState("");

  useEffect(() => {
    let cancel = false;
    (async () => {
      const [rT, rE, rC, rU] = await Promise.all([
        fetchWithSupabaseSession("/api/proyectos/tipos", { cache: "no-store" }),
        fetchWithSupabaseSession("/api/proyectos/estados", { cache: "no-store" }),
        fetchWithSupabaseSession("/api/clientes", { cache: "no-store" }),
        fetchWithSupabaseSession("/api/usuarios/empresa-activos", { cache: "no-store" }),
      ]);
      const jT = (await rT.json()) as { success?: boolean; data?: Tipo[] };
      const jE = (await rE.json()) as { success?: boolean; data?: Estado[] };
      const jC = (await rC.json()) as { success?: boolean; data?: Cliente[] };
      const jUsers = (await rU.json()) as { usuarios?: Usuario[] };
      if (cancel) return;
      if (jT.success && jT.data) {
        setTipos(jT.data);
        const web = jT.data.find((t) => t.codigo === "web");
        if (web) setTipoId(web.id);
      }
      if (jE.success && jE.data) setEstados(jE.data);
      if (jC.success && jC.data) setClientes(jC.data);
      setUsuarios(jUsers.usuarios ?? []);
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, []);

  // Al elegir un cliente: setear el cliente y autocompletar WhatsApp/contacto con su teléfono
  // (editable). Se hace en el evento de selección, no en un efecto.
  function handleClienteChange(id: string) {
    setClienteId(id);
    if (!id) return;
    const c = clientes.find((x) => x.id === id);
    const tel = (c?.telefono ?? "").trim() || (c?.telefono_secundario ?? "").trim();
    if (tel) setContactoWhatsapp(tel);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tipoId) {
      setErr("Seleccioná un tipo de proyecto.");
      return;
    }
    if (!titulo.trim()) {
      setErr("El título es requerido.");
      return;
    }
    setSaving(true);
    setErr(null);
    // El brief (marca, dominio, rubro, secciones, SaaS/facturación, etc.) YA NO se
    // pide al crear: el comercial registra el proyecto con lo mínimo y todo eso se
    // completa después en el detalle (pestaña Datos). Lo único que sí conviene
    // capturar ya es el WhatsApp de contacto, autocompletado con el del cliente.
    const brief_data: Record<string, unknown> = {};
    const contacto = contactoWhatsapp.trim();
    if (contacto) brief_data.whatsapp_contacto = contacto;

    const body: Record<string, unknown> = {
      tipo_id: tipoId,
      titulo,
      descripcion: null,
      prioridad,
      cliente_id: clienteId || null,
      responsable_comercial_id: rc || null,
      responsable_tecnico_id: rt || null,
      fecha_ingreso: new Date(fechaIngreso + "T12:00:00").toISOString(),
      fecha_prometida: fechaProm ? new Date(fechaProm + "T12:00:00").toISOString() : null,
      brief_data,
    };
    if (estadoId) body.estado_id = estadoId;

    try {
      const res = await fetchWithSupabaseSession("/api/proyectos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => null)) as
        | { success?: boolean; data?: { id?: string }; error?: string }
        | null;
      if (!res.ok || !j?.success || !j.data?.id) {
        setErr(j?.error ?? "No se pudo crear");
        return;
      }
      onCreated(j.data.id);
    } catch (e) {
      // Antes, un throw de red dejaba "Crear" trabado con el formulario lleno.
      setErr(e instanceof Error ? e.message : "No se pudo crear el proyecto.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center px-6 py-12 text-sm text-slate-500">
        Cargando…
      </div>
    );
  }

  const isModal = variant === "modal";

  return (
    <form
      onSubmit={onSubmit}
      className={
        isModal
          ? "flex h-full min-h-0 flex-col"
          : "space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      }
    >
      {err ? (
        <div
          className={
            isModal
              ? "mx-6 mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-sm text-rose-700"
              : "rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-sm text-rose-700"
          }
        >
          {err}
        </div>
      ) : null}

      <div
        className={
          isModal
            ? "min-h-0 flex-1 space-y-6 overflow-y-auto bg-slate-50/50 px-6 py-5"
            : "space-y-6"
        }
      >
        <div className={isModal ? "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" : ""}>
          {isModal ? (
            <div className="mb-4 flex items-center gap-2">
              <span className="h-5 w-1 rounded-full bg-[#4FAEB2]" />
              <h2 className="text-sm font-semibold text-slate-900">Datos generales</h2>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm sm:col-span-2">
              <span className={LABEL_CLS}>Título</span>
              <input
                required
                className={INPUT_CLS}
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Nombre del proyecto"
              />
            </label>
            <div className="block text-sm">
              <span className={LABEL_CLS}>
                Tipo <span className="text-rose-500">*</span>
              </span>
              <div className="mt-1.5">
                <FancySelect
                  ariaLabel="Tipo de proyecto"
                  placeholder="Seleccionar…"
                  value={tipoId}
                  onChange={setTipoId}
                  options={tipos.map((t) => ({ value: t.id, label: t.nombre }))}
                />
              </div>
            </div>
            <div className="block text-sm">
              <span className={LABEL_CLS}>Estado inicial (opcional)</span>
              <div className="mt-1.5">
                <FancySelect
                  ariaLabel="Estado inicial"
                  placeholder="Predeterminado de empresa"
                  value={estadoId}
                  onChange={setEstadoId}
                  options={[
                    { value: "", label: "Predeterminado de empresa" },
                    ...estados.map((s) => ({ value: s.id, label: s.nombre })),
                  ]}
                />
              </div>
            </div>
            <ClienteSearchSelect clientes={clientes} value={clienteId} onChange={handleClienteChange} />
            <div className="block text-sm">
              <span className={LABEL_CLS}>Prioridad</span>
              <div className="mt-1.5">
                <FancySelect
                  ariaLabel="Prioridad"
                  value={prioridad}
                  onChange={setPrioridad}
                  options={[
                    { value: "baja", label: "Baja" },
                    { value: "normal", label: "Media" },
                    { value: "alta", label: "Alta" },
                    { value: "urgente", label: "Urgente" },
                  ]}
                />
              </div>
            </div>
            <div className="block text-sm">
              <span className={LABEL_CLS}>Resp. comercial</span>
              <div className="mt-1.5">
                <FancySelect
                  ariaLabel="Responsable comercial"
                  placeholder="—"
                  value={rc}
                  onChange={setRc}
                  options={[
                    { value: "", label: "—" },
                    ...usuarios.map((u) => ({
                      value: u.id,
                      label: u.nombre ?? u.id.slice(0, 8),
                    })),
                  ]}
                />
              </div>
            </div>
            <div className="block text-sm">
              <span className={LABEL_CLS}>Resp. técnico</span>
              <div className="mt-1.5">
                <FancySelect
                  ariaLabel="Responsable técnico"
                  placeholder="—"
                  value={rt}
                  onChange={setRt}
                  options={[
                    { value: "", label: "—" },
                    ...usuarios.map((u) => ({
                      value: u.id,
                      label: u.nombre ?? u.id.slice(0, 8),
                    })),
                  ]}
                />
              </div>
            </div>
            <label className="block text-sm">
              <span className={LABEL_CLS}>Fecha ingreso</span>
              <FechaSelect
                required
                className={INPUT_CLS}
                value={fechaIngreso}
                onChange={(e) => setFechaIngreso(e.target.value)}
/>
            </label>
            <label className="block text-sm">
              <span className={LABEL_CLS}>Fecha prometida</span>
              <FechaSelect
                className={INPUT_CLS}
                value={fechaProm}
                onChange={(e) => setFechaProm(e.target.value)}
/>
            </label>
            <label className="block text-sm">
              <span className={LABEL_CLS}>WhatsApp / contacto</span>
              <input
                className={INPUT_CLS}
                placeholder="+595..."
                value={contactoWhatsapp}
                onChange={(e) => setContactoWhatsapp(e.target.value)}
              />
              <span className="mt-1 block text-[11px] text-slate-400">
                Se completa solo con el teléfono del cliente. Podés editarlo.
              </span>
            </label>
          </div>
        </div>

      </div>

      <div
        className={
          isModal
            ? "flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-white px-6 py-4"
            : "flex flex-wrap items-center justify-end gap-2 pt-2"
        }
      >
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:text-[#4FAEB2]"
          >
            Cancelar
          </button>
        ) : null}
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-[#4FAEB2] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#3F8E91] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
        >
          {saving ? "Guardando…" : "Crear proyecto"}
        </button>
      </div>
    </form>
  );
}
