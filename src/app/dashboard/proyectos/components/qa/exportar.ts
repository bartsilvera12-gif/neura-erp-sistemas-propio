/**
 * Exportación del listado filtrado de observaciones.
 *
 * El PDF se genera con el diálogo de impresión del navegador ("Guardar como
 * PDF") sobre una ventana propia y autocontenida. Se eligió así porque el repo
 * no tiene un generador HTML→PDF: `pdf-lib` se usa para los XML/documentos de
 * facturación, no para maquetar, y armar esto con esa librería implicaría
 * posicionar cada imagen a mano.
 *
 * Ojo con las capturas: viajan como signed URL de 1 hora. El PDF sale bien
 * mientras el enlace está vigente — el flujo es imprimir y mandar el archivo,
 * no mandar el enlace.
 */

import {
  qaCodigoObservacion,
  qaEstadoLabel,
  qaSeveridadLabel,
} from "@/lib/proyectos/qa-observaciones-config";
import type { QAObservacion, QASeccion } from "./types";

const SIN_SECCION = "Sin sección";

function nombreSeccion(obs: QAObservacion, secciones: Map<string, QASeccion>): string {
  if (!obs.seccion_id) return SIN_SECCION;
  return secciones.get(obs.seccion_id)?.nombre ?? SIN_SECCION;
}

function escapar(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Formato WhatsApp, una línea por observación:
 * `QA-003 · Checkout · Alta — El botón de pagar no muestra loading`
 */
export function textoWhatsApp(
  observaciones: QAObservacion[],
  secciones: Map<string, QASeccion>
): string {
  return observaciones
    .map(
      (o) =>
        `${qaCodigoObservacion(o.numero)} · ${nombreSeccion(o, secciones)} · ${qaSeveridadLabel(
          o.severidad
        )} — ${o.titulo}`
    )
    .join("\n");
}

/** Copia al portapapeles con fallback para contextos sin permiso. */
export async function copiarAlPortapapeles(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // Safari viejo / contexto no seguro: textarea temporal + execCommand.
    try {
      const ta = document.createElement("textarea");
      ta.value = texto;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function filaHtml(obs: QAObservacion, secciones: Map<string, QASeccion>): string {
  const imagenes = obs.archivos.filter((a) => (a.mime_type ?? "").startsWith("image/") && a.url);
  const capturas = imagenes
    .map((a) => `<img src="${escapar(a.url ?? "")}" alt="${escapar(a.nombre)}" />`)
    .join("");

  const meta = [
    nombreSeccion(obs, secciones),
    qaSeveridadLabel(obs.severidad),
    qaEstadoLabel(obs.estado),
    obs.origen === "cliente" ? "Cliente" : null,
    obs.asignado_nombre ? `Asignada a ${obs.asignado_nombre}` : null,
    obs.fecha_limite ? `Límite ${obs.fecha_limite}` : null,
  ]
    .filter(Boolean)
    .map((m) => `<span class="chip">${escapar(String(m))}</span>`)
    .join("");

  return `
    <article class="obs">
      <div class="obs-head">
        <span class="codigo">${qaCodigoObservacion(obs.numero)}</span>
        <h2>${escapar(obs.titulo)}</h2>
      </div>
      <div class="chips">${meta}</div>
      ${obs.descripcion ? `<p class="desc">${escapar(obs.descripcion)}</p>` : ""}
      ${obs.url_referencia ? `<p class="url">${escapar(obs.url_referencia)}</p>` : ""}
      ${capturas ? `<div class="capturas">${capturas}</div>` : ""}
    </article>`;
}

function documentoHtml(
  tituloProyecto: string,
  observaciones: QAObservacion[],
  secciones: Map<string, QASeccion>
): string {
  const fecha = new Date().toLocaleDateString("es-AR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // Se agrupa por sección respetando el orden en que vienen (ya filtradas y
  // ordenadas por el board), para que el PDF refleje lo que se ve en pantalla.
  const grupos = new Map<string, QAObservacion[]>();
  for (const o of observaciones) {
    const k = nombreSeccion(o, secciones);
    const lista = grupos.get(k) ?? [];
    lista.push(o);
    grupos.set(k, lista);
  }

  const cuerpo = [...grupos.entries()]
    .map(
      ([nombre, items]) => `
      <section class="seccion">
        <h3>${escapar(nombre)} <small>${items.length}</small></h3>
        ${items.map((o) => filaHtml(o, secciones)).join("")}
      </section>`
    )
    .join("");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>QA — ${escapar(tituloProyecto)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #0f172a; margin: 0; padding: 24px; font-size: 12px;
  }
  header { border-bottom: 2px solid #4FAEB2; padding-bottom: 10px; margin-bottom: 18px; }
  header h1 { font-size: 18px; margin: 0 0 2px; }
  header p { margin: 0; color: #64748b; font-size: 11px; }
  .seccion { margin-bottom: 18px; }
  .seccion > h3 {
    font-size: 13px; margin: 0 0 8px; padding-bottom: 4px;
    border-bottom: 1px solid #e2e8f0; color: #334155;
  }
  .seccion > h3 small { color: #94a3b8; font-weight: normal; }
  .obs {
    border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; margin-bottom: 8px;
    /* Que una observación no quede partida entre dos páginas. */
    break-inside: avoid; page-break-inside: avoid;
  }
  .obs-head { display: flex; gap: 8px; align-items: baseline; }
  .obs-head h2 { font-size: 13px; margin: 0; font-weight: 600; }
  .codigo {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px;
    background: #f1f5f9; border-radius: 4px; padding: 1px 5px; color: #475569;
  }
  .chips { margin: 5px 0 0; display: flex; flex-wrap: wrap; gap: 4px; }
  .chip {
    font-size: 10px; border: 1px solid #e2e8f0; border-radius: 999px;
    padding: 1px 7px; color: #475569;
  }
  .desc { margin: 6px 0 0; color: #334155; white-space: pre-wrap; }
  .url { margin: 4px 0 0; color: #0369a1; font-size: 11px; word-break: break-all; }
  .capturas { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
  .capturas img {
    max-width: 220px; max-height: 165px; object-fit: contain;
    border: 1px solid #e2e8f0; border-radius: 6px;
  }
  @page { margin: 14mm; }
  @media print {
    body { padding: 0; }
    .obs { border-color: #cbd5e1; }
  }
</style>
</head>
<body>
  <header>
    <h1>Observaciones de QA — ${escapar(tituloProyecto)}</h1>
    <p>${observaciones.length} observaciones · ${escapar(fecha)}</p>
  </header>
  ${cuerpo || "<p>No hay observaciones para los filtros aplicados.</p>"}
</body>
</html>`;
}

/**
 * Abre el listado en una ventana propia y dispara el diálogo de impresión.
 * Devuelve `false` si el navegador bloqueó la ventana emergente.
 */
export function imprimirObservaciones(
  tituloProyecto: string,
  observaciones: QAObservacion[],
  secciones: Map<string, QASeccion>
): boolean {
  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) return false;

  win.document.open();
  win.document.write(documentoHtml(tituloProyecto, observaciones, secciones));
  win.document.close();

  // Hay que esperar a que bajen las capturas: si se imprime antes, salen vacías.
  const disparar = () => {
    win.focus();
    win.print();
  };
  if (win.document.readyState === "complete") {
    window.setTimeout(disparar, 300);
  } else {
    win.addEventListener("load", () => window.setTimeout(disparar, 300));
  }
  return true;
}
