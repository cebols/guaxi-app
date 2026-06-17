// Protótipo: cards de "frete por dia" com custo marginal real da Lalamove
// + escolha de veículo por fragilidade do carrinho/dia.
//
//   node scripts/lalamove-frete-dias.mjs
//
// Simula um cliente novo escolhendo entre os dias da janela de entrega.
// Cada dia já tem pedidos reservados (com suas fragilidades). Mostra quanto
// SAIRIA o frete pra esse cliente em cada dia — quanto mais cheio o dia
// (e quanto mais perto a rota já passa), mais barato pra ele.
//
// Modelo de preço (prova anti-prejuízo no README do PR):
//   preço_cliente = max(PISO, [ cota(dia + ele) − cota(dia) ] + MARGEM)
// Somando os marginais de todos que entram no dia, telescopa no custo real
// da viagem => Σ cobrado = custo_Lalamove + N·MARGEM. Sempre cobre.

const PROXY  = process.env.LALAMOVE_PROXY || 'https://guaxi-app.vercel.app/api/lalamove-quote'
const MARGEM = Number(process.env.MARGEM ?? 5)   // folga R$ por pedido
const PISO   = Number(process.env.PISO ?? 10)    // frete mínimo cobrado

// fragilidade -> veículo
const VEICULO = { robusto: 'LALAGO', fragil: 'CAR' }

const LOJA = { nome: 'Loja', lat: -23.5614, lng: -46.6560 }

// Dias candidatos na janela, com pedidos JÁ reservados (frag de cada).
const DIAS = [
  { dia: 'Hoje (qua)',          pedidos: [] },
  { dia: 'Sex',                 pedidos: [
      { nome: 'Pinheiros',    lat: -23.5670, lng: -46.7020, frag: 'robusto' },
      { nome: 'Vila Mariana', lat: -23.5890, lng: -46.6340, frag: 'robusto' },
  ] },
  { dia: 'Sáb',                 pedidos: [
      { nome: 'Moema',  lat: -23.6010, lng: -46.6630, frag: 'fragil' },
      { nome: 'Lapa',   lat: -23.5280, lng: -46.7060, frag: 'robusto' },
      { nome: 'Santana',lat: -23.5020, lng: -46.6250, frag: 'robusto' },
  ] },
]

// Cliente novo
const CLIENTE = {
  nome: 'Novo cliente · Tatuapé',
  lat: -23.5400, lng: -46.5760,
  fragCarrinho: process.env.FRAG || 'robusto', // 'robusto' | 'fragil'
}

const brl = (n) => `R$ ${Number(n).toFixed(2).replace('.', ',')}`
const stop = (p) => ({ coordinates: { lat: String(p.lat), lng: String(p.lng) }, address: p.nome })

async function quote(serviceType, pts) {
  const r = await fetch(PROXY, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serviceType, language: 'pt_BR', stops: pts.map(stop) }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(j)}`)
  return Number(j.data?.priceBreakdown?.total)
}

function veiculoDoDia(pedidos, fragCarrinho) {
  const algumFragil = fragCarrinho === 'fragil' || pedidos.some(p => p.frag === 'fragil')
  return algumFragil ? VEICULO.fragil : VEICULO.robusto
}

async function main() {
  console.log(`\n=== Frete por dia — ${CLIENTE.nome} (carrinho: ${CLIENTE.fragCarrinho}) ===\n`)
  console.log('dia            pedidos  veículo   custo marginal   → preço cliente')

  for (const d of DIAS) {
    const veiculo = veiculoDoDia(d.pedidos, CLIENTE.fragCarrinho)

    // custo da viagem do dia SEM o cliente (0 se dia vazio)
    const base = d.pedidos.length === 0 ? 0 : await quote(veiculo, [LOJA, ...d.pedidos])
    // custo COM o cliente
    const comCliente = await quote(veiculo, [LOJA, ...d.pedidos, CLIENTE])

    const marginal = comCliente - base
    const preco = Math.max(PISO, marginal + MARGEM)

    console.log(
      `${d.dia.padEnd(14)} ${String(d.pedidos.length).padStart(5)}    ` +
      `${veiculo.padEnd(8)} ${brl(marginal).padStart(13)}    ${brl(preco).padStart(11)}`
    )
  }

  console.log(`\nMargem por pedido: ${brl(MARGEM)}   Piso: ${brl(PISO)}`)
  console.log('Dia mais cheio/rota mais densa => marginal menor => frete mais barato pro cliente.')
  console.log('Carrinho frágil força veículo CAR no dia (custo maior, repassado no marginal).\n')
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
