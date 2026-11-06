import { createClient } from '@supabase/supabase-js'
import { lalamove, lalamoveConfigured, envioSandbox } from './_lalamove.js'
import { usuarioLogado } from './_auth.js'

// Cancela um envio: cancela a order na Lalamove (se despachada), desvincula os
// pedidos (voltam pra "A organizar") e marca o envio como CANCELED.
//
// Body: { envioId } — exige login (Authorization: Bearer <token do Supabase>)

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase service role não configurado' }); return }

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY)
    const user = await usuarioLogado(req, sb)
    if (!user) { res.status(401).json({ error: 'Sessão expirada — entre de novo no app' }); return }
    const userId = user.id
    const { envioId } = req.body || {}
    if (!envioId) { res.status(400).json({ error: 'envioId obrigatório' }); return }
    const { data: envio } = await sb.from('envios').select('*').eq('id', envioId).eq('user_id', userId).single()
    if (!envio) { res.status(404).json({ error: 'Envio não encontrado' }); return }

    let lalamoveCancel = 'n/a'
    const SANDBOX = envioSandbox(envio)
    if (envio.order_id && lalamoveConfigured(SANDBOX)) {
      const r = await lalamove('DELETE', `/v3/orders/${envio.order_id}`, null, { sandbox: SANDBOX })
      lalamoveCancel = r.ok ? 'cancelado' : (r.json?.errors?.[0]?.message || `falha (${r.status})`)
    }

    // Desvincula pedidos (voltam pra A organizar) e apaga o envio
    await sb.from('encomendas').update({ envio_id: null }).eq('envio_id', envioId)
    await sb.from('envios').delete().eq('id', envioId)

    res.status(200).json({ ok: true, lalamoveCancel })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
