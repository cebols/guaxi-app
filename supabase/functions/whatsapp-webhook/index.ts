import { createClient } from 'npm:@supabase/supabase-js@2'
import { parseMetaWebhook, sendMetaMessage } from './providers.ts'
import { runAgent } from './agent.ts'
import { avisarRastreio } from './rastreio.ts'

// A Meta assina cada chamada (X-Hub-Signature-256 = HMAC-SHA256 do corpo com o App
// Secret). Sem conferir, qualquer um que descubra esta URL manda mensagens falsas
// pro agente. Configure META_APP_SECRET nos secrets da função (Meta → App → Basic).
async function assinaturaValida(raw: string, header: string | null): Promise<boolean> {
  const segredo = Deno.env.get('META_APP_SECRET')
  if (!segredo) {
    console.warn('META_APP_SECRET não configurado — webhook aceitando sem verificar assinatura')
    return true
  }
  if (!header || !header.startsWith('sha256=')) return false
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(raw)))
  const hex = Array.from(sig).map(b => b.toString(16).padStart(2, '0')).join('')
  const recebido = header.slice(7).toLowerCase()
  if (recebido.length !== hex.length) return false
  let diff = 0
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ recebido.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req: Request) => {
  // Verificação do webhook pela Meta (GET com hub.challenge)
  if (req.method === 'GET') {
    const url       = new URL(req.url)
    const mode      = url.searchParams.get('hub.mode')
    const token     = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')
    if (mode === 'subscribe' && token === Deno.env.get('WEBHOOK_VERIFY_TOKEN')) {
      return new Response(challenge, { status: 200 })
    }
    return new Response('Forbidden', { status: 403 })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Chamada do próprio banco (gatilho em envios): motorista saiu → manda o rastreio.
  // Autenticada pelo segredo guardado no Vault (guaxi_cron_secret).
  if (new URL(req.url).searchParams.get('acao') === 'rastreio') {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: ok } = await sb.rpc('conferir_segredo_guaxi', { p_segredo: req.headers.get('x-guaxi-segredo') || '' })
    if (ok !== true) return new Response('Forbidden', { status: 403 })
    let envioId = 0
    try { envioId = Number((await req.json())?.envio_id) || 0 } catch { /* corpo inválido */ }
    if (!envioId) return new Response('Bad Request', { status: 400 })
    const r = await avisarRastreio(sb, envioId, {
      phoneNumberId: Deno.env.get('META_PHONE_NUMBER_ID')!, accessToken: Deno.env.get('META_ACCESS_TOKEN')!,
    })
    return new Response(JSON.stringify(r), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const raw = await req.text()
  if (!(await assinaturaValida(raw, req.headers.get('x-hub-signature-256')))) {
    return new Response('Forbidden', { status: 403 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const msg = parseMetaWebhook(payload)

  // Retorna 200 imediatamente (Meta exige resposta rápida)
  if (!msg) return new Response('ok', { status: 200 })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const phoneNumberId = Deno.env.get('META_PHONE_NUMBER_ID')!
  const accessToken   = Deno.env.get('META_ACCESS_TOKEN')!

  // Processa em background para não travar o 200
  EdgeRuntime.waitUntil((async () => {
    try {
      const reply = await runAgent(supabase, msg.from, msg.body, msg.pushName)
      if (reply) await sendMetaMessage(msg.from, reply, { phoneNumberId, accessToken })
    } catch (err) {
      console.error('Agent error:', err)
      try {
        await sendMetaMessage(msg.from, 'Ops, tive um problema técnico. Tente novamente em instantes!', { phoneNumberId, accessToken })
      } catch { /* silencia */ }
    }
  })())

  return new Response('ok', { status: 200 })
})
