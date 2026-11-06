import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { BrowserQRCodeReader } from "@zxing/browser";
import "./styles.css";

const API_BASE_URL = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
const api = async (url, options = {}) => {
  const response = await fetch(`${API_BASE_URL}/api${url}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (response.status === 401) throw new Error("Sessão expirada. Faça login novamente.");
  const body = await response.text();
  let data;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    const detalhe = body.trim().slice(0, 160);
    throw new Error(`A API retornou uma resposta inválida (HTTP ${response.status}).${detalhe ? ` ${detalhe}` : " Verifique se a API React está em execução."}`);
  }
  if (!data) throw new Error(`A API respondeu sem conteúdo (HTTP ${response.status}). Verifique se a API React está em execução.`);
  if (!response.ok) throw new Error(data.msg || `Não foi possível concluir a operação (HTTP ${response.status}).`);
  return data;
};

function Layout({ children, user }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [tema, setTema] = useState(() => localStorage.getItem("escola-segura-tema") || "claro");
  const [turmas, setTurmas] = useState([]);
  const [erroTurmas, setErroTurmas] = useState("");
  useEffect(() => { document.documentElement.dataset.theme = tema; localStorage.setItem("escola-segura-tema", tema); }, [tema]);
  useEffect(() => {
    if (user.role !== "professor") return;
    api("/professor/turmas").then(setTurmas).catch(error => setErroTurmas(error.message));
  }, [user.role]);
  async function sair() {
    await api("/logout", { method: "POST" });
    navigate("/login");
  }
  return (
    <>
      <header className="app-header">
        <Link className="app-brand" to="/" aria-label="S.A.F.E School — página inicial">
          <img src="/images/logo-safe-school.png" alt="" />
          <span>S.A.F.E School</span>
        </Link>
        <div className="top-actions">
          <button className="theme-toggle" onClick={() => setTema(tema === "claro" ? "escuro" : "claro")} aria-label="Alternar tema">{tema === "claro" ? "☾ Escuro" : "☀ Claro"}</button>
          <button className="logout-button" onClick={sair}>Sair</button>
        </div>
      </header>
      <aside className="app-sidebar">
        <nav className={`nav-links${user.role === "professor" ? " teacher-nav" : ""}`} aria-label="Navegação principal">
          {user.role === "admin" ? <>
            <NavLink to="/" end><svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7"/><path d="M5 9v12h14V9M9 21v-7h6v7"/></svg><span>Início</span></NavLink>
            <NavLink to="/alunos"><svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="7" r="4"/><path d="M2 21v-2a7 7 0 0 1 14 0v2M16 3.5a4 4 0 0 1 0 7.5M18 14a5 5 0 0 1 4 5v2"/></svg><span>Alunos</span></NavLink>
            <NavLink to="/professores"><svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="7" r="4"/><path d="M2 21v-2a7 7 0 0 1 14 0v2M18 8v6M15 11h6"/></svg><span>Professores</span></NavLink>
            <NavLink to="/scanner"><svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M8 8h3v3H8zM15 8h1M15 11h2M8 15h2M12 14v2M15 15h2v2h-2z"/></svg><span>Scanner</span></NavLink>
            <NavLink to="/registros"><svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h12M9 12h12M9 18h12"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg><span>Registros</span></NavLink>
          </> : <>
            {turmas.map(turma => <NavLink key={turma} to={`/professor?turma=${encodeURIComponent(turma)}`} className={searchParams.get("turma") === turma ? "active" : ""}>
              <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18v14H3zM7 9h10M7 13h6"/></svg><span>{turma}</span>
            </NavLink>)}
            {erroTurmas && <p className="nav-error" role="alert">Não foi possível carregar as turmas.</p>}
            {!erroTurmas && !turmas.length && <span className="nav-empty">Nenhuma turma vinculada</span>}
          </>}
        </nav>
        <div className="sidebar-art" aria-hidden="true" />
      </aside>
      <main className="page-content">{children}</main>
    </>
  );
}

function Login({ setAutenticado }) {
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const navigate = useNavigate();
  const [tema, setTema] = useState(() => localStorage.getItem("escola-segura-tema") || "claro");
  useEffect(() => { document.documentElement.dataset.theme = tema; localStorage.setItem("escola-segura-tema", tema); }, [tema]);

  async function entrar(e) {
    e.preventDefault();
    try {
      const resultado = await api("/login", { method: "POST", body: JSON.stringify({ usuario, senha }) });
      setAutenticado(resultado.user);
      navigate("/");
    } catch (error) {
      setErro(error.message);
    }
  }

  return (
    <main className="login-main login-page">
      <button className="theme-toggle login-theme-toggle" onClick={() => setTema(tema === "claro" ? "escuro" : "claro")}>{tema === "claro" ? "☾ Escuro" : "☀ Claro"}</button>
      <div className="login-layout">
        <section className="login-copy">
          <h1>Mais segurança para nossa escola</h1>
          <ul className="login-benefits">
            <li><span aria-hidden="true">◇</span> Controle de acesso com tecnologia</li>
            <li><span aria-hidden="true">♧</span> Mais proteção para alunos e equipe</li>
            <li><span aria-hidden="true">▣</span> Um ambiente escolar mais seguro</li>
          </ul>
        </section>
        <div className="card login-box">
          <div className="login-box-brand">
            <img src="/images/logo-safe-school.png" alt="" />
            <span>S.A.F.E School</span>
          </div>
          <h2>Acesse sua conta</h2>
          {erro && <p className="erro" role="alert">{erro}</p>}
          <form onSubmit={entrar}>
            <label htmlFor="login-usuario">Usuário</label>
            <input id="login-usuario" value={usuario} onChange={e => setUsuario(e.target.value)} placeholder="Digite seu usuário" autoComplete="username" required />
            <label htmlFor="login-senha">Senha</label>
            <input id="login-senha" value={senha} onChange={e => setSenha(e.target.value)} type="password" placeholder="Digite sua senha" autoComplete="current-password" required />
            <button>Entrar</button>
          </form>
        </div>
      </div>
    </main>
  );
}

const classeStatus = status => status === "AUTORIZADO" ? "verde" : status === "ATRASADO" ? "laranja" : "vermelho";

function Dashboard() {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const carregar = useCallback(() => api("/dashboard").then(setDados).catch(e => setErro(e.message)), []);
  useEffect(() => {
    carregar();
    const timer = setInterval(carregar, 2500);
    return () => clearInterval(timer);
  }, [carregar]);

  if (erro) return <section className="card"><h1>Não foi possível carregar o painel</h1><p>{erro}</p><p>Confira se a API React está rodando e se o MySQL está acessível.</p><button onClick={() => window.location.reload()}>Tentar novamente</button></section>;
  if (!dados) return <p role="status">Carregando painel…</p>;

  const cards = [
    { valor: dados.stats.total_alunos, titulo: "Alunos cadastrados", cor: "cinza", destino: "/alunos", icone: "♧" },
    { valor: dados.stats.entradas_hoje, titulo: "Entradas hoje", cor: "verde", destino: "/registros?tipo=ENTRADA", icone: "→" },
    { valor: dados.stats.saidas_hoje, titulo: "Saídas hoje", cor: "azul", destino: "/registros?tipo=SAIDA", icone: "←" },
    { valor: dados.stats.negados_hoje, titulo: "Acessos negados", cor: "vermelho", destino: "/registros?status=NEGADO", icone: "!" },
    { valor: dados.stats.atrasos_hoje, titulo: "Atrasos hoje", cor: "laranja", destino: "/registros?status=ATRASADO", icone: "◷" },
  ];

  return (
    <>
      <div className="dashboard-heading">
        <div><h1>Olá, Admin!</h1><p>Confira o resumo das atividades da escola hoje.</p></div>
        <Link className="dashboard-all-link" to="/registros">Ver todos os registros <span aria-hidden="true">→</span></Link>
      </div>
      <div className="dashboard-layout">
        <section className="dashboard-main" aria-label="Resumo da escola">
          <div className="grid-stats">
            {cards.map(card => (
              <Link className={`card stat ${card.cor}`} to={card.destino} key={card.titulo}>
                <span className="stat-icon" aria-hidden="true">{card.icone}</span>
                <span>{card.titulo}</span><b>{card.valor}</b><span className="card-hint">Ver detalhes →</span>
              </Link>
            ))}
          </div>
          <section className="card access-card">
            <div className="section-heading"><h2><span aria-hidden="true">◷</span> Últimos acessos</h2><Link to="/registros">Ver todos →</Link></div>
            <div className="table-wrap"><table>
              <thead><tr><th>Aluno</th><th>Tipo</th><th>Status</th><th>Data/Hora</th></tr></thead>
              <tbody>{dados.ultimos.length ? dados.ultimos.map((r, i) => <tr key={`${r.nome}-${i}`}>
                <td>{r.nome}</td><td>{r.tipo === "SAIDA" ? "Saída" : "Entrada"}</td><td className={classeStatus(r.status)}>{r.status}</td><td>{r.dh}</td>
              </tr>) : <tr><td colSpan="4" className="empty-state">Nenhum acesso ainda.</td></tr>}</tbody>
            </table></div>
          </section>
          <div className="security-banner"><span className="security-icon" aria-hidden="true">◇</span><div><strong>Segurança e controle</strong><p>Tecnologia e cuidado para um ambiente escolar mais seguro.</p></div><span className="banner-school" aria-hidden="true">▥</span></div>
        </section>
        <aside className="dashboard-aside">
          <section className="card attention-card">
            <h2><span className="attention-icon" aria-hidden="true">!</span> Atenção</h2>
            <div className="attention-list">
              {dados.ultimos.filter(r => r.status === "NEGADO" || r.status === "ATRASADO").slice(0, 3).map((r, i) => (
                <Link className="attention-item" to={`/registros?status=${r.status}`} key={`${r.nome}-${r.dh}-${i}`}>
                  <span className="attention-item-icon" aria-hidden="true">{r.status === "NEGADO" ? "!" : "◷"}</span>
                  <span><strong>{r.status === "NEGADO" ? "Acesso não autorizado" : "Acesso atrasado"}</strong><small>{r.nome} · {r.dh}</small></span>
                </Link>
              ))}
              {!dados.ultimos.some(r => r.status === "NEGADO" || r.status === "ATRASADO") && <p className="attention-empty">Nenhum alerta recente.</p>}
            </div>
          </section>
          <section className="card quick-actions">
            <h2><span className="attention-icon" aria-hidden="true">ϟ</span> Ações rápidas</h2>
            <Link to="/alunos" className="quick-action"><span aria-hidden="true">♧</span><strong>Cadastrar aluno</strong></Link>
            <Link to="/scanner" className="quick-action"><span aria-hidden="true">⌗</span><strong>Abrir scanner</strong></Link>
            <Link to="/registros" className="quick-action"><span aria-hidden="true">▤</span><strong>Ver registros</strong></Link>
          </section>
        </aside>
      </div>
    </>
  );
}

const vazio = { nome: "", matricula: "", turma: "", sala: "", curso_tecnico: "", responsavel: "", telefone: "" };
const anosEscolares = [
  ...Array.from({ length: 9 }, (_, i) => `${i + 1}º ano do Ensino Fundamental`),
  ...Array.from({ length: 3 }, (_, i) => `${i + 1}º ano do Ensino Médio`),
];
const cursosTecnicosSenai = [
  "Administração", "Agroindústria", "Alimentos", "Análises Químicas",
  "Análise e Desenvolvimento de Sistemas (ADS)", "Automação Industrial", "Biotecnologia", "Calçados",
  "Celulose e Papel", "Cerâmica", "Cervejaria", "Comunicação Visual", "Construção Naval",
  "Comércio Exterior", "Desenho de Construção Civil", "Desenvolvimento de Sistemas",
  "Design de Calçados", "Design Gráfico", "Edificações", "Eletroeletrônica",
  "Eletromecânica", "Eletrônica", "Eletrotécnica", "Fabricação Mecânica", "Farmácia",
  "Finanças", "Impressão Offset", "Informática", "Instrumentação Industrial",
  "Jogos Digitais", "Logística", "Manutenção Aeronáutica", "Manutenção Automotiva",
  "Manutenção de Máquinas Industriais", "Manutenção de Máquinas Pesadas", "Mecânica",
  "Mecatrônica", "Meio Ambiente", "Mineração", "Modelagem do Vestuário", "Multimídia",
  "Nutrição e Dietética", "Panificação", "Petróleo e Gás", "Plásticos", "Portos",
  "Produção de Áudio e Vídeo", "Qualidade", "Química", "Redes de Computadores",
  "Refrigeração e Climatização", "Saneamento", "Segurança do Trabalho", "Soldagem",
  "Sistemas de Energia Renovável", "Telecomunicações", "Têxtil", "Vestuário",
];
function Alunos() {
  const [alunos, setAlunos] = useState([]);
  const [form, setForm] = useState(vazio);
  const [editando, setEditando] = useState(null);
  const [mensagem, setMensagem] = useState("");
  const [busca, setBusca] = useState("");
  const carregar = useCallback(() => api("/alunos").then(setAlunos).catch(e => setMensagem(e.message)), []);
  useEffect(() => { carregar(); }, [carregar]);

  const alunosFiltrados = alunos.filter(a => {
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    return !termo || a.nome.toLocaleLowerCase("pt-BR").includes(termo) || String(a.matricula).toLocaleLowerCase("pt-BR").includes(termo);
  });
  const cursoTecnicoObrigatorio = form.turma === "2º ano do Ensino Médio" || form.turma === "3º ano do Ensino Médio";

  function alterar(e) {
    const { name, value } = e.target;
    setForm({
      ...form,
      [name]: value,
      ...(name === "turma" ? {
        sala: "",
        ...(!["2º ano do Ensino Médio", "3º ano do Ensino Médio"].includes(value) ? { curso_tecnico: "" } : {}),
      } : {}),
    });
  }
  async function salvar(e) {
    e.preventDefault();
    try {
      const metodo = editando ? "PUT" : "POST";
      const dadosAluno = { ...form, turma: form.sala ? `${form.turma} - Sala ${form.sala}` : form.turma };
      await api(editando ? `/alunos/${editando}` : "/alunos", { method: metodo, body: JSON.stringify(dadosAluno) });
      setMensagem("Aluno salvo com sucesso.");
      setForm(vazio);
      setEditando(null);
      carregar();
    } catch (error) { setMensagem(error.message); }
  }
  async function alternar(id) {
    try { await api(`/alunos/${id}/toggle`, { method: "POST" }); carregar(); }
    catch (error) { setMensagem(error.message); }
  }
  async function excluir(id) {
    if (!window.confirm("Excluir este aluno e todo o histórico dele?")) return;
    try { await api(`/alunos/${id}`, { method: "DELETE" }); carregar(); }
    catch (error) { setMensagem(error.message); }
  }

  return (
    <>
      <h1>Gestão de Alunos</h1>
      <section className="card form-card">
        <div className="form-heading">
          <div><span className="form-kicker">CADASTRO ESCOLAR</span><h2>{editando ? "Editar aluno" : "Cadastrar aluno"}</h2></div>
          <p>Preencha os dados para manter o controle de acesso atualizado.</p>
        </div>
        {mensagem && <p className="mensagem" role="status">{mensagem}</p>}
        <p className="required-note"><span aria-hidden="true">*</span> Campos obrigatórios</p>
        <form className="student-form" onSubmit={salvar}>
          <div className="form-section-title"><h3>Dados do aluno</h3><p>Informações para identificar o estudante.</p></div>
          <div className="form-field"><label htmlFor="aluno-nome">Nome completo <span>*</span></label><input id="aluno-nome" name="nome" value={form.nome} onChange={alterar} placeholder="Ex.: Ana Souza" autoComplete="name" minLength="3" maxLength="120" required /></div>
          <div className="form-field"><label htmlFor="aluno-matricula">RM / Matrícula <span>*</span></label><input id="aluno-matricula" name="matricula" value={form.matricula} onChange={alterar} placeholder="Número de matrícula" maxLength="30" required /></div>
          <div className="form-field"><label htmlFor="aluno-turma">Ano escolar <span>*</span></label>
            <select id="aluno-turma" name="turma" value={form.turma} onChange={alterar} required>
              <option value="">Selecione o ano escolar</option>
              {form.turma && !anosEscolares.includes(form.turma) && <option value={form.turma}>{form.turma}</option>}
              <optgroup label="Ensino Fundamental">{anosEscolares.slice(0, 9).map(ano => <option key={ano} value={ano}>{ano}</option>)}</optgroup>
              <optgroup label="Ensino Médio">{anosEscolares.slice(9).map(ano => <option key={ano} value={ano}>{ano}</option>)}</optgroup>
            </select>
          </div>
          {!!form.turma && <div className="form-field"><label htmlFor="aluno-sala">Sala <span>*</span></label>
            <select id="aluno-sala" name="sala" value={form.sala} onChange={alterar} required>
              <option value="">Selecione a sala</option>
              <option value="A">Sala A</option>
              <option value="B">Sala B</option>
            </select>
          </div>}
          {cursoTecnicoObrigatorio && <div className="form-field"><label htmlFor="aluno-curso-tecnico">Curso técnico <span>*</span></label>
            <select id="aluno-curso-tecnico" name="curso_tecnico" value={form.curso_tecnico} onChange={alterar} required>
              <option value="">Selecione o curso técnico</option>
              {cursosTecnicosSenai.map(curso => <option key={curso} value={curso}>{curso}</option>)}
            </select>
          </div>}
          <div className="form-section-title"><h3>Contato do responsável</h3><p>Use os dados de quem a escola deve contatar.</p></div>
          <div className="form-field"><label htmlFor="aluno-responsavel">Nome do responsável <span>*</span></label><input id="aluno-responsavel" name="responsavel" value={form.responsavel} onChange={alterar} placeholder="Nome completo" autoComplete="name" maxLength="120" required /></div>
          <div className="form-field"><label htmlFor="aluno-telefone">Telefone do responsável <span>*</span></label><input id="aluno-telefone" name="telefone" type="tel" value={form.telefone} onChange={alterar} placeholder="(11) 91234-5678" autoComplete="tel" maxLength="20" required /></div>
          <div className="form-actions">
            <button type="submit">{editando ? "Salvar alterações" : "Cadastrar aluno"}</button>
            {editando && <button className="button-secondary" type="button" onClick={() => { setForm(vazio); setEditando(null); }}>Cancelar</button>}
          </div>
        </form>
      </section>

      <section className="list-heading">
        <div><h2>Alunos cadastrados</h2><p>{alunosFiltrados.length} de {alunos.length} alunos</p></div>
        <input className="search-input" type="search" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por nome ou RM" aria-label="Buscar aluno por nome ou RM" />
      </section>
      <div className="table-wrap"><table className="students-table">
        <thead><tr><th>Nome</th><th>RM</th><th>Ano escolar / Curso técnico</th><th>Status</th><th>QR Code</th><th>Ações</th></tr></thead>
        <tbody>{alunosFiltrados.length ? alunosFiltrados.map(a => <tr key={a.id}>
          <td data-label="Nome">{a.nome}</td><td data-label="RM">{a.matricula}</td><td data-label="Ano escolar / Curso técnico">{a.turma}{a.curso_tecnico && <><br /><small>Curso técnico: {a.curso_tecnico}</small></>}</td>
          <td data-label="Status" className={a.ativo ? "verde" : "vermelho"}>{a.ativo ? "Ativo" : "Inativo"}</td>
          <td data-label="QR Code"><img src={`/api/qrcode/${a.qr_token}`} width="60" alt={`QR Code de ${a.nome}`} /></td>
          <td data-label="Ações" className="actions-cell">
            <button className="mini button-secondary button-edit" onClick={() => {
              const turmaComSala = String(a.turma || "").match(/^(.*) - Sala ([AB])$/);
              setForm({ ...vazio, ...a, turma: turmaComSala ? turmaComSala[1] : a.turma, sala: turmaComSala ? turmaComSala[2] : "" });
              setEditando(a.id); setMensagem(""); window.scrollTo({ top: 0, behavior: "smooth" });
            }}>Editar</button>
            <button className={`mini ${a.ativo ? "button-deactivate" : "button-success"}`} onClick={() => alternar(a.id)}>{a.ativo ? "Desativar" : "Ativar"}</button>
            <button className="mini button-danger" onClick={() => excluir(a.id)}>Excluir</button>
          </td>
        </tr>) : <tr><td className="empty-state" colSpan="6">{busca ? "Nenhum aluno encontrado para essa busca." : "Nenhum aluno cadastrado."}</td></tr>}</tbody>
      </table></div>
    </>
  );
}

function Professores() {
  const [nome, setNome] = useState("");
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [turmas, setTurmas] = useState([]);
  const [selecionadas, setSelecionadas] = useState([]);
  const [professores, setProfessores] = useState([]);
  const [editando, setEditando] = useState(null);
  const [alterandoStatus, setAlterandoStatus] = useState(null);
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    try {
      const [listaTurmas, listaProfessores] = await Promise.all([
        api("/professores/turmas"), api("/professores"),
      ]);
      setTurmas(listaTurmas);
      setProfessores(listaProfessores);
      setErro("");
    } catch (error) { setErro(error.message); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  function alternarTurma(turma) {
    setSelecionadas(lista => lista.includes(turma)
      ? lista.filter(item => item !== turma)
      : [...lista, turma]);
  }
  function editar(professor) {
    setEditando(professor.id);
    setNome(professor.nome);
    setUsuario(professor.usuario);
    setSenha("");
    setSelecionadas(professor.turmas_lista);
    setMensagem("");
    setErro("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function cancelarEdicao() {
    setEditando(null);
    setNome("");
    setUsuario("");
    setSenha("");
    setSelecionadas([]);
    setMensagem("");
    setErro("");
  }
  async function salvar(e) {
    e.preventDefault();
    setErro("");
    setMensagem("");
    try {
      const resposta = await api(editando ? `/professores/${editando}` : "/professores", {
        method: editando ? "PUT" : "POST",
        body: JSON.stringify({ nome, usuario, senha, turmas: selecionadas }),
      });
      cancelarEdicao();
      setMensagem(resposta.msg);
      await carregar();
    } catch (error) { setErro(error.message); }
  }
  async function alternarStatus(professor) {
    const acao = professor.ativo ? "desativar" : "ativar";
    if (professor.ativo && !window.confirm(`Desativar o perfil de ${professor.nome}? O professor perderá o acesso à aplicação.`)) return;
    setAlterandoStatus(professor.id);
    setErro("");
    setMensagem("");
    try {
      const resposta = await api(`/professores/${professor.id}/toggle`, { method: "POST" });
      setMensagem(resposta.msg || `Perfil ${acao}do.`);
      await carregar();
    } catch (error) { setErro(error.message); }
    finally { setAlterandoStatus(null); }
  }

  return <>
    <h1>Cadastro de Professores</h1>
    <section className="card form-card">
      <div className="form-heading">
        <div><span className="form-kicker">ACESSO DOCENTE</span><h2>{editando ? "Editar perfil do professor" : "Novo professor"}</h2></div>
        <p>{editando ? "Atualize os dados e as turmas vinculadas ao professor." : "Crie o acesso e vincule as turmas que o professor poderá acompanhar."}</p>
      </div>
      {mensagem && <p className="mensagem" role="status">{mensagem}</p>}
      {erro && <p className="erro" role="alert">{erro}</p>}
      <form className="teacher-form" onSubmit={salvar}>
        <div className="form-field"><label htmlFor="professor-nome">Nome completo</label><input id="professor-nome" value={nome} onChange={e => setNome(e.target.value)} minLength="3" maxLength="120" autoComplete="name" required /></div>
        <div className="form-field"><label htmlFor="professor-usuario">Usuário de acesso</label><input id="professor-usuario" value={usuario} onChange={e => setUsuario(e.target.value)} minLength="3" maxLength="50" autoComplete="username" required /></div>
        {!editando && <div className="form-field"><label htmlFor="professor-senha">Senha inicial</label><input id="professor-senha" type="password" value={senha} onChange={e => setSenha(e.target.value)} minLength="8" maxLength="128" autoComplete="new-password" required /><small>Mínimo de 8 caracteres.</small></div>}
        <fieldset className="teacher-classes">
          <legend>Turmas vinculadas</legend>
          {turmas.length ? turmas.map(turma => <label key={turma}><input type="checkbox" checked={selecionadas.includes(turma)} onChange={() => alternarTurma(turma)} />{turma}</label>) : <p>Nenhuma turma cadastrada nos alunos.</p>}
        </fieldset>
        <div className="form-actions">
          <button type="submit" disabled={!turmas.length}>{editando ? "Salvar alterações" : "Cadastrar professor"}</button>
          {editando && <button className="button-secondary" type="button" onClick={cancelarEdicao}>Cancelar</button>}
        </div>
      </form>
    </section>
    <section className="card teacher-list">
      <div className="list-heading"><div><h2>Professores cadastrados</h2><p>{professores.length} professor(es)</p></div></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Nome</th><th>Usuário</th><th>Turmas</th><th>Status</th><th>Ações</th></tr></thead>
        <tbody>{professores.length ? professores.map(professor => <tr key={professor.id}>
          <td>{professor.nome}</td><td>{professor.usuario}</td><td>{professor.turmas || "—"}</td>
          <td className={professor.ativo ? "verde" : "vermelho"}>{professor.ativo ? "Ativo" : "Inativo"}</td>
          <td className="actions-cell">
            <button className="mini button-secondary button-edit" type="button" onClick={() => editar(professor)}>Editar</button>
            <button className={`mini ${professor.ativo ? "button-deactivate" : "button-success"}`} type="button" disabled={alterandoStatus === professor.id} onClick={() => alternarStatus(professor)}>{alterandoStatus === professor.id ? "Salvando…" : professor.ativo ? "Desativar" : "Ativar"}</button>
          </td>
        </tr>) : <tr><td className="empty-state" colSpan="5">Nenhum professor cadastrado.</td></tr>}</tbody>
      </table></div>
    </section>
  </>;
}

function PresencaProfessor() {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const turma = searchParams.get("turma") || "";
  const carregar = useCallback(async () => {
    try {
      const query = turma ? `?turma=${encodeURIComponent(turma)}` : "";
      setDados(await api(`/professor/presencas${query}`));
      setErro("");
    }
    catch (error) { setErro(error.message); }
  }, [turma]);
  useEffect(() => {
    carregar();
    const timer = setInterval(carregar, 10000);
    return () => clearInterval(timer);
  }, [carregar]);
  useEffect(() => {
    if (dados?.turmas.length && !turma) {
      setSearchParams({ turma: dados.turmas[0] }, { replace: true });
    }
  }, [dados, setSearchParams, turma]);

  if (erro) return <section className="card"><h1>Não foi possível carregar as presenças</h1><p role="alert">{erro}</p><button onClick={carregar}>Tentar novamente</button></section>;
  if (!dados) return <p role="status">Carregando presenças…</p>;

  const alunos = dados.alunos;
  const presentes = alunos.filter(aluno => aluno.tipo === "ENTRADA");
  const atrasados = alunos.filter(aluno => aluno.status_entrada === "ATRASADO");
  return <>
    <div className="dashboard-heading">
      <div><h1>{turma || "Minhas turmas"}</h1><p>Presença dos alunos atualizada automaticamente.</p></div>
    </div>
    <div className="teacher-summary">
      <section className="card"><span>Presentes</span><strong>{presentes.length}</strong></section>
      <section className="card"><span>Chegaram atrasados</span><strong>{atrasados.length}</strong></section>
      <section className="card"><span>Sem entrada registrada</span><strong>{alunos.filter(aluno => !aluno.status_entrada).length}</strong></section>
    </div>
    <section className="card teacher-list">
      <div className="list-heading"><div><h2>Alunos de hoje</h2><p>{alunos.length} aluno(s) nas turmas selecionadas</p></div></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Aluno</th><th>Turma</th><th>Presença</th><th>Entrada</th><th>Saída</th></tr></thead>
        <tbody>{alunos.length ? alunos.map(aluno => {
          const presente = aluno.tipo === "ENTRADA";
          const chegouAtrasado = aluno.status_entrada === "ATRASADO";
          const status = !aluno.status_entrada ? "Ainda não chegou" : presente ? chegouAtrasado ? "Presente — atrasado" : "Presente" : chegouAtrasado ? "Saiu — chegou atrasado" : "Saiu";
          return <tr key={`${aluno.matricula}-${aluno.turma}`}>
            <td>{aluno.nome}</td><td>{aluno.turma}</td>
            <td className={!aluno.status_entrada ? "" : chegouAtrasado ? "laranja" : presente ? "verde" : "azul"}>{status}</td>
            <td>{aluno.data_hora_entrada || "—"}</td>
            <td>{aluno.data_hora_saida || "—"}</td>
          </tr>;
        }) : <tr><td className="empty-state" colSpan="5">Não há alunos nas turmas vinculadas.</td></tr>}</tbody>
      </table></div>
    </section>
  </>;
}

function Scanner() {
  const video = useRef(null);
  const reader = useRef(null);
  const [resultado, setResultado] = useState(null);
  const [justificativa, setJustificativa] = useState("");
  const [justificativaSalva, setJustificativaSalva] = useState(false);
  const [erroJustificativa, setErroJustificativa] = useState("");
  const [salvandoJustificativa, setSalvandoJustificativa] = useState(false);
  const bloqueado = useRef(false);
  const aguardandoJustificativa = useRef(false);
  useEffect(() => {
    reader.current = new BrowserQRCodeReader();
    reader.current.decodeFromVideoDevice(undefined, video.current, async value => {
      if (!value || bloqueado.current) return;
      bloqueado.current = true;
      try {
        const r = await api("/validar", { method: "POST", body: JSON.stringify({ token: value.getText() }) });
        setResultado(r);
        setJustificativa("");
        setJustificativaSalva(false);
        setErroJustificativa("");
        aguardandoJustificativa.current = Boolean(r.solicitar_justificativa);
        try {
          const ctx = new AudioContext(); const osc = ctx.createOscillator(); const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination); osc.frequency.value = r.status === "ATRASADO" ? 440 : r.ok ? 880 : 220;
          osc.type = "sine"; gain.gain.value = 0.15; osc.start(); osc.stop(ctx.currentTime + (r.status === "ATRASADO" ? 0.45 : 0.2));
        } catch {}
      } catch (error) {
        setResultado({ ok: false, msg: error.message });
        setJustificativaSalva(false);
        setErroJustificativa("");
        aguardandoJustificativa.current = false;
      }
      if (!aguardandoJustificativa.current) setTimeout(() => { bloqueado.current = false; }, 2500);
    });
    return () => reader.current?.reset();
  }, []);
  async function enviarJustificativa(e) {
    e.preventDefault();
    setSalvandoJustificativa(true);
    setErroJustificativa("");
    try {
      await api(`/registros/${resultado.registro_id}/justificativa`, {
        method: "POST", body: JSON.stringify({ justificativa }),
      });
      setJustificativaSalva(true);
      aguardandoJustificativa.current = false;
      setTimeout(() => { bloqueado.current = false; }, 1800);
    } catch (error) { setErroJustificativa(error.message); }
    finally { setSalvandoJustificativa(false); }
  }
  const statusAtual = resultado?.status || (resultado ? (resultado.ok ? "AUTORIZADO" : "NEGADO") : "");
  return <>
    <h1>Controle de Acesso</h1>
    <div className="scanner-layout">
      <section className="card scanner-box">
        <p>Aponte a câmera para o QR Code do aluno</p>
        <video ref={video} className="camera" />
        <p className="scanner-camera-hint" role="status">A câmera fará a leitura automaticamente.</p>
      </section>
      <aside className="card scanner-details" aria-live="polite">
        <span className="form-kicker">ÚLTIMA LEITURA</span>
        <h2>Dados do acesso</h2>
        <dl>
          <div><dt>Aluno</dt><dd>{resultado?.aluno?.nome || "Aguardando leitura"}</dd></div>
          <div><dt>Turma</dt><dd>{resultado?.aluno?.turma || "—"}</dd></div>
          <div><dt>Movimento</dt><dd>{resultado?.tipo === "ENTRADA" ? "Entrada" : resultado?.tipo === "SAIDA" ? "Saída" : "—"}</dd></div>
          <div><dt>Status</dt><dd className={statusAtual ? classeStatus(statusAtual) : "scanner-muted"}>{statusAtual || "Aguardando QR Code"}</dd></div>
        </dl>
        {resultado && <div className={`scanner-message ${statusAtual === "ATRASADO" ? "atraso-bg" : resultado.ok ? "sucesso-bg" : "falha-bg"}`}>
          <p>{resultado.msg}</p>
        </div>}
        {resultado?.solicitar_justificativa && !justificativaSalva && <form className="justification-form" onSubmit={enviarJustificativa}>
          <label htmlFor="scanner-justificativa">Justificativa <span>*</span></label>
          <textarea id="scanner-justificativa" value={justificativa} onChange={e => setJustificativa(e.target.value)} maxLength="500" rows="4" placeholder="Explique o motivo da tentativa antes de completar 1 hora." required />
          <small>Até 500 caracteres. O registro continuará como negado.</small>
          {erroJustificativa && <p className="erro" role="alert">{erroJustificativa}</p>}
          <button type="submit" disabled={salvandoJustificativa}>{salvandoJustificativa ? "Salvando…" : "Salvar justificativa"}</button>
        </form>}
        {justificativaSalva && <p className="justification-saved" role="status">Justificativa registrada.</p>}
      </aside>
    </div>
  </>;
}

function TabelaRegistros({ titulo, registros }) {
  return (
    <section className="records-section">
      <h2>{titulo} <span className="count-badge">{registros.length}</span></h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Aluno</th><th>Turma</th><th>Status</th><th>Método</th><th>Aulas de atraso</th><th>Justificativa</th><th>Data/Hora</th></tr></thead>
        <tbody>{registros.length ? registros.map((r, i) => <tr key={`${r.nome}-${r.data_hora}-${i}`}>
          <td data-label="Aluno">{r.nome}</td><td data-label="Turma">{r.turma || "-"}</td><td data-label="Status" className={classeStatus(r.status)}>{r.status}</td>
          <td data-label="Método">{r.metodo}</td><td data-label="Aulas de atraso">{r.aulas_atraso == null ? "-" : `${r.aulas_atraso} ${Number(r.aulas_atraso) === 1 ? "aula" : "aulas"}`}</td>
          <td data-label="Justificativa">{r.justificativa || "-"}</td><td data-label="Data/Hora">{r.data_hora}</td>
        </tr>) : <tr><td colSpan="7" className="empty-state">Nenhum registro nesta categoria.</td></tr>}</tbody>
      </table></div>
    </section>
  );
}

function Registros() {
  const [registros, setRegistros] = useState([]);
  const [erro, setErro] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const tipo = searchParams.get("tipo") || "TODOS";
  const status = searchParams.get("status") || "TODOS";
  const carregar = useCallback(async () => {
    setBuscando(true);
    try { setRegistros(await api("/registros")); setErro(""); }
    catch (error) { setErro(error.message); }
    finally { setBuscando(false); }
  }, []);
  useEffect(() => { carregar(); const id = setInterval(carregar, 2500); return () => clearInterval(id); }, [carregar]);

  const registrosFiltrados = registros.filter(r => (tipo === "TODOS" || r.tipo === tipo) && (status === "TODOS" || r.status === status));
  const entradas = registrosFiltrados.filter(r => r.tipo === "ENTRADA");
  const saidas = registrosFiltrados.filter(r => r.tipo === "SAIDA");
  function alterarFiltro(chave, valor) {
    const novos = new URLSearchParams(searchParams);
    if (valor === "TODOS") novos.delete(chave); else novos.set(chave, valor);
    setSearchParams(novos);
  }

  return (
    <>
      <div className="page-title-row"><div><h1>Histórico de Acessos</h1><p>Atualiza automaticamente a cada 10 segundos.</p></div><button className="button-secondary" onClick={carregar} disabled={buscando}>{buscando ? "Atualizando…" : "Atualizar"}</button></div>
      <section className="card filters-card" aria-label="Filtros dos registros">
        <label>Tipo de acesso<select value={tipo} onChange={e => alterarFiltro("tipo", e.target.value)}><option value="TODOS">Entradas e saídas</option><option value="ENTRADA">Somente entradas</option><option value="SAIDA">Somente saídas</option></select></label>
        <label>Status<select value={status} onChange={e => alterarFiltro("status", e.target.value)}><option value="TODOS">Todos os status</option><option value="ATRASADO">Atrasados</option><option value="NEGADO">Negados</option><option value="AUTORIZADO">Autorizados</option></select></label>
        {(tipo !== "TODOS" || status !== "TODOS") && <button className="clear-filters" onClick={() => setSearchParams({})}>Limpar filtros</button>}
      </section>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {tipo === "TODOS" ? <div className="records-grid"><TabelaRegistros titulo="Entradas" registros={entradas} /><TabelaRegistros titulo="Saídas" registros={saidas} /></div> : <TabelaRegistros titulo={tipo === "ENTRADA" ? "Entradas" : "Saídas"} registros={registrosFiltrados} />}
    </>
  );
}

function App() {
  const [autenticado, setAutenticado] = useState(null);
  const [erroSessao, setErroSessao] = useState("");
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => {
    let ativo = true;
    setErroSessao("");
    api("/session").then(d => { if (ativo) setAutenticado(d.user); }).catch(e => {
      if (ativo) { setAutenticado(false); setErroSessao(e.message); }
    });
    return () => { ativo = false; };
  }, [tentativa]);
  if (autenticado === null) return <main className="login-main"><section className="card"><p role="status">Conectando à API React…</p></section></main>;
  if (erroSessao) return <main className="login-main"><section className="card login-box"><h1>API React indisponível</h1><p>{erroSessao}</p><p>Inicie o terminal <strong>React: iniciar API</strong> e tente novamente.</p><button onClick={() => { setAutenticado(null); setTentativa(n => n + 1); }}>Tentar novamente</button></section></main>;
  const adminPage = C => !autenticado
    ? <Navigate to="/login" replace />
    : autenticado.role !== "admin"
      ? <Navigate to="/professor" replace />
      : <Layout user={autenticado}><C /></Layout>;
  const teacherPage = C => !autenticado
    ? <Navigate to="/login" replace />
    : autenticado.role !== "professor"
      ? <Navigate to="/" replace />
      : <Layout user={autenticado}><C /></Layout>;
  const destino = autenticado?.role === "professor" ? "/professor" : "/";
  return <Routes>
    <Route path="/login" element={autenticado ? <Navigate to={destino} replace /> : <Login setAutenticado={setAutenticado} />} />
    <Route path="/" element={adminPage(Dashboard)} />
    <Route path="/alunos" element={adminPage(Alunos)} />
    <Route path="/professores" element={adminPage(Professores)} />
    <Route path="/scanner" element={adminPage(Scanner)} />
    <Route path="/registros" element={adminPage(Registros)} />
    <Route path="/professor" element={teacherPage(PresencaProfessor)} />
    <Route path="*" element={<Navigate to={destino} replace />} />
  </Routes>;
}

document.documentElement.dataset.theme = localStorage.getItem("escola-segura-tema") || "claro";
createRoot(document.getElementById("root")).render(<BrowserRouter>
  <App />
</BrowserRouter>);
