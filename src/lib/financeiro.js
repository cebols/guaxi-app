// ── Financeiro da Guaxí ──────────────────────────────────────────────────────
// Tudo a partir do que aconteceu de verdade: pedidos (sem cancelados e sem os que
// ainda esperam o Pix), vendas avulsas, custo de cada produto (ficha técnica) e
// os custos fixos de Configurações.
//
//   receita         = o que entrou de doce (sem o frete, que é repasse da Lalamove)
//   custo variável  = ingredientes (+ desperdício) + embalagem por pedido + taxa do iFood
//   contribuição    = receita − custo variável  → é o que paga os custos fixos
//   resultado       = contribuição − custos fixos do mês
//   ponto de equilíbrio (R$) = custos fixos ÷ margem de contribuição (%)

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const contaPedido = (e) => e.status !== 'Cancelado' && !(e.aguardaPixAte && e.pgto !== 'Pago' && e.status === 'Pendente')
const dataPedido = (e) => e.dataEntrega || e.createdAt || null

// Soma uma janela de datas [de, ate] (YYYY-MM-DD, inclusivo)
function somar({ encomendas, vendas, produtos, cfg, custoSacola }, de, ate) {
  const porId = new Map((produtos || []).map(p => [Number(p.id), p]))
  const porNome = new Map((produtos || []).map(p => [String(p.nome || '').trim().toLowerCase(), p]))
  const desperdicio = 1 + Math.max(0, Math.min(100, parseFloat(cfg.fatorDesperdicio) || 0)) / 100
  const taxaIfood = (parseFloat(cfg.taxaIfood) || 0) / 100
  const semCusto = new Set()
  const t = { receita: 0, cmv: 0, embalagem: 0, taxas: 0, pedidos: 0, unidades: 0 }
  const dentro = (d) => d && d >= de && d <= ate

  const custoDe = (item) => {
    const nome = String(item.produto || '').replace(/^↳\s*/, '').trim()
    const p = (item.produtoId != null && porId.get(Number(item.produtoId))) || porNome.get(nome.toLowerCase())
    if (p?.tipo === 'combo') return 0            // o combo conta pelas linhas "↳" de cada doce
    const c = Number(p?.custoTotal) || 0
    if (!c) semCusto.add(nome)
    return c * desperdicio
  }

  for (const e of encomendas || []) {
    if (!contaPedido(e) || !dentro(dataPedido(e))) continue
    const receita = Math.max(0, (Number(e.valor) || 0) - (Number(e.frete) || 0))
    t.receita += receita
    t.pedidos += 1
    t.embalagem += custoSacola || 0
    if (e.canal === 'iFood') t.taxas += receita * taxaIfood
    for (const it of e.itens || []) {
      const q = Number(it.quantidade) || 0
      t.cmv += custoDe(it) * q
      if (!String(it.produto || '').startsWith('↳')) t.unidades += q
    }
  }
  for (const v of vendas || []) {
    if (!dentro(v.data)) continue
    const q = Number(v.quantidade) || 0
    const receita = q * (Number(v.precoUnit) || 0)
    t.receita += receita
    t.unidades += q
    const cu = Number(v.custoUnit) || 0
    t.cmv += cu > 0 ? cu * q : custoDe({ produto: v.produtoNome, produtoId: v.produtoId }) * q
    if (v.plataforma === 'iFood') t.taxas += receita * taxaIfood
  }
  t.variavel = t.cmv + t.embalagem + t.taxas
  t.contribuicao = t.receita - t.variavel
  t.mc = t.receita > 0 ? t.contribuicao / t.receita : null
  t.ticket = t.pedidos > 0 ? t.receita / t.pedidos : null
  t.semCusto = [...semCusto].filter(Boolean)
  return t
}

export function resumoFinanceiro({ encomendas, vendas, produtos, cfg, custoSacola = 0, hoje = new Date(), metaLucro = 0 }) {
  const base = { encomendas, vendas, produtos, cfg, custoSacola }
  const fixos = Number(cfg.custoFixoMensal) || 0
  const ano = hoje.getFullYear(), m = hoje.getMonth()
  const diasNoMes = new Date(ano, m + 1, 0).getDate()
  const dia = hoje.getDate()
  const diasRestantes = diasNoMes - dia + 1   // contando hoje
  const iniMes = ymd(new Date(ano, m, 1)), fimMes = ymd(new Date(ano, m, diasNoMes)), hojeS = ymd(hoje)

  const mes = somar(base, iniMes, fimMes)              // o mês inteiro (inclui pedidos marcados pra frente)
  const ateHoje = somar(base, iniMes, hojeS)           // o que já foi entregue/vendido até hoje
  const ult30 = somar(base, ymd(new Date(ano, m, dia - 29)), hojeS)
  const ult90 = somar(base, ymd(new Date(ano, m, dia - 89)), hojeS)

  // Margem e ticket de referência: o mês, se já tem venda suficiente; senão os últimos 90 dias
  const ref = mes.receita >= 300 || !ult90.receita ? mes : ult90
  const mc = ref.mc != null && ref.mc > 0 ? ref.mc : (ult90.mc > 0 ? ult90.mc : null)
  const ticket = ref.ticket || ult90.ticket || null

  const pe = mc ? fixos / mc : null                    // vendas (R$) pra empatar no mês
  const cobertura = fixos > 0 ? Math.max(0, mes.contribuicao) / fixos : null
  const falta = pe != null ? Math.max(0, pe - mes.receita) : null
  const metaReceita = mc ? (fixos + (Number(metaLucro) || 0)) / mc : null
  const faltaMeta = metaReceita != null ? Math.max(0, metaReceita - mes.receita) : null

  // Projeção: ritmo de venda por dia até hoje (contando o que já está marcado pro mês)
  const ritmo = dia > 0 ? ateHoje.receita / dia : 0
  const projReceita = Math.max(mes.receita, ritmo * diasNoMes)
  const projResultado = mc != null ? projReceita * mc - fixos : null

  // Últimos meses (mês fechado: receita e resultado com os custos fixos de hoje)
  const meses = []
  for (let k = 2; k >= 0; k--) {
    const ini = new Date(ano, m - k, 1), fim = new Date(ano, m - k + 1, 0)
    const s = k === 0 ? mes : somar(base, ymd(ini), ymd(fim))
    meses.push({ nome: MESES[ini.getMonth()], atual: k === 0, receita: s.receita, pedidos: s.pedidos, resultado: s.contribuicao - fixos })
  }

  return {
    nomeMes: MESES[m], dia, diasNoMes, diasRestantes,
    fixos, mes, ult30, mc, ticket, pe, cobertura, falta,
    pedidosFaltam: falta != null && ticket ? Math.ceil(falta / ticket) : null,
    porDia: falta != null ? falta / diasRestantes : null,
    metaReceita, faltaMeta,
    pedidosMeta: faltaMeta != null && ticket ? Math.ceil(faltaMeta / ticket) : null,
    projReceita, projResultado, meses,
    unidades30d: ult30.unidades,
    semCusto: [...new Set([...mes.semCusto, ...ult30.semCusto])],
  }
}
