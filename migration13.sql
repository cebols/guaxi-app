-- migration13.sql — corrige item_id em compras de uuid para text
-- Os IDs de insumos/embalagens são inteiros, não UUIDs
-- Safe to re-run

ALTER TABLE compras ALTER COLUMN item_id TYPE text USING item_id::text;
