import { useState, useMemo } from 'react'
import { useData } from '../hooks/useData'
import { getReceitas, getInsumos, getProdutos, saveProducao, getProducoes } from '../services/db'

function norm(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function fmtQtd(v) {
  const n = Number(v || 0)
  return n % 1 === 0 ? String(n) : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function MiseEnPlace() {
  const { data: receitas }           = useData(getReceitas)
  const { data: insumos }            = useData(getInsumos)
  const { data: produtos }           = useData(getProdutos)
  const { data: historico, reload: reloadHist } = useData(getProducoes)
  const [busca, setBusca]            = useState('')
  const [lote, setLote]              = useState([])
  const [sheet, setSheet]            = useState(null) // 'lista' | 'confirmar' | 'historico'
  const [confirmando, setConfirmando] = useState(false)

  const loteIds = useMemo(() => new Set(lote.map(x => x.receitaId)), [lote])

  // Map receita → produto para prioridade
  const prodMap = useMemo(() => {
    const map = {}
    ;(produtos || []).forEach(p => {
      ;(p.receitas || []).forEach(r => { if (r.receitaId) map[r.receitaId] = p })
      map[`n:${norm(p.nome)}`] = p
    })
    return map
  }, [produtos])

  const produtoPorReceita = (rec) => prodMap[rec.id] || prodMap[`n:${norm(rec.nome)}`]

  const urgencia = (rec) => {
    const p = produtoPorReceita(rec)
    if (!p || p.estoqueAtual == null) return 0
    if (p.estoqueAtual === 0) return 3          // crítico
    if (p.estoqueAtual <= p.estoqueMin) return 2 // abaixo do mínimo
    if (p.estoqueMin > 0 && p.estoqueAtual <= p.estoqueMin * 2) return 1 // baixo
    return 0
  }

  const filtradas = useMemo(() => {
    const q = norm(busca)
    return (receitas || [])
      .filter(r => !loteIds.has(r.id) && norm(r.nome).includes(q))
      .sort((a, b) => {
        const ua = urgencia(a), ub = urgencia(b)
        if (ua !== ub) return ub - ua
        return a.nome.localeCompare(b.nome, 'pt-BR')
      })
  }, [receitas, busca, loteIds, prodMap])

  function addReceita(rec) {
    setLote(l => [...l, { receitaId: rec.id, nome: rec.nome, qtd: 1 }])
  }

  function setQtd(receitaId, v) {
    const n = parseInt(v) || 0
    if (n <= 0) setLote(l => l.filter(x => x.receitaId !== receitaId))
    else setLote(l => l.map(x => x.receitaId === receitaId ? { ...x, qtd: n } : x))
  }

  const necessarios = useMemo(() => {
    const map = {}
    lote.forEach(({ receitaId, qtd }) => {
      const rec = (receitas || []).find(r => r.id === receitaId)
      if (!rec) return
      ;(rec.ingredientes || []).forEach(ing => {
        const key = ing.insumoId ? `id:${ing.insumoId}` : `nome:${norm(ing.nome)}`
        if (!map[key]) map[key] = { insumoId: ing.insumoId, nome: ing.nome, unidade: ing.unidade, necessario: 0 }
        map[key].necessario += ing.quantidade * qtd
      })
    })
    const estMap = Object.fromEntries((insumos || []).map(i => [i.id, i.estoque || 0]))
    return Object.values(map).map(item => ({
      ...item,
      estoque: item.insumoId ? (estMap[item.insumoId] || 0) : null,
    })).sort((a, b) => {
      // faltas primeiro
      const fa = a.estoque !== null && a.estoque < a.necessario
      const fb = b.estoque !== null && b.estoque < b.necessario
      if (fa !== fb) return fa ? -1 : 1
      return a.nome.localeCompare(b.nome, 'pt-BR')
    })
  }, [lote, receitas, insumos])

  const temFalta = necessarios.some(n => n.estoque !== null && n.estoque < n.necessario)

  async function handleConfirmar() {
    setConfirmando(true)
    try {
      await saveProducao(lote, receitas || [])
      await reloadHist()
      setLote([])
      setSheet(null)
    } catch (e) {
      alert('Erro ao confirmar: ' + e.message)
    } finally {
      setConfirmando(false)
    }
  }

  const btnStyle = {
    width: 28, height: 28, borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--bg-secondary, #374151)',
    color: 'var(--text-primary)',
    cursor: 'pointer', fontSize: 16,
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  }

  const BADGE = {
    3: { label: '🔴 Esgotado', color: '#ef4444' },
    2: { label: '🟠 Abaixo mín', color: '#f97316' },
    1: { label: '🟡 Baixo', color: '#f59e0b' },
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div className="topbar-title">Mise en place</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setSheet('historico')} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
              Histórico
            </button>
            {lote.length > 0 && (
              <button onClick={() => setSheet('lista')} style={{
                background: temFalta ? '#f59e0b' : 'var(--teal)',
                color: '#fff', border: 'none', borderRadius: 8,
                padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>
                {temFalta ? '⚠ Ver lista' : '✓ Ver lista'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="page-content">
        {lote.length > 0 && (
          <div className="card" style={{ padding: '10px 14px', marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Produção de hoje</div>
            {lote.map(item => {
              const rec = (receitas || []).find(r => r.id === item.receitaId)
              return (
                <div key={item.receitaId} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{item.nome}</div>
                  {rec && (
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>
                      → {fmtQtd(rec.rendimento * item.qtd)} {rec.unidadeGera}
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button onClick={() => setQtd(item.receitaId, item.qtd - 1)} style={btnStyle}>−</button>
                    <input
                      type="text" inputMode="numeric" value={item.qtd}
                      onChange={e => setQtd(item.receitaId, e.target.value)}
                      style={{ width: 36, textAlign: 'center', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0', fontSize: 13, background: 'var(--card-bg)', color: 'var(--text-primary)' }}
                    />
                    <button onClick={() => setQtd(item.receitaId, item.qtd + 1)} style={btnStyle}>+</button>
                  </div>
                </div>
              )
            })}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={() => setSheet('confirmar')} style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: 'var(--teal)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                Confirmar produção
              </button>
              <button onClick={() => setLote([])} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}>
                Limpar
              </button>
            </div>
          </div>
        )}

        <input
          className="field-input"
          placeholder="Buscar receita..."
          value={busca}
          onChange={e => setBusca(e.target.value)}
          style={{ marginBottom: 12 }}
        />

        <div>
          {filtradas.map(rec => {
            const u = urgencia(rec)
            const badge = BADGE[u]
            return (
              <div key={rec.id} className="card"
                style={{ padding: '10px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                onClick={() => addReceita(rec)}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{rec.nome}</span>
                    {badge && <span style={{ fontSize: 10, color: badge.color, fontWeight: 600 }}>{badge.label}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {rec.tipo !== 'Outro' && rec.tipo} · rende {fmtQtd(rec.rendimento)} {rec.unidadeGera}
                  </div>
                </div>
                <span style={{ color: 'var(--text-tertiary)', fontSize: 20 }}>+</span>
              </div>
            )
          })}
          {filtradas.length === 0 && lote.length > 0 && !busca && (
            <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13, paddingTop: 20 }}>
              Todas as receitas estão na lista de produção
            </div>
          )}
        </div>
      </div>

      {/* Sheet: lista de ingredientes por receita */}
      {sheet === 'lista' && (
        <>
          <div className="sheet-overlay" onClick={() => setSheet(null)} />
          <div className="sheet">
            <div className="sheet-title">
              <span>Lista por receita</span>
              <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer' }} onClick={() => setSheet(null)}>×</button>
            </div>
            {lote.map(({ receitaId, qtd }) => {
              const rec = (receitas || []).find(r => r.id === receitaId)
              if (!rec) return null
              return (
                <div key={receitaId} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                    {rec.nome} <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>×{qtd} → {fmtQtd(rec.rendimento * qtd)} {rec.unidadeGera}</span>
                  </div>
                  {(rec.ingredientes || []).map((ing, i) => {
                    const q = ing.quantidade * qtd
                    return (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                        <span style={{ color: 'var(--text-primary)' }}>{ing.nome}</span>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{fmtQtd(q)}{ing.unidade}</span>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Sheet: confirmar produção */}
      {sheet === 'confirmar' && (
        <>
          <div className="sheet-overlay" onClick={() => setSheet(null)} />
          <div className="sheet">
            <div className="sheet-title">
              <span>Confirmar produção</span>
              <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer' }} onClick={() => setSheet(null)}>×</button>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              Isso vai debitar os ingredientes do estoque e salvar no histórico.
            </div>
            {lote.map(item => {
              const rec = (receitas || []).find(r => r.id === item.receitaId)
              return (
                <div key={item.receitaId} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>{item.nome}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    ×{item.qtd} → {rec ? `${fmtQtd(rec.rendimento * item.qtd)} ${rec.unidadeGera}` : `${item.qtd} lote(s)`}
                  </span>
                </div>
              )
            })}
            <button
              disabled={confirmando}
              onClick={handleConfirmar}
              style={{ width: '100%', marginTop: 16, padding: '13px', borderRadius: 10, border: 'none', background: 'var(--teal)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: confirmando ? 'wait' : 'pointer' }}>
              {confirmando ? 'Salvando...' : 'Confirmar e salvar'}
            </button>
          </div>
        </>
      )}

      {/* Sheet: histórico */}
      {sheet === 'historico' && (
        <>
          <div className="sheet-overlay" onClick={() => setSheet(null)} />
          <div className="sheet">
            <div className="sheet-title">
              <span>Histórico de produções</span>
              <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer' }} onClick={() => setSheet(null)}>×</button>
            </div>
            {(historico || []).length === 0 ? (
              <div style={{ color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>Nenhuma produção registrada</div>
            ) : (historico || []).map(prod => (
              <div key={prod.id} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>{fmtDate(prod.createdAt)}</div>
                {prod.itens.map((item, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
                    <span style={{ fontWeight: 600 }}>{item.nome}</span>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      ×{item.quantidade}
                      {item.rendimentoTotal ? ` → ${fmtQtd(item.rendimentoTotal)} ${item.unidadeGera}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}
