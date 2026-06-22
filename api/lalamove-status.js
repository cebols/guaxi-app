import { createClient } from '@supabase/supabase-js'
import { lalamove, lalamoveConfigured } from './_lalamove.js'

// Consulta o status de um envio despachado e atualiza o registro:
// status Lalamove + dados do motorista (quando atribuído).
//
// Body: { userId, envioId }

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const SANDBOX      = process.env.LALAMOVE_DISPATCH_SANDBOX !== 'false'

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  if (!lalamoveConfigured(SANDBOX)) { res.status(500).json({ error: `Lalamove ${SANDBOX ? 'sandbox' : 'produção'} não configurado` }); return }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase service role não configurado' }); return }

  try {
    const { userId, envioId } = req.body || {}
    if (!userId || !envioId) { res.status(400).json({ error: 'userId e envioId obrigatórios' }); return }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY)
    const { data: envio } = await sb.from('envios').select('*').eq('id', envioId).eq('user_id', userId).single()
    if (!envio) { res.status(404).json({ error: 'Envio não encontrado' }); return }
    if (!envio.order_id) { res.status(400).json({ error: 'Envio ainda não despachado' }); return }

    const get = await lalamove('GET', `/v3/orders/${envio.order_id}`, null, { sandbox: SANDBOX })
    if (!get.ok) { res.status(get.status).json({ error: get.json?.errors?.[0]?.message || 'Falha ao consultar pedido' }); return }
    const od = get.json.data

    const update = {
      status: od.status,
      share_link: od.shareLink || envio.share_link,
      price_total: Number(od.priceBreakdown?.total) || envio.price_total,
    }

    // Motorista (quando atribuído)
    let driver = null
    if (od.driverId) {
      const drv = await lalamove('GET', `/v3/orders/${envio.order_id}/drivers/${od.driverId}`, null, { sandbox: SANDBOX })
      if (drv.ok) {
        driver = drv.json.data
        update.driver_nome  = driver.name || null
        update.driver_phone = driver.phone || null
        update.driver_plate = driver.plateNumber || null
      }
    }

    await sb.from('envios').update(update).eq('id', envioId)

    res.status(200).json({
      status: od.status,
      shareLink: od.shareLink,
      driver: driver && { nome: driver.name, phone: driver.phone, plate: driver.plateNumber, coordinates: driver.location || driver.coordinates },
      sandbox: SANDBOX,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
