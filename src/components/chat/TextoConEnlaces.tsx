"use client";

import { Fragment } from "react";

/**
 * Direcciones dentro del texto de un mensaje.
 *
 * Cubre `http://`, `https://` y los `www.` pelados, que es como los clientes suelen
 * pegar un enlace. El resto del texto se deja intacto.
 */
const PATRON_URL = /((?:https?:\/\/|www\.)[^\s<>"']+)/gi;

/** Signos que suelen quedar pegados al final al escribir y NO son parte de la dirección. */
function recortarColaDeUrl(url: string): { url: string; sobra: string } {
  let fin = url.length;
  while (fin > 0 && /[.,;:!?]/.test(url[fin - 1])) fin--;
  // Un paréntesis final solo cuenta como parte si hay uno de apertura adentro.
  while (fin > 0 && url[fin - 1] === ")" && !url.slice(0, fin - 1).includes("(")) fin--;
  return { url: url.slice(0, fin), sobra: url.slice(fin) };
}

/**
 * Texto de un mensaje con sus enlaces clicables.
 *
 * Hasta ahora el texto se pintaba crudo: cuando un cliente mandaba una ubicación de
 * Google Maps, el asesor tenía que seleccionar el enlace a mano y copiarlo al navegador.
 * Se abre en pestaña nueva para no perder el inbox.
 */
export default function TextoConEnlaces({
  texto,
  claseEnlace,
}: {
  texto: string;
  /** Para que el enlace se lea tanto en la burbuja propia (fondo oscuro) como en la ajena. */
  claseEnlace?: string;
}) {
  const partes = texto.split(PATRON_URL);
  return (
    <>
      {partes.map((parte, i) => {
        if (!PATRON_URL.test(parte)) {
          PATRON_URL.lastIndex = 0;
          return <Fragment key={i}>{parte}</Fragment>;
        }
        PATRON_URL.lastIndex = 0;
        const { url, sobra } = recortarColaDeUrl(parte);
        if (!url) return <Fragment key={i}>{parte}</Fragment>;
        const href = url.startsWith("www.") ? `https://${url}` : url;
        return (
          <Fragment key={i}>
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => e.stopPropagation()}
              className={claseEnlace ?? "underline underline-offset-2 hover:opacity-80"}
            >
              {url}
            </a>
            {sobra}
          </Fragment>
        );
      })}
    </>
  );
}
