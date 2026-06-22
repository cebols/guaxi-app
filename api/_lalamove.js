import crypto from 'crypto'

// Helper Lalamove (assina HMAC server-side). Suporta produção e sandbox.
// - Cotação pública (frete-dias) usa PRODUÇÃO (preços reais).
// - Despacho (criar order) usa SANDBOX até virarmos a chave (não chama motorista real).
//
// Env vars:
//   Produção: LALAMOVE_API_KEY, LALAMOVE_API_SECRET, LALAMOVE_HOST (opc), LALAMOVE_MARKET (opc)
//   Sandbox : LALAMOVE_SANDBOX_KEY, LALAMOVE_SANDBOX_SECRET

const MARKET = process.env.LALAMOVE_MARKET || 'BR'

const PROD = {
  host:   process.env.LALAMOVE_HOST || 'https://rest.lalamove.com',
  key:    process.env.LALAMOVE_API_KEY,
  secret: process.env.LALAMOVE_API_SECRET,
}
const SANDBOX = {
  host:   'https://rest.sandbox.lalamove.com',
  key:    process.env.LALAMOVE_SANDBOX_KEY,
  secret: process.env.LALAMOVE_SANDBOX_SECRET,
}

const creds = (sandbox) => (sandbox ? SANDBOX : PROD)

export function lalamoveConfigured(sandbox = false) {
  const c = creds(sandbox)
  return Boolean(c.key && c.secret)
}

export function stopOf(lat, lng, address = 'Parada') {
  // Lalamove exige address não-vazio em toda parada (pattern '.+')
  return { coordinates: { lat: String(lat), lng: String(lng) }, address: address || 'Parada' }
}

// Telefone BR no formato E.164 (+55DDDNUMERO)
export function brPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '')
  if (!d) return ''
  if (d.startsWith('55')) return `+${d}`
  return `+55${d}`
}

// Chamada genérica assinada. Retorna { status, ok, json }.
export async function lalamove(method, path, bodyObj, { sandbox = false } = {}) {
  const c = creds(sandbox)
  const timestamp = Date.now().toString()
  const body = bodyObj ? JSON.stringify(bodyObj) : ''
  const rawSignature = `${timestamp}\r\n${method}\r\n${path}\r\n\r\n${body}`
  const signature    = crypto.createHmac('sha256', c.secret).update(rawSignature).digest('hex')
  const token        = `${c.key}:${timestamp}:${signature}`

  const resp = await fetch(`${c.host}${path}`, {
    method,
    headers: {
      Authorization: `hmac ${token}`,
      Market: MARKET,
      'Content-Type': 'application/json',
    },
    body: body || undefined,
  })
  const text = await resp.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  return { status: resp.status, ok: resp.ok, json }
}

// Atalho: total de uma cotação multi-stop (ou lança). Usado pelo frete-dias (prod).
export async function quoteTotal(stops, serviceType = 'CAR', language = 'pt_BR', opts = {}) {
  const { ok, status, json } = await lalamove('POST', '/v3/quotations', { data: { serviceType, language, stops } }, opts)
  if (!ok) throw new Error(json?.errors?.[0]?.message || `Lalamove HTTP ${status}`)
  return Number(json?.data?.priceBreakdown?.total)
}
