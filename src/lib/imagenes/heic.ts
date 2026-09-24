"use client";

/**
 * Fotos de iPhone (HEIC/HEIF) para la web.
 *
 * El iPhone saca las fotos en HEIC y Chrome, Firefox y Edge NO saben mostrarlo: la imagen
 * quedaba "rota" en la vista previa y en el comentario publicado. Tampoco alcanza con
 * convertir en el servidor: `sharp` viene sin el decodificador de HEIC y el ffmpeg del
 * contenedor es demasiado viejo para esos archivos.
 *
 * Por eso se convierte en el navegador, antes de subir. El convertidor pesa cerca de 1 MB y
 * se carga SOLO cuando aparece un HEIC: quien sube un JPG no descarga nada extra.
 */

const ES_HEIC = /\.(heic|heif)$/i;

function esHeic(f: File): boolean {
  const t = (f.type || "").toLowerCase();
  return t.includes("heic") || t.includes("heif") || ES_HEIC.test(f.name);
}

/** ¿Es una imagen? Un HEIC a veces llega con `type` vacío y hay que mirarle el nombre. */
export function esImagenElegida(f: File): boolean {
  return (f.type || "").startsWith("image/") || esHeic(f);
}

/**
 * Deja la lista lista para subir: los HEIC salen como JPG y el resto pasa igual.
 * Lo que no se pueda convertir se descarta y su nombre vuelve en `fallaron`.
 */
export async function normalizarImagenes(
  archivos: File[]
): Promise<{ listos: File[]; fallaron: string[] }> {
  const listos: File[] = [];
  const fallaron: string[] = [];
  let convertir: typeof import("heic2any").default | null = null;

  for (const f of archivos) {
    if (!esHeic(f)) {
      listos.push(f);
      continue;
    }
    try {
      convertir ??= (await import("heic2any")).default;
      const salida = await convertir({ blob: f, toType: "image/jpeg", quality: 0.85 });
      const blob = Array.isArray(salida) ? salida[0] : salida;
      listos.push(
        new File([blob], f.name.replace(ES_HEIC, "") + ".jpg", {
          type: "image/jpeg",
          lastModified: f.lastModified,
        })
      );
    } catch {
      fallaron.push(f.name);
    }
  }
  return { listos, fallaron };
}
