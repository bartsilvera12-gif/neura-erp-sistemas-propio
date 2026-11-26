"use client";

/**
 * Configuración → Apariencia: el color del sistema para quien lo elige (se guarda en su
 * navegador; los demás no lo ven). De la lista, o uno propio con la paleta, en hex o en RGB.
 */
import { useEffect, useState } from "react";
import { BookmarkPlus, Check, RotateCcw, Star, X } from "lucide-react";
import { ConfigFormCard, ConfigHelpText, ConfigSectionTitle, F_INPUT, F_LABEL } from "@/components/config/global-config-primitives";
import { GlobalConfigSubpageShell } from "@/components/config/GlobalConfigSubpageShell";
import { ESTRELLAS, ESTRELLA_POR_DEFECTO, LETRAS, LETRA_POR_DEFECTO, TEMAS, TEMA_POR_DEFECTO, borrarColor, elegirEstrella, elegirLetras, elegirTema, guardarColor, hexARgb, luminancia, normalizarColor } from "@/lib/tema-color";
import { useColoresGuardados, useEstrella, useLetras, useTema } from "@/lib/useTema";

export default function ConfiguracionAparienciaPage() {
  const tema = useTema();
  const letras = useLetras();
  const guardados = useColoresGuardados();
  const estrella = useEstrella();
  const estrellaHex = estrella === ESTRELLA_POR_DEFECTO ? ESTRELLAS[0].muestra : estrella;
  const esPropio = tema.startsWith("#");
  const yaGuardado = esPropio && guardados.includes(tema.toLowerCase());
  const actual = esPropio ? tema : (TEMAS.find((t) => t.id === tema)?.muestra ?? TEMAS[0].muestra).toLowerCase();
  const [hex, setHex] = useState(actual);
  const [rgb, setRgb] = useState(hexARgb(actual).join(", "));

  // Los campos siguen a lo elegido (también cuando se elige de la lista o se vuelve al original).
  useEffect(() => {
    setHex(actual);
    setRgb(hexARgb(actual).join(", "));
  }, [actual]);

  /** Color propio: se aplica tal cual. De paso se propone la letra que se lee (se puede cambiar abajo). */
  const aplicarPropio = (c: string) => {
    elegirTema(c);
    elegirLetras(luminancia(c) > 0.45 ? "negro" : "blanco");
  };
  const aplicarTexto = (texto: string) => {
    const c = normalizarColor(texto);
    if (c) aplicarPropio(c);
    return Boolean(c);
  };
  const original = tema === TEMA_POR_DEFECTO && letras === LETRA_POR_DEFECTO && estrella === ESTRELLA_POR_DEFECTO;
  const hexValido = normalizarColor(hex) !== null;
  const rgbValido = normalizarColor(rgb) !== null;

  return (
    <GlobalConfigSubpageShell title="Apariencia" description="El color del sistema para vos. Se guarda en este navegador: los demás siguen viendo el suyo.">
      <div className="space-y-5">
        <ConfigFormCard>
          <ConfigSectionTitle>Colores listos</ConfigSectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7" role="radiogroup" aria-label="Color del sistema">
            {TEMAS.map((t) => {
              const elegido = tema === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={elegido}
                  onClick={() => { elegirTema(t.id); elegirLetras(LETRA_POR_DEFECTO); }}
                  className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-3 text-xs font-semibold transition-all hover:-translate-y-0.5 hover:shadow-sm ${
                    elegido ? "border-slate-400 bg-slate-50 text-slate-900" : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-full shadow-inner" style={{ backgroundColor: t.muestra }}>
                    {elegido ? <Check aria-hidden className="h-5 w-5 text-white" /> : null}
                  </span>
                  {t.nombre}
                  {t.id === TEMA_POR_DEFECTO ? <span className="-mt-1.5 text-[10px] font-medium text-slate-400">original</span> : null}
                </button>
              );
            })}
          </div>
          {guardados.length ? (
            <div className="mt-5">
              <p className={F_LABEL}>Mis colores</p>
              <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Mis colores">
                {guardados.map((c) => {
                  const elegido = tema.toLowerCase() === c;
                  return (
                    <div key={c} className="group relative">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={elegido}
                        onClick={() => aplicarPropio(c)}
                        title={c}
                        className={`flex flex-col items-center gap-1.5 rounded-xl border px-3 py-2.5 font-mono text-[11px] font-semibold transition-all hover:-translate-y-0.5 hover:shadow-sm ${
                          elegido ? "border-slate-400 bg-slate-50 text-slate-900" : "border-slate-200 bg-white text-slate-500"
                        }`}
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-black/5 shadow-inner" style={{ backgroundColor: c }}>
                          {elegido ? <Check aria-hidden className={`h-4 w-4 ${luminancia(c) > 0.45 ? "text-slate-800" : "text-white"}`} /> : null}
                        </span>
                        {c}
                      </button>
                      <button
                        type="button"
                        onClick={() => borrarColor(c)}
                        aria-label={`Sacar ${c} de mis colores`}
                        title="Sacar de mis colores"
                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 opacity-0 shadow-sm transition-opacity hover:text-rose-600 focus:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
                      >
                        <X aria-hidden className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </ConfigFormCard>

        <ConfigFormCard>
          <ConfigSectionTitle>Tu propio color</ConfigSectionTitle>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] sm:items-start">
            <div>
              <label htmlFor="color-paleta" className={F_LABEL}>Paleta</label>
              <input
                id="color-paleta"
                type="color"
                value={actual}
                onChange={(e) => aplicarPropio(e.target.value)}
                className="h-[38px] w-24 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
              />
            </div>
            <div>
              <label htmlFor="color-hex" className={F_LABEL}>Hex</label>
              <input
                id="color-hex"
                value={hex}
                onChange={(e) => { setHex(e.target.value); aplicarTexto(e.target.value); }}
                onBlur={() => { if (!hexValido) setHex(actual); }}
                placeholder="#4faeb2"
                maxLength={7}
                spellCheck={false}
                aria-invalid={!hexValido}
                className={`${F_INPUT} font-mono ${hexValido ? "" : "border-rose-300"}`}
              />
            </div>
            <div>
              <label htmlFor="color-rgb" className={F_LABEL}>RGB</label>
              <input
                id="color-rgb"
                value={rgb}
                onChange={(e) => { setRgb(e.target.value); aplicarTexto(e.target.value); }}
                onBlur={() => { if (!rgbValido) setRgb(hexARgb(actual).join(", ")); }}
                placeholder="79, 174, 178"
                maxLength={18}
                spellCheck={false}
                aria-invalid={!rgbValido}
                className={`${F_INPUT} font-mono ${rgbValido ? "" : "border-rose-300"}`}
              />
            </div>
          </div>
          <ConfigHelpText>
            Se usa exactamente el color que elijas, sin límites: el menú lateral y los botones quedan de ese color. Si es un color claro, cambiá abajo el color de las letras para que se lean.
          </ConfigHelpText>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => guardarColor(tema)}
              disabled={!esPropio || yaGuardado}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-default disabled:opacity-50"
            >
              <BookmarkPlus aria-hidden className="h-4 w-4" />
              {yaGuardado ? "Ya está en mis colores" : "Guardar en mis colores"}
            </button>
            {!esPropio ? <span className="text-xs text-slate-400">Elegí un color propio para poder guardarlo.</span> : null}
          </div>

        </ConfigFormCard>

        <ConfigFormCard>
          <ConfigSectionTitle>Color de las letras</ConfigSectionTitle>
          <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Color de las letras">
            {LETRAS.map((l) => {
              const elegida = letras === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  role="radio"
                  aria-checked={elegida}
                  onClick={() => elegirLetras(l.id)}
                  className={`flex min-w-[120px] items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm font-semibold transition-all hover:-translate-y-0.5 hover:shadow-sm ${
                    elegida ? "border-slate-400 bg-slate-50 text-slate-900" : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-300" style={{ backgroundColor: l.muestra }}>
                    {elegida ? <Check aria-hidden className={`h-3.5 w-3.5 ${l.id === "blanco" ? "text-slate-700" : "text-white"}`} /> : null}
                  </span>
                  {l.nombre}
                </button>
              );
            })}
          </div>
          <ConfigHelpText>Son las letras que van sobre el color del sistema: las del menú lateral y las de los botones.{letras === LETRA_POR_DEFECTO ? " Sin elegir ninguna quedan las de siempre." : ""}</ConfigHelpText>

          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">Así se ve</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="rounded-lg bg-[#224E55] px-3 py-2 text-xs font-semibold text-white">Menú lateral</span>
              <span className="rounded-lg bg-[#4FAEB2] px-3 py-2 text-xs font-semibold text-white shadow-sm shadow-[#4FAEB2]/30">Botón</span>
              <span className="rounded-lg border border-[#4FAEB2]/40 bg-[#4FAEB2]/10 px-3 py-2 text-xs font-semibold text-[#2F6E71]">Etiqueta</span>
              <span className="text-xs font-semibold text-[#3F8E91] underline underline-offset-2">Un enlace</span>
            </div>
          </div>
        </ConfigFormCard>

        <ConfigFormCard>
          <ConfigSectionTitle>Estrellas de favoritos</ConfigSectionTitle>
          <div className="flex flex-wrap items-end gap-3" role="radiogroup" aria-label="Color de las estrellas">
            {ESTRELLAS.map((e) => {
              const elegida = estrella === e.id;
              return (
                <button
                  key={e.id}
                  type="button"
                  role="radio"
                  aria-checked={elegida}
                  onClick={() => elegirEstrella(e.id)}
                  className={`flex min-w-[104px] items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm font-semibold transition-all hover:-translate-y-0.5 hover:shadow-sm ${
                    elegida ? "border-slate-400 bg-slate-50 text-slate-900" : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#224E55]">
                    <Star aria-hidden className="h-4 w-4 fill-current" style={{ color: e.muestra }} />
                  </span>
                  {e.nombre}
                  {e.id === ESTRELLA_POR_DEFECTO ? <span className="text-[10px] font-medium text-slate-400">original</span> : null}
                </button>
              );
            })}
            <div>
              <label htmlFor="estrella-paleta" className={F_LABEL}>Otro</label>
              <input
                id="estrella-paleta"
                type="color"
                value={estrellaHex}
                onChange={(e) => elegirEstrella(e.target.value)}
                className="h-[42px] w-20 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
              />
            </div>
          </div>
          <ConfigHelpText>Las estrellas de tus favoritos en el menú lateral y en las portadas.</ConfigHelpText>
        </ConfigFormCard>

        <div>
          <button
            type="button"
            onClick={() => { elegirTema(TEMA_POR_DEFECTO); elegirLetras(LETRA_POR_DEFECTO); elegirEstrella(ESTRELLA_POR_DEFECTO); }}
            disabled={original}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-default disabled:opacity-50"
          >
            <RotateCcw aria-hidden className="h-4 w-4" />
            Volver al color original
          </button>
          {original ? <p className="mt-2 text-xs text-slate-400">Ya estás usando el color original.</p> : null}
        </div>
      </div>
    </GlobalConfigSubpageShell>
  );
}
