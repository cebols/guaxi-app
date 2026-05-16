-- Histórico de conversas do agente WhatsApp por número de telefone
CREATE TABLE IF NOT EXISTS agent_conversas (
  id          bigserial primary key,
  telefone    text not null,
  role        text not null check (role in ('user', 'assistant')),
  conteudo    text not null,
  created_at  timestamptz default now()
);

CREATE INDEX IF NOT EXISTS agent_conversas_telefone_idx ON agent_conversas (telefone, created_at);

ALTER TABLE agent_conversas ENABLE ROW LEVEL SECURITY;

-- Acesso apenas via service_role (Edge Function usa service key)
CREATE POLICY "service_all" ON agent_conversas
  FOR ALL TO service_role USING (true) WITH CHECK (true);
