import { supabase } from '../lib/supabase'

// ── Insumos ───────────────────────────────────────────────────

export async function getInsumos() {
  const { data, error } = await supabase.from('insumos').select('*').order('nome')
  if (error) throw error
  return data.map(r => ({
    id: r.id,
    nome: r.nome,
    categoria: r.categoria || '',
    unidade: r.unidade || 'g',
    pesoEmb: r.peso_emb || 0,
    custoEmb: r.custo_emb || 0,
    pesoUn: r.peso_un ?? null,
    custoUnit: r.custo_unit || 0,
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
    categoria: insumo.categoria || '',
    unidade: insumo.unidade || 'g',
    peso_emb: pesoEmb,
    custo_emb: custoEmb,
    peso_un: pesoUn,
    custo_unit: custoUnit,
    estoque_atual: insumo.estoqueAtual !== '' ? parseFloat(insumo.estoqueAtual) : null,
    estoque_min: parseFloat(insumo.estoqueMin) || 0,
    fornecedor: insumo.fornecedor || '',
    telefone: insumo.telefone || '',
    whatsapp: insumo.whatsapp || '',
  }
  if (insumo.id) {
    const { error } = await supabase.from('insumos').update(row).eq('id', insumo.id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('insumos').insert(row)
    if (error) throw error
  }
}

export async function deleteInsumo(id) {
  const { error } = await supabase.from('insumos').delete().eq('id', id)
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
  if (emb.id) {
    const { error } = await supabase.from('embalagens').update(row).eq('id', emb.id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('embalagens').insert(row)
    if (error) throw error
  }
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

// ── Produtos ──────────────────────────────────────────────────

export async function getProdutos() {
  const { data, error } = await supabase
    .from('produtos')
    .select(`
      *,
      produto_receitas(*, receitas(nome, custo_unid)),
      produto_embalagens(*, embalagens(nome, custo_unit))
    `)
    .order('nome')

  if (error) {
    // Fallback if junction tables don't exist yet (migration2.sql not run)
    const { data: d2, error: e2 } = await supabase.from('produtos').select('*').order('nome')
    if (e2) throw e2
    return d2.map(r => ({
      id: r.id,
      nome: r.nome,
      custoTotal: r.custo_total || 0,
      precoSugerido: r.preco_sugerido || 0,
      precoPraticado: r.preco_praticado,
      receitas: [],
      embalagens: [],
    }))
  }

  return data.map(r => ({
    id: r.id,
    nome: r.nome,
    custoTotal: r.custo_total || 0,
    precoSugerido: r.preco_sugerido || 0,
    precoPraticado: r.preco_praticado,
    receitas: (r.produto_receitas || []).map(pr => ({
      id: pr.id,
      receitaId: pr.receita_id,
      nome: pr.receitas?.nome || '',
      quantidade: pr.quantidade || 1,
      custoUnid: pr.receitas?.custo_unid || 0,
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

  const row = {
    nome: prod.nome,
    custo_total: custoTotal,
    preco_sugerido: parseFloat(prod.precoSugerido) || 0,
    preco_praticado: prod.precoPraticado !== '' && prod.precoPraticado != null
      ? parseFloat(prod.precoPraticado) : null,
  }

  let prodId = prod.id
  if (prod.id) {
    const { error } = await supabase.from('produtos').update(row).eq('id', prod.id)
    if (error) throw error
    await supabase.from('produto_receitas').delete().eq('produto_id', prod.id)
    await supabase.from('produto_embalagens').delete().eq('produto_id', prod.id)
  } else {
    const { data, error } = await supabase.from('produtos').insert(row).select().single()
    if (error) throw error
    prodId = data.id
  }

  if (receitaItems.length > 0) {
    const { error } = await supabase.from('produto_receitas').insert(
      receitaItems.map(r => ({
        produto_id: prodId,
        receita_id: r.receitaId,
        quantidade: parseFloat(r.quantidade) || 1,
      }))
    )
    if (error) throw error
  }

  if (embalagemItems.length > 0) {
    const { error } = await supabase.from('produto_embalagens').insert(
      embalagemItems.map(e => ({
        produto_id: prodId,
        embalagem_id: e.embalagemId,
        quantidade: parseFloat(e.quantidade) || 1,
      }))
    )
    if (error) throw error
  }
}

export async function deleteProduto(id) {
  const { error } = await supabase.from('produtos').delete().eq('id', id)
  if (error) throw error
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

  const total = itens.reduce(
    (s, it) => s + (parseFloat(it.precoUnit) || 0) * (parseFloat(it.quantidade) || 1), 0
  )

  const { error } = await supabase.from('encomendas').insert({
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
  })
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

export async function updateStatusEncomenda(id, status, pgto) {
  const { error } = await supabase
    .from('encomendas')
    .update({ status, pgto })
    .eq('id', id)
  if (error) throw error
}

// ── Receitas ──────────────────────────────────────────────────

const TIPO_ORDER = ['Bolo', 'Torta', 'Massa', 'Recheio', 'Cobertura', 'Base', 'Produto Final', 'Outro']

export async function getReceitas() {
  const { data, error } = await supabase
    .from('receitas')
    .select('*, receita_ingredientes(*)')
    .order('nome')
  if (error) throw error
  return data
    .map(r => ({
      id: r.id,
      nome: r.nome,
      nomeReceita: r.nome,
      tipo: r.tipo || 'Outro',
      rendimento: r.rendimento || 0,
      unidadeGera: r.unidade_gera || 'un',
      custoTotal: r.custo_total || 0,
      custoUnid: r.custo_unid || 0,
      ingredientes: (r.receita_ingredientes || []).map(i => ({
        id: i.id,
        insumoId: i.insumo_id || null,
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
    custo_total: parseFloat(receita.custoTotal) || 0,
    custo_unid: parseFloat(receita.custoUnid) || 0,
  }

  const buildIngRow = (receitaId, i, withInsumoId) => ({
    receita_id: receitaId,
    ...(withInsumoId ? { insumo_id: i.insumoId || null } : {}),
    insumo_nome: i.nome,
    quantidade: parseFloat(i.quantidade) || 0,
    unidade: i.unidade || 'g',
  })

  const insertIngs = async (receitaId) => {
    if (!ingredientes.length) return
    const { error } = await supabase.from('receita_ingredientes').insert(
      ingredientes.map(i => buildIngRow(receitaId, i, true))
    )
    if (error) {
      if (error.message?.includes('insumo_id')) {
        // Migration not yet run — save without insumo_id
        const { error: e2 } = await supabase.from('receita_ingredientes').insert(
          ingredientes.map(i => buildIngRow(receitaId, i, false))
        )
        if (e2) throw e2
      } else {
        throw error
      }
    }
  }

  const saveRow = async (id) => {
    const op = id
      ? supabase.from('receitas').update(row).eq('id', id)
      : supabase.from('receitas').insert(row).select().single()
    const { data, error } = await op
    if (error) {
      if (error.message?.includes('unidade_gera')) {
        const { unidade_gera, ...rowFallback } = row
        const op2 = id
          ? supabase.from('receitas').update(rowFallback).eq('id', id)
          : supabase.from('receitas').insert(rowFallback).select().single()
        const { data: d2, error: e2 } = await op2
        if (e2) throw e2
        return d2
      }
      throw error
    }
    return data
  }

  if (receita.id) {
    await saveRow(receita.id)
    await supabase.from('receita_ingredientes').delete().eq('receita_id', receita.id)
    await insertIngs(receita.id)
    return receita.id
  } else {
    const data = await saveRow(null)
    await insertIngs(data.id)
    return data.id
  }
}

export async function deleteReceita(id) {
  const { error } = await supabase.from('receitas').delete().eq('id', id)
  if (error) throw error
}
