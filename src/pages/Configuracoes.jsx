import { useState } from 'react'
import { useToast } from '../hooks/useToast'
import { getConfig, saveConfig, calcPrecos, CONFIG_DEFAULTS } from '../hooks/useConfig'

function fmtPct(v) { return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) }
function fmtR(v) {
  const rounded = Math.ceil(Number(v) * 100) / 100
  return Number(rounded).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function Configuracoes() {
  const { toast, show } = useToast()
  const [cfg, setCfg] = useState(getConfig)
  const [exemplo, setExemplo] = useState(10)

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

  const rateio = cfg.unidadesProjetadas > 0 ? (cfg.custoFixoMensal || 0) / cfg.unidadesProjetadas : 0
  const { base, p99, pIfood } = calcPrecos(exemplo, cfg)

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div className="topbar-title">Configurações de precificação</div>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 16 }}>

        <div className="section-label">Custos fixos mensais</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
          Rateio por unidade = Custo Fixo Total Mensal ÷ Volume de Produção Projetado
        </div>
        <div className="field-row">
          <div>
            <div className="field-label">Custo fixo total mensal (R$)</div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>água, luz, gás, aluguel, etc.</div>
            <input
              className="field-input"
              type="number"
              min="0"
              step="10"
              value={cfg.custoFixoMensal}
              onChange={e => set('custoFixoMensal', e.target.value)}
            />
          </div>
          <div>
            <div className="field-label">Unidades projetadas/mês</div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>quantas unidades você vende por mês</div>
            <input
              className="field-input"
              type="number"
              min="1"
              step="1"
              value={cfg.unidadesProjetadas}
              onChange={e => set('unidadesProjetadas', e.target.value)}
            />
          </div>
        </div>
        {rateio > 0 && (
          <div style={{ fontSize: 12, color: 'var(--teal)', marginBottom: 4, padding: '5px 10px', background: 'var(--teal-light)', borderRadius: 6, display: 'inline-block' }}>
            Rateio por unidade: <strong>R$ {fmtR(rateio)}</strong>
          </div>
        )}

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
        <div className="section-label" style={{ marginTop: 8 }}>Prévia de precificação</div>
        <div className="field-label">Custo do produto (R$) — preencha para simular</div>
        <input
          className="field-input"
          type="number"
          min="0"
          step="0.50"
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
