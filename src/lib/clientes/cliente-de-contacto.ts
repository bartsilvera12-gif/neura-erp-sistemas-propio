import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/** Últimos 9 dígitos: iguala 0981…, 595981… y +595 981…. */
export function claveTelefono(v: unknown): string {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 8 ? d.slice(-9) : "";
}

const normalizarNombre = (v: unknown): string =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export type ClienteDelContacto = {
  cliente_id: string;
  /** `telefono` y `contacto` son seguros para vincular; `nombre` sólo sugiere. */
  via: "telefono" | "contacto" | "nombre";
  contacto?: string;
};

/**
 * El cliente de un contacto del chat: primero por teléfono del cliente
 * (principal o secundario), después por teléfono de sus contactos secundarios
 * y por último por nombre exacto (empresa, nombre o contacto). Si hay más de un
 * cliente posible no se adivina.
 */
export async function clienteDelContacto(
  sb: AppSupabaseClient,
  empresaId: string,
  telefono: string | null,
  nombre: string | null
): Promise<ClienteDelContacto | null> {
  const filas: {
    id: string;
    telefono: string | null;
    telefono_secundario: string | null;
    nombre: string | null;
    empresa: string | null;
    nombre_contacto: string | null;
  }[] = [];
  for (let desde = 0; desde < 20_000; desde += 1000) {
    const { data, error } = await sb
      .from("clientes")
      .select("id, telefono, telefono_secundario, nombre, empresa, nombre_contacto")
      .eq("empresa_id", empresaId)
      .is("deleted_at", null)
      .range(desde, desde + 999);
    if (error) return null;
    const lote = (data ?? []) as typeof filas;
    filas.push(...lote);
    if (lote.length < 1000) break;
  }

  // Contactos secundarios cargados en Gestión de clientes (si la tabla existe).
  const { data: contactosData } = await sb
    .from("cliente_contactos")
    .select("cliente_id, nombre, telefono")
    .eq("empresa_id", empresaId)
    .limit(20_000);
  // Sólo contactos de clientes vigentes (no eliminados).
  const vigentes = new Set(filas.map((c) => c.id));
  const contactos = ((contactosData ?? []) as { cliente_id: string; nombre: string; telefono: string | null }[]).filter(
    (c) => vigentes.has(c.cliente_id)
  );

  const clave = claveTelefono(telefono);
  if (clave) {
    const porTelefono = filas.filter(
      (c) => claveTelefono(c.telefono) === clave || claveTelefono(c.telefono_secundario) === clave
    );
    if (porTelefono.length === 1) return { cliente_id: porTelefono[0].id, via: "telefono" };
    // El número es de un contacto secundario: si todos apuntan al mismo cliente, es ese.
    const porContacto = contactos.filter((c) => claveTelefono(c.telefono) === clave);
    const clientesContacto = [...new Set(porContacto.map((c) => c.cliente_id))];
    if (porTelefono.length === 0 && clientesContacto.length === 1) {
      return { cliente_id: clientesContacto[0], via: "contacto", contacto: porContacto[0].nombre };
    }
  }
  const n = normalizarNombre(nombre);
  if (n.length >= 3) {
    const porNombre = filas.filter((c) =>
      [c.empresa, c.nombre, c.nombre_contacto].some((x) => normalizarNombre(x) === n)
    );
    if (porNombre.length === 1) return { cliente_id: porNombre[0].id, via: "nombre" };
  }
  return null;
}
