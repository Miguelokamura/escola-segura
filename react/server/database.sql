-- 1. Cria o banco de dados
CREATE DATABASE IF NOT EXISTS escola_segura CHARACTER SET utf8mb4;
USE escola_segura;

-- 2. Tabela de administradores
CREATE TABLE administradores (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario VARCHAR(50) UNIQUE NOT NULL,
    senha_hash VARCHAR(255) NOT NULL
);

-- 3. Tabelas de professores e salas vinculadas
CREATE TABLE professores (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(120) NOT NULL,
    usuario VARCHAR(50) UNIQUE NOT NULL,
    senha_hash VARCHAR(255) NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE professor_turmas (
    professor_id INT NOT NULL,
    turma VARCHAR(60) NOT NULL,
    PRIMARY KEY (professor_id, turma),
    FOREIGN KEY (professor_id) REFERENCES professores(id) ON DELETE CASCADE
);

-- 4. Tabela de alunos
CREATE TABLE alunos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    matricula VARCHAR(20) UNIQUE NOT NULL,
    turma VARCHAR(60),
    curso_tecnico VARCHAR(100),
    responsavel VARCHAR(100),
    telefone VARCHAR(20),
    qr_token VARCHAR(64) UNIQUE NOT NULL,
    ativo BOOLEAN DEFAULT TRUE,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Tabela de registros de acesso
CREATE TABLE registros (
    id INT AUTO_INCREMENT PRIMARY KEY,
    aluno_id INT NOT NULL,
    tipo ENUM('ENTRADA','SAIDA') NOT NULL,
    metodo ENUM('QRCODE','NFC') DEFAULT 'QRCODE',
    status ENUM('AUTORIZADO','ATRASADO','NEGADO') NOT NULL,
    minutos_atraso INT NULL,
    bloqueio_intervalo BOOLEAN NOT NULL DEFAULT FALSE,
    justificativa VARCHAR(500) NULL,
    arduino_event_id VARCHAR(64) NULL UNIQUE,
    data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE
);

-- 5. Confirmar que as tabelas foram criadas
SHOW TABLES;

-- Execute uma vez em bancos existentes para habilitar atrasos.
-- ALTER TABLE registros MODIFY status ENUM('AUTORIZADO','ATRASADO','NEGADO') NOT NULL;
-- ALTER TABLE registros ADD COLUMN minutos_atraso INT NULL AFTER status;
