import { createClient } from '@supabase/supabase-js'
import { lalamove, envioSandbox } from './_lalamove.js'

// Webhook da Lalamove: recebe aviso de mudança de status/motorista e atualiza o envio.
// Configure a URL no painel Lalamove (ou via PATCH /v3/webhook):
//   https://guaxi-app.vercel.app/api/lalamove-webhook
//
// Segurança: qualquer um pode chamar esta URL, então NÃO confiamos no conteúdo
// recebido. Usamos só o orderId pra achar o envio e buscamos o status verdadeiro
// direto na Lalamove (com a nossa chave). Um aviso falso, no máximo, faz a gente
// reler os dados reais.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

// Entrega concluída → os pedidos do envio viram Entregue (a baixa do estoque
// acontece no app, na próxima vez que ele abre pedidos/prontidão).
async function marcarPedidosEntregues(sb, envioId) {
  await sb.from('encomendas').update({ status: 'Entregue' }).eq('envio_id', envioId).neq('status', 'Cancelado')
  await sb.from('encomendas').update({ pgto: 'Atrasado' }).eq('envio_id', envioId).eq('pgto', 'Aguardando')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase service role não configurado' }); return }

  try {
    const body = req.body || {}
    const data = body.data || {}
    const order = data.order || data
    const orderId = String(order.orderId || data.orderId || '')
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(orderId)) { res.status(200).json({ ignored: 'sem orderId' }); return }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY)
    const { data: envio } = await sb.from('envios').select('id, order_id, sandbox').eq('order_id', orderId).single()
    if (!envio) { res.status(200).json({ ignored: 'envio não encontrado' }); return }

    // Status verdadeiro, direto da Lalamove (no ambiente em que o envio saiu)
    const SANDBOX = envioSandbox(envio)
    const get = await lalamove('GET', `/v3/orders/${encodeURIComponent(orderId)}`, null, { sandbox: SANDBOX })
    if (!get.ok) { res.status(200).json({ ignored: 'pedido não confirmado na Lalamove' }); return }
    const od = get.json?.data || {}

    const update = {}
    if (od.status) update.status = od.status
    if (od.shareLink) update.share_link = od.shareLink
    if (od.priceBreakdown?.total) update.price_total = Number(od.priceBreakdown.total)

    if (od.driverId) {
      const drv = await lalamove('GET', `/v3/orders/${encodeURIComponent(orderId)}/drivers/${encodeURIComponent(od.driverId)}`, null, { sandbox: SANDBOX })
      const driver = drv.ok ? drv.json?.data : null
      if (driver?.name) update.driver_nome = driver.name
      if (driver?.phone) update.driver_phone = driver.phone
      if (driver?.plateNumber) update.driver_plate = driver.plateNumber
    }

    if (Object.keys(update).length) await sb.from('envios').update(update).eq('id', envio.id)
    if (update.status === 'COMPLETED') await marcarPedidosEntregues(sb, envio.id)

    res.status(200).json({ ok: true })
  } catch (e) {
    // Responde 200 mesmo em erro pra Lalamove não ficar reenviando infinitamente
    console.error('lalamove-webhook', e)
    res.status(200).json({ ok: false })
  }
}
