// ── Cardápio ao vivo pro agente ───────────────────────────────────────────────
// Junta, na hora de cada mensagem: produtos do cardápio online (preço, descrição,
// seção), quanto está pronto pra vender (mesma conta do cardápio online, já
// descontando pedidos reservados), o que está descongelando/finalizando, o que
// está no estoque de trás ("volta em breve") e o que está em produção.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const OWNER_USER_ID = Deno.env.get('OWNER_USER_ID') || '62d922d0-b6cc-403f-9c0d-e2f7887c1404'
export const APP_BASE = Deno.env.get('APP_BASE_URL') || 'https://guaxi-app.vercel.app'
export const LINK_CARDAPIO = `${APP_BASE}/pedido/${OWNER_USER_ID}`

const FUSO = 'America/Sao_Paulo'
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

// Etapas que contam como "pronto pra vender" por fluxo do Prontidão — espelha
// produtos_disponiveis (schema.sql) e src/lib/prontidao.js. Tempo padrão (h)
// até ficar pronto depois de entrar na etapa.
const VENDAVEL: Record<string, string[]> = {
  degelo: ['degelo'], assado: ['degelo'], choux: ['cascas', 'reassadas'], direto: ['freezer'],
}
const TEMPO_PADRAO: Record<string, Record<string, number>> = {
  degelo: { degelo: 4 }, assado: { degelo: 1 }, choux: { reassadas: 0.25 },
}

export interface ProdutoCardapio {
  id: number
  nome: string
  descricao: string
  preco: number
  secao: string
  ordem: number | null
  fragil: boolean
  disponivel: number      // pronto pra vender agora (menos o reservado)
  finalizando: number     // dentro do "pronto", ainda descongelando/reassando
  prontoAs: string | null // HH:MM do próximo que fica pronto
  aCaminho: number        // nas etapas de trás (freezer, sem embalagem...)
  emProducao: number      // em produção aberta, ainda não montado
}

export interface Cardapio {
  produtos: ProdutoCardapio[]
  secoesOrdem: string[]
  diasEntrega: number[]
  freteGratis: number
}

export const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' })

export function agoraBR(ms = Date.now()) {
  const d = new Date(ms)
  const data = d.toLocaleDateString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric' })
  const iso = d.toLocaleDateString('en-CA', { timeZone: FUSO })   // YYYY-MM-DD
  const dia = DIAS[new Date(`${iso}T12:00:00Z`).getUTCDay()]
  return { data, iso, dia, hora: hhmm(ms) }
}

const fmtR = (v: number) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`

type Linha = Record<string, unknown>

export async function carregarCardapio(sb: SupabaseClient, agora = Date.now()): Promise<Cardapio> {
  const desde = new Date(agora - 14 * 86400e3).toISOString()
  const [pub, disp, cfg, flu, lot, prod] = await Promise.all([
    sb.rpc('cardapio_publico', { p_user_id: OWNER_USER_ID }),
    sb.rpc('produtos_disponiveis', { p_user_id: OWNER_USER_ID }),
    sb.from('user_config').select('config').eq('user_id', OWNER_USER_ID).maybeSingle(),
    sb.from('produtos').select('id, prontidao').eq('user_id', OWNER_USER_ID),
    sb.from('prontidao_lotes').select('produto_id, etapa, qtd, entrou_em').eq('user_id', OWNER_USER_ID).gt('qtd', 0),
    sb.from('producao_itens').select('produto_id, quantidade, snapshot, producoes!inner(created_at, user_id)')
      .eq('tipo', 'produto').eq('producoes.user_id', OWNER_USER_ID).gte('producoes.created_at', desde),
  ])

  // Cardápio público (função do banco); sem ela, filtra a tabela direto
  let linhas = (pub.data || []) as Linha[]
  if (pub.error) {
    const r = await sb.from('produtos')
      .select('id, nome, descricao, preco_direta, secao, ordem, fragilidade, tipo, ativo')
      .eq('user_id', OWNER_USER_ID).eq('ativo', true).gt('preco_direta', 0)
    linhas = ((r.data || []) as Linha[]).filter(p => p.tipo !== 'combo')
  }

  const dispPor = new Map<number, { d: number; c: number }>()
  for (const x of (disp.data || []) as Linha[]) {
    dispPor.set(Number(x.produto_id), { d: Number(x.disponivel) || 0, c: Number(x.a_caminho) || 0 })
  }
  const fluxoPor = new Map<number, Linha>()
  for (const p of (flu.data || []) as Linha[]) fluxoPor.set(Number(p.id), (p.prontidao || {}) as Linha)

  const producao = new Map<number, number>()
  for (const it of (prod.data || []) as Linha[]) {
    const snap = (it.snapshot || {}) as Linha
    if (snap.montado) continue
    const id = Number(it.produto_id)
    producao.set(id, (producao.get(id) || 0) + (Number(it.quantidade) || 0))
  }

  const lotes = (lot.data || []) as Linha[]
  const config = ((cfg.data as Linha | null)?.config || {}) as Linha
  const delivery = (config.delivery || {}) as Linha

  const produtos: ProdutoCardapio[] = linhas.map(p => {
    const id = Number(p.id)
    const pr = fluxoPor.get(id) || {}
    const fluxo = String(pr.fluxo || '')
    const vendaveis = VENDAVEL[fluxo] || []
    const over = (pr.etapas || {}) as Record<string, Linha>
    let finalizando = 0
    let proximo: number | null = null
    for (const l of lotes) {
      if (Number(l.produto_id) !== id || !vendaveis.includes(String(l.etapa))) continue
      const etapa = String(l.etapa)
      const tempoH = Number(over[etapa]?.tempoH ?? TEMPO_PADRAO[fluxo]?.[etapa] ?? 0)
      const pronto = new Date(String(l.entrou_em)).getTime() + tempoH * 3600e3
      if (pronto > agora) {
        finalizando += Number(l.qtd) || 0
        proximo = proximo == null ? pronto : Math.min(proximo, pronto)
      }
    }
    const dc = dispPor.get(id)
    return {
      id,
      nome: String(p.nome || ''),
      descricao: String(p.descricao || '').trim(),
      preco: Number(p.preco_direta) || 0,
      secao: String(p.secao || ''),
      ordem: p.ordem == null ? null : Number(p.ordem),
      fragil: p.fragilidade === 'fragil',
      disponivel: dc ? dc.d : Math.max(0, Math.floor(Number(p.estoque_atual) || 0)),
      finalizando,
      prontoAs: proximo ? hhmm(proximo) : null,
      aCaminho: dc ? dc.c : 0,
      emProducao: producao.get(id) || 0,
    }
  })

  return {
    produtos,
    secoesOrdem: Array.isArray(config.secoesOrdem) ? (config.secoesOrdem as string[]) : [],
    diasEntrega: Array.isArray(delivery.diasEntrega) ? (delivery.diasEntrega as number[]) : [],
    freteGratis: Number(delivery.freteGratis) || 0,
  }
}

export function statusDe(p: ProdutoCardapio): 'pronto' | 'volta' | 'producao' | 'esgotado' {
  if (p.disponivel > 0) return 'pronto'
  if (p.aCaminho > 0) return 'volta'
  if (p.emProducao > 0) return 'producao'
  return 'esgotado'
}

function linhaStatus(p: ProdutoCardapio): string {
  switch (statusDe(p)) {
    case 'pronto': {
      const fin = p.finalizando > 0
        ? ` (${p.finalizando >= p.disponivel ? 'todos' : p.finalizando} ainda finalizando — prontos às ${p.prontoAs})`
        : ''
      return `PRONTO: ${p.disponivel} un${fin}`
    }
    case 'volta': return 'VOLTA EM BREVE (tem no estoque de trás, ainda não finalizado)'
    case 'producao': return `EM PRODUÇÃO (fornada de ${p.emProducao} sendo feita)`
    default: return 'ESGOTADO (sem previsão)'
  }
}

// Texto que vai junto das instruções do agente a cada mensagem
export function textoCardapio(c: Cardapio, agora = Date.now()): string {
  const h = agoraBR(agora)
  const dias = [...c.diasEntrega].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => DIAS[d])
  const linhas: string[] = [
    `AGORA: ${h.dia}, ${h.data}, ${h.hora} (horário de Brasília).`,
    `Link do cardápio (fotos, vídeos e pedido online): ${LINK_CARDAPIO}`,
    `Link de um produto: ${LINK_CARDAPIO}?produto=<id>`,
    dias.length ? `Entregas: ${dias.join(', ')}. Retirada também.` : 'Entregas: a combinar. Retirada também.',
    c.freteGratis > 0 ? `Frete grátis em pedidos a partir de ${fmtR(c.freteGratis)}.` : '',
    '',
  ].filter(l => l !== '')

  const secs = [...new Set(c.produtos.map(p => p.secao).filter(Boolean))]
  const ordem = [...c.secoesOrdem.filter(s => secs.includes(s)), ...secs.filter(s => !c.secoesOrdem.includes(s))]
  const grupos = [...ordem.map(s => ({ s, itens: c.produtos.filter(p => p.secao === s) })),
    { s: 'Outros', itens: c.produtos.filter(p => !p.secao) }].filter(g => g.itens.length)
  const porOrdem = (a: ProdutoCardapio, b: ProdutoCardapio) =>
    ((a.ordem ?? 1e9) - (b.ordem ?? 1e9)) || a.nome.localeCompare(b.nome, 'pt-BR')

  if (!c.produtos.length) linhas.push('(Nenhum produto no cardápio agora.)')
  for (const g of grupos) {
    linhas.push(`## ${g.s}`)
    for (const p of [...g.itens].sort(porOrdem)) {
      linhas.push(`- [id ${p.id}] ${p.nome} — ${fmtR(p.preco)} — ${linhaStatus(p)}${p.fragil ? ' — frágil (vai de carro)' : ''}`)
      linhas.push(`  Descrição: ${p.descricao || '(sem descrição cadastrada — não invente)'}`)
    }
  }
  return linhas.join('\n')
}
