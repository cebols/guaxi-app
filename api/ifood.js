// Vercel serverless function — lê o cardápio de uma loja do iFood.
// O navegador não pode chamar o iFood direto (CORS); este proxy roda no servidor.

const UUID_RX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

const BROWSER_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'cache-control': 'no-cache',
  origin: 'https://www.ifood.com.br',
  referer: 'https://www.ifood.com.br/',
}

export function ifoodImage(logoUrl) {
  if (!logoUrl || typeof logoUrl !== 'string') return null
  if (/^https?:\/\//.test(logoUrl)) return logoUrl
  const base = 'https://static-images.ifood.com.br/image/upload/t_high'
  return logoUrl.includes('/') ? `${base}/${logoUrl}` : `${base}/pratos/${logoUrl}`
}

// Caminha recursivamente em qualquer JSON do iFood e coleta itens de cardápio.
export function extractItems(node, category, out, seen) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const el of node) extractItems(el, category, out, seen)
    return
  }

  const nome = node.description || node.name || node.title
  let preco = null
  if (typeof node.unitPrice === 'number') {
    preco =
      node.unitPrice > 0
        ? node.unitPrice
        : typeof node.unitMinPrice === 'number' && node.unitMinPrice > 0
        ? node.unitMinPrice
        : 0
  } else if (typeof node.unitMinPrice === 'number') {
    preco = node.unitMinPrice
  } else if (typeof node.price === 'number' && node.logoUrl) {
    preco = node.price
  }

  const isItem = typeof nome === 'string' && nome.trim().length > 1 && preco != null
  if (isItem) {
    const key = nome.trim().toLowerCase() + '|' + preco
    if (!seen.has(key)) {
      seen.add(key)
      out.push({
        nome: nome.trim(),
        descricao: typeof node.details === 'string' ? node.details.trim() : '',
        preco,
        categoria: category || '',
        imagemUrl: ifoodImage(node.logoUrl || node.imageUrl || node.image),
      })
    }
    return
  }

  let cat = category
  const childArr = node.itens || node.items
  if (Array.isArray(childArr) && typeof node.name === 'string' && node.name.length > 1) {
    cat = node.name
  }
  for (const k of Object.keys(node)) extractItems(node[k], cat, out, seen)
}

function findMerchantName(json) {
  return (
    json?.data?.merchant?.name ||
    json?.merchant?.name ||
    json?.data?.name ||
    json?.name ||
    ''
  )
}

async function tryFetch(url) {
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS })
    if (!res.ok) return { ok: false, status: res.status }
    const json = await res.json()
    return { ok: true, json }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const input = (req.query.url || req.query.id || '').toString()
  const match = input.match(UUID_RX)
  if (!match) {
    return res
      .status(400)
      .json({ error: 'Link do iFood inválido. Cole o endereço completo da loja.' })
  }
  const id = match[0]

  const attempts = [
    `https://marketplace.ifood.com.br/v1/merchants/${id}/catalog`,
    `https://marketplace.ifood.com.br/v1/merchants/${id}/catalog?latitude=-23.55&longitude=-46.63`,
    `https://wsloja.ifood.com.br/ifood-ws-v3/restaurants/${id}/menu`,
  ]

  let lastStatus = null
  let lastError = null

  for (const url of attempts) {
    const r = await tryFetch(url)
    if (r.ok && r.json) {
      const items = []
      extractItems(r.json, '', items, new Set())
      if (items.length > 0) {
        return res.status(200).json({
          merchant: findMerchantName(r.json),
          total: items.length,
          items,
        })
      }
    }
    if (r.status) lastStatus = r.status
    if (r.error) lastError = r.error
  }

  return res.status(502).json({
    error:
      lastStatus === 403 || lastStatus === 401
        ? 'O iFood bloqueou a leitura automática desta loja (proteção anti-bot).'
        : 'Não foi possível ler o cardápio. Confira o link e tente novamente.',
    detail: lastStatus || lastError || null,
  })
}
