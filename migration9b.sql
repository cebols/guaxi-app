-- migration9b.sql — cria policies RLS (corrige migration9 que falhou)
-- Safe to re-run: usa DROP IF EXISTS antes de CREATE

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'insumos','embalagens','produtos','receitas',
    'receita_ingredientes','encomendas','encomenda_itens',
    'vendas','clientes'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "auth_all" ON %I', t);
    EXECUTE format(
      'CREATE POLICY "auth_all" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;

-- Junction tables (podem não existir)
DO $$
BEGIN
  BEGIN
    DROP POLICY IF EXISTS "auth_all" ON produto_receitas;
    CREATE POLICY "auth_all" ON produto_receitas FOR ALL TO authenticated USING (true) WITH CHECK (true);
  EXCEPTION WHEN undefined_table THEN NULL;
  END;
  BEGIN
    DROP POLICY IF EXISTS "auth_all" ON produto_embalagens;
    CREATE POLICY "auth_all" ON produto_embalagens FOR ALL TO authenticated USING (true) WITH CHECK (true);
  EXCEPTION WHEN undefined_table THEN NULL;
  END;
END $$;
