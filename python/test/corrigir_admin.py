# -*- coding: utf-8 -*-
"""Redefine a senha do admin gravando um hash válido no banco."""
import mysql.connector
from werkzeug.security import generate_password_hash
from config import DB_CONFIG

SENHA_NOVA = "admin1234"   # ← defina aqui a senha que quiser

db = mysql.connector.connect(**DB_CONFIG)
cur = db.cursor()

hash_novo = generate_password_hash(SENHA_NOVA)
print("Novo hash gerado:")
print(hash_novo)
print()

cur.execute("UPDATE administradores SET senha_hash=%s WHERE usuario=%s",
            (hash_novo, "admin"))

if cur.rowcount == 0:
    # admin não existia -> cria agora
    cur.execute("INSERT INTO administradores (usuario, senha_hash) VALUES (%s,%s)",
                ("admin", hash_novo))
    print("✔ Admin criado!")

db.commit()

# Confirma o que ficou gravado
cur.execute("SELECT usuario, senha_hash FROM administradores")
for usuario, hash_gravado in cur.fetchall():
    print(f"✔ {usuario} -> {hash_gravado}")

cur.close()
db.close()
print(f"\n✅ Pronto! Login: admin | Senha: {SENHA_NOVA}")