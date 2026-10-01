// ================== PÁGINA DE ALUNOS ==================
let ALUNOS = [];

// Atalho seguro para pegar elementos
function $(id) { return document.getElementById(id); }

async function carregarAlunos() {
  ALUNOS = await fetch("/api/alunos").then(r => r.json());
  const tabela = $("tabela-alunos");
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

 $("form-aluno")?.addEventListener("submit", async e => {
  e.preventDefault();
  const id = $("aluno-id").value;
  const corpo = {
    nome: $("f-nome").value,
    matricula: $("f-matricula").value,
    turma: $("f-turma").value,
    responsavel: $("f-responsavel").value,
    telefone: $("f-telefone").value
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
  $("aluno-id").value = a.id;
  $("f-nome").value = a.nome;
  $("f-matricula").value = a.matricula;
  $("f-turma").value = a.turma || "";
  $("f-responsavel").value = a.responsavel || "";
  $("f-telefone").value = a.telefone || "";
  $("titulo-form").textContent = "Editar Aluno";
  $("btn-cancelar").hidden = false;
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
  $("form-aluno").reset();
  $("aluno-id").value = "";
  $("titulo-form").textContent = "Novo Aluno";
  $("btn-cancelar").hidden = true;
}
 $("btn-cancelar")?.addEventListener("click", limparForm);

// ================== PÁGINA DE REGISTROS ==================
async function carregar() {
  const regs = await fetch("/api/registros").then(r => r.json());
  const t = $("tabela-registros");
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