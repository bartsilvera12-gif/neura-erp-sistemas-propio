"use client";

/**
 * Configuración → Apariencia: el color del sistema para quien lo elige (se guarda en su
 * navegador; los demás no lo ven). De la lista, o uno propio con la paleta, en hex o en RGB.
 */
import { useEffect, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import { ConfigFormCard, ConfigHelpText, ConfigSectionTitle, F_INPUT, F_LABEL } from "@/components/config/global-config-primitives";
import { GlobalConfigSubpageShell } from "@/components/config/GlobalConfigSubpageShell";
import { TEMAS, TEMA_POR_DEFECTO, elegirTema, hexARgb, normalizarColor } from "@/lib/tema-color";
import { useTema } from "@/lib/useTema";

export default function ConfiguracionAparienciaPage() {
  const tema = useTema();
  const esPropio = tema.startsWith("#");
  const actual = esPropio ? tema : (TEMAS.find((t) => t.id === tema)?.muestra ?? TEMAS[0].muestra).toLowerCase();
  const [hex, setHex] = useState(actual);
  const [rgb, setRgb] = useState(hexARgb(actual).join(", "));

  // Los campos siguen a lo elegido (también cuando se elige de la lista o se vuelve al original).
  useEffect(() => {
    setHex(actual);
    setRgb(hexARgb(actual).join(", "));
  }, [actual]);

  const aplicarTexto = (texto: string) => {
    const c = normalizarColor(texto);
    if (c) elegirTema(c);
    return Boolean(c);
  };
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
                  onClick={() => elegirTema(t.id)}
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
                onChange={(e) => elegirTema(e.target.value)}
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
            Del color que elijas se toma el tono; el sistema arma solo las versiones claras y oscuras (menú, botones, bordes) para que todo se siga leyendo bien.
          </ConfigHelpText>

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

        <div>
          <button
            type="button"
            onClick={() => elegirTema(TEMA_POR_DEFECTO)}
            disabled={tema === TEMA_POR_DEFECTO}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-default disabled:opacity-50"
          >
            <RotateCcw aria-hidden className="h-4 w-4" />
            Volver al color original
          </button>
          {tema === TEMA_POR_DEFECTO ? <p className="mt-2 text-xs text-slate-400">Ya estás usando el color original.</p> : null}
        </div>
      </div>
    </GlobalConfigSubpageShell>
  );
}
