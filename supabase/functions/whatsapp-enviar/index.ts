// Envia pelo WhatsApp da Guaxí uma mensagem escrita por você no app (tela Atendimento).
// Exige login (verify_jwt) e só manda pra clientes do seu atendimento, dentro da
// janela de 24h da Meta. Ao responder, você assume a conversa (o bot pausa), a não
// ser que mande pausar: false (avisos como o link de rastreio da entrega).
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const JANELA_MS = 24 * 3600e3

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const { data: auth } = await sb.auth.getUser(token)
  const user = auth?.user
  if (!user) return json({ error: 'Faça login de novo' }, 401)

  let body: { telefone?: string; texto?: string; pausar?: boolean }
  try { body = await req.json() } catch { return json({ error: 'Corpo inválido' }, 400) }
  const telefone = String(body.telefone || '').replace(/\D/g, '')
  const texto = String(body.texto || '').trim()
  if (telefone.length < 10 || telefone.length > 15) return json({ error: 'Telefone inválido' }, 400)
  if (!texto || texto.length > 4000) return json({ error: 'Mensagem vazia ou longa demais' }, 400)

  const { data: at } = await sb.from('atendimentos').select('user_id, ultima_msg_cliente_em').eq('telefone', telefone).maybeSingle()
  if (!at || at.user_id !== user.id) return json({ error: 'Conversa não encontrada' }, 404)
  const ultima = at.ultima_msg_cliente_em ? new Date(at.ultima_msg_cliente_em).getTime() : 0
  if (Date.now() - ultima > JANELA_MS) {
    return json({ error: 'Já passou de 24h desde a última mensagem do cliente. A Meta só libera responder quando ele mandar mensagem de novo.' }, 409)
  }

  const r = await fetch(`https://graph.facebook.com/v19.0/${Deno.env.get('META_PHONE_NUMBER_ID')}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('META_ACCESS_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: telefone, type: 'text', text: { body: texto } }),
  })
  if (!r.ok) {
    const e = await r.json().catch(() => null) as { error?: { message?: string } } | null
    return json({ error: `WhatsApp recusou: ${e?.error?.message || r.status}` }, 502)
  }

  const agora = new Date().toISOString()
  await sb.from('agent_conversas').insert({ telefone, role: 'humano', conteudo: texto, user_id: user.id })
  const upd = body.pausar === false
    ? { ultima_msg_em: agora }
    : { bot_pausado: true, precisa_humano: false, ultima_msg_em: agora, lido_em: agora }
  await sb.from('atendimentos').update(upd).eq('telefone', telefone)
  return json({ ok: true })
})
