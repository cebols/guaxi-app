import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { quoteTotal, stopOf, lalamoveConfigured, pisoFrete, precoFrete, veiculoPara } from './_lalamove.js'

// Calcula o frete por dia (estimativa) para o formulário público. Roda
// server-side com service-role: as coordenadas dos outros clientes NUNCA saem
// do servidor — devolve só { date, preco, veiculo }.
//
// Env vars (Vercel): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (+ as do Lalamove)
//
// Estimativa (teto) = max(piso_veiculo, precoFrete(min(marginal, solo))) — margem % c/ mínimo, arred. R$ 0,50.
// O valor FINAL (mais barato) é recalculado no despacho (rateio blend 50/50).

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

// Veículo pela fragilidade (moto pra robusto, hatch se tiver frágil) — o mesmo
// critério do despacho, pra o preço cotado nunca ficar abaixo do custo real.
const JANELA  = 14   // procura próximas datas dentro de 2 semanas
const OPCOES  = 6    // quantos dias de entrega o cliente vê (a partir de amanhã)

const iso = (d) => d.toISOString().slice(0, 10)

// Assinatura do frete: o banco (submit_pedido_externo) confere com o mesmo segredo
// (CRON_SECRET aqui = guaxi_cron_secret no Vault). Sem ela o pedido entra com aviso.
// Com período, o preço vale só pra aquele período (é a rota daquele período que barateia).
function assinar(userId, date, preco, lat, lng, frag, periodo = null) {
  const segredo = process.env.CRON_SECRET
  if (!segredo) return null
  const msg = `${userId}|${date}|${Number(preco).toFixed(2)}|${Number(lat).toFixed(5)}|${Number(lng).toFixed(5)}|${frag}${periodo ? `|${periodo}` : ''}`
  return crypto.createHmac('sha256', segredo).update(msg).digest('hex')
}
const PERIODOS = ['manha', 'tarde', 'noite']

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  if (!lalamoveConfigured())          { res.status(500).json({ error: 'Lalamove não configurado' }); return }
  if (!SUPABASE_URL || !SERVICE_KEY)  { res.status(500).json({ error: 'Supabase service role não configurado' }); return }

  try {
    const { userId, frag: fragIn = 'robusto', total: totalIn = 0 } = req.body || {}
    const lat = Math.round(Number(req.body?.lat) * 1e5) / 1e5
    const lng = Math.round(Number(req.body?.lng) * 1e5) / 1e5
    const frag = fragIn === 'fragil' ? 'fragil' : 'robusto'
    const total = Number(totalIn) || 0
    if (!/^[0-9a-f-]{36}$/i.test(String(userId || '')) || !Number.isFinite(lat) || !Number.isFinite(lng)
        || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      res.status(400).json({ error: 'userId, lat e lng obrigatórios' }); return
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY)

    // Config de delivery
    const { data: cfgRow } = await sb.from('user_config').select('config').eq('user_id', userId).single()
    const delivery    = cfgRow?.config?.delivery || {}
    const diasSemana  = Array.isArray(delivery.diasEntrega) ? delivery.diasEntrega : [] // 0=dom..6=sáb
    const freteGratis = Number(delivery.freteGratis || 0)
    const lojaLat = delivery.lojaLat, lojaLng = delivery.lojaLng

    if (!lojaLat || !lojaLng)      { res.status(400).json({ error: 'Loja sem coordenadas (salve o CEP da loja em Configurações)' }); return }
    if (diasSemana.length === 0)   { res.status(200).json({ dias: [] }); return }

    // Só agendamento: a partir de amanhã, os próximos dias de entrega em ordem de data.
    // "Hoje" é o dia em Brasília (o servidor roda em UTC).
    const agoraBR = new Date(Date.now() - 3 * 3600e3)
    const hojeUTC = Date.UTC(agoraBR.getUTCFullYear(), agoraBR.getUTCMonth(), agoraBR.getUTCDate())
    const datas = []
    for (let i = 1; i <= JANELA && datas.length < OPCOES; i++) {
      const d = new Date(hojeUTC + i * 864e5)
      if (diasSemana.includes(d.getUTCDay())) datas.push(d)
    }
    if (datas.length === 0) { res.status(200).json({ dias: [] }); return }

    // Pedidos já reservados nessas datas (com coordenadas)
    const { data: pedidos } = await sb
      .from('encomendas')
      .select('data_entrega, periodo, entrega_lat, entrega_lng, entrega_frag, status')
      .eq('user_id', userId)
      .eq('tipo_entrega', 'Entrega')
      .in('data_entrega', datas.map(iso))
      .not('entrega_lat', 'is', null)

    const porDia = {}
    for (const p of (pedidos || [])) {
      if (p.status === 'Cancelado' || p.status === 'Entregue') continue
      (porDia[p.data_entrega] ||= []).push(p)
    }

    const loja    = stopOf(lojaLat, lojaLng, 'Loja')
    const cliente = stopOf(lat, lng, 'Cliente')
    const gratis  = freteGratis > 0 && total >= freteGratis

    // Custo individual (solo) — teto do preço: o cliente nunca paga mais do que
    // custaria entregar só pra ele, mesmo que o dia tenha pedidos distantes.
    const veicCliente = veiculoPara([frag])
    const solo = await quoteTotal([loja, cliente], veicCliente)

    const precoSolo = gratis ? 0 : Math.max(pisoFrete(veicCliente, delivery), precoFrete(solo, delivery))

    // Preço de entrar numa rota já existente (pedidos daquele dia e período)
    async function precoNaRota(reservados) {
      if (!reservados.length) return { preco: precoSolo, compartilhado: false, veiculo: veicCliente }
      const fragsRota = reservados.map(p => p.entrega_frag || 'robusto')
      const veicRota  = veiculoPara(fragsRota)
      const veiculo   = veiculoPara([...fragsRota, frag])   // se o cliente é frágil, a rota sobe pra carro
      const stops     = reservados.map((p, i) => stopOf(p.entrega_lat, p.entrega_lng, `Parada ${i + 1}`))
      const base       = await quoteTotal([loja, ...stops], veicRota)
      const comCliente = await quoteTotal([loja, ...stops, cliente], veiculo)
      const marginal   = comCliente - base
      // Paga o menor entre o marginal do compartilhado e o solo individual
      const custo = Math.min(marginal, solo)
      const preco = gratis ? 0 : Math.max(pisoFrete(veicCliente, delivery), precoFrete(custo, delivery))
      return { preco, compartilhado: marginal < solo, veiculo }
    }

    const dias = []
    for (const d of datas) {
      const key = iso(d)
      const reservados = porDia[key] || []
      // Um envio por período: só os pedidos do mesmo período dividem a rota.
      // Pedidos ainda sem período não entram na conta de nenhum.
      const periodos = []
      for (const per of PERIODOS) {
        const daRota = reservados.filter(p => p.periodo === per)
        const r = await precoNaRota(daRota)
        periodos.push({ periodo: per, pedidos: daRota.length, preco: r.preco, compartilhado: daRota.length > 0 && r.compartilhado,
                        assinatura: assinar(userId, key, r.preco, lat, lng, frag, per) })
      }
      // Resumo do dia (agente do WhatsApp / pedido sem período): o período mais barato
      const melhor = [...periodos].sort((a, b) => a.preco - b.preco || b.pedidos - a.pedidos)[0]
      dias.push({ date: key, weekday: d.getUTCDay(), pedidos: reservados.length, veiculo: veicCliente, preco: melhor.preco, gratis,
                  compartilhado: periodos.some(p => p.compartilhado), periodos,
                  assinatura: assinar(userId, key, melhor.preco, lat, lng, frag) })
    }

    res.status(200).json({ dias, precoSolo })
  } catch (e) {
    console.error('frete-dias', e)
    res.status(500).json({ error: 'Não foi possível calcular o frete agora' })
  }
}
