import { useState, useMemo, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { getConfig, saveConfig, calcPrecos, getCustoSacolaDelivery, CONFIG_DEFAULTS } from '../hooks/useConfig'
import { getVendas, getEncomendas, getEmbalagens, loadUserConfig, saveUserConfig } from '../services/db'
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

// Big editable number with tight prefix/suffix and a clear field affordance
function NumPill({ value, onChange, prefix, suffix, size = 26 }) {
  const str = String(value ?? '')
  const len = Math.max(1.5, str.length)
  const aff = Math.round(size * 0.5)
  return (
    <label className="cfg-pill">
      {prefix && <span style={{ fontSize: aff, fontWeight: 700, color: 'var(--text-tertiary)' }}>{prefix}</span>}
      <input
        type="text" inputMode="decimal"
        value={value}
        onChange={onChange}
        style={{
          fontSize: size, fontWeight: 700, letterSpacing: '-0.02em',
          color: 'var(--text-primary)',
          width: `calc(${len}ch + 2px)`,
          textAlign: 'center',
        }}
      />
      {suffix && <span style={{ fontSize: aff, fontWeight: 700, color: 'var(--text-tertiary)' }}>{suffix}</span>}
    </label>
  )
}

// One of the 3 equal-weight price columns in the simulator
function PriceCol({ label, price, sub, color, bg }) {
  return (
    <div style={{ flex: 1, background: bg, borderRadius: 10, padding: '11px 6px', textAlign: 'center' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color, marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, letterSpacing: '-0.03em' }}>R$ {price}</div>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 3 }}>{sub}</div>
    </div>
  )
}

export default function Configuracoes() {
  const navigate = useNavigate()
  const { toast, show } = useToast()
  const { profile } = useAuth()
  const [cfg, setCfg] = useState(getConfig)
  const margemRef = useRef(null)
  const step3Done = cfg.custoFixoMensal > 0 || cfg.margem !== CONFIG_DEFAULTS.margem
  const showMargemHint = profile?.onboardingDone && !step3Done
  const [exemplo, setExemplo] = useState(10)
  const [modoMeta, setModoMeta] = useState(false)
  const [metaLucro, setMetaLucro] = useState(1000)
  const [novoNome, setNovoNome] = useState('')
  const [adicionando, setAdicionando] = useState(false)
  const [descontoPromo, setDescontoPromo] = useState(20)
  const { data: vendas }      = useData(getVendas)
  const { data: encomendas }  = useData(getEncomendas)
  const { data: embalagens }  = useData(getEmbalagens)

  const [deliveryCfg, setDeliveryCfg] = useState({ lojaCEP: '', lojaEndereco: '', freteGratis: 0, freteTiers: [] })
  useEffect(() => {
    loadUserConfig().then(cfg => {
      if (cfg?.delivery) setDeliveryCfg(d => ({ ...d, ...cfg.delivery }))
    }).catch(() => {})
  }, [])

  const setDel = (k, v) => setDeliveryCfg(d => ({ ...d, [k]: v }))
  const addTier = () => setDeliveryCfg(d => ({ ...d, freteTiers: [...d.freteTiers, { ate: '', valor: '' }] }))
  const removeTier = (i) => setDeliveryCfg(d => ({ ...d, freteTiers: d.freteTiers.filter((_, idx) => idx !== i) }))
  const updateTier = (i, k, v) => setDeliveryCfg(d => ({ ...d, freteTiers: d.freteTiers.map((t, idx) => idx === i ? { ...t, [k]: v } : t) }))

  const handleSaveDelivery = async () => {
    const tiers = deliveryCfg.freteTiers
      .filter(t => t.ate !== '' && t.valor !== '')
      .map(t => ({ ate: parseFloat(t.ate) || 0, valor: parseFloat(t.valor) || 0 }))
      .sort((a, b) => a.ate - b.ate)
    const payload = { lojaCEP: deliveryCfg.lojaCEP, lojaEndereco: deliveryCfg.lojaEndereco, freteGratis: parseFloat(deliveryCfg.freteGratis) || 0, freteTiers: tiers }
    const existing = await loadUserConfig()
    await saveUserConfig({ ...(existing || {}), delivery: payload })
    setDeliveryCfg(d => ({ ...d, freteTiers: tiers }))
    show('Configuração de delivery salva!')
  }

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
  const unidadesMeta = (base - exemplo) > 0 ? Math.ceil((custoFixoMensal + metaLucro) / (base - exemplo)) : null

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', padding: '0 4px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <div className="topbar-title">Preços e custos</div>
          </div>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 16 }}>

        {/* ── Custos fixos ─────────────────────────────────── */}
        <div className="card card-flush" style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 14px', borderBottom: '1px solid #2a2a2a' }}>
            <span className="cfg-label" style={{ marginBottom: 0 }}>Custos fixos mensais</span>
            <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--teal)', letterSpacing: '-0.02em' }}>R$ {fmtR(custoFixoMensal)}</span>
          </div>

          {(cfg.custoItens || []).map((item, idx, arr) => (
            <div key={item.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '4px 14px',
              borderBottom: idx < arr.length - 1 ? '1px solid #242424' : 'none',
            }}>
              <div style={{ flex: 1, fontSize: 13 }}>{item.nome}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>R$</span>
                <input
                  className="cfg-cost-input"
                  type="text" inputMode="decimal" min="0" step="10"
                  value={item.valor || ''} placeholder="0"
                  onChange={e => updateItem(item.id, e.target.value)}
                />
              </div>
              <button onClick={() => removeItem(item.id)}
                style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 16, padding: '0 0 0 2px', lineHeight: 1 }}>×</button>
            </div>
          ))}

          {adicionando && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px', borderTop: '1px solid #242424' }}>
              <input
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 13, color: 'var(--text-primary)' }}
                placeholder="Nome do custo (ex: Internet)"
                value={novoNome}
                onChange={e => setNovoNome(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addItem(); if (e.key === 'Escape') { setAdicionando(false); setNovoNome('') } }}
                autoFocus
              />
              <button onClick={addItem}
                style={{ fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 7, border: '1px solid var(--teal)', color: 'var(--teal)', background: 'transparent', cursor: 'pointer' }}>
                OK
              </button>
              <button onClick={() => { setAdicionando(false); setNovoNome('') }}
                style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }}>×</button>
            </div>
          )}

          {!adicionando && (
            <button onClick={() => setAdicionando(true)}
              style={{ width: '100%', padding: '9px 14px', background: 'transparent', border: 'none', borderTop: '1px solid #2a2a2a', color: 'var(--teal)', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>
              + Adicionar custo
            </button>
          )}
        </div>

        {/* ── Volume de produção ───────────────────────────── */}
        <div className="card" style={{ padding: '15px 16px', marginBottom: 10 }}>
          <div className="cfg-label">Produção / mês</div>
          <NumPill
            value={cfg.unidadesProjetadas}
            onChange={e => set('unidadesProjetadas', e.target.value)}
            suffix="un"
          />
          {rateio > 0 && (
            <div style={{ marginTop: 13, paddingTop: 11, borderTop: '1px solid #2a2a2a', display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 12.5, color: 'var(--text-secondary)' }}>
              <span>Rateio por unidade</span>
              <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--teal)' }}>R$ {fmtR(rateio)}</span>
              <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>· {cfg.unidadesProjetadas} un/mês</span>
            </div>
          )}
        </div>

        {/* ── Taxas de plataforma ──────────────────────────── */}
        <div className="card" style={{ padding: '15px 16px', marginBottom: 10 }}>
          <div className="cfg-label" style={{ marginBottom: 12 }}>Taxas de plataforma</div>
          <div style={{ display: 'flex' }}>
            {[
              { label: '99Food', key: 'taxa99',    color: '#f59e0b', border: true },
              { label: 'iFood',  key: 'taxaIfood', color: '#ef4444', border: false },
            ].map(({ label, key, color, border }) => (
              <div key={key} style={{ flex: 1, paddingRight: border ? 16 : 0, paddingLeft: border ? 0 : 16, borderRight: border ? '1px solid #2a2a2a' : 'none' }}>
                <div className="cfg-label" style={{ color }}>{label}</div>
                <NumPill
                  value={cfg[key]}
                  onChange={e => set(key, e.target.value)}
                  suffix="%"
                  size={24}
                />
              </div>
            ))}
          </div>
        </div>

        {/* ── Embalagens ───────────────────────────────────── */}
        <div className="card" style={{ padding: '15px 16px', marginBottom: 10 }}>
          <div className="cfg-label" style={{ marginBottom: 12 }}>Embalagens</div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Delivery</span>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>sacola por pedido</span>
            </div>
            <MultiSelectDropdown
              embalagens={embalagens || []}
              selectedIds={cfg.embalagemDeliveryIds || []}
              onChange={id => toggleEmb('embalagemDeliveryIds', id)}
              placeholder="Selecionar sacolas de delivery…"
            />
          </div>
          <div style={{ borderTop: '1px solid #2a2a2a', margin: '14px 0' }} />
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Encomenda</span>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>embalagem padrão</span>
            </div>
            <MultiSelectDropdown
              embalagens={embalagens || []}
              selectedIds={cfg.embalagemEncomendaIds || []}
              onChange={id => toggleEmb('embalagemEncomendaIds', id)}
              placeholder="Selecionar embalagens de encomenda…"
            />
          </div>
        </div>

        {/* ── Simulador de precificação ────────────────────── */}
        <div className="card" style={{ padding: '16px', marginBottom: 10 }}>
          <div className="cfg-label" style={{ marginBottom: 14 }}>Simulador de precificação</div>
          <div style={{ display: 'flex', marginBottom: 16 }}>
            <div ref={margemRef} style={{ flex: 1, paddingRight: 16, borderRight: '1px solid #2a2a2a', textAlign: 'center' }}>
              <div className="cfg-label" style={{ marginBottom: 8 }}>Margem desejada</div>
              <NumPill
                value={cfg.margem}
                onChange={e => set('margem', e.target.value)}
                suffix="%"
                size={22}
              />
            </div>
            <div style={{ flex: 1, paddingLeft: 16, textAlign: 'center' }}>
              <div className="cfg-label" style={{ marginBottom: 8 }}>Custo do produto</div>
              <NumPill
                prefix="R$"
                value={exemplo}
                onChange={e => setExemplo(parseFloat(e.target.value) || 0)}
                size={22}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <PriceCol label="Direta" price={fmtR(base)}   sub={`margem ${fmtPct(cfg.margem)}%`} color="var(--teal)" bg="rgba(34,184,134,0.10)" />
            <PriceCol label="99Food" price={fmtR(p99)}    sub={`−${fmtPct(cfg.taxa99)}% taxa`}  color="#f59e0b"     bg="rgba(245,158,11,0.10)" />
            <PriceCol label="iFood"  price={fmtR(pIfood)} sub={`−${fmtPct(cfg.taxaIfood)}% taxa`} color="#ef4444"   bg="rgba(239,68,68,0.10)" />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 11, textAlign: 'center' }}>
            custo R$ {fmtR(exemplo)} + rateio R$ {fmtR(rateio)} · margem {fmtPct(cfg.margem)}%
          </div>

          {/* ── Meta / equilíbrio ── */}
          <div style={{ marginTop: 14, paddingTop: 13, borderTop: '1px solid #2a2a2a' }}>
            <div style={{ display: 'flex', background: '#1a1a1a', borderRadius: 8, padding: 3, marginBottom: 13 }}>
              {[{ label: 'Pra zerar custos', val: false }, { label: 'Meta de lucro', val: true }].map(({ label, val }) => (
                <button key={label} onClick={() => setModoMeta(val)}
                  style={{ flex: 1, padding: '5px 0', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', borderRadius: 6,
                    background: modoMeta === val ? 'var(--bg-card)' : 'transparent',
                    color: modoMeta === val ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    transition: 'all .15s ease' }}>
                  {label}
                </button>
              ))}
            </div>

            {!modoMeta ? (
              pontoEquilibrio !== null ? (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                  <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--teal)', letterSpacing: '-0.03em' }}>{pontoEquilibrio}</span>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>un/mês pra cobrir os custos fixos</span>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Preencha o custo acima</div>
              )
            ) : (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 11 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', flexShrink: 0 }}>Quero lucrar</span>
                  <label className="cfg-pill">
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)' }}>R$</span>
                    <input type="text" inputMode="decimal" value={metaLucro}
                      onChange={e => setMetaLucro(parseFloat(e.target.value) || 0)}
                      style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', textAlign: 'center',
                        width: `calc(${Math.max(2, String(metaLucro).length)}ch + 2px)`,
                        background: 'transparent', border: 'none', outline: 'none',
                        color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)' }}>/mês</span>
                  </label>
                </div>
                {unidadesMeta !== null ? (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                    <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--teal)', letterSpacing: '-0.03em' }}>{unidadesMeta}</span>
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>un/mês a R$ {fmtR(base)}</span>
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Preencha o custo acima</div>
                )}
              </div>
            )}
          </div>
        </div>
        {showMargemHint && (
          <SpotlightHint
            targetRef={margemRef}
            stepKey="margem"
            title="Defina sua margem de lucro"
            body="Essa margem é usada para calcular o preço sugerido de todos os seus produtos. Ajuste para o valor que você precisa ganhar."
          />
        )}

        {/* ── Ponto de equilíbrio ─────────────────────────── */}
        <div className="card" style={{ padding: '15px 16px', marginBottom: 10 }}>
          <div className="cfg-label" style={{ marginBottom: 10 }}>Ponto de equilíbrio</div>
          {pontoEquilibrio !== null ? (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 30, fontWeight: 800, color: 'var(--teal)', letterSpacing: '-0.03em' }}>{pontoEquilibrio}</span>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>un/mês pra zerar</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 3 }}>
                R$ {fmtR(custoFixoMensal)} fixo ÷ R$ {fmtR(margemUnit)}/un (a R$ {fmtR(base)} direta)
              </div>
              {realStats.unidades > 0 && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #2a2a2a' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
                    <div style={{ flex: 1, height: 7, background: '#2a2a2a', borderRadius: 4 }}>
                      <div style={{ width: `${Math.min(100, (realStats.unidades / pontoEquilibrio) * 100)}%`, height: '100%', background: realStats.unidades >= pontoEquilibrio ? 'var(--teal)' : '#f59e0b', borderRadius: 4 }} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                      {realStats.unidades}/{pontoEquilibrio} <span style={{ color: 'var(--text-tertiary)', fontWeight: 600 }}>({Math.round((realStats.unidades / pontoEquilibrio) * 100)}%)</span>
                    </span>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: realStats.unidades >= pontoEquilibrio ? 'var(--teal)' : '#f59e0b' }}>
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
        <div className="card" style={{ padding: '15px 16px', marginBottom: 16 }}>
          <div className="cfg-label" style={{ marginBottom: 12 }}>Calculadora de promoção</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Desconto aplicado</span>
            <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--teal)' }}>{descontoPromo}%</span>
          </div>
          <input
            type="range" min="0" max="60" step="5"
            value={descontoPromo}
            onChange={e => setDescontoPromo(parseInt(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--teal)', marginBottom: 14 }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 7 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Preço promo</span>
            <span style={{ fontSize: 15, fontWeight: 700 }}>R$ {fmtR(precoPromo)} <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-tertiary)', textDecoration: 'line-through' }}>R$ {fmtR(base)}</span></span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Lucro por unidade</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: promoColor }}>R$ {fmtR(lucroPromoUnit)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Margem resultante</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: promoColor }}>{fmtPct(margemPromo)}%</span>
          </div>
          {lucroPromoUnit < 0 && (
            <div style={{ fontSize: 11, color: 'var(--alert-text)', marginTop: 10, padding: '7px 10px', background: '#3b1f1f', borderRadius: 7 }}>
              ⚠ Você está vendendo no prejuízo. Cada un perde R$ {fmtR(Math.abs(lucroPromoUnit))}
            </div>
          )}
          {lucroPromoUnit >= 0 && margemPromo < 15 && (
            <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 10, padding: '7px 10px', background: '#3b2700', borderRadius: 7 }}>
              ⚠ Margem apertada — só vale se compensar em volume
            </div>
          )}
        </div>

        <button className="btn-primary" onClick={handleSave}>Salvar configurações</button>
        <button className="btn-ghost" onClick={handleReset} style={{ marginTop: 8, fontSize: 13 }}>Restaurar padrão</button>

        {/* ── Delivery / Frete ─────────────────────────────── */}
        <div style={{ marginTop: 24 }}>
          <span className="section-label">Delivery por distância</span>
          <div className="card" style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
              Configure o endereço da sua loja e as faixas de frete. O valor é calculado automaticamente pela distância de rota (OSRM) ao receber um pedido.
            </div>
            <label className="cfg-label">CEP da loja</label>
            <input
              value={deliveryCfg.lojaCEP}
              onChange={e => setDel('lojaCEP', e.target.value)}
              placeholder="00000-000"
              maxLength={9}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14, marginBottom: 10, boxSizing: 'border-box' }}
            />
            <label className="cfg-label">Endereço completo (opcional)</label>
            <input
              value={deliveryCfg.lojaEndereco}
              onChange={e => setDel('lojaEndereco', e.target.value)}
              placeholder="Rua..., número, cidade"
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14, marginBottom: 10, boxSizing: 'border-box' }}
            />
            <label className="cfg-label">Frete grátis acima de (R$, 0 = desativado)</label>
            <input
              type="number" min="0"
              value={deliveryCfg.freteGratis}
              onChange={e => setDel('freteGratis', e.target.value)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14, marginBottom: 14, boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="cfg-label" style={{ margin: 0 }}>Faixas de frete</span>
              <button onClick={addTier} style={{ background: 'none', border: '1px solid var(--teal)', borderRadius: 6, padding: '3px 10px', fontSize: 12, color: 'var(--teal)', cursor: 'pointer', fontWeight: 700 }}>+ Faixa</button>
            </div>
            {deliveryCfg.freteTiers.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 8 }}>Nenhuma faixa — frete fixo ou desativado</div>
            )}
            {deliveryCfg.freteTiers.map((tier, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>até</span>
                <input
                  type="number" min="0"
                  value={tier.ate}
                  onChange={e => updateTier(i, 'ate', e.target.value)}
                  placeholder="km"
                  style={{ width: 64, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, textAlign: 'center' }}
                />
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>km → R$</span>
                <input
                  type="number" min="0" step="0.5"
                  value={tier.valor}
                  onChange={e => updateTier(i, 'valor', e.target.value)}
                  placeholder="0,00"
                  style={{ width: 72, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, textAlign: 'center' }}
                />
                <button onClick={() => removeTier(i)} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 16, cursor: 'pointer', padding: '0 4px' }}>×</button>
              </div>
            ))}
            <button onClick={handleSaveDelivery} style={{ width: '100%', marginTop: 10, padding: '10px', borderRadius: 8, border: 'none', background: 'var(--teal)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              Salvar delivery
            </button>
          </div>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
