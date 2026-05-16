-- migration10.sql — estoque de produtos finais
-- Safe to re-run

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS estoque_atual numeric;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS estoque_min   numeric default 0;
