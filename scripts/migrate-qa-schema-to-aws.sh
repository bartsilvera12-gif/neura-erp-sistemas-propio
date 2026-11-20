#!/usr/bin/env bash
# =============================================================================
# NEURA QA — migrar schema qa_center de la base central (Coolify) a neura_qa (AWS).
# · Snapshot CONSISTENTE con pg_export_snapshot() dentro de REPEATABLE READ.
# · Sin bloquear escrituras: lecturas congeladas desde el snapshot.
# · pg_restore con TOC-filter: NO restaura las 7 FKs a auth.users.
# · Conserva proyectos, suites, resultados, hallazgos, credenciales, ejecuciones.
# · NO borra el schema original de Coolify.
# · Baseline de counts dentro de la misma transacción para verificación post-restore.
#
# Precondiciones (verificar con ec2-install-deps.sh o manualmente):
#   · pg_dump + pg_restore 16
#   · python3 con `psycopg` >=3 (pip install 'psycopg[binary]')
#
# Uso:
#   SRC_DSN='postgresql://postgres:***@coolify-host:5432/postgres?sslmode=require' \
#   DST_DSN='postgresql://postgres:***@100.X.X.X:5432/neura_qa?sslmode=verify-full' \
#   bash migrate-qa-schema-to-aws.sh
#
# Dry-run (NO escribe en destino, solo lista TOC y mide counts):
#   DRY_RUN=1 SRC_DSN=... DST_DSN=... bash migrate-qa-schema-to-aws.sh
#
# Secretos: NO poner contraseñas en args. Usar DSN via env.
# =============================================================================
set -euo pipefail
: "${SRC_DSN:?Exportá SRC_DSN con la base central de Coolify}"
: "${DST_DSN:?Exportá DST_DSN con neura_qa en AWS}"
DRY_RUN="${DRY_RUN:-0}"

WORKDIR="${WORKDIR:-/tmp/neura-qa-migration-$(date +%s)}"
mkdir -p "${WORKDIR}"
DUMP_DIR="${WORKDIR}/qa_center.dump.d"
TOC_FULL="${WORKDIR}/full.toc"
TOC_FILT="${WORKDIR}/filtered.toc"
BASELINE="${WORKDIR}/baseline.txt"

echo "===> workdir: ${WORKDIR}  dry_run=${DRY_RUN}"

command -v pg_dump    >/dev/null || { echo "ERROR: pg_dump requerido." >&2; exit 2; }
command -v pg_restore >/dev/null || { echo "ERROR: pg_restore requerido." >&2; exit 2; }
# Elegir intérprete python que tenga psycopg disponible. Primero el del sistema,
# después el venv neura-qa (/opt/neura-qa-venv) que crea ec2-install-deps.sh.
PY=""
for cand in python3 /opt/neura-qa-venv/bin/python3 python3-neura-qa; do
  if command -v "$cand" >/dev/null && "$cand" -c "import psycopg" 2>/dev/null; then
    PY="$cand"; break
  fi
done
[[ -n "${PY}" ]] || { echo "ERROR: ningún python3 tiene psycopg. Correr ec2-install-deps.sh." >&2; exit 2; }
echo "  usando intérprete: ${PY}"

echo "[1/6] Abriendo snapshot REPEATABLE READ en origen + baseline + pg_dump…"
# Un único proceso python mantiene la transacción abierta en el origen
# mientras lanza pg_dump --snapshot=<id>. Al terminar, COMMIT y cierra.
"${PY}" - "$SRC_DSN" "$DUMP_DIR" "$BASELINE" "$DRY_RUN" <<'PY'
import os, sys, subprocess
import psycopg

src_dsn, dump_dir, baseline_path, dry_run_flag = sys.argv[1:5]
dry_run = (dry_run_flag == "1")

conn = psycopg.connect(src_dsn, autocommit=False)
cur  = conn.cursor()
try:
    cur.execute("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ")
    cur.execute("SELECT pg_export_snapshot()")
    snap = cur.fetchone()[0]

    # baseline counts dentro del snapshot (vista consistente)
    cur.execute("""
      SELECT 'projects',    count(*) FROM qa_center.projects
      UNION ALL SELECT 'suites',      count(*) FROM qa_center.suites
      UNION ALL SELECT 'runs',        count(*) FROM qa_center.runs
      UNION ALL SELECT 'findings',    count(*) FROM qa_center.findings
      UNION ALL SELECT 'credentials', count(*) FROM qa_center.project_credentials
    """)
    rows = cur.fetchall()
    with open(baseline_path, "w") as f:
        for name, n in rows:
            f.write(f"{name} {n}\n")
    print(f"SNAPSHOT_ID={snap}", flush=True)

    if dry_run:
        print("DRY_RUN=1 — se salta pg_dump y pg_restore.")
    else:
        cmd = [
            "pg_dump", "--format=directory", "--jobs=4", "--no-sync",
            "--no-owner", "--no-privileges",
            "--schema=qa_center", "--schema=extensions",
            f"--snapshot={snap}",
            "--file", dump_dir,
            src_dsn,
        ]
        r = subprocess.run(cmd)
        if r.returncode != 0:
            raise SystemExit(r.returncode)

    cur.execute("COMMIT")
finally:
    conn.close()
PY

echo "[2/6] Baseline (counts en origen, consistentes con snapshot):"
cat "${BASELINE}"

if [[ "${DRY_RUN}" == "1" ]]; then
  echo "[dry-run] Validando conectividad al destino sin escribir…"
  psql "${DST_DSN}" -v ON_ERROR_STOP=1 -X -q -tAc "SELECT current_database(), current_user, version()" \
    || { echo "ERROR: no se puede conectar al destino"; exit 3; }
  echo "[dry-run] OK. Nada se escribió. Baseline en ${BASELINE}."
  exit 0
fi

echo "[3/6] Generando TOC y filtrando FKs a auth.users…"
pg_restore --list "${DUMP_DIR}" > "${TOC_FULL}"
grep -vE 'FK CONSTRAINT.*auth\.users|owner_user_id_fkey|triggered_by_user_id_fkey|created_by_fkey|updated_by_fkey|reviewer_id_fkey|assigned_to_fkey|actor_id_fkey' \
  "${TOC_FULL}" > "${TOC_FILT}"
echo "  FKs filtradas: $(( $(wc -l < "${TOC_FULL}") - $(wc -l < "${TOC_FILT}") ))"

echo "[4/6] pg_restore a destino neura_qa (sin owner, sin privileges)…"
pg_restore \
  --no-owner --no-privileges \
  --exit-on-error \
  --use-list="${TOC_FILT}" \
  --dbname="${DST_DSN}" \
  "${DUMP_DIR}"

echo "[5/6] Verificando counts en destino…"
FAIL=0
while read -r name n; do
  # `credentials` en baseline corresponde a la tabla project_credentials.
  TBL="${name}"
  [[ "${name}" == "credentials" ]] && TBL="project_credentials"
  REST="$(psql "${DST_DSN}" -tAc "SELECT count(*) FROM qa_center.${TBL}" 2>/dev/null || echo 0)"
  echo "  ${name}: src=${n}  dst=${REST}"
  [[ "${n}" == "${REST}" ]] || FAIL=1
done < "${BASELINE}"

echo "[6/6] Chequeando que NO queden FKs a auth.users en destino…"
RES="$(psql "${DST_DSN}" -tAc "
  SELECT count(*) FROM information_schema.constraint_column_usage ccu
   JOIN information_schema.table_constraints tc
     ON tc.constraint_name=ccu.constraint_name
  WHERE tc.constraint_type='FOREIGN KEY'
    AND ccu.table_schema='auth' AND ccu.table_name='users'")"
echo "  FKs residuales a auth.users: ${RES}"
[[ "${RES}" == "0" ]] || FAIL=1

[[ ${FAIL} -eq 0 ]] || { echo "MIGRACIÓN FALLÓ (counts o FKs)" >&2; exit 3; }
echo "OK — qa_center migrado. Origen NO fue modificado."
