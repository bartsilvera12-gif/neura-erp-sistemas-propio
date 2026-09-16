import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import { puedeEstarACargo } from "@/lib/soporte/dominio";
import { crearTipificacionConTicket, gestionDeTipoTicket, responsablePorDefecto } from "@/lib/soporte/tipificacion-ticket";
import { requireCargaSoporteApi } from "@/lib/soporte/soporte-auth";
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

    const defecto = responsablePorDefecto(auth.empresaId);
    const [cat, personas, clientes] = await Promise.all([
      leerCatalogos(auth.sb, auth.empresaId),
      personasDeEmpresa(auth.empresaId),
      clientesDeEmpresa(auth.sb, auth.empresaId),
    ]);
    return ok({
      // Sólo los tipos que nacen de una tipificación (Error y Cambio).
      tipos: cat.tipos.filter((t) => t.activo && gestionDeTipoTicket(t.codigo)),
      clasificaciones: cat.clasificaciones.filter((c) => c.activo),
      a_cargo: personas.filter(puedeEstarACargo),
      // Quién recibe el ticket: se asigna solo, quien carga no elige.
      responsable: personas.find((p) => p.id === defecto) ?? null,
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
      .maybeSingle();
    if (!cliente) return falla("El cliente no existe", 404);

    // Los tickets nacen de una tipificación: desde el chat también se registra
    // la gestión (Error o Cambio) en la tipificación del cliente.
    const tipoGestion = gestionDeTipoTicket(body.tipo_codigo);
    if (!tipoGestion) return falla("Elegí si es un error o un cambio");
    const descripcion = typeof body.descripcion === "string" ? body.descripcion.trim() : "";

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
        asunto: body.asunto,
        descripcion: body.descripcion,
      },
      // Como en la tipificación: el ticket siempre va sobre un proyecto del cliente.
      exigirProyecto: true,
      origen: "conversacion",
      conversationId,
    });
    if (!r.ok) return falla(r.mensaje, r.status);

    return ok({ id: r.ticket_id, numero: r.numero, tipificacion_id: r.tipificacion_id });
  } catch (e) {
    return errorInesperado(e);
  }
}
