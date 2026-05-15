const KEY = 'guaxi_config'

export const CONFIG_DEFAULTS = {
  rateio: 0,      // R$ por unidade vendida (overhead: água, luz, etc.)
  margem: 30,     // % margem de lucro desejada
  taxa99: 20,     // % taxa 99Food
  taxaIfood: 27,  // % taxa iFood
}

export function getConfig() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...CONFIG_DEFAULTS }
    return { ...CONFIG_DEFAULTS, ...JSON.parse(raw) }
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
  const base = (custoTotal + (c.rateio || 0)) / (1 - (c.margem || 0) / 100)
  const p99    = base / (1 - (c.taxa99    || 0) / 100)
  const pIfood = base / (1 - (c.taxaIfood || 0) / 100)
  return { base, p99, pIfood }
}
