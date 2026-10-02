import "server-only";

/* eslint-disable @typescript-eslint/no-explicit-any */
type SB = any;

/** Mapa nodo_id → lista de co-jefes (jefes adicionales al parent_id). Drift-safe si no existe la tabla. */
export async function fetchJefesExtra(supabase: SB, empresaId: string): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const { data, error } = await supabase
    .from("organigrama_nodo_jefes")
    .select("nodo_id, jefe_id")
    .eq("empresa_id", empresaId);
  if (error) {
    if (error.code === "42P01") return map; // tabla aún no creada en este tenant
    throw new Error(error.message);
  }
  for (const r of data ?? []) {
    const k = String(r.nodo_id);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(String(r.jefe_id));
  }
  return map;
}

/**
 * Valida y REEMPLAZA los co-jefes de un nodo (doble jefatura).
 * - `undefined` → no se tocó el campo (no hace nada).
 * - array → set final de co-jefes (se normaliza: únicos, sin sí mismo, sin el parent).
 * Rechaza si algún co-jefe no existe o crearía un bucle (co-jefe que depende del propio nodo).
 */
export async function syncJefesExtra(
  supabase: SB,
  empresaId: string,
  nodoId: string,
  parentId: string | null,
  jefesExtraRaw: unknown
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (jefesExtraRaw === undefined) return { ok: true };
  const arr = Array.isArray(jefesExtraRaw) ? jefesExtraRaw : [];
  const jefes = [...new Set(arr.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean))].filter(
    (j) => j !== nodoId && j !== parentId
  );

  const { data: nodos, error: e1 } = await supabase
    .from("organigrama_nodos")
    .select("id, parent_id")
    .eq("empresa_id", empresaId);
  if (e1) return { ok: false, status: 400, message: e1.message };
  const ids = new Set((nodos ?? []).map((n: any) => String(n.id)));
  for (const j of jefes) if (!ids.has(j)) return { ok: false, status: 400, message: "Un co-jefe indicado no existe." };

  // Grafo de hijos (parent_id + co-jefes actuales) para detectar ciclos.
  const linkMap = await fetchJefesExtra(supabase, empresaId);
  const childrenOf = new Map<string, string[]>();
  const addChild = (padre: string, hijo: string) => {
    if (!childrenOf.has(padre)) childrenOf.set(padre, []);
    childrenOf.get(padre)!.push(hijo);
  };
  for (const n of nodos ?? []) {
    const id = String(n.id);
    const p = n.parent_id ? String(n.parent_id) : null;
    if (p) addChild(p, id);
  }
  for (const [hijo, js] of linkMap.entries()) for (const j of js) addChild(j, hijo);

  const descendientes = new Set<string>();
  const stack = [nodoId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of childrenOf.get(cur) ?? []) {
      if (!descendientes.has(c)) {
        descendientes.add(c);
        stack.push(c);
      }
    }
  }
  for (const j of jefes) {
    if (j === nodoId || descendientes.has(j)) {
      return { ok: false, status: 400, message: "No se puede: uno de los co-jefes depende de este cargo (haría un bucle)." };
    }
  }

  const { error: eDel } = await supabase
    .from("organigrama_nodo_jefes")
    .delete()
    .eq("empresa_id", empresaId)
    .eq("nodo_id", nodoId);
  if (eDel) return { ok: false, status: 400, message: eDel.message };

  if (jefes.length) {
    const rows = jefes.map((j) => ({ empresa_id: empresaId, nodo_id: nodoId, jefe_id: j }));
    const { error: eIns } = await supabase.from("organigrama_nodo_jefes").insert(rows);
    if (eIns) return { ok: false, status: 400, message: eIns.message };
  }
  return { ok: true };
}
