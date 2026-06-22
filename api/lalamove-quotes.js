import { createClient } from '@supabase/supabase-js'
import { lalamove, lalamoveConfigured, stopOf } from './_lalamove.js'

// Cota um envio em VÁRIAS categorias de veículo (pros parâmetros reais do envio:
// loja + paradas). Usado no modal de despacho pra você escolher a categoria.
//
// Body: { userId, envioId }  →  { quotes: [{ veiculo, total, currency } | { veiculo, erro }] }

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const SANDBOX      = process.env.LALAMOVE_DISPATCH_SANDBOX !== 'false'
const CATEGORIAS   = ['LALAGO', 'HATCHBACK', 'CAR', 'VAN']

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  if (!lalamoveConfigured(SANDBOX)) { res.status(500).json({ error: `Lalamove ${SANDBOX ? 'sandbox' : 'produção'} não configurado` }); return }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase service role não configurado' }); return }

  try {
    const { userId, envioId } = req.body || {}
    if (!userId || !envioId) { res.status(400).json({ error: 'userId e envioId obrigatórios' }); return }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY)
    const { data: envio } = await sb.from('envios').select('id, user_id').eq('id', envioId).eq('user_id', userId).single()
    if (!envio) { res.status(404).json({ error: 'Envio não encontrado' }); return }

    const { data: pedidos } = await sb
      .from('encomendas').select('endereco, entrega_lat, entrega_lng')
      .eq('envio_id', envioId).eq('user_id', userId).not('entrega_lat', 'is', null)
    if (!pedidos || pedidos.length === 0) { res.status(400).json({ error: 'Envio sem pedidos com coordenadas' }); return }

    const { data: cfgRow } = await sb.from('user_config').select('config').eq('user_id', userId).single()
    const delivery = cfgRow?.config?.delivery || {}
    if (!delivery.lojaLat || !delivery.lojaLng) { res.status(400).json({ error: 'Loja sem coordenadas' }); return }

    const stops = [
      stopOf(delivery.lojaLat, delivery.lojaLng, delivery.lojaEndereco || 'Loja'),
      ...pedidos.map(p => stopOf(p.entrega_lat, p.entrega_lng, p.endereco || 'Cliente')),
    ]

    const quotes = []
    for (const veiculo of CATEGORIAS) {
      const r = await lalamove('POST', '/v3/quotations', { data: { serviceType: veiculo, language: 'pt_BR', stops } }, { sandbox: SANDBOX })
      if (r.ok) {
        const pb = r.json.data?.priceBreakdown
        quotes.push({ veiculo, total: Number(pb?.total), currency: pb?.currency, distancia: Number(r.json.data?.distance?.value) || null })
      } else {
        quotes.push({ veiculo, erro: r.json?.errors?.[0]?.message || 'indisponível' })
      }
    }

    res.status(200).json({ paradas: pedidos.length, quotes, sandbox: SANDBOX })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
