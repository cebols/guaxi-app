ALTER TABLE receita_ingredientes
  ADD COLUMN IF NOT EXISTS sub_receita_id bigint references receitas(id) on delete set null;
