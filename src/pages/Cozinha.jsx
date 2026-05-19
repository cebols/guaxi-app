import { useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useData } from '../hooks/useData'
import { getReceitas } from '../services/db'

const ACAO_MAP = {
  misturar:     { icon: '🥣', label: 'Misturar' },
  bater:        { icon: '⚡', label: 'Bater' },
  mixar:        { icon: '🌀', label: 'Mixar' },
  liquidificar: { icon: '🫧', label: 'Liquidificar' },
  processar:    { icon: '⚙️', label: 'Processar' },
  incorporar:   { icon: '🫙', label: 'Incorporar' },
  ferver:       { icon: '🔥', label: 'Ferver' },
  aquecer:      { icon: '🌡️', label: 'Aquecer' },
  assar:        { icon: '🍳', label: 'Assar' },
  resfriar:     { icon: '❄️', label: 'Resfriar' },
  congelar:     { icon: '🧊', label: 'Congelar' },
  descansar:    { icon: '⏱️', label: 'Descansar' },
  cortar:       { icon: '🔪', label: 'Cortar' },
  esticar:      { icon: '🫓', label: 'Esticar' },
}

function parseInstrucoes(raw) {
  if (!raw) return null
  try {
    const p = JSON.parse(raw)
    if (Array.isArray(p)) return p
  } catch {}
  return raw // plain text fallback
}

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
  const [checked, setChecked] = useState({})
  const [checkedStep, setCheckedStep] = useState({})
  const [modoSimples, setModoSimples] = useState(false)

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

  const toggleChecked = (i) => {
    setChecked(prev => ({ ...prev, [i]: !prev[i] }))
    if (navigator.vibrate) navigator.vibrate(30)
  }
  const toggleStep = (i) => {
    setCheckedStep(prev => ({ ...prev, [i]: !prev[i] }))
    if (navigator.vibrate) navigator.vibrate(30)
  }

  const checkedCount = Object.values(checked).filter(Boolean).length

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div>
            <div className="topbar-title">{loading ? '...' : (receita?.nome || 'Receita')}</div>
            <div className="topbar-sub">Modo cozinha</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-ghost" onClick={() => setModoSimples(s => !s)}>
              {modoSimples ? 'Completo' : 'Simples'}
            </button>
            <button className="btn-ghost" onClick={() => navigate(`/fichas/${id}/editar`)}>
              Editar
            </button>
            <button className="btn-ghost" onClick={() => navigate('/fichas')}>
              ←
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
            {/* DOSES + RENDIMENTO — compact controls */}
            <div className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Doses</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={fator}
                  onChange={e => onFatorChange(e.target.value)}
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    width: 56,
                    background: 'var(--surface2)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    outline: 'none',
                    textAlign: 'center',
                    color: 'var(--text-primary)',
                    padding: '4px 0',
                  }}
                />
                <span style={{ fontSize: 16, color: 'var(--text-secondary)' }}>×</span>
              </div>

              {pesoBase > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Rendimento</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={pesoInput || Math.round(pesoBase * fator).toLocaleString('pt-BR')}
                    onChange={e => onPesoChange(e.target.value)}
                    style={{
                      fontSize: 22,
                      fontWeight: 700,
                      background: 'var(--surface2)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      outline: 'none',
                      textAlign: 'center',
                      color: 'var(--text-primary)',
                      padding: '4px 8px',
                      minWidth: `${Math.max(64, String(Math.round(pesoBase * fator)).length * 14 + 16)}px`,
                    }}
                  />
                  <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>g</span>
                  {receita.rendimento > 0 && (
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                      · {Math.round(receita.rendimento * fator)} un
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* INGREDIENTES checklist */}
            <div style={{ fontSize: 11, letterSpacing: 2, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 8 }}>
              Ingredientes · {checkedCount} de {ingredientes.length} prontos
            </div>
            <div className="card card-flush">
              {ingredientes.map((ing, i) => {
                const isChecked = !!checked[i]
                return (
                  <div
                    key={i}
                    onClick={() => toggleChecked(i)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 16,
                      padding: '16px 14px',
                      borderBottom: i < ingredientes.length - 1 ? '1px solid var(--border)' : 'none',
                      cursor: 'pointer',
                      opacity: isChecked ? 0.4 : 1,
                      transition: 'opacity 0.15s',
                      userSelect: 'none',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    {/* Circle checkbox */}
                    <div style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      border: `2.5px solid ${isChecked ? 'var(--teal)' : 'var(--border)'}`,
                      background: isChecked ? 'var(--teal)' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      transition: 'all 0.15s',
                    }}>
                      {isChecked && (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>

                    {/* Name */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {ing.subReceitaId && (
                        <span style={{ fontSize: 10, background: 'var(--teal)', color: '#fff', borderRadius: 4, padding: '1px 4px', marginRight: 6, fontWeight: 700 }}>R</span>
                      )}
                      <span style={{
                        fontSize: 18,
                        fontWeight: 500,
                        textDecoration: isChecked ? 'line-through' : 'none',
                        color: isChecked ? 'var(--text-secondary)' : 'var(--text-primary)',
                      }}>
                        {ing.nome}
                      </span>
                    </div>

                    {/* Quantity — large */}
                    <span style={{
                      fontSize: 44,
                      fontWeight: 700,
                      lineHeight: 1,
                      color: isChecked ? 'var(--text-secondary)' : 'var(--teal)',
                      letterSpacing: -1,
                      flexShrink: 0,
                    }}>
                      {fmtQty(ing.quantidade * fator, ing.unidade)}
                    </span>
                  </div>
                )
              })}
            </div>

            {!modoSimples && receita.rendimento > 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', marginTop: 12 }}>
                Rendimento base: {receita.rendimento} {receita.unidadeGera || 'un'}
                {receita.fatorPerda > 0 && <span style={{ color: 'var(--text-tertiary)', marginLeft: 4 }}>(−{receita.fatorPerda}% perda)</span>}
                {receita.custoUnid > 0 && ` · R$ ${receita.custoUnid.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/${receita.unidadeGera || 'un'}`}
              </div>
            )}

            {!modoSimples && (receita.tempForno || receita.tempoForno) && (
              <div className="card" style={{ background: '#2a1a00', border: '1px solid #6b3d00', marginTop: 16, display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px' }}>
                <span style={{ fontSize: 28 }}>🔥</span>
                <div>
                  <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#c97a30', fontWeight: 700 }}>Forno</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#f0a050', marginTop: 2, lineHeight: 1 }}>
                    {receita.tempForno ? `${receita.tempForno}°C` : '—'}
                    {receita.tempoForno ? <span style={{ fontSize: 15, fontWeight: 500, marginLeft: 10, color: '#c97a30' }}>{receita.tempoForno} min</span> : null}
                  </div>
                </div>
              </div>
            )}

            {!modoSimples && receita.tipoResfriamento && (
              <div className="card" style={{ background: '#001a2a', border: '1px solid #00436b', marginTop: 12, display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px' }}>
                <span style={{ fontSize: 28 }}>{receita.tipoResfriamento === 'congelador' ? '🧊' : receita.tipoResfriamento === 'geladeira' ? '❄️' : '🌡️'}</span>
                <div>
                  <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#30a0c9', fontWeight: 700 }}>
                    {{ geladeira: 'Geladeira', congelador: 'Congelador', ambiente: 'Temperatura ambiente' }[receita.tipoResfriamento] || receita.tipoResfriamento}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#50c0f0', marginTop: 2, lineHeight: 1 }}>
                    {receita.tempoResfriamento ? `${receita.tempoResfriamento}h` : 'Tempo a definir'}
                  </div>
                </div>
              </div>
            )}

            {!modoSimples && receita.instrucoes && (() => {
              const parsed = parseInstrucoes(receita.instrucoes)
              if (Array.isArray(parsed) && parsed.length > 0) {
                const doneCount = Object.values(checkedStep).filter(Boolean).length
                return (
                  <>
                    <div style={{ fontSize: 11, letterSpacing: 2, color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: 20, marginBottom: 8 }}>
                      Preparo · {doneCount} de {parsed.length} etapas
                    </div>
                    <div className="card card-flush">
                      {parsed.map((step, i) => {
                        const acao = ACAO_MAP[step.tipo] || ACAO_MAP.misturar
                        const done = !!checkedStep[i]
                        return (
                          <div key={i} onClick={() => toggleStep(i)} style={{
                            display: 'flex', alignItems: 'flex-start', gap: 16,
                            padding: '16px 14px',
                            borderBottom: i < parsed.length - 1 ? '1px solid var(--border)' : 'none',
                            cursor: 'pointer', opacity: done ? 0.4 : 1, transition: 'opacity 0.15s',
                            userSelect: 'none', WebkitTapHighlightColor: 'transparent',
                          }}>
                            <div style={{
                              width: 32, height: 32, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                              border: `2.5px solid ${done ? 'var(--teal)' : 'var(--border)'}`,
                              background: done ? 'var(--teal)' : 'none',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
                            }}>
                              {done
                                ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                                : <span style={{ fontSize: 16 }}>{acao.icon}</span>
                              }
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: 'var(--teal)', textTransform: 'uppercase', marginBottom: 4 }}>
                                {acao.label}
                              </div>
                              <div style={{
                                fontSize: 16, lineHeight: 1.5,
                                color: done ? 'var(--text-secondary)' : 'var(--text-primary)',
                                textDecoration: done ? 'line-through' : 'none',
                              }}>
                                {step.descricao}
                              </div>
                              {step.insumos?.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                                  {step.insumos.map(idx => {
                                    const ing = receita.ingredientes?.[idx]
                                    if (!ing) return null
                                    return (
                                      <span key={idx} style={{
                                        fontSize: 11, padding: '2px 7px', borderRadius: 4,
                                        background: 'var(--bg-secondary)', color: 'var(--text-secondary)',
                                        border: '1px solid var(--border-color)',
                                      }}>
                                        {ing.nome} {ing.quantidade} {ing.unidade}
                                      </span>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )
              }
              // plain text fallback
              return (
                <>
                  <div className="section-label" style={{ marginTop: 16 }}>Modo de preparo</div>
                  <div className="card" style={{ padding: '12px 14px', whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.7, color: 'var(--text-secondary)' }}>
                    {parsed}
                  </div>
                </>
              )
            })()}
          </>
        )}
      </div>
    </>
  )
}
