#!/usr/bin/env bash
# =============================================================================
# set-build-server.sh — deja UNA app de Coolify compilando en el BUILD SERVER
# (no en produccion). Setea los 2 campos que lo definen:
#   * application_settings.is_build_server_enabled = true
#   * applications.docker_registry_image_name      = registry.neura.internal:5000/<repo>
#
# POR QUE: si una app queda con "Builder selection = Deployment server" o sin
# registry, Coolify la COMPILA en neura-coolify (produccion) y le clava el CPU a
# TODAS las apps en cada deploy. Este script la deja como las que andan bien
# (molde: neura-erp-dyma), sin tener que tocar SQL a mano.
#
# DONDE SE CORRE: en el host de Coolify (neura-coolify), donde vive el contenedor
# `coolify-db`. Con permisos de docker (usa sudo solo si hace falta).
#
#   ./set-build-server.sh <nombre-o-uuid-de-la-app>             # aplica
#   ./set-build-server.sh <nombre-o-uuid-de-la-app> --dry-run   # solo muestra el plan
#
# EJEMPLO (el nombre es solo de muestra: poné el de la app que necesites arreglar):
#   ./set-build-server.sh neura-erp-amigosdelaruta --dry-run
#
# Idempotente (se puede correr de nuevo). Toca SOLO esos 2 campos. Antes de
# cambiar nada deja un backup en la tabla `_buildsrv_bkp` (uuid + valores viejos).
# El cambio surte efecto en el PROXIMO deploy de la app.
# =============================================================================
set -euo pipefail

APP="${1:-}"
DRY=0
[ "${2:-}" = "--dry-run" ] && DRY=1
if [ -z "$APP" ]; then
  echo "uso: $0 <nombre-o-uuid-de-la-app> [--dry-run]" >&2
  exit 1
fi
# Entrada controlada: nombre de app o uuid de Coolify.
if ! printf '%s' "$APP" | grep -qE '^[A-Za-z0-9._-]+$'; then
  echo "ERROR: nombre/uuid invalido: $APP" >&2
  exit 1
fi

REG="registry.neura.internal:5000"

# docker con o sin sudo, segun permisos.
DOCKER="docker"
if ! $DOCKER ps >/dev/null 2>&1; then DOCKER="sudo docker"; fi

DBPASS="$($DOCKER exec coolify-db printenv POSTGRES_PASSWORD 2>/dev/null || true)"
q() { $DOCKER exec -i -e PGPASSWORD="$DBPASS" coolify-db psql -U coolify -d coolify -At -F'|' -c "$1"; }

# --- Buscar la app: uuid exacto, nombre exacto, o nombre parcial ----------------
MATCHES="$(q "select a.uuid || '|' || a.name || '|' || coalesce(a.git_repository,'')
  from applications a
  where a.uuid = '$APP' or lower(a.name) = lower('$APP') or a.name ilike '%$APP%'
  order by (a.uuid = '$APP') desc, (lower(a.name)=lower('$APP')) desc
  limit 10")"

if [ -z "$MATCHES" ]; then
  echo "No encontre ninguna app que matchee: $APP" >&2
  exit 1
fi
N=$(printf '%s\n' "$MATCHES" | grep -c .)
# Si hay exacto (uuid o nombre), nos quedamos con ese; si no y hay >1, listamos y abortamos.
EXACT="$(printf '%s\n' "$MATCHES" | awk -F'|' -v a="$APP" 'tolower($1)==tolower(a) || tolower($2)==tolower(a){print; exit}')"
if [ -n "$EXACT" ]; then
  SEL="$EXACT"
elif [ "$N" -gt 1 ]; then
  echo "Hay $N apps que matchean '$APP'. Precisá el nombre exacto o el uuid:" >&2
  printf '%s\n' "$MATCHES" | awk -F'|' '{printf "  - %-40s (%s)\n", $2, $1}' >&2
  exit 1
else
  SEL="$MATCHES"
fi

UUID="$(printf '%s' "$SEL" | cut -d'|' -f1)"
NAME="$(printf '%s' "$SEL" | cut -d'|' -f2)"
REPO="$(printf '%s' "$SEL" | cut -d'|' -f3)"

# --- Nombre de imagen: basename del repo, minusculas, sin separador final -------
# (mismo criterio que migrar_app_v2.sh). Si no hay repo, usa el nombre de la app.
SRC="${REPO:-$NAME}"
BASE="$(basename "$SRC" | tr '[:upper:]' '[:lower:]' | sed -E 's/[-._]+$//')"
IMG="$REG/$BASE"

# --- Estado actual --------------------------------------------------------------
CUR="$(q "select s.is_build_server_enabled || '|' || coalesce(a.docker_registry_image_name,'(vacio)')
  from applications a join application_settings s on s.application_id = a.id
  where a.uuid = '$UUID'")"
CUR_BLD="$(printf '%s' "$CUR" | cut -d'|' -f1)"
CUR_IMG="$(printf '%s' "$CUR" | cut -d'|' -f2)"

echo "App:            $NAME  ($UUID)"
echo "Repo:           ${REPO:-(sin repo, uso el nombre)}"
echo "build server:   $CUR_BLD   ->  t"
echo "registry image: $CUR_IMG   ->  $IMG"

if [ "$CUR_BLD" = "t" ] && [ "$CUR_IMG" = "$IMG" ]; then
  echo "Ya estaba bien configurada. Nada que hacer."
  exit 0
fi

if [ "$DRY" = "1" ]; then
  echo "(--dry-run: no cambie nada)"
  exit 0
fi

# --- Backup + update (transaccion) ---------------------------------------------
q "begin;
   create table if not exists _buildsrv_bkp (uuid text, name text, docker_registry_image_name text, is_build_server_enabled boolean, backed_at timestamptz default now());
   insert into _buildsrv_bkp (uuid, name, docker_registry_image_name, is_build_server_enabled)
     select a.uuid, a.name, a.docker_registry_image_name, s.is_build_server_enabled
     from applications a join application_settings s on s.application_id=a.id where a.uuid='$UUID';
   update application_settings s set is_build_server_enabled = true
     from applications a where a.id = s.application_id and a.uuid = '$UUID';
   update applications set docker_registry_image_name = '$IMG' where uuid = '$UUID';
   commit;" >/dev/null

echo "OK. Listo: compila en el build server y pushea a $IMG."
echo "Hace el redeploy de la app para que tome el cambio (recien ahi compila en el build server)."
