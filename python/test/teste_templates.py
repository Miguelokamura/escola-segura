# teste_templates.py — pode apagar depois
import os
from flask import Flask

app = Flask(__name__)

pasta = os.path.join(app.root_path, "templates")
print("O Flask procura templates em:", pasta)
print("Essa pasta existe?", "SIM ✅" if os.path.exists(pasta) else "NÃO ❌")
print("-" * 60)

for t in ["base.html", "login.html", "dashboard.html",
          "alunos.html", "scanner.html", "registros.html"]:
    try:
        tpl = app.jinja_env.get_template(t)
        print(f"✅ {t} encontrado -> {tpl.filename}")
    except Exception:
        print(f"❌ {t} NÃO encontrado")

print("-" * 60)
print("Arquivos que existem de verdade nessa pasta:")
if os.path.exists(pasta):
    for item in os.listdir(pasta):
        print("   ", item)
else:
    print("    (pasta templates não existe!)")