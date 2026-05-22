import { useState, useCallback, Fragment } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useData } from '../hooks/useData'
import { getReceitas, deleteReceitas, saveReceita, getInsumos } from '../services/db'

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

  const { data: insumos } = useData(getInsumos)
  const receita = (receitas || []).find(r => String(r.id) === String(id))
  const ingredientes = receita?.ingredientes || []

  const [fator, setFator] = useState(1)
  const [pesoInput, setPesoInput] = useState('')
  const [checked, setChecked] = useState({})
  const [checkedStep, setCheckedStep] = useState({})
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmExcluir, setConfirmExcluir] = useState(false)

  const pesoBase = ingredientes.reduce((s, i) => {
    if (i.unidade === 'g' || i.unidade === 'ml') return s + i.quantidade
    if (i.unidade === 'kg' || i.unidade === 'L') return s + i.quantidade * 1000
    if (i.unidade === 'un') {
      const insumo = (insumos || []).find(ins => ins.id === i.insumoId || ins.nome === i.nome)
      if (insumo?.pesoUn > 0) return s + i.quantidade * insumo.pesoUn
    }
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

  const [expandedSubs, setExpandedSubs] = useState(new Set())

  const toggleChecked = (i) => {
    setChecked(prev => ({ ...prev, [i]: !prev[i] }))
    if (navigator.vibrate) navigator.vibrate(30)
  }
  const toggleStep = (i) => {
    setCheckedStep(prev => ({ ...prev, [i]: !prev[i] }))
    if (navigator.vibrate) navigator.vibrate(30)
  }
  const toggleSub = (i) => {
    setExpandedSubs(prev => {
      const n = new Set(prev)
      n.has(i) ? n.delete(i) : n.add(i)
      return n
    })
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => navigate(`/fichas/${id}/editar`)} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--text-secondary)' }}>✏️ Editar</button>
            <div style={{ position: 'relative' }}>
              <button onClick={() => setMenuOpen(o => !o)} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 11px', fontSize: 16, cursor: 'pointer', color: 'var(--text-secondary)', lineHeight: 1 }}>···</button>
              {menuOpen && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 98 }} onClick={() => setMenuOpen(false)} />
                  <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 99, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, minWidth: 150, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden' }}>
                    <button onClick={() => { navigate(`/fichas/${id}/editar`); setMenuOpen(false) }} style={{ width: '100%', padding: '11px 14px', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left', fontSize: 13, color: 'var(--text-primary)' }}>✏️ Editar</button>
                    <button onClick={async () => {
                      setMenuOpen(false)
                      if (!receita) return
                      try {
                        const ings = (receita.ingredientes || []).map(i => ({ nome: i.nome, quantidade: i.quantidade, unidade: i.unidade, insumoId: i.insumoId, subReceitaId: i.subReceitaId }))
                        await saveReceita({ nome: `${receita.nome} (cópia)`, tipo: receita.tipo, rendimento: receita.rendimento, unidadeGera: receita.unidadeGera, pesoLiquido: receita.pesoLiquido, fatorPerda: receita.fatorPerda, instrucoes: receita.instrucoes, custoTotal: receita.custoTotal, custoUnid: receita.custoUnid }, ings)
                        navigate('/fichas')
                      } catch (e) { alert('Erro: ' + e.message) }
                    }} style={{ width: '100%', padding: '11px 14px', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left', fontSize: 13, color: 'var(--text-primary)' }}>⎘ Duplicar</button>
                    <button onClick={() => { setMenuOpen(false); setConfirmExcluir(true) }} style={{ width: '100%', padding: '11px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 13, color: 'var(--alert-text)' }}>🗑️ Excluir</button>
                  </div>
                </>
              )}
            </div>
            <button className="btn-ghost" onClick={() => navigate('/fichas')} style={{ fontSize: 16, padding: '5px 10px' }}>←</button>
          </div>
          {confirmExcluir && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)' }}>
              <div style={{ background: 'var(--bg-card)', borderRadius: 14, padding: 24, maxWidth: 300, width: '90%', textAlign: 'center' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>🗑️</div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Excluir {receita?.nome}?</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 18 }}>Essa ação não pode ser desfeita.</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setConfirmExcluir(false)} style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}>Cancelar</button>
                  <button onClick={async () => {
                    try { await deleteReceitas([receita.id]); navigate('/fichas') }
                    catch (e) { alert('Erro: ' + e.message); setConfirmExcluir(false) }
                  }} style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: '#7f1d1d', color: '#fca5a5', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>Excluir</button>
                </div>
              </div>
            </div>
          )}
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
            {/* DOSES + RENDIMENTO */}
            <div className="card" style={{ padding: '12px 16px', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', flexShrink: 0 }}>Doses</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={fator}
                  onChange={e => onFatorChange(e.target.value)}
                  style={{ fontSize: 22, fontWeight: 700, width: 56, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, outline: 'none', textAlign: 'center', color: 'var(--text-primary)', padding: '4px 0', flexShrink: 0 }}
                />
                {pesoBase > 0 && <>
                  <span style={{ fontSize: 14, color: 'var(--text-secondary)', flexShrink: 0 }}>×</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={pesoInput || Math.round(pesoBase * fator).toLocaleString('pt-BR')}
                    onChange={e => onPesoChange(e.target.value)}
                    style={{ fontSize: 22, fontWeight: 700, width: 88, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, outline: 'none', textAlign: 'center', color: 'var(--text-primary)', padding: '4px 0', flexShrink: 0 }}
                  />
                  <span style={{ fontSize: 14, color: 'var(--text-secondary)', flexShrink: 0 }}>g
                    {receita.rendimento > 0 && !['g', 'ml', 'kg', 'L'].includes(receita.unidadeGera) &&
                      ` · ${Math.round(receita.rendimento * fator)} ${receita.unidadeGera || 'un'}`}
                  </span>
                </>}
              </div>
            </div>

            {/* INGREDIENTES checklist */}
            <>
                <div style={{ fontSize: 11, letterSpacing: 2, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 8 }}>
                  Ingredientes · {checkedCount} de {ingredientes.length} prontos
                </div>
                <div className="card card-flush">
                  {ingredientes.map((ing, i) => {
                    const isChecked = !!checked[i]
                    const isSubExpanded = expandedSubs.has(i)
                    const subRec = ing.subReceitaId ? (receitas || []).find(r => r.id === ing.subReceitaId) : null
                    return (
                      <Fragment key={i}>
                        <div
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
                            border: `2.5px solid ${isChecked ? 'var(--teal)' : '#555'}`,
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
                              <button
                                onClick={e => { e.stopPropagation(); toggleSub(i) }}
                                style={{
                                  fontSize: 10,
                                  background: isSubExpanded ? 'transparent' : 'var(--teal)',
                                  color: isSubExpanded ? 'var(--teal)' : '#fff',
                                  border: isSubExpanded ? '1.5px solid var(--teal)' : 'none',
                                  borderRadius: 4,
                                  padding: '1px 4px',
                                  marginRight: 6,
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  lineHeight: 1.6,
                                }}
                              >R</button>
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
                        {isSubExpanded && subRec && (
                          <div style={{ borderLeft: '3px solid var(--teal)', marginLeft: 32, paddingLeft: 12, marginBottom: 8 }}>
                            {(subRec.ingredientes || []).map((subIng, si) => {
                              const subScale = (ing.quantidade * fator) / (subRec.rendimento || 1)
                              return (
                                <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', fontSize: 14, color: 'var(--text-secondary)' }}>
                                  <span style={{ flex: 1, minWidth: 0 }}>{subIng.nome}</span>
                                  <span style={{ color: 'var(--teal)', fontWeight: 700, flexShrink: 0 }}>{fmtQty(subIng.quantidade * subScale, subIng.unidade)}</span>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </Fragment>
                    )
                  })}
                </div>
            </>

            {/* detalhado removed */ false && (() => {
              const steps = receita.instrucoes ? parseInstrucoes(receita.instrucoes) : []
              if (!Array.isArray(steps) || steps.length === 0) {
                // fallback to ingredient checklist
                return (
                  <>
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
                            <div style={{
                              width: 32, height: 32, borderRadius: '50%',
                              border: `2.5px solid ${isChecked ? 'var(--teal)' : 'var(--border)'}`,
                              background: isChecked ? 'var(--teal)' : 'none',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              flexShrink: 0, transition: 'all 0.15s',
                            }}>
                              {isChecked && (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              )}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              {ing.subReceitaId && (
                                <span style={{ fontSize: 10, background: 'var(--teal)', color: '#fff', borderRadius: 4, padding: '1px 4px', marginRight: 6, fontWeight: 700 }}>R</span>
                              )}
                              <span style={{ fontSize: 18, fontWeight: 500, textDecoration: isChecked ? 'line-through' : 'none', color: isChecked ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
                                {ing.nome}
                              </span>
                            </div>
                            <span style={{ fontSize: 44, fontWeight: 700, lineHeight: 1, color: isChecked ? 'var(--text-secondary)' : 'var(--teal)', letterSpacing: -1, flexShrink: 0 }}>
                              {fmtQty(ing.quantidade * fator, ing.unidade)}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )
              }
              const linkedIdxs = new Set(steps.flatMap(s => s.insumos || []))
              const orphans = ingredientes.filter((_, i) => !linkedIdxs.has(i))
              const doneCount = Object.values(checkedStep).filter(Boolean).length
              return (
                <>
                  <div style={{ fontSize: 11, letterSpacing: 2, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 8 }}>
                    Etapas · {doneCount} de {steps.length}
                  </div>
                  {steps.map((step, si) => {
                    const acao = ACAO_MAP[step.tipo] || ACAO_MAP.misturar
                    const stepIngs = (step.insumos || []).map(idx => ({ idx, ing: ingredientes[idx] })).filter(x => x.ing)
                    const done = !!checkedStep[si]
                    return (
                      <div key={si} style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: '12px 14px', marginBottom: 8, opacity: done ? 0.5 : 1, transition: 'opacity .15s' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: stepIngs.length > 0 || step.descricao ? 8 : 0 }}
                          onClick={() => toggleStep(si)}>
                          <div style={{ width: 26, height: 26, borderRadius: '50%', background: done ? 'var(--teal)' : 'var(--bg-card)', border: `2px solid ${done ? 'var(--teal)' : 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}>
                            {done
                              ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                              : <span style={{ fontSize: 13 }}>{acao.icon}</span>
                            }
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>{acao.label}</span>
                        </div>
                        {step.descricao && (
                          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: stepIngs.length > 0 ? 8 : 0 }}>
                            {step.descricao}
                          </div>
                        )}
                        {stepIngs.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {stepIngs.map(({ idx, ing }) => {
                              const isChecked = !!checked[idx]
                              return (
                                <div key={idx} onClick={() => toggleChecked(idx)}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    padding: '7px 10px', borderRadius: 8,
                                    background: isChecked ? 'var(--teal-light)' : 'var(--bg-card)',
                                    border: `1px solid ${isChecked ? 'var(--teal)' : 'var(--border)'}`,
                                    cursor: 'pointer', opacity: isChecked ? 0.6 : 1,
                                  }}>
                                  <div style={{ width: 14, height: 14, borderRadius: '50%', border: `1.5px solid ${isChecked ? 'var(--teal)' : '#555'}`, background: isChecked ? 'var(--teal)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    {isChecked && <span style={{ fontSize: 9, color: '#000', fontWeight: 700 }}>✓</span>}
                                  </div>
                                  <span style={{ fontSize: 12, fontWeight: 500 }}>{ing.nome}</span>
                                  <span style={{ fontSize: 14, fontWeight: 700, color: isChecked ? 'var(--text-tertiary)' : 'var(--teal)' }}>
                                    {fmtQty(ing.quantidade * fator, ing.unidade)}
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {orphans.length > 0 && (
                    <>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, marginBottom: 6, marginTop: 4 }}>Outros ingredientes</div>
                      <div className="card card-flush">
                        {orphans.map((ing, i) => {
                          const realIdx = ingredientes.indexOf(ing)
                          const isChecked = !!checked[realIdx]
                          return (
                            <div key={i} onClick={() => toggleChecked(realIdx)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: i < orphans.length - 1 ? '1px solid var(--border)' : 'none', cursor: 'pointer', opacity: isChecked ? 0.4 : 1, transition: 'opacity .15s' }}>
                              <div style={{ width: 24, height: 24, borderRadius: '50%', border: `2px solid ${isChecked ? 'var(--teal)' : 'var(--border)'}`, background: isChecked ? 'var(--teal)' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                {isChecked && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                              </div>
                              <span style={{ flex: 1, fontSize: 15, fontWeight: 500 }}>{ing.nome}</span>
                              <span style={{ fontSize: 36, fontWeight: 700, color: isChecked ? 'var(--text-secondary)' : 'var(--teal)', letterSpacing: -1 }}>{fmtQty(ing.quantidade * fator, ing.unidade)}</span>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}
                </>
              )
            })()}

            {/* Rendimento info — both modes */}
            {receita.rendimento > 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', marginTop: 12 }}>
                Rendimento base: {receita.rendimento} {receita.unidadeGera || 'un'}
                {receita.fatorPerda > 0 && <span style={{ color: 'var(--text-tertiary)', marginLeft: 4 }}>(−{receita.fatorPerda}% perda)</span>}
                {receita.custoUnid > 0 && ` · R$ ${receita.custoUnid.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/${receita.unidadeGera || 'un'}`}
                {receita.porcoes > 1 && receita.custoTotal > 0 ? ` · R$ ${(receita.custoTotal * fator / receita.porcoes).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/porção` : ''}
              </div>
            )}

            {/* Forno — both modes */}
            {(receita.tempForno || receita.tempoForno) && (
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

            {/* Resfriamento — both modes */}
            {receita.tipoResfriamento && (
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

            {/* Instrucoes steps — Compacto mode only */}
            {receita.instrucoes && (() => {
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
