"use client";

/**
 * Envuelve una pantalla traída del 2.0: le da el usuario (rol, permisos y funciones) que en el
 * 2.0 entrega su layout desde /api/me. En Neura sale de /api/v2/me, armado con los módulos de
 * Neura. También pone el color del tema en `--brand`, que es lo que usan esas pantallas.
 */
import { useEffect, useState, type ReactNode } from "react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { ProveedorUsuario, type Usuario } from "@/erp2/lib/sesion/ContextoUsuario";

let guardado: Usuario | null = null;

export function ProveedorErp2({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Usuario | null>(guardado);
  useEffect(() => {
    let vivo = true;
    apiFetch<Usuario>("/api/me")
      .then((u) => {
        guardado = u;
        if (vivo) setMe(u);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, []);
  return (
    <ProveedorUsuario value={me}>
      <div className="erp2">{children}</div>
    </ProveedorUsuario>
  );
}
