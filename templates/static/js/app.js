// ================== PÁGINA DE ALUNOS ==================
let ALUNOS = [];

async function carregarAlunos() {
  // 1. Pede a lista de alunos para a API
  ALUNOS = await fetch("/api/alunos").then(r => r.json());

  // 2. Limpa e redesenha a tabela
  const tabela = document.getElementById("tabela-alunos");
  tabela.querySelectorAll("tr:not(:first-child)").forEach(t => t.remove());

  ALUNOS.forEach(a => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${a.nome}</td><td>${a.matricula}</td><td>${a.turma || "-"}</td>
      <td class="${a.ativo ? "verde" : "vermelho"}">${a.ativo ? "Ativo" : "Inativo"}</td>
      <td><img src="/api/qrcode/${a.qr_token}" width="60" alt="QR"><br>
        <a href="/api/qrcode/${a.qr_token}" download="qr_${a.matricula}.png">⬇ Baixar</a></td>
      <td>
        <button class="mini" onclick="editar(${a.id})">✏️</button>
        <button class="mini" onclick="alternar(${a.id})">${a.ativo ? "🚫" : "✅"}</button>
        <button class="mini" onclick="excluir(${a.id})">🗑️</button>
      </td>`;
    tabela.appendChild(tr);
  });
}

// 3. Salvar (cadastra novo OU edita existente)
document.getElementById("form-aluno")?.addEventListener("submit", async e => {
  e.preventDefault();
  const id = document.getElementById("aluno-id").value;
  const corpo = {
    nome: f_nome.value,
    matricula: f_matricula.value,
    turma: f_turma.value,
    responsavel: f_responsavel.value,
    telefone: f_telefone.value
  };
  const r = await fetch(id ? `/api/alunos/${id}` : "/api/alunos", {
    method: id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo)
  }).then(x => x.json());

  alert(r.msg);
  if (r.ok) { limparForm(); carregarAlunos(); }
});

function editar(id) {
  const a = ALUNOS.find(x => x.id === id);
  aluno_id.value = a.id;
  f_nome.value = a.nome;
  f_matricula.value = a.matricula;
  f_turma.value = a.turma || "";
  f_responsavel.value = a.responsavel || "";
  f_telefone.value = a.telefone || "";
  document.getElementById("titulo-form").textContent = "Editar Aluno";
  document.getElementById("btn-cancelar").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function alternar(id) {
  await fetch(`/api/alunos/${id}/toggle`, { method: "POST" });
  carregarAlunos();
}

async function excluir(id) {
  if (!confirm("Excluir este aluno e todo o histórico dele?")) return;
  await fetch(`/api/alunos/${id}`, { method: "DELETE" });
  carregarAlunos();
}

function limparForm() {
  form_aluno.reset();
  aluno_id.value = "";
  document.getElementById("titulo-form").textContent = "Novo Aluno";
  document.getElementById("btn-cancelar").hidden = true;
}
document.getElementById("btn-cancelar")?.addEventListener("click", limparForm);

// ================== PÁGINA DE REGISTROS ==================
async function carregar() {
  const regs = await fetch("/api/registros").then(r => r.json());
  const t = document.getElementById("tabela-registros");
  t.querySelectorAll("tr:not(:first-child)").forEach(x => x.remove());
  regs.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.nome}</td><td>${r.turma || "-"}</td>
      <td>${r.tipo}</td><td>${r.metodo}</td>
      <td class="${r.status === "AUTORIZADO" ? "verde" : "vermelho"}">${r.status}</td>
      <td>${r.data_hora}</td>`;
    t.appendChild(tr);
  });
}