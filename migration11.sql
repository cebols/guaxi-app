-- migration11.sql — histórico de compras de insumos e embalagens
-- Safe to re-run

create table if not exists compras (
  id         uuid primary key default gen_random_uuid(),
  tipo       text not null,            -- 'insumo' | 'embalagem'
  item_id    text,
  item_nome  text not null,
  unidade    text default '',
  quantidade numeric not null,
  preco_unit numeric default 0,
  total      numeric default 0,
  data       date not null,
  created_at timestamptz default now()
);

alter table compras enable row level security;
drop policy if exists "auth_all" on compras;
create policy "auth_all" on compras for all to authenticated using (true) with check (true);
