import "server-only";

/**
 * Memoria de corto plazo para la sesión resuelta en Server Actions.
 *
 * Cada acción del servidor —finalizar una conversación, transferirla, abrir el
 * modal— empezaba por la misma cadena: validar el token contra Auth (un viaje
 * a la red), buscar la fila de `usuarios`, y averiguar el schema de la empresa.
 * Tres viajes antes de hacer nada, y se sienten: es la mayor parte de lo que se
 * percibe como "el modal tarda".
 *
 * Nada de eso cambia de un segundo al otro, así que se recuerda por un rato.
 *
 * El precio, dicho claro: si a alguien le cambian la empresa o se le cierra la
 * sesión, puede seguir operando hasta medio minuto. Para un ERP interno es un
 * canje razonable; para algo con dinero de por medio habría que revisarlo.
 */

type Entrada<T> = { valor: T; vence: number };

class CacheTTL<T> {
  private readonly datos = new Map<string, Entrada<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly max = 500
  ) {}

  get(clave: string): T | undefined {
    const e = this.datos.get(clave);
    if (!e) return undefined;
    if (e.vence < Date.now()) {
      this.datos.delete(clave);
      return undefined;
    }
    return e.valor;
  }

  set(clave: string, valor: T): void {
    if (this.datos.size >= this.max) {
      const ahora = Date.now();
      for (const [k, v] of this.datos) if (v.vence < ahora) this.datos.delete(k);
      if (this.datos.size >= this.max) {
        const primera = this.datos.keys().next().value;
        if (primera !== undefined) this.datos.delete(primera);
      }
    }
    this.datos.set(clave, { valor, vence: Date.now() + this.ttlMs });
  }
}

/** Quién es quien pide, resuelto desde las cookies. 30 s. */
export const cacheUsuarioSesion = new CacheTTL<{ id: string; empresa_id: string }>(30_000, 600);

/** El schema de datos de una empresa no cambia; cinco minutos sobran. */
export const cacheSchemaEmpresa = new CacheTTL<string>(5 * 60_000, 300);
