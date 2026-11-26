"use client";

/**
 * Sucursales y depósitos del lado del cliente: tipos, el hook que los trae (cacheado: casi
 * no cambian) y las opciones para los selectores. Una sola llamada a la base
 * (sucursales_depositos, receta 50) trae todo: sucursales con sus depósitos (y cuánto
 * stock tiene cada uno), usuarios con su sucursal (solo ADMIN) y el depósito por defecto
 * de quien pide.
 */
import { useEffect, useState } from "react";
import { apiFetchSWR, guardadoAlInstante, invalidar } from "@/erp2/lib/api/cache-cliente";

export type Deposito = {
  id: string;
  nombre: string;
  descripcion: string | null;
  es_principal: boolean;
  activo: boolean;
  productos: number;
  unidades: number;
  valor: number;
};

export type Sucursal = {
  id: string;
  nombre: string;
  direccion: string | null;
  ciudad: string | null;
  telefono: string | null;
  establecimiento: string | null;
  punto_expedicion: string | null;
  es_principal: boolean;
  activa: boolean;
  usuarios: number;
  depositos: Deposito[];
};

export type UsuarioSucursal = { id: string; nombre: string; rol: string; sucursal_id: string | null };

export type DatosDepositos = {
  sucursales: Sucursal[];
  usuarios: UsuarioSucursal[];
  mi_sucursal_id: string | null;
  mi_deposito_id: string | null;
  es_admin: boolean;
  traslados_en_transito: number;
  ajustes_pendientes: number;
};

/** Depósito con los datos de su sucursal (lista plana para selectores y tablas). */
export type DepositoPlano = Deposito & { sucursal_id: string; sucursal: string; sucursal_activa: boolean; sucursal_principal: boolean };

export const URL_DEPOSITOS = "/api/inventario/depositos";

/** Después de crear/editar una sucursal, un depósito o un traslado/ajuste (contadores). */
export function invalidarDepositos() {
  invalidar(URL_DEPOSITOS);
}

/**
 * Sucursales y depósitos (compartido entre pantallas, stale-while-revalidate). `recarga` al
 * cambiar pide de nuevo sin usar lo guardado.
 */
export function useDepositos(recarga = 0) {
  const [datos, setDatos] = useState<DatosDepositos | null>(() => guardadoAlInstante<DatosDepositos>(URL_DEPOSITOS) ?? null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    // Lo ya visto pinta al instante; se revalida si tiene más de 30 s.
    apiFetchSWR<DatosDepositos>(URL_DEPOSITOS, (d) => { setDatos(d); setError(false); },
      { maxEdadMs: 30_000, fresco: recarga > 0, signal: ctrl.signal })
      .catch(() => { if (!ctrl.signal.aborted) setError(true); });
    return () => ctrl.abort();
  }, [recarga]);
  return { datos, error, cargando: !datos && !error };
}

export function depositosPlanos(d: DatosDepositos | null | undefined): DepositoPlano[] {
  if (!d) return [];
  return d.sucursales.flatMap((s) =>
    s.depositos.map((dep) => ({ ...dep, sucursal_id: s.id, sucursal: s.nombre, sucursal_activa: s.activa, sucursal_principal: s.es_principal })),
  );
}

/** "Casa central › Depósito principal" si hay más de una sucursal; si no, solo el depósito. */
export function nombreDeposito(dep: Pick<DepositoPlano, "nombre" | "sucursal">, variasSucursales: boolean) {
  return variasSucursales ? `${dep.sucursal} › ${dep.nombre}` : dep.nombre;
}

/** Opciones [id, etiqueta] de depósitos activos (para Select). */
export function opcionesDepositos(d: DatosDepositos | null | undefined, opts: { soloActivos?: boolean; excluir?: string } = {}): [string, string][] {
  const planos = depositosPlanos(d).filter((x) => (opts.soloActivos === false || (x.activo && x.sucursal_activa)) && x.id !== opts.excluir);
  const varias = (d?.sucursales.filter((s) => s.activa).length ?? 0) > 1;
  return planos.map((x): [string, string] => [x.id, nombreDeposito(x, varias)]);
}

/**
 * Filtro "dónde mirar": todas · una sucursal (sus depósitos) · un depósito.
 * Valores: "" · "s:<id>" · "d:<id>".
 */
export function opcionesAlcance(d: DatosDepositos | null | undefined, todas = "Todos los depósitos"): [string, string][] {
  if (!d) return [["", todas]];
  const out: [string, string][] = [["", todas]];
  const activas = d.sucursales.filter((s) => s.activa || s.depositos.some((x) => x.unidades > 0));
  for (const s of activas) {
    const deps = s.depositos.filter((x) => x.activo || x.unidades > 0);
    if (activas.length > 1) out.push([`s:${s.id}`, `${s.nombre} (toda la sucursal)`]);
    for (const x of deps) out.push([`d:${x.id}`, activas.length > 1 ? `${s.nombre} › ${x.nombre}` : x.nombre]);
  }
  return out;
}

/** ¿Vale la pena mostrar el filtro de depósito? (más de un depósito con algo o activo) */
export function hayVariosDepositos(d: DatosDepositos | null | undefined) {
  return depositosPlanos(d).filter((x) => x.activo || x.unidades > 0).length > 1;
}

/** "d:<id>" → { deposito }, "s:<id>" → { sucursal }. */
export function partesAlcance(v: string): { deposito: string | null; sucursal: string | null } {
  if (v.startsWith("d:")) return { deposito: v.slice(2), sucursal: null };
  if (v.startsWith("s:")) return { deposito: null, sucursal: v.slice(2) };
  return { deposito: null, sucursal: null };
}
