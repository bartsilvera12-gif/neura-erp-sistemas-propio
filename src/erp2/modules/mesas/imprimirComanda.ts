"use client";

/**
 * Impresión de la comanda de una estación (receta 70) con el TICKET DE COMANDA configurado en
 * Configuración › Tickets y facturación (receta 71): ancho 58/80 mm, letra, cliente / notas /
 * precios, copias y pie. El HTML lo arma htmlComanda (src/modules/facturacion/tickets.ts) con la
 * config de GET /api/mesas/comanda-config (se pide una vez por pantalla y se reusa).
 *
 * Se imprime desde un IFRAME OCULTO (no abre pestañas) con window.print(). Las impresiones van en
 * fila: una termina (afterprint o, si el navegador no lo avisa, a los pocos segundos) y sigue la otra.
 *
 * IMPRESIÓN SILENCIOSA (sin el cuadro de diálogo): abrir el navegador de la estación en modo kiosco
 * con la impresora térmica como predeterminada, por ejemplo
 *   chrome.exe --kiosk --kiosk-printing https://<sistema>/caja/cocina?estacion=<id>
 * (Edge acepta los mismos parámetros). Sin --kiosk-printing el navegador muestra el diálogo de
 * impresión cada vez: es una decisión del navegador, no del sistema.
 */
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { comandaEfectiva, htmlComanda, type ConfigComanda, type ModsComanda } from "@/erp2/modules/facturacion/tickets";
import { itemsDeComanda, type Comanda, type ItemPedido, type PedidoMesa } from "@/erp2/modules/mesas/tipos";
import { partesParaMostrar } from "@/erp2/modules/mesas/modificadores";

let config: Promise<ConfigComanda> | null = null;
/** Config del ticket de comanda (con los defaults si no hay nada guardado o falla la consulta). */
function configComanda(): Promise<ConfigComanda> {
  config ??= apiFetch<{ ticket_comanda?: Partial<ConfigComanda> | null }>("/api/mesas/comanda-config")
    .then((r) => comandaEfectiva(r.ticket_comanda))
    .catch(() => { config = null; return comandaEfectiva(null); });
  return config;
}

const fechaCorta = (iso: string) =>
  new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(iso)).replace(",", "");

/** Receta 73: modificadores de la línea para la comanda (opciones, SIN …, + EXTRA …). */
function modsComanda(i: ItemPedido): ModsComanda | null {
  const p = partesParaMostrar(i.modificadores);
  if (!p.quitar.length && !p.extras.length && !p.opciones.length) return null;
  return {
    opciones: p.opciones.map((o) => o.opcion),
    quitar: p.quitar,
    extras: p.extras.map((e) => `${e.nombre}${e.cantidad > 1 ? ` ×${e.cantidad}` : ""}`),
  };
}

/** HTML de la comanda de una estación: mesa grande, pedido · estación, hora, ítems con sus notas. */
export function htmlComandaMesa(cfg: ConfigComanda, p: PedidoMesa, k: Comanda): string {
  const otras = (p.comandas ?? []).filter((x) => x.id !== k.id).map((x) => x.estacion_nombre);
  const notas = [p.nota, otras.length ? `También lleva: ${otras.join(", ")}` : null].filter(Boolean).join("\n");
  const items = itemsDeComanda(p, k);
  return htmlComanda(cfg, {
    titulo: [p.mesa.nombre, p.mesa.zona].filter(Boolean).join(" · "),
    referencia: `Pedido #${p.numero}`,
    fecha: fechaCorta(p.aceptado_at ?? p.creado_at),
    estacion: k.estacion_nombre,
    cliente: p.nombre_cliente,
    items: items.map((i) => ({ nombre: i.nombre, cantidad: Number(i.cantidad), notas: i.nota, precio: i.precio_unitario, total: i.total, mods: modsComanda(i) })),
    notas: notas || null,
    total: items.reduce((a, i) => a + Number(i.total || 0), 0),
  }, { acciones: false });
}

let fila: Promise<void> = Promise.resolve();

/** Encola la impresión de un HTML en un iframe oculto. Resuelve cuando terminó (o se canceló). */
export function imprimirHtml(html: string): Promise<void> {
  const tarea = fila.then(() => new Promise<void>((resolver) => {
    const f = document.createElement("iframe");
    f.setAttribute("aria-hidden", "true");
    f.tabIndex = -1;
    Object.assign(f.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0", visibility: "hidden" });
    let listo = false;
    const fin = () => {
      if (listo) return;
      listo = true;
      setTimeout(() => { f.remove(); resolver(); }, 300);
    };
    f.onload = () => {
      const w = f.contentWindow;
      if (!w) { fin(); return; }
      w.addEventListener("afterprint", fin);
      // Si el navegador no avisa afterprint (o el diálogo queda abierto), seguimos igual.
      setTimeout(fin, 8000);
      try { w.focus(); w.print(); } catch { fin(); }
    };
    f.srcdoc = html;
    document.body.appendChild(f);
  }));
  fila = tarea.catch(() => {});
  return tarea;
}

export async function imprimirComanda(p: PedidoMesa, k: Comanda): Promise<void> {
  const cfg = await configComanda();
  await imprimirHtml(htmlComandaMesa(cfg, p, k));
}
