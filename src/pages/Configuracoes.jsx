import { useState } from 'react'
import { useToast } from '../hooks/useToast'
import { getConfig, saveConfig, CONFIG_DEFAULTS } from '../hooks/useConfig'

function fmtPct(v) { return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) }
function fmtR(v) { return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) }

export default function Configuracoes() {
  const { toast, show } = useToast()
  const [cfg, setCfg] = useState(getConfig)

  const set = (k, v) => setCfg(c => ({ ...c, [k]: parseFloat(v) || 0 }))

  const handleSave = () => {
    saveConfig(cfg)
    show('Configurações salvas!')
  }

  const handleReset = () => {
    setCfg({ ...CONFIG_DEFAULTS })
    saveConfig(CONFIG_DEFAULTS)
    show('Restaurado para padrão')
  }

  // Exemplo de precificação para R$ 5,00 de custo
  const exemplo = 5
  const base = (exemplo + cfg.rateio) / (1 - cfg.margem / 100)
  const p99  = base / (1 - cfg.taxa99 / 100)
  const pIf  = base / (1 - cfg.taxaIfood / 100)

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div className="topbar-title">Configurações de precificação</div>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 16 }}>
        <div className="section-label">Custos fixos (rateio)</div>
        <div className="field-label">
          Rateio por unidade vendida (R$)
          <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 6 }}>
            — água, luz, gás, aluguel ÷ unidades/mês
          </span>
        </div>
        <input
          className="field-input"
          type="number"
          min="0"
          step="0.10"
          value={cfg.rateio}
          onChange={e => set('rateio', e.target.value)}
        />

        <div className="section-label" style={{ marginTop: 8 }}>Margem de lucro</div>
        <div className="field-label">Margem desejada (%)</div>
        <input
          className="field-input"
          type="number"
          min="0"
          max="99"
          step="1"
          value={cfg.margem}
          onChange={e => set('margem', e.target.value)}
        />

        <div className="section-label" style={{ marginTop: 8 }}>Taxas de plataforma</div>
        <div className="field-row">
          <div>
            <div className="field-label">Taxa 99Food (%)</div>
            <input
              className="field-input"
              type="number"
              min="0"
              max="99"
              step="0.5"
              value={cfg.taxa99}
              onChange={e => set('taxa99', e.target.value)}
            />
          </div>
          <div>
            <div className="field-label">Taxa iFood (%)</div>
            <input
              className="field-input"
              type="number"
              min="0"
              max="99"
              step="0.5"
              value={cfg.taxaIfood}
              onChange={e => set('taxaIfood', e.target.value)}
            />
          </div>
        </div>

        {/* Preview */}
        <div className="section-label" style={{ marginTop: 8 }}>
          Prévia — produto com custo de R$ {fmtR(exemplo)}
        </div>
        <div className="card" style={{ padding: '12px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13 }}>Venda direta</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--teal)' }}>R$ {fmtR(base)}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 12 }}>
            custo R$ {fmtR(exemplo)} + rateio R$ {fmtR(cfg.rateio)} → margem {fmtPct(cfg.margem)}%
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 13 }}>99Food <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>(−{fmtPct(cfg.taxa99)}%)</span></span>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#f59e0b' }}>R$ {fmtR(p99)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13 }}>iFood <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>(−{fmtPct(cfg.taxaIfood)}%)</span></span>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#ef4444' }}>R$ {fmtR(pIf)}</span>
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
