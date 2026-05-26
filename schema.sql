-- ============================================================
-- GUAXI APP — Schema completo
-- Execute INTEIRO no SQL Editor do Supabase para setup inicial.
-- Idempotente: seguro rodar em banco já existente (IF NOT EXISTS).
-- ============================================================

-- ── TABELAS ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS insumos (
  id            bigserial primary key,
  nome          text not null,
  categoria     text    default '',
  unidade       text    default 'g',
  custo_emb     numeric default 0,
  custo_unit    numeric default 0,
  estoque_atual numeric,
  estoque_min   numeric default 0,
  fornecedor    text    default '',
  telefone      text    default '',
  whatsapp      text    default '',
  peso_emb      numeric default 0,
  peso_un       numeric,
  link_compra   text    default '',
  marca         text    default '',
  user_id       uuid    default auth.uid() references auth.users(id) on delete cascade,
  created_at    timestamptz default now()
);

CREATE TABLE IF NOT EXISTS embalagens (
  id            bigserial primary key,
  nome          text not null,
  categoria     text    default '',
  custo_unit    numeric default 0,
  estoque_atual numeric,
  estoque_min   numeric default 0,
  fornecedor    text    default '',
  telefone      text    default '',
  whatsapp      text    default '',
  qtd_compra    numeric default 0,
  custo_compra  numeric default 0,
  link_compra   text    default '',
  user_id       uuid    default auth.uid() references auth.users(id) on delete cascade,
  created_at    timestamptz default now()
);

CREATE TABLE IF NOT EXISTS receitas (
  id            bigserial primary key,
  nome          text not null,
  tipo          text    default 'Outro',
  rendimento    numeric default 0,
  custo_total   numeric default 0,
  custo_unid    numeric default 0,
  peso_liquido  numeric,
  unidade_gera  text    default 'un',
  fator_perda        numeric default null,
  instrucoes         text    default null,
  tempo_forno        integer default null,
  temp_forno         integer default null,
  tempo_resfriamento integer default null,
  tipo_resfriamento  text    default null,
  user_id       uuid    default auth.uid() references auth.users(id) on delete cascade,
  created_at    timestamptz default now()
);

CREATE TABLE IF NOT EXISTS receita_ingredientes (
  id          bigserial primary key,
  receita_id  bigint references receitas(id) on delete cascade,
  insumo_nome text not null,
  quantidade  numeric default 0,
  unidade     text    default 'g',
  insumo_id   bigint  references insumos(id) on delete set null,
  user_id     uuid    default auth.uid() references auth.users(id) on delete cascade
);

CREATE TABLE IF NOT EXISTS produtos (
  id              bigserial primary key,
  nome            text not null,
  custo_total     numeric default 0,
  preco_sugerido  numeric default 0,
  preco_praticado numeric,
  composicao      jsonb,
  preco_direta    numeric,
  preco_99        numeric,
  preco_ifood     numeric,
  tipo            text    default 'produto',
  custo_direto    numeric,
  fornecedor      text    default '',
  whatsapp        text    default '',
  link_compra     text    default '',
  estoque_atual   numeric,
  estoque_min     numeric default 0,
  user_id         uuid    default auth.uid() references auth.users(id) on delete cascade,
  created_at      timestamptz default now()
);

CREATE TABLE IF NOT EXISTS produto_receitas (
  id          bigserial primary key,
  produto_id  bigint references produtos(id) on delete cascade,
  receita_id  bigint references receitas(id) on delete cascade,
  quantidade  numeric default 1,
  user_id     uuid    default auth.uid() references auth.users(id) on delete cascade
);

CREATE TABLE IF NOT EXISTS produto_embalagens (
  id           bigserial primary key,
  produto_id   bigint references produtos(id) on delete cascade,
  embalagem_id bigint references embalagens(id) on delete cascade,
  quantidade   numeric default 1,
  user_id      uuid    default auth.uid() references auth.users(id) on delete cascade
);

CREATE TABLE IF NOT EXISTS insumo_fornecedores (
  id          bigserial primary key,
  insumo_id   bigint not null,
  marca       text    default '',
  fornecedor  text    default '',
  peso_emb    numeric default 0,
  custo_emb   numeric default 0,
  custo_unit  numeric default 0,
  link_compra text    default '',
  telefone    text    default '',
  user_id     uuid    default auth.uid() references auth.users(id) on delete cascade,
  created_at  timestamptz default now()
);

CREATE TABLE IF NOT EXISTS encomendas (
  id           text primary key,
  data_entrega date,
  cliente      text not null,
  contato      text    default '',
  canal        text    default 'WhatsApp',
  endereco     text    default '',
  embalagem    text    default '',
  valor        numeric default 0,
  sinal        numeric default 0,
  pgto         text    default 'Aguardando',
  status       text    default 'Pendente',
  obs          text    default '',
  tipo_entrega text    default 'Retirada',
  frete        numeric default 0,
  user_id      uuid    default auth.uid() references auth.users(id) on delete cascade,
  created_at   timestamptz default now()
);

CREATE TABLE IF NOT EXISTS encomenda_itens (
  id           bigserial primary key,
  encomenda_id text references encomendas(id) on delete cascade,
  produto      text not null,
  quantidade   numeric default 1,
  preco_unit   numeric default 0,
  user_id      uuid    default auth.uid() references auth.users(id) on delete cascade
);

CREATE TABLE IF NOT EXISTS clientes (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  telefone   text    default '',
  obs        text    default '',
  user_id    uuid    default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);

CREATE TABLE IF NOT EXISTS compras (
  id         uuid primary key default gen_random_uuid(),
  tipo       text not null,
  item_id    text,
  item_nome  text not null,
  unidade    text    default '',
  quantidade numeric not null,
  preco_unit numeric default 0,
  total      numeric default 0,
  data       date not null,
  user_id    uuid    default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);

CREATE TABLE IF NOT EXISTS vendas (
  id           bigserial primary key,
  data         date not null default current_date,
  produto_nome text not null,
  produto_id   bigint references produtos(id) on delete set null,
  quantidade   numeric not null default 1,
  preco_unit   numeric not null,
  plataforma   text    not null default 'Direta',
  custo_unit   numeric default 0,
  user_id      uuid    default auth.uid() references auth.users(id) on delete cascade,
  created_at   timestamptz default now()
);

-- ── COLUNAS OPCIONAIS (safe em banco existente) ───────────────
-- Garante que bancos criados antes do schema.sql também ficam atualizados.

ALTER TABLE insumos             ADD COLUMN IF NOT EXISTS peso_emb    numeric default 0;
ALTER TABLE insumos             ADD COLUMN IF NOT EXISTS peso_un     numeric;
ALTER TABLE insumos             ADD COLUMN IF NOT EXISTS link_compra text default '';
ALTER TABLE insumos             ADD COLUMN IF NOT EXISTS marca       text default '';
ALTER TABLE insumos             ADD COLUMN IF NOT EXISTS user_id     uuid default auth.uid() references auth.users(id) on delete cascade;

ALTER TABLE embalagens           ADD COLUMN IF NOT EXISTS qtd_compra   numeric default 0;
ALTER TABLE embalagens           ADD COLUMN IF NOT EXISTS custo_compra numeric default 0;
ALTER TABLE embalagens           ADD COLUMN IF NOT EXISTS link_compra  text default '';
ALTER TABLE embalagens           ADD COLUMN IF NOT EXISTS user_id      uuid default auth.uid() references auth.users(id) on delete cascade;

ALTER TABLE receitas             ADD COLUMN IF NOT EXISTS peso_liquido       numeric;
ALTER TABLE receitas             ADD COLUMN IF NOT EXISTS unidade_gera       text default 'un';
ALTER TABLE receitas             ADD COLUMN IF NOT EXISTS fator_perda        numeric default null;
ALTER TABLE receitas             ADD COLUMN IF NOT EXISTS instrucoes         text default null;
ALTER TABLE receitas             ADD COLUMN IF NOT EXISTS tempo_forno        integer default null;
ALTER TABLE receitas             ADD COLUMN IF NOT EXISTS temp_forno         integer default null;
ALTER TABLE receitas             ADD COLUMN IF NOT EXISTS tempo_resfriamento integer default null;
ALTER TABLE receitas             ADD COLUMN IF NOT EXISTS tipo_resfriamento  text default null;
ALTER TABLE receitas             ADD COLUMN IF NOT EXISTS user_id            uuid default auth.uid() references auth.users(id) on delete cascade;

ALTER TABLE receita_ingredientes ADD COLUMN IF NOT EXISTS insumo_id      bigint references insumos(id) on delete set null;
ALTER TABLE receita_ingredientes ADD COLUMN IF NOT EXISTS sub_receita_id bigint;  -- sem FK, evita ciclo PostgREST
ALTER TABLE receita_ingredientes ADD COLUMN IF NOT EXISTS user_id        uuid default auth.uid() references auth.users(id) on delete cascade;

ALTER TABLE produtos             ADD COLUMN IF NOT EXISTS composicao      jsonb;
ALTER TABLE produtos             ADD COLUMN IF NOT EXISTS preco_direta    numeric;
ALTER TABLE produtos             ADD COLUMN IF NOT EXISTS preco_99        numeric;
ALTER TABLE produtos             ADD COLUMN IF NOT EXISTS preco_ifood     numeric;
ALTER TABLE produtos             ADD COLUMN IF NOT EXISTS tipo            text default 'produto';
ALTER TABLE produtos             ADD COLUMN IF NOT EXISTS custo_direto    numeric;
ALTER TABLE produtos             ADD COLUMN IF NOT EXISTS fornecedor      text default '';
ALTER TABLE produtos             ADD COLUMN IF NOT EXISTS whatsapp        text default '';
ALTER TABLE produtos             ADD COLUMN IF NOT EXISTS link_compra     text default '';
ALTER TABLE produtos             ADD COLUMN IF NOT EXISTS estoque_atual   numeric;
ALTER TABLE produtos             ADD COLUMN IF NOT EXISTS estoque_min     numeric default 0;
ALTER TABLE produtos             ADD COLUMN IF NOT EXISTS secao           text default '';
ALTER TABLE produtos             ADD COLUMN IF NOT EXISTS user_id         uuid default auth.uid() references auth.users(id) on delete cascade;

ALTER TABLE produto_receitas     ADD COLUMN IF NOT EXISTS user_id uuid default auth.uid() references auth.users(id) on delete cascade;
ALTER TABLE produto_embalagens   ADD COLUMN IF NOT EXISTS user_id uuid default auth.uid() references auth.users(id) on delete cascade;
ALTER TABLE insumo_fornecedores  ADD COLUMN IF NOT EXISTS link_compra text default '';
ALTER TABLE insumo_fornecedores  ADD COLUMN IF NOT EXISTS telefone    text default '';
ALTER TABLE insumo_fornecedores  ADD COLUMN IF NOT EXISTS user_id     uuid default auth.uid() references auth.users(id) on delete cascade;

ALTER TABLE encomendas           ADD COLUMN IF NOT EXISTS tipo_entrega text default 'Retirada';
ALTER TABLE encomendas           ADD COLUMN IF NOT EXISTS frete        numeric default 0;
ALTER TABLE encomendas           ADD COLUMN IF NOT EXISTS user_id      uuid default auth.uid() references auth.users(id) on delete cascade;
ALTER TABLE encomendas           ADD COLUMN IF NOT EXISTS data_pago    date;

ALTER TABLE encomenda_itens      ADD COLUMN IF NOT EXISTS user_id    uuid default auth.uid() references auth.users(id) on delete cascade;
ALTER TABLE encomenda_itens      ADD COLUMN IF NOT EXISTS produto_id  bigint references produtos(id) on delete set null;
ALTER TABLE clientes             ADD COLUMN IF NOT EXISTS user_id uuid default auth.uid() references auth.users(id) on delete cascade;
ALTER TABLE compras              ADD COLUMN IF NOT EXISTS user_id uuid default auth.uid() references auth.users(id) on delete cascade;
ALTER TABLE vendas               ADD COLUMN IF NOT EXISTS user_id uuid default auth.uid() references auth.users(id) on delete cascade;

-- ── ROW LEVEL SECURITY ────────────────────────────────────────

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

-- ── POLÍTICAS — limpa tudo e garante só own_data ─────────────

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN (
      'insumos','insumo_fornecedores','embalagens','produtos','receitas',
      'receita_ingredientes','produto_receitas','produto_embalagens',
      'encomendas','encomenda_itens','clientes','compras','vendas'
    )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
  END LOOP;
END $$;

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

-- ── User Config ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_config (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  config     jsonb not null default '{}',
  updated_at timestamptz default now()
);
ALTER TABLE user_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own_data" ON user_config;
CREATE POLICY "own_data" ON user_config FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── Insumo cost history (weekly snapshots) ───────────────────
CREATE TABLE IF NOT EXISTS insumo_cost_history (
  insumo_id  bigint  not null references insumos(id) on delete cascade,
  week       date    not null,
  custo_unit numeric not null default 0,
  user_id    uuid    default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, insumo_id, week)
);
CREATE INDEX IF NOT EXISTS idx_ich_user_week ON insumo_cost_history (user_id, week DESC);
ALTER TABLE insumo_cost_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own_data" ON insumo_cost_history;
CREATE POLICY "own_data" ON insumo_cost_history FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── Embalagem fornecedores (multi-supplier) ──────────────────
CREATE TABLE IF NOT EXISTS embalagem_fornecedores (
  id           bigserial primary key,
  embalagem_id bigint not null references embalagens(id) on delete cascade,
  fornecedor   text not null default '',
  qtd_compra   numeric not null default 0,
  custo_compra numeric not null default 0,
  custo_unit   numeric not null default 0,
  link_compra  text default '',
  telefone     text default '',
  user_id      uuid default auth.uid() references auth.users(id) on delete cascade,
  created_at   timestamptz default now()
);
CREATE INDEX IF NOT EXISTS idx_emb_forn_emb_id ON embalagem_fornecedores (embalagem_id);
ALTER TABLE embalagem_fornecedores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own_data" ON embalagem_fornecedores;
CREATE POLICY "own_data" ON embalagem_fornecedores FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── Produções (mise en place history) ───────────────────────
CREATE TABLE IF NOT EXISTS producoes (
  id         bigserial primary key,
  user_id    uuid default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);
ALTER TABLE producoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own_data" ON producoes;
CREATE POLICY "own_data" ON producoes FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS producao_itens (
  id               bigserial primary key,
  producao_id      bigint not null references producoes(id) on delete cascade,
  tipo             text default 'receita',     -- 'receita' | 'produto'
  receita_id       bigint,
  receita_nome     text,
  produto_id       bigint,
  produto_nome     text,
  quantidade       numeric not null default 1,
  modo             text default 'doses',       -- 'doses' | 'peso_liquido' | 'unidades'
  valor_alvo       numeric,
  rendimento_total numeric,
  unidade_gera     text default 'un',
  snapshot         jsonb
);
ALTER TABLE producao_itens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own_data" ON producao_itens;
CREATE POLICY "own_data" ON producao_itens FOR ALL USING (
  producao_id IN (SELECT id FROM producoes WHERE user_id = auth.uid())
) WITH CHECK (
  producao_id IN (SELECT id FROM producoes WHERE user_id = auth.uid())
);

-- ── Receita porcoes (custo por porção) ───────────────────────
ALTER TABLE receitas ADD COLUMN IF NOT EXISTS porcoes integer;

-- Profiles table for onboarding and user settings
CREATE TABLE IF NOT EXISTS profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome_loja TEXT DEFAULT '',
  estado TEXT DEFAULT 'SP',
  canais TEXT[] DEFAULT '{"direto"}',
  onboarding_done BOOLEAN DEFAULT FALSE,
  checklist_dismissed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url text;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_own" ON profiles;
CREATE POLICY "profiles_own" ON profiles FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── Imagens (insumos, receitas, produtos) ───────────────────
ALTER TABLE insumos  ADD COLUMN IF NOT EXISTS imagem_url text;
ALTER TABLE receitas ADD COLUMN IF NOT EXISTS imagem_url text;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS imagem_url text;

-- ── Mise en place v2: produtos+receitas, estoque receitas, snapshot ──
ALTER TABLE receitas         ADD COLUMN IF NOT EXISTS estoque_atual numeric;
ALTER TABLE producoes        ADD COLUMN IF NOT EXISTS checks       jsonb default '[]'::jsonb;
ALTER TABLE producao_itens   ALTER COLUMN receita_nome DROP NOT NULL;
ALTER TABLE producao_itens   ADD COLUMN IF NOT EXISTS tipo         text default 'receita';
ALTER TABLE producao_itens   ADD COLUMN IF NOT EXISTS produto_id   bigint;
ALTER TABLE producao_itens   ADD COLUMN IF NOT EXISTS produto_nome text;
ALTER TABLE producao_itens   ADD COLUMN IF NOT EXISTS modo         text default 'doses';
ALTER TABLE producao_itens   ADD COLUMN IF NOT EXISTS valor_alvo   numeric;
ALTER TABLE producao_itens   ADD COLUMN IF NOT EXISTS snapshot     jsonb;
-- quantidade era int, virou numeric (doses fracionárias)
ALTER TABLE producao_itens   ALTER COLUMN quantidade TYPE numeric;

-- ── Cardápio público ─────────────────────────────────────────
-- Um link fixo por loja; gerar de novo atualiza o mesmo link.
CREATE TABLE IF NOT EXISTS cardapios (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL UNIQUE,
  nome_loja  TEXT,
  dados      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE cardapios ENABLE ROW LEVEL SECURITY;

-- Leitura pública (clientes acessam sem login).
DROP POLICY IF EXISTS "cardapios public read" ON cardapios;
CREATE POLICY "cardapios public read" ON cardapios
  FOR SELECT USING (true);

-- Apenas o dono escreve/atualiza.
DROP POLICY IF EXISTS "cardapios owner write" ON cardapios;
CREATE POLICY "cardapios owner write" ON cardapios
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── Formulário de Pedidos Externos ───────────────────────────

-- Descrição dos produtos (usada no formulário público)
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS descricao text;

-- Leitura pública de produtos (formulário de pedidos do cliente)
DROP POLICY IF EXISTS "produtos public read" ON produtos;
CREATE POLICY "produtos public read" ON produtos
  FOR SELECT USING (true);

-- Função segura para submeter pedido externo (roda como dono)
DROP FUNCTION IF EXISTS public.submit_pedido_externo(uuid, text, text, text, text, text, jsonb);
CREATE OR REPLACE FUNCTION public.submit_pedido_externo(
  p_user_id    uuid,
  p_cliente    text,
  p_contato    text,
  p_tipo_entrega text,
  p_endereco   text,
  p_obs        text,
  p_itens      jsonb,
  p_frete      numeric default 0
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id       text;
  v_last_id  text;
  v_next_num int := 1;
  v_total    numeric := 0;
  v_item     jsonb;
BEGIN
  SELECT id INTO v_last_id
    FROM encomendas
   WHERE user_id = p_user_id
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_last_id IS NOT NULL THEN
    v_next_num := COALESCE((regexp_match(v_last_id, 'PED-(\d+)'))[1]::int, 0) + 1;
  END IF;
  v_id := 'PED-' || lpad(v_next_num::text, 3, '0');

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens)
  LOOP
    v_total := v_total
      + (v_item->>'preco_unit')::numeric
      * (v_item->>'quantidade')::numeric;

    UPDATE produtos
       SET estoque_atual = GREATEST(0, COALESCE(estoque_atual, 0) - (v_item->>'quantidade')::numeric)
     WHERE id = (v_item->>'produto_id')::bigint
       AND user_id = p_user_id;
  END LOOP;

  INSERT INTO encomendas
    (id, user_id, cliente, contato, canal, tipo_entrega, endereco, obs, valor, frete, status, pgto)
  VALUES
    (v_id, p_user_id, p_cliente, p_contato, 'FormExterno', p_tipo_entrega, p_endereco, p_obs, v_total + COALESCE(p_frete, 0), COALESCE(p_frete, 0), 'Pendente', 'Aguardando');

  INSERT INTO encomenda_itens (encomenda_id, produto, quantidade, preco_unit, user_id, produto_id)
  SELECT v_id,
         elem->>'produto_nome',
         (elem->>'quantidade')::numeric,
         (elem->>'preco_unit')::numeric,
         p_user_id,
         (elem->>'produto_id')::bigint
    FROM jsonb_array_elements(p_itens) AS elem;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_pedido_externo TO anon;

-- Expõe config pública: delivery + secoesOrdem
CREATE OR REPLACE FUNCTION public.get_delivery_config(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'delivery', COALESCE(config->'delivery', '{}'::jsonb),
    'secoesOrdem', COALESCE(config->'secoesOrdem', '[]'::jsonb)
  )
  FROM user_config
  WHERE user_id = p_user_id
$$;

GRANT EXECUTE ON FUNCTION public.get_delivery_config TO anon;

-- Deleta pedido e devolve estoque se canal = FormExterno
CREATE OR REPLACE FUNCTION public.delete_pedido(p_id text, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canal text;
  v_item  record;
BEGIN
  SELECT canal INTO v_canal FROM encomendas WHERE id = p_id AND user_id = p_user_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_canal = 'FormExterno' THEN
    FOR v_item IN
      SELECT produto_id, quantidade FROM encomenda_itens
      WHERE encomenda_id = p_id AND produto_id IS NOT NULL
    LOOP
      UPDATE produtos
         SET estoque_atual = COALESCE(estoque_atual, 0) + v_item.quantidade
       WHERE id = v_item.produto_id AND user_id = p_user_id;
    END LOOP;
  END IF;

  DELETE FROM encomendas WHERE id = p_id AND user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_pedido TO authenticated;
