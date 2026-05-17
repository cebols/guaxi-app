-- migration17.sql: multi-tenancy — user_id + RLS em todas as tabelas
-- Execute INTEIRO no SQL Editor do Supabase (Dashboard > SQL Editor > New query)
-- Ordem importa: colunas → backfill → RLS → policies

-- ── 1. Adicionar user_id em todas as tabelas ─────────────────────────────────
-- DEFAULT auth.uid() garante que novos inserts já recebem o user automaticamente

ALTER TABLE insumos             ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE insumo_fornecedores ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE embalagens           ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE produtos             ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE receitas             ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE receita_ingredientes ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE produto_receitas     ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE produto_embalagens   ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE encomendas           ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE encomenda_itens      ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE clientes             ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE compras              ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE vendas               ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;

-- ── 2. Backfill: atribui todos os dados existentes ao único usuário cadastrado ─
-- Seguro enquanto você for o único usuário. Pega o primeiro user por data de criação.

DO $$
DECLARE
  owner_id uuid := (SELECT id FROM auth.users ORDER BY created_at LIMIT 1);
BEGIN
  UPDATE insumos             SET user_id = owner_id WHERE user_id IS NULL;
  UPDATE insumo_fornecedores SET user_id = owner_id WHERE user_id IS NULL;
  UPDATE embalagens           SET user_id = owner_id WHERE user_id IS NULL;
  UPDATE produtos             SET user_id = owner_id WHERE user_id IS NULL;
  UPDATE receitas             SET user_id = owner_id WHERE user_id IS NULL;
  UPDATE receita_ingredientes SET user_id = owner_id WHERE user_id IS NULL;
  UPDATE produto_receitas     SET user_id = owner_id WHERE user_id IS NULL;
  UPDATE produto_embalagens   SET user_id = owner_id WHERE user_id IS NULL;
  UPDATE encomendas           SET user_id = owner_id WHERE user_id IS NULL;
  UPDATE encomenda_itens      SET user_id = owner_id WHERE user_id IS NULL;
  UPDATE clientes             SET user_id = owner_id WHERE user_id IS NULL;
  UPDATE compras              SET user_id = owner_id WHERE user_id IS NULL;
  UPDATE vendas               SET user_id = owner_id WHERE user_id IS NULL;
END $$;

-- ── 3. Ativar Row Level Security ──────────────────────────────────────────────

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

-- ── 4. Políticas: cada user só vê e edita os próprios dados ──────────────────

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
