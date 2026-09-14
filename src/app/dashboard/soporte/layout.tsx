import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { requireSoporteServidor } from "@/lib/soporte/soporte-auth";

/**
 * Puerta del módulo Soporte, en el servidor.
 *
 * Envuelve TODAS las rutas de /dashboard/soporte, así que cubre la URL escrita a
 * mano y el refresh directo de cualquier subpágina. El menú lateral sólo decide
 * si se ve el ítem; esto decide si se entra. Y cada API vuelve a comprobarlo:
 * una pantalla que se saltea el layout igual no puede leer ni escribir nada.
 */
export const dynamic = "force-dynamic";

export default async function SoporteLayout({ children }: { children: React.ReactNode }) {
  const acceso = await requireSoporteServidor();

  if (!acceso.ok) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-20 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-500">
          <ShieldAlert className="h-6 w-6" aria-hidden />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-slate-900">Acceso denegado</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          {acceso.status === 401
            ? "Tu sesión expiró. Volvé a iniciar sesión."
            : "El módulo Soporte está disponible sólo para administradores."}
        </p>
        <Link
          href="/"
          className="mt-5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 no-underline hover:bg-slate-50"
        >
          Volver al inicio
        </Link>
      </div>
    );
  }

  return <div className="min-h-full bg-slate-50/60">{children}</div>;
}
