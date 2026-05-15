-- ================================================================
-- MIGRAÇÃO: novos campos para insumos e embalagens
-- Execute no SQL Editor do Supabase ANTES do seed_data.sql
-- ================================================================

-- Insumos: adiciona peso_emb (tamanho da embalagem) e peso_un (g por unidade)
ALTER TABLE insumos
  ADD COLUMN IF NOT EXISTS peso_emb  numeric default 0,
  ADD COLUMN IF NOT EXISTS peso_un   numeric;

-- Embalagens: troca lógica de precificação — qtd + custo compra em vez de custo unit manual
ALTER TABLE embalagens
  ADD COLUMN IF NOT EXISTS qtd_compra   numeric default 0,
  ADD COLUMN IF NOT EXISTS custo_compra numeric default 0;
