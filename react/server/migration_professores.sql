-- Execute uma vez no banco existente para habilitar cadastro e acesso docente.
USE escola_segura;

CREATE TABLE IF NOT EXISTS professores (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(120) NOT NULL,
    usuario VARCHAR(50) UNIQUE NOT NULL,
    senha_hash VARCHAR(255) NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS professor_turmas (
    professor_id INT NOT NULL,
    turma VARCHAR(60) NOT NULL,
    PRIMARY KEY (professor_id, turma),
    FOREIGN KEY (professor_id) REFERENCES professores(id) ON DELETE CASCADE
);
