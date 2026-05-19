import { loadUserConfig, saveUserConfig } from '../services/db'

let _key = 'guaxi_config'
let _cache = null  // in-memory so getConfig() stays sync

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
  embalagemDeliveryIds: [],  // embalagem IDs usadas como sacola de saída
}

function somaItens(itens) {
  return (itens || []).reduce((s, i) => s + (parseFloat(i.valor) || 0), 0)
}

function parseRaw(raw) {
  try {
    const saved = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!saved) return null
    if (saved.rateio != null && saved.custoFixoMensal == null) {
      saved.custoFixoMensal = saved.rateio * (saved.unidadesProjetadas || CONFIG_DEFAULTS.unidadesProjetadas)
    }
    const custoItens = saved.custoItens || DEFAULT_ITENS
    const custoFixoMensal = somaItens(custoItens) || saved.custoFixoMensal || 0
    return { ...CONFIG_DEFAULTS, ...saved, custoItens, custoFixoMensal }
  } catch { return null }
}

export function initConfig(userId) {
  const userKey = userId ? `guaxi_config_${userId}` : 'guaxi_config'
  if (userId) {
    const legacy = localStorage.getItem('guaxi_config')
    const existing = localStorage.getItem(userKey)
    if (legacy && legacy !== '{}' && !existing) {
      localStorage.setItem(userKey, legacy)
    }
  }
  _key = userKey
  _cache = parseRaw(localStorage.getItem(_key)) || { ...CONFIG_DEFAULTS }
}

// Call once after login — loads from Supabase and wins over localStorage
export async function syncConfigFromSupabase() {
  try {
    const remote = await loadUserConfig()
    if (remote) {
      const parsed = parseRaw(remote)
      if (parsed) {
        _cache = parsed
        localStorage.setItem(_key, JSON.stringify(parsed))
      }
    } else {
      // No remote config yet — push localStorage data up
      const local = _cache || parseRaw(localStorage.getItem(_key))
      if (local) saveUserConfig(local)
    }
  } catch {}
}

export function getConfig() {
  if (!_cache) _cache = parseRaw(localStorage.getItem(_key)) || { ...CONFIG_DEFAULTS }
  return _cache
}

export function saveConfig(updates) {
  const next = { ...getConfig(), ...updates }
  next.custoFixoMensal = somaItens(next.custoItens)
  _cache = next
  localStorage.setItem(_key, JSON.stringify(next))
  saveUserConfig(next)  // async, fire-and-forget
  return next
}

// Average cost of delivery bags configured globally
export function getCustoSacolaDelivery(cfg, embalagens) {
  const ids = (cfg || getConfig()).embalagemDeliveryIds || []
  if (!ids.length || !embalagens?.length) return 0
  const selecionadas = embalagens.filter(e => ids.includes(e.id))
  if (!selecionadas.length) return 0
  const total = selecionadas.reduce((s, e) => s + (e.custoUnit || 0), 0)
  return total / selecionadas.length
}

export function calcPrecos(custoTotal, cfg, custoSacola = 0) {
  const c = cfg || getConfig()
  if (!custoTotal || custoTotal <= 0) return { base: 0, p99: 0, pIfood: 0 }
  const rateio = (c.unidadesProjetadas || 0) > 0
    ? (c.custoFixoMensal || 0) / c.unidadesProjetadas
    : 0
  const base        = (custoTotal + rateio) / (1 - (c.margem || 0) / 100)
  const baseDelivery = (custoTotal + rateio + custoSacola) / (1 - (c.margem || 0) / 100)
  const p99    = baseDelivery / (1 - (c.taxa99    || 0) / 100)
  const pIfood = baseDelivery / (1 - (c.taxaIfood || 0) / 100)
  return { base, p99, pIfood }
}
