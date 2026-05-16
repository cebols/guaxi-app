const KEY = 'guaxi_config'

export const DEFAULT_ITENS = [
  { id: 'agua',    nome: 'Água',    valor: 0 },
  { id: 'luz',     nome: 'Luz',     valor: 0 },
  { id: 'gas',     nome: 'Gás',     valor: 0 },
  { id: 'aluguel', nome: 'Aluguel', valor: 0 },
]

export const CONFIG_DEFAULTS = {
  custoItens: DEFAULT_ITENS,
  custoFixoMensal: 0,
  unidadesProjetadas: 100,
  margem: 30,
  taxa99: 20,
  taxaIfood: 27,
}

function somaItens(itens) {
  return (itens || []).reduce((s, i) => s + (parseFloat(i.valor) || 0), 0)
}

export function getConfig() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...CONFIG_DEFAULTS }
    const saved = JSON.parse(raw)
    // backward compat: old rateio field
    if (saved.rateio != null && saved.custoFixoMensal == null) {
      saved.custoFixoMensal = saved.rateio * (saved.unidadesProjetadas || CONFIG_DEFAULTS.unidadesProjetadas)
    }
    const custoItens = saved.custoItens || DEFAULT_ITENS
    // always recompute custoFixoMensal from itens
    const custoFixoMensal = somaItens(custoItens) || saved.custoFixoMensal || 0
    return { ...CONFIG_DEFAULTS, ...saved, custoItens, custoFixoMensal }
  } catch {
    return { ...CONFIG_DEFAULTS }
  }
}

export function saveConfig(updates) {
  const next = { ...getConfig(), ...updates }
  next.custoFixoMensal = somaItens(next.custoItens)
  localStorage.setItem(KEY, JSON.stringify(next))
  return next
}

export function calcPrecos(custoTotal, cfg) {
  const c = cfg || getConfig()
  if (!custoTotal || custoTotal <= 0) return { base: 0, p99: 0, pIfood: 0 }
  const rateio = (c.unidadesProjetadas || 0) > 0
    ? (c.custoFixoMensal || 0) / c.unidadesProjetadas
    : 0
  const base   = (custoTotal + rateio) / (1 - (c.margem    || 0) / 100)
  const p99    = base / (1 - (c.taxa99    || 0) / 100)
  const pIfood = base / (1 - (c.taxaIfood || 0) / 100)
  return { base, p99, pIfood }
}
