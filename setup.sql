-- ================================================================
-- GUAXI PATISSERIE — Supabase Setup
-- Execute no SQL Editor: https://supabase.com/dashboard/project/xhnzbmguobhfvcmwhhwi/sql
-- ================================================================

-- 1. TABELAS

create table if not exists insumos (
  id          bigserial primary key,
  nome        text not null,
  categoria   text    default '',
  unidade     text    default 'g',
  custo_emb   numeric default 0,
  custo_unit  numeric default 0,
  estoque_atual numeric,
  estoque_min   numeric default 0,
  fornecedor  text    default '',
  telefone    text    default '',
  whatsapp    text    default '',
  created_at  timestamptz default now()
);

create table if not exists embalagens (
  id          bigserial primary key,
  nome        text not null,
  categoria   text    default '',
  custo_unit  numeric default 0,
  estoque_atual numeric,
  estoque_min   numeric default 0,
  fornecedor  text    default '',
  telefone    text    default '',
  whatsapp    text    default '',
  created_at  timestamptz default now()
);

create table if not exists receitas (
  id          bigserial primary key,
  nome        text not null,
  tipo        text    default 'Outro',
  rendimento  numeric default 0,
  custo_total numeric default 0,
  custo_unid  numeric default 0,
  created_at  timestamptz default now()
);

create table if not exists receita_ingredientes (
  id          bigserial primary key,
  receita_id  bigint references receitas(id) on delete cascade,
  insumo_nome text not null,
  quantidade  numeric default 0,
  unidade     text    default 'g'
);

create table if not exists produtos (
  id              bigserial primary key,
  nome            text not null,
  custo_total     numeric default 0,
  preco_sugerido  numeric default 0,
  preco_praticado numeric,
  created_at      timestamptz default now()
);

create table if not exists encomendas (
  id           text primary key,   -- ex: PED-001
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
  created_at   timestamptz default now()
);

create table if not exists encomenda_itens (
  id            bigserial primary key,
  encomenda_id  text references encomendas(id) on delete cascade,
  produto       text not null,
  quantidade    numeric default 1,
  preco_unit    numeric default 0
);

-- 2. ROW LEVEL SECURITY

alter table insumos             enable row level security;
alter table embalagens          enable row level security;
alter table receitas            enable row level security;
alter table receita_ingredientes enable row level security;
alter table produtos            enable row level security;
alter table encomendas          enable row level security;
alter table encomenda_itens     enable row level security;

-- 3. POLÍTICAS — usuários autenticados têm acesso total

create policy "auth_all" on insumos              for all to authenticated using (true) with check (true);
create policy "auth_all" on embalagens           for all to authenticated using (true) with check (true);
create policy "auth_all" on receitas             for all to authenticated using (true) with check (true);
create policy "auth_all" on receita_ingredientes for all to authenticated using (true) with check (true);
create policy "auth_all" on produtos             for all to authenticated using (true) with check (true);
create policy "auth_all" on encomendas           for all to authenticated using (true) with check (true);
create policy "auth_all" on encomenda_itens      for all to authenticated using (true) with check (true);
