import { createClient } from 'npm:@supabase/supabase-js@2'
import { parseEvolutionWebhook, sendEvolutionMessage } from './providers.ts'
import { runAgent } from './agent.ts'

Deno.serve(async (req: Request) => {
  // Verificação de webhook da Evolution API (GET com token)
  if (req.method === 'GET') {
    const url    = new URL(req.url)
    const token  = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')
    if (token === Deno.env.get('WEBHOOK_VERIFY_TOKEN')) {
      return new Response(challenge || 'ok', { status: 200 })
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

  const msg = parseEvolutionWebhook(payload)

  // Payload não é mensagem de texto — retorna 200 silenciosamente
  if (!msg) return new Response('ok', { status: 200 })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const evolutionBaseUrl = Deno.env.get('EVOLUTION_BASE_URL')!
  const evolutionApiKey  = Deno.env.get('EVOLUTION_API_KEY')!
  const evolutionInstance = Deno.env.get('EVOLUTION_INSTANCE')!

  try {
    const reply = await runAgent(supabase, msg.from, msg.body, msg.pushName)

    await sendEvolutionMessage(msg.from, reply, {
      baseUrl:  evolutionBaseUrl,
      apiKey:   evolutionApiKey,
      instance: evolutionInstance,
    })
  } catch (err) {
    console.error('Agent error:', err)
    // Tenta enviar mensagem de erro ao usuário
    try {
      await sendEvolutionMessage(msg.from, 'Ops, tive um problema técnico. Tente novamente em instantes! 🙏', {
        baseUrl:  evolutionBaseUrl,
        apiKey:   evolutionApiKey,
        instance: evolutionInstance,
      })
    } catch { /* silencia erro de envio */ }
  }

  return new Response('ok', { status: 200 })
})
