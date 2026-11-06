import { createClient } from '@supabase/supabase-js'
import { lalamove, lalamoveConfigured } from './_lalamove.js'
import { usuarioLogado } from './_auth.js'

// Cadastra na Lalamove o endereço que recebe os avisos (motorista aceitou, saiu,
// entregou) — o mesmo /api/lalamove-webhook. O app chama ao ligar "Lalamove valendo"
// em Configurações; dá pra chamar de novo sem problema.
//
// Body: { sandbox?: boolean } — exige login  →  { ok, url } | { error }

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const URL_AVISOS   = 'https://guaxi-app.vercel.app/api/lalamove-webhook'

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase service role não configurado' }); return }
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY)
    const user = await usuarioLogado(req, sb)
    if (!user) { res.status(401).json({ error: 'Sessão expirada — entre de novo no app' }); return }
    const sandbox = req.body?.sandbox === true
    if (!lalamoveConfigured(sandbox)) { res.status(500).json({ error: `Lalamove ${sandbox ? 'sandbox' : 'produção'} não configurado` }); return }
    const r = await lalamove('PATCH', '/v3/webhook', { data: { url: URL_AVISOS } }, { sandbox })
    if (!r.ok) { res.status(r.status || 502).json({ error: r.json?.errors?.[0]?.message || `Lalamove recusou (${r.status})` }); return }
    res.status(200).json({ ok: true, url: URL_AVISOS, sandbox })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
