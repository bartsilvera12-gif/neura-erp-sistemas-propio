import { NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { listarReposCacheados, GithubReposError } from "@/lib/github/repos-server";

/**
 * GET /api/github/repos
 * Lista los repositorios de GitHub para el selector de credenciales. Solo lectura
 * y detrás del mismo permiso que Proyectos (quien ve credenciales, ve repos). El
 * filtrado/orden "re contra pro" se hace en el cliente sobre esta lista acotada.
 */
export async function GET(request: Request) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }
  try {
    const repos = await listarReposCacheados();
    return NextResponse.json(successResponse(repos));
  } catch (e) {
    if (e instanceof GithubReposError) {
      return NextResponse.json(errorResponse(e.message), { status: e.status === 401 || e.status === 403 ? 502 : e.status });
    }
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
