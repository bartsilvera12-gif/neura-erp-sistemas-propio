# QA Center — procedimiento de aplicación, verificación y reversión

> **Importante**: este documento describe pasos que un humano con acceso al VPS Supabase debe ejecutar. **El código del repo no los corre automáticamente**.
> Toda operación debe ejecutarse con un **backup fresco del catálogo** (`pg_dumpall --globals-only` + `pg_dump -s`) y, para los cambios DDL, idealmente también un backup lógico de los esquemas `neura` y `zentra_erp`.

## 0. Pre-requisitos (SIN cambios todavía)

- SSH al VPS Supabase (`187.77.247.54`) o `docker exec supabase-db` con usuario `postgres`.
- Rama `feat/qa-center-mvp` al día.
- Confirmar que `qa_center` **no existe** todavía:
  ```sql
  SELECT 1 FROM information_schema.schemata WHERE schema_name = 'qa_center';
  ```
  Debe devolver 0 filas. Si devuelve una, hubo un intento previo: investigar antes de seguir.

## 1. Backup

```bash
# En el VPS Supabase
docker exec supabase-db pg_dumpall -U postgres --globals-only > /root/backups/qa-center-$(date +%F)-globals.sql
docker exec supabase-db pg_dump -U postgres -d postgres -s > /root/backups/qa-center-$(date +%F)-schema.sql
docker exec supabase-db pg_dump -U postgres -d postgres -n neura -Fc > /root/backups/qa-center-$(date +%F)-neura.dump
docker exec supabase-db pg_dump -U postgres -d postgres -n zentra_erp -Fc > /root/backups/qa-center-$(date +%F)-zentra.dump
```

Verificar tamaños. Guardar los 4 archivos **fuera** del VPS (otro host, S3, etc.).

## 2. Aplicar la migración

```bash
# Copiar el archivo al VPS
scp supabase/migrations/20261112000000_qa_center_schema.sql root@187.77.247.54:/tmp/

# En el VPS
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < /tmp/20261112000000_qa_center_schema.sql
```

**No usar `supabase db push`** porque reaplica migraciones ya aplicadas en orden y puede fallar en instalaciones existentes con historia previa. Preferir `psql -f` directo.

## 3. Verificación post-apply (sin side effects)

Ejecutar en psql:

```sql
-- 3.1 Esquema existe
SELECT 1 FROM information_schema.schemata WHERE schema_name = 'qa_center';

-- 3.2 Tablas esperadas
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'qa_center'
 ORDER BY table_name;
-- debe devolver: audit_log, evidences, findings, projects, results,
--                runner_jobs, runner_nonces, runs, suites

-- 3.3 Columnas críticas
SELECT column_name FROM information_schema.columns
 WHERE table_schema='qa_center' AND table_name='suites'
 ORDER BY column_name;
-- debe incluir: specs text[], enabled, name, slug, project_id, ...

-- 3.4 UNIQUE anti-duplicados
SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE connamespace = 'qa_center'::regnamespace AND contype = 'u';
-- debe listar uq_results_run_spec_title entre otros

-- 3.5 Funciones
SELECT p.proname, pg_get_function_arguments(p.oid)
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='qa_center'
 ORDER BY p.proname;
-- debe incluir: claim_next_job(text), cleanup_runner_nonces(timestamptz),
--               reclaim_stale_jobs(interval), touch_updated_at()

-- 3.6 RLS activa
SELECT c.relname, c.relrowsecurity FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='qa_center' AND c.relkind='r'
 ORDER BY c.relname;
-- relrowsecurity debe ser true en todas

-- 3.7 Grants solo service_role
SELECT grantee, privilege_type, table_name
  FROM information_schema.role_table_grants
 WHERE table_schema='qa_center'
 ORDER BY table_name, grantee;
-- Debe listar únicamente service_role (y nunca anon/authenticated/public)

-- 3.8 Exposición PostgREST: NO estar expuesto aún (eso se hace en paso 4)
SHOW pgrst.db_schemas;
-- o, si no está configurado via SHOW, consultar el entorno de postgrest.
```

## 4. Exponer el schema a PostgREST (preservando los existentes)

### 4.1 Si el stack usa `supabase/config.toml` (Supabase CLI o self-host con el mismo formato)

Editar únicamente la línea:
```toml
[api]
schemas = ["public", "graphql_public", "neura", "qa_center"]
```
**Agregar al final, sin quitar nada.** Si existen más entradas (otros clientes), conservarlas todas. `extra_search_path` NO se modifica — mantener `["public","extensions","neura"]`.

Luego recargar el stack:
```bash
docker compose -f /opt/supabase/docker-compose.yml restart kong postgrest
```

### 4.2 Si el stack configura PostgREST por variable de entorno (`PGRST_DB_SCHEMAS`)

```bash
# Leer valor actual
docker exec supabase-postgrest env | grep PGRST_DB_SCHEMAS
# PGRST_DB_SCHEMAS=public,graphql_public,neura

# Actualizar el docker-compose.yml y agregar "qa_center" al final
#   PGRST_DB_SCHEMAS: "public,graphql_public,neura,qa_center"
docker compose up -d postgrest
```

### 4.3 Verificar exposición

```bash
curl -s https://api.neura.com.py/qa_center/ -H "apikey: $ANON_KEY" | jq '.definitions | keys'
# Debe listar: projects, suites, runs, runner_jobs, runner_nonces, ...
```

## 5. Configurar secretos de runtime

### En Coolify (aplicación del ERP)
- `QA_RUNNER_SHARED_SECRET` = string ≥32 caracteres aleatorios (ej. `openssl rand -hex 48`).

### En el entorno del runner (cuando se despliegue)
- `QA_RUNNER_SHARED_SECRET` = **mismo valor** que arriba.
- `QA_ALLOWED_TARGET_HOSTS` = CSV con los hosts staging permitidos.

**Nunca** hardcodear el secret en git. Rotarlo = generar uno nuevo + actualizar ambos deploys simultáneamente.

## 6. Seed de datos (ficticios)

Ver `supabase/seeds/qa_center_seed_sample.sql`. Es un INSERT de 1 proyecto + 1 suite de prueba. **No se aplica automáticamente**; lo ejecuta un humano cuando quiera habilitar un run de humo.

## 7. Reversión (rollback)

### 7.1 Rollback blando (desactivar PostgREST)
Si algo falla en runtime del QA Center, remover `qa_center` del array `schemas` en `config.toml` o de `PGRST_DB_SCHEMAS`, y recargar. **El schema sigue existiendo en la BD pero no está expuesto.** Es el rollback rápido recomendado.

### 7.2 Rollback duro (DROP SCHEMA)
```sql
BEGIN;
DROP SCHEMA qa_center CASCADE;
COMMIT;
```
Esto borra 100% de lo creado por la migración. **No afecta `neura`, `zentra_erp`, `auth`, `storage` ni ningún otro esquema**: `qa_center` fue aditivo desde el día uno.

### 7.3 Verificación post-rollback
```sql
SELECT 1 FROM information_schema.schemata WHERE schema_name='qa_center';
-- Debe devolver 0 filas.
```

## 8. Auditoría de impacto sobre otros schemas / roles

**Confirmación de aislamiento** (puede ejecutarse ANTES de aplicar para predecir el impacto):
```sql
-- 8.1 La migración no toca otros schemas
--     (grep del archivo: no hay referencias a `neura.`, `zentra_erp.` ni `erp_*`)

-- 8.2 Ningún rol existente se altera
--     (grep del archivo: solo REVOKE/GRANT sobre service_role, anon,
--      authenticated, PUBLIC — ninguno de esos roles se CREATE/ALTER/DROP)

-- 8.3 No se tocan triggers de otros esquemas
--     (todos los CREATE TRIGGER son sobre qa_center.*)

-- 8.4 Ningún otro schema queda listado en search_path del proceso postgres
--     después del apply:
SHOW search_path;
```

## 9. Rollback de emergencia del ERP (si el panel rompiera)

Dado que las rutas `/api/qa/*` y `/dashboard/qa-center` son **nuevas**, revertir en el ERP equivale a:
1. Revert de los commits `feat/qa-center-mvp` sobre `main` (si hubiese llegado ahí).
2. Redeploy en Coolify.

Ninguna ruta pre-existente fue modificada, por lo que el rollback del ERP no impacta otros módulos.

---

Para dudas: `C:\NEURA\qa-center-audit\` contiene todo el historial de auditoría.
