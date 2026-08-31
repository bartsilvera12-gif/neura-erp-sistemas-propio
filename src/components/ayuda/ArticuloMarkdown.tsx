"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renderer de artículos de Ayuda. Tipografía de lectura larga: títulos con aire,
 * listas legibles y tablas que scrollean solas en pantalla chica.
 */
const MD_COMPONENTS = {
  h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1 className="mb-3 mt-6 text-xl font-bold text-slate-900 first:mt-0" {...props} />
  ),
  h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className="mb-2 mt-6 text-lg font-bold text-slate-900 first:mt-0" {...props} />
  ),
  h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="mb-2 mt-5 text-base font-semibold text-slate-800 first:mt-0" {...props} />
  ),
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="mb-3 break-words text-[15px] leading-relaxed text-slate-700 last:mb-0" {...props} />
  ),
  strong: (props: React.HTMLAttributes<HTMLElement>) => (
    <strong className="font-semibold text-slate-900" {...props} />
  ),
  em: (props: React.HTMLAttributes<HTMLElement>) => <em className="italic" {...props} />,
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
    <ul className="mb-3 list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-slate-700" {...props} />
  ),
  ol: (props: React.HTMLAttributes<HTMLOListElement>) => (
    <ol className="mb-3 list-decimal space-y-1.5 pl-5 text-[15px] leading-relaxed text-slate-700" {...props} />
  ),
  li: (props: React.HTMLAttributes<HTMLLIElement>) => <li className="pl-1" {...props} />,
  blockquote: (props: React.HTMLAttributes<HTMLQuoteElement>) => (
    <blockquote
      className="mb-3 rounded-r-lg border-l-4 border-[#4FAEB2] bg-[#4FAEB2]/5 px-4 py-2.5 text-[15px] italic text-slate-600"
      {...props}
    />
  ),
  a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      className="font-medium text-[#3F8E91] underline underline-offset-2 hover:text-[#2F6E71]"
      target={props.href?.startsWith("http") ? "_blank" : undefined}
      rel={props.href?.startsWith("http") ? "noopener noreferrer" : undefined}
      {...props}
    />
  ),
  /**
   * Bloque de código. Va con su propio contenedor porque el `<pre>` por defecto
   * del navegador no encoge ni scrollea: una línea larga (una URL, un import)
   * empujaba el ancho y el código se salía de la tarjeta del artículo.
   *
   * `min-w-0` en el padre + `overflow-x-auto` acá = la línea larga scrollea
   * dentro del bloque en vez de estirar la página.
   */
  pre: (props: React.HTMLAttributes<HTMLPreElement>) => (
    <pre
      className="mb-4 max-w-full overflow-x-auto rounded-xl border border-slate-800 bg-[#0B1F22] p-4 font-mono text-[12.5px] leading-relaxed text-slate-100"
      {...props}
    />
  ),
  code: ({ className, ...props }: React.HTMLAttributes<HTMLElement>) => {
    // Dentro de un bloque cercado, react-markdown pone `language-*`. Ahí el
    // fondo lo pone el `pre`; la pastilla gris es sólo para el código en línea.
    const enBloque = typeof className === "string" && className.includes("language-");
    return enBloque ? (
      <code className={`font-mono ${className}`} {...props} />
    ) : (
      <code
        className="break-words rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px] text-slate-800"
        {...props}
      />
    );
  },
  hr: () => <hr className="my-6 border-slate-200" />,
  table: (props: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="mb-3 overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  th: (props: React.HTMLAttributes<HTMLTableCellElement>) => (
    <th
      className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
      {...props}
    />
  ),
  td: (props: React.HTMLAttributes<HTMLTableCellElement>) => (
    <td className="border-b border-slate-100 px-3 py-2 text-slate-700" {...props} />
  ),
  img: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="mb-3 max-w-full rounded-lg border border-slate-200" alt={props.alt ?? ""} {...props} />
  ),
};

export default function ArticuloMarkdown({ children }: { children: string }) {
  return (
    <div className="min-w-0 max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
