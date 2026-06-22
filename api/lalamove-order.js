import { createClient } from '@supabase/supabase-js'
import { lalamove, lalamoveConfigured, stopOf, brPhone, quoteTotal } from './_lalamove.js'

// Despacha um envio na Lalamove: cota → cria order → grava order_id/shareLink/status.
// Ao despachar, REALOCA o frete de cada pedido para sua fração justa do custo real
// da viagem agrupada (proporcional ao custo individual/solo), nunca acima do cotado.
// Despacho usa SANDBOX por padrão (não chama motorista real). Defina
// LALAMOVE_DISPATCH_SANDBOX=false só quando for pra valer.
//
// Body: { userId, envioId }

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const SANDBOX      = process.env.LALAMOVE_DISPATCH_SANDBOX !== 'false'   // default: sandbox
const MARGEM       = Number(process.env.FRETE_MARGEM || 5)
const PISO         = Number(process.env.FRETE_PISO || 10)

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
    if (envio.order_id) { res.status(200).json({ alreadyDispatched: true, orderId: envio.order_id, status: envio.status, shareLink: envio.share_link }); return }

    const { data: pedidos } = await sb
      .from('encomendas')
      .select('id, cliente, contato, endereco, obs, entrega_lat, entrega_lng, frete')
      .eq('envio_id', envioId)
      .eq('user_id', userId)
      .not('entrega_lat', 'is', null)
    if (!pedidos || pedidos.length === 0) { res.status(400).json({ error: 'Envio sem pedidos com coordenadas' }); return }

    const { data: cfgRow } = await sb.from('user_config').select('config').eq('user_id', userId).single()
    const delivery = cfgRow?.config?.delivery || {}
    if (!delivery.lojaLat || !delivery.lojaLng) { res.status(400).json({ error: 'Loja sem coordenadas (Configurações)' }); return }

    // Paradas: loja (remetente) + cada pedido (destinatário)
    const stops = [
      stopOf(delivery.lojaLat, delivery.lojaLng, delivery.lojaEndereco || 'Loja'),
      ...pedidos.map(p => stopOf(p.entrega_lat, p.entrega_lng, p.endereco || 'Cliente')),
    ]

    // 1) Cotação
    const q = await lalamove('POST', '/v3/quotations', {
      data: { serviceType: envio.veiculo || 'CAR', language: 'pt_BR', stops },
    }, { sandbox: SANDBOX })
    if (!q.ok) { res.status(q.status).json({ error: q.json?.errors?.[0]?.message || 'Falha na cotação' }); return }
    const qd = q.json.data

    // 2) Order (despacho)
    const recipients = qd.stops.slice(1).map((s, i) => ({
      stopId: s.stopId,
      name:   pedidos[i]?.cliente || 'Cliente',
      phone:  brPhone(pedidos[i]?.contato) || '+5521999990000',
      remarks: pedidos[i]?.obs || '',
    }))
    const order = await lalamove('POST', '/v3/orders', {
      data: {
        quotationId: qd.quotationId,
        sender: { stopId: qd.stops[0].stopId, name: delivery.lojaNome || 'Guaxi Confeitaria', phone: brPhone(delivery.lojaPhone) || '+5521999990000' },
        recipients,
      },
    }, { sandbox: SANDBOX })
    if (!order.ok) { res.status(order.status).json({ error: order.json?.errors?.[0]?.message || 'Falha ao criar pedido' }); return }
    const od = order.json.data

    // 3) Realoca o frete: cada pedido paga a fração justa do custo real da viagem
    //    (proporcional ao custo individual/solo). Nunca acima do que foi cotado.
    const C = Number(od.priceBreakdown?.total) || Number(qd.priceBreakdown?.total) || 0
    const lojaStop = stopOf(delivery.lojaLat, delivery.lojaLng, delivery.lojaEndereco || 'Loja')
    const solos = []
    for (const p of pedidos) {
      try { solos.push(await quoteTotal([lojaStop, stopOf(p.entrega_lat, p.entrega_lng, p.endereco || 'Cliente')], envio.veiculo || 'CAR', 'pt_BR', { sandbox: SANDBOX })) }
      catch { solos.push(0) }
    }
    const somaSolo = solos.reduce((a, b) => a + b, 0) || 1
    const ajustes = []
    for (let i = 0; i < pedidos.length; i++) {
      const share   = C * (solos[i] / somaSolo)
      let   fNovo   = Math.max(PISO, Math.ceil(share + MARGEM))
      const fAntigo = Number(pedidos[i].frete) || 0
      if (fAntigo > 0) fNovo = Math.min(fNovo, fAntigo)   // nunca aumenta o que já foi cotado
      await sb.from('encomendas').update({ frete: fNovo }).eq('id', pedidos[i].id)
      ajustes.push({ id: pedidos[i].id, cliente: pedidos[i].cliente, antes: fAntigo, depois: fNovo })
    }

    // 4) Grava no envio
    await sb.from('envios').update({
      quotation_id: qd.quotationId,
      order_id:     od.orderId,
      share_link:   od.shareLink || null,
      status:       od.status || 'ASSIGNING_DRIVER',
      price_total:  C,
    }).eq('id', envioId)

    res.status(200).json({
      orderId: od.orderId,
      status: od.status,
      shareLink: od.shareLink,
      custo: C,
      cobrado: ajustes.reduce((s, a) => s + a.depois, 0),
      ajustes,   // frete antes/depois por pedido — pra avisar os clientes
      currency: od.priceBreakdown?.currency,
      sandbox: SANDBOX,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
