-- ================================================================
-- MIGRAÇÃO 3 — Execute este arquivo no SQL Editor do Supabase
-- Substitui migration2.sql — seguro executar mesmo se já rodou antes
-- ================================================================

-- Colunas opcionais em insumos/embalagens/receitas
ALTER TABLE embalagens           ADD COLUMN IF NOT EXISTS link_compra  text    default '';
ALTER TABLE insumos              ADD COLUMN IF NOT EXISTS link_compra  text    default '';
ALTER TABLE receitas             ADD COLUMN IF NOT EXISTS peso_liquido numeric;
ALTER TABLE receitas             ADD COLUMN IF NOT EXISTS unidade_gera text    default 'un';
ALTER TABLE receita_ingredientes ADD COLUMN IF NOT EXISTS insumo_id   bigint  references insumos(id) on delete set null;

-- Composição do produto como JSON (permite editar produtos sem junction tables)
ALTER TABLE produtos             ADD COLUMN IF NOT EXISTS composicao   jsonb;

-- Junction tables para composição de produtos
CREATE TABLE IF NOT EXISTS produto_receitas (
  id          bigserial primary key,
  produto_id  bigint references produtos(id) on delete cascade,
  receita_id  bigint references receitas(id) on delete cascade,
  quantidade  numeric default 1
);

CREATE TABLE IF NOT EXISTS produto_embalagens (
  id           bigserial primary key,
  produto_id   bigint references produtos(id) on delete cascade,
  embalagem_id bigint references embalagens(id) on delete cascade,
  quantidade   numeric default 1
);

ALTER TABLE produto_receitas   ENABLE ROW LEVEL SECURITY;
ALTER TABLE produto_embalagens ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "auth_all" ON produto_receitas   FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "auth_all" ON produto_embalagens FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
