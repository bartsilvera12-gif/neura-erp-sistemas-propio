import "server-only";

/**
 * Memoria corta del módulo Soporte, por instancia del servidor.
 *
 * Medido contra la base real, cada request pagaba 350–400 ms de preparación
 * antes de hacer lo que pidió: validar el token contra Auth (~80 ms), buscar al
 * usuario (~80 ms) y leer los cuatro catálogos (160–210 ms). El listado de
 * tickets dispara tres requests al entrar, así que pagaba eso tres veces.
 *
 * Nada de eso cambia de un segundo al otro, y se recuerda por un rato:
 *
 *   · sesión: 30 s, la misma ventana que ya acepta el resto del ERP
 *     (`cache-sesion-servidor.ts`). El PERMISO se vuelve a evaluar en cada
 *     request con el rol guardado; lo que se ahorra es el viaje a Auth.
 *   · catálogos, equipo y clientes: 60 s, y se invalidan al instante cuando
 *     alguien edita la configuración.
 *
 * La contrapartida, dicha claro: en Vercel hay varias instancias, y la
 * invalidación sólo alcanza a la que atendió el cambio. Las demás tardan como
 * mucho 60 s en ver un catálogo editado. Para una pantalla de configuración que
 * se toca de vez en cuando es un precio razonable.
 */

type Entrada<T> = { valor: T; vence: number };

export class MemoriaTTL<T> {
  private readonly datos = new Map<string, Entrada<T>>();
  private readonly enVuelo = new Map<string, Promise<T>>();
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

  borrar(clave: string): void {
    this.datos.delete(clave);
  }

  /**
   * Devuelve lo guardado o lo calcula UNA vez. Dos requests simultáneos que
   * llegan con la memoria vacía comparten la misma consulta en vez de lanzar
   * dos, que es justo lo que pasa cuando una pantalla abre con tres pedidos.
   */
  async obtener(clave: string, calcular: () => Promise<T>): Promise<T> {
    const guardado = this.get(clave);
    if (guardado !== undefined) return guardado;
    const enCurso = this.enVuelo.get(clave);
    if (enCurso) return enCurso;
    const promesa = calcular()
      .then((v) => {
        this.set(clave, v);
        return v;
      })
      .finally(() => this.enVuelo.delete(clave));
    this.enVuelo.set(clave, promesa);
    return promesa;
  }
}

export type SesionSoporte = { usuarioId: string; empresaId: string; rol: string | null; email: string | null };

export const memoriaSesion = new MemoriaTTL<SesionSoporte>(30_000, 1000);
export const MINUTO = 60_000;
