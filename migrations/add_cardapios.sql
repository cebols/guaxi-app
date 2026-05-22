-- Cardápio público: 1 link fixo por loja, atualizável.
create table if not exists cardapios (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique,
  nome_loja  text,
  dados      jsonb not null,
  updated_at timestamptz default now()
);

alter table cardapios enable row level security;

-- Leitura pública (clientes acessam o link sem login).
drop policy if exists "cardapios public read" on cardapios;
create policy "cardapios public read" on cardapios
  for select using (true);

-- Apenas o dono escreve/atualiza o próprio cardápio.
drop policy if exists "cardapios owner write" on cardapios;
create policy "cardapios owner write" on cardapios
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
