// ── Visitas do cardápio: contas do painel (Vendas › Visitas e Início) ──────────
// Lógica pura: recebe as visitas do banco e os pedidos (pra saber quem é cliente).

export const ETAPAS = [
  { key: 'entrou',   nome: 'Entrou no cardápio' },
  { key: 'produto',  nome: 'Abriu um doce' },
  { key: 'carrinho', nome: 'Pôs no carrinho' },
  { key: 'checkout', nome: 'Foi finalizar' },
  { key: 'pedido',   nome: 'Fez o pedido' },
  { key: 'pago',     nome: 'Pagou' },
]
const idx = (k) => Math.max(0, ETAPAS.findIndex(e => e.key === k))

export const ORIGENS = {
  link: 'Link da Guaxí', convite: 'Convite / cupom', instagram: 'Instagram', facebook: 'Facebook',
  whatsapp: 'WhatsApp', google: 'Google', direto: 'Direto', outro: 'Outro site',
}
export const nomeOrigem = (o) => ORIGENS[o] || (o ? o[0].toUpperCase() + o.slice(1) : 'Direto')

const tel8 = (s) => String(s || '').replace(/\D/g, '').slice(-8)
export const AO_VIVO_MS = 70e3
export const aoVivo = (visitas, agora = Date.now()) => (visitas || []).filter(v => agora - new Date(v.ultimo).getTime() < AO_VIVO_MS)

// Clientes conhecidos pelos pedidos: tel8 → { nome, pedidos, ultimo }
export function clientesPorTel(encomendas) {
  const m = {}
  for (const e of (encomendas || [])) {
    if (e.status === 'Cancelado') continue
    const t = tel8(e.contato)
    if (t.length !== 8) continue
    const c = (m[t] ||= { nome: e.cliente, pedidos: 0, ultimo: null })
    c.pedidos++
    const d = e.createdAt || e.dataEntrega
    if (d && (!c.ultimo || d > c.ultimo)) { c.ultimo = d; c.nome = e.cliente || c.nome }
  }
  return m
}

// Quem é: nome (cliente, link ou checkout) ou visitante anônimo (novo / já veio antes)
export function pessoa(v, clientes, visitasAntes) {
  const c = v.tel8 ? clientes[v.tel8] : null
  const nome = (c?.nome || v.nome || '').trim()
  if (nome || v.tel8) {
    return { conhecido: true, nome: nome || 'Cliente sem nome', primeiro: (nome.split(/\s+/)[0] || ''), tel8: v.tel8,
      detalhe: c ? `${c.pedidos} ${c.pedidos === 1 ? 'pedido' : 'pedidos'}` : 'ainda não comprou' }
  }
  const voltou = (visitasAntes || []).some(x => x.visitante === v.visitante && x.id !== v.id && new Date(x.inicio) < new Date(v.inicio))
  return { conhecido: false, nome: voltou ? 'Visitante que já veio antes' : 'Visitante novo', detalhe: nomeOrigem(v.origem) }
}

const pagoDe = (v, pedidosPorId) => v.etapa === 'pago' || (v.pedido_id && pedidosPorId[v.pedido_id]?.pgto === 'Pago')

// Funil: quantas visitas chegaram até cada etapa
export function funil(visitas, encomendas) {
  const porId = Object.fromEntries((encomendas || []).map(e => [e.id, e]))
  const n = ETAPAS.map(() => 0)
  for (const v of visitas) {
    const ate = pagoDe(v, porId) ? idx('pago') : idx(v.pedido_id && idx(v.etapa) < idx('pedido') ? 'pedido' : v.etapa)
    for (let i = 0; i <= ate; i++) n[i]++
  }
  return ETAPAS.map((e, i) => ({ ...e, n: n[i], pct: n[0] ? n[i] / n[0] : 0, caiu: i > 0 && n[i - 1] ? 1 - n[i] / n[i - 1] : 0 }))
}

export function porOrigem(visitas) {
  const m = {}
  for (const v of visitas) {
    const o = (m[v.origem || 'direto'] ||= { origem: v.origem || 'direto', visitas: 0, pedidos: 0 })
    o.visitas++
    if (v.pedido_id) o.pedidos++
  }
  return Object.values(m).sort((a, b) => b.visitas - a.visitas)
}

// Carrinhos parados (carrinho ou checkout sem pedido, e a pessoa não comprou depois).
// Um por pessoa (o mais recente). Mais recentes primeiro.
export function abandonos(visitas, encomendas, { agora = Date.now(), minMs = 20 * 60e3 } = {}) {
  const pedidosDepois = (v) => (encomendas || []).some(e => e.status !== 'Cancelado' && v.tel8 && tel8(e.contato) === v.tel8
    && e.createdAtTs && new Date(e.createdAtTs) >= new Date(v.inicio))
  const comPedido = new Set(visitas.filter(v => v.pedido_id).map(v => v.visitante))
  const vistos = new Set(), out = []
  for (const v of [...visitas].sort((a, b) => new Date(b.ultimo) - new Date(a.ultimo))) {
    if (!['carrinho', 'checkout'].includes(v.etapa) || v.pedido_id || !(v.carrinho || []).length) continue
    if (agora - new Date(v.ultimo).getTime() < minMs) continue          // ainda pode estar comprando
    const chave = v.tel8 || v.visitante
    if (vistos.has(chave)) continue
    vistos.add(chave)
    const depois = visitas.some(x => x.pedido_id && (x.visitante === v.visitante || (v.tel8 && x.tel8 === v.tel8)) && new Date(x.ultimo) > new Date(v.ultimo))
    if (depois || pedidosDepois(v)) continue
    if (!v.tel8 && comPedido.has(v.visitante)) continue
    out.push(v)
  }
  return out
}

// Doces: quantas visitas abriram, puseram no carrinho e pediram
export function doces(visitas) {
  const m = {}
  const pega = (id, nome) => (m[id] ||= { id, nome: nome || '', viu: 0, carrinho: 0, pedido: 0 })
  for (const v of visitas) {
    for (const id of new Set(v.produtos_vistos || [])) pega(id).viu++
    for (const it of (v.carrinho || [])) {
      const d = pega(it.id, it.nome); d.nome = d.nome || it.nome
      d.carrinho++
      if (v.pedido_id) d.pedido++
    }
  }
  return Object.values(m)
}

export const resumoCarrinho = (v) => (v.carrinho || []).map(i => `${i.qtd}× ${i.nome}`).join(', ')
export const linkCarrinho = (v) => (v.carrinho || []).map(i => `${i.id}.${i.qtd}`).join(',')
export function haQuanto(iso, agora = Date.now()) {
  const min = Math.round((agora - new Date(iso).getTime()) / 60e3)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'ontem' : `há ${d} dias`
}
