"use client";

/**
 * Árbol de una categoría (se despliega al tocarla en /inventario/categorias): la
 * categoría → cada subcategoría con cuántos productos tiene. Los productos en sí se ven
 * en Inventario; acá solo la estructura. Si hay productos directo en la categoría (sin
 * subcategoría), se muestran como una rama más. `renderSub` dibuja la etiqueta de cada
 * subcategoría (con sus acciones) y `extra` es una rama al final (ej. crear una nueva).
 */
import type { Categoria, tonosDe } from "@/erp2/modules/inventario/categorias";

const nProductos = (n: number) => (n === 1 ? "1 producto" : `${n} productos`);

export function ArbolCategoria({ categoria, hijas, conteo, tono, renderSub, extra }: {
  categoria: Categoria;
  hijas: Categoria[];
  conteo: Record<string, number>;
  tono: ReturnType<typeof tonosDe>;
  renderSub: (sub: Categoria) => React.ReactNode;
  extra?: React.ReactNode;
}) {
  const directos = conteo[categoria.id] ?? 0;
  const ramas: { key: string; etiqueta: React.ReactNode; cantidad?: number }[] = [
    ...hijas.map((h) => ({ key: h.id, etiqueta: renderSub(h), cantidad: conteo[h.id] ?? 0 })),
    ...(directos
      ? [{
          key: "directos",
          etiqueta: (
            <span className="inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-xs font-semibold [overflow-wrap:anywhere] max-sm:min-h-9 max-sm:px-3 max-sm:text-[13px]" style={{ borderColor: tono.borde, color: tono.texto }}>
              Directo en {categoria.nombre}
            </span>
          ),
          cantidad: directos,
        }]
      : []),
    ...(extra ? [{ key: "extra", etiqueta: extra }] : []),
  ];

  if (ramas.length === 0) {
    return <p className="px-4 py-3 text-xs text-slate-400">Esta categoría todavía no tiene subcategorías.</p>;
  }

  return (
    <ul className="space-y-1.5 px-3 py-3 sm:px-4">
      {ramas.map((r, i) => {
        const ultimo = i === ramas.length - 1;
        return (
          <li key={r.key} className="relative flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-6">
            {/* Línea del árbol: baja desde la categoría y dobla hacia cada rama */}
            <span aria-hidden className={`absolute left-1.5 top-0 w-0.5 ${ultimo ? "h-1/2" : "h-[calc(100%+0.375rem)]"}`} style={{ backgroundColor: tono.borde }} />
            <span aria-hidden className="absolute left-1.5 top-1/2 h-0.5 w-3.5" style={{ backgroundColor: tono.borde }} />
            {r.etiqueta}
            {r.cantidad !== undefined ? <span className="shrink-0 text-xs text-slate-500">{nProductos(r.cantidad)}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
