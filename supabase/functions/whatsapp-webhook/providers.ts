// WhatsApp provider — Evolution API (padrão no Brasil)

export interface IncomingMessage {
  from: string      // número com DDI, ex: 5511999999999
  body: string
  pushName?: string // nome do contato no WhatsApp
}

export function parseEvolutionWebhook(payload: unknown): IncomingMessage | null {
  try {
    const p = payload as Record<string, unknown>

    // Evolution API v2
    if (p.event === 'messages.upsert' || p.event === 'MESSAGES_UPSERT') {
      const data = p.data as Record<string, unknown>
      const key  = data?.key  as Record<string, unknown>
      const msg  = data?.message as Record<string, unknown>

      // Ignora mensagens enviadas pelo próprio bot
      if (key?.fromMe) return null

      const body =
        (msg?.conversation as string) ||
        (msg?.extendedTextMessage as Record<string, unknown>)?.text as string ||
        ''

      if (!body.trim()) return null

      return {
        from:     (key?.remoteJid as string)?.replace('@s.whatsapp.net', '') || '',
        body:     body.trim(),
        pushName: (data?.pushName as string) || undefined,
      }
    }

    // Formato legado / webhook simples
    if (p.from && p.body) {
      return {
        from:     String(p.from).replace('@s.whatsapp.net', ''),
        body:     String(p.body).trim(),
        pushName: p.pushName ? String(p.pushName) : undefined,
      }
    }

    return null
  } catch {
    return null
  }
}

export async function sendEvolutionMessage(
  phone: string,
  text:  string,
  opts: { baseUrl: string; apiKey: string; instance: string }
) {
  const url = `${opts.baseUrl}/message/sendText/${opts.instance}`
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', apikey: opts.apiKey },
    body: JSON.stringify({
      number:  phone,
      options: { delay: 300 },
      textMessage: { text },
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Evolution API error ${res.status}: ${detail}`)
  }
}
