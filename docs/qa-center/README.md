# NEURA QA CENTER

> **Estado**: MVP-1 (esquema + endpoint de safety + docs). Nada aplicado en Supabase, nada desplegado.
> **Rama**: `feat/qa-center-mvp`.
> **Alcance**: exclusivamente QA Desarrollo. Nunca ejecuta contra producción.

## Qué es

Un panel de QA integrado al ERP central que dispara, muestra y archiva corridas E2E (Playwright) contra entornos **no productivos** de los ERP de Neura. El motor de ejecución (runner) vive en una aplicación Coolify separada.

## Arquitectura

```
ERP CENTRAL (sistemas.neura.com.py)          QA RUNNER (app Coolify aparte)
├── /dashboard/qa-center    (UI)             ├── Playwright v1.58
├── /api/qa/*               (API)            ├── Anthropic SDK (triage)
├── src/lib/qa/*                             └── Supabase client (qa_center)
└── Supabase esquema `qa_center`
```

- **UI dentro del ERP** porque reusa auth, shadcn, layouts. No duplica login.
- **Motor aparte** porque Chromium pesa y no debe correr con el proceso Next.
- **Supabase compartido** con el ERP, pero en esquema `qa_center` aislado y RLS deny-all excepto `service_role`.

## Garantías de seguridad (ver `safety-rails.md`)

1. `/api/qa/env-assert` es el único canal que autoriza una corrida. Si no responde `prod_safe: true`, el runner aborta antes de abrir el browser.
2. En producción, `env-assert` devuelve 403. Nunca revela "env=production".
3. El runner trae una **lista negra hard-coded** de hosts Supabase productivos.
4. El schema `qa_center` no se expone al API Supabase hasta que lo agreguen manualmente a `config.toml`.

## Archivos del MVP-1

| Ruta | Rol | Tamaño |
|---|---|---|
| `supabase/migrations/20261112000000_qa_center_schema.sql` | Migración aditiva: schema, enums, tablas, RLS, grant service_role, `claim_next_job` | ~7 KB |
| `src/lib/qa/types.ts` | Tipos compartidos UI/API/runner | ~1.5 KB |
| `src/lib/qa/env-assert.ts` | Detección de entorno + armado de respuesta | ~4 KB |
| `src/app/api/qa/env-assert/route.ts` | Endpoint público (sin auth) para el runner | ~1 KB |
| `docs/qa-center/README.md` | Este archivo | — |
| `docs/qa-center/safety-rails.md` | Reglas de seguridad detalladas | — |

Ninguno de estos archivos toca código preexistente. No hay cambios en `middleware.ts`, `next.config.ts`, `package.json`, `.env*`, ni en ninguna ruta del módulo Soporte / Omnicanal / Facturación / Sorteos.

## Cómo probar el endpoint en local

```bash
# En dev, NODE_ENV=development → env-assert devuelve 200 con env="local"
npm run dev
curl http://localhost:3000/api/qa/env-assert
```

Sin `.env.local` configurado, el endpoint responde con `supabase_host: "(sin configurar)"`, `supabase_ref: null`, `prod_safe: true` (porque no apunta a prod).

## Qué queda para MVP-2 y MVP-3

- **MVP-2** (UI panel): `/dashboard/qa-center/*`, gating super_admin, endpoints `GET /api/qa/projects`, `GET /api/qa/runs`, lectura del esquema `qa_center`.
- **MVP-3** (runner): repo nuevo `neura-qa-runner`, Dockerfile Playwright, 1 spec smoke, deploy Coolify.

## Qué necesita autorización humana (no automatizable)

1. Agregar `qa_center` al array `schemas` de `supabase/config.toml` y recargar PostgREST (acción manual en el VPS Supabase).
2. Aplicar la migración `20261112000000_qa_center_schema.sql` contra el Supabase existente (con backup previo del catálogo).
3. Crear el bucket `qa-artifacts` en Supabase Storage.
4. Crear la aplicación Coolify del runner.
5. Definir `QA_ENV` + `QA_RUNNER_JWT_SECRET` en los deploys que lo necesiten.
