"use client";

import { apiForm } from "@/erp2/lib/api/client-fetch";

/**
 * Sube una imagen de producto y devuelve su URL pública. La sube el servidor
 * (/api/productos/imagen) al bucket "erp-productos": desde el navegador nadie escribe en storage.
 */
export async function subirImagenProducto(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("El archivo debe ser una imagen.");
  if (file.size > 5 * 1024 * 1024) throw new Error("La imagen no puede superar 5 MB.");
  const form = new FormData();
  form.append("file", file);
  const { url } = await apiForm<{ url: string }>("/api/productos/imagen", form);
  return url;
}
