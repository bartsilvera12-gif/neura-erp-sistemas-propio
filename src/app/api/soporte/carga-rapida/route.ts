import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import { puedeEstarACargo } from "@/lib/soporte/dominio";
import { crearTipificacionConTicket, gestionDeTipoTicket, responsableAutomatico } from "@/lib/soporte/tipificacion-ticket";
import { requireCargaSoporteApi } from "@/lib/soporte/soporte-auth";
import { clienteDelContacto } from "@/lib/clientes/cliente-de-contacto";
import type { TipoGestion } from "@/lib/gestion-clientes/types";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import {
  clientesDeEmpresa,
  errorInesperado,
  falla,
  leerCatalogos,
  ok,
  personasDeEmpresa,
  personasPorId,
  sinPermiso,
} from "@/lib/soporte/servidor";

const UUID = /^[0-9a-f-]{36}$/i;

/** Mapa comportamiento del sub-estado → tipo de ticket. */
function tipoTicketDeComportamiento(comp: string | null | undefined): "error" | "cambio" | null {
  const c = String(comp ?? "").trim();
  return c === "ticket_error" ? "error" : c === "ticket_cambio" ? "cambio" : null;
}

/**
 * Catálogo completo (activos) de Estado → Sub-estado, igual que en la
 * tipificación de Gestión de clientes. Se muestran TODOS: los sub-estados con
 * acción de ticket crean un ticket de Soporte; el resto (consultas, etc.) queda
 * como tipificación registrada en el historial del cliente.
 */
async function estadosCatalogo(sb: AppSupabaseClient, empresaId: string) {
  try {
    const [famRes, estRes] = await Promise.all([
      sb.from("tipificacion_familias").select("id, nombre, activo").eq("empresa_id", empresaId).order("sort_order").order("nombre"),
      sb.from("tipificacion_estados").select("id, familia_id, nombre, activo, comportamiento").eq("empresa_id", empresaId).order("sort_order").order("nombre"),
    ]);
    if (famRes.error || estRes.error) return [];
    const familias = (famRes.data ?? []) as { id: string; nombre: string; activo: boolean }[];
    const estados = (estRes.data ?? []) as { id: string; familia_id: string; nombre: string; activo: boolean; comportamiento: string | null }[];
    return familias
      .filter((f) => f.activo)
      .map((f) => ({
        id: f.id,
        nombre: f.nombre,
        subestados: estados
          .filter((e) => e.familia_id === f.id && e.activo)
          .map((e) => ({ id: e.id, nombre: e.nombre, comportamiento: e.comportamiento })),
      }))
      .filter((f) => f.subestados.length > 0);
  } catch {
    return [];
  }
}

/**
 * Asocia el contacto del chat al cliente elegido si todavía no lo estaba: la
 * próxima vez se reconoce solo y aparece "Cliente →" en la conversación.
 */
async function asociarContacto(sb: AppSupabaseClient, empresaId: string, conversationId: string | null, clienteId: string) {
  if (!conversationId) return;
  const { data: conv } = await sb.from("chat_conversations").select("contact_id").eq("empresa_id", empresaId).eq("id", conversationId).maybeSingle();
  const contactId = (conv as { contact_id?: string | null } | null)?.contact_id;
  if (!contactId) return;
  await sb.from("chat_contacts").update({ cliente_id: clienteId }).eq("empresa_id", empresaId).eq("id", contactId).is("cliente_id", null);
}

/**
 * Carga de un ticket de Soporte desde Conversaciones.
 *
 * La usan los Project Managers (y quien ya usa Soporte) sin salir del chat.
 * Tiene su propio permiso (`requireCargaSoporteApi`): sirve para CREAR un
 * ticket, no abre listados, edición ni configuración del módulo.
 *
 * GET ?verificar=1   → { puede: true } o 403, para mostrar el botón.
 * GET                → lo necesario para el formulario (tipos, niveles, clientes,
 *                      quiénes pueden quedar a cargo). 403 si no puede cargar:
 *                      la pantalla usa eso para mostrar o no el botón.
 * GET ?cliente_id=…  → proyectos de ese cliente.
 * POST               → registra la tipificación (Error o Cambio) con su ticket,
 *                      y lo deja en el historial del cliente.
 */
export async function GET(request: Request) {
  const auth = await requireCargaSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const params = new URL(request.url).searchParams;
    // Sólo saber si puede cargar (para mostrar el botón), sin traer nada más.
    if (params.get("verificar") === "1") return ok({ puede: true });
    // Cliente del contacto del chat, por teléfono o nombre.
    if (params.has("contacto_telefono") || params.has("contacto_nombre")) {
      return ok({ asociado: await clienteDelContacto(auth.sb, auth.empresaId, params.get("contacto_telefono"), params.get("contacto_nombre")) });
    }
    const clienteId = params.get("cliente_id");
    if (clienteId) {
      if (!UUID.test(clienteId)) return falla("cliente_id inválido");
      const { data, error } = await auth.sb
        .from("proyectos")
        .select("id, titulo")
        .eq("empresa_id", auth.empresaId)
        .eq("cliente_id", clienteId)
        .eq("archivado", false)
        .order("titulo");
      if (error) return falla(error.message);
      return ok({ proyectos: data ?? [] });
    }

    // A quién iría cada tipo si se carga ahora: un error puede ir a guardia, un cambio nunca.
    const [asigError, asigCambio] = await Promise.all([
      responsableAutomatico(auth.sb, auth.empresaId, "error"),
      responsableAutomatico(auth.sb, auth.empresaId, "cambio"),
    ]);
    const [cat, personas, clientes, estadosCat] = await Promise.all([
      leerCatalogos(auth.sb, auth.empresaId),
      personasDeEmpresa(auth.empresaId),
      clientesDeEmpresa(auth.sb, auth.empresaId),
      // Catálogo completo Estado → Sub-estados (Solicitud/Reclamo/Consulta…),
      // igual que en la tipificación del cliente. El ticket se crea sólo si el
      // sub-estado elegido tiene acción ticket_error/ticket_cambio.
      estadosCatalogo(auth.sb, auth.empresaId),
    ]);
    return ok({
      // Sólo los tipos que nacen de una tipificación (Error y Cambio).
      tipos: cat.tipos.filter((t) => t.activo && gestionDeTipoTicket(t.codigo)),
      estados: estadosCat,
      clasificaciones: cat.clasificaciones.filter((c) => c.activo),
      a_cargo: personas.filter(puedeEstarACargo),
      // Quién recibe el ticket: se asigna solo, quien carga no elige.
      asignacion: {
        error: { responsable: personas.find((p) => p.id === asigError.responsableId) ?? null, motivo: asigError.motivo },
        cambio: { responsable: personas.find((p) => p.id === asigCambio.responsableId) ?? null, motivo: asigCambio.motivo },
      },
      clientes,
    });
  } catch (e) {
    return errorInesperado(e);
  }
}

export async function POST(request: Request) {
  const auth = await requireCargaSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return falla("Datos inválidos");

    const conversationId = typeof body.conversation_id === "string" && UUID.test(body.conversation_id) ? body.conversation_id : null;
    if (conversationId) {
      const { data: conv } = await auth.sb
        .from("chat_conversations")
        .select("id")
        .eq("empresa_id", auth.empresaId)
        .eq("id", conversationId)
        .maybeSingle();
      if (!conv) return falla("La conversación no existe", 404);
    }

    const clienteId = typeof body.cliente_id === "string" && UUID.test(body.cliente_id) ? body.cliente_id : "";
    if (!clienteId) return falla("Elegí un cliente");
    const { data: cliente } = await auth.sb
      .from("clientes")
      .select("id")
      .eq("empresa_id", auth.empresaId)
      .eq("id", clienteId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!cliente) return falla("El cliente no existe", 404);

    // Los tickets nacen de una tipificación. Modelo nuevo: se elige un Sub-estado
    // del catálogo (Estado → Sub-estado) que tenga acción de ticket. Compat: si
    // llega el `tipo_codigo` viejo (error/cambio), se sigue aceptando.
    const estadoId = typeof body.estado_id === "string" && UUID.test(body.estado_id) ? body.estado_id : "";
    const subestadoId = typeof body.subestado_id === "string" && UUID.test(body.subestado_id) ? body.subestado_id : "";
    const descripcion = typeof body.descripcion === "string" ? body.descripcion.trim() : "";
    let tipoGestion: TipoGestion | null = null;
    let catNombres: { estado: string; sub: string } | null = null;

    if (estadoId && subestadoId) {
      const [estRes, subRes] = await Promise.all([
        auth.sb.from("tipificacion_familias").select("id, nombre").eq("empresa_id", auth.empresaId).eq("id", estadoId).maybeSingle(),
        auth.sb.from("tipificacion_estados").select("id, nombre, comportamiento, familia_id").eq("empresa_id", auth.empresaId).eq("id", subestadoId).maybeSingle(),
      ]);
      const estado = estRes.data as { id: string; nombre: string } | null;
      const sub = subRes.data as { id: string; nombre: string; comportamiento: string | null; familia_id: string } | null;
      if (!estado || !sub || sub.familia_id !== estadoId) return falla("Elegí un estado y sub-estado válidos");
      const tt = tipoTicketDeComportamiento(sub.comportamiento);
      if (tt) {
        // Sub-estado con acción de ticket → sigue el flujo de creación de ticket.
        tipoGestion = tt === "error" ? "Error" : "Cambio";
        catNombres = { estado: estado.nombre, sub: sub.nombre };
      } else {
        // Sub-estado sin ticket (Consulta, etc.): se registra sólo la tipificación
        // en el historial del cliente, igual que en Gestión de clientes.
        if (!descripcion) return falla("Escribí una descripción");
        const [authUser, personas] = await Promise.all([
          getAuthUserForApiRoute(request).catch(() => null),
          personasPorId([auth.usuarioId]),
        ]);
        const { data: tip, error: insErr } = await auth.sb
          .from("tipificaciones")
          .insert({
            empresa_id: auth.empresaId,
            cliente_id: clienteId,
            usuario: personas.get(auth.usuarioId)?.nombre ?? authUser?.email ?? "Usuario",
            usuario_id: auth.usuarioId,
            tipo_gestion: estado.nombre,
            resultado: sub.nombre,
            observacion: `Desde Conversaciones: ${descripcion}`.slice(0, 5000),
            familia_id: estadoId,
            estado_id: subestadoId,
          })
          .select("id")
          .single();
        if (insErr) return falla(insErr.message);
        await asociarContacto(auth.sb, auth.empresaId, conversationId, clienteId);
        return ok({ id: null, numero: null, ticket: false, tipificacion_id: (tip as { id: string }).id });
      }
    } else {
      tipoGestion = gestionDeTipoTicket(body.tipo_codigo);
    }
    if (!tipoGestion) return falla("Elegí si es un error o un cambio");

    const [authUser, personas] = await Promise.all([
      getAuthUserForApiRoute(request).catch(() => null),
      personasPorId([auth.usuarioId]),
    ]);
    const r = await crearTipificacionConTicket(auth, {
      clienteId,
      tipoGestion,
      observacion: `Desde Conversaciones: ${descripcion}`.slice(0, 5000),
      usuario: { id: auth.usuarioId, nombre: personas.get(auth.usuarioId)?.nombre ?? authUser?.email ?? "Usuario" },
      authUser: authUser ? { id: authUser.id, email: authUser.email ?? null } : null,
      datosTicket: {
        proyecto_id: body.proyecto_id,
        clasificacion_codigo: body.clasificacion_codigo,
        descripcion: body.descripcion,
      },
      // Como en la tipificación: el ticket siempre va sobre un proyecto del cliente.
      exigirProyecto: true,
      origen: "conversacion",
      conversationId,
    });
    if (!r.ok) return falla(r.mensaje, r.status);

    // Modelo nuevo: se sobreescribe la tipificación con los nombres del catálogo
    // (Estado/Sub-estado) + ids, para que se muestre y reporte igual que las de
    // Gestión de clientes. El ticket ya quedó vinculado.
    if (catNombres) {
      await auth.sb
        .from("tipificaciones")
        .update({ tipo_gestion: catNombres.estado, resultado: catNombres.sub, familia_id: estadoId, estado_id: subestadoId })
        .eq("empresa_id", auth.empresaId)
        .eq("id", r.tipificacion_id);
    }

    await asociarContacto(auth.sb, auth.empresaId, conversationId, clienteId);

    return ok({ id: r.ticket_id, numero: r.numero, ticket: true, tipificacion_id: r.tipificacion_id });
  } catch (e) {
    return errorInesperado(e);
  }
}
