-- ================================================================
-- MIGRAÇÃO 4 — Tabela de vendas
-- Execute no SQL Editor do Supabase
-- ================================================================

CREATE TABLE IF NOT EXISTS vendas (
  id          bigserial primary key,
  created_at  timestamptz default now(),
  data        date not null default current_date,
  produto_nome text not null,
  produto_id  bigint references produtos(id) on delete set null,
  quantidade  numeric not null default 1,
  preco_unit  numeric not null,
  plataforma  text not null default 'Direta',
  custo_unit  numeric default 0
);

ALTER TABLE vendas ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "auth_all" ON vendas FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
