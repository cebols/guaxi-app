-- =============================================================================
-- GUAXI APP — Banco completo (Supabase)
-- =============================================================================
-- COMO USAR
--   Cole este arquivo INTEIRO no SQL Editor do Supabase e clique em Run.
--   Pode rodar quantas vezes quiser: só cria o que falta e atualiza funções.
--   Nunca apaga dados. Sempre que o app mudar, este arquivo é atualizado —
--   é só colar e rodar de novo (substitui todos os SQLs avulsos).
--
-- ÍNDICE
--   1. Extensões
--   2. Tabelas
--   3. Colunas adicionadas com o tempo (atualiza bancos antigos)
--   4. Segurança (RLS: cada usuário só vê os próprios dados; arquivos)
--   5. Funções do app e do cardápio online
--   6. Lembrete de fim do dia (push + agendamento)
--   7. Ajustes de dados (migrações seguras, só agem uma vez)
--   8. Recarregar a API
-- =============================================================================


-- =============================================================================
-- 1. EXTENSÕES
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;   -- agendamento (lembrete push)
CREATE EXTENSION IF NOT EXISTS pg_net;    -- chamadas HTTP de dentro do banco
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;  -- assinatura do frete


-- =============================================================================
-- 2. TABELAS
-- =============================================================================

-- ── Insumos, embalagens e fornecedores ───────────────────────────────────────
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

-- Histórico semanal do custo dos insumos
CREATE TABLE IF NOT EXISTS insumo_cost_history (
  insumo_id  bigint  not null references insumos(id) on delete cascade,
  week       date    not null,
  custo_unit numeric not null default 0,
  user_id    uuid    default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, insumo_id, week)
);
CREATE INDEX IF NOT EXISTS idx_ich_user_week ON insumo_cost_history (user_id, week DESC);

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

-- ── Receitas ─────────────────────────────────────────────────────────────────
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

-- ── Produtos ─────────────────────────────────────────────────────────────────
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
  fragilidade     text    default 'robusto',  -- 'robusto' (moto) | 'fragil' (carro)
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

-- Prontidão: unidades por etapa (freezer, degelo, reassadas...).
-- produtos.prontidao = { fluxo, embalar, etapas: { <etapa>: { meta, tempoH, validadeH } }, noPedido }
-- produtos.estoque_atual = soma dos lotes.
CREATE TABLE IF NOT EXISTS prontidao_lotes (
  id          bigserial primary key,
  produto_id  bigint not null references produtos(id) on delete cascade,
  etapa       text not null,
  qtd         numeric not null default 0,
  entrou_em   timestamptz not null default now(),
  user_id     uuid default auth.uid() references auth.users(id) on delete cascade
);
CREATE INDEX IF NOT EXISTS prontidao_lotes_produto ON prontidao_lotes(produto_id, etapa);

-- "Avise-me quando voltar" (cardápio online)
CREATE TABLE IF NOT EXISTS interesses (
  id          bigserial primary key,
  user_id     uuid references auth.users(id) on delete cascade,
  produto_id  bigint references produtos(id) on delete cascade,
  nome        text,
  telefone    text not null,
  created_at  timestamptz default now(),
  avisado_em  timestamptz
);

-- ── Pedidos, envios e vendas ─────────────────────────────────────────────────
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

-- Despacho Lalamove: 1 envio = 1+ pedidos agrupados
CREATE TABLE IF NOT EXISTS envios (
  id            bigserial primary key,
  user_id       uuid    default auth.uid() references auth.users(id) on delete cascade,
  data_entrega  date,
  veiculo       text    default 'CAR',
  status        text    default 'FILA',   -- FILA | ASSIGNING_DRIVER | ON_GOING | PICKED_UP | COMPLETED | CANCELED
  quotation_id  text,
  order_id      text,
  share_link    text,
  price_total   numeric default 0,
  driver_nome   text,
  driver_phone  text,
  driver_plate  text,
  created_at    timestamptz default now()
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

-- ── Produção (planejamento / mise en place) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS producoes (
  id         bigserial primary key,
  user_id    uuid default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);

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

-- Ponto de restauração criado a cada contagem confirmada.
-- itens: [{ id, nome, quantidade, unidade }]
CREATE TABLE IF NOT EXISTS contagem_snapshots (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  user_id    uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo       text        NOT NULL, -- 'insumos' | 'embalagens' | 'produtos'
  itens      jsonb       NOT NULL DEFAULT '[]'
);

-- ── Conta e configurações ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_config (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  config     jsonb not null default '{}',
  updated_at timestamptz default now()
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome_loja TEXT DEFAULT '',
  estado TEXT DEFAULT 'SP',
  canais TEXT[] DEFAULT '{"direto"}',
  onboarding_done BOOLEAN DEFAULT FALSE,
  checklist_dismissed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Lembrete de fim do dia: uma linha por aparelho inscrito
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id             bigserial primary key,
  user_id        uuid default auth.uid() references auth.users(id) on delete cascade,
  endpoint       text unique not null,
  p256dh         text not null,
  auth           text not null,
  hora_lembrete  text default '21:00',
  fuso           text default 'America/Sao_Paulo',
  aparelho       text,
  ativo          boolean default true,
  ultimo_envio   date,
  created_at     timestamptz default now()
);

-- Cardápio público antigo (link fixo por loja). O cardápio novo é /pedido/<loja>.
CREATE TABLE IF NOT EXISTS cardapios (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL UNIQUE,
  nome_loja  TEXT,
  dados      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agente WhatsApp: histórico de conversas (só service_role acessa)
CREATE TABLE IF NOT EXISTS agent_conversas (
  id         bigserial primary key,
  telefone   text        not null,
  role       text        not null check (role in ('user', 'assistant')),
  conteudo   text        not null,
  created_at timestamptz default now()
);
CREATE INDEX IF NOT EXISTS idx_agent_conversas_tel_created ON agent_conversas (telefone, created_at DESC);

-- Atendimento do WhatsApp: um registro por cliente (telefone)
CREATE TABLE IF NOT EXISTS atendimentos (
  telefone              text primary key,
  user_id               uuid references auth.users(id) on delete cascade,
  nome                  text,
  bot_pausado           boolean not null default false,  -- você assumiu: o bot não responde
  precisa_humano        boolean not null default false,  -- o bot chamou você
  motivo                text,
  ultima_msg_em         timestamptz,
  ultima_msg_cliente_em timestamptz,                     -- janela de 24h da Meta pra responder
  lido_em               timestamptz,
  created_at            timestamptz default now()
);


-- =============================================================================
-- 3. COLUNAS ADICIONADAS COM O TEMPO (bancos criados antes ficam atualizados)
-- =============================================================================

-- insumos
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS peso_emb    numeric default 0;
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS peso_un     numeric;
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS link_compra text default '';
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS marca       text default '';
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS user_id     uuid default auth.uid() references auth.users(id) on delete cascade;
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS imagem_url  text;
-- Ingredientes derivados (ovo → clara + gema): parent_fator = fração do peso do pai
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS parent_insumo_id bigint REFERENCES insumos(id) ON DELETE SET NULL;
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS parent_fator     numeric DEFAULT NULL;

ALTER TABLE insumo_fornecedores ADD COLUMN IF NOT EXISTS link_compra text default '';
ALTER TABLE insumo_fornecedores ADD COLUMN IF NOT EXISTS telefone    text default '';
ALTER TABLE insumo_fornecedores ADD COLUMN IF NOT EXISTS user_id     uuid default auth.uid() references auth.users(id) on delete cascade;

-- embalagens
ALTER TABLE embalagens ADD COLUMN IF NOT EXISTS qtd_compra   numeric default 0;
ALTER TABLE embalagens ADD COLUMN IF NOT EXISTS custo_compra numeric default 0;
ALTER TABLE embalagens ADD COLUMN IF NOT EXISTS link_compra  text default '';
ALTER TABLE embalagens ADD COLUMN IF NOT EXISTS user_id      uuid default auth.uid() references auth.users(id) on delete cascade;

-- receitas
ALTER TABLE receitas ADD COLUMN IF NOT EXISTS peso_liquido       numeric;
ALTER TABLE receitas ADD COLUMN IF NOT EXISTS unidade_gera       text default 'un';
ALTER TABLE receitas ADD COLUMN IF NOT EXISTS fator_perda        numeric default null;
ALTER TABLE receitas ADD COLUMN IF NOT EXISTS instrucoes         text default null;
ALTER TABLE receitas ADD COLUMN IF NOT EXISTS tempo_forno        integer default null;
ALTER TABLE receitas ADD COLUMN IF NOT EXISTS temp_forno         integer default null;
ALTER TABLE receitas ADD COLUMN IF NOT EXISTS tempo_resfriamento integer default null;
ALTER TABLE receitas ADD COLUMN IF NOT EXISTS tipo_resfriamento  text default null;
ALTER TABLE receitas ADD COLUMN IF NOT EXISTS user_id            uuid default auth.uid() references auth.users(id) on delete cascade;
ALTER TABLE receitas ADD COLUMN IF NOT EXISTS porcoes            integer;               -- custo por porção
ALTER TABLE receitas ADD COLUMN IF NOT EXISTS imagem_url         text;
ALTER TABLE receitas ADD COLUMN IF NOT EXISTS estoque_atual      numeric;               -- estoque de preparos
ALTER TABLE receitas ADD COLUMN IF NOT EXISTS estoque_min        numeric default 0;
ALTER TABLE receitas ADD COLUMN IF NOT EXISTS tem_ferver         boolean default false;
ALTER TABLE receitas ADD COLUMN IF NOT EXISTS qtd_por_unidade    numeric default null;  -- receita em unidades (null = em peso)
ALTER TABLE receitas ADD COLUMN IF NOT EXISTS tempos_forno       jsonb default null;    -- [{tempo, temperatura}]
-- Proporções: ingrediente que vale 100% (i:<insumoId> / r:<subReceitaId> / n:<nome>). Null = o de maior peso.
ALTER TABLE receitas ADD COLUMN IF NOT EXISTS proporcao_base     text;

ALTER TABLE receita_ingredientes ADD COLUMN IF NOT EXISTS insumo_id      bigint references insumos(id) on delete set null;
ALTER TABLE receita_ingredientes ADD COLUMN IF NOT EXISTS sub_receita_id bigint;  -- sem FK, evita ciclo no PostgREST
ALTER TABLE receita_ingredientes ADD COLUMN IF NOT EXISTS user_id        uuid default auth.uid() references auth.users(id) on delete cascade;

-- produtos
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS composicao   jsonb;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS preco_direta numeric;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS preco_99     numeric;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS preco_ifood  numeric;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS tipo         text default 'produto';
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS fragilidade  text default 'robusto';
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS custo_direto numeric;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS fornecedor   text default '';
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS whatsapp     text default '';
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS link_compra  text default '';
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS estoque_atual numeric;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS estoque_min  numeric default 0;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS secao        text default '';       -- seção do cardápio
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS margem_alvo  numeric default null;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS user_id      uuid default auth.uid() references auth.users(id) on delete cascade;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS imagem_url   text;                  -- capa
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS descricao    text;                  -- texto do cardápio online
-- No cardápio: os que já existiam ficaram ativos; novos nascem fora do cardápio
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS ativo        boolean NOT NULL DEFAULT true;
ALTER TABLE produtos ALTER COLUMN ativo SET DEFAULT false;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS fornada      integer;               -- unidades por produção
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS prontidao    jsonb;                 -- fluxo do Prontidão
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS midias       jsonb;                 -- [{ tipo: 'imagem'|'video', url, poster? }]
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS ordem        int;                   -- posição na seção do cardápio

ALTER TABLE produto_receitas   ADD COLUMN IF NOT EXISTS user_id uuid default auth.uid() references auth.users(id) on delete cascade;
ALTER TABLE produto_embalagens ADD COLUMN IF NOT EXISTS user_id uuid default auth.uid() references auth.users(id) on delete cascade;

-- encomendas (pedidos)
ALTER TABLE encomendas ADD COLUMN IF NOT EXISTS tipo_entrega text default 'Retirada';
ALTER TABLE encomendas ADD COLUMN IF NOT EXISTS frete        numeric default 0;
ALTER TABLE encomendas ADD COLUMN IF NOT EXISTS user_id      uuid default auth.uid() references auth.users(id) on delete cascade;
ALTER TABLE encomendas ADD COLUMN IF NOT EXISTS data_pago    date;
ALTER TABLE encomendas ADD COLUMN IF NOT EXISTS entrega_lat  numeric;
ALTER TABLE encomendas ADD COLUMN IF NOT EXISTS entrega_lng  numeric;
ALTER TABLE encomendas ADD COLUMN IF NOT EXISTS entrega_frag text default 'robusto';
ALTER TABLE encomendas ADD COLUMN IF NOT EXISTS envio_id     bigint references envios(id) on delete set null;
-- Pedido aberto só reserva; ao virar Entregue o app baixa do estoque e marca isto
ALTER TABLE encomendas ADD COLUMN IF NOT EXISTS estoque_baixado boolean NOT NULL DEFAULT false;
-- Período da entrega: manha (9–12h) | tarde (12–18h) | noite (18–22h); null = a combinar
ALTER TABLE encomendas ADD COLUMN IF NOT EXISTS periodo text;
-- Rastreio da Lalamove pelo WhatsApp da Guaxí quando o motorista sai com o pedido
ALTER TABLE encomendas ADD COLUMN IF NOT EXISTS rastreio_auto       boolean NOT NULL DEFAULT true;
ALTER TABLE encomendas ADD COLUMN IF NOT EXISTS rastreio_enviado_em timestamptz;
-- Envios: uma rota da Lalamove por dia + período
ALTER TABLE envios ADD COLUMN IF NOT EXISTS periodo text;

ALTER TABLE encomenda_itens ADD COLUMN IF NOT EXISTS user_id    uuid default auth.uid() references auth.users(id) on delete cascade;
ALTER TABLE encomenda_itens ADD COLUMN IF NOT EXISTS produto_id bigint references produtos(id) on delete set null;

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS user_id uuid default auth.uid() references auth.users(id) on delete cascade;
ALTER TABLE compras  ADD COLUMN IF NOT EXISTS user_id uuid default auth.uid() references auth.users(id) on delete cascade;
ALTER TABLE vendas   ADD COLUMN IF NOT EXISTS user_id uuid default auth.uid() references auth.users(id) on delete cascade;

-- produção
ALTER TABLE producoes      ADD COLUMN IF NOT EXISTS checks       jsonb default '[]'::jsonb;
ALTER TABLE producao_itens ALTER COLUMN receita_nome DROP NOT NULL;
ALTER TABLE producao_itens ADD COLUMN IF NOT EXISTS tipo         text default 'receita';
ALTER TABLE producao_itens ADD COLUMN IF NOT EXISTS produto_id   bigint;
ALTER TABLE producao_itens ADD COLUMN IF NOT EXISTS produto_nome text;
ALTER TABLE producao_itens ADD COLUMN IF NOT EXISTS modo         text default 'doses';
ALTER TABLE producao_itens ADD COLUMN IF NOT EXISTS valor_alvo   numeric;
ALTER TABLE producao_itens ADD COLUMN IF NOT EXISTS snapshot     jsonb;
ALTER TABLE producao_itens ALTER COLUMN quantidade TYPE numeric;   -- doses fracionárias

-- conta
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url text;

-- conversas do WhatsApp: dono da conversa + mensagens suas ('humano') além das do cliente e do bot
ALTER TABLE agent_conversas ADD COLUMN IF NOT EXISTS user_id uuid references auth.users(id) on delete cascade;
ALTER TABLE agent_conversas DROP CONSTRAINT IF EXISTS agent_conversas_role_check;
ALTER TABLE agent_conversas ADD CONSTRAINT agent_conversas_role_check CHECK (role in ('user', 'assistant', 'humano'));


-- =============================================================================
-- 4. SEGURANÇA (RLS) — cada usuário só lê/escreve as próprias linhas
-- =============================================================================
ALTER TABLE insumos                ENABLE ROW LEVEL SECURITY;
ALTER TABLE insumo_fornecedores    ENABLE ROW LEVEL SECURITY;
ALTER TABLE insumo_cost_history    ENABLE ROW LEVEL SECURITY;
ALTER TABLE embalagens             ENABLE ROW LEVEL SECURITY;
ALTER TABLE embalagem_fornecedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE receitas               ENABLE ROW LEVEL SECURITY;
ALTER TABLE receita_ingredientes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE produtos               ENABLE ROW LEVEL SECURITY;
ALTER TABLE produto_receitas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE produto_embalagens     ENABLE ROW LEVEL SECURITY;
ALTER TABLE prontidao_lotes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE interesses             ENABLE ROW LEVEL SECURITY;
ALTER TABLE encomendas             ENABLE ROW LEVEL SECURITY;
ALTER TABLE encomenda_itens        ENABLE ROW LEVEL SECURITY;
ALTER TABLE envios                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE compras                ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendas                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE producoes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE producao_itens         ENABLE ROW LEVEL SECURITY;
ALTER TABLE contagem_snapshots     ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_config            ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cardapios              ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_conversas        ENABLE ROW LEVEL SECURITY;  -- o bot grava com service_role; o dono lê
ALTER TABLE atendimentos           ENABLE ROW LEVEL SECURITY;

-- Tabelas originais: limpa políticas antigas e deixa só "own_data"
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

CREATE POLICY "own_data" ON insumos              FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_data" ON insumo_fornecedores  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
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

-- (Não existe mais leitura pública da tabela produtos: o cardápio online usa a
-- função cardapio_publico, que devolve só nome, foto, preço e descrição.)

-- Demais tabelas
DROP POLICY IF EXISTS "own_data" ON insumo_cost_history;
CREATE POLICY "own_data" ON insumo_cost_history FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "own_data" ON embalagem_fornecedores;
CREATE POLICY "own_data" ON embalagem_fornecedores FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "own_data" ON prontidao_lotes;
CREATE POLICY "own_data" ON prontidao_lotes FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "own_data" ON interesses;
CREATE POLICY "own_data" ON interesses FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "own_data" ON envios;
CREATE POLICY "own_data" ON envios FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "own_data" ON producoes;
CREATE POLICY "own_data" ON producoes FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "own_data" ON producao_itens;
CREATE POLICY "own_data" ON producao_itens FOR ALL
  USING (producao_id IN (SELECT id FROM producoes WHERE user_id = auth.uid()))
  WITH CHECK (producao_id IN (SELECT id FROM producoes WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "users manage own snapshots" ON contagem_snapshots;
CREATE POLICY "users manage own snapshots" ON contagem_snapshots FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "own_data" ON user_config;
CREATE POLICY "own_data" ON user_config FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "profiles_own" ON profiles;
CREATE POLICY "profiles_own" ON profiles FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own_data" ON push_subscriptions;
CREATE POLICY "own_data" ON push_subscriptions FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "own_data" ON agent_conversas;
CREATE POLICY "own_data" ON agent_conversas FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "own_data" ON atendimentos;
CREATE POLICY "own_data" ON atendimentos FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "cardapios public read" ON cardapios;
CREATE POLICY "cardapios public read" ON cardapios FOR SELECT USING (true);
DROP POLICY IF EXISTS "cardapios owner write" ON cardapios;
CREATE POLICY "cardapios owner write" ON cardapios FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Arquivos (bucket "Images"): qualquer um VÊ pelo link público da foto/vídeo, mas
-- só quem está logado envia, e cada um só altera/apaga o que ele mesmo enviou.
-- Troca as políticas antigas desse bucket pelas abaixo (outros buckets: intactos).
DO $$
DECLARE r record;
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN RETURN; END IF;
  FOR r IN SELECT policyname FROM pg_policies
           WHERE schemaname = 'storage' AND tablename = 'objects'
             AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) LIKE '%''Images''%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', r.policyname);
  END LOOP;
  EXECUTE $p$CREATE POLICY "guaxi images enviar" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'Images')$p$;
  EXECUTE $p$CREATE POLICY "guaxi images ver" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'Images' AND owner_id = auth.uid()::text)$p$;
  EXECUTE $p$CREATE POLICY "guaxi images alterar" ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'Images' AND owner_id = auth.uid()::text)$p$;
  EXECUTE $p$CREATE POLICY "guaxi images apagar" ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'Images' AND owner_id = auth.uid()::text)$p$;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Arquivos: políticas do bucket Images não alteradas (%)', SQLERRM;
END $$;


-- =============================================================================
-- 5. FUNÇÕES DO APP E DO CARDÁPIO ONLINE
-- =============================================================================

-- Cardápio online: só o que o cliente precisa ver (nada de custo, receita,
-- fornecedor, margem...). Só produtos no cardápio, com preço e que não são combo.
CREATE OR REPLACE FUNCTION public.cardapio_publico(p_user_id uuid)
RETURNS TABLE(id bigint, nome text, descricao text, preco_direta numeric, estoque_atual numeric,
              imagem_url text, midias jsonb, tipo text, secao text, ordem int, fragilidade text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.nome, p.descricao, p.preco_direta, p.estoque_atual, p.imagem_url, p.midias,
         p.tipo, p.secao, p.ordem, p.fragilidade
  FROM produtos p
  WHERE p.user_id = p_user_id AND p.ativo
    AND coalesce(p.tipo, 'produto') <> 'combo' AND p.preco_direta > 0
  ORDER BY p.nome
$$;

-- Cliente (sem login) manda o pedido. Preço e nome de cada item vêm do cadastro
-- (o cliente não consegue mudar preço). O frete só vale se veio assinado pelo
-- cálculo do servidor (/api/frete-dias); senão o pedido entra com aviso pra conferir.
-- Não mexe no estoque: o pedido só reserva e o app baixa ao virar Entregue.
DROP FUNCTION IF EXISTS public.submit_pedido_externo(uuid, text, text, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.submit_pedido_externo(uuid, text, text, text, text, text, jsonb, numeric);
DROP FUNCTION IF EXISTS public.submit_pedido_externo(uuid, text, text, text, text, text, jsonb, numeric, date, numeric, numeric, text);
DROP FUNCTION IF EXISTS public.submit_pedido_externo(uuid, text, text, text, text, text, jsonb, numeric, date, numeric, numeric, text, text);
DROP FUNCTION IF EXISTS public.submit_pedido_externo(uuid, text, text, text, text, text, jsonb, numeric, date, numeric, numeric, text, text, text);
CREATE OR REPLACE FUNCTION public.submit_pedido_externo(
  p_user_id          uuid,
  p_cliente          text,
  p_contato          text,
  p_tipo_entrega     text,
  p_endereco         text,
  p_obs              text,
  p_itens            jsonb,
  p_frete            numeric default 0,
  p_data_entrega     date default null,
  p_lat              numeric default null,
  p_lng              numeric default null,
  p_frag             text default 'robusto',
  p_frete_assinatura text default null,
  p_canal            text default 'FormExterno',  -- 'FormExterno' (cardápio online) | 'WhatsApp' (agente)
  p_periodo          text default null            -- manha | tarde | noite (null = a combinar)
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_id       text;
  v_last_id  text;
  v_next_num int := 1;
  v_total    numeric := 0;
  v_item     jsonb;
  v_itens    jsonb := '[]'::jsonb;
  v_qtd      numeric;
  v_prod     record;
  v_frag     text := 'robusto';
  v_entrega  boolean := p_tipo_entrega = 'Entrega';
  v_frete    numeric := 0;
  v_ok       boolean := true;
  v_segredo  text;
  v_gratis   numeric;
  v_obs      text := left(coalesce(p_obs, ''), 1000);
  v_periodo  text := CASE WHEN p_periodo IN ('manha', 'tarde', 'noite') THEN p_periodo END;
BEGIN
  IF coalesce(trim(p_cliente), '') = '' OR coalesce(trim(p_contato), '') = '' THEN
    RAISE EXCEPTION 'Informe nome e WhatsApp';
  END IF;

  -- Itens: confere cada produto e usa o preço do cadastro
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) LOOP
    v_qtd := nullif(v_item->>'quantidade', '')::numeric;
    IF v_qtd IS NULL OR v_qtd <= 0 OR v_qtd > 100 OR v_qtd <> trunc(v_qtd) THEN
      RAISE EXCEPTION 'Quantidade inválida';
    END IF;
    SELECT p.id, p.nome, p.preco_direta, p.fragilidade INTO v_prod
      FROM produtos p
     WHERE p.id = nullif(v_item->>'produto_id', '')::bigint AND p.user_id = p_user_id
       AND p.ativo AND coalesce(p.tipo, 'produto') <> 'combo' AND p.preco_direta > 0;
    IF NOT FOUND THEN RAISE EXCEPTION 'Um dos itens não está mais disponível. Recarregue a página.'; END IF;
    IF v_prod.fragilidade = 'fragil' THEN v_frag := 'fragil'; END IF;
    v_itens := v_itens || jsonb_build_object('produto_id', v_prod.id, 'produto_nome', v_prod.nome,
                                             'quantidade', v_qtd, 'preco_unit', v_prod.preco_direta);
    v_total := v_total + v_prod.preco_direta * v_qtd;
  END LOOP;
  IF jsonb_array_length(v_itens) = 0 THEN RAISE EXCEPTION 'Pedido vazio'; END IF;

  -- Frete: só confia no valor assinado pelo servidor
  IF v_entrega THEN
    v_frete := greatest(0, least(coalesce(p_frete, 0), 1000));
    BEGIN
      SELECT decrypted_secret INTO v_segredo FROM vault.decrypted_secrets WHERE name = 'guaxi_cron_secret' LIMIT 1;
    EXCEPTION WHEN others THEN v_segredo := NULL;
    END;
    v_ok := v_segredo IS NOT NULL AND p_frete_assinatura IS NOT NULL
      AND p_data_entrega IS NOT NULL AND p_lat IS NOT NULL AND p_lng IS NOT NULL
      AND encode(hmac(p_user_id::text || '|' || p_data_entrega::text || '|' || round(v_frete, 2)::text || '|'
                      || round(p_lat, 5)::text || '|' || round(p_lng, 5)::text || '|' || v_frag
                      || coalesce('|' || v_periodo, ''),   -- o preço vale pro período escolhido
                      v_segredo, 'sha256'), 'hex') = p_frete_assinatura;
    -- frete grátis só se o pedido de verdade passou do valor mínimo
    IF v_ok AND v_frete = 0 THEN
      SELECT nullif(config->'delivery'->>'freteGratis', '')::numeric INTO v_gratis FROM user_config WHERE user_id = p_user_id;
      v_ok := coalesce(v_gratis, 0) > 0 AND v_total >= v_gratis;
    END IF;
    IF NOT v_ok THEN
      v_obs := '⚠ Frete informado pelo cliente (não confirmado pelo app) — conferir antes de cobrar.'
               || CASE WHEN v_obs <> '' THEN E'\n' || v_obs ELSE '' END;
    END IF;
  END IF;

  SELECT id INTO v_last_id FROM encomendas WHERE user_id = p_user_id ORDER BY created_at DESC LIMIT 1;
  IF v_last_id IS NOT NULL THEN
    v_next_num := COALESCE((regexp_match(v_last_id, 'PED-(\d+)'))[1]::int, 0) + 1;
  END IF;
  v_id := 'PED-' || lpad(v_next_num::text, 3, '0');

  INSERT INTO encomendas
    (id, user_id, cliente, contato, canal, tipo_entrega, endereco, obs, valor, frete, status, pgto,
     data_entrega, entrega_lat, entrega_lng, entrega_frag, periodo)
  VALUES
    (v_id, p_user_id, left(trim(p_cliente), 100), left(trim(p_contato), 40),
     CASE WHEN p_canal = 'WhatsApp' THEN 'WhatsApp' ELSE 'FormExterno' END,
     CASE WHEN v_entrega THEN 'Entrega' ELSE 'Retirada' END, left(coalesce(p_endereco, ''), 300), v_obs,
     v_total + v_frete, v_frete, 'Pendente', 'Aguardando',
     p_data_entrega, p_lat, p_lng, v_frag, v_periodo);

  INSERT INTO encomenda_itens (encomenda_id, produto, quantidade, preco_unit, user_id, produto_id)
  SELECT v_id, elem->>'produto_nome', (elem->>'quantidade')::numeric, (elem->>'preco_unit')::numeric,
         p_user_id, (elem->>'produto_id')::bigint
    FROM jsonb_array_elements(v_itens) AS elem;

  RETURN v_id;
END;
$$;

-- Config pública da loja: só o que o cardápio usa (dias de entrega, frete grátis,
-- faixas de frete, CEP da loja) + ordem das seções. Endereço, coordenadas e
-- margens NÃO saem daqui.
CREATE OR REPLACE FUNCTION public.get_delivery_config(p_user_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'delivery', jsonb_strip_nulls(jsonb_build_object(
      'diasEntrega', config->'delivery'->'diasEntrega',
      'freteGratis', config->'delivery'->'freteGratis',
      'freteTiers',  config->'delivery'->'freteTiers',
      'lojaCEP',     config->'delivery'->'lojaCEP',
      'lojaEndereco', NULLIF(btrim(config->'delivery'->>'lojaEndereco', E' \t\r\n'), '')  -- mostrado no topo do cardápio (retirada)
    )),
    'secoesOrdem', COALESCE(config->'secoesOrdem', '[]'::jsonb)
  )
  FROM user_config WHERE user_id = p_user_id
$$;

-- Apaga pedido. Só o dono (pela sessão; o p_user_id enviado é ignorado).
-- Não mexe no estoque (aberto só reserva; o entregue já baixou).
CREATE OR REPLACE FUNCTION public.delete_pedido(p_id text, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login'; END IF;
  DELETE FROM encomendas WHERE id = p_id AND user_id = auth.uid();
END;
$$;

-- Disponível pra venda = pronto nas etapas vendáveis − reservado (pedidos abertos até amanhã).
-- a_caminho = nas etapas anteriores ("volta em breve" no cardápio).
-- Etapas vendáveis por fluxo espelham src/lib/prontidao.js (FLUXOS) — manter em sincronia.
-- Choux: assadas 90% também contam (reassar leva 15 min e recheia na hora).
DROP FUNCTION IF EXISTS public.produtos_disponiveis(uuid);
CREATE OR REPLACE FUNCTION public.produtos_disponiveis(p_user_id uuid)
RETURNS TABLE(produto_id bigint, disponivel numeric, a_caminho numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH eng AS (
    SELECT p.id, p.estoque_atual,
      CASE p.prontidao->>'fluxo'
        WHEN 'degelo' THEN ARRAY['degelo'] WHEN 'assado' THEN ARRAY['degelo']
        WHEN 'choux'  THEN ARRAY['cascas', 'reassadas'] WHEN 'direto' THEN ARRAY['freezer'] END AS etapas
    FROM produtos p
    WHERE p.user_id = p_user_id AND coalesce(p.ativo, true)
      -- visitante só vê os produtos do cardápio online; o dono vê todos os ativos
      AND (auth.uid() = p_user_id OR (coalesce(p.tipo, 'produto') <> 'combo' AND p.preco_direta > 0))
  ), pronto AS (
    SELECT e.id,
      CASE WHEN e.etapas IS NULL THEN coalesce(e.estoque_atual, 0)
           ELSE coalesce((SELECT sum(l.qtd) FROM prontidao_lotes l WHERE l.produto_id = e.id AND l.etapa = ANY(e.etapas)), 0)
      END AS qtd,
      CASE WHEN e.etapas IS NULL THEN 0
           ELSE coalesce((SELECT sum(l.qtd) FROM prontidao_lotes l WHERE l.produto_id = e.id AND NOT (l.etapa = ANY(e.etapas))), 0)
      END AS caminho
    FROM eng e
  ), reservado AS (
    SELECT i.produto_id AS id, sum(i.quantidade) AS qtd
    FROM encomenda_itens i JOIN encomendas en ON en.id = i.encomenda_id
    WHERE en.user_id = p_user_id AND en.status NOT IN ('Entregue', 'Cancelado') AND i.produto_id IS NOT NULL
      AND (en.data_entrega IS NULL OR en.data_entrega <= (now() AT TIME ZONE 'America/Sao_Paulo')::date + 1)
    GROUP BY i.produto_id
  )
  SELECT pr.id, greatest(0, pr.qtd - coalesce(r.qtd, 0)), pr.caminho FROM pronto pr LEFT JOIN reservado r ON r.id = pr.id
$$;

-- "Avise-me": cliente (sem login) registra interesse; ignora repetido do mesmo
-- telefone ainda não avisado.
CREATE OR REPLACE FUNCTION public.registrar_interesse(p_user_id uuid, p_produto_id bigint, p_nome text, p_telefone text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prod text;
BEGIN
  SELECT nome INTO v_prod FROM produtos WHERE id = p_produto_id AND user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'produto inválido'; END IF;
  IF coalesce(trim(p_telefone), '') = '' THEN RAISE EXCEPTION 'telefone obrigatório'; END IF;
  IF EXISTS (SELECT 1 FROM interesses WHERE produto_id = p_produto_id AND telefone = p_telefone AND avisado_em IS NULL) THEN RETURN; END IF;
  INSERT INTO interesses (user_id, produto_id, nome, telefone) VALUES (p_user_id, p_produto_id, left(p_nome, 80), left(p_telefone, 30));
  -- Aviso no celular da dona (página Interessados). Se o push falhar, o cadastro vale do mesmo jeito.
  BEGIN
    PERFORM avisar_dono(p_user_id, '🔔 Avise-me: ' || v_prod,
      coalesce(nullif(trim(p_nome), ''), 'Alguém') || ' quer ser avisado(a) quando voltar.',
      '/interessados?produto=' || p_produto_id, 'interesse-' || p_produto_id);
  EXCEPTION WHEN others THEN NULL;
  END;
END $$;

-- Quem pode chamar o quê. Funções SECURITY DEFINER passam por cima das regras de
-- acesso, então visitante (sem login) só chama as do cardápio online.
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
           WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.sig);
  END LOOP;
END $$;
-- service_role = o agente do WhatsApp (Edge Function)
GRANT EXECUTE ON FUNCTION public.cardapio_publico(uuid)        TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_delivery_config(uuid)     TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.produtos_disponiveis(uuid)    TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_interesse(uuid, bigint, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_pedido_externo(uuid, text, text, text, text, text, jsonb, numeric, date, numeric, numeric, text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_pedido(text, uuid)     TO authenticated, service_role;


-- =============================================================================
-- 6. LEMBRETE DE FIM DO DIA (Web Push)
-- =============================================================================
-- A cada 10 min o banco vê quem já passou da hora do lembrete e ainda não
-- recebeu hoje, e chama /api/lembrete-push. A senha (CRON_SECRET, a mesma do
-- Vercel) fica guardada no Vault do Supabase, fora deste arquivo.

-- Guarda o CRON_SECRET no Vault (uma vez só). Se a função antiga tinha a senha
-- escrita nela, copia de lá automaticamente.
DO $$
DECLARE s text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'guaxi_cron_secret') THEN
    SELECT substring(p.prosrc FROM 'Bearer ([^''<>[:space:]]+)''') INTO s
      FROM pg_proc p WHERE p.proname = 'enviar_lembretes_push' LIMIT 1;
    IF s IS NOT NULL THEN
      PERFORM vault.create_secret(s, 'guaxi_cron_secret', 'CRON_SECRET do Vercel (lembrete push)');
    ELSE
      RAISE NOTICE 'Lembrete push: guarde o CRON_SECRET uma vez com: SELECT vault.create_secret(''<valor>'', ''guaxi_cron_secret'');';
    END IF;
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Vault indisponível (%): lembrete push fica sem senha', SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION enviar_lembretes_push() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE devidos jsonb; segredo text;
BEGIN
  SELECT decrypted_secret INTO segredo FROM vault.decrypted_secrets WHERE name = 'guaxi_cron_secret' LIMIT 1;
  IF segredo IS NULL THEN
    RAISE WARNING 'guaxi_cron_secret não está no Vault — lembrete não enviado';
    RETURN;
  END IF;

  WITH d AS (
    SELECT s.id, s.endpoint, s.p256dh, s.auth, (now() AT TIME ZONE s.fuso)::date AS hoje
    FROM push_subscriptions s
    WHERE s.ativo
      AND s.hora_lembrete IS NOT NULL
      AND to_char(now() AT TIME ZONE s.fuso, 'HH24:MI') >= s.hora_lembrete
      AND (s.ultimo_envio IS NULL OR s.ultimo_envio < (now() AT TIME ZONE s.fuso)::date)
  ), marcados AS (
    UPDATE push_subscriptions p SET ultimo_envio = d.hoje FROM d WHERE p.id = d.id
    RETURNING d.endpoint, d.p256dh, d.auth
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('endpoint', endpoint,
           'keys', jsonb_build_object('p256dh', p256dh, 'auth', auth))), '[]'::jsonb)
    INTO devidos FROM marcados;

  IF jsonb_array_length(devidos) > 0 THEN
    PERFORM net.http_post(
      url     := 'https://guaxi-app.vercel.app/api/lembrete-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || segredo),
      body    := jsonb_build_object('subs', devidos, 'url', '/prontidao')
    );
  END IF;
END $$;
REVOKE ALL ON FUNCTION enviar_lembretes_push() FROM public, anon, authenticated;

-- Aviso na hora no celular da dona (ex.: cliente chamou no WhatsApp). Chamado pelo
-- agente do WhatsApp (service_role); usa as mesmas inscrições do lembrete.
CREATE OR REPLACE FUNCTION avisar_dono(p_user_id uuid, p_titulo text, p_corpo text,
                                       p_url text default '/atendimento', p_tag text default 'atendimento')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE subs jsonb; segredo text;
BEGIN
  SELECT decrypted_secret INTO segredo FROM vault.decrypted_secrets WHERE name = 'guaxi_cron_secret' LIMIT 1;
  IF segredo IS NULL THEN RETURN 0; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('endpoint', endpoint,
           'keys', jsonb_build_object('p256dh', p256dh, 'auth', auth))), '[]'::jsonb)
    INTO subs FROM push_subscriptions WHERE user_id = p_user_id AND ativo;
  IF jsonb_array_length(subs) = 0 THEN RETURN 0; END IF;
  PERFORM net.http_post(
    url     := 'https://guaxi-app.vercel.app/api/lembrete-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || segredo),
    body    := jsonb_build_object('subs', subs, 'titulo', left(p_titulo, 80), 'corpo', left(p_corpo, 180),
                                  'url', p_url, 'tag', p_tag)
  );
  RETURN jsonb_array_length(subs);
END $$;
REVOKE ALL ON FUNCTION avisar_dono(uuid, text, text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION avisar_dono(uuid, text, text, text, text) TO service_role;

-- Confere o segredo do Vault (o agente do WhatsApp usa pra aceitar chamadas do banco)
CREATE OR REPLACE FUNCTION conferir_segredo_guaxi(p_segredo text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(nullif(p_segredo, '') = (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'guaxi_cron_secret' LIMIT 1), false)
$$;
REVOKE ALL ON FUNCTION conferir_segredo_guaxi(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION conferir_segredo_guaxi(text) TO service_role;

-- Rastreio automático: quando o motorista sai com os pedidos (Lalamove PICKED_UP),
-- chama o agente do WhatsApp, que manda o link de rastreio pra cada cliente do envio.
CREATE OR REPLACE FUNCTION avisar_rastreio_envio() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE segredo text;
BEGIN
  IF NEW.status = 'PICKED_UP' AND coalesce(NEW.share_link, '') <> ''
     AND (OLD.status IS DISTINCT FROM 'PICKED_UP' OR coalesce(OLD.share_link, '') = '') THEN
    SELECT decrypted_secret INTO segredo FROM vault.decrypted_secrets WHERE name = 'guaxi_cron_secret' LIMIT 1;
    IF segredo IS NOT NULL THEN
      PERFORM net.http_post(
        url     := 'https://xhnzbmguobhfvcmwhhwi.supabase.co/functions/v1/whatsapp-webhook?acao=rastreio',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-guaxi-segredo', segredo),
        body    := jsonb_build_object('envio_id', NEW.id)
      );
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN
  RAISE WARNING 'rastreio automático: %', SQLERRM;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION avisar_rastreio_envio() FROM public, anon, authenticated;
CREATE OR REPLACE TRIGGER envio_rastreio AFTER UPDATE OF status, share_link ON envios
  FOR EACH ROW EXECUTE FUNCTION avisar_rastreio_envio();

-- Agenda (rodar de novo só atualiza o mesmo agendamento)
SELECT cron.schedule('guaxi-lembrete-fim-do-dia', '*/10 * * * *', 'SELECT enviar_lembretes_push()');


-- =============================================================================
-- 7. AJUSTES DE DADOS (cada um só age uma vez; rodar de novo não muda nada)
-- =============================================================================

-- Choux (nov/2026): massa crua → assadas 90% → reassadas, recheia na hora.
-- "Vitrine" deixou de existir; "cascas" passou a se chamar "Assadas 90%".
UPDATE prontidao_lotes SET etapa = 'reassadas' WHERE etapa = 'vitrine';
UPDATE produtos SET prontidao = jsonb_set(prontidao, '{etapas}',
    (coalesce(prontidao->'etapas', '{}'::jsonb) - 'vitrine')
    || jsonb_build_object('reassadas', jsonb_build_object('meta', 3), 'cascas', jsonb_build_object('meta', 10)))
  || jsonb_build_object('noPedido', 'bater o recheio e rechear na hora')
WHERE prontidao->>'fluxo' = 'choux' AND prontidao->'etapas' ? 'vitrine';

-- Atendimento (nov/2026): conversas antigas do WhatsApp ganham dono (app de uma loja só:
-- o dono dos produtos) e cada cliente vira um atendimento.
UPDATE agent_conversas SET user_id = (SELECT user_id FROM produtos WHERE user_id IS NOT NULL LIMIT 1)
WHERE user_id IS NULL;
INSERT INTO atendimentos (telefone, user_id, ultima_msg_em, ultima_msg_cliente_em, lido_em)
SELECT telefone, max(user_id::text)::uuid, max(created_at), max(created_at) FILTER (WHERE role = 'user'), max(created_at)
FROM agent_conversas WHERE user_id IS NOT NULL GROUP BY telefone
ON CONFLICT (telefone) DO NOTHING;

-- Já rodados no passado (ficam só de registro, não precisam rodar de novo):
--   UPDATE encomendas SET estoque_baixado = true WHERE status = 'Entregue';
--   DELETE FROM receitas WHERE user_id IS NULL;   -- receitas de exemplo sem dono


-- =============================================================================
-- 8. RECARREGAR A API (sempre por último: colunas/funções novas aparecem na hora)
-- =============================================================================
NOTIFY pgrst, 'reload schema';
