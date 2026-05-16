-- migration6.sql — tipo e custo_direto em produtos
-- Safe to re-run

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS tipo        text    default 'produto';
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS custo_direto numeric;
