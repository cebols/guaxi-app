import { useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useData } from '../hooks/useData'
import { getReceitas } from '../services/db'

function fmtQty(n, unidade) {
  const rounded = Math.round(n * 10) / 10
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded} ${unidade}`
}

export default function Cozinha() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: receitas, loading } = useData(getReceitas)

  const receita = (receitas || []).find(r => String(r.id) === String(id))
  const ingredientes = receita?.ingredientes || []

  const [fator, setFator] = useState(1)
  const [pesoInput, setPesoInput] = useState('')

  const pesoBase = ingredientes.reduce((s, i) => {
    if (['g', 'ml'].includes(i.unidade)) return s + i.quantidade
    return s
  }, 0)

  const onFatorChange = useCallback((val) => {
    const f = parseFloat(val)
    if (!isNaN(f) && f > 0) {
      setFator(Math.round(f * 100) / 100)
      if (pesoBase > 0) setPesoInput(Math.round(pesoBase * f).toString())
    }
  }, [pesoBase])

  const onPesoChange = useCallback((val) => {
    setPesoInput(val)
    const p = parseFloat(val)
    if (!isNaN(p) && p > 0 && pesoBase > 0) {
      setFator(Math.round((p / pesoBase) * 100) / 100)
    }
  }, [pesoBase])

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div>
            <div className="topbar-title">{loading ? '...' : (receita?.nome || 'Receita')}</div>
            <div className="topbar-sub">Modo cozinha</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-ghost" onClick={() => navigate(`/fichas/${id}/editar`)}>
              Editar
            </button>
            <button className="btn-ghost" onClick={() => navigate('/fichas')}>
              ← Voltar
            </button>
          </div>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 16 }}>
        {loading ? (
          <div className="loading">Carregando...</div>
        ) : !receita ? (
          <div className="empty"><span>Receita não encontrada.</span></div>
        ) : ingredientes.length === 0 ? (
          <div className="empty">
            <span>Nenhum ingrediente cadastrado.</span>
            <button className="btn-outline-teal" style={{ marginTop: 8 }} onClick={() => navigate(`/fichas/${id}/editar`)}>
              Adicionar ingredientes
            </button>
          </div>
        ) : (
          <>
            <div className="scale-box">
              <div className="scale-row">
                <span className="scale-label">Fator (doses)</span>
                <input
                  className="scale-input"
                  type="number" inputMode="decimal"
                  min="0.1"
                  step="0.5"
                  value={fator}
                  onChange={e => onFatorChange(e.target.value)}
                />
                <span className="scale-unit">x</span>
              </div>
              {pesoBase > 0 && (
                <div className="scale-row">
                  <span className="scale-label">Rendimento bruto</span>
                  <input
                    className="scale-input"
                    type="number" inputMode="decimal"
                    min="1"
                    step="10"
                    value={pesoInput || Math.round(pesoBase)}
                    onChange={e => onPesoChange(e.target.value)}
                  />
                  <span className="scale-unit">g</span>
                </div>
              )}
            </div>

            <div className="section-label">Ingredientes</div>
            <div className="card card-flush" style={{ padding: '0 14px' }}>
              {ingredientes.map((ing, i) => (
                <div key={i} className="ing-row">
                  <span className="ing-name">{ing.nome}</span>
                  <span className="ing-qty">{fmtQty(ing.quantidade * fator, ing.unidade)}</span>
                </div>
              ))}
            </div>

            {receita.rendimento > 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', marginTop: 12 }}>
                Rendimento base: {receita.rendimento} {receita.unidadeGera || 'un'}
                {receita.fatorPerda > 0 && <span style={{ color: 'var(--text-tertiary)', marginLeft: 4 }}>(−{receita.fatorPerda}% perda)</span>}
                {receita.custoUnid > 0 && ` · R$ ${receita.custoUnid.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/${receita.unidadeGera || 'un'}`}
              </div>
            )}

            {receita.instrucoes && (
              <>
                <div className="section-label" style={{ marginTop: 16 }}>Modo de preparo</div>
                <div className="card" style={{ padding: '12px 14px', whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.7, color: 'var(--text-secondary)' }}>
                  {receita.instrucoes}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  )
}
