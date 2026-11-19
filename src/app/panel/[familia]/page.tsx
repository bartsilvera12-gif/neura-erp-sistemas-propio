"use client";

/**
 * Portada de una familia del menú (Comercial, Finanzas, Soporte…): una tarjeta
 * con foto por cada pantalla que ESTA sesión puede abrir. La lista sale del
 * menú lateral (`useMenuVisible`), así tarjetas y menú nunca se desfasan.
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { GRILLA_PORTADA, TarjetaPortada } from "@/components/ui/TarjetaPortada";
import { useMenuVisible } from "@/lib/menu/menu-visible-store";
import { BAJADA_FAMILIA, portadaDe } from "@/lib/menu/portadas";

export default function PortadaFamiliaPage() {
  const params = useParams();
  const raw = params?.familia;
  const id = typeof raw === "string" ? raw : Array.isArray(raw) ? (raw[0] ?? "") : "";
  const { cargando, familias } = useMenuVisible();
  const familia = familias.find((f) => f.id === id);
  const textos = BAJADA_FAMILIA[id];

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 sm:py-6">
      <header className="mb-5">
        <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#4FAEB2] ring-4 ring-[#4FAEB2]/15" />
          {textos?.kicker ?? familia?.title ?? "Menú"}
        </p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900">
          {familia?.title ?? textos?.kicker ?? "Menú"}
        </h1>
        {textos?.bajada ? <p className="mt-1 text-sm text-slate-500">{textos.bajada}</p> : null}
      </header>

      {cargando ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-[150px] animate-pulse rounded-2xl bg-slate-200/70" />
          ))}
        </div>
      ) : !familia || familia.pantallas.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center">
          <p className="text-sm font-semibold text-slate-800">No tenés pantallas habilitadas en esta sección.</p>
          <Link href="/" className="mt-3 inline-block text-sm font-semibold text-[#3F8E91] hover:underline">
            Volver al inicio
          </Link>
        </div>
      ) : (
        <>
          {/* Celular: lista compacta, entran todas de un vistazo. */}
          <ul className="m-0 list-none divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 shadow-sm sm:hidden">
            {familia.pantallas.map((p) => {
              const foto = portadaDe(p.href);
              return (
                <li key={p.href}>
                  <Link href={p.href} className="flex min-h-[64px] items-center gap-3 px-4 py-2.5 active:bg-slate-50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={foto.imagen} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
                    <span className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-slate-900">{p.label}</span>
                    <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-slate-300" />
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className={`hidden sm:grid ${GRILLA_PORTADA}`}>
            {familia.pantallas.map((p, i) => {
              const foto = portadaDe(p.href);
              return (
                <TarjetaPortada
                  key={p.href}
                  href={p.href}
                  titulo={p.label}
                  imagen={foto.imagen}
                  color={foto.color}
                  posicion={foto.posicion}
                  prioridad={i < 3}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
