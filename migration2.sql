-- ================================================================
-- MIGRAÇÃO 2 — Receitas calculadas + Produtos compostos
-- Execute no SQL Editor ANTES de usar as novas funcionalidades
-- ================================================================

-- 1. Link de compra para embalagens (ex: Shopee)
ALTER TABLE embalagens
  ADD COLUMN IF NOT EXISTS link_compra text default '';

-- 2. Ingredientes de receita agora referenciam insumos por ID
ALTER TABLE receita_ingredientes
  ADD COLUMN IF NOT EXISTS insumo_id bigint references insumos(id) on delete set null;

-- 3. Produto composto por receitas
CREATE TABLE IF NOT EXISTS produto_receitas (
  id          bigserial primary key,
  produto_id  bigint references produtos(id) on delete cascade,
  receita_id  bigint references receitas(id) on delete cascade,
  quantidade  numeric default 1
);

-- 4. Produto composto por embalagens
CREATE TABLE IF NOT EXISTS produto_embalagens (
  id           bigserial primary key,
  produto_id   bigint references produtos(id) on delete cascade,
  embalagem_id bigint references embalagens(id) on delete cascade,
  quantidade   numeric default 1
);

-- 7. Link de compra para insumos (ex: Shopee)
ALTER TABLE insumos
  ADD COLUMN IF NOT EXISTS link_compra text default '';

-- 8. Peso líquido das receitas (após assar/processar)
ALTER TABLE receitas
  ADD COLUMN IF NOT EXISTS peso_liquido numeric;

-- 9. Unidade gerada pela receita (já adicionado)
ALTER TABLE receitas
  ADD COLUMN IF NOT EXISTS unidade_gera text default 'un';

-- 6. RLS
ALTER TABLE produto_receitas  ENABLE ROW LEVEL SECURITY;
ALTER TABLE produto_embalagens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all" ON produto_receitas  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON produto_embalagens FOR ALL TO authenticated USING (true) WITH CHECK (true);
