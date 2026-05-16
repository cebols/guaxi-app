-- migration8.sql — tabela clientes
-- Safe to re-run

CREATE TABLE IF NOT EXISTS clientes (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  telefone   text default '',
  obs        text default '',
  created_at timestamptz default now()
);
