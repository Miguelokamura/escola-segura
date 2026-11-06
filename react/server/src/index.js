import "dotenv/config";
import express from "express";
import session from "express-session";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import cors from "cors";
import { localAdmin } from "../credentials.js";

const caBase64 = process.env.DB_SSL_CA_B64?.replace(/\s/g, "");
if (caBase64 && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(caBase64)) {
  throw new Error("DB_SSL_CA_B64 precisa conter um certificado CA em Base64 válido.");
}
const databaseCa = caBase64
  ? Buffer.from(caBase64, "base64")
  : process.env.DB_SSL_CA
    ? readFileSync(process.env.DB_SSL_CA)
    : undefined;
if (databaseCa && (!databaseCa.subarray(0, 5).equals(Buffer.from("-----")) ||
    !databaseCa.includes(Buffer.from("\n")))) {
  throw new Error("O certificado CA do banco não decodifica para um arquivo PEM válido.");
}

const app = express();
const corsOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173")
  .split(",").map(origin => origin.trim()).filter(Boolean);
app.set("trust proxy", 1);
app.use(cors({ origin: corsOrigins, credentials: true }));
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) throw new Error("Defina SESSION_SECRET no ambiente da API Express.");
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "escola_segura",
  ssl: databaseCa ? { ca: databaseCa, rejectUnauthorized: true } : undefined,
  waitForConnections: true,
});
app.use(express.json());
const production = process.env.NODE_ENV === "production";
app.use(session({ secret: sessionSecret, resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: production ? "none" : "lax", secure: production } }));

const protegido = (req, res, next) => {
  const chaveMobile = req.get("X-Escola-Mobile-Key");
  if (req.session.admin || (localAdmin.chaveMobile && chaveMobile === localAdmin.chaveMobile)) return next();
  return res.status(401).json({ ok: false, msg: "Não autenticado." });
};
const professorProtegido = async (req, res, next) => {
  if (!req.session.professor) {
    return res.status(req.session.admin ? 403 : 401).json({ ok: false, msg: "Acesso restrito a professores." });
  }
  try {
    const [rows] = await pool.execute(
      "SELECT ativo FROM professores WHERE id=?", [req.session.professor.id]
    );
    if (!rows[0] || !rows[0].ativo) {
      delete req.session.professor;
      return res.status(403).json({ ok: false, msg: "Este perfil de professor está desativado." });
    }
    return next();
  } catch (error) { return next(error); }
};
const hoje = () => new Date().toISOString().slice(0, 10);
const hashSenha = senha => {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(senha, salt, 600000, 32, "sha256").toString("hex");
  return `pbkdf2:sha256:600000$${salt}$${hash}`;
};
async function senhaConfere(senha, hashArmazenado) {
  if (hashArmazenado.startsWith("$2")) return bcrypt.compare(senha, hashArmazenado);

  // Compatibilidade com generate_password_hash do Werkzeug/Flask.
  const [metodo, salt, hash] = hashArmazenado.split("$");
  if (!metodo || !salt || !hash) return false;
  const esperado = Buffer.from(hash, /^[a-f0-9]+$/i.test(hash) ? "hex" : "base64");
  let calculado;
  if (metodo.startsWith("pbkdf2:")) {
    const [, algoritmo, iteracoes] = metodo.split(":");
    calculado = crypto.pbkdf2Sync(senha, salt, Number(iteracoes), esperado.length, algoritmo);
  } else if (metodo.startsWith("scrypt:")) {
    const [, n, r, p] = metodo.split(":");
    calculado = crypto.scryptSync(senha, salt, esperado.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  } else return false;
  return esperado.length === calculado.length && crypto.timingSafeEqual(esperado, calculado);
}

app.get("/api/session", (req, res) => {
  const user = req.session.professor
    ? { role: "professor", username: req.session.professor.usuario, name: req.session.professor.nome }
    : req.session.admin
      ? { role: "admin", username: req.session.admin }
      : null;
  res.json({ authenticated: Boolean(user), user });
});
app.post("/api/login", async (req, res, next) => { try { const { usuario = "", senha = "" } = req.body;
  // Acesso local simples: configurável em server/credentials.js.
  if (localAdmin.usuario && localAdmin.senha && usuario === localAdmin.usuario && senha === localAdmin.senha) { req.session.admin = usuario; delete req.session.professor; return res.json({ ok: true, user: { role: "admin", username: usuario } }); }
  const [rows] = await pool.execute("SELECT usuario, senha_hash FROM administradores WHERE usuario=?", [usuario]);
  if (rows[0] && await senhaConfere(senha, rows[0].senha_hash)) {
    req.session.admin = rows[0].usuario;
    delete req.session.professor;
    return res.json({ ok: true, user: { role: "admin", username: rows[0].usuario } });
  }
  const [professores] = await pool.execute("SELECT id, nome, usuario, senha_hash FROM professores WHERE usuario=? AND ativo=TRUE", [usuario]);
  if (!professores[0] || !(await senhaConfere(senha, professores[0].senha_hash))) return res.status(401).json({ ok: false, msg: "Usuário ou senha inválidos." });
  const professor = professores[0];
  req.session.professor = { id: professor.id, nome: professor.nome, usuario: professor.usuario };
  delete req.session.admin;
  res.json({ ok: true, user: { role: "professor", username: professor.usuario, name: professor.nome } });
} catch (e) { next(e); } });
app.post("/api/mobile-login", (req, res) => {
  const { usuario = "", senha = "" } = req.body;
  if (!localAdmin.usuario || !localAdmin.senha || !localAdmin.chaveMobile) {
    return res.status(503).json({ ok: false, msg: "A autenticação móvel não está configurada." });
  }
  if (usuario !== localAdmin.usuario || senha !== localAdmin.senha) return res.status(401).json({ ok: false, msg: "Usuário ou senha inválidos." });
  return res.json({ ok: true, chaveMobile: localAdmin.chaveMobile });
});
app.post("/api/logout", (req, res) => req.session.destroy(error => {
  if (error) return res.status(500).json({ ok: false, msg: "Não foi possível encerrar a sessão." });
  return res.json({ ok: true });
}));

app.get("/api/professores/turmas", protegido, async (req, res, next) => {
  try {
    const [rows] = await pool.query("SELECT DISTINCT turma FROM alunos WHERE turma IS NOT NULL AND TRIM(turma)<>'' ORDER BY turma");
    res.json(rows.map(row => row.turma));
  } catch (e) { next(e); }
});
app.get("/api/professores", protegido, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      "SELECT p.id, p.nome, p.usuario, p.ativo, GROUP_CONCAT(pt.turma ORDER BY pt.turma SEPARATOR ', ') turmas " +
      "FROM professores p LEFT JOIN professor_turmas pt ON pt.professor_id=p.id " +
      "GROUP BY p.id ORDER BY p.nome"
    );
    const [vinculos] = await pool.query(
      "SELECT professor_id, turma FROM professor_turmas ORDER BY turma"
    );
    const turmasPorProfessor = new Map();
    for (const vinculo of vinculos) {
      const lista = turmasPorProfessor.get(vinculo.professor_id) || [];
      lista.push(vinculo.turma);
      turmasPorProfessor.set(vinculo.professor_id, lista);
    }
    for (const professor of rows) {
      professor.turmas_lista = turmasPorProfessor.get(professor.id) || [];
    }
    res.json(rows);
  } catch (e) { next(e); }
});
app.post("/api/professores", protegido, async (req, res, next) => {
  let conexao;
  try {
    const nome = String(req.body?.nome || "").trim();
    const usuario = String(req.body?.usuario || "").trim();
    const senha = String(req.body?.senha || "");
    const turmas = [...new Set((Array.isArray(req.body?.turmas) ? req.body.turmas : [])
      .map(turma => String(turma).trim()).filter(Boolean))];
    if (nome.length < 3 || nome.length > 120 || usuario.length < 3 || usuario.length > 50) {
      return res.status(400).json({ ok: false, msg: "Informe nome e usuário válidos (3 a 120 e 3 a 50 caracteres)." });
    }
    if (senha.length < 8 || senha.length > 128) return res.status(400).json({ ok: false, msg: "A senha deve ter entre 8 e 128 caracteres." });
    if (!turmas.length) return res.status(400).json({ ok: false, msg: "Selecione ao menos uma turma para o professor." });
    if (usuario === localAdmin.usuario) return res.status(409).json({ ok: false, msg: "Este usuário já está reservado para a conta administrativa local." });

    conexao = await pool.getConnection();
    await conexao.beginTransaction();
    const [administradores] = await conexao.execute("SELECT id FROM administradores WHERE usuario=? LIMIT 1", [usuario]);
    if (administradores.length) {
      await conexao.rollback();
      return res.status(409).json({ ok: false, msg: "Este usuário já está cadastrado como administrador." });
    }
    const [disponiveis] = await conexao.query("SELECT DISTINCT turma FROM alunos WHERE turma IS NOT NULL AND TRIM(turma)<>''");
    const turmasDisponiveis = new Set(disponiveis.map(row => row.turma));
    if (turmas.some(turma => !turmasDisponiveis.has(turma))) {
      await conexao.rollback();
      return res.status(400).json({ ok: false, msg: "Uma ou mais turmas selecionadas não existem mais." });
    }
    const [resultado] = await conexao.execute(
      "INSERT INTO professores (nome, usuario, senha_hash) VALUES (?, ?, ?)",
      [nome, usuario, hashSenha(senha)]
    );
    await conexao.query(
      "INSERT INTO professor_turmas (professor_id, turma) VALUES ?",
      [turmas.map(turma => [resultado.insertId, turma])]
    );
    await conexao.commit();
    res.status(201).json({ ok: true, msg: "Professor cadastrado com sucesso." });
  } catch (e) {
    if (conexao) await conexao.rollback();
    next(e);
  } finally { conexao?.release(); }
});
app.put("/api/professores/:id", protegido, async (req, res, next) => {
  let conexao;
  try {
    const professorId = Number(req.params.id);
    const nome = String(req.body?.nome || "").trim();
    const usuario = String(req.body?.usuario || "").trim();
    const turmas = [...new Set((Array.isArray(req.body?.turmas) ? req.body.turmas : [])
      .map(turma => String(turma).trim()).filter(Boolean))];
    if (!Number.isSafeInteger(professorId) || professorId < 1) {
      return res.status(400).json({ ok: false, msg: "Professor inválido." });
    }
    if (nome.length < 3 || nome.length > 120 || usuario.length < 3 || usuario.length > 50) {
      return res.status(400).json({ ok: false, msg: "Informe nome e usuário válidos (3 a 120 e 3 a 50 caracteres)." });
    }
    if (!turmas.length) return res.status(400).json({ ok: false, msg: "Selecione ao menos uma turma para o professor." });
    if (usuario === localAdmin.usuario) return res.status(409).json({ ok: false, msg: "Este usuário já está reservado para a conta administrativa local." });

    conexao = await pool.getConnection();
    await conexao.beginTransaction();
    const [professores] = await conexao.execute(
      "SELECT id FROM professores WHERE id=? FOR UPDATE", [professorId]
    );
    if (!professores.length) {
      await conexao.rollback();
      return res.status(404).json({ ok: false, msg: "Professor não encontrado." });
    }
    const [administradores] = await conexao.execute(
      "SELECT id FROM administradores WHERE usuario=? LIMIT 1", [usuario]
    );
    if (administradores.length) {
      await conexao.rollback();
      return res.status(409).json({ ok: false, msg: "Este usuário já está cadastrado como administrador." });
    }
    const [disponiveis] = await conexao.query(
      "SELECT DISTINCT turma FROM alunos WHERE turma IS NOT NULL AND TRIM(turma)<>''"
    );
    const turmasDisponiveis = new Set(disponiveis.map(row => row.turma));
    if (turmas.some(turma => !turmasDisponiveis.has(turma))) {
      await conexao.rollback();
      return res.status(400).json({ ok: false, msg: "Uma ou mais turmas selecionadas não existem mais." });
    }
    await conexao.execute(
      "UPDATE professores SET nome=?, usuario=? WHERE id=?",
      [nome, usuario, professorId]
    );
    await conexao.execute("DELETE FROM professor_turmas WHERE professor_id=?", [professorId]);
    await conexao.query(
      "INSERT INTO professor_turmas (professor_id, turma) VALUES ?",
      [turmas.map(turma => [professorId, turma])]
    );
    await conexao.commit();
    res.json({ ok: true, msg: "Perfil do professor atualizado." });
  } catch (e) {
    if (conexao) await conexao.rollback();
    next(e);
  } finally { conexao?.release(); }
});
app.post("/api/professores/:id/toggle", protegido, async (req, res, next) => {
  try {
    const professorId = Number(req.params.id);
    if (!Number.isSafeInteger(professorId) || professorId < 1) {
      return res.status(400).json({ ok: false, msg: "Professor inválido." });
    }
    const [resultado] = await pool.execute(
      "UPDATE professores SET ativo=NOT ativo WHERE id=?", [professorId]
    );
    if (!resultado.affectedRows) {
      return res.status(404).json({ ok: false, msg: "Professor não encontrado." });
    }
    const [rows] = await pool.execute(
      "SELECT ativo FROM professores WHERE id=?", [professorId]
    );
    res.json({
      ok: true,
      ativo: Boolean(rows[0].ativo),
      msg: rows[0].ativo ? "Perfil do professor ativado." : "Perfil do professor desativado.",
    });
  } catch (e) { next(e); }
});
app.get("/api/professor/presencas", professorProtegido, async (req, res, next) => {
  try {
    const [turmas] = await pool.execute(
      "SELECT turma FROM professor_turmas WHERE professor_id=? ORDER BY turma",
      [req.session.professor.id]
    );
    const turmasDoProfessor = turmas.map(row => row.turma);
    const turma = String(req.query.turma || "");
    if (turma && !turmasDoProfessor.includes(turma)) {
      return res.status(403).json({ ok: false, msg: "Você não tem acesso a esta turma." });
    }
    const parametros = [req.session.professor.id];
    let filtroTurma = "";
    if (turma) {
      filtroTurma = " AND a.turma=?";
      parametros.push(turma);
    }
    const [alunos] = await pool.execute(
      "SELECT a.nome, a.matricula, a.turma, r.tipo, r.status, " +
      "entrada.status status_entrada, " +
      "DATE_FORMAT(entrada.data_hora, '%d/%m/%Y %H:%i') data_hora_entrada, " +
      "DATE_FORMAT(saida.data_hora, '%d/%m/%Y %H:%i') data_hora_saida " +
      "FROM alunos a JOIN professor_turmas pt ON pt.turma=a.turma " +
      "LEFT JOIN registros r ON r.id=(" +
      "SELECT r2.id FROM registros r2 WHERE r2.aluno_id=a.id " +
      "AND DATE(r2.data_hora)=CURDATE() AND r2.status IN ('AUTORIZADO','ATRASADO') " +
      "ORDER BY r2.data_hora DESC, r2.id DESC LIMIT 1) " +
      "LEFT JOIN registros entrada ON entrada.id=(" +
      "SELECT r3.id FROM registros r3 WHERE r3.aluno_id=a.id " +
      "AND DATE(r3.data_hora)=CURDATE() AND r3.tipo='ENTRADA' " +
      "AND r3.status IN ('AUTORIZADO','ATRASADO') " +
      "ORDER BY r3.data_hora DESC, r3.id DESC LIMIT 1) " +
      "LEFT JOIN registros saida ON saida.id=(" +
      "SELECT r4.id FROM registros r4 WHERE r4.aluno_id=a.id " +
      "AND DATE(r4.data_hora)=CURDATE() AND r4.tipo='SAIDA' " +
      "AND r4.status IN ('AUTORIZADO','ATRASADO') " +
      "ORDER BY r4.data_hora DESC, r4.id DESC LIMIT 1) " +
      "WHERE pt.professor_id=? AND a.ativo=TRUE" + filtroTurma + " ORDER BY a.turma, a.nome",
      parametros
    );
    res.json({ turmas: turmasDoProfessor, turma: turma || null, alunos });
  } catch (e) { next(e); }
});
app.get("/api/professor/turmas", professorProtegido, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      "SELECT turma FROM professor_turmas WHERE professor_id=? ORDER BY turma",
      [req.session.professor.id]
    );
    res.json(rows.map(row => row.turma));
  } catch (e) { next(e); }
});

app.get("/api/dashboard", protegido, async (req, res, next) => { try { const data = hoje(); const [[total], [entradas], [saidas], [negados], [atrasos], ultimos] = await Promise.all([pool.query("SELECT COUNT(*) c FROM alunos"), pool.execute("SELECT COUNT(*) c FROM registros WHERE tipo='ENTRADA' AND DATE(data_hora)=?", [data]), pool.execute("SELECT COUNT(*) c FROM registros WHERE tipo='SAIDA' AND DATE(data_hora)=?", [data]), pool.execute("SELECT COUNT(*) c FROM registros WHERE status='NEGADO' AND DATE(data_hora)=?", [data]), pool.execute("SELECT COUNT(*) c FROM registros WHERE status='ATRASADO' AND DATE(data_hora)=?", [data]), pool.query("SELECT r.tipo, r.status, a.nome, DATE_FORMAT(r.data_hora, '%d/%m %H:%i') dh FROM registros r JOIN alunos a ON a.id=r.aluno_id ORDER BY r.data_hora DESC LIMIT 10")]); res.json({ stats: { total_alunos: total[0].c, entradas_hoje: entradas[0].c, saidas_hoje: saidas[0].c, negados_hoje: negados[0].c, atrasos_hoje: atrasos[0].c }, ultimos }); } catch (e) { next(e); } });

function validarAluno(d = {}) {
  const campos = ["nome", "matricula", "turma", "responsavel", "telefone"];
  const limites = [120, 30, 60, 120, 20];
  const aluno = Object.fromEntries(campos.map(c => [c, String(d[c] || "").trim()]));
  aluno.curso_tecnico = String(d.curso_tecnico || "").trim();
  if (campos.some(c => !aluno[c])) return [null, "Preencha todos os campos do aluno."];
  if (aluno.nome.length < 3) return [null, "O nome deve ter pelo menos 3 caracteres."];
  if (limites.some((n, i) => aluno[campos[i]].length > n) || aluno.curso_tecnico.length > 100) return [null, "Confira o limite de caracteres dos campos."];
  const anosEscolares = [
    ...Array.from({ length: 9 }, (_, i) => `${i + 1}º ano do Ensino Fundamental`),
    ...Array.from({ length: 3 }, (_, i) => `${i + 1}º ano do Ensino Médio`),
  ];
  const anoEscolar = anosEscolares.find(ano => aluno.turma === ano || aluno.turma.startsWith(`${ano} - Sala `));
  if (anoEscolar && ![`${anoEscolar} - Sala A`, `${anoEscolar} - Sala B`].includes(aluno.turma)) return [null, "Selecione a sala A ou B do aluno."];
  const medioTecnico = aluno.turma.startsWith("2º ano do Ensino Médio") || aluno.turma.startsWith("3º ano do Ensino Médio");
  if (medioTecnico && !aluno.curso_tecnico) return [null, "Selecione o curso técnico do aluno."];
  if (!medioTecnico && aluno.curso_tecnico) return [null, "Curso técnico disponível apenas no 2º e 3º ano do Ensino Médio."];
  return [aluno];
}
app.get("/api/alunos", protegido, async (req, res, next) => { try { const [rows] = await pool.query("SELECT * FROM alunos ORDER BY nome"); res.json(rows); } catch (e) { next(e); } });
app.post("/api/alunos", protegido, async (req, res, next) => { try { const [aluno, erro] = validarAluno(req.body); if (erro) return res.status(400).json({ ok: false, msg: erro }); await pool.execute("INSERT INTO alunos (nome, matricula, turma, curso_tecnico, responsavel, telefone, qr_token) VALUES (?, ?, ?, ?, ?, ?, ?)", [aluno.nome, aluno.matricula, aluno.turma, aluno.curso_tecnico || null, aluno.responsavel, aluno.telefone, crypto.randomUUID().replaceAll("-", "")]); res.status(201).json({ ok: true, msg: "Aluno cadastrado!" }); } catch (e) { next(e); } });
app.put("/api/alunos/:id", protegido, async (req, res, next) => { try { const [aluno, erro] = validarAluno(req.body); if (erro) return res.status(400).json({ ok: false, msg: erro }); await pool.execute("UPDATE alunos SET nome=?, matricula=?, turma=?, curso_tecnico=?, responsavel=?, telefone=?, ativo=? WHERE id=?", [aluno.nome, aluno.matricula, aluno.turma, aluno.curso_tecnico || null, aluno.responsavel, aluno.telefone, req.body.ativo !== false, req.params.id]); res.json({ ok: true, msg: "Aluno atualizado." }); } catch (e) { next(e); } });
app.post("/api/alunos/:id/toggle", protegido, async (req, res, next) => { try { await pool.execute("UPDATE alunos SET ativo = NOT ativo WHERE id=?", [req.params.id]); res.json({ ok: true }); } catch (e) { next(e); } });
app.delete("/api/alunos/:id", protegido, async (req, res, next) => { try { await pool.execute("DELETE FROM alunos WHERE id=?", [req.params.id]); res.json({ ok: true, msg: "Aluno removido." }); } catch (e) { next(e); } });
app.get("/api/qrcode/:token", protegido, async (req, res, next) => { try { res.type("png").send(await QRCode.toBuffer(req.params.token, { width: 240, margin: 2 })); } catch (e) { next(e); } });
app.post("/api/validar", async (req, res, next) => {
  let conexao;
  try {
    const token = String(req.body?.token || "").trim();
    conexao = await pool.getConnection();
    await conexao.beginTransaction();

    // O bloqueio por aluno impede duas leituras simultâneas de liberarem passagem.
    const [alunos] = await conexao.execute(
      "SELECT id, nome, turma, ativo FROM alunos WHERE qr_token=? FOR UPDATE", [token]
    );
    if (!alunos[0]) {
      await conexao.rollback();
      return res.json({ ok: false, status: "NEGADO", aluno: null, tipo: null, msg: "❌ QR Code não reconhecido." });
    }

    const aluno = alunos[0];
    const alunoInfo = { nome: aluno.nome, turma: aluno.turma || "" };
    const [ultimos] = await conexao.execute(
      "SELECT tipo, TIMESTAMPDIFF(SECOND, data_hora, CURRENT_TIMESTAMP) segundos_desde " +
      "FROM registros WHERE aluno_id=? AND status IN ('AUTORIZADO', 'ATRASADO') " +
      "ORDER BY data_hora DESC LIMIT 1", [aluno.id]
    );
    const ultimo = ultimos[0];
    const tipo = ultimo?.tipo === "ENTRADA" ? "SAIDA" : "ENTRADA";

    if (!aluno.ativo) {
      await conexao.execute(
        "INSERT INTO registros (aluno_id, tipo, metodo, status) VALUES (?, ?, 'QRCODE', 'NEGADO')",
        [aluno.id, tipo]
      );
      await conexao.commit();
      return res.json({ ok: false, status: "NEGADO", aluno: alunoInfo, tipo, msg: `⛔ NEGADO — ${aluno.nome} está desativado.` });
    }

    if (ultimo && Number(ultimo.segundos_desde) < 3600) {
      const aguardarMinutos = Math.ceil((3600 - Number(ultimo.segundos_desde)) / 60);
      const [insercao] = await conexao.execute(
        "INSERT INTO registros (aluno_id, tipo, metodo, status, bloqueio_intervalo) VALUES (?, ?, 'QRCODE', 'NEGADO', TRUE)",
        [aluno.id, tipo]
      );
      await conexao.commit();
      const nomeTipo = tipo === "ENTRADA" ? "entrada" : "saída";
      return res.json({
        ok: false, status: "NEGADO", aluno: alunoInfo, tipo, aguardar_minutos: aguardarMinutos,
        registro_id: insercao.insertId, solicitar_justificativa: true,
        msg: `⛔ NEGADO — intervalo mínimo de 1 hora entre passagens. Aguarde ${aguardarMinutos} min para nova ${nomeTipo}.`,
      });
    }

    let status = "AUTORIZADO", minutos = null, aulasAtraso = null, foraPeriodo = false;
    const agora = new Date();
    const minutosDia = agora.getHours() * 60 + agora.getMinutes();
    if (tipo === "ENTRADA" && minutosDia > 465) {
      status = "ATRASADO";
      minutos = minutosDia - 465;
      aulasAtraso = Math.ceil(minutos / 45);
      foraPeriodo = minutosDia > 810;
    }
    await conexao.execute(
      "INSERT INTO registros (aluno_id, tipo, metodo, status, minutos_atraso) VALUES (?, ?, 'QRCODE', ?, ?)",
      [aluno.id, tipo, status, minutos]
    );
    await conexao.commit();

    const msg = status === "ATRASADO"
      ? `🟠 ENTRADA ATRASADA — ${aluno.nome} — ${aulasAtraso} ${aulasAtraso === 1 ? "aula" : "aulas"} de atraso`
      : `🟢 ${tipo} AUTORIZADA — ${aluno.nome}`;
    return res.json({ ok: true, status, aluno: alunoInfo, tipo, aulas_atraso: aulasAtraso, fora_periodo: foraPeriodo, msg });
  } catch (e) {
    if (conexao) await conexao.rollback();
    next(e);
  } finally {
    conexao?.release();
  }
});
app.get("/api/registros", protegido, async (req, res, next) => { try { const [rows] = await pool.query("SELECT a.nome, a.turma, r.tipo, r.metodo, r.status, r.justificativa, CAST(CEIL(r.minutos_atraso / 45.0) AS UNSIGNED) aulas_atraso, DATE_FORMAT(r.data_hora, '%d/%m/%Y %H:%i:%s') data_hora FROM registros r JOIN alunos a ON a.id=r.aluno_id ORDER BY r.data_hora DESC LIMIT 300"); res.json(rows); } catch (e) { next(e); } });
app.post("/api/registros/:id/justificativa", protegido, async (req, res, next) => {
  try {
    const justificativa = String(req.body?.justificativa || "").trim();
    if (!justificativa) return res.status(400).json({ ok: false, msg: "Escreva a justificativa." });
    if (justificativa.length > 500) return res.status(400).json({ ok: false, msg: "A justificativa deve ter no máximo 500 caracteres." });
    const [resultado] = await pool.execute(
      "UPDATE registros SET justificativa=? WHERE id=? AND status='NEGADO' AND bloqueio_intervalo=TRUE AND justificativa IS NULL",
      [justificativa, req.params.id]
    );
    if (!resultado.affectedRows) return res.status(404).json({ ok: false, msg: "Esta justificativa não está disponível para esse registro." });
    res.json({ ok: true, msg: "Justificativa registrada." });
  } catch (e) { next(e); }
});
app.use((err, req, res, next) => { console.error(err); if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ ok: false, msg: /professores\.usuario/i.test(err.sqlMessage || "") ? "Já existe um professor com esse usuário." : "Matrícula já existe." }); if (["ER_BAD_FIELD_ERROR", "ER_DATA_TOO_LONG"].includes(err.code)) return res.status(500).json({ ok: false, msg: "Banco desatualizado. Execute migration_curso_tecnico.sql e tente novamente." }); res.status(500).json({ ok: false, msg: "Erro interno do servidor." }); });
const porta = Number(process.env.PORT || 3001);
app.listen(porta, "0.0.0.0", () => console.log(`API disponível em http://localhost:${porta} e na rede local pela porta ${porta}`));
