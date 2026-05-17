-- migration16.sql — marca em insumos; link/telefone em insumo_fornecedores
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS marca text DEFAULT '';
ALTER TABLE insumo_fornecedores ADD COLUMN IF NOT EXISTS link_compra text DEFAULT '';
ALTER TABLE insumo_fornecedores ADD COLUMN IF NOT EXISTS telefone text DEFAULT '';
