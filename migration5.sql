-- migration5.sql — platform-specific prices on produtos
-- Safe to re-run (IF NOT EXISTS / IF NOT COLUMN)

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS preco_direta numeric;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS preco_99     numeric;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS preco_ifood  numeric;
