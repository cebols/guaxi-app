import { createClient } from '@supabase/supabase-js'
import { lalamove, lalamoveConfigured, stopOf, brPhone, quoteTotal, pisoFrete, precoFrete, despachoSandbox } from './_lalamove.js'
import { usuarioLogado } from './_auth.js'

// Despacha um envio na Lalamove: cota → cria order → grava order_id/shareLink/status.
// Ao despachar, REALOCA o frete de cada pedido para sua fração justa do custo real
// da viagem agrupada (proporcional ao custo individual/solo), nunca acima do cotado.
// Despacho em modo teste (sandbox, não chama motorista real) até ligar "Lalamove
// valendo" em Configurações › Delivery. Cada envio guarda em qual modo saiu.
//
// Body: { envioId } — exige login (Authorization: Bearer <token do Supabase>)

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const BLEND        = 0.5   // 50% divisão igual + 50% proporcional à distância

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
    const SANDBOX = despachoSandbox(delivery)
    if (!lalamoveConfigured(SANDBOX)) { res.status(500).json({ error: `Lalamove ${SANDBOX ? 'sandbox' : 'produção'} não configurado` }); return }
    // Motorista de verdade liga pra loja: sem telefone não despacha
    const telLoja = brPhone(delivery.lojaPhone)
    if (!SANDBOX && telLoja.length < 13) { res.status(400).json({ error: 'Cadastre o telefone da loja em Configurações › Delivery (o motorista liga pra ele)' }); return }

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
      phone:  brPhone(pedidos[i]?.contato) || telLoja || '+5521999990000',   // sem telefone do cliente: o motorista liga pra loja
      remarks: pedidos[i]?.obs || '',
    }))
    const order = await lalamove('POST', '/v3/orders', {
      data: {
        quotationId: qd.quotationId,
        sender: { stopId: qd.stops[0].stopId, name: delivery.lojaNome || 'Guaxí Pâtisserie', phone: telLoja || '+5521999990000' },
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
    const N = pedidos.length
    // Piso individual só faz sentido pra envio de 1 parada. No compartilhado a
    // soma do blend já cobre o custo + margem; aplicar piso por parada super-cobra.
    const floor = N === 1 ? pisoFrete(envio.veiculo || 'CAR', delivery) : 0
    const ajustes = []
    for (let i = 0; i < N; i++) {
      // Blend 50/50: metade dividido igual, metade proporcional à distância.
      // Equilibra — perto não paga de menos, longe não é punido. Σ(blend) = C.
      const igual        = C / N
      const proporcional = C * (solos[i] / somaSolo)
      const share        = BLEND * igual + (1 - BLEND) * proporcional
      let   fNovo   = Math.max(floor, precoFrete(share, delivery))
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
      sandbox:      SANDBOX,
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
