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
    imagemUrl: r.imagem_url || null,
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
    imagem_url: insumo.imagemUrl ?? undefined,
  }
  const data = await upsert('insumos', row, insumo.id || null, ['link_compra', 'marca', 'imagem_url'])
  if (data?.id && custoUnit > 0) {
    snapshotInsumoCost(data.id, custoUnit).catch(() => {})
  }
  // Propagate name change to all receita_ingredientes that reference this insumo.
  if (insumo.id && insumo.nome) {
    supabase.from('receita_ingredientes').update({ insumo_nome: insumo.nome }).eq('insumo_id', insumo.id).then(() => {})
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
  const data = await upsert('embalagens', row, emb.id || null, ['link_compra'])
  return data
}

export async function getEmbalagemFornecedores(embId) {
  const { data, error } = await supabase.from('embalagem_fornecedores').select('*').eq('embalagem_id', embId).order('id')
  if (error?.code === '42P01') return []
  if (error) throw error
  return (data || []).map(f => ({
    id: f.id,
    embalagemId: f.embalagem_id,
    fornecedor: f.fornecedor || '',
    qtdCompra: f.qtd_compra || 0,
    custoCompra: f.custo_compra || 0,
    custoUnit: f.custo_unit || 0,
    linkCompra: f.link_compra || '',
    telefone: f.telefone || '',
  }))
}

export async function saveEmbalagemFornecedores(embId, fontes, mainCustoUnit = 0) {
  const { error: delErr } = await supabase.from('embalagem_fornecedores').delete().eq('embalagem_id', embId)
  if (delErr?.code !== '42P01' && delErr) throw delErr

  const valid = fontes.filter(f => f.fornecedor || parseFloat(f.custoCompra) > 0)
  if (valid.length === 0) return

  const rows = valid.map(f => {
    const qtdCompra  = parseFloat(f.qtdCompra)  || 0
    const custoCompra = parseFloat(f.custoCompra) || 0
    const custoUnit = qtdCompra > 0 ? custoCompra / qtdCompra : 0
    return { embalagem_id: embId, fornecedor: f.fornecedor || '', qtd_compra: qtdCompra, custo_compra: custoCompra, custo_unit: custoUnit, link_compra: f.linkCompra || '', telefone: f.telefone || '' }
  })

  const { error: insErr } = await supabase.from('embalagem_fornecedores').insert(rows)
  if (insErr?.code !== '42P01' && insErr) throw insErr

  const priority = rows.find(r => r.custo_unit > 0)
  const effectiveCost = priority ? priority.custo_unit : (mainCustoUnit > 0 ? mainCustoUnit : null)
  if (effectiveCost != null) {
    await supabase.from('embalagens').update({ custo_unit: effectiveCost }).eq('id', embId)
  }
}

export async function getAllEmbalagemFornecedores() {
  const { data, error } = await supabase.from('embalagem_fornecedores').select('*')
  if (error?.code === '42P01') return []
  if (error) throw error
  return (data || []).map(f => ({
    id: f.id,
    embalagemId: f.embalagem_id,
    fornecedor: f.fornecedor || '',
    qtdCompra: f.qtd_compra || 0,
    custoCompra: f.custo_compra || 0,
    custoUnit: f.custo_unit || 0,
    linkCompra: f.link_compra || '',
    telefone: f.telefone || '',
  }))
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
      imagemUrl:   r.imagem_url || null,
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
    descricao:    r.descricao   || '',
    secao:        r.secao       || '',
    estoqueAtual: r.estoque_atual ?? null,
    estoqueMin:   r.estoque_min  ?? 0,
    imagemUrl:   r.imagem_url || null,
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
    imagem_url:     prod.imagemUrl ?? undefined,
    descricao:      prod.descricao ?? undefined,
    secao:          prod.secao     ?? undefined,
  }

  const saved = await upsert('produtos', row, prod.id || null,
    ['preco_direta', 'preco_99', 'preco_ifood', 'custo_direto', 'tipo', 'fornecedor', 'whatsapp', 'link_compra', 'estoque_min', 'imagem_url'])
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

export async function bulkUpdateSecoes(items) {
  await Promise.all(
    items.map(({ id, secao }) =>
      supabase.from('produtos').update({ secao: secao || '' }).eq('id', id)
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
    dataPago: r.data_pago || null,
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
  if (pgto === 'Pago') update.data_pago = new Date().toISOString().split('T')[0]
  if (tipoEntrega !== undefined) update.tipo_entrega = tipoEntrega
  if (frete !== undefined) update.frete = parseFloat(frete) || 0
  if (valor !== undefined) update.valor = valor
  const { error } = await supabase.from('encomendas').update(update).eq('id', id)
  if (error) {
    if (error.message?.includes('tipo_entrega') || error.message?.includes('frete') || error.message?.includes('data_pago')) {
      const { tipo_entrega: _t, frete: _f, data_pago: _dp, ...reduced } = update
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
      porcoes: r.porcoes || null,
      pesoLiquido: r.peso_liquido || null,
      fatorPerda: r.fator_perda ?? null,
      instrucoes: r.instrucoes || '',
      tempoForno: r.tempo_forno ?? null,
      tempForno: r.temp_forno ?? null,
      tempoResfriamento: r.tempo_resfriamento ?? null,
      tipoResfriamento: r.tipo_resfriamento ?? null,
      imagemUrl: r.imagem_url || null,
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
    porcoes: receita.porcoes ? parseInt(receita.porcoes) : null,
    imagem_url: receita.imagemUrl ?? undefined,
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

  const OPTIONAL = ['unidade_gera', 'peso_liquido', 'fator_perda', 'instrucoes', 'tempo_forno', 'temp_forno', 'tempo_resfriamento', 'tipo_resfriamento', 'imagem_url']

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

// ── Produções ─────────────────────────────────────────────────

// ─── Mise en place v2 ─────────────────────────────────────────
// Calcula doses por receita a partir de um lote (produtos+receitas)
// e retorna { dosesPerReceita, perItemContrib }.
function computeDoses(lote, receitas, produtos) {
  const dosesPerReceita = {}            // receitaId -> total doses
  const perItemContrib  = lote.map(() => ({})) // [{receitaId: doses}, ...]

  lote.forEach((item, idx) => {
    if (item.tipo === 'produto') {
      const prod = (produtos || []).find(p => p.id === item.refId)
      if (!prod) return
      for (const recRef of (prod.receitas || [])) {
        const rec = (receitas || []).find(r => r.id === recRef.receitaId)
        if (!rec || !rec.rendimento) continue
        const amount = (recRef.quantidade || 1) * (item.qtd || 0)
        const d = amount / rec.rendimento
        dosesPerReceita[recRef.receitaId] = (dosesPerReceita[recRef.receitaId] || 0) + d
        perItemContrib[idx][recRef.receitaId] = (perItemContrib[idx][recRef.receitaId] || 0) + d
      }
    } else {
      // receita
      const rec = (receitas || []).find(r => r.id === item.refId)
      if (!rec || !rec.rendimento) return
      let d
      if (item.modo === 'peso_liquido' && rec.fatorPerda != null) {
        const bruto = (item.valorAlvo || 0) / (1 - rec.fatorPerda / 100)
        d = bruto / rec.rendimento
      } else if (item.modo === 'unidades') {
        d = (item.valorAlvo || 0) / rec.rendimento
      } else {
        d = item.qtd || 0
      }
      dosesPerReceita[item.refId] = (dosesPerReceita[item.refId] || 0) + d
      perItemContrib[idx][item.refId] = d
    }
  })
  return { dosesPerReceita, perItemContrib }
}

// Expande ingredientes de uma receita recursivamente (inclui subreceitas)
function expandIngredients(receitas, rec, doses, depth = 0) {
  if (depth > 5) return {}
  const debitos = {}
  for (const ing of (rec.ingredientes || [])) {
    if (ing.insumoId) {
      debitos[ing.insumoId] = (debitos[ing.insumoId] || 0) + ing.quantidade * doses
    } else if (ing.subReceitaId) {
      const subRec = (receitas || []).find(r => r.id === ing.subReceitaId)
      if (!subRec) continue
      const subBatches = (ing.quantidade * doses) / (subRec.rendimento || 1)
      const subDeb = expandIngredients(receitas, subRec, subBatches, depth + 1)
      for (const [id, q] of Object.entries(subDeb)) {
        debitos[id] = (debitos[id] || 0) + q
      }
    }
  }
  return debitos
}

// Calcula débito total de insumos a partir de doses por receita
function computeDebitos(dosesPerReceita, receitas) {
  const debitos = {}
  for (const [recIdStr, doses] of Object.entries(dosesPerReceita)) {
    const rec = (receitas || []).find(r => r.id === Number(recIdStr))
    if (!rec) continue
    const recDeb = expandIngredients(receitas, rec, doses)
    for (const [id, q] of Object.entries(recDeb)) {
      debitos[id] = (debitos[id] || 0) + q
    }
  }
  return debitos
}

function rendimentoLiquidoCalc(rec, doses) {
  const fp = rec?.fatorPerda || 0
  return doses * (rec?.rendimento || 0) * (1 - fp / 100)
}

async function aplicarDebitosInsumos(debitos, sinal = -1) {
  const ids = Object.keys(debitos).map(Number)
  if (!ids.length) return
  const { data } = await supabase.from('insumos').select('id, estoque_atual').in('id', ids)
  await Promise.all((data || []).map(ins => {
    const cur = ins.estoque_atual
    if (cur == null) return null  // sem controle de estoque
    const novo = sinal < 0
      ? Math.max(0, cur - (debitos[ins.id] || 0))
      : cur + (debitos[ins.id] || 0)
    return supabase.from('insumos').update({ estoque_atual: novo }).eq('id', ins.id)
  }))
}

async function ajustarEstoqueProduto(id, delta) {
  const { data } = await supabase.from('produtos').select('estoque_atual').eq('id', id).single()
  const cur = data?.estoque_atual
  const base = cur == null ? 0 : cur
  await supabase.from('produtos').update({ estoque_atual: Math.max(0, base + delta) }).eq('id', id)
}

async function ajustarEstoqueReceita(id, delta) {
  const { data } = await supabase.from('receitas').select('estoque_atual').eq('id', id).single()
  const cur = data?.estoque_atual
  const base = cur == null ? 0 : cur
  await supabase.from('receitas').update({ estoque_atual: Math.max(0, base + delta) }).eq('id', id)
}

export async function saveProducao(lote, receitas, produtos) {
  try {
    const { perItemContrib } = computeDoses(lote, receitas, produtos)

    const { data: prod, error } = await supabase.from('producoes').insert({ created_at: new Date().toISOString() }).select().single()
    if (error) throw error

    const itemsToInsert = lote.map((item, idx) => {
      const contribDoses = perItemContrib[idx]
      const itemDebitos = {}
      const debitosPorReceita = {}
      for (const [recIdStr, d] of Object.entries(contribDoses)) {
        const rec = receitas.find(r => r.id === Number(recIdStr))
        if (!rec) continue
        const recDeb = expandIngredients(receitas, rec, d)
        for (const [insId, q] of Object.entries(recDeb)) {
          itemDebitos[insId] = (itemDebitos[insId] || 0) + q
        }
        debitosPorReceita[recIdStr] = recDeb
      }

      let credito = null
      if (item.tipo === 'produto') {
        credito = { tipo: 'produto', id: item.refId, qtd: item.qtd }
      } else {
        const rec = receitas.find(r => r.id === item.refId)
        let qtdCredit
        if (item.modo === 'peso_liquido') qtdCredit = item.valorAlvo || 0
        else if (item.modo === 'unidades') qtdCredit = item.valorAlvo || 0
        else qtdCredit = rendimentoLiquidoCalc(rec, item.qtd || 0)
        credito = { tipo: 'receita', id: item.refId, qtd: qtdCredit }
      }

      const hasReceitas = Object.keys(contribDoses).length > 0
      const snapshot = {
        debitos: itemDebitos,
        credito,
        dosesContrib: contribDoses,
        debitosPorReceita,
        creditoAplicadoNaCriacao: !hasReceitas,
      }

      if (item.tipo === 'produto') {
        return {
          producao_id: prod.id,
          tipo: 'produto',
          produto_id: item.refId,
          produto_nome: item.nome,
          quantidade: item.qtd,
          snapshot,
        }
      } else {
        const rec = receitas.find(r => r.id === item.refId)
        let rendTotal
        if (item.modo === 'peso_liquido') rendTotal = item.valorAlvo
        else if (item.modo === 'unidades') rendTotal = item.valorAlvo
        else rendTotal = (item.qtd || 0) * (rec?.rendimento || 0)
        return {
          producao_id: prod.id,
          tipo: 'receita',
          receita_id: item.refId,
          receita_nome: item.nome,
          quantidade: item.qtd,
          modo: item.modo || 'doses',
          valor_alvo: item.valorAlvo ?? null,
          rendimento_total: rendTotal,
          unidade_gera: rec?.unidadeGera || 'un',
          snapshot,
        }
      }
    })

    const { error: insErr } = await supabase.from('producao_itens').insert(itemsToInsert)
    if (insErr) throw insErr

    // Itens sem receitas (avulsos): crédito aplicado imediatamente
    for (let idx = 0; idx < lote.length; idx++) {
      const item = lote[idx]
      const hasReceitas = Object.keys(perItemContrib[idx]).length > 0
      if (!hasReceitas && item.tipo === 'produto') {
        await ajustarEstoqueProduto(item.refId, item.qtd || 0)
      }
    }

    return prod.id
  } catch (e) {
    if (e?.code === '42P01' || e?.message?.includes('producoes')) return null
    throw e
  }
}

export async function addProducaoItens(producaoId, lote, receitas, produtos) {
  const { perItemContrib } = computeDoses(lote, receitas, produtos)

  const itemsToInsert = lote.map((item, idx) => {
    const contribDoses = perItemContrib[idx]
    const itemDebitos = {}
    const debitosPorReceita = {}
    for (const [recIdStr, d] of Object.entries(contribDoses)) {
      const rec = receitas.find(r => r.id === Number(recIdStr))
      if (!rec) continue
      const recDeb = expandIngredients(receitas, rec, d)
      for (const [insId, q] of Object.entries(recDeb)) {
        itemDebitos[insId] = (itemDebitos[insId] || 0) + q
      }
      debitosPorReceita[recIdStr] = recDeb
    }

    let credito = null
    if (item.tipo === 'produto') {
      credito = { tipo: 'produto', id: item.refId, qtd: item.qtd }
    } else {
      const rec = receitas.find(r => r.id === item.refId)
      let qtdCredit
      if (item.modo === 'peso_liquido') qtdCredit = item.valorAlvo || 0
      else if (item.modo === 'unidades') qtdCredit = item.valorAlvo || 0
      else qtdCredit = rendimentoLiquidoCalc(rec, item.qtd || 0)
      credito = { tipo: 'receita', id: item.refId, qtd: qtdCredit }
    }

    const hasReceitas = Object.keys(contribDoses).length > 0
    const snapshot = {
      debitos: itemDebitos, credito, dosesContrib: contribDoses,
      debitosPorReceita, creditoAplicadoNaCriacao: !hasReceitas,
    }

    if (item.tipo === 'produto') {
      return { producao_id: producaoId, tipo: 'produto', produto_id: item.refId, produto_nome: item.nome, quantidade: item.qtd, snapshot }
    } else {
      const rec = receitas.find(r => r.id === item.refId)
      let rendTotal
      if (item.modo === 'peso_liquido') rendTotal = item.valorAlvo
      else if (item.modo === 'unidades') rendTotal = item.valorAlvo
      else rendTotal = (item.qtd || 0) * (rec?.rendimento || 0)
      return { producao_id: producaoId, tipo: 'receita', receita_id: item.refId, receita_nome: item.nome, quantidade: item.qtd, modo: item.modo || 'doses', valor_alvo: item.valorAlvo ?? null, rendimento_total: rendTotal, unidade_gera: rec?.unidadeGera || 'un', snapshot }
    }
  })

  const { error } = await supabase.from('producao_itens').insert(itemsToInsert)
  if (error) throw error

  for (let idx = 0; idx < lote.length; idx++) {
    const item = lote[idx]
    const hasReceitas = Object.keys(perItemContrib[idx]).length > 0
    if (!hasReceitas && item.tipo === 'produto') await ajustarEstoqueProduto(item.refId, item.qtd || 0)
  }
}

export async function updateProducaoItemQtd(itemId, quantidade, valorAlvo) {
  const upd = { quantidade }
  if (valorAlvo !== undefined) upd.valor_alvo = valorAlvo
  const { error } = await supabase.from('producao_itens').update(upd).eq('id', itemId)
  if (error) throw error
}

// Detecta se item foi salvo no formato novo (estoque dirigido por checks)
function isItemNovoFormato(item) {
  return item?.snapshot && item.snapshot.debitosPorReceita != null
}

function itemCompleto(item, checksSet) {
  const dosesContrib = item.snapshot?.dosesContrib || {}
  const recIds = Object.keys(dosesContrib)
  if (recIds.length === 0) return true
  return recIds.every(rid => checksSet.has(String(rid)))
}

async function aplicarDebitosDeReceita(item, recIdStr, sinal) {
  const debitos = item.snapshot?.debitosPorReceita?.[recIdStr]
  if (debitos) await aplicarDebitosInsumos(debitos, sinal)
}

async function aplicarCreditoItem(item, sinal) {
  const credito = item.snapshot?.credito
  if (!credito) return
  const delta = sinal * (credito.qtd || 0)
  if (credito.tipo === 'produto') await ajustarEstoqueProduto(credito.id, delta)
  else if (credito.tipo === 'receita') await ajustarEstoqueReceita(credito.id, delta)
}

// Calcula ajustes pendentes (não aplicados) a partir das produções:
// - Débitos de receitas não checkadas (consumo futuro de insumos)
// - Créditos de itens não-completos (produção futura de produtos/receitas)
// Retorna deltas a serem somados ao estoque atual para obter o "futuro".
export function computeAjustesPendentes(producoes) {
  const insumos = {}, produtos = {}, receitas = {}
  for (const p of (producoes || [])) {
    const checkSet = new Set((p.checks || []).map(String))
    for (const item of (p.itens || [])) {
      const snap = item.snapshot
      if (!snap || !snap.debitosPorReceita) continue // legacy: já aplicado, não conta como pendente
      for (const [recIdStr, debs] of Object.entries(snap.debitosPorReceita)) {
        if (checkSet.has(recIdStr)) continue
        for (const [insId, q] of Object.entries(debs)) {
          insumos[insId] = (insumos[insId] || 0) - q
        }
      }
      const dosesContrib = snap.dosesContrib || {}
      const recIds = Object.keys(dosesContrib)
      const isComplete = recIds.length > 0 && recIds.every(rid => checkSet.has(String(rid)))
      if (!isComplete && !snap.creditoAplicadoNaCriacao && snap.credito) {
        const { tipo, id, qtd } = snap.credito
        if (tipo === 'produto') produtos[id] = (produtos[id] || 0) + (qtd || 0)
        else if (tipo === 'receita') receitas[id] = (receitas[id] || 0) + (qtd || 0)
      }
    }
  }
  return { insumos, produtos, receitas }
}

// Corrige retroativamente todos os producao_itens que ignoraram subreceitas.
// Aplica delta de débito de insumos para itens já checkados e atualiza snapshots.
export async function fixSubreceitasRetroativas() {
  const [producoes, receitas] = await Promise.all([
    getProducoes(1000),
    getReceitas(),
  ])

  const deltaInsumos = {}
  const updates = []

  for (const p of producoes) {
    const checksSet = new Set((p.checks || []).map(String))
    for (const item of p.itens) {
      const snap = item.snapshot
      if (!snap?.debitosPorReceita || !snap?.dosesContrib) continue

      const newDebitosPorReceita = {}
      let changed = false

      for (const [recIdStr, oldDeb] of Object.entries(snap.debitosPorReceita)) {
        const rec = receitas.find(r => r.id === Number(recIdStr))
        if (!rec) { newDebitosPorReceita[recIdStr] = oldDeb; continue }

        const doses = snap.dosesContrib[recIdStr] || 0
        const newDeb = expandIngredients(receitas, rec, doses)
        newDebitosPorReceita[recIdStr] = newDeb

        if (checksSet.has(recIdStr)) {
          // recipe already debited — compute delta to apply
          const allIds = new Set([...Object.keys(newDeb), ...Object.keys(oldDeb || {})])
          for (const insId of allIds) {
            const diff = (newDeb[insId] || 0) - ((oldDeb || {})[insId] || 0)
            if (Math.abs(diff) > 0.0001) {
              deltaInsumos[insId] = (deltaInsumos[insId] || 0) + diff
              changed = true
            }
          }
        } else if (JSON.stringify(newDeb) !== JSON.stringify(oldDeb)) {
          changed = true
        }
      }

      if (changed) {
        const newTotalDebitos = {}
        for (const debs of Object.values(newDebitosPorReceita)) {
          for (const [insId, q] of Object.entries(debs)) {
            newTotalDebitos[insId] = (newTotalDebitos[insId] || 0) + q
          }
        }
        updates.push({ id: item.id, snapshot: { ...snap, debitos: newTotalDebitos, debitosPorReceita: newDebitosPorReceita } })
      }
    }
  }

  if (Object.keys(deltaInsumos).length > 0) await aplicarDebitosInsumos(deltaInsumos, -1)
  for (const upd of updates) {
    await supabase.from('producao_itens').update({ snapshot: upd.snapshot }).eq('id', upd.id)
  }
  return updates.length
}

export async function getProducoes(limit = 30) {
  try {
    const { data, error } = await supabase.from('producoes').select('*, producao_itens(*)').order('created_at', { ascending: false }).limit(limit)
    if (error) throw error
    return (data || []).map(p => ({
      id: p.id,
      createdAt: p.created_at,
      checks: Array.isArray(p.checks) ? p.checks : [],
      itens: (p.producao_itens || []).map(i => ({
        id: i.id,
        tipo: i.tipo || 'receita',
        receitaId: i.receita_id,
        produtoId: i.produto_id,
        nome: i.tipo === 'produto' ? (i.produto_nome || '') : (i.receita_nome || ''),
        quantidade: i.quantidade,
        modo: i.modo || 'doses',
        valorAlvo: i.valor_alvo,
        rendimentoTotal: i.rendimento_total,
        unidadeGera: i.unidade_gera || 'un',
        snapshot: i.snapshot || null,
      })),
    }))
  } catch (e) {
    if (e?.message?.includes('producoes')) return []
    return []
  }
}

async function reverterSnapshot(snap) {
  if (!snap) return
  if (snap.debitos && Object.keys(snap.debitos).length) {
    await aplicarDebitosInsumos(snap.debitos, +1)
  }
  if (snap.credito) {
    const delta = -(snap.credito.qtd || 0)
    if (snap.credito.tipo === 'produto') await ajustarEstoqueProduto(snap.credito.id, delta)
    else if (snap.credito.tipo === 'receita') await ajustarEstoqueReceita(snap.credito.id, delta)
  }
}

// Recomputa snapshot a partir dos dados do item + receitas/produtos atuais
// Usado como fallback quando o item não tem snapshot salvo (migração antiga)
async function rebuildSnapshot(item) {
  const { data: receitas } = await supabase.from('receitas').select('*, receita_ingredientes(*)')
  const recs = (receitas || []).map(r => ({
    id: r.id,
    rendimento: r.rendimento || 1,
    fatorPerda: r.fator_perda,
    ingredientes: (r.receita_ingredientes || []).map(i => ({ insumoId: i.insumo_id, quantidade: i.quantidade })),
  }))

  let dosesContrib = {}
  let credito = null

  if (item.tipo === 'produto' && item.produto_id) {
    const { data: prs } = await supabase.from('produto_receitas').select('*').eq('produto_id', item.produto_id)
    for (const pr of (prs || [])) {
      const rec = recs.find(r => r.id === pr.receita_id)
      if (!rec) continue
      const d = ((pr.quantidade || 1) * (item.quantidade || 0)) / rec.rendimento
      dosesContrib[pr.receita_id] = (dosesContrib[pr.receita_id] || 0) + d
    }
    credito = { tipo: 'produto', id: item.produto_id, qtd: item.quantidade || 0 }
  } else if (item.receita_id) {
    const rec = recs.find(r => r.id === item.receita_id)
    let d = 0
    if (rec) {
      if (item.modo === 'peso_liquido' && rec.fatorPerda != null) d = (item.valor_alvo || 0) / (1 - rec.fatorPerda / 100) / rec.rendimento
      else if (item.modo === 'unidades') d = (item.valor_alvo || 0) / rec.rendimento
      else d = item.quantidade || 0
      dosesContrib[item.receita_id] = d
    }
    let qtdCredit
    if (item.modo === 'peso_liquido' || item.modo === 'unidades') qtdCredit = item.valor_alvo || 0
    else qtdCredit = rec ? d * rec.rendimento * (1 - (rec.fatorPerda || 0) / 100) : 0
    credito = { tipo: 'receita', id: item.receita_id, qtd: qtdCredit }
  }

  const debitos = {}
  for (const [recIdStr, d] of Object.entries(dosesContrib)) {
    const rec = recs.find(r => r.id === Number(recIdStr))
    if (!rec) continue
    for (const ing of rec.ingredientes) {
      if (ing.insumoId) debitos[ing.insumoId] = (debitos[ing.insumoId] || 0) + ing.quantidade * d
    }
  }
  return { debitos, credito, dosesContrib }
}

// Reverte do estoque apenas o que JÁ FOI APLICADO para este item, considerando os checks atuais
async function reverterAplicado(item, checks) {
  if (!item?.snapshot) return
  if (!isItemNovoFormato(item)) {
    // Legacy: snapshot aplicado integralmente na criação → reverte tudo
    return reverterSnapshot(item.snapshot)
  }
  const checkSet = new Set((checks || []).map(String))
  // Reverte débitos das receitas marcadas como concluídas
  for (const recIdStr of Object.keys(item.snapshot.debitosPorReceita || {})) {
    if (checkSet.has(recIdStr)) {
      await aplicarDebitosDeReceita(item, recIdStr, +1)
    }
  }
  // Reverte crédito se aplicado (item completo, ou avulso já aplicado na criação)
  if (item.snapshot.creditoAplicadoNaCriacao || itemCompleto(item, checkSet)) {
    await aplicarCreditoItem(item, -1)
  }
}

export async function deleteProducaoItem(itemId) {
  const { data } = await supabase.from('producao_itens').select('*, producoes(checks)').eq('id', itemId).single()
  if (data) {
    if (isItemNovoFormato(data)) {
      const checks = Array.isArray(data.producoes?.checks) ? data.producoes.checks : []
      await reverterAplicado(data, checks)
    } else {
      const snap = data.snapshot || await rebuildSnapshot(data)
      await reverterSnapshot(snap)
    }
  }
  await supabase.from('producao_itens').delete().eq('id', itemId)
}

export async function getProducao(id) {
  const { data, error } = await supabase.from('producoes').select('*, producao_itens(*)').eq('id', id).single()
  if (error) return null
  return {
    id: data.id,
    createdAt: data.created_at,
    checks: Array.isArray(data.checks) ? data.checks : [],
    itens: (data.producao_itens || []).map(i => ({
      id: i.id,
      tipo: i.tipo || 'receita',
      receitaId: i.receita_id,
      produtoId: i.produto_id,
      nome: i.tipo === 'produto' ? (i.produto_nome || '') : (i.receita_nome || ''),
      quantidade: i.quantidade,
      modo: i.modo || 'doses',
      valorAlvo: i.valor_alvo,
      rendimentoTotal: i.rendimento_total,
      unidadeGera: i.unidade_gera || 'un',
      snapshot: i.snapshot || null,
    })),
  }
}

export async function updateProducaoChecks(id, newChecks) {
  // Busca estado atual
  const { data: prod, error } = await supabase
    .from('producoes')
    .select('checks, producao_itens(*)')
    .eq('id', id)
    .single()
  if (error) throw error

  const oldChecks = Array.isArray(prod.checks) ? prod.checks : []
  const oldSet = new Set(oldChecks.map(String))
  const newSet = new Set((newChecks || []).map(String))

  const added = [...newSet].filter(r => !oldSet.has(r))
  const removed = [...oldSet].filter(r => !newSet.has(r))

  for (const item of (prod.producao_itens || [])) {
    if (!isItemNovoFormato(item)) continue // legacy: estoque já aplicado na criação

    // Aplica débitos das receitas adicionadas, reverte das removidas
    for (const rec of added) await aplicarDebitosDeReceita(item, rec, -1)
    for (const rec of removed) await aplicarDebitosDeReceita(item, rec, +1)

    // Aplica/reverte crédito conforme item completou ou descompletou
    const wasComplete = itemCompleto(item, oldSet)
    const isComplete = itemCompleto(item, newSet)
    const creditoJaAplicadoNaCriacao = item.snapshot?.creditoAplicadoNaCriacao
    if (!creditoJaAplicadoNaCriacao) {
      if (!wasComplete && isComplete) await aplicarCreditoItem(item, +1)
      else if (wasComplete && !isComplete) await aplicarCreditoItem(item, -1)
    }
  }

  const { error: upErr } = await supabase.from('producoes').update({ checks: newChecks }).eq('id', id)
  if (upErr) throw upErr
}

export async function deleteProducao(id) {
  const { data: prod } = await supabase
    .from('producoes')
    .select('checks, producao_itens(*)')
    .eq('id', id)
    .single()
  const checks = Array.isArray(prod?.checks) ? prod.checks : []
  for (const item of (prod?.producao_itens || [])) {
    if (isItemNovoFormato(item)) {
      await reverterAplicado(item, checks)
    } else {
      const snap = item.snapshot || await rebuildSnapshot(item)
      await reverterSnapshot(snap)
    }
  }
  await supabase.from('producoes').delete().eq('id', id)
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

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .single()
  if (error && error.code !== 'PGRST116') throw error
  if (!data) return null
  return {
    nomeLoja: data.nome_loja || '',
    estado: data.estado || 'SP',
    canais: data.canais || ['direto'],
    onboardingDone: data.onboarding_done || false,
    checklistDismissed: data.checklist_dismissed || false,
  }
}

export async function upsertProfile(userId, profile) {
  const { error } = await supabase.from('profiles').upsert({
    user_id: userId,
    nome_loja: profile.nomeLoja || '',
    estado: profile.estado || 'SP',
    canais: profile.canais || ['direto'],
    onboarding_done: profile.onboardingDone || false,
    checklist_dismissed: profile.checklistDismissed || false,
  }, { onConflict: 'user_id' })
  if (error) throw error
}

export async function updateInsumoImagem(id, url) {
  await supabase.from('insumos').update({ imagem_url: url }).eq('id', id)
}

export async function updateReceitaImagem(id, url) {
  await supabase.from('receitas').update({ imagem_url: url }).eq('id', id)
}

export async function updateProdutoImagem(id, url) {
  await supabase.from('produtos').update({ imagem_url: url }).eq('id', id)
}

// ── Cardápio público ──────────────────────────────────────────

export async function saveCardapio({ nomeLoja, dados }) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Você precisa estar logado.')
  const { data, error } = await supabase.from('cardapios').upsert(
    { user_id: user.id, nome_loja: nomeLoja || '', dados, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' }
  ).select('id').single()
  if (error) throw error
  return data.id
}

export async function getCardapioPublico(id) {
  const { data, error } = await supabase
    .from('cardapios')
    .select('nome_loja, dados, updated_at')
    .eq('id', id)
    .single()
  if (error) return null
  return {
    nomeLoja: data.nome_loja || '',
    itens: data.dados?.itens || [],
    comFotos: data.dados?.comFotos !== false,
    updatedAt: data.updated_at,
  }
}

// ── Pedido Externo (público, sem auth) ────────────────────────

export async function getPublicProdutos(userId) {
  const { data, error } = await supabase
    .from('produtos')
    .select('id, nome, descricao, preco_direta, estoque_atual, imagem_url, tipo')
    .eq('user_id', userId)
    .gt('estoque_atual', 0)
    .order('nome')
  if (error) throw error
  return (data || []).map(r => ({
    id: r.id,
    nome: r.nome,
    descricao: r.descricao || '',
    precoDireta: r.preco_direta,
    estoqueAtual: r.estoque_atual,
    imagemUrl: r.imagem_url || null,
    tipo: r.tipo || 'produto',
  }))
}

export async function getPublicDeliveryConfig(userId) {
  try {
    const { data, error } = await supabase.rpc('get_delivery_config', { p_user_id: userId })
    if (error) return null
    return data || null
  } catch { return null }
}

export async function submitPedidoExterno(userId, form, carrinho, freteValor = 0) {
  const itens = carrinho.map(it => ({
    produto_id:   it.produto.id,
    produto_nome: it.produto.nome,
    quantidade:   it.qtd,
    preco_unit:   it.produto.precoDireta || 0,
  }))
  const { data, error } = await supabase.rpc('submit_pedido_externo', {
    p_user_id:     userId,
    p_cliente:     form.nome,
    p_contato:     form.telefone,
    p_tipo_entrega: form.tipoEntrega,
    p_endereco:    form.endereco || '',
    p_obs:         form.obs || '',
    p_itens:       itens,
    p_frete:       freteValor,
  })
  if (error) throw error
  return data
}
