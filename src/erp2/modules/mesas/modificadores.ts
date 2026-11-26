/**
 * Modificadores de los platos (receta 73): quitar ingredientes, extras con precio y opciones a
 * elegir. Tipos y cálculos compartidos por el menú QR, la caja, la cocina y los tickets.
 *
 * El SERVIDOR valida y pone los precios (plato_mods_resolver): lo de acá es la vista previa y
 * tiene que dar lo mismo. Texto: "sin cebolla · + extra queso ×2 · a punto" (mismo orden que la
 * base: quitados en el orden de la receta, extras por nombre, opciones por grupo).
 */

/** Lo que se puede elegir en un plato (viene en el menú QR y en el catálogo de la caja). */
export type ModsCatalogo = {
  quitar: { producto_id: string; nombre: string }[];
  /** `disponible` = unidades que alcanzan con el stock para UN plato (ya topeado por `maximo`). */
  extras: { extra_id: string; nombre: string; precio: number; maximo: number; disponible: number }[];
  grupos: {
    id: string;
    nombre: string;
    obligatorio: boolean;
    minimo: number;
    maximo: number;
    /** Receta 74: `disponible` false = sus ingredientes no alcanzan ("Sin stock", deshabilitada). */
    opciones: { id: string; nombre: string; precio: number; disponible?: boolean }[];
  }[];
};

/** Lo elegido (lo que se manda al servidor como `mods`). */
export type ModsSeleccion = { quitar: string[]; extras: { extra_id: string; cantidad: number }[]; opciones: string[] };

/** Snapshot guardado en la línea (mesa_pedido_items / ventas_items). */
export type ModsSnapshot = {
  quitar: { producto_id: string; nombre: string }[];
  extras: { extra_id: string; nombre: string; cantidad: number; precio: number }[];
  opciones: { grupo_id: string; grupo: string; opcion_id: string; opcion: string; precio: number }[];
};

export const selVacia = (): ModsSeleccion => ({ quitar: [], extras: [], opciones: [] });

export const esVacia = (s: ModsSeleccion | null | undefined) =>
  !s || (s.quitar.length === 0 && s.extras.every((e) => e.cantidad <= 0) && s.opciones.length === 0);

/** Clave canónica de una combinación ('' = sin modificadores): misma combinación = misma línea. */
export function claveMods(s: ModsSeleccion | null | undefined): string {
  if (esVacia(s)) return "";
  const q = [...s!.quitar].sort().join(",");
  const e = s!.extras.filter((x) => x.cantidad > 0).map((x) => `${x.extra_id}*${x.cantidad}`).sort().join(",");
  const o = [...s!.opciones].sort().join(",");
  return `q:${q}|e:${e}|o:${o}`;
}

/** Selección a partir del snapshot de una línea guardada (cuenta de mesa → caja). */
export function selDeSnapshot(m: ModsSnapshot | null | undefined): ModsSeleccion {
  if (!m) return selVacia();
  return {
    quitar: (m.quitar ?? []).map((q) => q.producto_id),
    extras: (m.extras ?? []).map((e) => ({ extra_id: e.extra_id, cantidad: Number(e.cantidad) || 1 })),
    opciones: (m.opciones ?? []).map((o) => o.opcion_id),
  };
}

/** Para mandar al servidor: undefined si no hay nada elegido. */
export function modsParaEnviar(s: ModsSeleccion | null | undefined): ModsSeleccion | undefined {
  if (esVacia(s)) return undefined;
  return { quitar: s!.quitar, extras: s!.extras.filter((e) => e.cantidad > 0), opciones: s!.opciones };
}

/** Precio por unidad de los modificadores (extras × cantidad + opciones). */
export function precioMods(cat: ModsCatalogo | null | undefined, s: ModsSeleccion | null | undefined): number {
  if (!cat || esVacia(s)) return 0;
  let t = 0;
  for (const e of s!.extras) t += (cat.extras.find((x) => x.extra_id === e.extra_id)?.precio ?? 0) * e.cantidad;
  for (const g of cat.grupos) for (const o of g.opciones) if (s!.opciones.includes(o.id)) t += Number(o.precio) || 0;
  return t;
}

const porNombre = (a: string, b: string) => a.localeCompare(b, "es");

/** Partes legibles de una selección (para el resumen y la cocina). */
export function partesSel(cat: ModsCatalogo, s: ModsSeleccion): ModsSnapshot {
  return {
    quitar: cat.quitar.filter((q) => s.quitar.includes(q.producto_id)),
    extras: s.extras
      .filter((e) => e.cantidad > 0)
      .map((e) => {
        const x = cat.extras.find((y) => y.extra_id === e.extra_id);
        return { extra_id: e.extra_id, nombre: x?.nombre ?? "Extra", cantidad: e.cantidad, precio: x?.precio ?? 0 };
      })
      .sort((a, b) => porNombre(a.nombre, b.nombre)),
    opciones: cat.grupos.flatMap((g) =>
      g.opciones.filter((o) => s.opciones.includes(o.id)).map((o) => ({ grupo_id: g.id, grupo: g.nombre, opcion_id: o.id, opcion: o.nombre, precio: o.precio })),
    ),
  };
}

/** "sin cebolla · + extra queso ×2 · a punto" (igual que modificadores_texto de la base). */
export function textoSnapshot(m: ModsSnapshot | null | undefined): string {
  if (!m) return "";
  return [
    ...(m.quitar ?? []).map((q) => `sin ${q.nombre.toLowerCase()}`),
    ...(m.extras ?? []).map((e) => `+ ${e.nombre.toLowerCase()}${Number(e.cantidad) > 1 ? ` ×${e.cantidad}` : ""}`),
    ...(m.opciones ?? []).map((o) => o.opcion.toLowerCase()),
  ].join(" · ");
}

/** Para el ticket / detalle de venta: los extras y opciones con precio llevan su importe por plato. */
export function textoConPrecios(m: ModsSnapshot | null | undefined): string {
  if (!m) return "";
  const g = (n: number) => `Gs. ${Math.round(n).toLocaleString("es-PY")}`;
  return [
    ...(m.quitar ?? []).map((q) => `sin ${q.nombre.toLowerCase()}`),
    ...(m.extras ?? []).map((e) => {
      const c = Number(e.cantidad) || 1;
      return `+ ${e.nombre.toLowerCase()}${c > 1 ? ` ×${c}` : ""}${Number(e.precio) > 0 ? ` (${g(Number(e.precio) * c)})` : ""}`;
    }),
    ...(m.opciones ?? []).map((o) => `${o.opcion.toLowerCase()}${Number(o.precio) > 0 ? ` (+ ${g(Number(o.precio))})` : ""}`),
  ].join(" · ");
}

export const textoSel =(cat: ModsCatalogo | null | undefined, s: ModsSeleccion | null | undefined) =>
  cat && s && !esVacia(s) ? textoSnapshot(partesSel(cat, s)) : "";

/** Primer grupo obligatorio que falta elegir (o que pasa el máximo): mensaje para el usuario. */
export function problemaSel(cat: ModsCatalogo, s: ModsSeleccion): { grupo: string; mensaje: string } | null {
  for (const g of cat.grupos) {
    const n = g.opciones.filter((o) => s.opciones.includes(o.id)).length;
    const min = g.obligatorio ? Math.max(1, g.minimo) : 0;
    if (n < min) return { grupo: g.id, mensaje: min > 1 ? `Elegí al menos ${min} en «${g.nombre}»` : `Elegí «${g.nombre}»` };
    if (n > g.maximo) return { grupo: g.id, mensaje: `En «${g.nombre}» se elige hasta ${g.maximo}` };
  }
  return null;
}

/** ¿El catálogo tiene algo para elegir? (si no, el plato se agrega directo). */
export const tieneMods = (cat: ModsCatalogo | null | undefined): cat is ModsCatalogo =>
  !!cat && (cat.quitar.length > 0 || cat.extras.length > 0 || cat.grupos.some((g) => g.opciones.length > 0));

/** Partes de un snapshot para pintar (cocina, comanda, tickets): con el texto en el caso original. */
export function partesParaMostrar(m: ModsSnapshot | null | undefined) {
  return {
    quitar: (m?.quitar ?? []).map((q) => q.nombre),
    extras: (m?.extras ?? []).map((e) => ({ nombre: e.nombre, cantidad: Number(e.cantidad) || 1, precio: Number(e.precio) || 0 })),
    opciones: (m?.opciones ?? []).map((o) => ({ grupo: o.grupo, opcion: o.opcion, precio: Number(o.precio) || 0 })),
  };
}
