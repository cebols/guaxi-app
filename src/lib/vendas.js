// ── Análises de Vendas ───────────────────────────────────────────────────────
// Tudo em cima das transações de lib/financeiro (mesma conta do Financeiro).
import { ymd, somarTransacoes } from './financeiro.js'

// Cor fixa por canal (paleta validada pra daltonismo no fundo escuro). Nunca pela posição.
export const CANAIS = [
  { key: 'Cardápio', cor: '#3987e5' },
  { key: 'WhatsApp', cor: '#d95926' },
  { key: 'Instagram', cor: '#199e70' },
  { key: 'iFood', cor: '#c98500' },
  { key: 'Presencial', cor: '#d55181' },
  { key: 'Outros', cor: '#8c8c8c' },
]
export const corCanal = (c) => CANAIS.find(x => x.key === c)?.cor || '#8c8c8c'
export const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
export const DIAS_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const MESES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

const dt = (s) => new Date(s + 'T12:00:00')
const mais = (s, n) => { const d = dt(s); d.setDate(d.getDate() + n); return ymd(d) }
const entre = (a, b) => Math.round((dt(b) - dt(a)) / 864e5)
const listaDias = (de, ate) => { const out = []; for (let d = de; d <= ate; d = mais(d, 1)) out.push(d); return out }
export const diaCurto = (s) => { const d = dt(s); return `${DIAS_CURTO[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}` }

// ── Períodos ──
// de/ate: o período inteiro (mês inclui pedidos já marcados pra frente).
// Comparação justa: até hoje × o mesmo pedaço do período anterior.
export function janela(periodo, hojeD = new Date(), custom = {}) {
  const hoje = ymd(hojeD)
  if (periodo === 'hoje') {
    const masc = [0, 6].includes(hojeD.getDay())   // sábado e domingo: "passado"
    return { de: hoje, ate: hoje, ateComparar: hoje, ant: { de: mais(hoje, -7), ate: mais(hoje, -7) },
      nomeAnt: `${DIAS_SEMANA[hojeD.getDay()].toLowerCase()} ${masc ? 'passado' : 'passada'}`, curto: `${DIAS_CURTO[hojeD.getDay()]} ${masc ? 'passado' : 'passada'}`,
      grafico: listaDias(mais(hoje, -13), hoje), titulo: 'Hoje' }
  }
  if (periodo === 'semana') {
    const seg = mais(hoje, -((hojeD.getDay() + 6) % 7))
    const n = entre(seg, hoje)
    return { de: seg, ate: mais(seg, 6), ateComparar: hoje, ant: { de: mais(seg, -7), ate: mais(seg, n - 7) }, nomeAnt: `semana passada até ${DIAS_CURTO[hojeD.getDay()]}`, curto: 'sem. passada',
      grafico: listaDias(seg, mais(seg, 6)), titulo: 'Esta semana' }
  }
  if (periodo === 'custom' && custom.de && custom.ate && custom.de <= custom.ate) {
    const n = entre(custom.de, custom.ate)
    return { de: custom.de, ate: custom.ate, ateComparar: custom.ate, ant: { de: mais(custom.de, -(n + 1)), ate: mais(custom.de, -1) }, nomeAnt: `os ${n + 1} dias antes`, curto: 'antes',
      grafico: n <= 62 ? listaDias(custom.de, custom.ate) : null, titulo: `${diaCurto(custom.de)} a ${diaCurto(custom.ate)}` }
  }
  // mês
  const y = hojeD.getFullYear(), m = hojeD.getMonth()
  const ini = ymd(new Date(y, m, 1)), fim = ymd(new Date(y, m + 1, 0))
  const fimAnt = new Date(y, m, 0)
  const diaAnt = Math.min(hojeD.getDate(), fimAnt.getDate())
  return { de: ini, ate: fim, ateComparar: hoje, ant: { de: ymd(new Date(y, m - 1, 1)), ate: ymd(new Date(y, m - 1, diaAnt)) },
    nomeAnt: `${MESES_CURTO[(m + 11) % 12]} até dia ${diaAnt}`, curto: MESES_CURTO[(m + 11) % 12], grafico: listaDias(ini, fim), titulo: 'Este mês', mesAnt: { de: ymd(new Date(y, m - 1, 1)) } }
}

export const somar = somarTransacoes
export function variacao(atual, antes) {
  if (!antes) return atual > 0 ? null : 0
  return (atual - antes) / antes
}

// Vendas por dia, com o mesmo dia do período anterior de referência
export function porDia(trans, dias, deslocamento) {
  const mapa = {}
  for (const x of trans) { const m = (mapa[x.data] ||= { receita: 0, pedidos: 0 }); m.receita += x.receita; if (x.tipo === 'pedido') m.pedidos += 1 }
  return dias.map(d => ({ data: d, ...(mapa[d] || { receita: 0, pedidos: 0 }), ref: (mapa[deslocamento(d)] || { receita: 0 }).receita }))
}

export function porCanal(trans, de, ate) {
  const m = {}
  let total = 0
  for (const x of trans) {
    if (x.data < de || x.data > ate) continue
    const c = (m[x.canal] ||= { canal: x.canal, receita: 0, pedidos: 0 })
    c.receita += x.receita; c.pedidos += 1; total += x.receita
  }
  return CANAIS.map(k => m[k.key]).filter(Boolean)
    .map(c => ({ ...c, cor: corCanal(c.canal), pct: total > 0 ? c.receita / total : 0, ticket: c.pedidos ? c.receita / c.pedidos : 0 }))
    .sort((a, b) => b.receita - a.receita)
}

// Dia da semana × período de entrega (o que dá pra saber de horário)
export const LINHAS_MOMENTO = [
  { key: 'manha', nome: 'Manhã' }, { key: 'tarde', nome: 'Tarde' }, { key: 'noite', nome: 'Noite' }, { key: 'sem', nome: 'Sem período' },
]
export function momentos(trans, de, ate) {
  const cel = {}
  let total = 0
  for (const x of trans) {
    if (x.data < de || x.data > ate) continue
    const k = `${['manha', 'tarde', 'noite'].includes(x.periodo) ? x.periodo : 'sem'}|${dt(x.data).getDay()}`
    cel[k] = (cel[k] || 0) + x.receita
    total += x.receita
  }
  const max = Math.max(0, ...Object.values(cel))
  const linhas = LINHAS_MOMENTO.filter(l => l.key !== 'sem' || Object.keys(cel).some(k => k.startsWith('sem|')))
  // segunda primeiro (é como a semana da confeitaria começa)
  const ordem = [1, 2, 3, 4, 5, 6, 0]
  return {
    total, max, ordem,
    linhas: linhas.map(l => ({ ...l, celulas: ordem.map(d => { const v = cel[`${l.key}|${d}`] || 0; return { dia: d, v, pct: total ? v / total : 0, nivel: max ? Math.ceil((v / max) * 4) : 0 } }) })),
    melhor: Object.entries(cel).sort((a, b) => b[1] - a[1])[0] || null,
  }
}

// ── Clientes ──
const chaveCliente = (x) => {
  const d = String(x.contato || '').replace(/\D/g, '').slice(-8)
  if (d.length === 8) return `t${d}`
  const n = String(x.cliente || '').trim().toLowerCase()
  if (!n || /^venda (de )?balc|^pedido ifood|^cliente$/.test(n)) return null
  return `n${n}`
}
export function clientes(trans, hojeD = new Date()) {
  const hoje = ymd(hojeD)
  const m = {}
  for (const x of trans) {
    if (x.tipo !== 'pedido' || x.data > hoje) continue
    const k = chaveCliente(x)
    if (!k) continue
    const c = (m[k] ||= { chave: k, nome: x.cliente, contato: x.contato, pedidos: [], total: 0, produtos: {} })
    c.pedidos.push(x)
    c.total += x.receita
    if (x.contato) c.contato = x.contato
    for (const i of x.itens) if (!i.combo) c.produtos[i.nome] = (c.produtos[i.nome] || 0) + i.qtd
  }
  return Object.values(m).map(c => {
    const datas = [...new Set(c.pedidos.map(p => p.data))].sort()
    const gaps = datas.slice(1).map((d, i) => entre(datas[i], d))
    const ult = [...c.pedidos].sort((a, b) => b.data.localeCompare(a.data))[0]
    return {
      ...c, nome: ult.cliente || c.nome, primeiro: datas[0], ultimo: datas[datas.length - 1], vezes: datas.length,
      intervalo: gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : null,
      diasSem: entre(datas[datas.length - 1], hoje),
      favorito: Object.entries(c.produtos).sort((a, b) => b[1] - a[1])[0]?.[0] || '',
    }
  })
}
// Pediam com frequência e sumiram: 2+ pedidos, intervalo médio de até 35 dias e
// sem pedir há mais de 30 dias (e mais que o dobro do intervalo de costume)
export function sumidos(lista) {
  return lista.filter(c => c.vezes >= 2 && c.intervalo != null && c.intervalo <= 35 && c.diasSem > Math.max(30, c.intervalo * 2) && c.diasSem <= 180)
    .sort((a, b) => b.total - a.total)
}

// ── Produtos ──
export function produtosStats(trans, de, ate, antes, hojeD = new Date()) {
  const hoje = ymd(hojeD)
  const semanaIni = mais(hoje, -((hojeD.getDay() + 6) % 7))
  const ini8 = mais(semanaIni, -49)
  const m = {}
  const pega = (nome) => (m[nome] ||= { nome, un: 0, receita: 0, custo: 0, semCusto: false, antes: 0, semanas: Array(8).fill(0), ultimaVenda: null, produtoId: null })
  for (const x of trans) {
    for (const i of x.itens) {
      if (!i.nome || i.combo) continue   // combo conta pelos doces dele
      const p = pega(i.nome)
      if (i.produtoId) p.produtoId = i.produtoId
      if (x.data <= hoje && (!p.ultimaVenda || x.data > p.ultimaVenda)) p.ultimaVenda = x.data
      if (x.data >= de && x.data <= ate) {
        p.un += i.qtd
        p.receita += i.receitaItem   // doce de combo já vem com a parte dele do valor do combo
        p.custo += i.custo
        if (x.semCusto.includes(i.nome)) p.semCusto = true
      }
      if (antes && x.data >= antes.de && x.data <= antes.ate) p.antes += i.qtd
      if (x.data >= ini8 && x.data <= hoje) { const w = Math.floor(entre(ini8, x.data) / 7); if (w >= 0 && w < 8) p.semanas[w] += i.qtd }
    }
  }
  return Object.values(m).filter(p => p.un > 0 || p.antes > 0).map(p => ({
    ...p,
    margem: p.receita > 0 && !p.semCusto ? (p.receita - p.custo) / p.receita : null,
    lucro: p.receita - p.custo,
    delta: variacao(p.un, p.antes),
  }))
}
// Quadro popularidade × margem (o clássico de cardápio): vende muito = pelo menos 70%
// da média de unidades; margem alta = acima da meta de Configurações
export function matriz(stats, metaMargem) {
  const vendidos = stats.filter(p => p.un > 0 && p.margem != null)
  if (!vendidos.length) return null
  const media = vendidos.reduce((s, p) => s + p.un, 0) / vendidos.length
  const corte = media * 0.7
  const q = { estrelas: [], joias: [], populares: [], repensar: [] }
  for (const p of vendidos) {
    const pop = p.un >= corte, alta = p.margem >= metaMargem
    q[pop && alta ? 'estrelas' : !pop && alta ? 'joias' : pop ? 'populares' : 'repensar'].push(p)
  }
  for (const k of Object.keys(q)) q[k].sort((a, b) => b.un - a.un)
  return q
}

// ── Previsão de produção: próximos 7 dias ──
// "Costuma sair" = média do mesmo dia da semana nas últimas 4 semanas.
// "Já encomendado" = pedidos marcados (inclui os que esperam o Pix).
export function previsao(trans, encomendas, hojeD = new Date()) {
  const hoje = ymd(hojeD)
  const dias = listaDias(mais(hoje, 1), mais(hoje, 7))
  const hist = {}   // nome → dia da semana → [qtd por semana]
  const desde = mais(hoje, -28)
  for (const x of trans) {
    if (x.data < desde || x.data > hoje) continue
    const wd = dt(x.data).getDay()
    for (const i of x.itens) {
      if (!i.nome || i.combo) continue
      const h = (hist[i.nome] ||= { id: i.produtoId, wd: {} })
      if (i.produtoId) h.id = i.produtoId
      h.wd[wd] = (h.wd[wd] || 0) + i.qtd
    }
  }
  const enc = {}
  for (const e of encomendas || []) {
    if (e.status === 'Cancelado' || e.status === 'Entregue') continue
    const d = e.dataEntrega
    if (!d || d < dias[0] || d > dias[dias.length - 1]) continue
    for (const it of e.itens || []) {
      const nome = String(it.produto || '').replace(/^↳\s*/, '').trim()
      if (!nome) continue
      const p = (enc[nome] ||= { id: it.produtoId ?? null, total: 0, porDia: {} })
      p.total += Number(it.quantidade) || 0
      p.porDia[d] = (p.porDia[d] || 0) + (Number(it.quantidade) || 0)
    }
  }
  const nomes = new Set([...Object.keys(hist), ...Object.keys(enc)])
  const linhas = [...nomes].map(nome => {
    const h = hist[nome], e = enc[nome]
    const porDia = dias.map(d => {
      const costuma = h ? (h.wd[dt(d).getDay()] || 0) / 4 : 0
      const encomendado = e?.porDia[d] || 0
      return { data: d, costuma, encomendado }
    })
    const costuma = porDia.reduce((s, d) => s + d.costuma, 0)
    const encomendado = e?.total || 0
    // sugestão: o que já está encomendado + o que costuma sair de avulso por cima
    const sugestao = Math.ceil(porDia.reduce((s, d) => s + Math.max(d.encomendado, d.costuma), 0))
    return { nome, produtoId: h?.id ?? e?.id ?? null, costuma, encomendado, sugestao, porDia }
  }).filter(l => l.sugestao > 0).sort((a, b) => b.sugestao - a.sugestao)
  return { dias, linhas }
}

// ── Exportar ──
export function csvHistorico(trans) {
  const esc = (v) => { const s = String(v ?? ''); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const num = (v) => (Number(v) || 0).toFixed(2).replace('.', ',')
  const linhas = [['Data', 'Pedido', 'Cliente', 'Canal', 'Itens', 'Valor dos doces', 'Frete', 'Total', 'Pagamento'].join(';')]
  for (const x of [...trans].sort((a, b) => a.data.localeCompare(b.data))) {
    const itens = x.itens.filter(i => !i.sub).map(i => `${i.qtd}x ${i.nome}`).join(', ')
    linhas.push([x.data.split('-').reverse().join('/'), x.tipo === 'pedido' ? x.id : '', x.cliente, x.canal, itens, num(x.receita), num(x.frete), num(x.valor),
      x.pago ? (x.pixPago ? 'Pago (Pix automático)' : 'Pago') : 'A receber'].map(esc).join(';'))
  }
  return '﻿' + linhas.join('\n')   // BOM: o Excel abre com acento certo
}
