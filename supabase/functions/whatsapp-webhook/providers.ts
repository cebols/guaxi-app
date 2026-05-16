// WhatsApp provider — Meta Cloud API (graph.facebook.com)

export interface IncomingMessage {
  from: string       // número com DDI, ex: 5511999999999
  body: string
  msgId: string
  pushName?: string
}

export function parseMetaWebhook(payload: unknown): IncomingMessage | null {
  try {
    const p = payload as Record<string, unknown>
    if (p.object !== 'whatsapp_business_account') return null

    const entry   = (p.entry as unknown[])?.[0] as Record<string, unknown>
    const changes = (entry?.changes as unknown[])?.[0] as Record<string, unknown>
    const value   = changes?.value as Record<string, unknown>
    const messages = value?.messages as unknown[]

    if (!messages?.length) return null

    const msg = messages[0] as Record<string, unknown>

    // Só processa mensagens de texto
    if (msg.type !== 'text') return null

    const text = (msg.text as Record<string, unknown>)?.body as string
    if (!text?.trim()) return null

    const contacts = value?.contacts as unknown[]
    const contact  = (contacts?.[0] as Record<string, unknown>)
    const pushName = (contact?.profile as Record<string, unknown>)?.name as string | undefined

    return {
      from:     String(msg.from),
      body:     text.trim(),
      msgId:    String(msg.id),
      pushName,
    }
  } catch {
    return null
  }
}

export async function sendMetaMessage(
  phone: string,
  text: string,
  opts: { phoneNumberId: string; accessToken: string }
) {
  const url = `https://graph.facebook.com/v19.0/${opts.phoneNumberId}/messages`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: text },
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Meta API error ${res.status}: ${detail}`)
  }
}
