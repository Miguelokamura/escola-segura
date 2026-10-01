import "dotenv/config";
import express from "express";
import session from "express-session";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import crypto from "node:crypto";
import { localAdmin } from "../credentials.js";

const app = express();
const pool = mysql.createPool({ host: process.env.DB_HOST || "localhost", user: process.env.DB_USER || "root", password: process.env.DB_PASSWORD || "", database: process.env.DB_NAME || "escola_segura", waitForConnections: true });
app.use(express.json());
app.use(session({ secret: process.env.SESSION_SECRET || "altere-esta-chave", resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: "lax" } }));

const protegido = (req, res, next) => {
  const chaveMobile = req.get("X-Escola-Mobile-Key");
  if (req.session.admin || chaveMobile === localAdmin.chaveMobile) return next();
  return res.status(401).json({ ok: false, msg: "Não autenticado." });
};
const hoje = () => new Date().toISOString().slice(0, 10);
async function senhaConfere(senha, hashArmazenado) {
  if (hashArmazenado.startsWith("$2")) return bcrypt.compare(senha, hashArmazenado);

  // Compatibilidade com generate_password_hash do Werkzeug/Flask.
  const [metodo, salt, hash] = hashArmazenado.split("$");
  if (!metodo || !salt || !hash) return false;
  const esperado = Buffer.from(hash, "base64");
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

app.get("/api/session", (req, res) => res.json({ authenticated: Boolean(req.session.admin), admin: req.session.admin || null }));
app.post("/api/login", async (req, res, next) => { try { const { usuario = "", senha = "" } = req.body;
  // Acesso local simples: configurável em server/credentials.js.
  if (usuario === localAdmin.usuario && senha === localAdmin.senha) { req.session.admin = usuario; return res.json({ ok: true }); }
  const [rows] = await pool.execute("SELECT usuario, senha_hash FROM administradores WHERE usuario=?", [usuario]);
  if (!rows[0] || !(await senhaConfere(senha, rows[0].senha_hash))) return res.status(401).json({ ok: false, msg: "Usuário ou senha inválidos." });
  req.session.admin = rows[0].usuario; res.json({ ok: true });
} catch (e) { next(e); } });
app.post("/api/mobile-login", (req, res) => {
  const { usuario = "", senha = "" } = req.body;
  if (usuario !== localAdmin.usuario || senha !== localAdmin.senha) return res.status(401).json({ ok: false, msg: "Usuário ou senha inválidos." });
  return res.json({ ok: true, chaveMobile: localAdmin.chaveMobile });
});
app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get("/api/dashboard", protegido, async (req, res, next) => { try { const data = hoje(); const [[total], [entradas], [saidas], [negados], [atrasos], ultimos] = await Promise.all([pool.query("SELECT COUNT(*) c FROM alunos"), pool.execute("SELECT COUNT(*) c FROM registros WHERE tipo='ENTRADA' AND DATE(data_hora)=?", [data]), pool.execute("SELECT COUNT(*) c FROM registros WHERE tipo='SAIDA' AND DATE(data_hora)=?", [data]), pool.execute("SELECT COUNT(*) c FROM registros WHERE status='NEGADO' AND DATE(data_hora)=?", [data]), pool.execute("SELECT COUNT(*) c FROM registros WHERE status='ATRASADO' AND DATE(data_hora)=?", [data]), pool.query("SELECT r.tipo, r.status, a.nome, DATE_FORMAT(r.data_hora, '%d/%m %H:%i') dh FROM registros r JOIN alunos a ON a.id=r.aluno_id ORDER BY r.data_hora DESC LIMIT 10")]); res.json({ stats: { total_alunos: total[0].c, entradas_hoje: entradas[0].c, saidas_hoje: saidas[0].c, negados_hoje: negados[0].c, atrasos_hoje: atrasos[0].c }, ultimos }); } catch (e) { next(e); } });

function validarAluno(d) { const campos = ["nome", "matricula", "turma", "responsavel", "telefone"]; const limites = [120, 30, 60, 120, 20]; const aluno = Object.fromEntries(campos.map(c => [c, String(d[c] || "").trim()])); if (!aluno.nome || !aluno.matricula) return [null, "Preencha o nome e a matrícula."]; if (limites.some((n, i) => aluno[campos[i]].length > n)) return [null, "Confira o limite de caracteres dos campos."]; return [aluno]; }
app.get("/api/alunos", protegido, async (req, res, next) => { try { const [rows] = await pool.query("SELECT * FROM alunos ORDER BY nome"); res.json(rows); } catch (e) { next(e); } });
app.post("/api/alunos", protegido, async (req, res, next) => { try { const [aluno, erro] = validarAluno(req.body); if (erro) return res.status(400).json({ ok: false, msg: erro }); await pool.execute("INSERT INTO alunos (nome, matricula, turma, responsavel, telefone, qr_token) VALUES (?, ?, ?, ?, ?, ?)", [...Object.values(aluno), crypto.randomUUID().replaceAll("-", "")]); res.status(201).json({ ok: true, msg: "Aluno cadastrado!" }); } catch (e) { next(e); } });
app.put("/api/alunos/:id", protegido, async (req, res, next) => { try { const [aluno, erro] = validarAluno(req.body); if (erro) return res.status(400).json({ ok: false, msg: erro }); await pool.execute("UPDATE alunos SET nome=?, matricula=?, turma=?, responsavel=?, telefone=?, ativo=? WHERE id=?", [...Object.values(aluno), req.body.ativo !== false, req.params.id]); res.json({ ok: true, msg: "Aluno atualizado." }); } catch (e) { next(e); } });
app.post("/api/alunos/:id/toggle", protegido, async (req, res, next) => { try { await pool.execute("UPDATE alunos SET ativo = NOT ativo WHERE id=?", [req.params.id]); res.json({ ok: true }); } catch (e) { next(e); } });
app.delete("/api/alunos/:id", protegido, async (req, res, next) => { try { await pool.execute("DELETE FROM alunos WHERE id=?", [req.params.id]); res.json({ ok: true, msg: "Aluno removido." }); } catch (e) { next(e); } });
app.get("/api/qrcode/:token", protegido, async (req, res, next) => { try { res.type("png").send(await QRCode.toBuffer(req.params.token, { width: 240, margin: 2 })); } catch (e) { next(e); } });
app.post("/api/validar", async (req, res, next) => { try { const token = String(req.body.token || "").trim(); const [rows] = await pool.execute("SELECT id, nome, ativo FROM alunos WHERE qr_token=?", [token]); if (!rows[0]) return res.json({ ok: false, msg: "❌ QR Code não reconhecido." }); const aluno = rows[0]; if (!aluno.ativo) { await pool.execute("INSERT INTO registros (aluno_id, tipo, metodo, status) VALUES (?, 'ENTRADA', 'QRCODE', 'NEGADO')", [aluno.id]); return res.json({ ok: false, status: "NEGADO", msg: `⛔ NEGADO — ${aluno.nome} desativado.` }); } const [ultimo] = await pool.execute("SELECT tipo FROM registros WHERE aluno_id=? ORDER BY data_hora DESC LIMIT 1", [aluno.id]); const tipo = ultimo[0]?.tipo === "ENTRADA" ? "SAIDA" : "ENTRADA"; let status = "AUTORIZADO", minutos = null, foraPeriodo = false; const agora = new Date(); const minutosDia = agora.getHours() * 60 + agora.getMinutes(); if (tipo === "ENTRADA" && minutosDia > 465) { status = "ATRASADO"; minutos = minutosDia - 465; foraPeriodo = minutosDia > 810; } await pool.execute("INSERT INTO registros (aluno_id, tipo, metodo, status, minutos_atraso) VALUES (?, ?, 'QRCODE', ?, ?)", [aluno.id, tipo, status, minutos]); const msg = status === "ATRASADO" ? `🟠 ENTRADA ATRASADA — ${aluno.nome} — ${foraPeriodo ? "fora do período" : `${minutos} min de atraso`}` : `🟢 ${tipo} AUTORIZADA — ${aluno.nome}`; res.json({ ok: true, status, minutos_atraso: minutos, fora_periodo: foraPeriodo, msg }); } catch (e) { next(e); } });
app.get("/api/registros", protegido, async (req, res, next) => { try { const [rows] = await pool.query("SELECT a.nome, a.turma, r.tipo, r.metodo, r.status, r.minutos_atraso, DATE_FORMAT(r.data_hora, '%d/%m/%Y %H:%i:%s') data_hora FROM registros r JOIN alunos a ON a.id=r.aluno_id ORDER BY r.data_hora DESC LIMIT 300"); res.json(rows); } catch (e) { next(e); } });
app.use((err, req, res, next) => { console.error(err); if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ ok: false, msg: "Matrícula já existe." }); res.status(500).json({ ok: false, msg: "Erro interno do servidor." }); });
const porta = Number(process.env.PORT || 3001);
app.listen(porta, "0.0.0.0", () => console.log(`API disponível em http://localhost:${porta} e na rede local pela porta ${porta}`));
