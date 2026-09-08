"use client";

/**
 * El contador de mensajes sin leer del chat interno, en la pestaña del
 * navegador: en el título y dibujado sobre el favicon.
 *
 * Vive acá y no dentro del chat porque su razón de ser es avisar cuando NO se
 * está mirando el chat. Un contador que sólo existe en la pantalla del chat no
 * le sirve a nadie.
 *
 * No renderiza nada: toca `document.title` y el `<link rel="icon">`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { supabase } from "@/lib/supabase";

/**
 * Red de seguridad por si el realtime se cayó sin avisar. Lo normal es que el
 * número llegue por ahí, no por acá.
 *
 * Sólo corre con la pestaña a la vista: una pestaña de fondo no le muestra el
 * contador a nadie, y una persona con el ERP abierto todo el día en segundo
 * plano estaría pidiendo mil veces un número que nadie mira.
 */
const REFRESCO_MS = 60_000;

/** El chat avisa por acá cuando alguien lee una sala, para bajar el número ya. */
export const EVENTO_CHAT_LEIDO = "chat-interno:leido";

const TITULO_BASE = "Neura ERP";

/** Dibuja el globito rojo con el número sobre el ícono original. */
function pintarFavicon(base: HTMLImageElement, n: number): string | null {
  const lado = 64;
  const canvas = document.createElement("canvas");
  canvas.width = lado;
  canvas.height = lado;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(base, 0, 0, lado, lado);
  if (n <= 0) return canvas.toDataURL("image/png");

  const texto = n > 99 ? "99+" : String(n);
  // El globito crece con el texto, pero nunca tapa el ícono entero.
  const ancho = texto.length > 2 ? 40 : texto.length > 1 ? 34 : 28;
  const alto = 28;
  const x = lado - ancho;
  const y = lado - alto;
  const r = alto / 2;

  ctx.fillStyle = "#E11D48";
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + ancho - r, y);
  ctx.quadraticCurveTo(x + ancho, y, x + ancho, y + r);
  ctx.lineTo(x + ancho, y + alto - r);
  ctx.quadraticCurveTo(x + ancho, y + alto, x + ancho - r, y + alto);
  ctx.lineTo(x + r, y + alto);
  ctx.quadraticCurveTo(x, y + alto, x, y + alto - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${texto.length > 2 ? 17 : 20}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(texto, x + ancho / 2, y + alto / 2 + 1);

  return canvas.toDataURL("image/png");
}

export default function ChatPestanaBadge() {
  const [total, setTotal] = useState(0);
  /** El ícono original, para volver a él cuando no hay nada pendiente. */
  const baseRef = useRef<HTMLImageElement | null>(null);
  const hrefOriginalRef = useRef<string | null>(null);
  /** Sin acceso al módulo se deja de preguntar, y se corta el realtime. */
  const [habilitado, setHabilitado] = useState(true);
  const habilitadoRef = useRef(true);
  /** Mis salas, para no recontar por un mensaje de una conversación ajena. */
  const misSalasRef = useRef<Set<string> | null>(null);

  const contar = useCallback(async () => {
    if (!habilitadoRef.current) return;
    try {
      const r = await fetchWithSupabaseSession("/api/chat-interno/no-leidos", {
        cache: "no-store",
      });
      // 403 = sin acceso al módulo. No es un error a mostrar: simplemente esta
      // persona no tiene chat, y preguntar de nuevo sería ruido en cada página.
      if (r.status === 403 || r.status === 401) {
        habilitadoRef.current = false;
        setHabilitado(false);
        setTotal(0);
        return;
      }
      const j = (await r.json().catch(() => ({}))) as {
        data?: { total?: number; mis_salas?: string[] };
      };
      setTotal(Math.max(0, Number(j?.data?.total ?? 0)));
      if (Array.isArray(j?.data?.mis_salas)) {
        misSalasRef.current = new Set(j.data.mis_salas);
      }
    } catch {
      // Sin red no se toca el número: dejarlo en cero mentiría.
    }
  }, []);

  useEffect(() => {
    // El primer conteo va acá a propósito: el número de la pestaña sólo se
    // puede saber preguntando, y hay que preguntar al montar.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void contar();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void contar();
    }, REFRESCO_MS);
    const alVolver = () => {
      if (document.visibilityState === "visible") void contar();
    };
    document.addEventListener("visibilitychange", alVolver);
    // El chat lo dispara al marcar una sala como leída, para que el número baje
    // en el momento y no en el próximo refresco.
    window.addEventListener(EVENTO_CHAT_LEIDO, contar);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener(EVENTO_CHAT_LEIDO, contar);
    };
  }, [contar]);

  // Un mensaje nuevo en cualquier sala vuelve a contar. El filtro por sala no
  // se puede hacer acá —son varias—, así que se escucha la tabla y se recuenta.
  useEffect(() => {
    if (!habilitado) return;
    const canal = supabase
      .channel("chat-interno-pestana")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "neura", table: "chat_interno_mensajes" },
        (payload) => {
          // El aviso llega por cada mensaje de la empresa, no sólo de los míos.
          // Sin este filtro, cada mensaje ajeno dispararía un recuento por cada
          // persona conectada. Una sala nueva se descubre en el refresco.
          const sala = (payload.new as { sala_id?: string } | null)?.sala_id;
          const mias = misSalasRef.current;
          if (sala && mias && !mias.has(sala)) return;
          void contar();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [contar, habilitado]);

  // --- El título de la pestaña ---------------------------------------------
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\)\s*/, "") || TITULO_BASE;
    document.title = total > 0 ? `(${total > 99 ? "99+" : total}) ${base}` : base;
  }, [total]);

  // --- El favicon -----------------------------------------------------------
  useEffect(() => {
    const link =
      (document.querySelector("link[rel~='icon']") as HTMLLinkElement | null) ??
      (() => {
        const l = document.createElement("link");
        l.rel = "icon";
        document.head.appendChild(l);
        return l;
      })();

    if (hrefOriginalRef.current === null) {
      hrefOriginalRef.current = link.getAttribute("href") || "/icon.png";
    }

    const aplicar = (img: HTMLImageElement) => {
      const url = pintarFavicon(img, total);
      if (url) link.setAttribute("href", url);
    };

    if (baseRef.current) {
      aplicar(baseRef.current);
      return;
    }
    const img = new Image();
    // El ícono es del mismo origen, así que el canvas no queda contaminado.
    img.crossOrigin = "anonymous";
    img.onload = () => {
      baseRef.current = img;
      aplicar(img);
    };
    // Si no carga, el título ya lleva el número: el favicon es el extra.
    img.src = hrefOriginalRef.current;
  }, [total]);

  return null;
}
