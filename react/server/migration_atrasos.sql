-- Execute uma vez no banco escola_segura já existente.
ALTER TABLE registros
  MODIFY status ENUM('AUTORIZADO', 'ATRASADO', 'NEGADO') NOT NULL,
  ADD COLUMN minutos_atraso INT NULL AFTER status;
