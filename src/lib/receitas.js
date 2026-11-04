// Contas de rendimento de receita — uma definição só, usada no modo cozinha,
// na produção e na ficha (antes cada tela contava unidade de um jeito).

export function pesoBaseReceita(rec, insumos = []) {
  return (rec?.ingredientes || []).reduce((s, i) => {
    const q = i.quantidade || 0
    if (i.unidade === 'g' || i.unidade === 'ml') return s + q
    if (i.unidade === 'kg' || i.unidade === 'L') return s + q * 1000
    if (i.unidade === 'un') {
      const ins = (insumos || []).find(x => x.id === i.insumoId || x.nome === i.nome)
      if (ins?.pesoUn > 0) return s + q * ins.pesoUn
    }
    return s
  }, 0)
}

export const fracaoAproveitada = (rec) => rec?.fatorPerda != null ? 1 - rec.fatorPerda / 100 : 1

// Quantas unidades 1 receita rende. Com g/un na ficha, vale o físico: peso
// aproveitado ÷ g/un (é o que o modo cozinha usa). Sem g/un, o "rende X un".
export function unidadesPorReceita(rec, insumos = []) {
  if (!rec) return 0
  const peso = pesoBaseReceita(rec, insumos)
  if (rec.qtdPorUnidade > 0 && peso > 0) return (peso * fracaoAproveitada(rec)) / rec.qtdPorUnidade
  return rec.rendimento || 0
}

// Quanto `doses` receitas rendem, na unidade da receita (un ou g)
export function rendimentoDe(rec, doses, insumos = []) {
  if (!rec) return 0
  return rec.unidadeGera === 'un' ? doses * unidadesPorReceita(rec, insumos) : doses * (rec.rendimento || 0)
}

// "rende X un" salvo na ficha diverge do peso ÷ g/un? (mais de 5%)
export function rendimentoDesatualizado(rec, insumos = []) {
  if (!rec || rec.unidadeGera !== 'un' || !(rec.qtdPorUnidade > 0) || !(rec.rendimento > 0)) return null
  const pelopeso = unidadesPorReceita(rec, insumos)
  if (!(pelopeso > 0) || Math.abs(pelopeso - rec.rendimento) / rec.rendimento <= 0.05) return null
  return { declarado: rec.rendimento, pelopeso }
}
