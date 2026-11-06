const tabelaPresencas = document.getElementById("tabela-presencas");
const erroPresencas = document.getElementById("erro-presencas");
let dadosPresencas = null;
const turmaSelecionada = new URLSearchParams(window.location.search).get("turma") || "";

function desenharPresencas() {
  if (!dadosPresencas) return;
  const alunos = dadosPresencas.alunos;
  const presentes = alunos.filter(aluno => aluno.tipo === "ENTRADA");
  const atrasados = alunos.filter(aluno => aluno.status_entrada === "ATRASADO");
  document.getElementById("total-presentes").textContent = presentes.length;
  document.getElementById("total-atrasados").textContent = atrasados.length;
  document.getElementById("total-nao-chegaram").textContent = alunos.filter(aluno => !aluno.status_entrada).length;
  document.getElementById("total-alunos").textContent = `${alunos.length} aluno(s) nas turmas selecionadas`;
  tabelaPresencas.replaceChildren();

  if (!alunos.length) {
    const linha = document.createElement("tr");
    const celula = document.createElement("td");
    celula.className = "empty-state";
    celula.colSpan = 5;
    celula.textContent = "Não há alunos nas turmas vinculadas.";
    linha.append(celula);
    tabelaPresencas.append(linha);
    return;
  }

  alunos.forEach(aluno => {
    const linha = document.createElement("tr");
    const presente = aluno.tipo === "ENTRADA";
    const chegouAtrasado = aluno.status_entrada === "ATRASADO";
    const status = !aluno.status_entrada ? "Ainda não chegou" : presente
      ? chegouAtrasado ? "Presente — atrasado" : "Presente"
      : chegouAtrasado ? "Saiu — chegou atrasado" : "Saiu";
    const classe = !aluno.status_entrada ? "" : chegouAtrasado
      ? "laranja" : presente ? "verde" : "azul";
    [aluno.nome, aluno.turma, status, aluno.data_hora_entrada || "—", aluno.data_hora_saida || "—"].forEach((valor, indice) => {
      const celula = document.createElement("td");
      celula.textContent = valor || "—";
      if (indice === 2) celula.className = classe;
      linha.append(celula);
    });
    tabelaPresencas.append(linha);
  });
}

async function carregarPresencas() {
  try {
    const query = turmaSelecionada ? `?turma=${encodeURIComponent(turmaSelecionada)}` : "";
    const resposta = await fetch(`/api/professor/presencas${query}`);
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(dados.msg || "Não foi possível carregar as presenças.");
    dadosPresencas = dados;
    erroPresencas.hidden = true;
    desenharPresencas();
  } catch (erro) {
    erroPresencas.textContent = erro.message;
    erroPresencas.hidden = false;
  }
}

carregarPresencas();
window.setInterval(carregarPresencas, 10000);
