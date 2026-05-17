-- migration14.sql
-- 1. Fator de perda em receitas
-- 2. Tabela de fontes/marcas por insumo

ALTER TABLE receitas ADD COLUMN IF NOT EXISTS fator_perda  numeric DEFAULT NULL;
ALTER TABLE receitas ADD COLUMN IF NOT EXISTS instrucoes  text    DEFAULT NULL;

CREATE TABLE IF NOT EXISTS insumo_fornecedores (
  id          bigserial primary key,
  insumo_id   bigint not null,
  marca       text default '',
  fornecedor  text default '',
  peso_emb    numeric default 0,
  custo_emb   numeric default 0,
  custo_unit  numeric default 0,
  created_at  timestamptz default now()
);

ALTER TABLE insumo_fornecedores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all" ON insumo_fornecedores;
CREATE POLICY "auth_all" ON insumo_fornecedores FOR ALL TO authenticated USING (true) WITH CHECK (true);
