import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import { errorInesperado, falla, ok, sinPermiso } from "@/lib/soporte/servidor";

/**
 * GET /api/soporte/opciones
 *   · sin parámetros → clientes existentes (para el selector).
 *   · ?cliente_id=… → proyectos de ese cliente.
 *
 * Los clientes y proyectos son los del ERP: Soporte los referencia, no los copia.
 */
export async function GET(request: Request) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const url = new URL(request.url);
    const clienteId = url.searchParams.get("cliente_id");

    if (clienteId) {
      if (!/^[0-9a-f-]{36}$/i.test(clienteId)) return falla("cliente_id inválido");
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

    // Paginado: PostgREST corta en 1000 filas y hay empresas con más clientes.
    const clientes: { id: string; nombre: string }[] = [];
    for (let desde = 0; desde < 20_000; desde += 1000) {
      const { data, error } = await auth.sb
        .from("clientes")
        .select("id, empresa, nombre_contacto")
        .eq("empresa_id", auth.empresaId)
        .order("empresa")
        .range(desde, desde + 999);
      if (error) return falla(error.message);
      const lote = (data ?? []) as { id: string; empresa?: string | null; nombre_contacto?: string | null }[];
      for (const c of lote) {
        clientes.push({ id: c.id, nombre: (c.empresa?.trim() || c.nombre_contacto?.trim() || "Cliente") as string });
      }
      if (lote.length < 1000) break;
    }
    clientes.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    return ok({ clientes });
  } catch (e) {
    return errorInesperado(e);
  }
}
