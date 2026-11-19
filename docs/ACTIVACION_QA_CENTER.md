# ACTIVACIÓN — NEURA QA CENTER punta a punta

Todo lo automatizable está en scripts del repo. Esto NO es una lista de 30 comandos: es la lista mínima de **accesos** y **aprobaciones** que solo podés dar vos.

---

## A. Secretos a cargar (una sola vez, por sistema)

### A.1 GitHub → repo `bartsilvera12-gif/qa-runner` → Settings → Secrets

| Nombre | Valor | Dónde se usa |
|---|---|---|
| `AWS_EC2_HOST` | `18.229.210.206` | `.github/workflows/deploy-aws.yml` |
| `AWS_EC2_SSH_PORT` | `22` (o el real) | idem |
| `AWS_EC2_SSH_KEY` | contenido de la clave privada que accede a `ubuntu@18.229.210.206` | idem |

**Environment `aws-ec2`** (Settings → Environments): agregar required reviewers (vos) y branch rule `main`. El workflow ya referencia este environment.

### A.2 GitHub → repo `bartsilvera12-gif/neura-erp-sistemas-propio` → Secrets

(Si todavía no tenía estos; el gate ya corre.)

Nada nuevo obligatorio: el QA Center se despliega en Coolify, no por Actions.

### A.3 EC2 `18.229.210.206` — archivos de config (correr una sola vez, como root)

Crear estos dos archivos con el contenido que te paso. Después todo se automatiza.

```bash
# /etc/neura-qa/pg-roles.env  (chmod 600, owner root:root)
QA_CENTER_API_PASSWORD=<generar: openssl rand -base64 32>
QA_RUNNER_PASSWORD=<generar: openssl rand -base64 32>
TAILSCALE_COOLIFY_IP=<se llena tras conectar Coolify a Tailscale>
```

```bash
# /etc/neura-qa/backup.env  (chmod 600, owner ubuntu:ubuntu)
S3_BUCKET=neura-qa-backups
S3_PREFIX=neura_qa/daily
AWS_DEFAULT_REGION=sa-east-1
KMS_KEY_ID=alias/neura-qa-backups
```

**No dupliques estos secretos en Git.** El IAM role del host provee las credenciales AWS.

### A.4 Coolify → app QA Center → Environment variables

| Nombre | Valor | Notas |
|---|---|---|
| `QA_DB_URL` | `postgresql://qa_center_api:<QA_CENTER_API_PASSWORD>@<TAILSCALE_EC2_IP>:5432/neura_qa?sslmode=verify-full` | el IP tailscale del EC2 (100.X.X.X), **no** la EIP pública |
| `QA_CREDENTIALS_ENC_KEY` | `openssl rand -base64 48` | clave para `pgp_sym_encrypt` de credenciales ERP |
| `QA_CENTER_MAINTENANCE` | `false` (dejar vacío o false) | flip a `true` solo durante cutover |

### A.5 EC2 Runner — actualizar `/home/ubuntu/qa-runner/.env` (manual, puntual)

Agregar/actualizar estas líneas en el .env existente (sin tocar las demás):

```
QA_DB_URL=postgresql://qa_runner:<QA_RUNNER_PASSWORD>@127.0.0.1:5432/neura_qa?sslmode=require
QA_CENTER_API_BASE=https://<dominio-coolify-qa-center>
```

---

## B. AWS — recursos a crear (una sola vez)

1. **IAM Role** `neura-qa-ec2-backup` con policy mínima (ver `qa-runner/scripts/s3-bucket-policy.json` → `AllowEC2BackupRoleWriteOnly`). Attach al InstanceProfile del EC2.
2. **KMS key** alias `neura-qa-backups` en sa-east-1. Habilita a la role anterior.
3. **S3 bucket** `neura-qa-backups` (sa-east-1) con:
   - Object Lock = Governance 7 días (comando en `s3-bucket-policy.json._object_lock_setup`).
   - Bucket policy = la del JSON (reemplazando `<ACCOUNT>` y `<BUCKET>`).
   - Lifecycle = el bloque `_lifecycle_json_separate_api_call`.
4. **Tailscale** — 2 auth keys con tag:
   - `tag:qa-db-server` → se usa en `ec2-tailscale-setup.sh`.
   - `tag:qa-center-client` → se usa al conectar Coolify.

---

## C. Órden de ejecución (una sola vez, 1 ventana de cutover)

Todo lo que sigue corre vía scripts; no hay que copiar comandos uno a uno.

| # | Paso | Cómo se corre | Requiere aprobación tuya |
|---|---|---|---|
| 1 | Instalar Tailscale en EC2 | `ssh ubuntu@EC2 "sudo TS_AUTHKEY=... bash /home/ubuntu/qa-runner/scripts/ec2-tailscale-setup.sh"` | — |
| 2 | Instalar Tailscale en Coolify (lo imprime el script del paso 1) | copiar/pegar las 3 líneas que imprime | — |
| 3 | Escribir `TAILSCALE_COOLIFY_IP` en `/etc/neura-qa/pg-roles.env` | `echo TAILSCALE_COOLIFY_IP=100.X.X.X | sudo tee -a /etc/neura-qa/pg-roles.env` | — |
| 4 | Roles + pg_hba + listen_addresses | `sudo bash /home/ubuntu/qa-runner/scripts/ec2-postgres-setup.sh` | — |
| 5 | **Activar modo mantenimiento** en QA Center | Coolify → set `QA_CENTER_MAINTENANCE=true` → redeploy | **sí, una aprobación** |
| 6 | Migrar `qa_center` de Coolify a AWS | `SRC_DSN=... DST_DSN=... bash sistemas-propio/scripts/migrate-qa-schema-to-aws.sh` | — |
| 7 | Aplicar las 3 migraciones Fase 1 en neura_qa | `DST_DSN=... MIGRATIONS_DIR=... bash qa-runner/scripts/ec2-apply-phase1-migrations.sh` | — |
| 8 | Cargar `QA_DB_URL`, `QA_CREDENTIALS_ENC_KEY` en Coolify | UI Coolify → env vars | — |
| 9 | **Desactivar mantenimiento** y smoke | `QA_CENTER_MAINTENANCE=false` → redeploy → curl /api/qa/health | **sí, una aprobación** |
| 10 | Instalar cron de backup + restore test | `sudo cp qa-runner/systemd/neura-qa-backup.timer ...` (ver abajo) | — |
| 11 | Primer deploy del Runner con nueva arquitectura | GitHub Actions → `deploy-aws` → input `DEPLOY` → environment `aws-ec2` approval | **sí, una aprobación** |

Las aprobaciones del paso 5, 9 y 11 pueden ir en una sola ventana coordinada.

**Rollback**: si el smoke del paso 9 falla, el flag `QA_CENTER_MAINTENANCE` vuelve a `true`, `QA_DB_URL` se apunta de vuelta al Coolify central. El script `migrate-qa-schema-to-aws.sh` NO borra el schema original de Coolify, así que el rollback es volver a la config previa. Ningún registro se pierde porque durante el paso 6→8 las escrituras están bloqueadas por el 503.

---

## D. Qué NO se toca (garantías de seguridad)

- `qa_center` original en Coolify queda **intacto**. El script migra, no mueve.
- Otros schemas del ERP (`public`, `mevovendedores`, `mevoerp`, `auth`, etc.) **no se tocan**.
- `/home/ubuntu/qa-runner/.env` se preserva en cada deploy del Runner (el workflow ya hace backup con timestamp).
- Ningún secreto pasa por logs ni por el repo. Los `/etc/neura-qa/*.env` son 600 root:root o 600 ubuntu:ubuntu.
- El agente solo escribe contra el QA Fixture App — nunca contra sistemas reales.
- 5432 nunca se expone en Internet: `pg_hba` solo acepta 127.0.0.1 + `TAILSCALE_COOLIFY_IP/32`.

---

## E. Bloqueos concretos que podrían aparecer (los que necesito que mires)

1. **SSH key para `ubuntu@18.229.210.206`** — ¿la tenés en password manager? El workflow ya la referencia como secret `AWS_EC2_SSH_KEY`.
2. **IAM/KMS/S3 setup** — necesito saber la cuenta AWS. Si querés, te preparo también un script Terraform o un `aws cli` idempotente para los 3 recursos, pero necesito saber qué cuenta usar.
3. **Admin Tailscale** — la ACL JSON del paso 1 se aplica manualmente en el admin console. ¿Preferís Tailscale SaaS o Headscale self-hosted? (El script actual asume SaaS; para Headscale cambia solo la URL del coord.)
4. **Dominio Coolify del QA Center** — necesito el valor para `QA_CENTER_API_BASE` en el .env del Runner.

Dame los 4 valores y arranco el cutover. Hasta ese momento **nada se ejecuta contra AWS, Coolify o GitHub**.
