// ── Prontidão: em que etapa está cada produto do cardápio ────────────────────
// Lógica pura (sem Supabase) — usada pela página e pelo db.js.
//
// Cada produto escolhe um fluxo (sequência de etapas). As unidades ficam em
// "lotes" (produto, etapa, qtd, entrou_em). A última etapa é o ponto de
// engatilho: de onde o produto sai pro cliente.

export const LOCAL = {
  freezer:   { icon: '❄', cor: '#60a5fa', nome: 'freezer' },
  geladeira: { icon: '',  cor: '#2dd4bf', nome: 'geladeira' },
  ambiente:  { icon: '',  cor: '#f5b544', nome: 'ambiente' },
  pronto:    { icon: '',  cor: '#4ade80', nome: 'vitrine' },
}

export const FLUXOS = {
  degelo: {
    nome: 'Congelado → degelo',
    exemplo: 'barras, brownie, entremet, mousse, tartes',
    etapas: [
      { key: 'freezer', nome: 'Freezer', local: 'freezer' },
      { key: 'degelo',  nome: 'Degelo',  local: 'geladeira', tempoH: 4, validadeH: 72 },
    ],
    verbos: { 'freezer>degelo': 'Tirar pro degelo' },
  },
  direto: {
    nome: 'Sai do freezer',
    exemplo: 'bombons, cheesecake',
    etapas: [
      { key: 'freezer', nome: 'Freezer', local: 'freezer' },
    ],
    verbos: {},
  },
  assado: {
    nome: 'Cru → assado → degelo',
    exemplo: 'cookies',
    etapas: [
      { key: 'cru',    nome: 'Massa crua', local: 'freezer' },
      { key: 'assado', nome: 'Assado',     local: 'freezer' },
      { key: 'degelo', nome: 'Degelo',     local: 'ambiente', tempoH: 1, validadeH: 72 },
    ],
    verbos: { 'cru>assado': 'Assar', 'assado>degelo': 'Tirar pro degelo' },
  },
  choux: {
    nome: 'Casca → reassada → vitrine',
    exemplo: 'choux',
    etapas: [
      { key: 'cascas',    nome: 'Cascas',    local: 'freezer' },
      { key: 'reassadas', nome: 'Reassadas', local: 'ambiente', tempoH: 0.25, validadeH: 8 },
      { key: 'vitrine',   nome: 'Vitrine',   local: 'pronto',   tempoH: 0,    validadeH: 4 },
    ],
    verbos: { 'cascas>reassadas': 'Reassar', 'reassadas>vitrine': 'Rechear' },
  },
}

export const fluxoAtivo = (prod) => {
  const f = prod?.prontidao?.fluxo
  return f && FLUXOS[f] ? f : null
}

// Meta da etapa de engatilho: ~20% do que sai numa produção (≈ 1 dia de venda
// quando uma fornada dura ~1 semana), mínimo 2.
export function metaPadrao(prod) {
  const base = prod?.fornada || prod?.estoqueMin || 10
  return Math.max(2, Math.round(base * 0.2))
}

// Palpite de configuração pelo nome — você só confirma
export function sugerirConfig(prod) {
  const n = (prod?.nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const meta = metaPadrao(prod)
  if (/choux|chou\b/.test(n)) return { fluxo: 'choux', etapas: { reassadas: { meta: 6 }, vitrine: { meta: 3 } } }
  if (/cookie/.test(n))       return { fluxo: 'assado', etapas: { degelo: { meta } } }
  if (/cheesecake/.test(n))   return { fluxo: 'direto', noPedido: 'micro-ondas fraco 1 min + geleia' }
  if (/bombo|bombom/.test(n)) return { fluxo: 'direto', noPedido: 'sai fechado, degela no trajeto' }
  if (/barra/.test(n))        return { fluxo: 'degelo', etapas: { degelo: { meta, tempoH: 8, validadeH: 720 } } }
  if (/tarte|torta/.test(n))  return { fluxo: 'degelo', etapas: { degelo: { meta, tempoH: 4, validadeH: 48 } } }
  if (/mousse/.test(n))       return { fluxo: 'degelo', etapas: { degelo: { meta, tempoH: 3, validadeH: 48 } } }
  if (/brownie/.test(n))      return { fluxo: 'degelo', etapas: { degelo: { meta, tempoH: 3, validadeH: 120 } } }
  return { fluxo: 'degelo', etapas: { degelo: { meta } } }
}

// Etapas do produto: as do fluxo + ajustes salvos (meta, tempo, validade)
export function etapasDoProduto(prod) {
  const f = fluxoAtivo(prod)
  if (!f) return []
  const over = prod.prontidao?.etapas || {}
  const etapas = FLUXOS[f].etapas
  return etapas.map((e, i) => {
    const o = over[e.key] || {}
    const ultima = i === etapas.length - 1
    let meta = o.meta
    if (meta == null) meta = (i > 0 && ultima) ? metaPadrao(prod) : 0
    return {
      ...e,
      tempoH:    o.tempoH    ?? e.tempoH    ?? 0,
      validadeH: o.validadeH ?? e.validadeH ?? null,
      meta:      i === 0 ? 0 : (Number(meta) || 0),
      engatilho: ultima,
    }
  })
}

export const verboMover = (prod, de, para) =>
  FLUXOS[fluxoAtivo(prod)]?.verbos?.[`${de}>${para}`] || 'Mover'

const H = 3600 * 1000

// Estado completo de um produto num instante
export function analisarProduto(prod, lotes, agora = Date.now()) {
  const etapas = etapasDoProduto(prod)
  if (!etapas.length) return null
  const keys = new Set(etapas.map(e => e.key))
  const meus = (lotes || []).filter(l => Number(l.produto_id) === Number(prod.id) && l.qtd > 0)

  const det = etapas.map(e => {
    // lote numa etapa que não existe mais no fluxo conta na primeira
    const ls = meus.filter(l => l.etapa === e.key || (e === etapas[0] && !keys.has(l.etapa)))
    let qtd = 0, prontos = 0, pendentes = 0, vencidos = 0, venceLogo = 0, proxPronto = null, proxVence = null
    for (const l of ls) {
      const t = new Date(l.entrou_em).getTime()
      const pronto = t + (e.tempoH || 0) * H
      const vence = e.validadeH ? t + e.validadeH * H : null
      qtd += l.qtd
      if (vence != null && vence <= agora) { vencidos += l.qtd; continue }
      if (pronto <= agora) prontos += l.qtd
      else { pendentes += l.qtd; proxPronto = proxPronto == null ? pronto : Math.min(proxPronto, pronto) }
      // "vence logo": últimas 12 h, ou último quarto da validade se ela for curta (vitrine do choux)
      if (vence != null && vence - agora <= Math.min(12, e.validadeH / 4) * H) { venceLogo += l.qtd; proxVence = proxVence == null ? vence : Math.min(proxVence, vence) }
    }
    return { ...e, qtd, prontos, pendentes, vencidos, venceLogo, proxPronto, proxVence, lotes: ls }
  })

  // Sugestões: de trás pra frente, cada etapa puxa da anterior o que falta pra meta;
  // o que a anterior não cobre vira falta dela (e assim até "produzir").
  const movs = []
  let falta = 0
  for (let i = det.length - 1; i >= 1; i--) {
    const e = det[i], ant = det[i - 1]
    const temValido = e.prontos + e.pendentes
    const precisa = Math.max(0, (e.meta || 0) - temValido) + falta
    const fonte = ant.prontos + ant.pendentes
    if (precisa > 0 && fonte > 0) {
      const n = Math.min(precisa, fonte)
      movs.push({ tipo: 'mover', de: ant.key, para: e.key, n, verbo: verboMover(prod, ant.key, e.key) })
      falta = precisa - n
    } else {
      falta = precisa
    }
  }
  const total = det.reduce((s, e) => s + e.qtd - e.vencidos, 0)
  const abaixoMin = prod.estoqueMin > 0 && total < prod.estoqueMin
  // Ordem do trabalho: descartar vencidos → mover (do freezer pra frente) → produzir
  const sugestoes = [
    ...det.filter(e => e.vencidos > 0).map(e => ({ tipo: 'vencidos', etapa: e.key, n: e.vencidos })),
    ...movs.reverse(),
  ]
  if (falta > 0 || abaixoMin) {
    sugestoes.push({ tipo: 'produzir', n: Math.max(falta, abaixoMin ? prod.estoqueMin - total : 0) })
  }

  const eng = det[det.length - 1]
  const vendaveis = eng.prontos
  let status, rotulo
  if (vendaveis <= 0) {
    status = 'pausar'
    rotulo = eng.pendentes > 0 && eng.proxPronto ? `Pronto às ${hhmm(eng.proxPronto)}` : 'Pausar'
  } else if (sugestoes.length || det.some(e => e.venceLogo > 0)) {
    status = 'atencao'; rotulo = 'Atenção'
  } else {
    status = 'pronto'; rotulo = 'Pronto'
  }
  return { etapas: det, sugestoes, status, rotulo, vendaveis, total }
}

export function hhmm(ts) {
  const d = new Date(ts)
  const hoje = new Date()
  const h = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === hoje.toDateString()) return h
  return `${d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')} ${h}`
}

export function fmtDuracao(h) {
  if (h == null) return '—'
  if (h >= 48) return `${Math.round(h / 24)} dias`
  if (h >= 1) return `${Math.round(h * 10) / 10} h`.replace('.', ',')
  return `${Math.round(h * 60)} min`
}
