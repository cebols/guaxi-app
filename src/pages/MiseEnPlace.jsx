import { useState, useMemo } from 'react'
import { useData } from '../hooks/useData'
import { getReceitas, getInsumos } from '../services/db'

function norm(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function fmtQtd(v) {
  const n = Number(v || 0)
  return n % 1 === 0 ? String(n) : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

export default function MiseEnPlace() {
  const { data: receitas } = useData(getReceitas)
  const { data: insumos }  = useData(getInsumos)
  const [busca, setBusca]  = useState('')
  const [lote, setLote]    = useState([])
  const [sheet, setSheet]  = useState(false)

  const loteIds = useMemo(() => new Set(lote.map(x => x.receitaId)), [lote])

  const filtradas = useMemo(() =>
    (receitas || []).filter(r => !loteIds.has(r.id) && norm(r.nome).includes(norm(busca))),
    [receitas, busca, loteIds]
  )

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
    })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [lote, receitas, insumos])

  const temFalta = necessarios.some(n => n.estoque !== null && n.estoque < n.necessario)

  const btnStyle = {
    width: 28, height: 28, borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--bg-secondary, #374151)',
    color: 'var(--text-primary)',
    cursor: 'pointer', fontSize: 16,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div className="topbar-title">Mise en place</div>
          {lote.length > 0 && (
            <button onClick={() => setSheet(true)} style={{
              background: temFalta ? '#f59e0b' : 'var(--teal)',
              color: '#fff', border: 'none', borderRadius: 8,
              padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>
              {temFalta ? '⚠ Ver lista' : '✓ Ver lista'}
            </button>
          )}
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
                      type="text" inputMode="numeric"
                      value={item.qtd}
                      onChange={e => setQtd(item.receitaId, e.target.value)}
                      style={{ width: 36, textAlign: 'center', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0', fontSize: 13, background: 'var(--card-bg)', color: 'var(--text-primary)' }}
                    />
                    <button onClick={() => setQtd(item.receitaId, item.qtd + 1)} style={btnStyle}>+</button>
                  </div>
                </div>
              )
            })}
            <button onClick={() => setLote([])} style={{ marginTop: 6, fontSize: 11, color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Limpar lista</button>
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
          {filtradas.map(rec => (
            <div key={rec.id} className="card"
              style={{ padding: '10px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
              onClick={() => addReceita(rec)}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{rec.nome}</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {rec.tipo !== 'Outro' && rec.tipo} · rende {fmtQtd(rec.rendimento)} {rec.unidadeGera}
                </div>
              </div>
              <span style={{ color: 'var(--text-tertiary)', fontSize: 20 }}>+</span>
            </div>
          ))}
          {filtradas.length === 0 && lote.length > 0 && !busca && (
            <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13, paddingTop: 20 }}>
              Todas as receitas estão na lista de produção
            </div>
          )}
        </div>
      </div>

      {sheet && (
        <>
          <div className="sheet-overlay" onClick={() => setSheet(false)} />
          <div className="sheet">
            <div className="sheet-title">
              <span>Ingredientes necessários</span>
              <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer' }} onClick={() => setSheet(false)}>×</button>
            </div>

            {temFalta && (
              <div style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid #f59e0b', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#f59e0b' }}>
                ⚠ Alguns ingredientes estão abaixo do necessário
              </div>
            )}

            {necessarios.map((item, i) => {
              const falta = item.estoque !== null && item.estoque < item.necessario
              const ok    = item.estoque !== null && item.estoque >= item.necessario
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: falta ? '#ef4444' : 'var(--text-primary)' }}>{item.nome}</div>
                    {item.estoque !== null && (
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        Estoque: {fmtQtd(item.estoque)} {item.unidade}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: falta ? '#ef4444' : 'var(--text-primary)' }}>
                      {fmtQtd(item.necessario)} {item.unidade}
                    </div>
                    {falta && (
                      <div style={{ fontSize: 11, color: '#ef4444' }}>
                        falta {fmtQtd(item.necessario - item.estoque)} {item.unidade}
                      </div>
                    )}
                    {ok && <div style={{ fontSize: 11, color: 'var(--teal)' }}>✓</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}
