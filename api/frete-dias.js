import { createClient } from '@supabase/supabase-js'
import { quoteTotal, stopOf, lalamoveConfigured } from './_lalamove.js'

// Calcula o frete por dia (custo marginal real da Lalamove) para o formulário
// público. Roda server-side com service-role: as coordenadas dos outros
// clientes NUNCA saem do servidor — devolve só { date, preco, veiculo }.
//
// Env vars (Vercel): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (+ as do Lalamove)
//
// Modelo: preço = max(PISO, ceil(marginal + MARGEM))
//   marginal = cota(loja + pedidos_do_dia + cliente) − cota(loja + pedidos_do_dia)
// Σ dos marginais telescopa no custo real da viagem ⇒ nunca sai no prejuízo.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

const VEICULO = { robusto: 'LALAGO', fragil: 'CAR' }
const MARGEM  = Number(process.env.FRETE_MARGEM || 5)
const PISO    = Number(process.env.FRETE_PISO || 10)
const JANELA  = 14   // procura próximas datas dentro de 2 semanas

const iso = (d) => d.toISOString().slice(0, 10)
const ordSemana = (wd) => (wd + 6) % 7   // segunda=0 ... domingo=6

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  if (!lalamoveConfigured())          { res.status(500).json({ error: 'Lalamove não configurado' }); return }
  if (!SUPABASE_URL || !SERVICE_KEY)  { res.status(500).json({ error: 'Supabase service role não configurado' }); return }

  try {
    const { userId, lat, lng, frag = 'robusto', total = 0 } = req.body || {}
    if (!userId || lat == null || lng == null) {
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

    // Próxima ocorrência de cada dia da semana configurado (uma por weekday)
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
    const datas = []
    const vistos = new Set()
    for (let i = 0; i < JANELA && vistos.size < diasSemana.length; i++) {
      const d = new Date(hoje); d.setDate(hoje.getDate() + i)
      const wd = d.getDay()
      if (diasSemana.includes(wd) && !vistos.has(wd)) { vistos.add(wd); datas.push(d) }
    }
    if (datas.length === 0) { res.status(200).json({ dias: [] }); return }

    // Pedidos já reservados nessas datas (com coordenadas)
    const { data: pedidos } = await sb
      .from('encomendas')
      .select('data_entrega, entrega_lat, entrega_lng, entrega_frag')
      .eq('user_id', userId)
      .eq('tipo_entrega', 'Entrega')
      .in('data_entrega', datas.map(iso))
      .not('entrega_lat', 'is', null)

    const porDia = {}
    for (const p of (pedidos || [])) (porDia[p.data_entrega] ||= []).push(p)

    const loja    = stopOf(lojaLat, lojaLng, 'Loja')
    const cliente = stopOf(lat, lng, 'Cliente')
    const gratis  = freteGratis > 0 && total >= freteGratis

    const dias = []
    for (const d of datas) {
      const key = iso(d)
      const reservados = porDia[key] || []
      const fragil  = frag === 'fragil' || reservados.some(p => p.entrega_frag === 'fragil')
      const veiculo = fragil ? VEICULO.fragil : VEICULO.robusto

      const stopsExist = reservados.map(p => stopOf(p.entrega_lat, p.entrega_lng))
      const base       = stopsExist.length === 0 ? 0 : await quoteTotal([loja, ...stopsExist], veiculo)
      const comCliente = await quoteTotal([loja, ...stopsExist, cliente], veiculo)
      const marginal   = comCliente - base
      const preco      = gratis ? 0 : Math.max(PISO, Math.ceil(marginal + MARGEM))

      dias.push({ date: key, weekday: d.getDay(), pedidos: reservados.length, veiculo, preco, gratis })
    }

    // Ordena por dia da semana: segunda → domingo
    dias.sort((a, b) => ordSemana(a.weekday) - ordSemana(b.weekday))

    res.status(200).json({ dias })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
