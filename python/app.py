# Importação das bibliotecas, banco de dados, API
import io
import os
import uuid
from datetime import date, datetime
from functools import wraps

import mysql.connector
import qrcode
from flask import (Flask, Response, abort, jsonify, redirect, render_template,
                   request, session, url_for)
from flask_cors import CORS
from werkzeug.security import check_password_hash, generate_password_hash

from config import DB_CONFIG, SECRET_KEY

app = Flask(__name__)
CORS_ORIGINS = [origem.strip() for origem in
                os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
                if origem.strip()]
CORS(app, resources={r"/api/*": {"origins": CORS_ORIGINS}})
if not SECRET_KEY:
    raise RuntimeError("Defina SECRET_KEY no ambiente antes de iniciar o Flask.")
app.secret_key = SECRET_KEY

@app.get("/ping")
def ping():
    return jsonify({"ok": True})

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
        if "admin" not in session:
            return redirect(url_for("login"))
        return f(*a, **kw)
    return wrapper

def professor_required(f):
    @wraps(f)
    def wrapper(*a, **kw):
        if "professor" not in session:
            return jsonify({"ok": False, "msg": "Acesso restrito a professores."}), 403
        perfil = query(
            "SELECT ativo FROM professores WHERE id=%s",
            (session["professor"]["id"],))
        if not perfil or not perfil[0]["ativo"]:
            session.pop("professor", None)
            return jsonify({"ok": False,
                            "msg": "Este perfil de professor está desativado."}), 403
        return f(*a, **kw)
    return wrapper

@app.route("/login", methods=["GET", "POST"])
def login():
    if session.get("admin"):
        return redirect(url_for("dashboard"))
    if session.get("professor"):
        return redirect(url_for("pagina_professor"))
    erro = None
    if request.method == "POST":
        usuario = request.form.get("usuario", "").strip()
        senha = request.form.get("senha", "")
        rows = query("SELECT * FROM administradores WHERE usuario=%s", (usuario,))
        try:
            senha_ok = rows and check_password_hash(rows[0]["senha_hash"], senha)
        except ValueError:          # hash corrompido/inválido no banco
            senha_ok = False
        if senha_ok:
            session["admin"] = rows[0]["usuario"]
            return redirect(url_for("dashboard"))
        professores = query(
            "SELECT id, nome, usuario, senha_hash FROM professores "
            "WHERE usuario=%s AND ativo=TRUE", (usuario,))
        try:
            professor_ok = professores and check_password_hash(
                professores[0]["senha_hash"], senha)
        except ValueError:
            professor_ok = False
        if professor_ok:
            session["professor"] = {
                "id": professores[0]["id"],
                "nome": professores[0]["nome"],
                "usuario": professores[0]["usuario"],
            }
            return redirect(url_for("pagina_professor"))
        erro = "Usuário ou senha inválidos."
    return render_template("login.html", erro=erro)

@app.route("/logout")
def logout():
    session.pop("admin", None)
    session.pop("professor", None)
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
    return render_template("registros.html", tipo=request.args.get("tipo", "TODOS"),
                           status=request.args.get("status", "TODOS"))

@app.route("/professores", methods=["GET", "POST"])
@login_required
def pagina_professores():
    erro = None
    sucesso = ("Perfil do professor atualizado." if request.args.get("salvo")
               else None)
    if request.args.get("estado") == "ativado":
        sucesso = "Perfil do professor ativado."
    elif request.args.get("estado") == "desativado":
        sucesso = "Perfil do professor desativado."
    elif request.args.get("estado") == "excluido":
        sucesso = "Perfil do professor excluído."
    professor_id = request.form.get("professor_id", "").strip()
    nome_form = request.form.get("nome", "")
    usuario_form = request.form.get("usuario", "")
    senha_form = request.form.get("senha", "")
    turmas_selecionadas = request.form.getlist("turmas")
    if request.method == "POST":
        nome = nome_form.strip()
        usuario = usuario_form.strip()
        editando_id = None
        if professor_id:
            try:
                editando_id = int(professor_id)
            except ValueError:
                erro = "Professor inválido."
        turmas = list(dict.fromkeys(
            turma.strip() for turma in request.form.getlist("turmas") if turma.strip()))
        if len(nome) < 3 or len(nome) > 120 or len(usuario) < 3 or len(usuario) > 50:
            erro = "Informe nome e usuário válidos."
        elif not editando_id and (len(senha_form) < 8 or len(senha_form) > 128):
            erro = "A senha deve ter entre 8 e 128 caracteres."
        elif not turmas:
            erro = "Selecione ao menos uma turma para o professor."
        elif erro is None:
            conexao = mysql.connector.connect(**DB_CONFIG)
            cursor = conexao.cursor()
            try:
                cursor.execute(
                    "SELECT DISTINCT turma FROM alunos "
                    "WHERE turma IS NOT NULL AND TRIM(turma)<>''")
                disponiveis = {linha[0] for linha in cursor.fetchall()}
                if any(turma not in disponiveis for turma in turmas):
                    erro = "Uma ou mais turmas selecionadas não existem mais."
                else:
                    cursor.execute(
                        "SELECT id FROM administradores WHERE usuario=%s LIMIT 1", (usuario,))
                    conflito_admin = cursor.fetchone()
                    cursor.execute(
                        "SELECT id FROM professores WHERE usuario=%s AND id<>%s LIMIT 1",
                        (usuario, editando_id or 0))
                    conflito_professor = cursor.fetchone()
                    if conflito_admin:
                        erro = "Este usuário já está cadastrado como administrador."
                    elif conflito_professor:
                        erro = "Este usuário já está cadastrado para outro professor."
                    elif editando_id:
                        cursor.execute("SELECT id FROM professores WHERE id=%s", (editando_id,))
                        if not cursor.fetchone():
                            erro = "Professor não encontrado."
                        else:
                            cursor.execute(
                                "UPDATE professores SET nome=%s, usuario=%s WHERE id=%s",
                                (nome, usuario, editando_id))
                            cursor.execute(
                                "DELETE FROM professor_turmas WHERE professor_id=%s",
                                (editando_id,))
                            cursor.executemany(
                                "INSERT INTO professor_turmas (professor_id, turma) "
                                "VALUES (%s, %s)",
                                [(editando_id, turma) for turma in turmas])
                            conexao.commit()
                            return redirect(url_for("pagina_professores", salvo=1))
                    else:
                        cursor.execute(
                            "INSERT INTO professores (nome, usuario, senha_hash) "
                            "VALUES (%s, %s, %s)",
                            (nome, usuario, generate_password_hash(senha_form)))
                        novo_professor_id = cursor.lastrowid
                        cursor.executemany(
                            "INSERT INTO professor_turmas (professor_id, turma) "
                            "VALUES (%s, %s)",
                            [(novo_professor_id, turma) for turma in turmas])
                        conexao.commit()
                        return redirect(url_for("pagina_professores", criado=1))
            except mysql.connector.errors.IntegrityError:
                conexao.rollback()
                erro = "Este usuário já está cadastrado."
            except Exception:
                conexao.rollback()
                raise
            finally:
                cursor.close()
                conexao.close()

    turmas = query(
        "SELECT DISTINCT turma FROM alunos "
        "WHERE turma IS NOT NULL AND TRIM(turma)<>'' ORDER BY turma")
    professores = query(
        "SELECT p.id, p.nome, p.usuario, p.ativo, "
        "GROUP_CONCAT(pt.turma ORDER BY pt.turma SEPARATOR ', ') AS turmas "
        "FROM professores p LEFT JOIN professor_turmas pt ON pt.professor_id=p.id "
        "GROUP BY p.id ORDER BY p.nome")
    vinculos = query(
        "SELECT professor_id, turma FROM professor_turmas ORDER BY turma")
    turmas_por_professor = {}
    for vinculo in vinculos:
        turmas_por_professor.setdefault(vinculo["professor_id"], []).append(
            vinculo["turma"])
    for professor in professores:
        professor["turmas_lista"] = turmas_por_professor.get(professor["id"], [])

    professor_edicao = None
    if request.method == "GET" and request.args.get("editar"):
        try:
            professor_edicao = next(
                (item for item in professores
                 if item["id"] == int(request.args["editar"])), None)
        except ValueError:
            erro = "Professor inválido."
        if not professor_edicao and erro is None:
            erro = "Professor não encontrado."
    if professor_edicao:
        professor_id = str(professor_edicao["id"])
        nome_form = professor_edicao["nome"]
        usuario_form = professor_edicao["usuario"]
        turmas_selecionadas = professor_edicao["turmas_lista"]
    sucesso = ("Professor cadastrado com sucesso."
               if request.args.get("criado") else sucesso)
    return render_template(
        "professores.html", turmas=turmas, professores=professores,
        professor_edicao=professor_edicao, professor_id=professor_id,
        nome_form=nome_form, usuario_form=usuario_form, senha_form=senha_form,
        turmas_selecionadas=turmas_selecionadas,
        erro=erro, sucesso=sucesso)

@app.route("/professor")
def pagina_professor():
    if "professor" not in session:
        return redirect(url_for("login"))
    perfil = query(
        "SELECT ativo FROM professores WHERE id=%s",
        (session["professor"]["id"],))
    if not perfil or not perfil[0]["ativo"]:
        session.pop("professor", None)
        return redirect(url_for("login"))
    turmas = query(
        "SELECT turma FROM professor_turmas WHERE professor_id=%s ORDER BY turma",
        (session["professor"]["id"],))
    turmas = [linha["turma"] for linha in turmas]
    turma_selecionada = request.args.get("turma", "")
    if turmas and turma_selecionada not in turmas:
        return redirect(url_for("pagina_professor", turma=turmas[0]))
    return render_template("professor.html", professor=session["professor"],
                           nav_turmas=turmas, turma_selecionada=turma_selecionada)

@app.route("/professores/<int:professor_id>/toggle", methods=["POST"])
@login_required
def alternar_professor(professor_id):
    query(
        "UPDATE professores SET ativo=NOT ativo WHERE id=%s",
        (professor_id,), fetch=False, commit=True)
    encontrado = query(
        "SELECT id, ativo FROM professores WHERE id=%s", (professor_id,))
    if not encontrado:
        return jsonify({"ok": False, "msg": "Professor não encontrado."}), 404
    ativo = bool(encontrado[0]["ativo"])
    return redirect(url_for("pagina_professores",
                            estado="ativado" if ativo else "desativado"))

@app.route("/professores/<int:professor_id>/excluir", methods=["POST"])
@login_required
def excluir_professor(professor_id):
    conexao = mysql.connector.connect(**DB_CONFIG)
    cursor = conexao.cursor()
    try:
        cursor.execute("DELETE FROM professores WHERE id=%s", (professor_id,))
        if cursor.rowcount == 0:
            abort(404)
        conexao.commit()
    except Exception:
        conexao.rollback()
        raise
    finally:
        cursor.close()
        conexao.close()
    return redirect(url_for("pagina_professores", estado="excluido"))

@app.route("/api/professor/presencas")
@professor_required
def api_professor_presencas():
    professor_id = session["professor"]["id"]
    turmas = query(
        "SELECT turma FROM professor_turmas WHERE professor_id=%s ORDER BY turma",
        (professor_id,))
    turmas_permitidas = [linha["turma"] for linha in turmas]
    turma = request.args.get("turma", "")
    if turma and turma not in turmas_permitidas:
        return jsonify({"ok": False, "msg": "Você não tem acesso a esta turma."}), 403
    filtro_turma = " AND a.turma=%s" if turma else ""
    parametros = (professor_id, turma) if turma else (professor_id,)
    alunos = query(
        "SELECT a.nome, a.matricula, a.turma, r.tipo, r.status, "
        "entrada.status AS status_entrada, "
        "DATE_FORMAT(entrada.data_hora, '%d/%m/%Y %H:%i') "
        "AS data_hora_entrada, "
        "DATE_FORMAT(saida.data_hora, '%d/%m/%Y %H:%i') "
        "AS data_hora_saida "
        "FROM alunos a JOIN professor_turmas pt ON pt.turma=a.turma "
        "LEFT JOIN registros r ON r.id=("
        "SELECT r2.id FROM registros r2 WHERE r2.aluno_id=a.id "
        "AND DATE(r2.data_hora)=CURDATE() "
        "AND r2.status IN ('AUTORIZADO','ATRASADO') "
        "ORDER BY r2.data_hora DESC, r2.id DESC LIMIT 1) "
        "LEFT JOIN registros entrada ON entrada.id=("
        "SELECT r3.id FROM registros r3 WHERE r3.aluno_id=a.id "
        "AND DATE(r3.data_hora)=CURDATE() AND r3.tipo='ENTRADA' "
        "AND r3.status IN ('AUTORIZADO','ATRASADO') "
        "ORDER BY r3.data_hora DESC, r3.id DESC LIMIT 1) "
        "LEFT JOIN registros saida ON saida.id=("
        "SELECT r4.id FROM registros r4 WHERE r4.aluno_id=a.id "
        "AND DATE(r4.data_hora)=CURDATE() AND r4.tipo='SAIDA' "
        "AND r4.status IN ('AUTORIZADO','ATRASADO') "
        "ORDER BY r4.data_hora DESC, r4.id DESC LIMIT 1) "
        "WHERE pt.professor_id=%s AND a.ativo=TRUE" + filtro_turma +
        " ORDER BY a.turma, a.nome", parametros)
    return jsonify({"turmas": turmas_permitidas, "turma": turma or None,
                    "alunos": alunos})

@app.route("/api/professor/turmas")
@professor_required
def api_professor_turmas():
    turmas = query(
        "SELECT turma FROM professor_turmas WHERE professor_id=%s ORDER BY turma",
        (session["professor"]["id"],))
    return jsonify([linha["turma"] for linha in turmas])

@app.route("/api/alunos", methods=["GET", "POST"])
@login_required
def api_alunos():
    if request.method == "POST":                    # CADASTRAR
        d = request.get_json(silent=True) or {}
        nome = d.get("nome", "").strip()
        matricula = d.get("matricula", "").strip()
        turma = d.get("turma", "").strip()
        curso_tecnico = d.get("curso_tecnico", "").strip()
        responsavel = d.get("responsavel", "").strip()
        telefone = d.get("telefone", "").strip()

        if not all((nome, matricula, turma, responsavel, telefone)):
            return jsonify({"ok": False,
                            "msg": "Preencha todos os campos do aluno."}), 400
        if len(nome) < 3:
            return jsonify({"ok": False,
                            "msg": "O nome deve ter pelo menos 3 caracteres."}), 400
        if len(nome) > 120 or len(matricula) > 30 or len(turma) > 60:
            return jsonify({"ok": False,
                            "msg": "Confira o limite de caracteres dos campos."}), 400
        if len(responsavel) > 120 or len(telefone) > 20:
            return jsonify({"ok": False,
                            "msg": "Confira os dados do responsável e telefone."}), 400
        anos_escolares = ([f"{ano}º ano do Ensino Fundamental"
                           for ano in range(1, 10)] +
                          [f"{ano}º ano do Ensino Médio"
                           for ano in range(1, 4)])
        ano_escolar = next((ano for ano in anos_escolares
                            if turma == ano or turma.startswith(ano + " - Sala ")),
                           None)
        if ano_escolar and turma not in (f"{ano_escolar} - Sala A",
                                         f"{ano_escolar} - Sala B"):
            return jsonify({"ok": False,
                            "msg": "Selecione a sala A ou B do aluno."}), 400
        ano_medio_tecnico = turma.startswith(("2º ano do Ensino Médio",
                                              "3º ano do Ensino Médio"))
        if ano_medio_tecnico and not curso_tecnico:
            return jsonify({"ok": False,
                            "msg": "Selecione o curso técnico do aluno."}), 400
        if curso_tecnico and not ano_medio_tecnico:
            return jsonify({"ok": False,
                            "msg": "Curso técnico disponível apenas no 2º e 3º ano do Ensino Médio."}), 400
        if len(curso_tecnico) > 100:
            return jsonify({"ok": False,
                            "msg": "Confira o limite de caracteres do curso técnico."}), 400

        token = uuid.uuid4().hex                    # gera token único do QR
        try:
            query("INSERT INTO alunos (nome, matricula, turma, curso_tecnico, "
                  "responsavel, telefone, qr_token) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                  (nome, matricula, turma, curso_tecnico or None,
                   responsavel, telefone, token),
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

    d = request.get_json(silent=True) or {}         # EDITAR
    campos = {chave: str(d.get(chave, "")).strip() for chave in
              ("nome", "matricula", "turma", "curso_tecnico",
               "responsavel", "telefone")}
    if not all(campos[chave] for chave in
               ("nome", "matricula", "turma", "responsavel", "telefone")):
        return jsonify({"ok": False,
                        "msg": "Preencha todos os campos do aluno."}), 400
    if len(campos["nome"]) < 3:
        return jsonify({"ok": False,
                        "msg": "O nome deve ter pelo menos 3 caracteres."}), 400
    if (len(campos["nome"]) > 120 or len(campos["matricula"]) > 30 or
            len(campos["turma"]) > 60 or len(campos["responsavel"]) > 120 or
            len(campos["telefone"]) > 20 or len(campos["curso_tecnico"]) > 100):
        return jsonify({"ok": False,
                        "msg": "Confira o limite de caracteres dos campos."}), 400
    anos_escolares = ([f"{ano}º ano do Ensino Fundamental"
                       for ano in range(1, 10)] +
                      [f"{ano}º ano do Ensino Médio"
                       for ano in range(1, 4)])
    ano_escolar = next((ano for ano in anos_escolares
                        if campos["turma"] == ano or
                        campos["turma"].startswith(ano + " - Sala ")), None)
    if ano_escolar and campos["turma"] not in (
            f"{ano_escolar} - Sala A", f"{ano_escolar} - Sala B"):
        return jsonify({"ok": False,
                        "msg": "Selecione a sala A ou B do aluno."}), 400
    ano_medio_tecnico = campos["turma"].startswith(
        ("2º ano do Ensino Médio", "3º ano do Ensino Médio"))
    if ano_medio_tecnico and not campos["curso_tecnico"]:
        return jsonify({"ok": False,
                        "msg": "Selecione o curso técnico do aluno."}), 400
    if campos["curso_tecnico"] and not ano_medio_tecnico:
        return jsonify({"ok": False,
                        "msg": "Curso técnico disponível apenas no 2º e 3º ano do Ensino Médio."}), 400
    try:
        query("UPDATE alunos SET nome=%s, matricula=%s, turma=%s, curso_tecnico=%s, "
              "responsavel=%s, telefone=%s, ativo=%s WHERE id=%s",
              (campos["nome"], campos["matricula"], campos["turma"],
               campos["curso_tecnico"] or None,
               campos["responsavel"], campos["telefone"],
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


def processar_validacao_qr(token, event_id=None):
    db = mysql.connector.connect(**DB_CONFIG)
    cur = db.cursor(dictionary=True)
    try:
        if event_id:
            cur.execute(
                "SELECT r.tipo, r.status, a.nome, a.turma FROM registros r "
                "JOIN alunos a ON a.id=r.aluno_id "
                "WHERE r.arduino_event_id=%s LIMIT 1", (event_id,))
            anterior = cur.fetchone()
            if anterior:
                db.commit()
                liberado = anterior["status"] in ("AUTORIZADO", "ATRASADO")
                return jsonify({
                    "ok": liberado,
                    "status": anterior["status"],
                    "aluno": {"nome": anterior["nome"],
                              "turma": anterior["turma"] or ""},
                    "tipo": anterior["tipo"],
                    "msg": "Evento já processado.",
                })

        # O bloqueio por aluno impede duas leituras simultâneas de liberarem passagem.
        cur.execute("SELECT id, nome, turma, ativo FROM alunos WHERE qr_token=%s FOR UPDATE",
                    (token,))
        aluno = cur.fetchone()
        if not aluno:
            db.rollback()
            return jsonify({"ok": False, "status": "NEGADO", "aluno": None,
                            "tipo": None, "msg": "❌ QR Code não reconhecido."})

        cur.execute("SELECT tipo, TIMESTAMPDIFF(SECOND, data_hora, CURRENT_TIMESTAMP) "
                    "AS segundos_desde FROM registros WHERE aluno_id=%s "
                    "AND status IN ('AUTORIZADO', 'ATRASADO') "
                    "ORDER BY data_hora DESC LIMIT 1", (aluno["id"],))
        ultimo = cur.fetchone()
        tipo = "SAIDA" if ultimo and ultimo["tipo"] == "ENTRADA" else "ENTRADA"
        aluno_info = {"nome": aluno["nome"], "turma": aluno["turma"] or ""}

        if not aluno["ativo"]:
            if event_id:
                cur.execute("INSERT INTO registros "
                            "(aluno_id, tipo, metodo, status, arduino_event_id) "
                            "VALUES (%s,%s,'QRCODE','NEGADO',%s)",
                            (aluno["id"], tipo, event_id))
            else:
                cur.execute("INSERT INTO registros (aluno_id, tipo, metodo, status) "
                            "VALUES (%s,%s,'QRCODE','NEGADO')", (aluno["id"], tipo))
            db.commit()
            return jsonify({"ok": False, "status": "NEGADO", "aluno": aluno_info,
                            "tipo": tipo, "msg": f"⛔ NEGADO — {aluno['nome']} está desativado."})

        if ultimo and int(ultimo["segundos_desde"]) < 3600:
            restante = 3600 - int(ultimo["segundos_desde"])
            aguardar_minutos = (restante + 59) // 60
            if event_id:
                cur.execute("INSERT INTO registros "
                            "(aluno_id, tipo, metodo, status, bloqueio_intervalo, arduino_event_id) "
                            "VALUES (%s,%s,'QRCODE','NEGADO',TRUE,%s)",
                            (aluno["id"], tipo, event_id))
            else:
                cur.execute("INSERT INTO registros (aluno_id, tipo, metodo, status, bloqueio_intervalo) "
                            "VALUES (%s,%s,'QRCODE','NEGADO',TRUE)", (aluno["id"], tipo))
            registro_id = cur.lastrowid
            db.commit()
            nome_tipo = "entrada" if tipo == "ENTRADA" else "saída"
            return jsonify({"ok": False, "status": "NEGADO", "aluno": aluno_info,
                            "tipo": tipo, "aguardar_minutos": aguardar_minutos,
                            "registro_id": registro_id, "solicitar_justificativa": True,
                            "msg": (f"⛔ NEGADO — intervalo mínimo de 1 hora entre passagens. "
                                    f"Aguarde {aguardar_minutos} min para nova {nome_tipo}.")})

        status, minutos_atraso = "AUTORIZADO", None
        aulas_atraso = None
        fora_periodo = False
        if tipo == "ENTRADA":
            agora = datetime.now()
            minutos_do_dia = agora.hour * 60 + agora.minute
            if minutos_do_dia > 7 * 60 + 45:
                status = "ATRASADO"
                minutos_atraso = minutos_do_dia - (7 * 60 + 45)
                aulas_atraso = (minutos_atraso + 44) // 45
                fora_periodo = minutos_do_dia > 13 * 60 + 30

        if event_id:
            cur.execute("INSERT INTO registros "
                        "(aluno_id, tipo, metodo, status, minutos_atraso, arduino_event_id) "
                        "VALUES (%s,%s,'QRCODE',%s,%s,%s)",
                        (aluno["id"], tipo, status, minutos_atraso, event_id))
        else:
            cur.execute("INSERT INTO registros (aluno_id, tipo, metodo, status, minutos_atraso) "
                        "VALUES (%s,%s,'QRCODE',%s,%s)",
                        (aluno["id"], tipo, status, minutos_atraso))
        db.commit()

        if status == "ATRASADO":
            texto_aulas = f"{aulas_atraso} {'aula' if aulas_atraso == 1 else 'aulas'} de atraso"
            msg = f"🟠 ENTRADA ATRASADA — {aluno['nome']} — {texto_aulas}"
        else:
            msg = f"🟢 {tipo} AUTORIZADA — {aluno['nome']}"
        return jsonify({"ok": True, "status": status, "aluno": aluno_info,
                        "tipo": tipo, "aulas_atraso": aulas_atraso,
                        "fora_periodo": fora_periodo, "msg": msg})
    except Exception:
        db.rollback()
        raise
    finally:
        cur.close()
        db.close()


@app.route("/api/validar", methods=["POST"])
def api_validar():
    """Recebe o token lido pelo scanner e decide: autoriza ou nega."""
    dados = request.get_json(silent=True) or {}
    token = str(dados.get("token", "")).strip()
    return processar_validacao_qr(token)


@app.route("/api/acesso", methods=["GET", "POST"])
def api_acesso():
    dados = request.get_json(silent=True) or {}
    token = str(dados.get("codigo") or request.args.get("codigo") or "").strip()
    event_id = str(dados.get("evento_id") or request.args.get("evento_id") or "").strip()
    if not token:
        return jsonify({"liberado": False, "motivo": "Código QR não informado."}), 400
    if len(token) > 64 or len(event_id) > 64:
        return jsonify({"liberado": False, "motivo": "Código ou identificador inválido."}), 400
    if event_id and not all(caractere.isalnum() or caractere in "-_" for caractere in event_id):
        return jsonify({"liberado": False, "motivo": "Identificador do evento inválido."}), 400

    resultado = processar_validacao_qr(token, event_id or None).get_json()
    return jsonify({
        "liberado": bool(resultado.get("ok")),
        "motivo": resultado.get("msg", ""),
    })


@app.route("/api/registros/<int:registro_id>/justificativa", methods=["POST"])
@login_required
def api_registro_justificativa(registro_id):
    dados = request.get_json(silent=True) or {}
    justificativa = str(dados.get("justificativa", "")).strip()
    if not justificativa:
        return jsonify({"ok": False, "msg": "Escreva a justificativa."}), 400
    if len(justificativa) > 500:
        return jsonify({"ok": False, "msg": "A justificativa deve ter no máximo 500 caracteres."}), 400

    db = mysql.connector.connect(**DB_CONFIG)
    cur = db.cursor()
    try:
        cur.execute("UPDATE registros SET justificativa=%s WHERE id=%s "
                    "AND status='NEGADO' AND bloqueio_intervalo=TRUE "
                    "AND justificativa IS NULL", (justificativa, registro_id))
        if cur.rowcount != 1:
            db.rollback()
            return jsonify({"ok": False,
                            "msg": "Esta justificativa não está disponível para esse registro."}), 404
        db.commit()
        return jsonify({"ok": True, "msg": "Justificativa registrada."})
    except Exception:
        db.rollback()
        raise
    finally:
        cur.close()
        db.close()


@app.route("/api/registros")
@login_required
def api_registros():
    return jsonify(query(
        "SELECT a.nome, a.turma, r.tipo, r.metodo, r.status, r.justificativa, "
        "CAST(CEIL(r.minutos_atraso / 45.0) AS UNSIGNED) AS aulas_atraso, "
        "DATE_FORMAT(r.data_hora,'%d/%m/%Y %H:%i:%s') AS data_hora "
        "FROM registros r JOIN alunos a ON a.id=r.aluno_id "
        "ORDER BY r.data_hora DESC LIMIT 300"))


if __name__ == "__main__":
    # Aceita acesso por localhost e pela rede local, sem depender de um IP fixo.
    app.run(debug=True, host="0.0.0.0")
