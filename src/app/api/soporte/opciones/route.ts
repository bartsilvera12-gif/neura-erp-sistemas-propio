import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import { clientesDeEmpresa, errorInesperado, falla, ok, sinPermiso } from "@/lib/soporte/servidor";

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

    return ok({ clientes: await clientesDeEmpresa(auth.sb, auth.empresaId) });
  } catch (e) {
    return errorInesperado(e);
  }
}
