import crypto from 'crypto'

// Helper de cotação Lalamove (assina HMAC server-side). Reaproveitado por
// lalamove-quote.js (proxy) e frete-dias.js (preço marginal por dia).

const HOST   = process.env.LALAMOVE_HOST   || 'https://rest.lalamove.com'
const KEY    = process.env.LALAMOVE_API_KEY
const SECRET = process.env.LALAMOVE_API_SECRET
const MARKET = process.env.LALAMOVE_MARKET || 'BR'

export function lalamoveConfigured() {
  return Boolean(KEY && SECRET)
}

export function stopOf(lat, lng, address = 'Parada') {
  // Lalamove exige address não-vazio em toda parada (pattern '.+')
  return { coordinates: { lat: String(lat), lng: String(lng) }, address: address || 'Parada' }
}

// Retorna o total (number) de uma cotação multi-stop, ou lança erro.
export async function quoteTotal(stops, serviceType = 'CAR', language = 'pt_BR') {
  const path      = '/v3/quotations'
  const method    = 'POST'
  const timestamp = Date.now().toString()
  const body      = JSON.stringify({ data: { serviceType, language, stops } })

  const rawSignature = `${timestamp}\r\n${method}\r\n${path}\r\n\r\n${body}`
  const signature    = crypto.createHmac('sha256', SECRET).update(rawSignature).digest('hex')
  const token        = `${KEY}:${timestamp}:${signature}`

  const resp = await fetch(`${HOST}${path}`, {
    method,
    headers: {
      Authorization: `hmac ${token}`,
      Market: MARKET,
      'Content-Type': 'application/json',
    },
    body,
  })
  const text = await resp.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  if (!resp.ok) throw new Error(json?.errors?.[0]?.message || `Lalamove HTTP ${resp.status}`)
  return Number(json?.data?.priceBreakdown?.total)
}
