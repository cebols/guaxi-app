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
  embalar:   { icon: '📦', cor: '#c084fc', nome: 'sem embalagem' },
}

// Etapa opcional "Sem embalagem": porta de entrada dos produtos que embalam antes
// de guardar (saco autocolante, base + cúpula). Não conta como pronto pra vender.
const ETAPA_EMBALAR = { key: 'embalar', nome: 'Sem embalagem', local: 'embalar' }
export const usaEmbalagem = (prod) => !!prod?.prontidao?.embalar && fluxoAtivo(prod) && fluxoAtivo(prod) !== 'choux'

export const FLUXOS = {
  degelo: {
    nome: 'Congelado → degelo',
    exemplo: 'barras, brownie, entremet, mousse, tartes',
    etapas: [
      { key: 'freezer', nome: 'Freezer', local: 'freezer' },
      { key: 'degelo',  nome: 'Degelo',  local: 'geladeira', tempoH: 0, validadeH: 72 },
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
      { key: 'degelo', nome: 'Degelo',     local: 'ambiente', tempoH: 0, validadeH: 72 },
    ],
    verbos: { 'cru>assado': 'Assar', 'assado>degelo': 'Tirar pro degelo' },
  },
  // Choux: recheia na hora (bate o recheio e recheia por pedido). A sobra
  // reassada do dia volta pro freezer em vez de ir pro lixo.
  choux: {
    nome: 'Massa crua → assada 90% → reassada',
    exemplo: 'choux (recheia na hora)',
    etapas: [
      { key: 'cru',       nome: 'Massa crua',  local: 'freezer', validadeH: 4320 },
      { key: 'cascas',    nome: 'Assadas 90%', local: 'freezer', validadeH: 4320 },
      { key: 'reassadas', nome: 'Reassadas',   local: 'ambiente', tempoH: 0.25, validadeH: 12, voltaPara: 'cascas' },
    ],
    verbos: { 'cru>cascas': 'Assar', 'cascas>reassadas': 'Reassar' },
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
  if (/choux|chou\b/.test(n)) return { fluxo: 'choux', embalar: false, noPedido: 'bater o recheio e rechear na hora', etapas: { cascas: { meta: 10 }, reassadas: { meta: 3 } } }
  if (/cookie/.test(n))       return { fluxo: 'assado', embalar: true, etapas: { degelo: { meta } } }
  if (/cheesecake/.test(n))   return { fluxo: 'direto', embalar: false, noPedido: 'micro-ondas fraco 1 min + geleia' }
  if (/bombo|bombom/.test(n)) return { fluxo: 'direto', embalar: true, noPedido: 'sai fechado, degela no trajeto' }
  if (/barra/.test(n))        return { fluxo: 'degelo', embalar: true, etapas: { degelo: { meta, validadeH: 720 } } }
  if (/tarte|torta/.test(n))  return { fluxo: 'degelo', embalar: true, etapas: { degelo: { meta, validadeH: 48 } } }
  if (/entreme/.test(n))      return { fluxo: 'degelo', embalar: true, etapas: { degelo: { meta, validadeH: 72 } } }
  if (/mousse/.test(n))       return { fluxo: 'degelo', embalar: false, etapas: { degelo: { meta, validadeH: 48 } } }
  if (/brownie/.test(n))      return { fluxo: 'degelo', embalar: true, etapas: { degelo: { meta, validadeH: 120 } } }
  return { fluxo: 'degelo', embalar: false, etapas: { degelo: { meta } } }
}

// Etapas do produto: as do fluxo + ajustes salvos (meta, tempo, validade)
export function etapasDoProduto(prod) {
  const f = fluxoAtivo(prod)
  if (!f) return []
  const over = prod.prontidao?.etapas || {}
  let etapas = FLUXOS[f].etapas
  if (usaEmbalagem(prod)) {
    // cookie: depois de assar (sai da massa crua); os demais: logo na entrada
    const pos = f === 'assado' ? 1 : 0
    etapas = [...etapas.slice(0, pos), ETAPA_EMBALAR, ...etapas.slice(pos)]
  }
  return etapas.map((e, i) => {
    const o = over[e.key] || {}
    const ultima = i === etapas.length - 1
    let meta = o.meta
    if (meta == null) meta = (i > 0 && ultima) ? metaPadrao(prod) : 0
    return {
      ...e,
      // Degelo = pronto pra sair: tirou do freezer (normalmente na véspera), já conta como pronto
      tempoH:    e.key === 'degelo' ? 0 : (o.tempoH ?? e.tempoH ?? 0),
      validadeH: o.validadeH ?? e.validadeH ?? null,
      meta:      i === 0 ? 0 : (Number(meta) || 0),
      engatilho: ultima,
    }
  })
}

export function verboMover(prod, de, para) {
  if (de === 'embalar') return 'Embalar'
  if (para === 'embalar' && de === 'cru') return 'Assar'
  return FLUXOS[fluxoAtivo(prod)]?.verbos?.[`${de}>${para}`] || 'Mover'
}

const H = 3600 * 1000

// Estado completo de um produto num instante.
// reservado = unidades prometidas a pedidos abertos (saem do engatilho ao entregar)
export function analisarProduto(prod, lotes, agora = Date.now(), reservado = 0) {
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
    // o engatilho precisa cobrir a meta + o que já está prometido
    const alvo = (e.meta || 0) + (i === det.length - 1 ? reservado : 0)
    const precisa = Math.max(0, alvo - temValido) + falta
    const fonte = ant.prontos + ant.pendentes
    if (precisa > 0 && fonte > 0) {
      const n = Math.min(precisa, fonte)
      movs.push({ tipo: 'mover', de: ant.key, para: e.key, n, verbo: verboMover(prod, ant.key, e.key) })
      falta = precisa - n
    } else {
      falta = precisa
    }
  }
  // fluxo de etapa única (sai do freezer): reservas também puxam produção
  if (det.length === 1) falta = Math.max(0, reservado - (det[0].prontos + det[0].pendentes))
  const total = det.reduce((s, e) => s + e.qtd - e.vencidos, 0)
  const abaixoMin = prod.estoqueMin > 0 && total - reservado < prod.estoqueMin
  const iEmb = det.findIndex(e => e.key === 'embalar')
  if (iEmb >= 0 && iEmb < det.length - 1) {
    const semEmb = det[iEmb].prontos + det[iEmb].pendentes
    if (semEmb > 0) {
      const ja = movs.find(m => m.de === 'embalar')
      if (ja) ja.n = semEmb
      else movs.push({ tipo: 'mover', de: 'embalar', para: det[iEmb + 1].key, n: semEmb, verbo: 'Embalar' })
    }
  }
  // Ordem do trabalho: descartar vencidos (ou devolver pro freezer) → mover → produzir
  const sugestoes = [
    ...det.filter(e => e.vencidos > 0).map(e => e.voltaPara && keys.has(e.voltaPara)
      ? { tipo: 'mover', de: e.key, para: e.voltaPara, n: e.vencidos, verbo: 'Congelar de volta' }
      : { tipo: 'vencidos', etapa: e.key, n: e.vencidos }),
    ...movs.reverse(),
  ]
  if (falta > 0 || abaixoMin) {
    sugestoes.push({ tipo: 'produzir', n: Math.max(falta, abaixoMin ? prod.estoqueMin - total : 0) })
  }

  const eng = det[det.length - 1]
  const vendaveis = Math.max(0, eng.prontos - reservado)   // livres pra vender agora
  let status, rotulo
  if (vendaveis <= 0) {
    status = 'pausar'
    const semEmb = det.find(e => e.key === 'embalar')
    rotulo = eng.prontos > 0 && reservado > 0 ? 'Tudo reservado'
      : eng.pendentes > 0 && eng.proxPronto ? `Pronto às ${hhmm(eng.proxPronto)}`
      : semEmb && semEmb.qtd - semEmb.vencidos > 0 ? 'Falta embalar' : 'Pausar'
  } else if (sugestoes.length || det.some(e => e.venceLogo > 0)) {
    status = 'atencao'; rotulo = 'Atenção'
  } else {
    status = 'pronto'; rotulo = 'Pronto'
  }
  return { etapas: det, sugestoes, status, rotulo, vendaveis, total, reservado }
}

// ── Tarefas "o que fazer agora" (quadro da Prontidão e lista do Início) ──────
export const GRUPOS_TAREFA = [
  { key: 'embalar',   icon: '📦', nome: 'Embalar',   cor: '#c084fc', match: t => t.tipo === 'mover' && t.verbo === 'Embalar' },
  { key: 'forno',     icon: '🔥', nome: 'Forno',     cor: '#fb923c', match: t => (t.tipo === 'mover' && (t.verbo === 'Assar' || t.verbo === 'Reassar')) || (t.tipo === 'aguardando' && t.etapa !== 'degelo') },
  { key: 'degelo',    icon: '💧', nome: 'Degelo',    cor: '#2dd4bf', match: t => (t.tipo === 'mover' && t.verbo === 'Tirar pro degelo') || (t.tipo === 'aguardando' && t.etapa === 'degelo') },
  { key: 'rechear',   icon: '🧁', nome: 'Rechear',   cor: '#4ade80', match: t => t.tipo === 'mover' && t.verbo === 'Rechear' },
  { key: 'congelar',  icon: '❄', nome: 'Voltar pro freezer', cor: '#60a5fa', match: t => t.tipo === 'mover' && t.verbo === 'Congelar de volta' },
  { key: 'mover',     icon: '➡️', nome: 'Mover',     cor: '#94a3b8', match: t => t.tipo === 'mover' },
  { key: 'produzir',  icon: '🧾', nome: 'Produzir',  cor: '#14b8a6', match: t => t.tipo === 'produzir' },
  { key: 'avisar',    icon: '🔔', nome: 'Avisar',    cor: '#60a5fa', match: t => t.tipo === 'avisar' },
  { key: 'descartar', icon: '🗑', nome: 'Descartar', cor: '#f87171', match: t => t.tipo === 'vencidos' },
]
export const FEITO = { Embalar: 'Embalei', Assar: 'Assei', Reassar: 'Reassei', 'Tirar pro degelo': 'Tirei', Rechear: 'Recheei', Mover: 'Movi', 'Congelar de volta': 'Congelei' }
export const grupoDe = (t) => (GRUPOS_TAREFA.find(g => g.key !== 'mover' && g.key !== 'descartar' && g.match(t)) || GRUPOS_TAREFA.find(g => g.match(t)))?.key

const ORDEM_STATUS = { pausar: 0, atencao: 1, pronto: 2 }

// analises: [{ prod, a: analisarProduto(...) }]; interessadosPor: { produtoId: [interesse] }
export function montarTarefas(analises, interessadosPor = {}) {
  return analises
    .flatMap(x => [
      ...x.a.sugestoes.map(s => ({ ...s, prod: x.prod, status: x.a.status })),
      ...(x.a.vendaveis > 0 && interessadosPor[x.prod.id]?.length
        ? [{ tipo: 'avisar', prod: x.prod, n: interessadosPor[x.prod.id].length, status: x.a.status }] : []),
      ...x.a.etapas.filter(e => e.pendentes > 0 && e.tempoH > 0)
        .map(e => ({ tipo: 'aguardando', etapa: e.key, n: e.pendentes, prontoAs: e.proxPronto, tempoH: e.tempoH, prod: x.prod, status: x.a.status })),
    ])
    .sort((a, b) => ORDEM_STATUS[a.status] - ORDEM_STATUS[b.status])
}

// Embalar com dois destinos: o que falta no engatilho já vai direto pra ele,
// o resto pra etapa seguinte (ex: freezer). null = destino único.
export function destinosEmbalar(t, a, qtd = t.n) {
  const etapas = a?.etapas || []
  const iEmb = etapas.findIndex(e => e.key === 'embalar')
  const prox = iEmb >= 0 ? etapas[iEmb + 1] : null
  const eng = etapas[etapas.length - 1]
  if (t.de !== 'embalar' || !prox || !eng || prox.key === eng.key) return null
  const faltaEng = Math.max(0, (eng.meta || 0) + (a?.reservado || 0) - (eng.prontos + eng.pendentes))
  const nEng = Math.min(faltaEng, qtd)
  return [{ etapa: prox.key, qtd: qtd - nEng }, { etapa: eng.key, qtd: nEng }].filter(d => d.qtd > 0)
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
