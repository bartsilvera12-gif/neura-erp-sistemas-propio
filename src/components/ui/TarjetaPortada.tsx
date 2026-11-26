"use client";

/**
 * Tarjeta con foto de las portadas (menú y Reportes): foto + degradé del color
 * de la tarjeta + título + flecha. Mismo diseño que las tarjetas del ERP 2.0.
 */
import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import { ArrowRight, Star } from "lucide-react";

const VELO =
  "linear-gradient(to top, hsl(var(--tema) / 0.93), hsl(var(--tema) / 0.78) 55px, hsl(var(--tema) / 0.45) 105px, hsl(var(--tema) / 0.15) 145px, transparent 175px), linear-gradient(to top, rgb(0 0 0 / 0.24), transparent 130px)";

/** Grilla de tarjetas: la misma en todas las portadas. */
export const GRILLA_PORTADA = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4";

export function TarjetaPortada({
  href,
  titulo,
  imagen,
  color,
  posicion,
  detalle,
  prioridad = false,
  favorito,
  onFavorito,
}: {
  href: string;
  titulo: string;
  imagen: string;
  /** HSL sin envolver ("182 39% 28%"), oscuro para que el título blanco se lea. */
  color: string;
  /** Encuadre de la foto (object-position). */
  posicion?: string;
  /** Explicación larga: sale al pasar el cursor. */
  detalle?: string;
  prioridad?: boolean;
  /** Con `onFavorito` la tarjeta muestra la estrella para marcarla como favorita. */
  favorito?: boolean;
  onFavorito?: () => void;
}) {
  return (
    <div className="group relative h-[150px]" style={{ "--tema": color } as CSSProperties}>
      <Link
        href={href}
        title={detalle}
        className="relative flex h-full flex-col overflow-hidden rounded-2xl bg-[hsl(var(--tema))] shadow-[0_8px_24px_-12px_hsl(var(--tema)/0.55)] outline-none transition-[transform,box-shadow] duration-500 ease-out hover:shadow-[0_14px_32px_-12px_hsl(var(--tema)/0.6)] focus-visible:ring-4 focus-visible:ring-[hsl(var(--tema)/0.55)] focus-visible:ring-offset-2 md:group-hover:scale-[1.02] motion-reduce:transition-shadow motion-reduce:md:group-hover:scale-100"
      >
        <Image
          src={imagen}
          alt=""
          fill
          priority={prioridad}
          sizes="(min-width: 1024px) 33vw, 50vw"
          className="object-cover transition-transform duration-500 ease-out group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          style={posicion ? { objectPosition: posicion } : undefined}
        />
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: VELO }} />
        <div className="relative mt-auto flex items-end gap-3 p-4 text-white">
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight [text-shadow:0_1px_10px_rgb(0_0_0/0.35)]">
            {titulo}
          </h2>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/15 backdrop-blur-md transition-colors duration-300 group-hover:bg-white/30">
            <span className="sr-only">Entrar</span>
            <ArrowRight aria-hidden className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
          </span>
        </div>
      </Link>
      {onFavorito ? (
        <button
          type="button"
          onClick={onFavorito}
          aria-pressed={Boolean(favorito)}
          aria-label={favorito ? `Quitar ${titulo} de favoritos` : `Agregar ${titulo} a favoritos`}
          title={favorito ? "Quitar de favoritos" : "Agregar a favoritos"}
          className={`absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border backdrop-blur-md outline-none transition-all duration-200 hover:scale-110 focus-visible:ring-2 focus-visible:ring-white ${
            favorito
              ? "border-[rgb(var(--estrella-rgb)/0.6)] bg-black/35 text-[rgb(var(--estrella-rgb))]"
              : "border-white/25 bg-black/20 text-white/80 hover:bg-black/40 hover:text-[rgb(var(--estrella-rgb))]"
          }`}
        >
          <Star aria-hidden className={`h-4 w-4 ${favorito ? "fill-current" : ""}`} />
        </button>
      ) : null}
    </div>
  );
}
