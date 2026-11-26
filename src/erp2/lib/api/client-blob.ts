/**
 * Descargas del front que necesitan el Bearer (una navegación común no lo lleva):
 * se pide con fetch y se baja como blob.
 */
import { rutaV2 } from "@/erp2/lib/api/client-fetch";
import { browserClient } from "@/erp2/lib/supabase/browser";

async function pedir(path: string): Promise<Response> {
  const { data } = await browserClient().auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(rutaV2(path), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`Error ${res.status}`);
  return res;
}

/** Descarga un archivo (Excel, etc.) con el nombre que manda el servidor. */
export async function descargarArchivo(path: string, nombrePorDefecto: string) {
  const res = await pedir(path);
  const cd = res.headers.get("content-disposition") ?? "";
  const nombre = /filename="?([^";]+)"?/.exec(cd)?.[1] ?? nombrePorDefecto;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

/**
 * Abre un PDF en una pestaña nueva (para imprimirlo desde el visor del navegador).
 * La pestaña se abre ANTES del fetch (si no, el bloqueador de ventanas la frena);
 * si igual no se pudo abrir, lo descarga.
 */
export async function abrirArchivo(path: string, nombrePorDefecto: string) {
  const w = window.open("", "_blank");
  try {
    const res = await pedir(path);
    const url = URL.createObjectURL(await res.blob());
    if (w) w.location.href = url;
    else await descargarArchivo(path, nombrePorDefecto);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    w?.close();
    throw e;
  }
}

/**
 * Imprime un PDF: en la compu abre directo el diálogo de impresión (iframe oculto con el PDF);
 * en celular/tablet (no imprimen desde un iframe) lo abre en otra pestaña para imprimir o compartir.
 */
export async function imprimirArchivo(path: string, nombrePorDefecto: string) {
  if (window.matchMedia("(pointer: coarse)").matches) return abrirArchivo(path, nombrePorDefecto);
  const res = await pedir(path);
  const url = URL.createObjectURL(await res.blob());
  document.querySelectorAll("iframe[data-imprimir]").forEach((f) => f.remove());
  const f = document.createElement("iframe");
  f.dataset.imprimir = "";
  f.setAttribute("aria-hidden", "true");
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  f.src = url;
  await new Promise<void>((ok) => {
    f.onload = () => {
      // El visor de PDF termina de armarse un instante después del load.
      setTimeout(() => {
        try {
          f.contentWindow?.focus();
          f.contentWindow?.print();
        } catch {
          window.open(url, "_blank");
        }
        ok();
      }, 300);
    };
    document.body.appendChild(f);
  });
  // No se saca enseguida: algunos navegadores cancelan la impresión si desaparece el iframe.
  setTimeout(() => { f.remove(); URL.revokeObjectURL(url); }, 120000);
}
