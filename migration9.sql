-- migration9.sql — RLS em todas as tabelas
-- Executa no SQL Editor do Supabase
-- Safe to re-run (IF NOT EXISTS nos policies)

-- Habilita RLS
ALTER TABLE insumos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE embalagens           ENABLE ROW LEVEL SECURITY;
ALTER TABLE produtos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE receitas             ENABLE ROW LEVEL SECURITY;
ALTER TABLE receita_ingredientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE encomendas           ENABLE ROW LEVEL SECURITY;
ALTER TABLE encomenda_itens      ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendas               ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes             ENABLE ROW LEVEL SECURITY;

-- Políticas: só usuários autenticados têm acesso total
DO $$ 
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'insumos','embalagens','produtos','receitas',
    'receita_ingredientes','encomendas','encomenda_itens',
    'vendas','clientes'
  ]) LOOP
    EXECUTE format(
      'CREATE POLICY IF NOT EXISTS "auth_all" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;

-- Tabelas de junção (podem existir ou não)
DO $$
BEGIN
  BEGIN
    ALTER TABLE produto_receitas   ENABLE ROW LEVEL SECURITY;
    CREATE POLICY IF NOT EXISTS "auth_all" ON produto_receitas   FOR ALL TO authenticated USING (true) WITH CHECK (true);
  EXCEPTION WHEN undefined_table THEN NULL;
  END;
  BEGIN
    ALTER TABLE produto_embalagens ENABLE ROW LEVEL SECURITY;
    CREATE POLICY IF NOT EXISTS "auth_all" ON produto_embalagens FOR ALL TO authenticated USING (true) WITH CHECK (true);
  EXCEPTION WHEN undefined_table THEN NULL;
  END;
END $$;
