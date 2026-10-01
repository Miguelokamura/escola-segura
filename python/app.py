# Importação das bibliotecas, banco de dados, API
import io
import uuid
from datetime import date, datetime
from functools import wraps

import mysql.connector
import qrcode
from flask import (Flask, Response, jsonify, redirect, render_template,
                   request, session, url_for)
from werkzeug.security import check_password_hash, generate_password_hash

from config import DB_CONFIG, SECRET_KEY

app = Flask(__name__)
app.secret_key = SECRET_KEY

# ---- Função central para falar com o MySQL ----
def query(sql, params=(), fetch=True, commit=False):
    """Abre conexão, executa o SQL e fecha tudo automaticamente."""
    db = mysql.connector.connect(**DB_CONFIG)
    cur = db.cursor(dictionary=True)  # retorna resultados como dicionário
    cur.execute(sql, params)
    data = cur.fetchall() if fetch else None
    if commit:
        db.commit()  # salva alterações (INSERT/UPDATE/DELETE)
    cur.close()
    db.close()
    return data

# ---- Decorator que protege páginas ----
def login_required(f):
    @wraps(f)
    def wrapper(*a, **kw):
        if "admin" not in session:  # não está logado? -> manda pro login
            return redirect(url_for("login"))
        return f(*a, **kw)
    return wrapper

@app.route("/login", methods=["GET", "POST"])
def login():
    erro = None
    if request.method == "POST":
        rows = query("SELECT * FROM administradores WHERE usuario=%s",
                     (request.form["usuario"],))
        try:
            senha_ok = rows and check_password_hash(
                rows[0]["senha_hash"], request.form["senha"])
        except ValueError:          # hash corrompido/inválido no banco
            senha_ok = False
        if senha_ok:
            session["admin"] = rows[0]["usuario"]
            return redirect(url_for("dashboard"))
        erro = "Usuário ou senha inválidos."
    return render_template("login.html", erro=erro)

@app.route("/logout")
def logout():
    session.pop("admin", None)
    return redirect(url_for("login"))

@app.route("/")
@login_required
def dashboard():
    hoje = date.today()
    stats = {
        "total_alunos": query("SELECT COUNT(*) c FROM alunos")[0]["c"],
        "entradas_hoje": query("SELECT COUNT(*) c FROM registros WHERE "
            "tipo='ENTRADA' AND DATE(data_hora)=%s", (hoje,))[0]["c"],
        "saidas_hoje": query("SELECT COUNT(*) c FROM registros WHERE "
            "tipo='SAIDA' AND DATE(data_hora)=%s", (hoje,))[0]["c"],
        "negados_hoje": query("SELECT COUNT(*) c FROM registros WHERE "
            "status='NEGADO' AND DATE(data_hora)=%s", (hoje,))[0]["c"],
        "atrasos_hoje": query("SELECT COUNT(*) c FROM registros WHERE "
            "status='ATRASADO' AND DATE(data_hora)=%s", (hoje,))[0]["c"],
    }
    ultimos = query("SELECT r.tipo, r.status, a.nome, "
        "DATE_FORMAT(r.data_hora,'%d/%m %H:%i') dh "
        "FROM registros r JOIN alunos a ON a.id=r.aluno_id "
        "ORDER BY r.data_hora DESC LIMIT 10")
    return render_template("dashboard.html", stats=stats, ultimos=ultimos)

@app.route("/alunos")
@login_required
def pagina_alunos():
    return render_template("alunos.html")

@app.route("/scanner")
@login_required
def pagina_scanner():
    return render_template("scanner.html")

@app.route("/registros")
@login_required
def pagina_registros():
    return render_template("registros.html")

@app.route("/api/alunos", methods=["GET", "POST"])
@login_required
def api_alunos():
    if request.method == "POST":                    # CADASTRAR
        d = request.get_json(silent=True) or {}
        nome = d.get("nome", "").strip()
        matricula = d.get("matricula", "").strip()
        turma = d.get("turma", "").strip()
        responsavel = d.get("responsavel", "").strip()
        telefone = d.get("telefone", "").strip()

        if not nome or not matricula:
            return jsonify({"ok": False,
                            "msg": "Preencha o nome e a matrícula."}), 400
        if len(nome) > 120 or len(matricula) > 30 or len(turma) > 60:
            return jsonify({"ok": False,
                            "msg": "Confira o limite de caracteres dos campos."}), 400
        if len(responsavel) > 120 or len(telefone) > 20:
            return jsonify({"ok": False,
                            "msg": "Confira os dados do responsável e telefone."}), 400

        token = uuid.uuid4().hex                    # gera token único do QR
        try:
            query("INSERT INTO alunos (nome, matricula, turma, "
                  "responsavel, telefone, qr_token) VALUES (%s,%s,%s,%s,%s,%s)",
                  (nome, matricula, turma, responsavel, telefone, token),
                  fetch=False, commit=True)
            return jsonify({"ok": True, "msg": "Aluno cadastrado!"}), 201
        except mysql.connector.errors.IntegrityError:
            return jsonify({"ok": False, "msg": "Matrícula já existe."}), 409

    return jsonify(query("SELECT * FROM alunos ORDER BY nome"))  # LISTAR


@app.route("/api/alunos/<int:aid>", methods=["PUT", "DELETE"])
@login_required
def api_aluno_id(aid):
    if request.method == "DELETE":                  # EXCLUIR
        query("DELETE FROM alunos WHERE id=%s", (aid,),
              fetch=False, commit=True)
        return jsonify({"ok": True, "msg": "Aluno removido."})

    d = request.json                                # EDITAR
    try:
        query("UPDATE alunos SET nome=%s, matricula=%s, turma=%s, "
              "responsavel=%s, telefone=%s, ativo=%s WHERE id=%s",
              (d["nome"], d["matricula"], d.get("turma", ""),
               d.get("responsavel", ""), d.get("telefone", ""),
               d.get("ativo", True), aid), fetch=False, commit=True)
        return jsonify({"ok": True, "msg": "Aluno atualizado."})
    except mysql.connector.errors.IntegrityError:
        return jsonify({"ok": False, "msg": "Matrícula duplicada."}), 409


@app.route("/api/alunos/<int:aid>/toggle", methods=["POST"])
@login_required
def api_aluno_toggle(aid):
    """Ativa/desativa o aluno (em vez de excluir)."""
    query("UPDATE alunos SET ativo = NOT ativo WHERE id=%s",
          (aid,), fetch=False, commit=True)
    return jsonify({"ok": True})

@app.route("/api/qrcode/<token>")
@login_required
def api_qrcode(token):
    """Gera a imagem PNG do QR Code."""
    img = qrcode.make(token, box_size=8, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(buf.getvalue(), mimetype="image/png")


@app.route("/api/validar", methods=["POST"])
def api_validar():
    """Recebe o token lido pelo scanner e decide: autoriza ou nega."""
    token = request.json.get("token", "").strip()
    rows = query("SELECT id, nome, ativo FROM alunos WHERE qr_token=%s",
                 (token,))

    if not rows:  # QR desconhecido
        return jsonify({"ok": False, "msg": "❌ QR Code não reconhecido."})

    aluno = rows[0]

    if not aluno["ativo"]:  # aluno desativado
        query("INSERT INTO registros (aluno_id, tipo, metodo, status) "
              "VALUES (%s,'ENTRADA','QRCODE','NEGADO')", (aluno["id"],),
              fetch=False, commit=True)
        return jsonify({"ok": False,
                        "msg": f"⛔ NEGADO — {aluno['nome']} desativado."})

    # Alterna: último registro foi ENTRADA -> agora é SAÍDA (e vice-versa)
    ultimo = query("SELECT tipo FROM registros WHERE aluno_id=%s "
                   "ORDER BY data_hora DESC LIMIT 1", (aluno["id"],))
    tipo = "SAIDA" if ultimo and ultimo[0]["tipo"] == "ENTRADA" else "ENTRADA"

    status, minutos_atraso = "AUTORIZADO", None
    fora_periodo = False
    if tipo == "ENTRADA":
        agora = datetime.now()
        minutos_do_dia = agora.hour * 60 + agora.minute
        if minutos_do_dia > 7 * 60 + 45:
            status = "ATRASADO"
            minutos_atraso = minutos_do_dia - (7 * 60 + 45)
            fora_periodo = minutos_do_dia > 13 * 60 + 30

    query("INSERT INTO registros (aluno_id, tipo, metodo, status, minutos_atraso) "
          "VALUES (%s,%s,'QRCODE',%s,%s)", (aluno["id"], tipo, status, minutos_atraso),
          fetch=False, commit=True)

    if status == "ATRASADO":
        msg = (f"🟠 ENTRADA ATRASADA — {aluno['nome']} — "
               f"{'fora do período' if fora_periodo else f'{minutos_atraso} min de atraso'}")
    else:
        msg = f"🟢 {tipo} AUTORIZADA — {aluno['nome']}"
    return jsonify({"ok": True, "status": status,
                    "minutos_atraso": minutos_atraso, "fora_periodo": fora_periodo,
                    "msg": msg})


@app.route("/api/registros")
@login_required
def api_registros():
    return jsonify(query(
        "SELECT a.nome, a.turma, r.tipo, r.metodo, r.status, r.minutos_atraso, "
        "DATE_FORMAT(r.data_hora,'%d/%m/%Y %H:%i:%s') AS data_hora "
        "FROM registros r JOIN alunos a ON a.id=r.aluno_id "
        "ORDER BY r.data_hora DESC LIMIT 300"))


if __name__ == "__main__":
    # Aceita acesso por localhost e pela rede local, sem depender de um IP fixo.
    app.run(debug=True, host="0.0.0.0")
