# Plan de migración — schema `qa_center` a Postgres en AWS EC2

**Estado**: DISEÑO v2 (revisado). **Nada se ejecuta** sin autorización explícita.
**Autorizado hasta ahora**: arquitectura general. **NO autorizado**: Fase B
(instalar PostgreSQL en EC2). Este documento resuelve los 7 bloqueos planteados
antes de autorizar Fase B.

---

## 1. Objetivo y alcance

- Separar el almacenamiento QA (schema `qa_center`) de la DB central de
  Supabase, moviéndolo a un **Postgres dedicado en la EC2** que ya corre el
  QA Runner.
- La **UI del QA Center queda en Coolify** temporalmente, accediendo al nuevo
  Postgres de EC2 a través de un canal seguro (sección 4).
- Mantener en la DB central **solo** la autorización del panel (`neura.*`,
  `auth.*`) y la lectura RO de `pg_catalog` para generar init-sql del runner.
- Preservar íntegramente: 18 tablas, enums, functions, triggers, policies y
  toda la data existente.

**Fuera de alcance**: no tocar otros schemas del ERP, no instalar PG en EC2,
no ejecutar migraciones, no desplegar, no commitear.

---

## 2. Inventario del acoplamiento actual

### 2.1 Schema `qa_center` — 18 tablas + 7 enums + 6 functions

**Tablas** (`projects`, `suites`, `runs`, `runner_jobs`, `runner_nonces`,
`results`, `evidences`, `findings`, `run_events`, `qa_sessions`,
`erp_discoveries`, `generated_specs`, `ai_usage`, `informes_ia`, `audit_log`,
`project_autorizaciones`, `project_credentials`, `project_features`).

**Enums**: `run_status`, `finding_severity`, `finding_status`, `target_env`,
`project_estado_entrega`, `generated_spec_status`, `credencial_rol`.

**Functions**: `claim_next_job(text)`, `reclaim_stale_jobs(interval)`,
`cleanup_runner_nonces(timestamptz)`, `touch_updated_at()`,
`touch_project_credentials()`, `touch_project_features()`. Todas con
`SET search_path = qa_center, pg_temp` — no tocan otros schemas.

### 2.2 Dependencias cross-schema (vectores de acoplamiento)

| Vector | Dónde | Qué hace | Solución |
|---|---|---|---|
| FK → `auth.users(id)` | 7 columnas en 5 tablas | Autoría de proyecto/run/finding/autorización/credencial | Dropear FK, mantener UUID (sección 7) |
| Extensión `pgcrypto` en schema `extensions` | `project_credentials.payload_cifrado` | pgp_sym_encrypt | Recrear en EC2 (sección 10 Fase B.4) |
| `authorize.ts` lee `neura.*` | Gate de acceso al panel | Qué user puede entrar a QA Center | Queda en DB central — es autorización del ERP (sección 13) |
| `init-sql` route lee `pg_catalog` del tenant | Genera DDL para runner | RO sobre catálogo | Queda temporalmente en DB central (Fase 3 opcional lo muda) |

### 2.3 Roles y grants actuales

- `qa_center_api`: backend QA Center. GRANTS sobre las 18 tablas + USAGE de `extensions`.
- `qa_runner`: runner. SELECT/INSERT/UPDATE solo en `qa_sessions`.
- `service_role` (Supabase) → **NO se migra**. Específico de Supabase.

---

## 3. Arquitectura destino

```
┌─ COOLIFY ────────────────────────────────────────────┐
│                                                      │
│ Supabase self-host (DB central)                      │
│  - schemas neura, auth, tenants                      │
│  - SOLO: authorize.ts, init-sql pg_catalog RO        │
│                                                      │
│ QA Center Next.js (UI + API)                         │
│  envs:                                               │
│   SUPABASE_DB_URL=central                            │
│   QA_DB_URL=100.X.X.X:5432/qa_center (Tailscale)     │
│                                                      │
└──────────────────────────┬───────────────────────────┘
                           │
          ╔════════════════╧════════════════╗
          ║   Tailscale mesh (WireGuard)    ║  canal cifrado E2E
          ║   100.X.X.X / 100.Y.Y.Y         ║  sin tocar firewall AWS/VPS
          ╚════════════════┬════════════════╝
                           │
┌──────────────────────────┴───────────────────────────┐
│ AWS EC2  Ubuntu 24.04  /home/ubuntu/qa-runner        │
│                                                      │
│  tailscale0  100.Y.Y.Y                               │
│  eth0       (IP pública — NO abrimos 5432 acá)       │
│                                                      │
│  Postgres QA (nuevo)                                 │
│   listen_addresses = '127.0.0.1, 100.Y.Y.Y'          │
│   NUNCA en eth0 (= IP pública)                       │
│   pg_hba: solo IP Tailscale de Coolify + localhost   │
│                                                      │
│  Contenedor qa-runner (ya corre)                     │
│   QA_CENTER_DATABASE_URL=postgres://qa_runner@       │
│     host.docker.internal:5432/qa_center              │
│                                                      │
│  Contenedores sesión efímera (postgres + app ERP)    │
│  Playwright + Chromium                               │
│                                                      │
│  Backups → S3 bucket off-box (cifrado KMS)           │
└──────────────────────────────────────────────────────┘
```

---

## 4. Conectividad Coolify ↔ EC2 **sin exponer 5432**

### 4.1 Problema

Coolify (VPS AR) y EC2 (AWS US/BR) son infraestructuras separadas.
**No hay IP privada compartida**. Las opciones:

| Opción | Pros | Contras |
|---|---|---|
| **Abrir 5432 público con `sslmode=verify-full`** | Simple | TLS protege en wire, pero expone PG al Internet. Escaneos constantes. Un 0day en PG se vuelve crítico. ❌ Descartado por pedido. |
| **Tailscale mesh** (WireGuard) | Zero-config, overlay privado 100.x.x.x/8, E2E encrypted, ACLs per-node | Agente en ambos hosts. Dependencia de coord Tailscale (SaaS gratis <100 devs; o Headscale self-hosted). |
| **SSH tunnel** `ssh -L 5432:localhost:5432` | Sin infra nueva | Long-lived SSH flaky; autossh/systemd necesario; 1 proceso por conexión. |
| **Cloudflare Tunnel (Zero Trust)** | No abre puertos, auth con mTLS | Tunnel TCP para PG requiere `cloudflared access tcp`; cliente usa `nc`-wrap; más fragile con drivers pg. |
| **AWS Site-to-Site VPN** | Enterprise | Costo (~$36/mo) + IPsec Coolify-side (requiere root). Overkill. |

### 4.2 Decisión recomendada: **Tailscale**

Razones:
- Agente corre en ambos hosts como daemon de systemd — lo maneja el OS, no un
  proceso user-space.
- Postgres escucha **solo** en `tailscale0` + `127.0.0.1`. Nunca en `eth0`
  pública. Un scanner Internet NO ve el puerto.
- ACLs declarativas: Coolify solo puede abrir TCP 5432 a EC2, no otros puertos.
- Free tier Tailscale: hasta 100 devices / 3 users — más que suficiente.
- Si el requisito futuro es evitar SaaS, swappable a **Headscale** (coord server
  self-hosted en un VPS chico) sin cambios de cliente.

### 4.3 Setup (DISEÑO — no ejecutar aún)

**En Coolify (VPS)**:
```bash
# Instalar agente
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --auth-key=<ONE_TIME_AUTHKEY> --hostname=coolify-prod --ssh=false --advertise-tags=tag:qa-center-client
```

**En EC2**:
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --auth-key=<ONE_TIME_AUTHKEY> --hostname=qa-ec2 --ssh=false --advertise-tags=tag:qa-db-server
```

**ACL** (vía Tailscale admin):
```json
{
  "tagOwners": {
    "tag:qa-center-client": ["admin@neura"],
    "tag:qa-db-server":    ["admin@neura"]
  },
  "acls": [
    {
      "action": "accept",
      "src":    ["tag:qa-center-client"],
      "dst":    ["tag:qa-db-server:5432"]
    }
  ]
}
```

Resultado: solo el nodo con tag `qa-center-client` (Coolify) puede abrir TCP
5432 contra el nodo con tag `qa-db-server` (EC2). Ningún otro puerto, ningún
otro origen.

### 4.4 Postgres config

```
# postgresql.conf
listen_addresses = '127.0.0.1, 100.Y.Y.Y'   # loopback + tailscale0, NUNCA eth0
port = 5432
ssl = on

# pg_hba.conf
hostssl  qa_center  qa_center_api  100.X.X.X/32  scram-sha-256   # Coolify via tailscale
local    qa_center  qa_runner                     peer
host     qa_center  qa_runner      127.0.0.1/32   scram-sha-256   # loopback del runner
```

### 4.5 QA Center env

```
QA_DB_URL=postgres://qa_center_api:<pw>@100.Y.Y.Y:5432/qa_center?sslmode=verify-full&sslrootcert=/etc/ssl/certs/qa-ec2-ca.pem
```

El `sslmode=verify-full` + root CA interno protege contra MITM aunque Tailscale
mismo ya cifra E2E. **Doble protección** (depth in defense).

### 4.6 Falla Tailscale → Postgres inaccesible

Comportamiento esperado: el pool pg del QA Center recibe `connect ECONNREFUSED`
y las rutas `/api/qa/*` devuelven 500 con mensaje "QA_DB_URL no disponible".
**La UI de autorización (`authorize.ts`) sigue funcionando** porque lee contra
`SUPABASE_DB_URL`. El usuario puede entrar al panel, ve el error y lee el
dashboard de salud (futuro). Alertamos a Telegram/email vía Prometheus.

---

## 5. Procedimiento de snapshot consistente **sin asumir réplica**

### 5.1 Hallazgo: no sabemos si existe réplica

Supabase self-host puede o no tener follower configurado. Antes de la Fase A:

- Ejecutar: `SELECT * FROM pg_stat_replication;` contra la primary.
- Si devuelve ≥1 fila → existe follower; dump desde ahí.
- Si devuelve 0 filas → **no hay réplica**. Usar procedimiento siguiente.

### 5.2 Procedimiento sin réplica (seguro contra inconsistencias)

Usamos `pg_dump` con snapshot transaccional explícito:

```bash
# A.1 — snapshot consistente
pg_dump \
  --host=<PRIMARY_HOST> \
  --username=postgres \
  --dbname=postgres \
  --schema=qa_center \
  --format=directory \
  --jobs=4 \
  --no-sync \
  --snapshot=<EXPORTED_SNAPSHOT_ID> \
  --file=./qa_center_snapshot_$(date +%s)
```

Para obtener el `snapshot_id`:

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SELECT pg_export_snapshot();   -- devuelve p. ej. '00000003-00000005-1'
-- MANTENER esta conexión abierta mientras pg_dump corre.
-- pg_dump --snapshot=<id> ve la DB en ESTE estado exacto, inmune a escrituras.
```

Impacto en la primary:
- `pg_dump --jobs=4 --format=directory` **no bloquea** escrituras.
- Sí consume CPU + IO durante ~N minutos. Agendar fuera de horario pico.
- Nunca mata VACUUM — la sesión snapshot sí evita cleanup de versiones viejas
  durante el dump, hay que terminarla ASAP.

### 5.3 Baseline de counts

Antes de cerrar la transacción de snapshot:

```sql
SELECT 'projects' as t, count(*) FROM qa_center.projects
UNION ALL SELECT 'suites', count(*) FROM qa_center.suites
UNION ALL SELECT 'runs', count(*) FROM qa_center.runs
UNION ALL SELECT 'runner_jobs', count(*) FROM qa_center.runner_jobs
UNION ALL SELECT 'runner_nonces', count(*) FROM qa_center.runner_nonces
UNION ALL SELECT 'results', count(*) FROM qa_center.results
UNION ALL SELECT 'evidences', count(*) FROM qa_center.evidences
UNION ALL SELECT 'findings', count(*) FROM qa_center.findings
UNION ALL SELECT 'run_events', count(*) FROM qa_center.run_events
UNION ALL SELECT 'qa_sessions', count(*) FROM qa_center.qa_sessions
UNION ALL SELECT 'erp_discoveries', count(*) FROM qa_center.erp_discoveries
UNION ALL SELECT 'generated_specs', count(*) FROM qa_center.generated_specs
UNION ALL SELECT 'ai_usage', count(*) FROM qa_center.ai_usage
UNION ALL SELECT 'informes_ia', count(*) FROM qa_center.informes_ia
UNION ALL SELECT 'audit_log', count(*) FROM qa_center.audit_log
UNION ALL SELECT 'project_autorizaciones', count(*) FROM qa_center.project_autorizaciones
UNION ALL SELECT 'project_credentials', count(*) FROM qa_center.project_credentials
UNION ALL SELECT 'project_features', count(*) FROM qa_center.project_features
ORDER BY t;
\copy (...above query...) TO '/tmp/qa_center_counts_baseline.csv' CSV HEADER
COMMIT;  -- cerrar la snapshot session
```

---

## 6. Restore considerando las 7 FKs a `auth.users`

### 6.1 Problema concreto

El dump incluye las FKs al schema `auth` que **no existe** en el Postgres EC2.
Si aplicás el restore raw, `pg_restore` ERRORea en las `ALTER TABLE ... ADD
CONSTRAINT ... REFERENCES auth.users(id)`.

### 6.2 Procedimiento recomendado: split en 3 secciones + TOC filter

`pg_dump` permite dividir el output en pre-data (schemas, tipos, tablas),
data (COPY), post-data (indices, constraints, triggers). Las FKs viven en
post-data. Lo filtramos ahí.

**C.1 — Split del dump original** (no ejecutar en primary, hacerlo sobre
la copia local del Fase A):

```bash
pg_restore --list qa_center_snapshot/ > full.toc

# Generamos la TOC SIN las FKs a auth.users
grep -v 'FK CONSTRAINT.*REFERENCES auth\.users' full.toc > filtered.toc
# O más explícito, por nombre de constraint conocido:
grep -vE 'projects_owner_user_id_fkey|runs_triggered_by_user_id_fkey|findings_assigned_user_id_fkey|findings_created_by_fkey|project_autorizaciones_usuario_id_fkey|project_credentials_created_by_fkey|project_credentials_desactivada_por_fkey' full.toc > filtered.toc
```

**C.2 — Restore con la TOC filtrada**:

```bash
pg_restore \
  --host=<EC2_HOST> \
  --username=postgres \
  --dbname=qa_center \
  --use-list=filtered.toc \
  --no-owner \
  --no-privileges \
  --jobs=4 \
  --verbose \
  qa_center_snapshot/
```

Resultado:
- Las 18 tablas, enums, functions, triggers, policies, indices, UNIQUE y
  CHECK constraints **se restauran todos**.
- Las 7 FKs a `auth.users` **se saltean silenciosamente** por la TOC filtrada.
- Las columnas siguen siendo `uuid NOT NULL REFERENCES auth.users(id)` en el
  CREATE TABLE original — el CONSTRAINT NO se materializa pero la columna existe.

Verificación post-restore:

```sql
-- Debe devolver 7 FKs si NO hubiéramos filtrado. Debe devolver 0.
SELECT conname
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
 WHERE c.contype = 'f'
   AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'qa_center')
   AND pg_get_constraintdef(c.oid) LIKE '%auth.users%';
-- Esperado: 0 filas.
```

### 6.3 Alternativa descartada: pre-crear stub `auth.users`

Crear un schema `auth` falso con tabla `users(id uuid PRIMARY KEY)` para que
las FKs apliquen. **Descartado**: agrega una tabla fantasma que después hay
que sincronizar o deprecar; genera confusión; no aporta integridad real.

### 6.4 Comportamiento del código tras drop de FKs

- `INSERT INTO qa_center.projects (owner_user_id, ...)` → ahora acepta cualquier
  UUID. El código del QA Center sigue pasando `auth.user.id` tomado de la
  cookie, que es válido por definición (si no está logueado, la ruta cortó
  antes). **Comportamiento idéntico**.
- Join cross-DB para mostrar nombres: hoy el panel NO hace eso (no detecté
  ningún query que haga JOIN qa_center + auth.users). Si en el futuro se
  necesita: fetch separado desde server component contra `SUPABASE_DB_URL`.

---

## 7. Cutover + rollback con reconciliación (sin pérdida de registros)

### 7.1 Problema del rollback original

En v1 proponía: "si falla, repuntá `QA_DB_URL` a central + redeploy". Fallo:
cualquier run encolado + ejecutado después del cutover queda **solo en EC2**
y no se reproduce en la central al rollback. Rows perdidos para el panel.

### 7.2 Procedimiento nuevo — cutover con pausa + reconciliación

#### Fase D (cutover)

**D.1 — Pausar escrituras aguas arriba** (10 min antes):
- Rotar el middleware QA Center a modo mantenimiento: todas las rutas de
  escritura (`POST`/`PUT`/`DELETE` bajo `/api/qa/*`) devuelven 503 con mensaje
  "QA Center en migración, reintente en 15 minutos".
- Las rutas de lectura siguen funcionando contra la central.
- El runner YA está pausado (se para antes como en v1).

**D.2 — Esperar quiescencia**:
- Confirmar `SELECT count(*) FROM qa_center.runner_jobs WHERE claimed_at IS NOT NULL AND completed_at IS NULL = 0`.
- Confirmar `SELECT count(*) FROM qa_center.runs WHERE status IN ('queued','running') = 0`.

**D.3 — Dump incremental final** (solo tablas mutables):

```bash
pg_dump --host=<PRIMARY> --dbname=postgres \
  --schema=qa_center \
  --table='qa_center.runs' \
  --table='qa_center.results' \
  --table='qa_center.evidences' \
  --table='qa_center.findings' \
  --table='qa_center.run_events' \
  --table='qa_center.ai_usage' \
  --table='qa_center.audit_log' \
  --table='qa_center.informes_ia' \
  --table='qa_center.erp_discoveries' \
  --table='qa_center.generated_specs' \
  --table='qa_center.project_credentials' \
  --table='qa_center.project_features' \
  --table='qa_center.project_autorizaciones' \
  --data-only \
  --format=custom \
  --file=qa_center_incremental_$(date +%s).dump
```

**D.4 — Restore incremental en EC2**:

```bash
pg_restore --dbname=qa_center \
  --data-only \
  --disable-triggers \
  --single-transaction \
  qa_center_incremental_*.dump
```

El `--single-transaction` garantiza que si algo falla se hace rollback
completo del incremental.

**D.5 — Verificación counts**:

Comparar `/tmp/qa_center_counts_baseline.csv` + delta del dump incremental
contra counts en EC2. Diff debe ser **0 en todas las tablas**.

**D.6 — Swap de env + redeploy**:
- En Coolify: `QA_DB_URL` → apunta a EC2 vía Tailscale.
- `docker restart` del QA Center.
- En EC2: `docker restart qa-runner` con `QA_CENTER_DATABASE_URL` → localhost.

**D.7 — Quitar modo mantenimiento**:
- Después de que la UI confirma lectura contra EC2, el middleware vuelve a
  aceptar escrituras.

**D.8 — Smoke end-to-end**:
- 1 run chico (`static_analysis` sobre `sistemas-propio`) completo.

#### Reconciliación durante cutover

El tiempo total de "no escritura" para el usuario es D.1 a D.7 (~15 min).
Durante ese tiempo:
- Las lecturas siguen (sirve el panel contra central, luego contra EC2).
- Las escrituras devuelven 503 con retry suggestion.
- **No se pierde absolutamente nada** porque no se procesaron escrituras
  durante la ventana.

### 7.3 Rollback de emergencia (si D.8 falla)

**R.1 — Pausar escrituras de nuevo** (middleware 503).

**R.2 — Dump reverso**: todo lo que entró a EC2 desde D.6 se dumpéa de vuelta
a la central:

```bash
pg_dump --host=<EC2_VIA_TAILSCALE> --dbname=qa_center \
  --schema=qa_center \
  --table='qa_center.runs' \
  --table='qa_center.results' \
  --table='qa_center.evidences' \
  --table='qa_center.findings' \
  --table='qa_center.run_events' \
  --table='qa_center.ai_usage' \
  --table='qa_center.audit_log' \
  --table='qa_center.informes_ia' \
  --table='qa_center.erp_discoveries' \
  --table='qa_center.generated_specs' \
  --table='qa_center.project_credentials' \
  --table='qa_center.project_features' \
  --table='qa_center.project_autorizaciones' \
  --data-only \
  --format=custom \
  --where="created_at > '<D.3_TIMESTAMP>'" \
  --file=rollback_delta.dump
```

**R.3 — Restore del delta a la central**:

```bash
pg_restore --host=<PRIMARY> --dbname=postgres \
  --data-only \
  --disable-triggers \
  --single-transaction \
  rollback_delta.dump
```

**R.4 — Swap env `QA_DB_URL` de vuelta a central** + redeploy.

**R.5 — Quitar modo mantenimiento**.

**R.6 — Postmortem** y análisis antes de reintentar la migración.

Riesgo residual del rollback: 1 fila bloqueada o parcial durante
`single-transaction` → el import entero se revierte y los rows nuevos en EC2
quedan solo en EC2 hasta siguiente intento. Mitigación: antes de R.1 hacer
`pg_dumpall` de EC2 completo como respaldo.

### 7.4 Ventana de quiescencia — matemática

Entre D.3 (dump incremental) y D.7 (quitamos mantenimiento), ningún job se
procesa. Ninguna fila se crea. Si la primary bloquea escrituras exitosamente
vía middleware 503, **no hay delta pérdida**.

Riesgo real: si un runner ignora el 503 porque está offline durante D.1 y
reconecta durante D.4. Mitigación: antes de D.1, ejecutar `docker stop
qa-runner` en EC2. Sin runner no hay claim.

---

## 8. Sizing EC2 + límites de recursos + alertas

### 8.1 Workload actual en la EC2 (sin PG agregado)

Procesos que ya corren o corrieron en pico:

| Proceso | RAM baseline | RAM pico | CPU |
|---|---|---|---|
| `qa-runner` Node | ~200 MB | ~500 MB | 0.3 |
| Playwright chromium (1 run) | ~400 MB | ~1.5 GB | 1-2 |
| Postgres sesión efímera (por run) | ~200 MB | ~800 MB | 0.5 |
| App ERP sandbox (por run) | ~500 MB | ~2 GB | 1 |
| Build de imagen ERP (git clone + docker build) | ~500 MB | ~2.5 GB | 2 |
| **Total run activo** | **~1.8 GB** | **~7 GB** | **~4-5 cores** |

### 8.2 Agregado nuevo: Postgres qa_center

Workload previsto:
- Rows en `run_events` + `evidences` crecen rápido (log per step).
- Reads frecuentes del QA Center UI (polling cada 2s para timeline).
- Transacciones por segundo: bajo (<10 TPS).

Sizing baseline Postgres:
- `shared_buffers = 512 MB` (10-15% RAM asumible).
- `effective_cache_size = 1.5 GB`.
- `work_mem = 8 MB`.
- `maintenance_work_mem = 128 MB`.
- `max_connections = 50` (pool pg del QA Center permite 5, runner ~5, resto buffer).
- Memoria pico: ~1 GB (buffers + conexiones + autovacuum).
- CPU: 0.5-1 core típico, pico 1.5 durante VACUUM.

### 8.3 Instancia recomendada

| Instance | RAM | CPU (vCPU) | ¿Aguanta? |
|---|---|---|---|
| **t3.medium** (actual estimado?) | 4 GB | 2 | ❌ Insuficiente. 7 GB pico + 1 GB PG >> 4 GB. |
| **t3.large** | 8 GB | 2 | 🟡 Justo. Durante runs concurrentes + VACUUM va a swap. |
| **t3.xlarge** | 16 GB | 4 | ✅ Recomendado. Margen cómodo. |
| **t3.2xlarge** | 32 GB | 8 | ✅ Óptimo si se planea >1 run concurrente. |

**Recomendación**: **t3.xlarge** (US~$0.166/h, ~$120/mes) o Graviton `t4g.xlarge`
(US~$0.134/h, ~$97/mes, ARM — requiere imagenes ARM del runner y app ERP).

### 8.4 Disco

- `evidences` + `run_events` crecen ~100 MB por run típico.
- 50 runs/mes × 100 MB = 5 GB/mes.
- Retención deseada: 90 días (= 15 GB).
- Overhead PG (indices, WAL, backups locales temporales): ×2.
- **Recomendado**: EBS gp3 **50 GB** (US~$4/mes) + CloudWatch alert @ 80%.

### 8.5 Límites de recursos por proceso (cgroups / Docker / systemd)

**Postgres** (service systemd en el host, NO Docker):

```
# /etc/systemd/system/postgresql.service.d/override.conf
[Service]
MemoryMax=2G
MemoryHigh=1.5G
CPUQuota=150%        # 1.5 CPUs max
TasksMax=200
```

**qa-runner container** (ya existe):

```bash
docker run ... \
  --memory=1g \
  --memory-swap=1g \
  --cpus=1.0 \
  qa-runner
```

**Session ephemeral containers** (postgres + app): el runner ya pone límites
(Fase 1 refactor): `NanoCpus: 500_000_000` postgres, `1_500_000_000` app;
`Memory: 1 GB` postgres, `2 GB` app.

### 8.6 Alertas (Prometheus — stack del PDF observabilidad)

Agregar al stack ya existente:

```yaml
- alert: EC2MemoriaAlta
  expr: 100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) > 85
  for: 5m
  labels: { severity: warn }

- alert: EC2DiscoBajo
  expr: 100 * (1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) > 80
  for: 10m
  labels: { severity: warn }

- alert: PgQaDown
  expr: up{job="pg_qa_center"} == 0
  for: 1m
  labels: { severity: page }

- alert: PgQaConexionesAltas
  expr: pg_stat_database_numbackends{datname="qa_center"} > 40
  for: 5m
  labels: { severity: warn }

- alert: PgQaBackupViejo
  expr: time() - pg_qa_last_backup_timestamp > 90000   # >25h
  for: 10m
  labels: { severity: page }

- alert: TailscaleDown
  expr: tailscale_up == 0
  for: 2m
  labels: { severity: page }
```

Promtail scrape adicional de `/var/log/postgresql/postgresql-15-main.log` →
Loki para query de logs lentos.

---

## 9. Backups automáticos, retención, recovery, **off-box**

### 9.1 Estrategia: pgBackRest a S3 (recomendado) o pg_dump + rclone

**Opción A — pgBackRest** (recomendada para prod):
- Full backup semanal + diff diario + WAL archive continuo.
- RPO (point-in-time recovery): **5 min**.
- RTO (restore): ~30 min.
- Storage: S3 bucket privado + encryption KMS.

**Opción B — pg_dump a S3** (simple, suficiente para esta escala):
- Dump completo diario + retención.
- RPO: **24 h**.
- RTO: ~15 min.
- Más simple de operar.

**Decisión recomendada**: **Opción B** para MVP, migrar a pgBackRest cuando
el workload justifique RPO <24h.

### 9.2 Opción B — concreto

**Cron en EC2** (`/etc/cron.d/qa-center-backup`):

```
0 3 * * * postgres /usr/local/bin/qa-center-backup.sh
```

**Script** (`/usr/local/bin/qa-center-backup.sh`):

```bash
#!/bin/bash
set -euo pipefail
TS=$(date -u +%Y%m%dT%H%M%SZ)
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

# 1) dump
pg_dump --dbname=qa_center --format=custom --compress=9 \
        --file=$TMPDIR/qa_center-$TS.dump

# 2) checksum
sha256sum $TMPDIR/qa_center-$TS.dump > $TMPDIR/qa_center-$TS.dump.sha256

# 3) subir a S3 con cifrado KMS (bucket aparte, cuenta aparte si posible)
aws s3 cp $TMPDIR/qa_center-$TS.dump \
  s3://neura-qa-backups/postgres/qa_center-$TS.dump \
  --sse aws:kms --sse-kms-key-id alias/neura-qa-backups
aws s3 cp $TMPDIR/qa_center-$TS.dump.sha256 \
  s3://neura-qa-backups/postgres/qa_center-$TS.dump.sha256 \
  --sse aws:kms --sse-kms-key-id alias/neura-qa-backups

# 4) emitir métrica Prometheus (pushgateway)
curl -X POST --data "pg_qa_last_backup_timestamp $(date +%s)" \
  http://127.0.0.1:9091/metrics/job/qa_center_backup
```

**IAM role de la EC2**: permisos `s3:PutObject` solo en
`arn:aws:s3:::neura-qa-backups/postgres/*`. Sin `s3:DeleteObject` — así ni
siquiera un atacante con shell root en la EC2 puede borrar backups.

**S3 Lifecycle** (`neura-qa-backups`):
- 0-7 días: Standard.
- 7-30 días: Standard-IA.
- 30-365 días: Glacier Flexible Retrieval.
- Object lock: **Governance mode** con `retain-until-date` = ingest + 30 días
  (previene delete accidental).
- Versioning: ON.

### 9.3 Verificación periódica del restore

**Cron semanal** (domingos 04:00):

```bash
#!/bin/bash
set -euo pipefail
BUCKET=neura-qa-backups
LATEST=$(aws s3 ls s3://$BUCKET/postgres/ | sort | tail -1 | awk '{print $4}')
aws s3 cp s3://$BUCKET/postgres/$LATEST /tmp/latest.dump
EXPECTED_SHA=$(aws s3 cp s3://$BUCKET/postgres/$LATEST.sha256 - | awk '{print $1}')
ACTUAL_SHA=$(sha256sum /tmp/latest.dump | awk '{print $1}')
if [ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]; then
  echo "SHA mismatch — backup corrupto" >&2
  exit 1
fi
# Restore a un Postgres secundario en el mismo host para validar
sudo -u postgres createdb qa_center_restore_test
pg_restore --dbname=qa_center_restore_test --no-owner --no-privileges /tmp/latest.dump
sudo -u postgres dropdb qa_center_restore_test
echo "Backup restore test OK: $LATEST"
```

Resultado reportado como métrica Prometheus; alerta si falla.

### 9.4 Retención concreta

| Tipo | Retención |
|---|---|
| Daily dumps (S3 Standard) | 7 días |
| Weekly summaries (S3 Standard-IA) | 30 días |
| Monthly archives (Glacier) | 12 meses |
| Pre-cutover baseline | Indefinido (hasta Fase E aprobada) |

---

## 10. Confirmación: separación NO afecta auth/perms/HMAC

### 10.1 Autenticación de usuario (cookie Supabase)

- **Hoy**: `createSupabaseServerClient()` lee cookie; `getAuthUserForApiRoute()`
  llama `auth.getUser()` contra el endpoint auth de Supabase central.
- **Después de migración**: idéntico. Ni cookie, ni endpoint auth cambian.
- **Verificación**: tests en `tests/qa-center/auth.test.ts` siguen pasando sin
  tocar nada.

### 10.2 Autorización (empresa_modulos + usuario_modulos)

- **Hoy**: `authorize.ts` llama a `resolveQaAccess(sb, email)` que lee las 2
  tablas vía RLS (cookie-scoped).
- **Después**: idéntico. Las 2 tablas siguen viviendo en la DB central. El QA
  Center usa `SUPABASE_DB_URL` (no `QA_DB_URL`) para autorizar.
- **Verificación**: `tests/qa-center/authorize.test.ts` sigue pasando.

### 10.3 HMAC Runner ↔ QA Center

- **Hoy**: runner firma `/api/qa/runner/*` con `QA_RUNNER_SHARED_SECRET`. El
  endpoint valida en `/api/qa/runner-auth.ts` contra el env + chequea nonce
  en `runner_nonces`.
- **Después**: idéntico. `runner_nonces` se migró a EC2 — nonce lookup
  cambia de pool pero el algoritmo HMAC no.
- **Verificación**: `tests/qa-center/hmac.test.ts` 10 tests actuales siguen
  pasando. Smoke D.8 también lo prueba end-to-end.

**Resumen**: ningún campo de los 3 pipelines cambia por la migración. El
único cambio es "a qué Postgres apunta `QA_DB_URL`". Todo lo demás es
idéntico.

---

## 11. Checklist de requisitos para empezar la instalación (lista precisa)

Antes de autorizar Fase B (instalar PG):

### 11.1 Infraestructura de red

- [ ] Cuenta Tailscale creada (o Headscale desplegado).
- [ ] Auth keys one-time generados: 1 para Coolify, 1 para EC2.
- [ ] Hostname estable para EC2 confirmado (p. ej. `qa-ec2`).
- [ ] ACLs Tailscale redactadas (tags `qa-center-client` + `qa-db-server`).

### 11.2 EC2

- [ ] Instancia actual auditada (tipo, RAM, CPU, disco libre).
- [ ] Si tipo < t3.xlarge → plan de upgrade (resize en AWS Console, downtime ~2 min).
- [ ] Volumen EBS verificado ≥50 GB libre para `/var/lib/postgresql`.
- [ ] OS: confirmar Ubuntu 24.04 (ya confirmado por `DEPLOY_AWS_SETUP.md`).

### 11.3 Snapshot

- [ ] Verificar si existe réplica: `SELECT * FROM pg_stat_replication`.
- [ ] Si no existe: ventana de ~5-10 min para dump con snapshot congelado
      agendada fuera de horario pico.
- [ ] Espacio en disco Coolify ≥2 GB temporal para dump.

### 11.4 Backups

- [ ] S3 bucket `neura-qa-backups` creado (o nombre acordado).
- [ ] KMS key alias `alias/neura-qa-backups` creada.
- [ ] IAM role de la EC2 con permisos `s3:PutObject` en el bucket (sin delete).
- [ ] S3 Lifecycle + Versioning + Object Lock configurados.

### 11.5 Observabilidad

- [ ] Stack Prometheus de la Fase 4A (observability/) desplegado y
      operativo. Si no — montar antes del cutover.
- [ ] pg_exporter configurado para scrape del nuevo PG post-instalación.
- [ ] Alertas de la sección 8.6 cargadas.

### 11.6 Comunicaciones / aprobaciones

- [ ] Ventana de cutover acordada con el equipo (fecha, hora, duración ~15 min).
- [ ] Anuncio a usuarios del QA Center (mantenimiento ~15 min).
- [ ] Approval explícito para pausar escrituras temporalmente.

### 11.7 Secretos

- [ ] `QA_CREDENTIALS_ENC_KEY` ya generada y guardada (Fase 1 pendiente aplicar).
      La misma se reusará post-migración — NO cambia.
- [ ] Passwords de `qa_center_api` y `qa_runner` planificadas (generadas con
      `openssl rand -hex 32` en el momento de Fase B, nunca guardadas en git).
- [ ] CA cert para TLS Postgres planificado (Let's Encrypt via DNS01 o
      self-signed con distribución manual a Coolify).

### 11.8 Rollback

- [ ] Script de dump reverso (sección 7.3) preparado y validado localmente.
- [ ] Credenciales psql para la DB central con permisos de INSERT en
      `qa_center.*` disponibles pero NO almacenadas en script (interactive).
- [ ] Plan B documentado si la EC2 Postgres no responde durante Fase C.

### 11.9 Modo mantenimiento del QA Center

- [ ] Middleware que devuelva 503 en escrituras preparado (flag env
      `QA_CENTER_MAINTENANCE=true`). **Pendiente implementar** — es una
      pieza nueva, pequeña, que no existe hoy.
- [ ] Mensaje de error amigable redactado en español.

---

## 12. Restricciones honradas

- ✅ No se instaló Postgres en AWS.
- ✅ No se ejecutaron migraciones.
- ✅ No se modificaron AWS, Coolify ni producción.
- ✅ No hay commit ni push.
- ✅ Todos los datos actuales se preservan (dump completo + incremental +
      rollback bidireccional).
- ✅ Comunicación segura preservada (Tailscale + TLS Postgres + HMAC runner
      sin cambios).

---

## 13. Lo que queda abierto a tu decisión

1. **Tailscale SaaS vs Headscale self-hosted** — preferencia?
2. **Instance type de la EC2** — hacer upgrade antes de Fase B, o usar la
   actual si ya es ≥t3.xlarge? Necesitamos saber el tipo actual.
3. **Nombre del S3 bucket** y cuenta AWS donde vive (misma que la EC2 o
   cuenta separada para blast radius?).
4. **Fecha/hora del cutover** sugerida.
5. **Middleware de mantenimiento**: lo implemento ahora (pequeño flag env que
   el middleware ya existente consulta) o lo dejamos para la ventana de
   cutover?
