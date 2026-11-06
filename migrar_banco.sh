#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  printf 'Arquivo .env não encontrado: %s\n' "$ENV_FILE" >&2
  exit 1
fi

unset LOCAL_DB_HOST LOCAL_DB_PORT LOCAL_DB_USER LOCAL_DB_PASSWORD LOCAL_DB_NAME
unset DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME DB_SSL_CA
set -a
source "$ENV_FILE"
set +a

for name in LOCAL_DB_HOST LOCAL_DB_PORT LOCAL_DB_USER LOCAL_DB_PASSWORD LOCAL_DB_NAME \
  DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME DB_SSL_CA; do
  if [[ ! -v $name ]] || [[ -z "${!name}" ]]; then
    printf 'variável %s não definida no .env\n' "$name" >&2
    exit 1
  fi
done

SOURCE_DB_HOST="$LOCAL_DB_HOST"
SOURCE_DB_PORT="$LOCAL_DB_PORT"
SOURCE_DB_USER="$LOCAL_DB_USER"
SOURCE_DB_PASSWORD="$LOCAL_DB_PASSWORD"
SOURCE_DB_NAME="$LOCAL_DB_NAME"
AIVEN_DB_HOST="$DB_HOST"
AIVEN_DB_PORT="$DB_PORT"
AIVEN_DB_USER="$DB_USER"
AIVEN_DB_PASSWORD="$DB_PASSWORD"
AIVEN_DB_NAME="$DB_NAME"
AIVEN_CA="$DB_SSL_CA"

if [[ ! "$SOURCE_DB_NAME" =~ ^[A-Za-z0-9_]+$ || ! "$AIVEN_DB_NAME" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "Os nomes dos bancos podem conter apenas letras, números e sublinhados." >&2
  exit 1
fi

case "$AIVEN_CA" in
  /*) ;;
  * ) AIVEN_CA="$SCRIPT_DIR/$AIVEN_CA" ;;
esac
if [[ ! -f "$AIVEN_CA" ]]; then
  printf 'Certificado CA não encontrado: %s (verifique DB_SSL_CA no .env).\n' "$AIVEN_CA" >&2
  exit 1
fi

for utility in mysql mysqldump; do
  command -v "$utility" >/dev/null || {
    printf 'Utilitário necessário não encontrado no PATH: %s\n' "$utility" >&2
    exit 1
  }
done

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
LOCAL_DEFAULTS="$TMP_DIR/local.cnf"
AIVEN_DEFAULTS="$TMP_DIR/aiven.cnf"

quote_option() {
  local value="${1//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  printf '"%s"' "$value"
}

write_defaults() {
  local file="$1" host="$2" port="$3" user="$4" password="$5"
  {
    printf '[client]\n'
    printf 'host=%s\n' "$(quote_option "$host")"
    printf 'port=%s\n' "$(quote_option "$port")"
    printf 'user=%s\n' "$(quote_option "$user")"
    printf 'password=%s\n' "$(quote_option "$password")"
  } > "$file"
  chmod 600 "$file"
}

write_defaults "$LOCAL_DEFAULTS" "$SOURCE_DB_HOST" "$SOURCE_DB_PORT" "$SOURCE_DB_USER" "$SOURCE_DB_PASSWORD"
write_defaults "$AIVEN_DEFAULTS" "$AIVEN_DB_HOST" "$AIVEN_DB_PORT" "$AIVEN_DB_USER" "$AIVEN_DB_PASSWORD"

mysql_local() {
  mysql --defaults-extra-file="$LOCAL_DEFAULTS" --batch --skip-column-names "$SOURCE_DB_NAME" "$@"
}
mysql_aiven() {
  mysql --defaults-extra-file="$AIVEN_DEFAULTS" --ssl-mode=VERIFY_CA --ssl-ca="$AIVEN_CA" \
    --batch --skip-column-names "$AIVEN_DB_NAME" "$@"
}

echo "Conferindo conexão e banco local..."
mysql_local -e "SELECT 1" >/dev/null
echo "Conferindo conexão TLS e banco Aiven..."
mysql_aiven -e "SELECT 1" >/dev/null

TARGET_TABLES="$(mysql_aiven -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE'")"
if [[ "$TARGET_TABLES" != "0" ]]; then
  echo "O banco Aiven já contém tabelas. A migração foi interrompida para evitar sobrescrever dados." >&2
  exit 1
fi

EVENT_ID_COLUMN="$(mysql_local -e "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='registros' AND column_name='arduino_event_id'")"
if [[ "$EVENT_ID_COLUMN" == "0" ]]; then
  echo "Preparando coluna de idempotência para reenvios do Arduino..."
  mysql_local -e "ALTER TABLE registros ADD COLUMN arduino_event_id VARCHAR(64) NULL UNIQUE AFTER justificativa"
fi

echo "Capturando contagens de origem antes da migração..."
mapfile -t TABLES < <(mysql_local -e "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE' ORDER BY table_name")
if [[ "${#TABLES[@]}" -eq 0 ]]; then
  echo "Nenhuma tabela foi encontrada no banco local." >&2
  exit 1
fi

declare -A LOCAL_COUNTS=()
for table in "${TABLES[@]}"; do
  if [[ ! "$table" =~ ^[A-Za-z0-9_]+$ ]]; then
    printf 'Nome de tabela não esperado: %s\n' "$table" >&2
    exit 1
  fi
  LOCAL_COUNTS["$table"]="$(mysql_local -e "SELECT COUNT(*) FROM \`$table\`")"
done

echo "Exportando e importando os dados..."
mysqldump --defaults-extra-file="$LOCAL_DEFAULTS" --single-transaction --skip-lock-tables \
  --hex-blob --no-tablespaces --set-gtid-purged=OFF "$SOURCE_DB_NAME" |
  mysql --defaults-extra-file="$AIVEN_DEFAULTS" --ssl-mode=VERIFY_CA --ssl-ca="$AIVEN_CA" "$AIVEN_DB_NAME"

echo "Comparando contagens de linhas antes/depois..."
FAILED=0
for table in "${TABLES[@]}"; do
  LOCAL_COUNT="${LOCAL_COUNTS[$table]}"
  AIVEN_COUNT="$(mysql_aiven -e "SELECT COUNT(*) FROM \`$table\`")"
  printf '%-28s antes=%-10s depois=%s\n' "$table" "$LOCAL_COUNT" "$AIVEN_COUNT"
  if [[ "$LOCAL_COUNT" != "$AIVEN_COUNT" ]]; then
    FAILED=1
  fi
done

if [[ "$FAILED" -ne 0 ]]; then
  echo "As contagens diferem. Não altere a aplicação para usar Aiven até investigar o resultado." >&2
  exit 1
fi
echo "Migração concluída: as contagens de todas as tabelas coincidem."
