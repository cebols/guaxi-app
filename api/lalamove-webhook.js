import { createClient } from '@supabase/supabase-js'
import { lalamove } from './_lalamove.js'

// Webhook da Lalamove: recebe mudanças de status/motorista e atualiza o envio.
// Configure a URL no painel Lalamove (ou via PATCH /v3/webhook):
//   https://guaxi-app.vercel.app/api/lalamove-webhook
//
// Não exige auth nossa (a Lalamove chama). Atualiza por order_id via service-role.
// TODO segurança: validar assinatura do payload antes de produção.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const SANDBOX      = process.env.LALAMOVE_DISPATCH_SANDBOX !== 'false'

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase service role não configurado' }); return }

  try {
    const body = req.body || {}
    const data = body.data || {}
    const order = data.order || data
    const orderId = order.orderId || data.orderId
    if (!orderId) { res.status(200).json({ ignored: 'sem orderId' }); return }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY)
    const { data: envio } = await sb.from('envios').select('id, order_id').eq('order_id', orderId).single()
    if (!envio) { res.status(200).json({ ignored: 'envio não encontrado' }); return }

    const update = {}
    if (order.status) update.status = order.status
    if (order.shareLink) update.share_link = order.shareLink

    // Motorista — vem no payload ou buscamos pelo driverId
    let driver = data.driver || order.driver || null
    const driverId = driver?.driverId || order.driverId || data.driverId
    if (!driver && driverId) {
      const drv = await lalamove('GET', `/v3/orders/${orderId}/drivers/${driverId}`, null, { sandbox: SANDBOX })
      if (drv.ok) driver = drv.json.data
    }
    if (driver) {
      if (driver.name) update.driver_nome = driver.name
      if (driver.phone) update.driver_phone = driver.phone
      if (driver.plateNumber) update.driver_plate = driver.plateNumber
    }

    if (Object.keys(update).length) await sb.from('envios').update(update).eq('id', envio.id)

    res.status(200).json({ ok: true, orderId, applied: update })
  } catch (e) {
    // Responde 200 mesmo em erro pra Lalamove não ficar reenviando infinitamente
    res.status(200).json({ ok: false, error: e.message })
  }
}
