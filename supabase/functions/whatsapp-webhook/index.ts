import { createClient } from 'npm:@supabase/supabase-js@2'
import { parseMetaWebhook, sendMetaMessage } from './providers.ts'
import { runAgent } from './agent.ts'

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

  let payload: unknown
  try {
    payload = await req.json()
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
      await sendMetaMessage(msg.from, reply, { phoneNumberId, accessToken })
    } catch (err) {
      console.error('Agent error:', err)
      try {
        await sendMetaMessage(msg.from, 'Ops, tive um problema técnico. Tente novamente em instantes!', { phoneNumberId, accessToken })
      } catch { /* silencia */ }
    }
  })())

  return new Response('ok', { status: 200 })
})
