-- migration7.sql — fornecedor, whatsapp, link_compra em produtos
-- Safe to re-run

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS fornecedor  text default '';
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS whatsapp    text default '';
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS link_compra text default '';
