import { useState } from 'react'
import { useToast } from '../hooks/useToast'
import { getConfig, saveConfig, calcPrecos, CONFIG_DEFAULTS } from '../hooks/useConfig'

function fmtPct(v) { return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) }
function fmtR(v) {
  const rounded = Math.ceil(Number(v) * 100) / 100
  return Number(rounded).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 5) }

export default function Configuracoes() {
  const { toast, show } = useToast()
  const [cfg, setCfg] = useState(getConfig)
  const [exemplo, setExemplo] = useState(10)
  const [novoNome, setNovoNome] = useState('')
  const [adicionando, setAdicionando] = useState(false)

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
  const { base, p99, pIfood } = calcPrecos(exemplo, cfgComTotal)

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

        {/* ── Custos fixos itemizados ──────────────────────── */}
        <div className="section-label">Custos fixos mensais</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
          Rateio por unidade = Total ÷ Volume projetado
        </div>

        <div className="card card-flush" style={{ padding: '0 14px', marginBottom: 8 }}>
          {(cfg.custoItens || []).map((item, idx, arr) => (
            <div key={item.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
              borderBottom: idx < arr.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{item.nome}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>R$</span>
                <input
                  className="item-qty"
                  type="number" inputMode="decimal"
                  min="0"
                  step="10"
                  value={item.valor || ''}
                  placeholder="0"
                  onChange={e => updateItem(item.id, e.target.value)}
                  style={{ width: 90, textAlign: 'right' }}
                />
              </div>
              <button
                onClick={() => removeItem(item.id)}
                style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 18, padding: '0 2px', lineHeight: 1 }}
                title="Remover"
              >×</button>
            </div>
          ))}

          {/* Nova linha inline de adição */}
          {adicionando && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
              <input
                style={{
                  flex: 1, background: 'transparent', border: 'none', outline: 'none',
                  fontSize: 13, color: 'var(--text-primary)', fontWeight: 500,
                }}
                placeholder="Nome do custo (ex: Internet)"
                value={novoNome}
                onChange={e => setNovoNome(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addItem(); if (e.key === 'Escape') { setAdicionando(false); setNovoNome('') } }}
                autoFocus
              />
              <button
                onClick={addItem}
                style={{ fontSize: 12, padding: '3px 10px', borderRadius: 6, border: '1px solid var(--teal)', color: 'var(--teal)', background: 'transparent', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                Confirmar
              </button>
              <button
                onClick={() => { setAdicionando(false); setNovoNome('') }}
                style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 18, padding: '0 2px', lineHeight: 1 }}
              >×</button>
            </div>
          )}

          {/* Total row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0 4px', borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Total mensal</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--teal)' }}>R$ {fmtR(custoFixoMensal)}</span>
          </div>
        </div>

        {!adicionando && (
          <button className="btn-add-item" onClick={() => setAdicionando(true)} style={{ marginBottom: 12 }}>
            + Adicionar custo
          </button>
        )}

        {rateio > 0 && (
          <div style={{ fontSize: 12, color: 'var(--teal)', marginBottom: 12, padding: '5px 10px', background: 'var(--teal-light)', borderRadius: 6, display: 'inline-block' }}>
            Rateio por unidade: <strong>R$ {fmtR(rateio)}</strong>
            {' '}({cfg.unidadesProjetadas} un/mês)
          </div>
        )}

        {/* ── Volume projetado ────────────────────────────── */}
        <div className="section-label">Volume de produção</div>
        <div className="field-label">Unidades projetadas/mês</div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>quantas unidades você vende por mês</div>
        <input
          className="field-input"
          type="number" inputMode="decimal" min="1" step="1"
          value={cfg.unidadesProjetadas}
          onChange={e => set('unidadesProjetadas', e.target.value)}
          style={{ maxWidth: 160 }}
        />

        {/* ── Margem ──────────────────────────────────────── */}
        <div className="section-label" style={{ marginTop: 8 }}>Margem de lucro</div>
        <div className="field-label">Margem desejada (%)</div>
        <input
          className="field-input"
          type="number" inputMode="decimal" min="0" max="99" step="1"
          value={cfg.margem}
          onChange={e => set('margem', e.target.value)}
          style={{ maxWidth: 160 }}
        />

        {/* ── Taxas ───────────────────────────────────────── */}
        <div className="section-label" style={{ marginTop: 8 }}>Taxas de plataforma</div>
        <div className="field-row">
          <div>
            <div className="field-label">Taxa 99Food (%)</div>
            <input className="field-input" type="number" inputMode="decimal" min="0" max="99" step="0.5" value={cfg.taxa99} onChange={e => set('taxa99', e.target.value)} />
          </div>
          <div>
            <div className="field-label">Taxa iFood (%)</div>
            <input className="field-input" type="number" inputMode="decimal" min="0" max="99" step="0.5" value={cfg.taxaIfood} onChange={e => set('taxaIfood', e.target.value)} />
          </div>
        </div>

        {/* ── Prévia ──────────────────────────────────────── */}
        <div className="section-label" style={{ marginTop: 8 }}>Prévia de precificação</div>
        <div className="field-label">Custo do produto (R$) — preencha para simular</div>
        <input
          className="field-input"
          type="number" inputMode="decimal" min="0" step="0.50"
          value={exemplo}
          onChange={e => setExemplo(parseFloat(e.target.value) || 0)}
          style={{ maxWidth: 160 }}
        />
        <div className="card" style={{ padding: '12px 16px', marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13 }}>Venda direta</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--teal)' }}>R$ {fmtR(base)}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 12 }}>
            custo R$ {fmtR(exemplo)} + rateio R$ {fmtR(rateio)} com margem {fmtPct(cfg.margem)}%
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 13 }}>99Food <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>(−{fmtPct(cfg.taxa99)}%)</span></span>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#f59e0b' }}>R$ {fmtR(p99)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13 }}>iFood <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>(−{fmtPct(cfg.taxaIfood)}%)</span></span>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#ef4444' }}>R$ {fmtR(pIfood)}</span>
          </div>
        </div>

        <button className="btn-primary" onClick={handleSave} style={{ marginTop: 16 }}>
          Salvar configurações
        </button>
        <button className="btn-ghost" onClick={handleReset} style={{ marginTop: 8, fontSize: 13 }}>
          Restaurar padrão
        </button>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
