/**
 * Modificadores de una línea, bien visibles (receta 73): SIN … en rojo, + EXTRA … en verde y las
 * opciones en negrita. `cocina` = grande y en mayúsculas (pantalla de estación); `chico` = una
 * línea de texto (carrito, cuentas). Sin snapshot muestra el texto guardado (o nada).
 */
import { partesParaMostrar, type ModsSnapshot } from "@/erp2/modules/mesas/modificadores";

export function ModsDetalle({ mods, texto, variante = "chico", className = "" }: {
  mods?: ModsSnapshot | null;
  texto?: string | null;
  variante?: "cocina" | "chico";
  className?: string;
}) {
  const p = partesParaMostrar(mods);
  const hay = p.quitar.length + p.extras.length + p.opciones.length > 0;
  if (!hay) return texto ? <span className={`block text-xs text-slate-500 dark:text-zinc-400 ${className}`}>{texto}</span> : null;
  if (variante === "cocina") {
    return (
      <span className={`mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-base leading-snug ${className}`}>
        {p.opciones.map((o, i) => <span key={`o${i}`} className="font-extrabold text-slate-900 dark:text-zinc-100">{o.opcion}</span>)}
        {p.quitar.map((q, i) => <span key={`q${i}`} className="font-extrabold uppercase text-rose-600 dark:text-rose-400">SIN {q}</span>)}
        {p.extras.map((e, i) => (
          <span key={`e${i}`} className="font-extrabold uppercase text-emerald-700 dark:text-emerald-400">+ {e.nombre}{e.cantidad > 1 ? ` ×${e.cantidad}` : ""}</span>
        ))}
      </span>
    );
  }
  return (
    <span className={`block text-xs leading-snug ${className}`}>
      {[
        ...p.opciones.map((o, i) => <span key={`o${i}`} className="font-semibold text-slate-700 dark:text-zinc-200">{o.opcion}</span>),
        ...p.quitar.map((q, i) => <span key={`q${i}`} className="font-medium text-rose-600 dark:text-rose-400">sin {q.toLowerCase()}</span>),
        ...p.extras.map((e, i) => (
          <span key={`e${i}`} className="font-medium text-emerald-700 dark:text-emerald-400">+ {e.nombre.toLowerCase()}{e.cantidad > 1 ? ` ×${e.cantidad}` : ""}</span>
        )),
      ].flatMap((el, i) => (i ? [<span key={`s${i}`} className="text-slate-300 dark:text-zinc-600"> · </span>, el] : [el]))}
    </span>
  );
}
