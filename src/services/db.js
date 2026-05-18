import { supabase } from '../lib/supabase'

// Upsert helper with graceful fallback for optional new columns
// If a column doesn't exist (migration not run), strips only that column and retries.
async function upsert(table, row, id, optionalCols = []) {
  const exec = async (r) => {
    if (id) {
      const { error } = await supabase.from(table).update(r).eq('id', id)
      return { data: { id }, error }
    }
    return supabase.from(table).insert(r).select().single()
  }
  let currentRow = { ...row }
  let remaining = [...optionalCols]
  let { data, error } = await exec(currentRow)
  while (error && remaining.length > 0) {
    const failingCol = remaining.find(c => error.message?.includes(c))
    if (!failingCol) break
    remaining = remaining.filter(c => c !== failingCol)
    currentRow = Object.fromEntries(Object.entries(currentRow).filter(([k]) => k !== failingCol))
    const res = await exec(currentRow)
    error = res.error
    data = res.data
  }
  if (error) throw error
  return data
}

// ── Insumos ───────────────────────────────────────────────────

export async function getInsumos() {
  const { data, error } = await supabase.from('insumos').select('*').order('nome')
  if (error) throw error
  return data.map(r => ({
    id: r.id,
    nome: r.nome,
    marca: r.marca || '',
    categoria: r.categoria || '',
    unidade: r.unidade || 'g',
    pesoEmb: r.peso_emb || 0,
    custoEmb: r.custo_emb || 0,
    pesoUn: r.peso_un ?? null,
    custoUnit: r.custo_unit || 0,
    linkCompra: r.link_compra || '',
    estoqueAtual: r.estoque_atual,
    estoqueMin: r.estoque_min || 0,
    fornecedor: r.fornecedor || '',
    telefone: r.telefone || '',
    whatsapp: r.whatsapp || '',
  }))
}

export async function saveInsumo(insumo) {
  const pesoEmb = parseFloat(insumo.pesoEmb) || 0
  const custoEmb = parseFloat(insumo.custoEmb) || 0
  const pesoUn = insumo.pesoUn !== '' && insumo.pesoUn != null ? parseFloat(insumo.pesoUn) : null

  let custoUnit = 0
  if (pesoEmb > 0 && custoEmb > 0) {
    if (insumo.unidade === 'un' && pesoUn > 0) {
      custoUnit = (custoEmb / pesoEmb) / pesoUn
    } else {
      custoUnit = custoEmb / pesoEmb
    }
  }

  const row = {
    nome: insumo.nome,
    marca: insumo.marca || '',
    categoria: insumo.categoria || '',
    unidade: insumo.unidade || 'g',
    peso_emb: pesoEmb,
    custo_emb: custoEmb,
    peso_un: pesoUn,
    custo_unit: custoUnit,
    link_compra: insumo.linkCompra || '',
    estoque_atual: insumo.estoqueAtual !== '' ? parseFloat(insumo.estoqueAtual) : null,
    estoque_min: parseFloat(insumo.estoqueMin) || 0,
    fornecedor: insumo.fornecedor || '',
    telefone: insumo.telefone || '',
    whatsapp: insumo.whatsapp || '',
  }
  const data = await upsert('insumos', row, insumo.id || null, ['link_compra', 'marca'])
  if (data?.id && custoUnit > 0) {
    snapshotInsumoCost(data.id, custoUnit).catch(() => {})
  }
  return data
}

function weekStart(d = new Date()) {
  const dt = new Date(d); dt.setHours(0, 0, 0, 0)
  dt.setDate(dt.getDate() - dt.getDay())
  return dt.toISOString().slice(0, 10)
}

export async function snapshotInsumoCost(insumoId, custoUnit) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  await supabase.from('insumo_cost_history').upsert(
    { user_id: user.id, insumo_id: insumoId, week: weekStart(), custo_unit: custoUnit },
    { onConflict: 'user_id,insumo_id,week' }
  )
}

export async function getInsumoCostHistory(weeks = 12) {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - weeks * 7)
  const { data, error } = await supabase
    .from('insumo_cost_history')
    .select('insumo_id, week, custo_unit')
    .gte('week', cutoff.toISOString().slice(0, 10))
    .order('week', { ascending: true })
  if (error) return {}
  const map = {}
  for (const r of (data || [])) {
    if (!map[r.insumo_id]) map[r.insumo_id] = []
    map[r.insumo_id].push({ week: r.week, custo: parseFloat(r.custo_unit) })
  }
  return map
}

export async function getInsumoFornecedores(insumoId) {
  const { data, error } = await supabase.from('insumo_fornecedores').select('*').eq('insumo_id', insumoId).order('id')
  if (error?.code === '42P01') return []
  if (error) throw error
  return (data || []).map(f => ({
    id: f.id,
    insumoId: f.insumo_id,
    marca: f.marca || '',
    fornecedor: f.fornecedor || '',
    pesoEmb: f.peso_emb || 0,
    custoEmb: f.custo_emb || 0,
    custoUnit: f.custo_unit || 0,
    linkCompra: f.link_compra || '',
    telefone: f.telefone || '',
  }))
}

export async function saveInsumoFornecedores(insumoId, fontes, mainCustoUnit = 0) {
  const { error: delErr } = await supabase.from('insumo_fornecedores').delete().eq('insumo_id', insumoId)
  if (delErr?.code !== '42P01' && delErr) throw delErr

  const valid = fontes.filter(f => f.marca || f.fornecedor || parseFloat(f.custoEmb) > 0)
  if (valid.length === 0) return

  const rows = valid.map(f => {
    const pesoEmb  = parseFloat(f.pesoEmb)  || 0
    const custoEmb = parseFloat(f.custoEmb) || 0
    const custoUnit = pesoEmb > 0 && custoEmb > 0 ? custoEmb / pesoEmb : 0
    return { insumo_id: insumoId, marca: f.marca || '', fornecedor: f.fornecedor || '', peso_emb: pesoEmb, custo_emb: custoEmb, custo_unit: custoUnit, link_compra: f.linkCompra || '', telefone: f.telefone || '' }
  })

  const { error: insErr } = await supabase.from('insumo_fornecedores').insert(rows)
  if (insErr?.code !== '42P01' && insErr) throw insErr

  // Update effective custo_unit to priority supplier (first in list)
  const priority = rows.find(r => r.custo_unit > 0)
  const effectiveCost = priority ? priority.custo_unit : (mainCustoUnit > 0 ? mainCustoUnit : null)
  if (effectiveCost != null) {
    await supabase.from('insumos').update({ custo_unit: effectiveCost }).eq('id', insumoId)
    snapshotInsumoCost(insumoId, effectiveCost).catch(() => {})
  }
}

export async function getAllInsumoFornecedores() {
  const { data, error } = await supabase.from('insumo_fornecedores').select('*').order('custo_unit')
  if (error?.code === '42P01') return []
  if (error) throw error
  return (data || []).map(f => ({
    id: f.id,
    insumoId: f.insumo_id,
    marca: f.marca || '',
    fornecedor: f.fornecedor || '',
    pesoEmb: f.peso_emb || 0,
    custoEmb: f.custo_emb || 0,
    custoUnit: f.custo_unit || 0,
    linkCompra: f.link_compra || '',
    telefone: f.telefone || '',
  }))
}

export async function deleteInsumo(id) {
  const { error } = await supabase.from('insumos').delete().eq('id', id)
  if (error) throw error
}

export async function deleteInsumos(ids) {
  const { error } = await supabase.from('insumos').delete().in('id', ids)
  if (error) throw error
}

export async function updateEstoqueInsumos(items) {
  await Promise.all(
    items.map(({ id, estoqueAtual }) =>
      supabase.from('insumos').update({ estoque_atual: estoqueAtual }).eq('id', id)
    )
  )
}

// ── Embalagens ────────────────────────────────────────────────

export async function getEmbalagens() {
  const { data, error } = await supabase.from('embalagens').select('*').order('nome')
  if (error) throw error
  return data.map(r => ({
    id: r.id,
    nome: r.nome,
    categoria: r.categoria || '',
    qtdCompra: r.qtd_compra || 0,
    custoCompra: r.custo_compra || 0,
    custoUnit: r.custo_unit || 0,
    linkCompra: r.link_compra || '',
    fornecedor: r.fornecedor || '',
    telefone: r.telefone || '',
    whatsapp: r.whatsapp || '',
    estoqueAtual: r.estoque_atual,
    estoqueMin: r.estoque_min || 0,
  }))
}

export async function saveEmbalagem(emb) {
  const qtdCompra = parseFloat(emb.qtdCompra) || 0
  const custoCompra = parseFloat(emb.custoCompra) || 0
  const custoUnit = qtdCompra > 0 ? custoCompra / qtdCompra : 0

  const row = {
    nome: emb.nome,
    categoria: emb.categoria || '',
    qtd_compra: qtdCompra,
    custo_compra: custoCompra,
    custo_unit: custoUnit,
    link_compra: emb.linkCompra || '',
    estoque_atual: emb.estoqueAtual !== '' ? parseFloat(emb.estoqueAtual) : null,
    estoque_min: parseFloat(emb.estoqueMin) || 0,
    fornecedor: emb.fornecedor || '',
    telefone: emb.telefone || '',
    whatsapp: emb.whatsapp || '',
  }
  await upsert('embalagens', row, emb.id || null, ['link_compra'])
}

export async function deleteEmbalagem(id) {
  const { error } = await supabase.from('embalagens').delete().eq('id', id)
  if (error) throw error
}

export async function updateEstoqueEmbalagens(items) {
  await Promise.all(
    items.map(({ id, estoqueAtual }) =>
      supabase.from('embalagens').update({ estoque_atual: estoqueAtual }).eq('id', id)
    )
  )
}

export async function registrarCompras(compras) {
  const { error } = await supabase.from('compras').insert(compras)
  if (error) throw error
}

export async function getCompras() {
  const { data, error } = await supabase
    .from('compras').select('*').order('created_at', { ascending: false })
  if (error) {
    if (error.message?.includes('compras') || error.code === '42P01') return []
    throw error
  }
  return data.map(r => ({
    id: r.id,
    tipo: r.tipo,
    itemNome: r.item_nome,
    unidade: r.unidade || '',
    quantidade: r.quantidade,
    precoUnit: r.preco_unit,
    total: r.total,
    data: r.data,
    createdAt: r.created_at,
  }))
}

export async function deleteCompra(id) {
  const { error } = await supabase.from('compras').delete().eq('id', id)
  if (error) throw error
}

// ── Produtos ──────────────────────────────────────────────────

export async function getProdutos() {
  const { data, error } = await supabase
    .from('produtos')
    .select(`
      *,
      produto_receitas(*, receitas(nome, custo_unid, unidade_gera)),
      produto_embalagens(*, embalagens(nome, custo_unit))
    `)
    .order('nome')

  if (error) {
    // Junction tables don't exist — fallback to composicao JSON column
    const { data: d2, error: e2 } = await supabase.from('produtos').select('*').order('nome')
    if (e2) throw e2
    return d2.map(r => ({
      id: r.id,
      nome: r.nome,
      tipo: r.tipo || 'produto',
      custoTotal: r.custo_total || 0,
      custoDireto: r.custo_direto ?? r.composicao?.custoDireto ?? null,
      fornecedor: r.fornecedor || r.composicao?.fornecedor || '',
      whatsapp:   r.whatsapp   || r.composicao?.whatsapp   || '',
      linkCompra: r.link_compra || r.composicao?.linkCompra || '',
      precoSugerido: r.preco_sugerido || 0,
      precoPraticado: r.preco_praticado,
      precoDireta: r.preco_direta ?? r.composicao?.precoDireta ?? null,
      preco99:     r.preco_99     ?? r.composicao?.preco99     ?? null,
      precoIfood:  r.preco_ifood  ?? r.composicao?.precoIfood  ?? null,
      estoqueAtual: r.estoque_atual ?? null,
      estoqueMin:   r.estoque_min  ?? 0,
      receitas:    (r.composicao?.receitas    || []),
      embalagens:  (r.composicao?.embalagens  || []),
      componentes: (r.composicao?.componentes || []),
    }))
  }

  return data.map(r => ({
    id: r.id,
    nome: r.nome,
    tipo: r.tipo || 'produto',
    custoTotal: r.custo_total || 0,
    custoDireto: r.custo_direto ?? null,
    fornecedor: r.fornecedor || '',
    whatsapp:   r.whatsapp   || '',
    linkCompra: r.link_compra || '',
    precoSugerido: r.preco_sugerido || 0,
    precoPraticado: r.preco_praticado,
    precoDireta: r.preco_direta ?? null,
    preco99:     r.preco_99     ?? null,
    precoIfood:  r.preco_ifood  ?? null,
    estoqueAtual: r.estoque_atual ?? null,
    estoqueMin:   r.estoque_min  ?? 0,
    componentes: (r.composicao?.componentes || []),
    receitas: (r.produto_receitas || []).map(pr => ({
      id: pr.id,
      receitaId: pr.receita_id,
      nome: pr.receitas?.nome || '',
      quantidade: pr.quantidade || 1,
      custoUnid: pr.receitas?.custo_unid || 0,
      unidadeGera: pr.receitas?.unidade_gera || 'un',
    })),
    embalagens: (r.produto_embalagens || []).map(pe => ({
      id: pe.id,
      embalagemId: pe.embalagem_id,
      nome: pe.embalagens?.nome || '',
      quantidade: pe.quantidade || 1,
      custoUnit: pe.embalagens?.custo_unit || 0,
    })),
  }))
}

export async function saveProduto(prod, receitaItems = [], embalagemItems = []) {
  const custoTotal =
    receitaItems.reduce((s, r) => s + (parseFloat(r.custoUnid) || 0) * (parseFloat(r.quantidade) || 1), 0) +
    embalagemItems.reduce((s, e) => s + (parseFloat(e.custoUnit) || 0) * (parseFloat(e.quantidade) || 1), 0)

  const toNum = (v) => v !== '' && v != null ? parseFloat(v) : null

  const custoDireto   = toNum(prod.custoDireto)
  const custoCombo    = (prod.componentes || []).reduce((s, c) => s + (parseFloat(c.custoUnit) || 0) * (parseFloat(c.quantidade) || 1), 0)
  const efectivoCusto = prod.tipo === 'avulso' ? (custoDireto ?? 0)
                      : prod.tipo === 'combo'  ? custoCombo
                      : custoTotal

  const row = {
    nome:           prod.nome,
    tipo:           prod.tipo || 'produto',
    custo_total:    efectivoCusto,
    custo_direto:   custoDireto,
    fornecedor:     prod.fornecedor  || '',
    whatsapp:       prod.whatsapp    || '',
    link_compra:    prod.linkCompra  || '',
    preco_sugerido: parseFloat(prod.precoSugerido) || 0,
    preco_praticado: toNum(prod.precoDireta),
    preco_direta:   toNum(prod.precoDireta),
    preco_99:       toNum(prod.preco99),
    preco_ifood:    toNum(prod.precoIfood),
    estoque_min:    parseFloat(prod.estoqueMin) || 0,
  }

  const saved = await upsert('produtos', row, prod.id || null,
    ['preco_direta', 'preco_99', 'preco_ifood', 'custo_direto', 'tipo', 'fornecedor', 'whatsapp', 'link_compra', 'estoque_min'])
  const prodId = prod.id || saved.id

  // Always save composicao JSON as backup (works even without junction tables)
  const composicao = {
    receitas: receitaItems.map(r => ({
      receitaId: r.receitaId, nome: r.nome,
      quantidade: parseFloat(r.quantidade) || 1,
      unidade: r.unidade || 'un',
      custoUnid: parseFloat(r.custoUnid) || 0,
    })),
    embalagens: embalagemItems.map(e => ({
      embalagemId: e.embalagemId, nome: e.nome,
      quantidade: parseFloat(e.quantidade) || 1,
      custoUnit: parseFloat(e.custoUnit) || 0,
    })),
    componentes: (prod.componentes || []).map(c => ({
      produtoId: c.produtoId, produtoNome: c.nome,
      quantidade: parseFloat(c.quantidade) || 1,
      custoUnit: parseFloat(c.custoUnit) || 0,
    })),
    precoDireta: toNum(prod.precoDireta),
    preco99:     toNum(prod.preco99),
    precoIfood:  toNum(prod.precoIfood),
    custoDireto: toNum(prod.custoDireto),
    fornecedor:  prod.fornecedor  || '',
    whatsapp:    prod.whatsapp    || '',
    linkCompra:  prod.linkCompra  || '',
  }
  try {
    await supabase.from('produtos').update({ composicao, custo_total: efectivoCusto }).eq('id', prodId)
  } catch (_) { /* composicao column may not exist yet — harmless */ }

  // Junction tables — skip gracefully if migration3.sql not yet run
  try {
    if (prod.id) {
      await supabase.from('produto_receitas').delete().eq('produto_id', prod.id)
      await supabase.from('produto_embalagens').delete().eq('produto_id', prod.id)
    }
    if (receitaItems.length > 0) {
      const { error } = await supabase.from('produto_receitas').insert(
        receitaItems.map(r => ({ produto_id: prodId, receita_id: r.receitaId, quantidade: parseFloat(r.quantidade) || 1 }))
      )
      if (error) throw error
    }
    if (embalagemItems.length > 0) {
      const { error } = await supabase.from('produto_embalagens').insert(
        embalagemItems.map(e => ({ produto_id: prodId, embalagem_id: e.embalagemId, quantidade: parseFloat(e.quantidade) || 1 }))
      )
      if (error) throw error
    }
  } catch (e) {
    if (!e.message?.includes('produto_receitas') && !e.message?.includes('produto_embalagens')) throw e
  }
}

export async function updateEstoqueProdutos(items) {
  await Promise.all(
    items.map(({ id, estoqueAtual }) =>
      supabase.from('produtos').update({ estoque_atual: estoqueAtual }).eq('id', id)
    )
  )
}

export async function updateEstoqueMinProdutos(items) {
  await Promise.all(
    items.map(({ id, estoqueMin }) =>
      supabase.from('produtos').update({ estoque_min: parseFloat(estoqueMin) || 0 }).eq('id', id)
    )
  )
}

export async function updateEstoqueMinInsumos(items) {
  await Promise.all(
    items.map(({ id, estoqueMin }) =>
      supabase.from('insumos').update({ estoque_min: parseFloat(estoqueMin) || 0 }).eq('id', id)
    )
  )
}

export async function updateEstoqueMinEmbalagens(items) {
  await Promise.all(
    items.map(({ id, estoqueMin }) =>
      supabase.from('embalagens').update({ estoque_min: parseFloat(estoqueMin) || 0 }).eq('id', id)
    )
  )
}

export async function adjustEstoqueProduto(id, delta) {
  const { data } = await supabase.from('produtos').select('estoque_atual').eq('id', id).single()
  const atual = data?.estoque_atual ?? 0
  await supabase.from('produtos').update({ estoque_atual: Math.max(0, atual + delta) }).eq('id', id)
}

export async function deleteProduto(id) {
  const { error } = await supabase.from('produtos').delete().eq('id', id)
  if (error) throw error
}

// ── Clientes ──────────────────────────────────────────────────

export async function getClientes() {
  const { data, error } = await supabase.from('clientes').select('*').order('nome')
  if (error && error.message?.includes('does not exist')) return []
  if (error) throw error
  return data.map(r => ({ id: r.id, nome: r.nome, telefone: r.telefone || '', obs: r.obs || '' }))
}

export async function saveCliente(cliente) {
  const { error } = await supabase.from('clientes').insert({ nome: cliente.nome, telefone: cliente.telefone || '', obs: cliente.obs || '' })
  if (error && !error.message?.includes('does not exist')) throw error
}

// ── Encomendas ────────────────────────────────────────────────

export async function getEncomendas() {
  const { data, error } = await supabase
    .from('encomendas')
    .select('*, encomenda_itens(*)')
    .order('data_entrega', { ascending: true })
  if (error) throw error
  return data.map(r => ({
    id: r.id,
    dataEntrega: r.data_entrega,
    cliente: r.cliente,
    contato: r.contato || '',
    canal: r.canal || 'WhatsApp',
    endereco: r.endereco || '',
    embalagem: r.embalagem || '',
    valor: r.valor || 0,
    sinal: r.sinal || 0,
    saldo: r.valor - (r.sinal || 0),
    pgto: r.pgto || 'Aguardando',
    status: r.status || 'Pendente',
    obs: r.obs || '',
    tipoEntrega: r.tipo_entrega || 'Retirada',
    frete: r.frete || 0,
    itens: (r.encomenda_itens || []).map(i => ({
      id: i.id,
      produto: i.produto,
      quantidade: i.quantidade,
      precoUnit: i.preco_unit,
    })),
  }))
}

export async function savePedido(pedido, itens) {
  const { data: last } = await supabase
    .from('encomendas')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(1)

  let nextNum = 1
  if (last?.length > 0) {
    const match = last[0].id.match(/PED-(\d+)/)
    if (match) nextNum = parseInt(match[1]) + 1
  }
  const id = `PED-${String(nextNum).padStart(3, '0')}`

  const frete = parseFloat(pedido.frete) || 0
  const itensTotal = itens.reduce(
    (s, it) => s + (parseFloat(it.precoUnit) || 0) * (parseFloat(it.quantidade) || 1), 0
  )
  const total = itensTotal + (pedido.tipoEntrega === 'Entrega' ? frete : 0)

  const row = {
    id,
    data_entrega: pedido.dataEntrega,
    cliente: pedido.cliente,
    contato: pedido.contato || '',
    canal: pedido.canal || 'WhatsApp',
    endereco: pedido.endereco || '',
    embalagem: pedido.embalagem || '',
    valor: total,
    sinal: parseFloat(pedido.sinal) || 0,
    pgto: pedido.pgto || 'Aguardando',
    status: pedido.status || 'Pendente',
    obs: pedido.obs || '',
    tipo_entrega: pedido.tipoEntrega || 'Retirada',
    frete,
  }

  // Graceful fallback if migration15 not yet run
  const tryInsert = async (r) => supabase.from('encomendas').insert(r)
  let { error } = await tryInsert(row)
  if (error?.message?.includes('tipo_entrega') || error?.message?.includes('frete')) {
    const { tipo_entrega: _t, frete: _f, ...rowFallback } = row
    const res = await tryInsert(rowFallback)
    error = res.error
  }
  if (error) throw error

  if (itens.length > 0) {
    const { error: ie } = await supabase.from('encomenda_itens').insert(
      itens.map(it => ({
        encomenda_id: id,
        produto: it.produto,
        quantidade: parseFloat(it.quantidade) || 1,
        preco_unit: parseFloat(it.precoUnit) || 0,
      }))
    )
    if (ie) throw ie
  }
  return id
}

export async function deletePedido(id) {
  await supabase.from('encomenda_itens').delete().eq('encomenda_id', id)
  const { error } = await supabase.from('encomendas').delete().eq('id', id)
  if (error) throw error
}

export async function updateStatusEncomenda(id, status, pgto, tipoEntrega, frete, valor) {
  const update = { status, pgto }
  if (tipoEntrega !== undefined) update.tipo_entrega = tipoEntrega
  if (frete !== undefined) update.frete = parseFloat(frete) || 0
  if (valor !== undefined) update.valor = valor
  const { error } = await supabase.from('encomendas').update(update).eq('id', id)
  if (error) {
    if (error.message?.includes('tipo_entrega') || error.message?.includes('frete')) {
      const { tipo_entrega: _t, frete: _f, ...reduced } = update
      const { error: e2 } = await supabase.from('encomendas').update(reduced).eq('id', id)
      if (e2) throw e2
    } else {
      throw error
    }
  }
}

// ── Receitas ──────────────────────────────────────────────────

const TIPO_ORDER = ['Bolo', 'Torta', 'Massa', 'Recheio', 'Cobertura', 'Base', 'Produto Final', 'Outro']

export async function getReceitas() {
  const [recRes, ingRes] = await Promise.all([
    supabase.from('receitas').select('*').order('nome'),
    supabase.from('receita_ingredientes').select('*'),
  ])
  if (recRes.error) throw recRes.error
  if (ingRes.error) throw ingRes.error

  const ingsByReceita = {}
  for (const i of (ingRes.data || [])) {
    if (!ingsByReceita[i.receita_id]) ingsByReceita[i.receita_id] = []
    ingsByReceita[i.receita_id].push(i)
  }

  return (recRes.data || [])
    .map(r => ({
      id: r.id,
      nome: r.nome,
      nomeReceita: r.nome,
      tipo: r.tipo || 'Outro',
      rendimento: r.rendimento || 0,
      unidadeGera: r.unidade_gera || 'un',
      custoTotal: r.custo_total || 0,
      custoUnid: r.custo_unid || 0,
      pesoLiquido: r.peso_liquido || null,
      fatorPerda: r.fator_perda ?? null,
      instrucoes: r.instrucoes || '',
      tempoForno: r.tempo_forno ?? null,
      tempForno: r.temp_forno ?? null,
      tempoResfriamento: r.tempo_resfriamento ?? null,
      tipoResfriamento: r.tipo_resfriamento ?? null,
      ingredientes: (ingsByReceita[r.id] || []).map(i => ({
        id: i.id,
        insumoId: i.insumo_id || null,
        subReceitaId: i.sub_receita_id || null,
        nome: i.insumo_nome,
        quantidade: i.quantidade || 0,
        unidade: i.unidade || 'g',
      })),
    }))
    .sort((a, b) => {
      const ia = TIPO_ORDER.indexOf(a.tipo) >= 0 ? TIPO_ORDER.indexOf(a.tipo) : 99
      const ib = TIPO_ORDER.indexOf(b.tipo) >= 0 ? TIPO_ORDER.indexOf(b.tipo) : 99
      return ia !== ib ? ia - ib : a.nome.localeCompare(b.nome, 'pt-BR')
    })
}

export async function saveReceita(receita, ingredientes) {
  const row = {
    nome: receita.nome,
    tipo: receita.tipo || 'Outro',
    rendimento: parseFloat(receita.rendimento) || 0,
    unidade_gera: receita.unidadeGera || 'un',
    peso_liquido: receita.pesoLiquido ? parseFloat(receita.pesoLiquido) : null,
    fator_perda: receita.fatorPerda != null && receita.fatorPerda !== '' ? parseFloat(receita.fatorPerda) : null,
    instrucoes: receita.instrucoes || null,
    tempo_forno: receita.tempoForno != null && receita.tempoForno !== '' ? parseInt(receita.tempoForno) : null,
    temp_forno: receita.tempForno != null && receita.tempForno !== '' ? parseInt(receita.tempForno) : null,
    tempo_resfriamento: receita.tempoResfriamento != null && receita.tempoResfriamento !== '' ? parseInt(receita.tempoResfriamento) : null,
    tipo_resfriamento: receita.tipoResfriamento || null,
    custo_total: parseFloat(receita.custoTotal) || 0,
    custo_unid: parseFloat(receita.custoUnid) || 0,
  }

  const buildIngRow = (receitaId, i) => ({
    receita_id: receitaId,
    ...(i.insumoId     ? { insumo_id:      i.insumoId }     : {}),
    ...(i.subReceitaId ? { sub_receita_id: i.subReceitaId } : {}),
    insumo_nome: i.nome,
    quantidade: parseFloat(i.quantidade) || 0,
    unidade: i.unidade || 'g',
  })

  const insertIngs = async (receitaId) => {
    if (!ingredientes.length) return
    const { error } = await supabase.from('receita_ingredientes').insert(
      ingredientes.map(i => buildIngRow(receitaId, i))
    )
    if (error) {
      if (error.message?.includes('insumo_id') || error.message?.includes('sub_receita_id')) {
        const { error: e2 } = await supabase.from('receita_ingredientes').insert(
          ingredientes.map(i => ({
            receita_id: receitaId,
            insumo_nome: i.nome,
            quantidade: parseFloat(i.quantidade) || 0,
            unidade: i.unidade || 'g',
          }))
        )
        if (e2) throw e2
      } else {
        throw error
      }
    }
  }

  const OPTIONAL = ['unidade_gera', 'peso_liquido', 'fator_perda', 'instrucoes', 'tempo_forno', 'temp_forno', 'tempo_resfriamento', 'tipo_resfriamento']

  if (receita.id) {
    await upsert('receitas', row, receita.id, OPTIONAL)
    await supabase.from('receita_ingredientes').delete().eq('receita_id', receita.id)
    await insertIngs(receita.id)
    return receita.id
  } else {
    const data = await upsert('receitas', row, null, OPTIONAL)
    await insertIngs(data.id)
    return data.id
  }
}

// ── Vendas ────────────────────────────────────────────────────

export async function getVendas() {
  try {
    const { data, error } = await supabase
      .from('vendas')
      .select('*')
      .order('data', { ascending: false })
    if (error) throw error
    return data.map(r => ({
      id: r.id,
      data: r.data,
      produtoNome: r.produto_nome,
      produtoId: r.produto_id,
      quantidade: r.quantidade,
      precoUnit: r.preco_unit,
      plataforma: r.plataforma || 'Direta',
      custoUnit: r.custo_unit || 0,
    }))
  } catch (e) {
    if (e.message?.includes('vendas')) return []
    throw e
  }
}

export async function saveVenda(venda) {
  const quantidade = parseFloat(venda.quantidade) || 1
  const { data, error } = await supabase.from('vendas').insert({
    data: venda.data,
    produto_nome: venda.produtoNome,
    produto_id: venda.produtoId || null,
    quantidade,
    preco_unit: parseFloat(venda.precoUnit) || 0,
    plataforma: venda.plataforma || 'Direta',
    custo_unit: parseFloat(venda.custoUnit) || 0,
  }).select().single()
  if (error) throw error
  // Deduct from product stock
  if (venda.produtoId) {
    try { await adjustEstoqueProduto(venda.produtoId, -quantidade) } catch (_) {}
  }
  return data.id
}

export async function deleteVenda(id) {
  const { error } = await supabase.from('vendas').delete().eq('id', id)
  if (error) throw error
}

export async function deleteReceita(id) {
  const { error } = await supabase.from('receitas').delete().eq('id', id)
  if (error) throw error
}

export async function deleteReceitas(ids) {
  const { error } = await supabase.from('receitas').delete().in('id', ids)
  if (error) throw error
}

// ── User Config ───────────────────────────────────────────────

export async function loadUserConfig() {
  try {
    const { data, error } = await supabase.from('user_config').select('config').single()
    if (error) return null
    return data?.config || null
  } catch { return null }
}

export async function saveUserConfig(config) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('user_config').upsert(
      { user_id: user.id, config, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
  } catch {}
}
