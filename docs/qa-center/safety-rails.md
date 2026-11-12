# NEURA QA CENTER — Safety Rails

Regla de oro: **ninguna línea de código de QA Center puede ejecutarse contra producción**. Las reglas abajo son redundantes a propósito.

## 1. `/api/qa/env-assert`

| Entorno del deploy | Response |
|---|---|
| `production` (default si no se declara `QA_ENV`) | `HTTP 403 { "code": "forbidden_production" }` |
| `staging` / `preview` / `local` | `HTTP 200 { env, supabase_host, supabase_ref, integrations, prod_safe, reasons }` |

Criterios de `prod_safe = true` (AND, no OR):
- `env !== "production"`.
- `supabase_host` no está en `PROD_SUPABASE_HOSTS` (hard-coded: actualmente `["api.neura.com.py"]`).
- Ninguna integración está en `"live"`.

Si alguna condición falla, la respuesta sigue siendo 200 pero `prod_safe: false` con `reasons` legibles. **El runner aborta ante `prod_safe: false` igual que ante 403.**

## 2. Detección de entorno (nunca por hostname)

Orden de prioridad en `detectEnv()`:
1. `QA_ENV=staging|preview|local|production` (explícita).
2. `NODE_ENV=development` → `local`.
3. `VERCEL_ENV=preview` → `preview`.
4. Fallback: `production` (deny por default).

**El nombre del host no se considera.** Un hostname que diga "qa" o "staging" no basta.

## 3. Doble chequeo contra Supabase prod

Aunque `QA_ENV=staging` esté declarada, si `NEXT_PUBLIC_SUPABASE_URL` apunta a un host de la lista `PROD_SUPABASE_HOSTS`, `detectEnv()` degrada a `production` y el endpoint devuelve 403. Esto protege contra `.env` mal configurados.

## 4. Nunca se exponen secretos

`env-assert` jamás devuelve:
- `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, ni ningún otro JWT.
- `DATABASE_URL` ni ninguna URL con credenciales.
- `ANTHROPIC_API_KEY`, `CRON_SECRET`, tokens, passwords.
- Cabeceras `Authorization`.

`supabase_ref` se deriva del `iss` + `iat` del ANON KEY (hash parcial para comparar), no de la key en sí.

## 5. Aislamiento del esquema `qa_center`

- RLS activa en todas las tablas.
- Sin policies para `anon` / `authenticated`: solo `service_role` lee/escribe.
- Grant `USAGE` sobre el schema solo a `service_role` (`authenticated` queda fuera hasta Fase 2).
- Nombres `qa_center.*` no colisionan con `neura.*` ni `zentra_erp.*` ni `erp_*`.
- `DROP SCHEMA qa_center CASCADE;` revierte todo lo creado por la migración.

## 6. Exposición al API Supabase (acción separada y manual)

Para que PostgREST exponga `qa_center` hay que:
1. Agregar `"qa_center"` al array `schemas` de `supabase/config.toml :: [api]`.
2. Reiniciar el stack Supabase.

Esta migración **no hace nada de eso**. Se delega a un humano con autorización explícita.

## 7. Qué NO hace el endpoint (por diseño)

- No consulta la base de datos.
- No contacta al runner.
- No lee cookies ni headers de auth.
- No escribe a `audit_log` (eso lo hace el runner cuando reporta su decisión).
- No habilita CORS ampliado: usa los defaults de Next.

## 8. Lista de controles verificados antes del merge (checklist)

- [ ] `npx tsc --noEmit` pasa.
- [ ] `npm run build` pasa.
- [ ] `grep -r "api.neura.com.py" src/app/api/qa src/lib/qa` solo aparece en la lista `PROD_SUPABASE_HOSTS` (nunca como target).
- [ ] No hay imports a `src/lib/soporte/*`, `src/lib/chat/*`, `src/lib/facturacion/*`, `src/lib/sifen/*`, `src/lib/cobranzas/*`.
- [ ] No hay cambios en `middleware.ts`, `next.config.ts`, `package.json`.
- [ ] Migración `qa_center` NO fue aplicada contra ningún Supabase.
