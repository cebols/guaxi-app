import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../hooks/useData'
import {
  getReceitas, getInsumos, getProdutos,
  saveProducao, getProducoes, computeAjustesPendentes,
} from '../services/db'

function norm(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function fmtQtd(v) {
  const n = Number(v || 0)
  if (n === 0) return '0'
  if (n < 1) return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  return n % 1 === 0 ? String(n) : n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
}

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const PESO_UNITS = new Set(['g', 'ml', 'kg', 'L'])

function dosesParaItem(item, rec) {
  if (!rec || !rec.rendimento) return 0
  if (item.modo === 'peso_liquido' && rec.fatorPerda != null) {
    const bruto = (item.valorAlvo || 0) / (1 - rec.fatorPerda / 100)
    return bruto / rec.rendimento
  }
  if (item.modo === 'unidades') return (item.valorAlvo || 0) / rec.rendimento
  return item.qtd || 0
}

export default function MiseEnPlace() {
  const navigate = useNavigate()
  const { data: receitas } = useData(getReceitas)
  const { data: insumos }  = useData(getInsumos)
  const { data: produtos } = useData(getProdutos)
  const { data: producoes } = useData(getProducoes)

  const [busca, setBusca]             = useState('')
  const [filtroTipo, setFiltroTipo]   = useState('todos') // 'todos' | 'receitas' | 'produtos'
  const [lote, setLote]               = useState([])      // [{ tipo, refId, nome, qtd, modo?, valorAlvo? }]
  const [sheet, setSheet]             = useState(null)
  const [confirmando, setConfirmando] = useState(false)

  const inLote = (tipo, id) => lote.some(x => x.tipo === tipo && x.refId === id)

  const filtrados = useMemo(() => {
    const q = norm(busca)
    const recs = (receitas || []).filter(r => norm(r.nome).includes(q))
      .map(r => ({ tipo: 'receita', id: r.id, nome: r.nome, sub: `${r.tipo !== 'Outro' ? r.tipo + ' · ' : ''}rende ${fmtQtd(r.rendimento)} ${r.unidadeGera}` }))
    const prods = (produtos || []).filter(p => p.tipo !== 'avulso' && norm(p.nome).includes(q))
      .map(p => ({ tipo: 'produto', id: p.id, nome: p.nome, sub: `${(p.receitas || []).length} receita(s)` }))
    if (filtroTipo === 'receitas') return recs
    if (filtroTipo === 'produtos') return prods
    return [...prods, ...recs]
  }, [receitas, produtos, busca, filtroTipo])

  function toggle(tipo, item) {
    if (inLote(tipo, item.id)) {
      setLote(l => l.filter(x => !(x.tipo === tipo && x.refId === item.id)))
      return
    }
    if (tipo === 'produto') {
      setLote(l => [...l, { tipo: 'produto', refId: item.id, nome: item.nome, qtd: 1 }])
    } else {
      setLote(l => [...l, { tipo: 'receita', refId: item.id, nome: item.nome, qtd: 1, modo: 'doses', valorAlvo: null }])
    }
  }

  function updateItem(idx, patch) {
    setLote(l => l.map((x, i) => i === idx ? { ...x, ...patch } : x))
  }
  function removeItem(idx) {
    setLote(l => l.filter((_, i) => i !== idx))
  }

  // Doses por receita (somando produtos + receitas)
  const dosesPerReceita = useMemo(() => {
    const map = {}
    for (const item of lote) {
      if (item.tipo === 'produto') {
        const prod = (produtos || []).find(p => p.id === item.refId)
        if (!prod) continue
        for (const rr of (prod.receitas || [])) {
          const rec = (receitas || []).find(r => r.id === rr.receitaId)
          if (!rec || !rec.rendimento) continue
          const d = ((rr.quantidade || 1) * (item.qtd || 0)) / rec.rendimento
          map[rr.receitaId] = (map[rr.receitaId] || 0) + d
        }
      } else {
        const rec = (receitas || []).find(r => r.id === item.refId)
        if (!rec) continue
        const d = dosesParaItem(item, rec)
        map[item.refId] = (map[item.refId] || 0) + d
      }
    }
    return map
  }, [lote, produtos, receitas])

  // Mise en place TOTAL (somado) — para checar faltas no estoque
  const debitosTotais = useMemo(() => {
    const map = {}
    for (const [recIdStr, doses] of Object.entries(dosesPerReceita)) {
      const rec = (receitas || []).find(r => r.id === Number(recIdStr))
      if (!rec) continue
      for (const ing of (rec.ingredientes || [])) {
        const key = ing.insumoId ? `id:${ing.insumoId}` : `n:${norm(ing.nome)}`
        if (!map[key]) map[key] = { insumoId: ing.insumoId, nome: ing.nome, unidade: ing.unidade, necessario: 0 }
        map[key].necessario += ing.quantidade * doses
      }
    }
    const estMap = Object.fromEntries((insumos || []).map(i => [i.id, i.estoque || i.estoqueAtual]))
    return Object.values(map).map(it => ({
      ...it,
      estoque: it.insumoId ? (estMap[it.insumoId] ?? null) : null,
    }))
  }, [dosesPerReceita, receitas, insumos])

  const temFalta = debitosTotais.some(d => d.estoque != null && d.estoque < d.necessario)

  // Sugestões de produção: produtos com estoque futuro < mínimo, e ainda não no lote atual
  const sugestoes = useMemo(() => {
    const aju = computeAjustesPendentes(producoes || [])
    const noLote = new Set(lote.filter(x => x.tipo === 'produto').map(x => x.refId))
    return (produtos || [])
      .filter(p => p.tipo !== 'combo' && p.tipo !== 'avulso' && p.estoqueMin > 0 && !noLote.has(p.id))
      .map(p => {
        const futuro = Math.max(0, (p.estoqueAtual ?? 0) + (aju.produtos?.[p.id] || 0))
        const falta = p.estoqueMin - futuro
        return { ...p, futuro, falta }
      })
      .filter(p => p.falta > 0)
      .sort((a, b) => b.falta - a.falta)
      .slice(0, 4)
  }, [producoes, produtos, lote])

  function addProdutoSugerido(prod, qtd) {
    setLote(l => [...l, { tipo: 'produto', refId: prod.id, nome: prod.nome, qtd }])
  }

  // Última produção não concluída
  const ultimaIncompleta = useMemo(() => {
    for (const prod of (producoes || [])) {
      const receitaIds = new Set(
        prod.itens.flatMap(i => i.snapshot?.dosesContrib ? Object.keys(i.snapshot.dosesContrib) : (i.receitaId ? [String(i.receitaId)] : []))
      )
      const total = receitaIds.size
      const done = (prod.checks || []).filter(c => receitaIds.has(String(c))).length
      if (total > 0 && done < total) return { ...prod, total, done, pct: Math.round(done / total * 100) }
    }
    return null
  }, [producoes])

  async function handleConfirmar() {
    setConfirmando(true)
    try {
      const prodId = await saveProducao(lote, receitas || [], produtos || [])
      setLote([])
      setSheet(null)
      if (prodId) navigate(`/producao/${prodId}`)
    } catch (e) {
      alert('Erro ao confirmar: ' + e.message)
    } finally {
      setConfirmando(false)
    }
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div className="topbar-title">Planejar produção</div>
          {lote.length > 0 && (
            <button onClick={() => setSheet('recibo')} style={{
              background: temFalta ? '#f59e0b' : 'var(--teal)',
              color: '#fff', border: 'none', borderRadius: 8,
              padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>
              {temFalta ? '⚠ Ver recibo' : `✓ Ver recibo (${lote.length})`}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
        <div style={{ display: 'flex', maxWidth: 640, margin: '0 auto', padding: '0 12px' }}>
          <button style={{ padding: '12px 16px', background: 'none', border: 'none', borderBottom: '2px solid var(--teal)', fontSize: 13, cursor: 'pointer', color: 'var(--teal)', fontWeight: 700 }}>
            Mise en place
          </button>
          <button onClick={() => navigate('/mise-en-place/historico')} style={{ padding: '12px 16px', background: 'none', border: 'none', fontSize: 13, cursor: 'pointer', color: 'var(--text-secondary)', fontWeight: 500 }}>
            Histórico
          </button>
        </div>
      </div>

      <div className="page-content">
        {ultimaIncompleta && (
          <button onClick={() => navigate(`/producao/${ultimaIncompleta.id}`)} style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12,
            padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
            background: 'rgba(96,165,250,0.08)', border: '1px solid #60a5fa', textAlign: 'left',
          }}>
            <span style={{ fontSize: 20, flexShrink: 0 }}>▶</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: 0.4 }}>Continuar produção</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginTop: 2 }}>
                {fmtDate(ultimaIncompleta.createdAt)} · {ultimaIncompleta.done}/{ultimaIncompleta.total} receitas
              </div>
              <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', marginTop: 5 }}>
                <div style={{ height: '100%', width: `${ultimaIncompleta.pct}%`, background: '#60a5fa' }} />
              </div>
            </div>
            <span style={{ color: '#60a5fa', fontSize: 18, flexShrink: 0 }}>›</span>
          </button>
        )}
        {sugestoes.length > 0 && lote.length === 0 && (
          <div className="card" style={{ padding: '10px 14px', marginBottom: 12, background: 'rgba(245,158,11,0.06)', borderColor: '#92400e' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>💡 Sugestões</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>Abaixo do mínimo (considerando produções planejadas)</div>
            {sugestoes.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.nome}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {s.futuro} un · mín. {s.estoqueMin} · faltam {Math.ceil(s.falta)}
                  </div>
                </div>
                <button onClick={() => addProdutoSugerido(s, Math.ceil(s.falta))}
                  style={{ background: 'var(--teal)', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
                  + {Math.ceil(s.falta)}
                </button>
              </div>
            ))}
          </div>
        )}
        {lote.length > 0 && (
          <div className="card" style={{ padding: '10px 14px', marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Produção de hoje</div>
            {lote.map((item, idx) => {
              const rec = item.tipo === 'receita' ? (receitas || []).find(r => r.id === item.refId) : null
              const prod = item.tipo === 'produto' ? (produtos || []).find(p => p.id === item.refId) : null
              return (
                <LoteCard
                  key={idx}
                  item={item} rec={rec} prod={prod}
                  receitas={receitas || []}
                  onUpdate={patch => updateItem(idx, patch)}
                  onRemove={() => removeItem(idx)}
                />
              )
            })}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={() => setSheet('recibo')} style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: 'var(--teal)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                Ver recibo
              </button>
              <button onClick={() => setLote([])} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}>
                Limpar
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {[
            { k: 'todos', l: 'Todos' },
            { k: 'produtos', l: 'Produtos' },
            { k: 'receitas', l: 'Receitas' },
          ].map(t => (
            <button key={t.k} onClick={() => setFiltroTipo(t.k)} style={{
              padding: '6px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
              border: filtroTipo === t.k ? '1px solid var(--teal)' : '1px solid var(--border)',
              background: filtroTipo === t.k ? 'var(--teal)' : 'transparent',
              color: filtroTipo === t.k ? '#fff' : 'var(--text-secondary)',
              fontWeight: filtroTipo === t.k ? 600 : 400,
            }}>{t.l}</button>
          ))}
        </div>

        <input
          className="field-input"
          placeholder="Buscar..."
          value={busca}
          onChange={e => setBusca(e.target.value)}
          style={{ marginBottom: 12 }}
        />

        <div>
          {filtrados.map(item => {
            const inLot = inLote(item.tipo, item.id)
            return (
              <div key={`${item.tipo}-${item.id}`} className="card"
                style={{
                  padding: '10px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                  borderLeft: inLot ? '3px solid var(--teal)' : '3px solid transparent',
                }}
                onClick={() => toggle(item.tipo, item)}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: item.tipo === 'produto' ? '#1e3a5f' : '#334155', color: item.tipo === 'produto' ? '#60a5fa' : '#94a3b8', fontWeight: 600, letterSpacing: 0.3 }}>
                      {item.tipo === 'produto' ? 'PRODUTO' : 'RECEITA'}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{item.nome}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{item.sub}</div>
                </div>
                <span style={{ color: inLot ? 'var(--teal)' : 'var(--text-tertiary)', fontSize: inLot ? 14 : 20, fontWeight: 700 }}>{inLot ? '✓' : '+'}</span>
              </div>
            )
          })}
          {filtrados.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13, paddingTop: 20 }}>
              {busca ? 'Nenhum resultado' : 'Nenhum item disponível'}
            </div>
          )}
        </div>
      </div>

      {/* Sheet: recibo */}
      {sheet === 'recibo' && (
        <ReciboSheet
          lote={lote}
          receitas={receitas || []}
          produtos={produtos || []}
          dosesPerReceita={dosesPerReceita}
          debitosTotais={debitosTotais}
          confirmando={confirmando}
          onClose={() => setSheet(null)}
          onConfirmar={handleConfirmar}
          onUpdateItem={(idx, patch) => updateItem(idx, patch)}
        />
      )}


    </>
  )
}

// ─── Sub-componentes ─────────────────────────────────────────

function LoteCard({ item, rec, prod, receitas, onUpdate, onRemove }) {
  const btnStyle = {
    width: 24, height: 24, borderRadius: 5, border: '1px solid var(--border)',
    background: 'var(--bg-secondary, #374151)', color: 'var(--text-primary)',
    cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  }

  const isProduto = item.tipo === 'produto'
  const isReceita = item.tipo === 'receita'

  const modes = useMemo(() => {
    if (!rec) return ['doses']
    const list = ['doses']
    if (rec.fatorPerda != null && PESO_UNITS.has(rec.unidadeGera)) list.push('peso_liquido')
    if (!PESO_UNITS.has(rec.unidadeGera)) list.push('unidades')
    return list
  }, [rec])

  return (
    <div style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: isProduto ? '#1e3a5f' : '#334155', color: isProduto ? '#60a5fa' : '#94a3b8', fontWeight: 600 }}>
          {isProduto ? 'PRODUTO' : 'RECEITA'}
        </span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{item.nome}</span>
        <button onClick={onRemove} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', fontSize: 16, cursor: 'pointer', padding: 0 }}>×</button>
      </div>

      {isReceita && modes.length > 1 && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          {modes.map(m => (
            <button key={m} onClick={() => {
              let v = null
              if (m === 'peso_liquido') v = Math.round((rec?.rendimento || 0) * (1 - (rec?.fatorPerda || 0) / 100))
              else if (m === 'unidades') v = Math.round(rec?.rendimento || 0)
              onUpdate({ modo: m, valorAlvo: v })
            }}
              style={{
                padding: '3px 9px', borderRadius: 12, fontSize: 11, cursor: 'pointer',
                border: item.modo === m ? '1px solid var(--teal)' : '1px solid var(--border)',
                background: item.modo === m ? 'rgba(20,184,166,0.15)' : 'transparent',
                color: item.modo === m ? 'var(--teal)' : 'var(--text-secondary)',
                fontWeight: item.modo === m ? 600 : 400,
              }}>
              {m === 'doses' ? 'receitas orig.' : m === 'peso_liquido' ? 'peso líq' : 'unidades'}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {isProduto && (
          <>
            <button onClick={() => onUpdate({ qtd: Math.max(0, (item.qtd || 0) - 1) })} style={btnStyle}>−</button>
            <input type="text" inputMode="numeric" value={item.qtd}
              onChange={e => onUpdate({ qtd: parseInt(e.target.value) || 0 })}
              style={{ width: 50, textAlign: 'center', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0', fontSize: 14, background: 'var(--card-bg)', color: 'var(--text-primary)', fontWeight: 700 }}
            />
            <button onClick={() => onUpdate({ qtd: (item.qtd || 0) + 1 })} style={btnStyle}>+</button>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>unidades</span>
          </>
        )}
        {isReceita && item.modo === 'doses' && (
          <>
            <button onClick={() => onUpdate({ qtd: Math.max(0, (item.qtd || 0) - 1) })} style={btnStyle}>−</button>
            <input type="text" inputMode="decimal" value={item.qtd}
              onChange={e => onUpdate({ qtd: parseFloat(e.target.value) || 0 })}
              style={{ width: 50, textAlign: 'center', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0', fontSize: 14, background: 'var(--card-bg)', color: 'var(--text-primary)', fontWeight: 700 }}
            />
            <button onClick={() => onUpdate({ qtd: (item.qtd || 0) + 1 })} style={btnStyle}>+</button>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Receita original → {fmtQtd((rec?.rendimento || 0) * item.qtd)} {rec?.unidadeGera}
              {rec?.fatorPerda != null && PESO_UNITS.has(rec.unidadeGera) ? ` (${fmtQtd((rec.rendimento || 0) * item.qtd * (1 - rec.fatorPerda / 100))} líq)` : ''}
            </span>
          </>
        )}
        {isReceita && item.modo === 'peso_liquido' && (
          <>
            <input type="text" inputMode="decimal" value={item.valorAlvo ?? ''}
              onChange={e => onUpdate({ valorAlvo: parseFloat(e.target.value) || 0 })}
              style={{ width: 70, textAlign: 'center', border: '1px solid var(--teal)', borderRadius: 6, padding: '4px 6px', fontSize: 14, background: 'var(--card-bg)', color: 'var(--teal)', fontWeight: 700 }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {rec?.unidadeGera || 'g'} líq → {fmtQtd(dosesParaItem(item, rec))} dose(s)
            </span>
          </>
        )}
        {isReceita && item.modo === 'unidades' && (
          <>
            <input type="text" inputMode="decimal" value={item.valorAlvo ?? ''}
              onChange={e => onUpdate({ valorAlvo: parseFloat(e.target.value) || 0 })}
              style={{ width: 70, textAlign: 'center', border: '1px solid var(--teal)', borderRadius: 6, padding: '4px 6px', fontSize: 14, background: 'var(--card-bg)', color: 'var(--teal)', fontWeight: 700 }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {rec?.unidadeGera || 'un'} → {fmtQtd(dosesParaItem(item, rec))} dose(s)
            </span>
          </>
        )}
      </div>

      {isReceita && rec && (
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4, paddingLeft: 2 }}>
          1× receita ={' '}
          {!PESO_UNITS.has(rec.unidadeGera)
            ? `${fmtQtd(rec.rendimento)} ${rec.unidadeGera}`
            : rec.fatorPerda != null
              ? `${fmtQtd(rec.rendimento)} ${rec.unidadeGera} bruto · ${fmtQtd(rec.rendimento * (1 - rec.fatorPerda / 100))} ${rec.unidadeGera} líq`
              : `${fmtQtd(rec.rendimento)} ${rec.unidadeGera}`}
        </div>
      )}

      {isProduto && prod && (prod.receitas || []).length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6, paddingLeft: 4 }}>
          <div style={{ fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 3 }}>contém</div>
          {(prod.receitas || []).map((rr, i) => (
            <div key={i} style={{ padding: '1px 0' }}>
              · {fmtQtd((rr.quantidade || 1) * (item.qtd || 0))} {rr.unidadeGera || ''} {rr.nome}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ReciboSheet({ lote, receitas, produtos, dosesPerReceita, debitosTotais, confirmando, onClose, onConfirmar, onUpdateItem }) {
  const [showDebit, setShowDebit] = useState(false)
  const [showCompras, setShowCompras] = useState(false)
  const faltas = debitosTotais.filter(d => d.estoque != null && d.estoque < d.necessario)

  const btnStyle = { width: 24, height: 24, borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-secondary, #374151)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }

  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-title">
          <span>Recibo de produção</span>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer' }} onClick={onClose}>×</button>
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Itens selecionados</div>
        {lote.map((item, i) => {
          const rec = item.tipo === 'receita' ? receitas.find(r => r.id === item.refId) : null
          const isModo = item.modo === 'peso_liquido' || item.modo === 'unidades'
          const curVal = isModo ? (item.valorAlvo || 0) : (item.qtd || 0)
          const unidLabel = item.tipo === 'produto' ? 'un'
            : item.modo === 'peso_liquido' ? `${rec?.unidadeGera || 'g'} líq`
            : item.modo === 'unidades' ? (rec?.unidadeGera || 'un')
            : 'receita(s)'
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '0.5px solid var(--border)', fontSize: 13 }}>
              <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: item.tipo === 'produto' ? '#1e3a5f' : '#334155', color: item.tipo === 'produto' ? '#60a5fa' : '#94a3b8', fontWeight: 600, flexShrink: 0 }}>
                {item.tipo === 'produto' ? 'P' : 'R'}
              </span>
              <span style={{ flex: 1, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.nome}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                <button style={btnStyle} onClick={() => {
                  const next = Math.max(0, curVal - 1)
                  onUpdateItem(i, isModo ? { valorAlvo: next } : item.tipo === 'produto' ? { qtd: next } : { qtd: next })
                }}>−</button>
                <input
                  type="text" inputMode="decimal"
                  value={curVal}
                  onChange={e => {
                    const v = parseFloat(e.target.value) || 0
                    onUpdateItem(i, isModo ? { valorAlvo: v } : item.tipo === 'produto' ? { qtd: v } : { qtd: v })
                  }}
                  onFocus={e => e.target.select()}
                  style={{ width: 46, textAlign: 'center', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 0', fontSize: 13, background: 'var(--card-bg)', color: 'var(--text-primary)', fontWeight: 700 }}
                />
                <button style={btnStyle} onClick={() => {
                  const next = curVal + 1
                  onUpdateItem(i, isModo ? { valorAlvo: next } : item.tipo === 'produto' ? { qtd: next } : { qtd: next })
                }}>+</button>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 28 }}>{unidLabel}</span>
              </div>
            </div>
          )
        })}

        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 14, marginBottom: 6 }}>Mise en place por receita</div>
        {Object.entries(dosesPerReceita).map(([recIdStr, doses]) => {
          const rec = receitas.find(r => r.id === Number(recIdStr))
          if (!rec || doses <= 0) return null
          const fp = rec.fatorPerda || 0
          const renderTotal = (rec.rendimento || 0) * doses
          const liq = renderTotal * (1 - fp / 100)
          return (
            <div key={recIdStr} style={{ marginBottom: 12, padding: '8px 10px', background: 'var(--bg-secondary, #1f2937)', borderRadius: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal)', marginBottom: 6 }}>
                {rec.nome}
                <span style={{ color: 'var(--text-secondary)', fontWeight: 400, marginLeft: 6 }}>
                  {fmtQtd(doses)} Receita original → {fmtQtd(renderTotal)} {rec.unidadeGera}{fp > 0 ? ` (${fmtQtd(liq)} líq)` : ''}
                </span>
              </div>
              {(rec.ingredientes || []).map((ing, i) => {
                const q = ing.quantidade * doses
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12 }}>
                    <span style={{ color: 'var(--text-primary)' }}>{ing.nome}</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{fmtQtd(q)}{ing.unidade}</span>
                  </div>
                )
              })}
            </div>
          )
        })}

        {/* Total a debitar (toggle) */}
        {debitosTotais.length > 0 && (
          <div style={{ marginTop: 14, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <button onClick={() => setShowDebit(s => !s)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 }}>
                Total a debitar do estoque {faltas.length > 0 && <span title="Faltam itens no estoque" style={{ color: '#f59e0b', marginLeft: 4 }}>⚠</span>}
              </span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 13, transform: showDebit ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
            </button>
            {showDebit && (
              <div style={{ padding: '0 12px 10px' }}>
                {debitosTotais.map((it, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12 }}>
                    <span style={{ color: it.estoque != null && it.estoque < it.necessario ? 'var(--alert-text, #ef4444)' : 'var(--text-primary)' }}>{it.nome}</span>
                    <span style={{ fontWeight: 600 }}>{fmtQtd(it.necessario)}{it.unidade}{it.estoque != null && it.estoque < it.necessario ? ' ⚠' : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Lista de compras (se houver faltas) */}
        {faltas.length > 0 && (
          <div style={{ marginTop: 8, border: '1px solid #f59e0b', borderRadius: 8, overflow: 'hidden' }}>
            <button onClick={() => setShowCompras(s => !s)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 }}>
                📋 Lista de compras sugerida ({faltas.length})
              </span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 13, transform: showCompras ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
            </button>
            {showCompras && (
              <div style={{ padding: '0 12px 10px' }}>
                {faltas.map((it, i) => {
                  const falta = it.necessario - (it.estoque || 0)
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12, borderBottom: '0.5px solid var(--border)' }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{it.nome}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                          tem {fmtQtd(it.estoque || 0)}{it.unidade} · precisa {fmtQtd(it.necessario)}{it.unidade}
                        </div>
                      </div>
                      <span style={{ fontWeight: 700, color: '#f59e0b' }}>+{fmtQtd(falta)}{it.unidade}</span>
                    </div>
                  )
                })}
                <button onClick={() => {
                  const txt = faltas.map(it => `${it.nome}: ${fmtQtd(it.necessario - (it.estoque || 0))}${it.unidade}`).join('\n')
                  if (navigator.clipboard) navigator.clipboard.writeText('Lista de compras:\n' + txt)
                }} style={{ width: '100%', marginTop: 8, padding: '8px', borderRadius: 6, border: '1px solid #f59e0b', background: 'transparent', color: '#f59e0b', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  📋 Copiar lista
                </button>
              </div>
            )}
          </div>
        )}

        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 10, marginBottom: 4 }}>
          Debita insumos · soma produtos/receitas no estoque · salva no histórico.
        </div>
        <button
          disabled={confirmando}
          onClick={onConfirmar}
          style={{ width: '100%', marginTop: 8, padding: '13px', borderRadius: 10, border: 'none', background: 'var(--teal)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: confirmando ? 'wait' : 'pointer' }}>
          {confirmando ? 'Salvando...' : 'Confirmar e salvar'}
        </button>
      </div>
    </>
  )
}

