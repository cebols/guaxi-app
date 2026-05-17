-- migration12.sql — RLS policy para tabela compras (complemento ao migration11)
-- Rodar se já executou migration11 sem a policy
-- Safe to re-run

alter table compras enable row level security;
drop policy if exists "auth_all" on compras;
create policy "auth_all" on compras for all to authenticated using (true) with check (true);
