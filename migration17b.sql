-- migration17b.sql: limpa políticas antigas e garante isolamento correto
-- Execute no SQL Editor do Supabase

-- ── 1. Remover TODAS as políticas existentes nas tabelas do app ───────────────
-- (políticas permissivas antigas causam "OR" que deixa todos verem tudo)

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'insumos','insumo_fornecedores','embalagens','produtos','receitas',
        'receita_ingredientes','produto_receitas','produto_embalagens',
        'encomendas','encomenda_itens','clientes','compras','vendas'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- ── 2. Garantir que RLS está ativo em todas as tabelas ───────────────────────

ALTER TABLE insumos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE insumo_fornecedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE embalagens           ENABLE ROW LEVEL SECURITY;
ALTER TABLE produtos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE receitas             ENABLE ROW LEVEL SECURITY;
ALTER TABLE receita_ingredientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE produto_receitas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE produto_embalagens   ENABLE ROW LEVEL SECURITY;
ALTER TABLE encomendas           ENABLE ROW LEVEL SECURITY;
ALTER TABLE encomenda_itens      ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE compras              ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendas               ENABLE ROW LEVEL SECURITY;

-- ── 3. Recriar SOMENTE a política de isolamento por usuário ───────────────────

CREATE POLICY "own_data" ON insumos             FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_data" ON insumo_fornecedores FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_data" ON embalagens           FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_data" ON produtos             FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_data" ON receitas             FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_data" ON receita_ingredientes FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_data" ON produto_receitas     FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_data" ON produto_embalagens   FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_data" ON encomendas           FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_data" ON encomenda_itens      FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_data" ON clientes             FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_data" ON compras              FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_data" ON vendas               FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── 4. Verificar resultado (deve listar só "own_data" em cada tabela) ─────────
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'insumos','insumo_fornecedores','embalagens','produtos','receitas',
    'receita_ingredientes','produto_receitas','produto_embalagens',
    'encomendas','encomenda_itens','clientes','compras','vendas'
  )
ORDER BY tablename, policyname;
