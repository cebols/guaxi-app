// Linha do tempo do mise en place: ordena as receitas pela cadeia de dependência.
// O que está mais longe do produto final vem primeiro; cada receita fica na etapa
// logo antes de quem usa ela. Dentro da etapa, o mais usado vem primeiro.
//
// aProduzir: [{ id, chave, doses }]  (receitas desta produção, topo e internas)
// receitas:  lista completa (com ingredientes/subReceitaId)
// produtos:  [{ nome, receitas: [{ receitaId }] }] — produtos desta produção
export function montarLinhaDoTempo(aProduzir, receitas, produtos) {
  const recOf = id => (receitas || []).find(r => Number(r.id) === Number(id))
  const ids = new Set(aProduzir.map(x => Number(x.id)))
  const vaiEmReceitas = {}, vaiEmProdutos = {}, precisa = {}
  for (const id of ids) { vaiEmReceitas[id] = new Set(); vaiEmProdutos[id] = new Set(); precisa[id] = new Set() }

  for (const id of ids) {
    for (const ing of (recOf(id)?.ingredientes || [])) {
      const sid = Number(ing.subReceitaId)
      if (ing.subReceitaId && ids.has(sid) && sid !== id) { vaiEmReceitas[sid].add(id); precisa[id].add(sid) }
    }
  }
  for (const p of (produtos || [])) {
    for (const rr of (p.receitas || [])) {
      const rid = Number(rr.receitaId)
      if (ids.has(rid)) vaiEmProdutos[rid].add(p.nome)
    }
  }

  // distância até o fim da cadeia (0 = vai direto no produto, ou é receita solta)
  const dist = {}, visitando = new Set()
  const calc = (id) => {
    if (dist[id] != null) return dist[id]
    if (visitando.has(id)) return 0 // ciclo: corta
    visitando.add(id)
    let d = 0
    for (const pai of vaiEmReceitas[id]) d = Math.max(d, 1 + calc(pai))
    visitando.delete(id)
    return (dist[id] = d)
  }
  ids.forEach(calc)
  const maxDist = Math.max(0, ...Object.values(dist))

  const etapas = []
  for (let n = 1; n <= maxDist + 1; n++) etapas.push({ n, itens: [] })
  for (const x of aProduzir) {
    const id = Number(x.id)
    const rec = recOf(id)
    if (!rec) continue
    const n = maxDist - dist[id] + 1
    etapas[n - 1].itens.push({
      ...x, id, rec,
      vaiEm: [...[...vaiEmReceitas[id]].map(r => recOf(r)?.nome).filter(Boolean), ...vaiEmProdutos[id]],
      usos: vaiEmReceitas[id].size + vaiEmProdutos[id].size,
      precisa: [...precisa[id]],
    })
  }
  for (const e of etapas) {
    e.itens.sort((a, b) => b.usos - a.usos || (a.rec.nome || '').localeCompare(b.rec.nome || '', 'pt-BR'))
  }
  return { etapas: etapas.filter(e => e.itens.length), etapaMontagem: maxDist + 2 }
}
