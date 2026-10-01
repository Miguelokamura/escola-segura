import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { BrowserQRCodeReader } from "@zxing/browser";
import "./styles.css";

const api = async (url, options = {}) => {
  const response = await fetch(`/api${url}`, { headers: { "Content-Type": "application/json", ...options.headers }, ...options });
  if (response.status === 401) throw new Error("Sessão expirada. Faça login novamente.");
  const data = await response.json();
  if (!response.ok) throw new Error(data.msg || "Não foi possível concluir a operação.");
  return data;
};

function Layout({ children }) {
  const navigate = useNavigate();
  async function sair() { await api("/logout", { method: "POST" }); navigate("/login"); }
  return <><nav><span className="logo">🏫 EscolaSegura</span><div><NavLink to="/">Dashboard</NavLink><NavLink to="/alunos">Alunos</NavLink><NavLink to="/scanner">Scanner</NavLink><NavLink to="/registros">Registros</NavLink><button className="link" onClick={sair}>Sair</button></div></nav><main>{children}</main></>;
}

function Login({ setAutenticado }) {
  const [usuario, setUsuario] = useState(""); const [senha, setSenha] = useState(""); const [erro, setErro] = useState(""); const navigate = useNavigate();
  async function entrar(e) { e.preventDefault(); try { await api("/login", { method: "POST", body: JSON.stringify({ usuario, senha }) }); setAutenticado(true); navigate("/"); } catch (e) { setErro(e.message); } }
  return <main className="login-main"><div className="card login-box"><h2>🔐 EscolaSegura</h2>{erro && <p className="erro">{erro}</p>}<form onSubmit={entrar}><input value={usuario} onChange={e => setUsuario(e.target.value)} placeholder="Usuário" required /><input value={senha} onChange={e => setSenha(e.target.value)} type="password" placeholder="Senha" required /><button>Entrar</button></form></div></main>;
}

function Dashboard() {
  const [dados, setDados] = useState(null); const [erro, setErro] = useState("");
  useEffect(() => { api("/dashboard").then(setDados).catch(e => setErro(e.message)); }, []);
  if (erro) return <section className="card"><h1>Não foi possível carregar o dashboard</h1><p>{erro}</p><p>Confira se a API React está rodando e se o MySQL está acessível.</p><button onClick={() => window.location.reload()}>Tentar novamente</button></section>;
  if (!dados) return <p role="status">Carregando dashboard…</p>;
  const cards = [[dados.stats.total_alunos, "Alunos", ""], [dados.stats.entradas_hoje, "Entradas hoje", "verde"], [dados.stats.saidas_hoje, "Saídas hoje", "azul"], [dados.stats.negados_hoje, "Negados hoje", "vermelho"], [dados.stats.atrasos_hoje, "Atrasos hoje", "laranja"]];
  return <><h1>📊 Dashboard</h1><div className="grid-stats">{cards.map(([n, t, c]) => <div className={`card stat ${c}`} key={t}><b>{n}</b><span>{t}</span></div>)}</div><h2>Últimos acessos</h2><table><thead><tr><th>Aluno</th><th>Tipo</th><th>Status</th><th>Data/Hora</th></tr></thead><tbody>{dados.ultimos.length ? dados.ultimos.map((r, i) => <tr key={i}><td>{r.nome}</td><td>{r.tipo}</td><td className={r.status === "AUTORIZADO" ? "verde" : r.status === "ATRASADO" ? "laranja" : "vermelho"}>{r.status}</td><td>{r.dh}</td></tr>) : <tr><td colSpan="4">Nenhum acesso ainda.</td></tr>}</tbody></table></>;
}

const vazio = { nome: "", matricula: "", turma: "", responsavel: "", telefone: "" };
function Alunos() {
  const [alunos, setAlunos] = useState([]), [form, setForm] = useState(vazio), [editando, setEditando] = useState(null), [mensagem, setMensagem] = useState("");
  const carregar = useCallback(() => api("/alunos").then(setAlunos), []); useEffect(() => { carregar(); }, [carregar]);
  function alterar(e) { setForm({ ...form, [e.target.name]: e.target.value }); }
  async function salvar(e) { e.preventDefault(); try { const metodo = editando ? "PUT" : "POST"; await api(editando ? `/alunos/${editando}` : "/alunos", { method: metodo, body: JSON.stringify(form) }); setMensagem("Aluno salvo com sucesso."); setForm(vazio); setEditando(null); carregar(); } catch (e) { setMensagem(e.message); } }
  async function alternar(id) { await api(`/alunos/${id}/toggle`, { method: "POST" }); carregar(); }
  async function excluir(id) { if (window.confirm("Excluir este aluno e todo o histórico dele?")) { await api(`/alunos/${id}`, { method: "DELETE" }); carregar(); } }
  return <><h1>👨‍🎓 Gestão de Alunos</h1><div className="card"><h3>{editando ? "Editar aluno" : "Novo aluno"}</h3>{mensagem && <p className="mensagem">{mensagem}</p>}<form onSubmit={salvar}><input name="nome" value={form.nome} onChange={alterar} placeholder="Nome completo *" minLength="3" maxLength="120" required /><input name="matricula" value={form.matricula} onChange={alterar} placeholder="Matrícula *" maxLength="30" required /><input name="turma" value={form.turma} onChange={alterar} placeholder="Turma" /><input name="responsavel" value={form.responsavel} onChange={alterar} placeholder="Nome do responsável" /><input name="telefone" value={form.telefone} onChange={alterar} placeholder="Telefone" /><button>Salvar</button>{editando && <button type="button" onClick={() => { setForm(vazio); setEditando(null); }}>Cancelar</button>}</form></div><h2>Alunos cadastrados</h2><table><thead><tr><th>Nome</th><th>Matrícula</th><th>Turma</th><th>Status</th><th>QR Code</th><th>Ações</th></tr></thead><tbody>{alunos.map(a => <tr key={a.id}><td>{a.nome}</td><td>{a.matricula}</td><td>{a.turma || "-"}</td><td className={a.ativo ? "verde" : "vermelho"}>{a.ativo ? "Ativo" : "Inativo"}</td><td><img src={`/api/qrcode/${a.qr_token}`} width="60" alt={`QR Code de ${a.nome}`} /></td><td><button className="mini" onClick={() => { setForm(a); setEditando(a.id); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Editar</button><button className="mini" onClick={() => alternar(a.id)}>{a.ativo ? "Desativar" : "Ativar"}</button><button className="mini" onClick={() => excluir(a.id)}>Excluir</button></td></tr>)}</tbody></table></>;
}

function Scanner() {
  const video = useRef(null); const reader = useRef(null); const [resultado, setResultado] = useState(null); const bloqueado = useRef(false);
  useEffect(() => { reader.current = new BrowserQRCodeReader(); reader.current.decodeFromVideoDevice(undefined, video.current, async value => { if (!value || bloqueado.current) return; bloqueado.current = true; try { const r = await api("/validar", { method: "POST", body: JSON.stringify({ token: value.getText() }) }); setResultado(r); try { const ctx = new AudioContext(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.connect(gain); gain.connect(ctx.destination); osc.frequency.value = r.status === "ATRASADO" ? 440 : r.ok ? 880 : 220; osc.type = "sine"; gain.gain.value = 0.15; osc.start(); osc.stop(ctx.currentTime + (r.status === "ATRASADO" ? 0.45 : 0.2)); } catch {} } catch (e) { setResultado({ ok: false, msg: e.message }); } setTimeout(() => { bloqueado.current = false; }, 2500); }); return () => reader.current?.reset(); }, []);
  return <><h1>📷 Controle de Acesso</h1><div className="card scanner-box"><p>Aponte a câmera para o QR Code do aluno</p><video ref={video} className="camera" /><div className={resultado ? (resultado.status === "ATRASADO" ? "resultado atraso-bg" : resultado.ok ? "resultado sucesso-bg" : "resultado falha-bg") : "oculto"}>{resultado?.msg}</div></div></>;
}

function Registros() { const [registros, setRegistros] = useState([]); const carregar = useCallback(() => api("/registros").then(setRegistros), []); useEffect(() => { carregar(); const id = setInterval(carregar, 10000); return () => clearInterval(id); }, [carregar]); return <><h1>📜 Histórico de Acessos</h1><button onClick={carregar}>🔄 Atualizar</button><p>Atualiza automaticamente a cada 10 segundos.</p><table><thead><tr><th>Aluno</th><th>Turma</th><th>Tipo</th><th>Método</th><th>Status</th><th>Atraso</th><th>Data/Hora</th></tr></thead><tbody>{registros.map((r, i) => <tr key={i}><td>{r.nome}</td><td>{r.turma || "-"}</td><td>{r.tipo}</td><td>{r.metodo}</td><td className={r.status === "AUTORIZADO" ? "verde" : r.status === "ATRASADO" ? "laranja" : "vermelho"}>{r.status}</td><td>{r.minutos_atraso == null ? "-" : `${r.minutos_atraso} min`}</td><td>{r.data_hora}</td></tr>)}</tbody></table></>; }

function App() {
  const [autenticado, setAutenticado] = useState(null);
  const [erroSessao, setErroSessao] = useState("");
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => {
    let ativo = true;
    setErroSessao("");
    api("/session")
      .then(d => { if (ativo) setAutenticado(d.authenticated); })
      .catch(e => { if (ativo) { setAutenticado(false); setErroSessao(e.message); } });
    return () => { ativo = false; };
  }, [tentativa]);
  if (autenticado === null) return <main className="login-main"><section className="card"><p role="status">Conectando à API React…</p></section></main>;
  if (erroSessao) return <main className="login-main"><section className="card login-box"><h1>API React indisponível</h1><p>{erroSessao}</p><p>Inicie o terminal <strong>React: iniciar API</strong> e tente novamente.</p><button onClick={() => { setAutenticado(null); setTentativa(n => n + 1); }}>Tentar novamente</button></section></main>;
  const page = C => autenticado ? <Layout><C /></Layout> : <Navigate to="/login" replace />;
  return <Routes><Route path="/login" element={autenticado ? <Navigate to="/" replace /> : <Login setAutenticado={setAutenticado} />} /><Route path="/" element={page(Dashboard)} /><Route path="/alunos" element={page(Alunos)} /><Route path="/scanner" element={page(Scanner)} /><Route path="/registros" element={page(Registros)} /><Route path="*" element={<Navigate to="/" replace />} /></Routes>;
}
createRoot(document.getElementById("root")).render(<BrowserRouter><App /></BrowserRouter>);
