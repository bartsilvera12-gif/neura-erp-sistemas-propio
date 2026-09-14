import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import {
  TABLAS_CATALOGO,
  errorInesperado,
  falla,
  invalidarCatalogos,
  leerCatalogos,
  ok,
  personasDeEmpresa,
  sinPermiso,
} from "@/lib/soporte/servidor";

/**
 * GET /api/soporte/catalogos
 * Estados, tipos, clasificaciones (con SLA), prioridades y el equipo.
 */
export async function GET(request: Request) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const [catalogos, personas] = await Promise.all([
      leerCatalogos(auth.sb, auth.empresaId),
      personasDeEmpresa(auth.empresaId),
    ]);
    return ok({ ...catalogos, personas, puede_configurar: auth.puedeConfigurar, usuario_id: auth.usuarioId });
  } catch (e) {
    return errorInesperado(e);
  }
}

type Catalogo = keyof typeof TABLAS_CATALOGO;

/** Campos editables por catálogo. Lo que no está acá no se toca. */
const EDITABLES: Record<Catalogo, string[]> = {
  estados: ["nombre", "tipo", "color", "area", "detiene_sla", "sort_order", "activo"],
  tipos: ["nombre", "sla_horas", "sort_order", "activo"],
  clasificaciones: ["nombre", "sla_horas", "prioridad_sugerida", "sort_order", "activo"],
  prioridades: ["nombre", "color", "sort_order", "activo"],
};

function slug(texto: string): string {
  return texto
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}

/**
 * PUT /api/soporte/catalogos — crea o edita una fila de un catálogo.
 * Body: { catalogo, codigo?, ...campos }. Sin `codigo` se crea una fila nueva.
 *
 * El `codigo` no se edita nunca: es lo que guardan los tickets y el historial.
 * Renombrar un estado cambia cómo se ve, no qué tickets están en él.
 */
export async function PUT(request: Request) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  if (!auth.puedeConfigurar) return falla("Sólo un administrador puede configurar Soporte", 403);

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const catalogo = body?.catalogo as Catalogo;
    if (!catalogo || !(catalogo in TABLAS_CATALOGO)) return falla("Catálogo inválido");
    const tabla = TABLAS_CATALOGO[catalogo];

    const patch: Record<string, unknown> = {};
    for (const campo of EDITABLES[catalogo]) {
      if (!(campo in (body ?? {}))) continue;
      const v = body?.[campo];
      if (campo === "sla_horas") {
        if (v === null || v === "") patch[campo] = null;
        else {
          const n = Number(v);
          if (!Number.isFinite(n) || n <= 0 || n > 10_000) return falla("SLA inválido");
          patch[campo] = n;
        }
      } else if (campo === "sort_order") {
        const n = Number(v);
        if (!Number.isInteger(n)) return falla("Orden inválido");
        patch[campo] = n;
      } else if (campo === "activo" || campo === "detiene_sla") {
        patch[campo] = v === true;
      } else if (campo === "tipo") {
        if (v !== "abierto" && v !== "cerrado") return falla("Tipo de estado inválido");
        patch[campo] = v;
      } else if (campo === "color") {
        if (typeof v !== "string" || !/^#[0-9a-f]{6}$/i.test(v)) return falla("Color inválido");
        patch[campo] = v;
      } else {
        patch[campo] = typeof v === "string" ? v.trim() || null : v ?? null;
      }
    }
    if ("nombre" in patch && !patch.nombre) return falla("El nombre es obligatorio");

    const codigo = typeof body?.codigo === "string" ? body.codigo.trim() : "";
    if (codigo) {
      if (Object.keys(patch).length === 0) return falla("Nada para actualizar");
      const { error } = await auth.sb.from(tabla).update(patch).eq("empresa_id", auth.empresaId).eq("codigo", codigo);
      if (error) return falla(error.message);
    } else {
      const nombre = String(patch.nombre ?? "");
      if (!nombre) return falla("El nombre es obligatorio");
      const nuevo: Record<string, unknown> = { ...patch, empresa_id: auth.empresaId, codigo: slug(nombre) || crypto.randomUUID().slice(0, 8) };
      if (catalogo === "clasificaciones") {
        const tipo = typeof body?.tipo_codigo === "string" ? body.tipo_codigo : "";
        if (!tipo) return falla("La clasificación necesita un tipo");
        if (nuevo.sla_horas == null) return falla("La clasificación necesita un SLA");
        nuevo.tipo_codigo = tipo;
      }
      const { error } = await auth.sb.from(tabla).insert(nuevo);
      if (error) {
        if (error.message.toLowerCase().includes("duplicate")) return falla("Ya existe uno con ese nombre");
        return falla(error.message);
      }
    }
    invalidarCatalogos(auth.empresaId);
    return ok(await leerCatalogos(auth.sb, auth.empresaId));
  } catch (e) {
    return errorInesperado(e);
  }
}
