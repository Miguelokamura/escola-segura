# debug_db.py — mostra onde o sistema está conectando e o que há lá
import mysql.connector
from config import DB_CONFIG

db = mysql.connector.connect(**DB_CONFIG)
cur = db.cursor()

cur.execute("SELECT DATABASE(), USER(), @@hostname, @@port")
info = cur.fetchone()
print("Banco conectado      :", info[0])
print("Usuário              :", info[1])
print("Servidor (hostname)  :", info[2])
print("Porta                :", info[3])
print("-" * 50)

cur.execute("SHOW TABLES")
print("Tabelas:", [t[0] for t in cur.fetchall()])
print("-" * 50)

cur.execute("SELECT id, nome, matricula, turma, ativo FROM alunos")
rows = cur.fetchall()
print(f"Total de alunos: {len(rows)}")
for r in rows:
    print("  ", r)

cur.close()
db.close()