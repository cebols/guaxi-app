-- migration11.sql — histórico de compras de insumos e embalagens
-- Safe to re-run

create table if not exists compras (
  id         uuid primary key default gen_random_uuid(),
  tipo       text not null,            -- 'insumo' | 'embalagem'
  item_id    uuid,
  item_nome  text not null,
  unidade    text default '',
  quantidade numeric not null,
  preco_unit numeric default 0,
  total      numeric default 0,
  data       date not null,
  created_at timestamptz default now()
);
