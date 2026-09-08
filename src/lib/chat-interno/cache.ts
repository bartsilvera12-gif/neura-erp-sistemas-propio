import "server-only";

/**
 * Memoria de corto plazo del chat, en el proceso.
 *
 * El chat hace muchos pedidos chicos —marcar leído, reaccionar, contar sin
 * leer— y cada uno pagaba, ANTES de tocar un solo mensaje, la misma cadena:
 * validar el token contra Auth, buscar la fila de `usuarios`, resolver los
 * módulos, y averiguar el schema de la empresa. Media docena de viajes para
 * responder algo que se resuelve con uno.
 *
 * Nada de esto cambia de un segundo al otro, así que se recuerda por un rato.
 * No es un caché general del ERP: vive acá, con TTL corto, y sólo guarda cosas
 * que ya se le habían entregado a esta misma sesión.
 */

type Entrada<T> = { valor: T; vence: number };

class CacheTTL<T> {
  private readonly datos = new Map<string, Entrada<T>>();

  constructor(
    private readonly ttlMs: number,
    /** Techo de entradas: un proceso largo no puede crecer sin límite. */
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
      // Se limpia lo vencido antes de desalojar; casi siempre alcanza.
      const ahora = Date.now();
      for (const [k, v] of this.datos) if (v.vence < ahora) this.datos.delete(k);
      if (this.datos.size >= this.max) {
        const primera = this.datos.keys().next().value;
        if (primera !== undefined) this.datos.delete(primera);
      }
    }
    this.datos.set(clave, { valor, vence: Date.now() + this.ttlMs });
  }

  borrar(clave: string): void {
    this.datos.delete(clave);
  }
}

/**
 * Sesión ya resuelta (quién es, de qué empresa, con acceso al chat).
 *
 * 30 s: lo que dura una ráfaga de interacción. El precio de recordarlo es que
 * si a alguien le sacan el módulo, o cierra sesión, puede seguir entrando hasta
 * medio minuto. Para un chat interno eso es aceptable; para algo con dinero de
 * por medio no lo sería.
 */
export const cacheSesion = new CacheTTL<unknown>(30_000, 400);

/**
 * URLs firmadas de adjuntos y avatares.
 *
 * Se firman por una hora y se recuerdan 45 minutos: siempre se entrega una URL
 * con al menos quince minutos de vida por delante. Firmar es un viaje al
 * storage por cada pantalla, y la misma foto aparece en cada mensaje.
 */
export const cacheFirmas = new CacheTTL<string>(45 * 60_000, 3000);

/** El schema de datos de una empresa no cambia; cinco minutos sobran. */
export const cacheSchema = new CacheTTL<string>(5 * 60_000, 200);
