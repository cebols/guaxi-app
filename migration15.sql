-- migration15.sql — entrega vs retirada em encomendas
ALTER TABLE encomendas ADD COLUMN IF NOT EXISTS tipo_entrega text DEFAULT 'Retirada';
ALTER TABLE encomendas ADD COLUMN IF NOT EXISTS frete numeric DEFAULT 0;
