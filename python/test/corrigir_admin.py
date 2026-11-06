# -*- coding: utf-8 -*-
"""Redefine a senha do admin gravando um hash válido no banco."""
from getpass import getpass

import mysql.connector
from werkzeug.security import generate_password_hash
from config import DB_CONFIG

USUARIO = input("Usuário do administrador: ").strip()
SENHA_NOVA = getpass("Nova senha: ")
if not USUARIO or not SENHA_NOVA:
    raise SystemExit("Usuário e senha são obrigatórios.")

db = mysql.connector.connect(**DB_CONFIG)
cur = db.cursor()

hash_novo = generate_password_hash(SENHA_NOVA)
try:
    cur.execute("UPDATE administradores SET senha_hash=%s WHERE usuario=%s",
                (hash_novo, USUARIO))
    if cur.rowcount == 0:
        cur.execute("INSERT INTO administradores (usuario, senha_hash) VALUES (%s,%s)",
                    (USUARIO, hash_novo))
    db.commit()
    print("Senha do administrador atualizada.")
except Exception:
    db.rollback()
    raise
finally:
    cur.close()
    db.close()