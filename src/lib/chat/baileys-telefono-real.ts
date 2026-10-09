/**
 * Corregir el número que el inbox muestra para los contactos del canal WhatsApp QR.
 *
 * WhatsApp ya no siempre manda el teléfono: muchos chats llegan identificados con un @lid
 * (un código interno, ej. `219537454674033`). Ese código quedaba guardado como si fuera el
 * teléfono del contacto y así se veía en la lista de chats, en la ficha y en todos lados.
 *
 * Acá se reemplaza por el teléfono de verdad cuando el puente logra averiguarlo. Lo usan dos
 * caminos: el webhook de mensajes (cuando el mensaje entrante trae el teléfono) y el endpoint
 * de contactos (cuando WhatsApp manda la equivalencia por su cuenta, sin que nadie escriba).
 */
import type { SupabaseAdmin } from "@/lib/chat/types";
import { normalizeWaPhone } from "@/lib/chat/wa-phone";

const LOG = "[baileys/telefono-real]";

/** ¿`tel` parece un teléfono real guardable? dígitos, 8–15, y distinto del @lid. */
function telefonoValido(lid: string, tel: string): boolean {
  if (!lid || !tel || lid === tel) return false;
  return tel.length >= 8 && tel.length <= 15;
}

/**
 * Guarda el teléfono REAL del contacto en la columna `telefono_real`, SIN tocar
 * `phone_number` ni `wa_jid`. Es la forma NO destructiva de mostrar el número:
 *  - el chat sigue identificado por el @lid → no se parte, no se duplica, no cambia el envío;
 *  - la UI muestra `telefono_real` cuando existe.
 *
 * Solo escribe sobre la fila cuyo `phone_number` es el @lid (identificador entrante). Un
 * contacto normal (phone_number = su teléfono) NUNCA se toca: ahí `lid === tel` y se corta.
 * Acotado a la empresa (y la fila ya pertenece al canal del inbound). Valida el número.
 * Devuelve true si actualizó una fila.
 */
export async function guardarTelefonoRealDelContacto(
  supabase: SupabaseAdmin,
  empresaId: string,
  lidGuardado: string,
  telefonoReal: string
): Promise<boolean> {
  const lid = normalizeWaPhone(lidGuardado);
  const tel = normalizeWaPhone(telefonoReal);
  if (!empresaId || !telefonoValido(lid, tel)) return false;
  try {
    const { data, error } = await supabase
      .from("chat_contacts")
      .update({ telefono_real: tel, updated_at: new Date().toISOString() })
      .eq("empresa_id", empresaId)
      .eq("phone_number", lid)
      .select("id")
      .maybeSingle();
    if (error) {
      console.warn(LOG, "telefono_real_update_fallo", error.message);
      return false;
    }
    if (data) console.info(LOG, "telefono_real_guardado", { lid, tel });
    return Boolean(data);
  } catch (e) {
    console.warn(LOG, "telefono_real_excepcion", e instanceof Error ? e.message : String(e));
    return false;
  }
}

/** Ver el comentario de abajo: se apagó porque partía el chat en dos. */
const DEJAR_CORREGIR_NUMEROS = false;

/**
 * Reemplaza el identificador interno por el teléfono real, en la MISMA fila del contacto:
 * no se crea un contacto nuevo ni se parte el historial.
 *
 * Si YA existe otro contacto de la empresa con ese teléfono, no se toca nada. Fusionar dos
 * contactos es otra decisión —hay conversaciones, clientes vinculados y notas de por medio— y
 * hacerlo a ciegas acá además rompería el índice único (empresa_id, phone_number).
 */
export async function corregirTelefonoDelContacto(
  supabase: SupabaseAdmin,
  empresaId: string,
  contactId: string,
  guardado: string,
  telefonoReal: string
): Promise<boolean> {
  // APAGADO. Renombrar el número PARTÍA el chat en dos.
  //
  // El inbox busca al contacto por el número guardado. Al renombrar la fila al teléfono real,
  // el siguiente mensaje que entraba con el @lid no encontraba a nadie con ese número y creaba
  // un contacto NUEVO: el mismo cliente quedaba como dos chats, en dos colas y con dos agentes.
  //
  // Para reactivarlo hace falta primero que el @lid quede guardado en el contacto, para poder
  // seguir encontrándolo después de cambiarle el número. Mientras tanto, mostrar el código feo
  // es mucho menos grave que partir conversaciones.
  if (!DEJAR_CORREGIR_NUMEROS) return false;
  if (!contactId || !telefonoReal || telefonoReal === guardado) return false;
  try {
    const { data: ocupado } = await supabase
      .from("chat_contacts")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("phone_number", telefonoReal)
      .maybeSingle();
    if (ocupado && String((ocupado as { id?: string }).id ?? "") !== contactId) {
      console.info(LOG, "telefono_real_ya_usado", { contactId, telefonoReal });
      return false;
    }

    const parche: Record<string, unknown> = {
      phone_number: telefonoReal,
      phone_normalized: telefonoReal,
      updated_at: new Date().toISOString(),
    };
    const { data: actual } = await supabase
      .from("chat_contacts")
      .select("name")
      .eq("id", contactId)
      .maybeSingle();
    // Si el nombre visible era el código interno, también queda corregido.
    const nombre = String((actual as { name?: string | null } | null)?.name ?? "");
    if (nombre && nombre.replace(/\D+/g, "") === guardado) parche.name = telefonoReal;

    const { error } = await supabase
      .from("chat_contacts")
      .update(parche)
      .eq("empresa_id", empresaId)
      .eq("id", contactId);
    if (error) {
      console.warn(LOG, "no_se_pudo_corregir", error.message);
      return false;
    }
    console.info(LOG, "telefono_corregido", { contactId, de: guardado, a: telefonoReal });
    return true;
  } catch (e) {
    // Corregir el número es cosmético: si falla, el mensaje ya se guardó igual.
    console.warn(LOG, "corregir_fallo", e instanceof Error ? e.message : String(e));
    return false;
  }
}
