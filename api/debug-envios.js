import { createClient } from '@supabase/supabase-js'

// DEBUG temporário: dump do estado de envios/encomendas pra diagnosticar o kanban.
// Remover depois.  GET /api/debug-envios?userId=...

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'sem service role' }); return }
  const userId = req.query?.userId || (req.body && req.body.userId)
  if (!userId) { res.status(400).json({ error: 'userId obrigatório' }); return }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY)
  const { data: envios } = await sb.from('envios').select('id, status, veiculo, order_id, data_entrega').eq('user_id', userId).order('id')
  const { data: enc } = await sb.from('encomendas')
    .select('id, tipo_entrega, status, data_entrega, entrega_lat, envio_id')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(20)

  res.status(200).json({ envios, encomendas: enc })
}
