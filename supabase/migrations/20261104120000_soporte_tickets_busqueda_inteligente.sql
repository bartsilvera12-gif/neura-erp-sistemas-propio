-- =============================================================================
-- Buscador INTELIGENTE de tickets de Soporte (solo schema neura)
--
-- Hoy la búsqueda es tonta: si es número -> eq(numero); si no -> ILIKE sobre
-- SOLO el asunto. No encuentra por cliente/proyecto/descripción, las tildes
-- cuentan, no tolera el orden de las palabras ni los errores de tipeo, y no
-- ordena por relevancia.
--
-- Se reemplaza por un RPC que, con unaccent + pg_trgm:
--   · busca sin tildes (reusa neura.sin_tildes, lower+unaccent IMMUTABLE),
--   · sobre asunto, descripción, resultado esperado, impacto, pasos, módulo,
--     próxima acción, #número, NOMBRE DEL CLIENTE, TÍTULOS DE SUS PROYECTOS y
--     el nombre de la clasificación,
--   · exige que TODAS las palabras aparezcan (orden libre),
--   · tolera errores de tipeo con word_similarity (trigramas),
--   · ordena por relevancia (número exacto > frase en asunto > resto).
--
-- Devuelve solo {id, estado_codigo, rank} de TODOS los estados que matchean los
-- demás filtros; la API pagina, filtra por estado y arma los contadores, igual
-- que hoy. Volumen de tickets por empresa es chico, así que un recorrido por
-- empresa es instantáneo (sin índices dedicados que después haya que mantener).
--
-- Scope: SOLO neura (sistemas-propio). No se aplica a otros schemas de empresa.
-- Aplicar en ventana tranquila: agregar la función dispara un reload del
-- schema cache de PostgREST.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- sin_tildes: lower + unaccent determinista (IMMUTABLE para poder indexar/usar).
-- Idempotente: si el inbox ya la creó, la reescribe igual.
DO $$
DECLARE dicc text;
BEGIN
  SELECT n.nspname INTO dicc
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'unaccent';
  IF dicc IS NULL THEN dicc := 'public'; END IF;

  EXECUTE format($f$
    CREATE OR REPLACE FUNCTION neura.sin_tildes(t text)
    RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $body$
      SELECT lower(%I.unaccent('%I.unaccent'::regdictionary, t))
    $body$
  $f$, dicc, dicc);
END $$;

GRANT EXECUTE ON FUNCTION neura.sin_tildes(text) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RPC de búsqueda. Devuelve los ids que matchean (todos los estados) con su
-- score de relevancia, aplicando los mismos filtros que la lista salvo estado.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION neura.soporte_tickets_buscar(
  p_empresa     uuid,
  p_q           text,
  p_cliente     uuid   DEFAULT NULL,
  p_tipo        text   DEFAULT NULL,
  p_prioridad   text   DEFAULT NULL,
  p_responsable uuid   DEFAULT NULL,
  p_cargados_by uuid   DEFAULT NULL,   -- created_by = este usuario
  p_mios_by     uuid   DEFAULT NULL,   -- responsable_id = este usuario
  p_ids         uuid[] DEFAULT NULL    -- restringir a estos ids (pestaña "Por revisar")
)
RETURNS TABLE(id uuid, estado_codigo text, rank real)
LANGUAGE sql
STABLE
SET search_path = neura, extensions, public, pg_temp
AS $$
  WITH q AS (
    SELECT neura.sin_tildes(btrim(coalesce(p_q, ''))) AS qn
  ),
  palabras AS (
    SELECT w
    FROM q, unnest(regexp_split_to_array(q.qn, '\s+')) AS w
    WHERE btrim(w) <> ''
  ),
  base AS (
    SELECT
      t.id,
      t.estado_codigo,
      t.numero,
      neura.sin_tildes(coalesce(t.asunto, '')) AS hay_asunto,
      neura.sin_tildes(
        coalesce(t.asunto, '')              || ' ' ||
        coalesce(t.descripcion, '')         || ' ' ||
        coalesce(t.resultado_esperado, '')  || ' ' ||
        coalesce(t.impacto_operativo, '')   || ' ' ||
        coalesce(t.pasos_reproducir, '')    || ' ' ||
        coalesce(t.modulo, '')              || ' ' ||
        coalesce(t.proxima_accion, '')      || ' ' ||
        t.numero::text                      || ' ' ||
        coalesce(c.nombre, '')              || ' ' ||
        coalesce((
          SELECT string_agg(p.titulo, ' ')
          FROM neura.proyectos p
          WHERE p.cliente_id = t.cliente_id AND p.empresa_id = t.empresa_id
        ), '')                              || ' ' ||
        coalesce((
          SELECT cl.nombre
          FROM neura.soporte_clasificaciones cl
          WHERE cl.empresa_id = t.empresa_id AND cl.codigo = t.clasificacion_codigo
        ), '')
      ) AS hay
    FROM neura.soporte_tickets t
    LEFT JOIN neura.clientes c ON c.id = t.cliente_id
    WHERE t.empresa_id = p_empresa
      AND (p_cliente     IS NULL OR t.cliente_id     = p_cliente)
      AND (p_tipo        IS NULL OR t.tipo_codigo     = p_tipo)
      AND (p_prioridad   IS NULL OR t.prioridad_codigo = p_prioridad)
      AND (p_responsable IS NULL OR t.responsable_id  = p_responsable)
      AND (p_cargados_by IS NULL OR t.created_by      = p_cargados_by)
      AND (p_mios_by     IS NULL OR t.responsable_id  = p_mios_by)
      AND (p_ids         IS NULL OR t.id = ANY(p_ids))
  )
  SELECT
    b.id,
    b.estado_codigo,
    (
        (CASE WHEN b.numero::text = (SELECT qn FROM q)              THEN 100 ELSE 0 END)
      + (CASE WHEN b.hay_asunto LIKE '%' || (SELECT qn FROM q) || '%' THEN 20 ELSE 0 END)
      + (CASE WHEN b.hay        LIKE '%' || (SELECT qn FROM q) || '%' THEN  8 ELSE 0 END)
      + similarity((SELECT qn FROM q), b.hay_asunto) * 5
      + similarity((SELECT qn FROM q), b.hay)        * 2
    )::real AS rank
  FROM base b
  WHERE
    -- Todas las palabras deben aparecer (orden libre). Cada palabra matchea por
    -- substring (ya sin tildes) o, si tiene 4+ letras, por parecido (typos).
    -- Sin palabras (q vacío) => no filtra, devuelve todo lo de los filtros.
    NOT EXISTS (
      SELECT 1 FROM palabras w
      WHERE NOT (
        b.hay LIKE '%' || w.w || '%'
        OR (length(w.w) >= 4 AND word_similarity(w.w, b.hay) >= 0.4)
      )
    )
  ORDER BY rank DESC, b.numero DESC
$$;

GRANT EXECUTE ON FUNCTION neura.soporte_tickets_buscar(uuid, text, uuid, text, text, uuid, uuid, uuid, uuid[])
  TO authenticated, service_role;

-- PostgREST tiene que ver la función nueva.
NOTIFY pgrst, 'reload schema';
