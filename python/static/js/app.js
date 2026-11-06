let ALUNOS = [];
let REGISTROS = [];
let BUSCA_ALUNOS = "";

function $(id) { return document.getElementById(id); }

function escaparHtml(valor) {
	const elemento = document.createElement("span");
	elemento.textContent = String(valor ?? "");
	return elemento.innerHTML;
}

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

	const filtrados = ALUNOS.filter(a => {
		const termo = BUSCA_ALUNOS.trim().toLocaleLowerCase("pt-BR");
		return !termo || a.nome.toLocaleLowerCase("pt-BR").includes(termo) || String(a.matricula).toLocaleLowerCase("pt-BR").includes(termo);
	});
	const contagem = $("contagem-alunos");
	if (contagem) contagem.textContent = `${filtrados.length} de ${ALUNOS.length} alunos`;
	filtrados.forEach(a => {
		const tr = document.createElement("tr");
		tr.className = "student-row";
		tr.innerHTML = `
			<td>${escaparHtml(a.nome)}</td><td>${escaparHtml(a.matricula)}</td><td>${escaparHtml(a.turma || "-")}${a.curso_tecnico ? `<br><small>Curso técnico: ${escaparHtml(a.curso_tecnico)}</small>` : ""}</td>
			<td class="${a.ativo ? "verde" : "vermelho"}">${a.ativo ? "Ativo" : "Inativo"}</td>
			<td><img src="/api/qrcode/${a.qr_token}" width="60" alt="QR Code de ${a.nome}"><br>
				<a href="/api/qrcode/${a.qr_token}" download="qr_${a.matricula}.png">Baixar</a></td>
			<td>
				<button class="mini button-secondary button-edit" onclick="editar(${a.id})" title="Editar aluno">Editar</button>
				<button class="mini ${a.ativo ? "button-deactivate" : "button-success"}" onclick="alternar(${a.id})" title="Alterar status">${a.ativo ? "Desativar" : "Ativar"}</button>
				<button class="mini button-danger" onclick="excluir(${a.id})" title="Excluir aluno">Excluir</button>
			</td>`;
		tabela.appendChild(tr);
	});
	if (!filtrados.length) {
		const tr = document.createElement("tr");
		tr.innerHTML = `<td class="empty-state" colspan="6">${BUSCA_ALUNOS ? "Nenhum aluno encontrado para essa busca." : "Nenhum aluno cadastrado."}</td>`;
		tabela.appendChild(tr);
	}
}

$("busca-alunos")?.addEventListener("input", e => { BUSCA_ALUNOS = e.target.value; carregarAlunos(); });

function atualizarCamposAnoEscolar() {
	const ano = $("f-turma").value;
	const anoValido = Array.from($("f-turma").options).some(opcao => opcao.value === ano && !opcao.dataset.legado);
	$("campo-sala").hidden = !anoValido;
	$("f-sala").required = anoValido;
	if (!anoValido) $("f-sala").value = "";
	const exibir = ano === "2º ano do Ensino Médio" || ano === "3º ano do Ensino Médio";
	$("campo-curso-tecnico").hidden = !exibir;
	$("f-curso-tecnico").required = exibir;
	if (!exibir) $("f-curso-tecnico").value = "";
}

$("f-turma")?.addEventListener("change", atualizarCamposAnoEscolar);
atualizarCamposAnoEscolar();

$("form-aluno")?.addEventListener("submit", async e => {
	e.preventDefault();
	const formulario = e.currentTarget;
	if (!formulario.reportValidity()) return;

	const id = $("aluno-id").value;
	const botaoSalvar = $("btn-salvar-aluno");
	const corpo = {
		nome: $("f-nome").value.trim(),
		matricula: $("f-matricula").value.trim(),
		turma: $("f-sala").value
			? `${$("f-turma").value.trim()} - Sala ${$("f-sala").value}`
			: $("f-turma").value.trim(),
		curso_tecnico: $("f-curso-tecnico").value,
		responsavel: $("f-responsavel").value.trim(),
		telefone: $("f-telefone").value.trim()
	};

	botaoSalvar.disabled = true;
	try {
		const resposta = await fetch(id ? `/api/alunos/${id}` : "/api/alunos", {
			method: id ? "PUT" : "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(corpo)
		});
		const resultado = await resposta.json().catch(() => ({}));
		if (!resposta.ok) {
			const mensagemErro = resposta.status >= 500
				? "Erro ao salvar. Confira se a migração do banco de dados foi executada."
				: resultado.msg || "Não foi possível salvar o aluno. Confira os dados e tente novamente.";
			mostrarMensagem(mensagemErro, false);
			return;
		}
		mostrarMensagem(resultado.msg || "Aluno salvo com sucesso.", resultado.ok);
		if (resultado.ok) {
			limparForm();
			await carregarAlunos();
		}
	} catch (erro) {
		console.error("Falha ao salvar aluno:", erro);
		mostrarMensagem("Não foi possível conectar ao servidor. Verifique se a aplicação está ativa e tente novamente.", false);
	} finally {
		botaoSalvar.disabled = false;
	}
});

function editar(id) {
	const aluno = ALUNOS.find(x => x.id === id);
	$("aluno-id").value = aluno.id;
	$("f-nome").value = aluno.nome;
	$("f-matricula").value = aluno.matricula;
	const turmaComSala = aluno.turma.match(/^(.*) - Sala ([AB])$/);
	const anoEscolar = turmaComSala ? turmaComSala[1] : aluno.turma;
	if (anoEscolar && !Array.from($("f-turma").options).some(opcao => opcao.value === anoEscolar)) {
		const opcaoLegada = document.createElement("option");
		opcaoLegada.value = anoEscolar;
		opcaoLegada.textContent = anoEscolar;
		opcaoLegada.dataset.legado = "true";
		$("f-turma").add(opcaoLegada);
	}
	$("f-turma").value = anoEscolar || "";
	atualizarCamposAnoEscolar();
	$("f-sala").value = turmaComSala ? turmaComSala[2] : "";
	$("f-curso-tecnico").value = aluno.curso_tecnico || "";
	$("f-responsavel").value = aluno.responsavel || "";
	$("f-telefone").value = aluno.telefone || "";
	$("titulo-form").textContent = "Editar aluno";
	$("btn-salvar-aluno").textContent = "Salvar alterações";
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
	$("f-turma").querySelectorAll("[data-legado]").forEach(opcao => opcao.remove());
	$("form-aluno").reset();
	$("aluno-id").value = "";
	atualizarCamposAnoEscolar();
	$("titulo-form").textContent = "Cadastrar aluno";
	$("btn-salvar-aluno").textContent = "Cadastrar aluno";
	$("btn-cancelar").hidden = true;
}

$("btn-cancelar")?.addEventListener("click", limparForm);

async function carregar() {
	REGISTROS = await fetch("/api/registros").then(r => r.json());
	const tipo = $("filtro-tipo").value;
	const status = $("filtro-status").value;
	const filtrados = REGISTROS.filter(r => (tipo === "TODOS" || r.tipo === tipo) && (status === "TODOS" || r.status === status));
	const entradas = filtrados.filter(r => r.tipo === "ENTRADA");
	const saidas = filtrados.filter(r => r.tipo === "SAIDA");
	$("qtd-entradas").textContent = entradas.length;
	$("qtd-saidas").textContent = saidas.length;
	$("secao-entradas").hidden = tipo === "SAIDA";
	$("secao-saidas").hidden = tipo === "ENTRADA";
	$("limpar-filtros").hidden = tipo === "TODOS" && status === "TODOS";
	[["tabela-entradas", entradas], ["tabela-saidas", saidas]].forEach(([id, rows]) => {
		const tabela = $(id);
		tabela.querySelectorAll("tr:not(:first-child)").forEach(x => x.remove());
		rows.forEach(r => {
			const tr = document.createElement("tr");
			tr.innerHTML = `<td>${r.nome}</td><td>${r.turma || "-"}</td>
				<td class="${r.status === "AUTORIZADO" ? "verde" : (r.status === "ATRASADO" ? "laranja" : "vermelho")}">${r.status}</td>
				<td>${r.metodo}</td><td>${r.aulas_atraso == null ? "-" : `${r.aulas_atraso} ${Number(r.aulas_atraso) === 1 ? "aula" : "aulas"}`}</td>
				<td>${escaparHtml(r.justificativa || "-")}</td><td>${r.data_hora}</td>`;
			tabela.appendChild(tr);
		});
		if (!rows.length) {
			const tr = document.createElement("tr");
			tr.innerHTML = '<td class="empty-state" colspan="7">Nenhum registro nesta categoria.</td>';
			tabela.appendChild(tr);
		}
	});
}

$("filtro-tipo")?.addEventListener("change", e => {
	const url = new URL(window.location.href);
	if (e.target.value === "TODOS") url.searchParams.delete("tipo"); else url.searchParams.set("tipo", e.target.value);
	window.location.href = url;
});
$("filtro-status")?.addEventListener("change", e => {
	const url = new URL(window.location.href);
	if (e.target.value === "TODOS") url.searchParams.delete("status"); else url.searchParams.set("status", e.target.value);
	window.location.href = url;
});
$("limpar-filtros")?.addEventListener("click", () => { window.location.href = "/registros"; });
