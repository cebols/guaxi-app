// Teste real da API Lalamove (via proxy deployado) + lógica de precificação anti-prejuízo.
//
//   node scripts/lalamove-test.mjs
//
// Default usa o proxy em produção (já assina HMAC server-side). Para apontar
// para outro host:  LALAMOVE_PROXY=http://localhost:3000/api/lalamove-quote node scripts/...
//
// O que ele faz:
//  1. Cota UMA viagem multi-stop (loja -> N clientes) num carro.
//  2. Cota cada cliente SOZINHO (solo) no mesmo carro.
//  3. Aplica os freteTiers (o que você cobra do cliente) por distância.
//  4. Prova as duas garantias de "nunca sair no prejuízo":
//       A) agrupado <= soma dos solos     (agrupar sempre vale a pena)
//       B) soma do frete cobrado >= agrupado   (a viagem se paga)
//  5. Sugere freteTiers calibrados a partir das cotações solo reais + margem.

const PROXY = process.env.LALAMOVE_PROXY || 'https://guaxi-app.vercel.app/api/lalamove-quote'
const SERVICE = process.env.LALAMOVE_SERVICE || 'CAR' // CAR | HATCHBACK | LALAGO ...
const MARGEM = Number(process.env.MARGEM ?? 4)        // R$ de folga por faixa ao calibrar

// ---- Loja (origem) ------------------------------------------------------
const LOJA = { nome: 'Loja (Av. Paulista)', lat: -23.5614, lng: -46.6560 }

// ---- Clientes (paradas de entrega) — espalhados por SP, distâncias variadas
const CLIENTES = [
  { nome: 'Cliente A · Bela Vista',     lat: -23.5587, lng: -46.6450 },
  { nome: 'Cliente B · Pinheiros',      lat: -23.5670, lng: -46.7020 },
  { nome: 'Cliente C · Vila Mariana',   lat: -23.5890, lng: -46.6340 },
  { nome: 'Cliente D · Moema',          lat: -23.6010, lng: -46.6630 },
  { nome: 'Cliente E · Lapa',           lat: -23.5280, lng: -46.7060 },
  { nome: 'Cliente F · Santana',        lat: -23.5020, lng: -46.6250 },
  { nome: 'Cliente G · Tatuapé',        lat: -23.5400, lng: -46.5760 },
  { nome: 'Cliente H · Santo Amaro',    lat: -23.6520, lng: -46.7080 },
]
// Usa entre 3 e 10 (clamp)
const N = Math.min(10, Math.max(3, Number(process.env.N ?? 6)))
const ENTREGAS = CLIENTES.slice(0, N)

// ---- Faixas de frete cobradas hoje do cliente (exemplo) -----------------
// distância (km, com fator de rota 1.35) -> valor cobrado
const FRETE_TIERS = [
  { ate: 3,  valor: 12 },
  { ate: 6,  valor: 18 },
  { ate: 10, valor: 26 },
  { ate: 15, valor: 34 },
  { ate: 999, valor: 45 },
]
const ROUTE_FACTOR = 1.35

// ---- helpers ------------------------------------------------------------
const brl = (n) => `R$ ${Number(n).toFixed(2).replace('.', ',')}`

function haversineKm(a, b) {
  const R = 6371
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

function applyFreteTiers(distKm, tiers) {
  const sorted = [...tiers].sort((a, b) => a.ate - b.ate)
  for (const t of sorted) if (distKm <= t.ate) return t.valor
  return sorted[sorted.length - 1].valor
}

function stop(p) {
  return { coordinates: { lat: String(p.lat), lng: String(p.lng) }, address: p.nome }
}

async function quote(stops) {
  const r = await fetch(PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serviceType: SERVICE, language: 'pt_BR', stops: stops.map(stop) }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(j)}`)
  const pb = j.data?.priceBreakdown
  return { total: Number(pb?.total), currency: pb?.currency, distM: Number(j.data?.distance?.value) }
}

// ---- run ----------------------------------------------------------------
async function main() {
  console.log(`\n=== Teste Lalamove (${SERVICE}) — ${ENTREGAS.length} paradas ===\n`)

  // 1) viagem agrupada: loja -> todos os clientes
  const grouped = await quote([LOJA, ...ENTREGAS])
  console.log(`Viagem AGRUPADA (1 frete, ${ENTREGAS.length} paradas):`)
  console.log(`  custo Lalamove: ${brl(grouped.total)}   rota: ${(grouped.distM / 1000).toFixed(1)} km\n`)

  // 2) cotações solo + frete cobrado por cliente
  let somaSolo = 0
  let somaCobrado = 0
  const calib = {} // por faixa: maior custo solo observado
  console.log('Por cliente:')
  console.log('  cliente                        km    solo Lalamove   frete cobrado')
  for (const c of ENTREGAS) {
    const distKm = haversineKm(LOJA, c) * ROUTE_FACTOR
    const solo = await quote([LOJA, c])
    const cobrado = applyFreteTiers(distKm, FRETE_TIERS)
    somaSolo += solo.total
    somaCobrado += cobrado
    // calibração: qual a faixa desse cliente
    const faixa = [...FRETE_TIERS].sort((a, b) => a.ate - b.ate).find(t => distKm <= t.ate)
    calib[faixa.ate] = Math.max(calib[faixa.ate] || 0, solo.total)
    console.log(
      `  ${c.nome.padEnd(28)} ${distKm.toFixed(1).padStart(5)}   ` +
      `${brl(solo.total).padStart(11)}   ${brl(cobrado).padStart(11)}`
    )
  }

  // 3) garantias
  const margemAgrupar = somaSolo - grouped.total      // A
  const lucroFrete = somaCobrado - grouped.total       // B
  console.log('\n--- Garantias ---')
  console.log(`Soma dos solos:        ${brl(somaSolo)}`)
  console.log(`Viagem agrupada:       ${brl(grouped.total)}`)
  console.log(`(A) Economia agrupando: ${brl(margemAgrupar)}  ${margemAgrupar >= 0 ? '✅ agrupar compensa' : '❌'}`)
  console.log(`\nFrete cobrado (Σ):     ${brl(somaCobrado)}`)
  console.log(`Custo agrupado:        ${brl(grouped.total)}`)
  console.log(`(B) LUCRO no frete:     ${brl(lucroFrete)}  ${lucroFrete >= 0 ? '✅ não sai no prejuízo' : '❌ PREJUÍZO'}`)

  // 4) faixas calibradas a partir das cotações solo reais (+ margem)
  console.log(`\n--- Faixas sugeridas (solo real + margem ${brl(MARGEM)}) ---`)
  console.log('Cobrar >= isto em cada faixa garante que UM pedido sozinho já se paga;')
  console.log('como agrupar só barateia (garantia A), o lucro só cresce ao agrupar.\n')
  for (const t of [...FRETE_TIERS].sort((a, b) => a.ate - b.ate)) {
    const custoMax = calib[t.ate]
    if (custoMax == null) continue
    const sugerido = Math.ceil(custoMax + MARGEM)
    const flag = t.valor >= custoMax ? '✅' : '⚠️ cobra abaixo do custo solo'
    console.log(`  até ${String(t.ate).padStart(3)} km:  hoje ${brl(t.valor).padStart(9)}   ` +
      `solo máx ${brl(custoMax).padStart(9)}   sugerido ${brl(sugerido).padStart(9)}  ${flag}`)
  }
  console.log('')
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
