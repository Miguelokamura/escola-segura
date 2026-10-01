let ALUNOS = [];

function $(id) { return document.getElementById(id); }

function mostrarMensagem(texto, sucesso) {
	const mensagem = $("mensagem-aluno");
	if (!mensagem) return;
	mensagem.textContent = texto;
	mensagem.className = `mensagem ${sucesso ? "sucesso" : "erro-mensagem"}`;
}

async function carregarAlunos() {
	const resposta = await fetch("/api/alunos");
	ALUNOS = await resposta.json();
	const tabela = $("tabela-alunos");
	tabela.querySelectorAll("tr:not(:first-child)").forEach(t => t.remove());

	ALUNOS.forEach(a => {
		const tr = document.createElement("tr");
		tr.innerHTML = `
			<td>${a.nome}</td><td>${a.matricula}</td><td>${a.turma || "-"}</td>
			<td class="${a.ativo ? "verde" : "vermelho"}">${a.ativo ? "Ativo" : "Inativo"}</td>
			<td><img src="/api/qrcode/${a.qr_token}" width="60" alt="QR Code de ${a.nome}"><br>
				<a href="/api/qrcode/${a.qr_token}" download="qr_${a.matricula}.png">Baixar</a></td>
			<td>
				<button class="mini" onclick="editar(${a.id})" title="Editar aluno">Editar</button>
				<button class="mini" onclick="alternar(${a.id})" title="Alterar status">${a.ativo ? "Desativar" : "Ativar"}</button>
				<button class="mini" onclick="excluir(${a.id})" title="Excluir aluno">Excluir</button>
			</td>`;
		tabela.appendChild(tr);
	});
}

$("form-aluno")?.addEventListener("submit", async e => {
	e.preventDefault();
	const formulario = e.currentTarget;
	if (!formulario.reportValidity()) return;

	const id = $("aluno-id").value;
	const corpo = {
		nome: $("f-nome").value.trim(),
		matricula: $("f-matricula").value.trim(),
		turma: $("f-turma").value.trim(),
		responsavel: $("f-responsavel").value.trim(),
		telefone: $("f-telefone").value.trim()
	};

	const resposta = await fetch(id ? `/api/alunos/${id}` : "/api/alunos", {
		method: id ? "PUT" : "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(corpo)
	});
	const resultado = await resposta.json();
	mostrarMensagem(resultado.msg, resultado.ok);
	if (resultado.ok) {
		limparForm();
		carregarAlunos();
	}
});

function editar(id) {
	const aluno = ALUNOS.find(x => x.id === id);
	$("aluno-id").value = aluno.id;
	$("f-nome").value = aluno.nome;
	$("f-matricula").value = aluno.matricula;
	$("f-turma").value = aluno.turma || "";
	$("f-responsavel").value = aluno.responsavel || "";
	$("f-telefone").value = aluno.telefone || "";
	$("titulo-form").textContent = "Editar aluno";
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
	$("titulo-form").textContent = "Novo aluno";
	$("btn-cancelar").hidden = true;
}

$("btn-cancelar")?.addEventListener("click", limparForm);

async function carregar() {
	const regs = await fetch("/api/registros").then(r => r.json());
	const tabela = $("tabela-registros");
	tabela.querySelectorAll("tr:not(:first-child)").forEach(x => x.remove());
	regs.forEach(r => {
		const tr = document.createElement("tr");
		tr.innerHTML = `<td>${r.nome}</td><td>${r.turma || "-"}</td>
			<td>${r.tipo}</td><td>${r.metodo}</td>
			<td class="${r.status === "AUTORIZADO" ? "verde" : (r.status === "ATRASADO" ? "laranja" : "vermelho")}">${r.status}</td>
			<td>${r.minutos_atraso == null ? "-" : `${r.minutos_atraso} min`}</td>
			<td>${r.data_hora}</td>`;
		tabela.appendChild(tr);
	});
}
