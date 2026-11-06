// ── Pix automático (Mercado Pago) ────────────────────────────────────────────
// Cada pedido ganha um Pix com o valor que falta. Quando o Mercado Pago avisa que
// caiu, o pedido vira Pago sozinho, a dona recebe um aviso no celular e o cliente
// recebe "Pix recebido" no WhatsApp (se a conversa estiver aberta).
//
//   POST ?acao=criar     { pedido, chave? }  → { codigo, qr, expira_em, valor } | { pago: true }
//   POST ?acao=conferir  { pedido, chave? }  → { pago, status }   (a página do cliente pergunta de tempos em tempos)
//   POST ?acao=aviso                          ← webhook do Mercado Pago
//
// Quem pode criar/conferir: o cliente com o segredo do pedido (chave_cliente, guardado
// no aparelho dele), a dona logada ou a GuaxiMina (chave de serviço, no recibo do WhatsApp). O aviso do Mercado Pago não é confiado: a função
// sempre consulta o pagamento direto no Mercado Pago antes de marcar como pago.
// verify_jwt: false (o cliente não tem login e o Mercado Pago chama sem JWT).
// Segredo: MERCADOPAGO_ACCESS_TOKEN (Edge Function Secrets).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

const MP = 'https://api.mercadopago.com'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const fmtR = (v: number) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`
const centavos = (v: number) => Math.round(Number(v || 0) * 100)
const soDigitos = (s: string) => String(s || '').replace(/\D/g, '')

interface Pedido {
  id: string; user_id: string; cliente: string; contato: string; valor: number; sinal: number
  pgto: string; status: string; chave_cliente: string | null
  pix_mp_id: string | null; pix_codigo: string | null; pix_valor: number | null; pix_expira_em: string | null
}
interface Pagamento {
  id: number; status: string; external_reference?: string; transaction_amount?: number; date_of_expiration?: string
  point_of_interaction?: { transaction_data?: { qr_code?: string; qr_code_base64?: string } }
}

const CAMPOS = 'id, user_id, cliente, contato, valor, sinal, pgto, status, chave_cliente, pix_mp_id, pix_codigo, pix_valor, pix_expira_em'
const falta = (p: Pedido) => Math.max(0, Math.round((Number(p.valor) - Number(p.sinal || 0)) * 100) / 100)

function mp(path: string, init: RequestInit = {}) {
  return fetch(`${MP}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${Deno.env.get('MERCADOPAGO_ACCESS_TOKEN')}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
}
async function lerPagamento(id: string | number): Promise<Pagamento | null> {
  const r = await mp(`/v1/payments/${encodeURIComponent(String(id))}`)
  if (!r.ok) return null
  return await r.json() as Pagamento
}

// Data no fuso de Brasília no formato que o Mercado Pago aceita (…-03:00)
function emBrasilia(ms: number) {
  return new Date(ms - 3 * 3600e3).toISOString().replace('Z', '-03:00')
}
const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)

// Quem está pedindo: o cliente (segredo do pedido) ou a dona logada
async function acharPedido(sb: SupabaseClient, req: Request, body: { pedido?: string; chave?: string }): Promise<Pedido | null> {
  const id = String(body.pedido || '').trim()
  if (!/^PED-\d{1,6}$/.test(id)) return null
  const { data: p } = await sb.from('encomendas').select(CAMPOS).eq('id', id).maybeSingle()
  if (!p) return null
  const chave = String(body.chave || '')
  if (chave.length >= 20 && p.chave_cliente && chave === p.chave_cliente) return p as Pedido
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (token && token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) return p as Pedido
  if (token) {
    const { data: auth } = await sb.auth.getUser(token)
    if (auth?.user && auth.user.id === p.user_id) return p as Pedido
  }
  return null
}

// Caiu: marca Pago (uma vez só), avisa a dona e o cliente
async function marcarPago(sb: SupabaseClient, pedidoId: string, pag: Pagamento) {
  const agora = new Date().toISOString()
  const { data: upd } = await sb.from('encomendas')
    .update({ pgto: 'Pago', data_pago: hojeBR(), pix_pago_em: agora })
    .eq('id', pedidoId).neq('pgto', 'Pago')
    .select('id, user_id, cliente, contato, valor')
  const p = upd?.[0]
  if (!p) return false   // já estava pago (aviso repetido)

  const nome = String(p.cliente || '').trim().split(/\s+/)[0]
  const { error } = await sb.rpc('avisar_dono', {
    p_user_id: p.user_id, p_titulo: `💸 Pix recebido · ${p.id}`,
    p_corpo: `${nome || 'Cliente'} pagou ${fmtR(Number(pag.transaction_amount || p.valor))}. O pedido tá confirmado.`,
    p_url: '/pedidos', p_tag: `pix-${p.id}`,
  })
  if (error) console.error('avisar_dono', error.message)

  // WhatsApp da Guaxí, se a conversa com o cliente estiver aberta (janela de 24h da Meta)
  const fim = soDigitos(p.contato).slice(-8)
  if (fim.length === 8) {
    const { data: ats } = await sb.from('atendimentos').select('telefone, ultima_msg_cliente_em').like('telefone', `%${fim}`)
    const at = (ats || []).find(a => a.ultima_msg_cliente_em && Date.now() - new Date(a.ultima_msg_cliente_em).getTime() < 24 * 3600e3)
    if (at) {
      const texto = `Recebi seu Pix do pedido *${p.id}* ✅ Tá confirmadíssimo${nome ? `, ${nome}` : ''}! Qualquer coisa é só me chamar aqui 💛`
      const r = await fetch(`https://graph.facebook.com/v19.0/${Deno.env.get('META_PHONE_NUMBER_ID')}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${Deno.env.get('META_ACCESS_TOKEN')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: at.telefone, type: 'text', text: { body: texto } }),
      }).catch(() => null)
      if (r?.ok) {
        await sb.from('agent_conversas').insert({ telefone: at.telefone, role: 'assistant', conteudo: texto, user_id: p.user_id })
        await sb.from('atendimentos').update({ ultima_msg_em: agora }).eq('telefone', at.telefone)
      }
    }
  }
  return true
}

async function criar(sb: SupabaseClient, p: Pedido) {
  if (p.status === 'Cancelado') return json({ error: 'Pedido cancelado' }, 409)
  const valor = falta(p)
  if (p.pgto === 'Pago' || valor <= 0) return json({ pago: true })

  // Já tem um Pix desse valor ainda valendo (com folga de 10 min): reaproveita
  const valendo = p.pix_mp_id && p.pix_codigo && centavos(Number(p.pix_valor)) === centavos(valor)
    && p.pix_expira_em && new Date(p.pix_expira_em).getTime() > Date.now() + 10 * 60e3
  if (valendo) {
    const pag = await lerPagamento(p.pix_mp_id!)
    if (pag?.status === 'approved' && pag.external_reference === p.id) { await marcarPago(sb, p.id, pag); return json({ pago: true }) }
    if (pag && ['pending', 'in_process'].includes(pag.status)) {
      return json({ codigo: p.pix_codigo, qr: pag.point_of_interaction?.transaction_data?.qr_code_base64 || null, expira_em: p.pix_expira_em, valor })
    }
  }
  // O Pix antigo (outro valor ou vencendo) não vale mais
  if (p.pix_mp_id) {
    const velho = await lerPagamento(p.pix_mp_id)
    if (velho?.status === 'approved' && velho.external_reference === p.id) { await marcarPago(sb, p.id, velho); return json({ pago: true }) }
    if (velho && velho.status === 'pending') await mp(`/v1/payments/${p.pix_mp_id}`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) }).catch(() => null)
  }

  const nome = String(p.cliente || '').trim().split(/\s+/)[0] || 'Cliente'
  const expiraMs = Date.now() + 24 * 3600e3
  const r = await mp('/v1/payments', {
    method: 'POST',
    // mesma chave em 10 min = mesmo Pix (duas abas abertas não geram duas cobranças)
    headers: { 'X-Idempotency-Key': `${p.id}-${centavos(valor)}-${Math.floor(Date.now() / 600e3)}` },
    body: JSON.stringify({
      transaction_amount: valor,
      description: `Guaxí Pâtisserie · ${p.id}`,
      payment_method_id: 'pix',
      external_reference: p.id,
      notification_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-mercadopago?acao=aviso`,
      date_of_expiration: emBrasilia(expiraMs),
      // o Mercado Pago exige um e-mail; o cliente não informa, então vai um do pedido
      payer: { email: `pedido-${p.id.toLowerCase()}@guaxi-app.vercel.app`, first_name: nome },
    }),
  })
  const pag = await r.json().catch(() => null) as (Pagamento & { message?: string }) | null
  const codigo = pag?.point_of_interaction?.transaction_data?.qr_code
  if (!r.ok || !pag?.id || !codigo) {
    console.error('mercado pago criar', r.status, JSON.stringify(pag).slice(0, 400))
    return json({ error: 'Não deu pra gerar o Pix agora', detalhe: pag?.message || r.status }, 502)
  }
  const expira = pag.date_of_expiration ? new Date(pag.date_of_expiration).toISOString() : new Date(expiraMs).toISOString()
  await sb.from('encomendas').update({ pix_mp_id: String(pag.id), pix_codigo: codigo, pix_valor: valor, pix_expira_em: expira }).eq('id', p.id)
  return json({ codigo, qr: pag.point_of_interaction?.transaction_data?.qr_code_base64 || null, expira_em: expira, valor })
}

async function conferir(sb: SupabaseClient, p: Pedido) {
  if (p.pgto === 'Pago') return json({ pago: true })
  if (!p.pix_mp_id) return json({ pago: false, status: 'sem_pix' })
  const pag = await lerPagamento(p.pix_mp_id)
  if (pag?.status === 'approved' && pag.external_reference === p.id) { await marcarPago(sb, p.id, pag); return json({ pago: true }) }
  return json({ pago: false, status: pag?.status || 'desconhecido' })
}

// Webhook: o Mercado Pago manda só o id; a gente consulta o pagamento de verdade
async function aviso(sb: SupabaseClient, req: Request) {
  const url = new URL(req.url)
  let body: { type?: string; action?: string; data?: { id?: string | number } } = {}
  try { body = await req.json() } catch { /* aviso antigo vem só na URL */ }
  const tipo = body.type || url.searchParams.get('type') || url.searchParams.get('topic') || ''
  const id = body.data?.id ?? url.searchParams.get('data.id') ?? url.searchParams.get('id')
  if (tipo !== 'payment' || !id) return json({ ok: true, ignorado: tipo || 'sem tipo' })
  const pag = await lerPagamento(id)
  if (!pag) return json({ error: 'não achei o pagamento' }, 500)   // 500 = o Mercado Pago tenta de novo
  const ref = String(pag.external_reference || '')
  if (pag.status !== 'approved' || !/^PED-\d+$/.test(ref)) return json({ ok: true, status: pag.status })
  const { data: p } = await sb.from('encomendas').select(CAMPOS).eq('id', ref).maybeSingle()
  if (!p) return json({ ok: true, ignorado: 'pedido não existe' })
  const marcou = await marcarPago(sb, ref, pag)
  return json({ ok: true, marcou })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (!Deno.env.get('MERCADOPAGO_ACCESS_TOKEN')) return json({ error: 'Mercado Pago não configurado' }, 503)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const acao = new URL(req.url).searchParams.get('acao')
  try {
    if (acao === 'aviso') return await aviso(sb, req)
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    let body: { pedido?: string; chave?: string; acao?: string } = {}
    try { body = await req.json() } catch { return json({ error: 'Corpo inválido' }, 400) }
    const qual = acao || body.acao
    const p = await acharPedido(sb, req, body)
    if (!p) return json({ error: 'Pedido não encontrado' }, 404)
    if (qual === 'criar') return await criar(sb, p)
    if (qual === 'conferir') return await conferir(sb, p)
    return json({ error: 'Ação inválida' }, 400)
  } catch (e) {
    console.error('pix-mercadopago', e)
    return json({ error: 'Erro interno' }, 500)
  }
})
