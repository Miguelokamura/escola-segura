import base64
import binascii
import os
from pathlib import Path
import re
import tempfile

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env", override=False)

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "127.0.0.1"),
    "port": int(os.getenv("DB_PORT", "3306")),
    "user": os.getenv("DB_USER", "root"),
    "password": os.getenv("DB_PASSWORD", ""),
    "database": os.getenv("DB_NAME", "escola_segura"),
    "charset": "utf8mb4",
}

db_host = DB_CONFIG["host"]
dns_label_pattern = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$")
if (len(db_host) > 253 or not db_host or
        any(not dns_label_pattern.fullmatch(label) for label in db_host.rstrip(".").split("."))):
    raise ValueError(
        "DB_HOST inválido. Informe somente o hostname do MySQL no Aiven "
        "(sem https://, porta, caminho ou conteúdo do certificado CA)."
    )

DB_SSL_CA = os.getenv("DB_SSL_CA", "").strip()
if DB_SSL_CA and not Path(DB_SSL_CA).is_absolute():
    DB_SSL_CA = str((PROJECT_ROOT / DB_SSL_CA).resolve())
DB_SSL_CA_B64 = os.getenv("DB_SSL_CA_B64", "").strip()
if DB_SSL_CA_B64:
    try:
        ca_contents = base64.b64decode("".join(DB_SSL_CA_B64.split()), validate=True)
    except binascii.Error as error:
        raise ValueError("DB_SSL_CA_B64 precisa conter um certificado CA em Base64 válido.") from error
    if not ca_contents.startswith(b"-----") or b"\n" not in ca_contents:
        raise ValueError("DB_SSL_CA_B64 não decodifica para um arquivo PEM válido.")
    with tempfile.NamedTemporaryFile(prefix="escola-segura-ca-", suffix=".pem", delete=False) as ca_file:
        ca_file.write(ca_contents)
    os.chmod(ca_file.name, 0o600)
    DB_SSL_CA = ca_file.name

if DB_SSL_CA:
    DB_CONFIG.update({
        "ssl_ca": DB_SSL_CA,
        "ssl_verify_cert": True,
        "ssl_verify_identity": True,
    })

SECRET_KEY = os.getenv("SECRET_KEY", "default_secret_key")