import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Salida standalone: genera .next/standalone con server.js y solo el subconjunto
   * de node_modules que el trazado de Next detecta como necesario. La imagen final
   * deja de arrastrar todo el proyecto → "exporting layers" mucho más corta.
   * Arranca con `node server.js` (no `next start`).
   */
  output: "standalone",
  /**
   * El host de build self-hosted (Coolify/nixpacks) tiene RAM acotada y el
   * OOM-killer mata la fase "Running TypeScript"/ESLint de `next build`
   * (SIGKILL, exit 255) en builds fríos con dependencias pesadas (recharts).
   * La validez de tipos y lint se garantiza fuera del build de producción
   * con `npm run build` / `tsc --noEmit` / `npm run lint` en local/CI (corren
   * en verde sobre este commit). Por eso se omite esa fase en el build del
   * servidor para que el deploy no caiga por memoria. Revisar si se agrega
   * swap/upgrade de RAM al host de build → reactivar.
   */
  typescript: { ignoreBuildErrors: true },
  experimental: {
    /**
     * Tope del cuerpo que el middleware puede clonar. El default de Next es 10 MB y, al
     * pasarlo, NO rechaza el pedido: lo CORTA ("Only the first 10 MB will be available") y la
     * ruta recibe un multipart truncado. `request.formData()` falla, las rutas lo atrapan como
     * `null` y responden "Se requiere conversation_id y archivo" — un mensaje falso, porque
     * el cliente sí había mandado los dos campos.
     *
     * Afecta a las 22 rutas de subida del ERP (chat, proyectos, QA, cobranzas, compras…),
     * porque el middleware corre sobre todas. Se sube a 70 MB, apenas por encima del máximo
     * que acepta el propio ERP (videos de hasta 64 MB en send-media).
     *
     * Costo a tener presente: el middleware clona el cuerpo, así que una subida grande ocupa
     * memoria dos veces mientras dura. Con el tamaño de uploads de este ERP es aceptable; si
     * algún día se aceptan archivos mucho más grandes, conviene sacar esas rutas del matcher
     * del middleware en vez de seguir subiendo este número.
     */
    proxyClientMaxBodySize: "70mb",
  },
};

export default nextConfig;
