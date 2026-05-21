-- Migration: adicionar imagem_url em insumos, receitas e produtos
-- Execute no SQL Editor do Supabase

ALTER TABLE insumos  ADD COLUMN IF NOT EXISTS imagem_url text;
ALTER TABLE receitas ADD COLUMN IF NOT EXISTS imagem_url text;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS imagem_url text;
