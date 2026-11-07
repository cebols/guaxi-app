// ── Financeiro da Guaxí ──────────────────────────────────────────────────────
// Tudo a partir do que aconteceu de verdade: pedidos (sem cancelados e sem os que
// ainda esperam o Pix), vendas avulsas antigas, custo de cada produto (ficha
// técnica) e os custos fixos de Configurações. Vendas e Configurações › Financeiro
// usam as mesmas transações daqui, então os números batem nas duas telas.
//
//   receita         = o que entrou de doce (sem o frete, que é repasse da Lalamove)
//   custo variável  = ingredientes (+ desperdício) + embalagem por pedido + taxa do iFood
//   contribuição    = receita − custo variável  → é o que paga os custos fixos
//   resultado       = contribuição − custos fixos do mês
//   ponto de equilíbrio (R$) = custos fixos ÷ margem de contribuição (%)

export const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const contaPedido = (e) => e.status !== 'Cancelado' && !(e.aguardaPixAte && e.pgto !== 'Pago' && e.status === 'Pendente')
const dataPedido = (e) => e.dataEntrega || e.createdAt || null

// Canal de cada venda, do jeito que a dona fala
export function canalDe(e) {
  if (e.canal === 'FormExterno') return 'Cardápio'
  if (['WhatsApp', 'Instagram', 'iFood', 'Presencial'].includes(e.canal)) return e.canal
  return 'Outros'
}

// Cada venda (pedido ou venda avulsa antiga) já com receita e custo variável
export function criarTransacoes({ encomendas, vendas, produtos, cfg, custoSacola = 0 }) {
  const porId = new Map((produtos || []).map(p => [Number(p.id), p]))
  const porNome = new Map((produtos || []).map(p => [String(p.nome || '').trim().toLowerCase(), p]))
  const desperdicio = 1 + Math.max(0, Math.min(100, parseFloat(cfg?.fatorDesperdicio) || 0)) / 100
  const taxaIfood = (parseFloat(cfg?.taxaIfood) || 0) / 100

  const produtoDe = (nome, produtoId) => (produtoId != null && porId.get(Number(produtoId))) || porNome.get(String(nome || '').trim().toLowerCase()) || null
  const custoDe = (nome, produtoId, semCusto) => {
    const p = produtoDe(nome, produtoId)
    if (p?.tipo === 'combo') return 0            // o combo conta pelas linhas "↳" de cada doce
    const c = Number(p?.custoTotal) || 0
    if (!c && nome) semCusto.push(nome)
    return c * desperdicio
  }

  const out = []
  for (const e of encomendas || []) {
    if (!contaPedido(e)) continue
    const data = dataPedido(e)
    if (!data) continue
    const receita = Math.max(0, (Number(e.valor) || 0) - (Number(e.frete) || 0))
    const semCusto = []
    const itens = (e.itens || []).map(it => {
      const sub = String(it.produto || '').startsWith('↳')
      const nome = String(it.produto || '').replace(/^↳\s*/, '').trim()
      const qtd = Number(it.quantidade) || 0
      const combo = !sub && produtoDe(nome, it.produtoId)?.tipo === 'combo'
      const preco = Number(it.precoUnit) || 0
      return { nome, produtoId: it.produtoId ?? produtoDe(nome)?.id ?? null, qtd, preco, sub, combo, receitaItem: sub ? 0 : preco * qtd, custo: custoDe(nome, it.produtoId, semCusto) * qtd }
    })
    // Combo: o valor fica na linha do combo e os doces ("↳") vêm a R$ 0 — divide o
    // valor do combo entre os doces dele, pra margem por produto sair certa
    itens.forEach((it, k) => {
      if (!it.combo) return
      const subs = []
      for (let j = k + 1; j < itens.length && itens[j].sub; j++) subs.push(itens[j])
      const q = subs.reduce((s, x) => s + x.qtd, 0)
      if (q > 0) { subs.forEach(s => { s.receitaItem = it.receitaItem * s.qtd / q }); it.receitaItem = 0 }
    })
    const canal = canalDe(e)
    out.push({
      id: e.id, tipo: 'pedido', data, canal, cliente: e.cliente || '', contato: e.contato || '',
      receita, frete: Number(e.frete) || 0, valor: Number(e.valor) || 0,
      cmv: itens.reduce((s, i) => s + i.custo, 0), embalagem: custoSacola || 0, taxas: canal === 'iFood' ? receita * taxaIfood : 0,
      pago: e.pgto === 'Pago', pixPago: !!e.pixPagoEm, status: e.status, periodo: e.periodo || null,
      itens, semCusto,
    })
  }
  for (const v of vendas || []) {
    if (!v.data) continue
    const qtd = Number(v.quantidade) || 0
    const receita = qtd * (Number(v.precoUnit) || 0)
    const semCusto = []
    const cu = Number(v.custoUnit) || 0
    const custo = (cu > 0 ? cu : custoDe(v.produtoNome, v.produtoId, semCusto)) * qtd
    const ifood = v.plataforma === 'iFood'
    out.push({
      id: `avulsa-${v.id}`, vendaId: v.id, tipo: 'avulsa', data: v.data, canal: ifood ? 'iFood' : 'Presencial', cliente: 'Venda de balcão', contato: '',
      receita, frete: 0, valor: receita, cmv: custo, embalagem: 0, taxas: ifood ? receita * taxaIfood : 0,
      pago: true, pixPago: false, status: 'Entregue', periodo: null,
      itens: [{ nome: v.produtoNome, produtoId: v.produtoId ?? null, qtd, preco: Number(v.precoUnit) || 0, sub: false, combo: false, receitaItem: receita, custo }], semCusto,
    })
  }
  return out
}

// Soma uma janela de datas [de, ate] (YYYY-MM-DD, inclusivo)
export function somarTransacoes(trans, de, ate) {
  const t = { receita: 0, cmv: 0, embalagem: 0, taxas: 0, pedidos: 0, unidades: 0 }
  const semCusto = new Set()
  for (const x of trans) {
    if (x.data < de || x.data > ate) continue
    t.receita += x.receita
    t.cmv += x.cmv
    t.embalagem += x.embalagem
    t.taxas += x.taxas
    if (x.tipo === 'pedido') t.pedidos += 1
    for (const i of x.itens) if (!i.sub) t.unidades += i.qtd
    for (const n of x.semCusto) semCusto.add(n)
  }
  t.variavel = t.cmv + t.embalagem + t.taxas
  t.contribuicao = t.receita - t.variavel
  t.mc = t.receita > 0 ? t.contribuicao / t.receita : null
  t.ticket = t.pedidos > 0 ? t.receita / t.pedidos : null
  t.semCusto = [...semCusto].filter(Boolean)
  return t
}

export function resumoFinanceiro({ encomendas, vendas, produtos, cfg, custoSacola = 0, hoje = new Date(), metaLucro = 0, transacoes }) {
  const trans = transacoes || criarTransacoes({ encomendas, vendas, produtos, cfg, custoSacola })
  const somar = (de, ate) => somarTransacoes(trans, de, ate)
  const fixos = Number(cfg.custoFixoMensal) || 0
  const ano = hoje.getFullYear(), m = hoje.getMonth()
  const diasNoMes = new Date(ano, m + 1, 0).getDate()
  const dia = hoje.getDate()
  const diasRestantes = diasNoMes - dia + 1   // contando hoje
  const iniMes = ymd(new Date(ano, m, 1)), fimMes = ymd(new Date(ano, m, diasNoMes)), hojeS = ymd(hoje)

  const mes = somar(iniMes, fimMes)              // o mês inteiro (inclui pedidos marcados pra frente)
  const ateHoje = somar(iniMes, hojeS)           // o que já foi entregue/vendido até hoje
  const ult30 = somar(ymd(new Date(ano, m, dia - 29)), hojeS)
  const ult90 = somar(ymd(new Date(ano, m, dia - 89)), hojeS)

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
    const s = k === 0 ? mes : somar(ymd(ini), ymd(fim))
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
