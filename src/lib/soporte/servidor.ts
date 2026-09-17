import "server-only";
import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { errorResponse, successResponse } from "@/lib/api/response";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import {
  CLASIFICACIONES_DEFECTO,
  ESTADOS_DEFECTO,
  PRIORIDADES_DEFECTO,
  TIPOS_DEFECTO,
  type CatalogosSoporte,
  type SoporteClasificacion,
  type SoporteEstado,
  type SoportePrioridad,
  type SoporteTipo,
} from "@/lib/soporte/dominio";
import type { SoporteAuth } from "@/lib/soporte/soporte-auth";
import { MINUTO, MemoriaTTL } from "@/lib/soporte/cache";

// ------------------------------------------------------------------ respuestas

export function ok<T>(data: T) {
  return NextResponse.json(successResponse(data));
}

export function falla(message: string, status = 400) {
  return NextResponse.json(errorResponse(message), { status });
}

export function sinPermiso(auth: Exclude<SoporteAuth, { ok: true }>) {
  return falla(auth.message, auth.status);
}

export function errorInesperado(e: unknown) {
  return falla(e instanceof Error ? e.message : "Error", 500);
}

// -------------------------------------------------------------------- catálogos

const TABLAS = {
  estados: "soporte_estados",
  tipos: "soporte_tipos",
  clasificaciones: "soporte_clasificaciones",
  prioridades: "soporte_prioridades",
} as const;

/**
 * Crea los catálogos por defecto de la empresa si todavía no los tiene.
 *
 * Se siembran por empresa y bajo demanda —la primera vez que alguien usa el
 * módulo— en vez de desde la migración: sembrar desde SQL exigiría adivinar qué
 * empresas viven en cada schema. `ignoreDuplicates` lo hace idempotente y seguro
 * ante dos pedidos simultáneos; y nunca pisa lo que un admin ya editó.
 */
export async function asegurarCatalogos(sb: AppSupabaseClient, empresaId: string): Promise<void> {
  const { count } = await sb
    .from(TABLAS.estados)
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresaId);
  if ((count ?? 0) > 0) return;

  const conEmpresa = <T extends object>(filas: T[]) => filas.map((f) => ({ ...f, empresa_id: empresaId }));
  const opts = { onConflict: "empresa_id,codigo", ignoreDuplicates: true };
  await sb.from(TABLAS.estados).upsert(conEmpresa(ESTADOS_DEFECTO), opts);
  await sb.from(TABLAS.tipos).upsert(conEmpresa(TIPOS_DEFECTO), opts);
  await sb.from(TABLAS.clasificaciones).upsert(conEmpresa(CLASIFICACIONES_DEFECTO), opts);
  await sb.from(TABLAS.prioridades).upsert(conEmpresa(PRIORIDADES_DEFECTO), opts);
}

const memoriaCatalogos = new MemoriaTTL<CatalogosSoporte>(MINUTO, 300);

/** Catálogos de la empresa, desde la memoria corta (ver `cache.ts`). */
export function leerCatalogos(sb: AppSupabaseClient, empresaId: string): Promise<CatalogosSoporte> {
  return memoriaCatalogos.obtener(empresaId, () => leerCatalogosDeBase(sb, empresaId));
}

/** Tras editar la configuración: la próxima lectura va a la base. */
export function invalidarCatalogos(empresaId: string): void {
  memoriaCatalogos.borrar(empresaId);
}

async function leerCatalogosDeBase(sb: AppSupabaseClient, empresaId: string): Promise<CatalogosSoporte> {
  await asegurarCatalogos(sb, empresaId);
  const [e, t, c, p] = await Promise.all([
    sb.from(TABLAS.estados).select("codigo, nombre, tipo, color, area, detiene_sla, es_inicial, sort_order, activo").eq("empresa_id", empresaId).order("sort_order"),
    sb.from(TABLAS.tipos).select("codigo, nombre, sla_horas, sort_order, activo").eq("empresa_id", empresaId).order("sort_order"),
    sb.from(TABLAS.clasificaciones).select("codigo, tipo_codigo, nombre, sla_horas, prioridad_sugerida, sort_order, activo").eq("empresa_id", empresaId).order("sort_order"),
    sb.from(TABLAS.prioridades).select("codigo, nombre, color, sort_order, activo").eq("empresa_id", empresaId).order("sort_order"),
  ]);
  const num = <T extends { sla_horas?: unknown }>(rows: T[]) =>
    rows.map((r) => ("sla_horas" in r ? { ...r, sla_horas: r.sla_horas == null ? null : Number(r.sla_horas) } : r));
  return {
    estados: (e.data ?? []) as SoporteEstado[],
    tipos: num((t.data ?? []) as SoporteTipo[]) as SoporteTipo[],
    clasificaciones: num((c.data ?? []) as SoporteClasificacion[]) as SoporteClasificacion[],
    prioridades: (p.data ?? []) as SoportePrioridad[],
  };
}

export const TABLAS_CATALOGO = TABLAS;

// -------------------------------------------------------------------- personas

export type Persona = {
  id: string;
  nombre: string;
  rol: string | null;
  /** Etiqueta para mostrar junto al nombre: Desarrollo, QA, PM, Admin… */
  area: string;
  es_project_manager: boolean;
  es_tecnico: boolean;
  es_qa: boolean;
};

function areaDe(u: { rol?: string | null; es_qa?: boolean | null; es_tecnico?: boolean | null; es_project_manager?: boolean | null }): string {
  if (u.es_qa) return "QA";
  if (u.es_tecnico) return "Desarrollo";
  if (u.es_project_manager) return "PM";
  const r = (u.rol ?? "").toLowerCase();
  if (r.includes("admin")) return "Admin";
  return "Equipo";
}

/** Nombre corto: nombre + primer apellido (con cuatro palabras, la tercera). */
export function nombreCorto(nombre: string | null | undefined): string {
  const w = (nombre ?? "").trim().split(/\s+/).filter(Boolean);
  if (w.length === 0) return "";
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase();
  if (w.length >= 4) return `${cap(w[0])} ${cap(w[2])}`;
  return w.slice(0, 2).map(cap).join(" ");
}

/**
 * Los usuarios del catálogo, por id. Los tickets guardan ids de usuario, y el
 * catálogo puede vivir en otro schema que los datos: no hay join posible, se
 * resuelve aparte en una sola consulta.
 */
const memoriaPersona = new MemoriaTTL<Persona>(MINUTO, 3000);

export async function personasPorId(ids: (string | null | undefined)[]): Promise<Map<string, Persona>> {
  const unicos = [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))];
  const mapa = new Map<string, Persona>();
  // Casi siempre son las mismas diez personas: sólo se consulta lo que falta.
  const faltan: string[] = [];
  for (const id of unicos) {
    const p = memoriaPersona.get(id);
    if (p) mapa.set(id, p);
    else faltan.push(id);
  }
  if (faltan.length === 0) return mapa;
  const catalog = createServiceRoleClient();
  const { data } = await catalog
    .from("usuarios")
    .select("id, nombre, email, rol, es_project_manager, es_tecnico, es_qa")
    .in("id", faltan);
  for (const u of (data ?? []) as Record<string, unknown>[]) {
    const id = String(u.id);
    mapa.set(id, {
      id,
      nombre: nombreCorto((u.nombre as string) || (u.email as string) || "") || "Usuario",
      rol: (u.rol as string) ?? null,
      area: areaDe(u as never),
      es_project_manager: u.es_project_manager === true,
      es_tecnico: u.es_tecnico === true,
      es_qa: u.es_qa === true,
    });
    memoriaPersona.set(id, mapa.get(id) as Persona);
  }
  return mapa;
}

const memoriaEquipo = new MemoriaTTL<Persona[]>(MINUTO, 300);

/** Usuarios activos de la empresa, para los selectores de responsable. */
export function personasDeEmpresa(empresaId: string): Promise<Persona[]> {
  return memoriaEquipo.obtener(empresaId, () => personasDeEmpresaDeBase(empresaId));
}

async function personasDeEmpresaDeBase(empresaId: string): Promise<Persona[]> {
  const catalog = createServiceRoleClient();
  const { data } = await catalog
    .from("usuarios")
    .select("id, nombre, email, rol, estado, es_project_manager, es_tecnico, es_qa")
    .eq("empresa_id", empresaId)
    .ilike("estado", "activo")
    .order("nombre");
  return ((data ?? []) as Record<string, unknown>[]).map((u) => ({
    id: String(u.id),
    nombre: nombreCorto((u.nombre as string) || (u.email as string) || "") || "Usuario",
    rol: (u.rol as string) ?? null,
    area: areaDe(u as never),
    es_project_manager: u.es_project_manager === true,
    es_tecnico: u.es_tecnico === true,
    es_qa: u.es_qa === true,
  }));
}

const memoriaClientes = new MemoriaTTL<{ id: string; nombre: string }[]>(MINUTO, 300);

/**
 * Todos los clientes de la empresa (id + nombre), en memoria corta. Lo usan el
 * selector de clientes y los nombres de las tablas: una sola lectura sirve para
 * toda una pantalla. Paginado porque PostgREST corta en 1000.
 */
export function clientesDeEmpresa(sb: AppSupabaseClient, empresaId: string) {
  return memoriaClientes.obtener(empresaId, async () => {
    const lista: { id: string; nombre: string }[] = [];
    for (let desde = 0; desde < 20_000; desde += 1000) {
      const { data, error } = await sb
        .from("clientes")
        .select("id, empresa, nombre_contacto")
        .eq("empresa_id", empresaId)
        // Los clientes eliminados no se ofrecen (Clientes tampoco los lista).
        .is("deleted_at", null)
        .range(desde, desde + 999);
      if (error) throw new Error(error.message);
      const lote = (data ?? []) as { id: string; empresa?: string | null; nombre_contacto?: string | null }[];
      for (const c of lote) lista.push({ id: c.id, nombre: (c.empresa?.trim() || c.nombre_contacto?.trim() || "Cliente") as string });
      if (lote.length < 1000) break;
    }
    return lista.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  });
}

/** Nombres de clientes existentes, por id (la tabla de Clientes no se duplica). */
export async function clientesPorId(
  sb: AppSupabaseClient,
  empresaId: string,
  ids: (string | null | undefined)[]
): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))];
  const mapa = new Map<string, string>();
  if (unicos.length === 0) return mapa;
  const todos = await clientesDeEmpresa(sb, empresaId).catch(() => [] as { id: string; nombre: string }[]);
  const porId = new Map(todos.map((c) => [c.id, c.nombre]));
  const faltan = unicos.filter((id) => {
    const n = porId.get(id);
    if (n) mapa.set(id, n);
    return !n;
  });
  // Un cliente dado de alta hace menos de un minuto todavía no está en memoria.
  if (faltan.length === 0) return mapa;
  const { data } = await sb
    .from("clientes")
    .select("id, empresa, nombre_contacto")
    .eq("empresa_id", empresaId)
    .in("id", faltan);
  for (const c of (data ?? []) as { id: string; empresa?: string | null; nombre_contacto?: string | null }[]) {
    mapa.set(c.id, (c.empresa?.trim() || c.nombre_contacto?.trim() || "Cliente") as string);
  }
  return mapa;
}

// -------------------------------------------------------------------- historial

export type EventoHistorial = {
  tipo_evento: string;
  valor_anterior?: string | null;
  valor_nuevo?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Agrega eventos al historial del ticket. Sólo inserta: la tabla no admite
 * UPDATE ni DELETE ni siquiera para service role.
 *
 * Si falla se registra y se sigue: el cambio del ticket ya quedó hecho, y
 * devolver error haría que el usuario lo reintente y lo duplique.
 */
export async function registrarHistorial(
  sb: AppSupabaseClient,
  args: { empresaId: string; ticketId: string; usuarioId: string | null; eventos: EventoHistorial[] }
): Promise<void> {
  if (args.eventos.length === 0) return;
  const filas = args.eventos.map((ev) => ({
    empresa_id: args.empresaId,
    ticket_id: args.ticketId,
    usuario_id: args.usuarioId,
    tipo_evento: ev.tipo_evento,
    valor_anterior: ev.valor_anterior ?? null,
    valor_nuevo: ev.valor_nuevo ?? null,
    metadata: ev.metadata ?? {},
  }));
  const { error } = await sb.from("soporte_ticket_historial").insert(filas);
  if (error) console.error("[soporte] no se pudo registrar historial", error.message);
}

/** Toca `updated_at` del ticket: comentar o adjuntar también es actividad. */
export async function tocarTicket(
  sb: AppSupabaseClient,
  empresaId: string,
  ticketId: string,
  usuarioId: string
): Promise<void> {
  await sb
    .from("soporte_tickets")
    .update({ updated_at: new Date().toISOString(), updated_by: usuarioId })
    .eq("empresa_id", empresaId)
    .eq("id", ticketId);
}

// --------------------------------------------------------------------- storage

/** Bucket privado existente del ERP; Soporte usa su propio prefijo. */
export const SOPORTE_BUCKET = "proyectos";
export const SOPORTE_URL_FIRMADA_TTL = 60 * 10;

export function prefijoArchivosTicket(empresaId: string, ticketId: string): string {
  return `soporte/${empresaId}/${ticketId}/`;
}

export function pathArchivoTicket(empresaId: string, ticketId: string, nombre: string): string {
  const limpio =
    (nombre || "archivo")
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 90)
      .toLowerCase() || "archivo";
  return `${prefijoArchivosTicket(empresaId, ticketId)}${crypto.randomUUID()}-${limpio}`;
}

export async function asegurarBucket(): Promise<void> {
  const catalog = createServiceRoleClient();
  const { data } = await catalog.storage.listBuckets();
  if ((data ?? []).some((b) => b.name === SOPORTE_BUCKET)) return;
  await catalog.storage.createBucket(SOPORTE_BUCKET, { public: false });
}

/** Ticket por id, acotado a la empresa. `null` si no existe o es de otra. */
export async function ticketDeEmpresa<T = Record<string, unknown>>(
  sb: AppSupabaseClient,
  empresaId: string,
  ticketId: string,
  campos: string
): Promise<T | null> {
  if (!/^[0-9a-f-]{36}$/i.test(ticketId)) return null;
  const { data } = await sb
    .from("soporte_tickets")
    .select(campos)
    .eq("empresa_id", empresaId)
    .eq("id", ticketId)
    .maybeSingle();
  return (data as T | null) ?? null;
}
