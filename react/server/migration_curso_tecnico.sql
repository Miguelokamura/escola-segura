-- Execute uma vez no banco existente para armazenar o curso técnico do aluno.
USE escola_segura;

ALTER TABLE alunos
    ADD COLUMN curso_tecnico VARCHAR(100) NULL AFTER turma;

ALTER TABLE alunos
    MODIFY COLUMN turma VARCHAR(60);
