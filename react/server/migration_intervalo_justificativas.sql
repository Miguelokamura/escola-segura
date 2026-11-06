USE escola_segura;

ALTER TABLE registros
  ADD COLUMN bloqueio_intervalo BOOLEAN NOT NULL DEFAULT FALSE AFTER minutos_atraso,
  ADD COLUMN justificativa VARCHAR(500) NULL AFTER bloqueio_intervalo;
