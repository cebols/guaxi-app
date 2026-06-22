import { createClient } from '@supabase/supabase-js'
import { lalamove, lalamoveConfigured } from './_lalamove.js'

// Cancela um envio: cancela a order na Lalamove (se despachada), desvincula os
// pedidos (voltam pra "A organizar") e marca o envio como CANCELED.
//
// Body: { userId, envioId }

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const SANDBOX      = process.env.LALAMOVE_DISPATCH_SANDBOX !== 'false'

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase service role não configurado' }); return }

  try {
    const { userId, envioId } = req.body || {}
    if (!userId || !envioId) { res.status(400).json({ error: 'userId e envioId obrigatórios' }); return }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY)
    const { data: envio } = await sb.from('envios').select('*').eq('id', envioId).eq('user_id', userId).single()
    if (!envio) { res.status(404).json({ error: 'Envio não encontrado' }); return }

    let lalamoveCancel = 'n/a'
    if (envio.order_id && lalamoveConfigured(SANDBOX)) {
      const r = await lalamove('DELETE', `/v3/orders/${envio.order_id}`, null, { sandbox: SANDBOX })
      lalamoveCancel = r.ok ? 'cancelado' : (r.json?.errors?.[0]?.message || `falha (${r.status})`)
    }

    // Desvincula pedidos (voltam pra A organizar) e marca envio como CANCELED
    await sb.from('encomendas').update({ envio_id: null }).eq('envio_id', envioId)
    await sb.from('envios').update({ status: 'CANCELED' }).eq('id', envioId)

    res.status(200).json({ ok: true, lalamoveCancel })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
