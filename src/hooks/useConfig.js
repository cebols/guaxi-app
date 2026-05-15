const KEY = 'guaxi_config'

export const CONFIG_DEFAULTS = {
  custoFixoMensal: 0,     // R$ total de custos fixos mensais (água, luz, gás, aluguel...)
  unidadesProjetadas: 100, // unidades projetadas de venda/mês
  margem: 30,              // % margem de lucro
  taxa99: 20,              // % taxa 99Food
  taxaIfood: 27,           // % taxa iFood
}

export function getConfig() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...CONFIG_DEFAULTS }
    const saved = JSON.parse(raw)
    // backward compat: migrate old `rateio` field if present
    if (saved.rateio != null && saved.custoFixoMensal == null) {
      saved.custoFixoMensal = saved.rateio * (saved.unidadesProjetadas || CONFIG_DEFAULTS.unidadesProjetadas)
    }
    return { ...CONFIG_DEFAULTS, ...saved }
  } catch {
    return { ...CONFIG_DEFAULTS }
  }
}

export function saveConfig(updates) {
  const next = { ...getConfig(), ...updates }
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
