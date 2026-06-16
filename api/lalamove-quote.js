import crypto from 'crypto'

// Lalamove quotation proxy — keeps API key/secret server-side.
// Env vars (Vercel): LALAMOVE_API_KEY, LALAMOVE_API_SECRET, LALAMOVE_MARKET, LALAMOVE_HOST (optional)

const HOST   = process.env.LALAMOVE_HOST   || 'https://rest.lalamove.com'
const KEY    = process.env.LALAMOVE_API_KEY
const SECRET = process.env.LALAMOVE_API_SECRET
const MARKET = process.env.LALAMOVE_MARKET || 'BR'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!KEY || !SECRET) {
    res.status(500).json({ error: 'Missing LALAMOVE_API_KEY / LALAMOVE_API_SECRET' })
    return
  }

  try {
    const { stops, serviceType = 'MOTORCYCLE', language = 'pt_BR' } = req.body || {}
    if (!Array.isArray(stops) || stops.length < 2) {
      res.status(400).json({ error: 'stops must have at least origin and destination' })
      return
    }

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
    res.status(resp.status).json(json)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
