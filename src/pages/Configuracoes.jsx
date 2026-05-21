import { useState, useMemo, useRef, useEffect } from 'react'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { getConfig, saveConfig, calcPrecos, getCustoSacolaDelivery, CONFIG_DEFAULTS } from '../hooks/useConfig'
import { getVendas, getEncomendas, getEmbalagens } from '../services/db'
import { useAuth } from '../contexts/AuthContext'
import { SpotlightHint } from '../components/SpotlightHint'

function fmtPct(v) { return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) }
function fmtR(v) {
  const rounded = Math.ceil(Number(v) * 100) / 100
  return Number(rounded).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 5) }

function fmtR2(v) { return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

function MultiSelectDropdown({ embalagens, selectedIds, onChange, placeholder = 'Selecionar embalagens…' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  const selected = (embalagens || []).filter(e => selectedIds.includes(e.id))
  const media = selected.length ? selected.reduce((s, e) => s + (e.custoUnit || 0), 0) / selected.length : null
  return (
    <div ref={ref} style={{ position: 'relative', marginBottom: 8 }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 5, minHeight: 40, padding: '6px 10px', paddingRight: 28,
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', alignItems: 'center', position: 'relative' }}
      >
        {selected.length === 0
          ? <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{placeholder}</span>
          : selected.map(e => (
            <span key={e.id} style={{ fontSize: 11, background: 'rgba(13,148,136,0.15)', color: 'var(--teal)', borderRadius: 12, padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
              {e.nome}
              <span onClick={ev => { ev.stopPropagation(); onChange(e.id) }} style={{ cursor: 'pointer', fontWeight: 700, lineHeight: 1 }}>×</span>
            </span>
          ))
        }
        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: 'var(--text-tertiary)' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ position: 'absolute', zIndex: 100, top: '100%', left: 0, right: 0, marginTop: 4,
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.3)', maxHeight: 220, overflowY: 'auto' }}>
          {(embalagens || []).length === 0
            ? <div style={{ padding: '10px 14px', fontSize: 13, color: 'var(--text-tertiary)' }}>Nenhuma embalagem cadastrada.</div>
            : (embalagens || []).map(e => {
              const sel = selectedIds.includes(e.id)
              return (
                <div key={e.id} onClick={() => onChange(e.id)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '9px 14px', cursor: 'pointer', fontSize: 13,
                    background: sel ? 'rgba(13,148,136,0.08)' : 'transparent',
                    color: sel ? 'var(--teal)' : 'var(--text-primary)' }}>
                  <span>{sel ? '✓ ' : ''}{e.nome}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>R$ {fmtR2(e.custoUnit)}</span>
                </div>
              )
            })
          }
        </div>
      )}
      {media !== null && (
        <div style={{ fontSize: 11, color: 'var(--teal)', marginTop: 4 }}>
          Média por saída: R$ {fmtR2(media)} ({selected.length} embalagem{selected.length > 1 ? 's' : ''})
        </div>
      )}
    </div>
  )
}

export default function Configuracoes() {
  const { toast, show } = useToast()
  const { profile } = useAuth()
  const [cfg, setCfg] = useState(getConfig)
  const margemRef = useRef(null)
  const step3Done = cfg.custoFixoMensal > 0 || cfg.margem !== CONFIG_DEFAULTS.margem
  const showMargemHint = profile?.onboardingDone && !step3Done
  const [exemplo, setExemplo] = useState(10)
  const [novoNome, setNovoNome] = useState('')
  const [adicionando, setAdicionando] = useState(false)
  const [descontoPromo, setDescontoPromo] = useState(20)
  const { data: vendas }      = useData(getVendas)
  const { data: encomendas }  = useData(getEncomendas)
  const { data: embalagens }  = useData(getEmbalagens)

  const toggleEmb = (key, id) => setCfg(c => {
    const ids = c[key] || []
    return { ...c, [key]: ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id] }
  })

  const set = (k, v) => setCfg(c => ({ ...c, [k]: parseFloat(v) || 0 }))

  // ── Item management ──────────────────────────────────────────
  const updateItem = (id, valor) => setCfg(c => ({
    ...c,
    custoItens: c.custoItens.map(i => i.id === id ? { ...i, valor: parseFloat(valor) || 0 } : i),
  }))

  const removeItem = (id) => setCfg(c => ({
    ...c,
    custoItens: c.custoItens.filter(i => i.id !== id),
  }))

  const addItem = () => {
    const nome = novoNome.trim()
    if (!nome) return
    setCfg(c => ({
      ...c,
      custoItens: [...c.custoItens, { id: newId(), nome, valor: 0 }],
    }))
    setNovoNome('')
    setAdicionando(false)
  }

  // ── Derived values ───────────────────────────────────────────
  const custoFixoMensal = (cfg.custoItens || []).reduce((s, i) => s + (parseFloat(i.valor) || 0), 0)
  const rateio = cfg.unidadesProjetadas > 0 ? custoFixoMensal / cfg.unidadesProjetadas : 0
  const cfgComTotal = { ...cfg, custoFixoMensal }
  const mediaDelivery = getCustoSacolaDelivery(cfgComTotal, embalagens || [])
  const { base, p99, pIfood } = calcPrecos(exemplo, cfgComTotal, mediaDelivery)

  // Vendas reais mês atual
  const realStats = useMemo(() => {
    const mes = new Date().toISOString().slice(0, 7)
    let unidades = 0; let receita = 0
    for (const v of (vendas || [])) {
      if (v.data?.startsWith(mes)) {
        unidades += v.quantidade || 0
        receita  += (v.quantidade || 0) * (v.precoUnit || 0)
      }
    }
    for (const e of (encomendas || [])) {
      if (e.status === 'Cancelado') continue
      if (e.dataEntrega?.startsWith(mes)) {
        for (const it of (e.itens || [])) {
          unidades += it.quantidade || 0
          receita  += (it.quantidade || 0) * (it.precoUnit || 0)
        }
      }
    }
    return { unidades, receita }
  }, [vendas, encomendas])

  // Ponto de equilíbrio: unidades/mês necessárias pra cobrir custos fixos
  const margemUnit = exemplo > 0 ? base - exemplo : 0
  const pontoEquilibrio = margemUnit > 0 ? Math.ceil(custoFixoMensal / margemUnit) : null

  // Promo
  const precoPromo = base * (1 - descontoPromo / 100)
  const margemPromo = precoPromo > 0 ? ((precoPromo - exemplo - rateio) / precoPromo) * 100 : 0
  const lucroPromoUnit = precoPromo - exemplo - rateio
  const promoColor = margemPromo >= 20 ? 'var(--teal)' : margemPromo >= 5 ? '#f59e0b' : 'var(--alert-text)'

  const handleSave = () => {
    saveConfig({ ...cfg, custoFixoMensal })
    show('Configurações salvas!')
  }

  const handleReset = () => {
    setCfg({ ...CONFIG_DEFAULTS })
    saveConfig(CONFIG_DEFAULTS)
    show('Restaurado para padrão')
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div className="topbar-title">Configurações de precificação</div>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 16 }}>

        {/* ── Custos fixos ─────────────────────────────────── */}
        <div className="card card-flush" style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: .5 }}>Custos fixos mensais</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--teal)' }}>R$ {fmtR(custoFixoMensal)}</span>
          </div>

          {(cfg.custoItens || []).map((item, idx, arr) => (
            <div key={item.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px',
              borderBottom: idx < arr.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <div style={{ flex: 1, fontSize: 13 }}>{item.nome}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>R$</span>
                <input
                  className="item-qty"
                  type="text" inputMode="decimal" min="0" step="10"
                  value={item.valor || ''} placeholder="0"
                  onChange={e => updateItem(item.id, e.target.value)}
                  style={{ width: 80, textAlign: 'right' }}
                />
              </div>
              <button onClick={() => removeItem(item.id)}
                style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }}>×</button>
            </div>
          ))}

          {adicionando && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', borderTop: '1px solid var(--border)' }}>
              <input
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 13, color: 'var(--text-primary)' }}
                placeholder="Nome do custo (ex: Internet)"
                value={novoNome}
                onChange={e => setNovoNome(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addItem(); if (e.key === 'Escape') { setAdicionando(false); setNovoNome('') } }}
                autoFocus
              />
              <button onClick={addItem}
                style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '1px solid var(--teal)', color: 'var(--teal)', background: 'transparent', cursor: 'pointer' }}>
                OK
              </button>
              <button onClick={() => { setAdicionando(false); setNovoNome('') }}
                style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }}>×</button>
            </div>
          )}

          {!adicionando && (
            <button onClick={() => setAdicionando(true)}
              style={{ width: '100%', padding: '8px 14px', background: 'transparent', border: 'none', borderTop: '1px solid var(--border)', color: 'var(--teal)', fontSize: 13, cursor: 'pointer', textAlign: 'left' }}>
              + Adicionar custo
            </button>
          )}
        </div>

        {/* ── Volume + Margem ──────────────────────────────── */}
        <div ref={margemRef} className="card" style={{ padding: '14px 16px', marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 0 }}>
            <div style={{ flex: 1, paddingRight: 16, borderRight: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 4 }}>Produção / mês</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <input
                  type="text" inputMode="decimal" min="1" step="1"
                  value={cfg.unidadesProjetadas}
                  onChange={e => set('unidadesProjetadas', e.target.value)}
                  style={{ fontSize: 28, fontWeight: 700, letterSpacing: -1, color: 'var(--text-primary)', background: 'transparent', border: 'none', outline: 'none', width: 90 }}
                />
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>un</span>
              </div>
            </div>
            <div style={{ flex: 1, paddingLeft: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 4 }}>Margem desejada</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                <input
                  type="text" inputMode="decimal" min="0" max="99" step="1"
                  value={cfg.margem}
                  onChange={e => set('margem', e.target.value)}
                  style={{ fontSize: 28, fontWeight: 700, letterSpacing: -1, color: 'var(--teal)', background: 'transparent', border: 'none', outline: 'none', width: 70 }}
                />
                <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--teal)' }}>%</span>
              </div>
            </div>
          </div>
          {rateio > 0 && (
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
              <span>Rateio por unidade</span>
              <span style={{ fontWeight: 700, color: 'var(--teal)' }}>R$ {fmtR(rateio)}</span>
              <span style={{ color: 'var(--text-tertiary)' }}>({cfg.unidadesProjetadas} un/mês)</span>
            </div>
          )}
        </div>
        {showMargemHint && (
          <SpotlightHint
            targetRef={margemRef}
            stepKey="margem"
            title="Defina sua margem de lucro"
            body="Essa margem é usada para calcular o preço sugerido de todos os seus produtos. Ajuste para o valor que você precisa ganhar."
          />
        )}

        {/* ── Taxas de plataforma ──────────────────────────── */}
        <div className="card" style={{ padding: '12px 16px', marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 10 }}>Taxas de plataforma</div>
          <div style={{ display: 'flex', gap: 10 }}>
            {[
              { label: '99Food', key: 'taxa99', color: '#f59e0b', bg: 'rgba(245,158,11,0.08)' },
              { label: 'iFood',  key: 'taxaIfood', color: '#ef4444', bg: 'rgba(239,68,68,0.08)' },
            ].map(({ label, key, color, bg }) => (
              <div key={key} style={{ flex: 1, background: bg, borderRadius: 8, padding: '8px 12px' }}>
                <div style={{ fontSize: 11, color, fontWeight: 700, marginBottom: 4 }}>{label}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                  <input
                    type="text" inputMode="decimal" min="0" max="99" step="0.5"
                    value={cfg[key]}
                    onChange={e => set(key, e.target.value)}
                    style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', background: 'transparent', border: 'none', outline: 'none', width: 52 }}
                  />
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Embalagens ───────────────────────────────────── */}
        <div className="card" style={{ padding: '12px 16px', marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 12 }}>Embalagens</div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Delivery <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>· sacola por pedido</span></div>
            <MultiSelectDropdown
              embalagens={embalagens || []}
              selectedIds={cfg.embalagemDeliveryIds || []}
              onChange={id => toggleEmb('embalagemDeliveryIds', id)}
              placeholder="Selecionar sacolas de delivery…"
            />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Encomenda <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>· embalagem padrão</span></div>
            <MultiSelectDropdown
              embalagens={embalagens || []}
              selectedIds={cfg.embalagemEncomendaIds || []}
              onChange={id => toggleEmb('embalagemEncomendaIds', id)}
              placeholder="Selecionar embalagens de encomenda…"
            />
          </div>
        </div>

        {/* ── Simulador de precificação ────────────────────── */}
        <div className="card" style={{ padding: '14px 16px', marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 12 }}>Simulador de precificação</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-secondary)', borderRadius: 8, padding: '8px 12px', flexShrink: 0 }}>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>R$</span>
              <input
                type="text" inputMode="decimal" min="0" step="0.50"
                value={exemplo}
                onChange={e => setExemplo(parseFloat(e.target.value) || 0)}
                style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', background: 'transparent', border: 'none', outline: 'none', width: 64 }}
              />
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>custo</span>
            </div>
            <span style={{ color: 'var(--text-tertiary)', fontSize: 18 }}>→</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--teal)', letterSpacing: -0.5 }}>R$ {fmtR(base)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Direta · {fmtPct(cfg.margem)}% margem</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1, background: 'rgba(245,158,11,0.08)', borderRadius: 8, padding: '8px 12px' }}>
              <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600, marginBottom: 2 }}>99Food <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>−{fmtPct(cfg.taxa99)}%</span></div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#f59e0b' }}>R$ {fmtR(p99)}</div>
            </div>
            <div style={{ flex: 1, background: 'rgba(239,68,68,0.08)', borderRadius: 8, padding: '8px 12px' }}>
              <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 600, marginBottom: 2 }}>iFood <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>−{fmtPct(cfg.taxaIfood)}%</span></div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#ef4444' }}>R$ {fmtR(pIfood)}</div>
            </div>
          </div>
          {(rateio > 0 || exemplo > 0) && (
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8 }}>
              custo R$ {fmtR(exemplo)} + rateio R$ {fmtR(rateio)} com margem {fmtPct(cfg.margem)}%
            </div>
          )}
        </div>

        {/* ── Ponto de equilíbrio ─────────────────────────── */}
        <div className="card" style={{ padding: '14px 16px', marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 10 }}>Ponto de equilíbrio</div>
          {pontoEquilibrio !== null ? (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 28, fontWeight: 700, color: 'var(--teal)', letterSpacing: -1 }}>{pontoEquilibrio}</span>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>un/mês pra zerar</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                R$ {fmtR(custoFixoMensal)} fixo ÷ R$ {fmtR(margemUnit)}/un (a R$ {fmtR(base)} direta)
              </div>
              {realStats.unidades > 0 && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3 }}>
                      <div style={{ width: `${Math.min(100, (realStats.unidades / pontoEquilibrio) * 100)}%`, height: '100%', background: realStats.unidades >= pontoEquilibrio ? 'var(--teal)' : '#f59e0b', borderRadius: 3 }} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
                      {realStats.unidades}/{pontoEquilibrio} ({Math.round((realStats.unidades / pontoEquilibrio) * 100)}%)
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: realStats.unidades >= pontoEquilibrio ? 'var(--teal)' : '#f59e0b' }}>
                    {realStats.unidades >= pontoEquilibrio
                      ? '✓ Você já cobriu os custos fixos do mês'
                      : `Faltam ${pontoEquilibrio - realStats.unidades} un pra equilíbrio`}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Preencha o custo no simulador acima</div>
          )}
        </div>

        {/* ── Calculadora de promoção ─────────────────────── */}
        <div className="card" style={{ padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 10 }}>Calculadora de promoção</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Desconto</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--teal)' }}>{descontoPromo}%</span>
          </div>
          <input
            type="range" min="0" max="60" step="5"
            value={descontoPromo}
            onChange={e => setDescontoPromo(parseInt(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--teal)', marginBottom: 12 }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Preço promo</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>R$ {fmtR(precoPromo)} <span style={{ fontSize: 11, color: 'var(--text-tertiary)', textDecoration: 'line-through' }}>R$ {fmtR(base)}</span></span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Lucro por unidade</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: promoColor }}>R$ {fmtR(lucroPromoUnit)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Margem resultante</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: promoColor }}>{fmtPct(margemPromo)}%</span>
          </div>
          {lucroPromoUnit < 0 && (
            <div style={{ fontSize: 11, color: 'var(--alert-text)', marginTop: 8, padding: '6px 10px', background: '#3b1f1f', borderRadius: 6 }}>
              ⚠ Você está vendendo no prejuízo. Cada un perde R$ {fmtR(Math.abs(lucroPromoUnit))}
            </div>
          )}
          {lucroPromoUnit >= 0 && margemPromo < 15 && (
            <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 8, padding: '6px 10px', background: '#3b2700', borderRadius: 6 }}>
              ⚠ Margem apertada — só vale se compensar em volume
            </div>
          )}
        </div>

        <button className="btn-primary" onClick={handleSave}>Salvar configurações</button>
        <button className="btn-ghost" onClick={handleReset} style={{ marginTop: 8, fontSize: 13 }}>Restaurar padrão</button>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
