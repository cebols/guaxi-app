import crypto from 'crypto'

// Teste ponta-a-ponta no SANDBOX da Lalamove: cotação → despacha pedido →
// status/tracking → motorista. Sem custo, sem app.
//
//   LALAMOVE_KEY=pk_test_... LALAMOVE_SECRET=sk_test_... node scripts/lalamove-sandbox-dispatch.mjs
//
// Mostra exatamente o que a API devolve pra a gente desenhar a queue/kanban:
// orderId, status, shareLink (mapa de tracking) e dados do motorista.

const HOST   = process.env.LALAMOVE_HOST   || 'https://rest.sandbox.lalamove.com'
const KEY    = process.env.LALAMOVE_KEY    || process.env.LALAMOVE_API_KEY
const SECRET = process.env.LALAMOVE_SECRET || process.env.LALAMOVE_API_SECRET
const MARKET = process.env.LALAMOVE_MARKET || 'BR'
const SERVICE = process.env.LALAMOVE_SERVICE || 'CAR'

if (!KEY || !SECRET) { console.error('Faltam LALAMOVE_KEY / LALAMOVE_SECRET'); process.exit(1) }

async function call(method, path, bodyObj) {
  const timestamp = Date.now().toString()
  const body = bodyObj ? JSON.stringify(bodyObj) : ''
  const raw = `${timestamp}\r\n${method}\r\n${path}\r\n\r\n${body}`
  const signature = crypto.createHmac('sha256', SECRET).update(raw).digest('hex')
  const token = `${KEY}:${timestamp}:${signature}`
  const resp = await fetch(`${HOST}${path}`, {
    method,
    headers: {
      Authorization: `hmac ${token}`,
      Market: MARKET,
      'Content-Type': 'application/json',
    },
    body: body || undefined,
  })
  const text = await resp.text()
  let json; try { json = JSON.parse(text) } catch { json = { raw: text } }
  return { status: resp.status, json }
}

// Loja (remetente) + 1 cliente (destinatário) — Rio
const LOJA    = { lat: '-22.9997', lng: '-43.3659', addr: 'Loja Guaxi - Rio de Janeiro' }
const CLIENTE = { lat: '-22.9710', lng: '-43.1860', addr: 'Cliente - Copacabana, Rio de Janeiro' }

const log = (label, o) => console.log(`\n### ${label}\n` + JSON.stringify(o, null, 2))

async function main() {
  console.log(`HOST=${HOST}  MARKET=${MARKET}  SERVICE=${SERVICE}`)

  // 1) Cotação
  const quote = await call('POST', '/v3/quotations', {
    data: {
      serviceType: SERVICE,
      language: 'pt_BR',
      stops: [
        { coordinates: { lat: LOJA.lat,    lng: LOJA.lng },    address: LOJA.addr },
        { coordinates: { lat: CLIENTE.lat, lng: CLIENTE.lng }, address: CLIENTE.addr },
      ],
    },
  })
  log('1) QUOTATION', quote.json)
  if (quote.status >= 300) { console.error('quotation falhou'); return }

  const q = quote.json.data
  const quotationId = q.quotationId
  const [stop0, stop1] = q.stops

  // 2) Despacha o pedido
  const order = await call('POST', '/v3/orders', {
    data: {
      quotationId,
      sender:    { stopId: stop0.stopId, name: 'Guaxi Confeitaria', phone: '+5521999990000' },
      recipients: [
        { stopId: stop1.stopId, name: 'Cliente Teste', phone: '+5521999991111', remarks: 'Bolo - deixar na portaria' },
      ],
    },
  })
  log('2) ORDER (despacho)', order.json)
  if (order.status >= 300) { console.error('order falhou'); return }

  const orderId = order.json.data.orderId
  console.log(`\n>>> orderId=${orderId}  shareLink=${order.json.data.shareLink || '(ainda não)'}`)

  // 3) Status / tracking
  const get = await call('GET', `/v3/orders/${orderId}`)
  log('3) GET ORDER (status + shareLink)', get.json)

  // 4) Motorista (se já atribuído)
  const driverId = get.json.data?.driverId
  if (driverId) {
    const drv = await call('GET', `/v3/orders/${orderId}/drivers/${driverId}`)
    log('4) DRIVER (nome/telefone/placa/coords)', drv.json)
  } else {
    console.log('\n### 4) DRIVER\n(sem motorista atribuído ainda — status ASSIGNING_DRIVER)')
  }

  console.log('\n--- Resumo dos campos úteis pra UI ---')
  console.log('orderId   :', orderId)
  console.log('status    :', get.json.data?.status)
  console.log('shareLink :', get.json.data?.shareLink, '  ← manda no WhatsApp')
  console.log('price     :', get.json.data?.priceBreakdown?.total, get.json.data?.priceBreakdown?.currency)
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
