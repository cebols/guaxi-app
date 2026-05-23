import { useState, useMemo } from 'react'
import { useData } from '../hooks/useData'
import {
  getReceitas, getInsumos, getProdutos,
  saveProducao, getProducoes, deleteProducao, deleteProducaoItem,
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
  const { data: receitas } = useData(getReceitas)
  const { data: insumos }  = useData(getInsumos)
  const { data: produtos } = useData(getProdutos)
  const { data: historico, reload: reloadHist } = useData(getProducoes)

  const [busca, setBusca]               = useState('')
  const [filtroTipo, setFiltroTipo]     = useState('todos') // 'todos' | 'receitas' | 'produtos'
  const [lote, setLote]                 = useState([])      // [{ tipo, refId, nome, qtd, modo?, valorAlvo? }]
  const [sheet, setSheet]               = useState(null)
  const [confirmando, setConfirmando]   = useState(false)
  const [histDetalhe, setHistDetalhe]   = useState(null)
  const [confirmDelProd, setConfirmDelProd] = useState(null)
  const [confirmDelItem, setConfirmDelItem] = useState(null)

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

  function add(tipo, item) {
    if (inLote(tipo, item.id)) return
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

  async function handleConfirmar() {
    setConfirmando(true)
    try {
      await saveProducao(lote, receitas || [], produtos || [])
      await reloadHist()
      setLote([])
      setSheet(null)
    } catch (e) {
      alert('Erro ao confirmar: ' + e.message)
    } finally {
      setConfirmando(false)
    }
  }

  async function handleDeleteProd() {
    const id = confirmDelProd
    setConfirmDelProd(null)
    await deleteProducao(id)
    await reloadHist()
    if (histDetalhe?.id === id) setHistDetalhe(null)
  }
  async function handleDeleteItem() {
    const { itemId, prodId } = confirmDelItem || {}
    setConfirmDelItem(null)
    await deleteProducaoItem(itemId)
    await reloadHist()
    // Atualiza histDetalhe se aberto
    if (histDetalhe?.id === prodId) {
      const fresh = (await getProducoes())
      const upd = fresh.find(p => p.id === prodId)
      if (upd && upd.itens.length) setHistDetalhe(upd)
      else setHistDetalhe(null)
    }
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
              <button onClick={() => setSheet('recibo')} style={{
                background: temFalta ? '#f59e0b' : 'var(--teal)',
                color: '#fff', border: 'none', borderRadius: 8,
                padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>
                {temFalta ? '⚠ Ver recibo' : '✓ Ver recibo'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="page-content">
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
                  padding: '10px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10,
                  cursor: inLot ? 'default' : 'pointer', opacity: inLot ? 0.5 : 1,
                }}
                onClick={() => !inLot && add(item.tipo, item)}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: item.tipo === 'produto' ? '#1e3a5f' : '#334155', color: item.tipo === 'produto' ? '#60a5fa' : '#94a3b8', fontWeight: 600, letterSpacing: 0.3 }}>
                      {item.tipo === 'produto' ? 'PRODUTO' : 'RECEITA'}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{item.nome}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{item.sub}</div>
                </div>
                {!inLot && <span style={{ color: 'var(--text-tertiary)', fontSize: 20 }}>+</span>}
                {inLot && <span style={{ color: 'var(--teal)', fontSize: 12 }}>✓</span>}
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
        />
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6, gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{fmtDate(prod.createdAt)}</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => setHistDetalhe(prod)} style={{ fontSize: 11, color: 'var(--teal)', background: 'none', border: '1px solid var(--teal)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>
                      Ver
                    </button>
                    <button onClick={() => setConfirmDelProd(prod.id)} style={{ fontSize: 11, color: 'var(--alert-text, #ef4444)', background: 'none', border: '1px solid var(--alert-text, #ef4444)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>
                      Apagar
                    </button>
                  </div>
                </div>
                {prod.itens.map((item, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
                    <span style={{ fontWeight: 600 }}>
                      <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, marginRight: 6, background: item.tipo === 'produto' ? '#1e3a5f' : '#334155', color: item.tipo === 'produto' ? '#60a5fa' : '#94a3b8', fontWeight: 600 }}>
                        {item.tipo === 'produto' ? 'P' : 'R'}
                      </span>
                      {item.nome}
                    </span>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {item.tipo === 'produto'
                        ? `${fmtQtd(item.quantidade)} un`
                        : item.modo === 'peso_liquido' ? `${fmtQtd(item.valorAlvo)} g líq`
                          : item.modo === 'unidades' ? `${fmtQtd(item.valorAlvo)} ${item.unidadeGera}`
                          : `${fmtQtd(item.quantidade)} dose${item.quantidade > 1 ? 's' : ''}`}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Detalhe histórico */}
      {histDetalhe && (
        <HistDetalhe
          prod={histDetalhe}
          receitas={receitas || []}
          produtos={produtos || []}
          onClose={() => setHistDetalhe(null)}
          onDelItem={(itemId) => setConfirmDelItem({ itemId, prodId: histDetalhe.id })}
        />
      )}

      {/* Confirmar deleção */}
      {confirmDelProd != null && (
        <ConfirmModal
          icon="🗑️" title="Apagar esta produção?"
          msg="Estoque será revertido (insumos somados de volta, produtos/receitas debitados)."
          onCancel={() => setConfirmDelProd(null)}
          onConfirm={handleDeleteProd}
        />
      )}
      {confirmDelItem && (
        <ConfirmModal
          icon="🗑️" title="Apagar este item?"
          msg="Estoque será revertido apenas para esse item."
          onCancel={() => setConfirmDelItem(null)}
          onConfirm={handleDeleteItem}
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
              {m === 'doses' ? 'doses' : m === 'peso_liquido' ? 'peso líq' : 'unidades'}
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
              {item.qtd > 1 ? 'doses' : 'dose'} → {fmtQtd((rec?.rendimento || 0) * item.qtd)} {rec?.unidadeGera}
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

      {isProduto && prod && (prod.receitas || []).length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6, paddingLeft: 4 }}>
          contém: {(prod.receitas || []).map(rr => `${fmtQtd((rr.quantidade || 1) * (item.qtd || 0))} ${rr.unidadeGera || ''} ${rr.nome}`).join(' · ')}
        </div>
      )}
    </div>
  )
}

function ReciboSheet({ lote, receitas, produtos, dosesPerReceita, debitosTotais, confirmando, onClose, onConfirmar }) {
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
          return (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '0.5px solid var(--border)', fontSize: 13 }}>
              <span style={{ fontWeight: 600 }}>
                <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, marginRight: 6, background: item.tipo === 'produto' ? '#1e3a5f' : '#334155', color: item.tipo === 'produto' ? '#60a5fa' : '#94a3b8', fontWeight: 600 }}>
                  {item.tipo === 'produto' ? 'P' : 'R'}
                </span>
                {item.nome}
              </span>
              <span style={{ color: 'var(--text-secondary)' }}>
                {item.tipo === 'produto'
                  ? `${fmtQtd(item.qtd)} un`
                  : item.modo === 'peso_liquido' ? `${fmtQtd(item.valorAlvo)} ${rec?.unidadeGera || 'g'} líq`
                    : item.modo === 'unidades' ? `${fmtQtd(item.valorAlvo)} ${rec?.unidadeGera || 'un'}`
                    : `${fmtQtd(item.qtd)} dose${item.qtd > 1 ? 's' : ''}`}
              </span>
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
                  {fmtQtd(doses)} dose(s) → {fmtQtd(renderTotal)} {rec.unidadeGera}{fp > 0 ? ` (${fmtQtd(liq)} líq)` : ''}
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

        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 14, marginBottom: 6 }}>Total a debitar do estoque</div>
        {debitosTotais.map((it, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
            <span style={{ color: it.estoque != null && it.estoque < it.necessario ? 'var(--alert-text, #ef4444)' : 'var(--text-primary)' }}>{it.nome}</span>
            <span style={{ fontWeight: 600 }}>{fmtQtd(it.necessario)}{it.unidade}{it.estoque != null && it.estoque < it.necessario ? ' ⚠' : ''}</span>
          </div>
        ))}

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

function HistDetalhe({ prod, receitas, produtos, onClose, onDelItem }) {
  // Recomputa doses por receita a partir dos itens
  const dosesPerReceita = useMemo(() => {
    const map = {}
    for (const item of prod.itens) {
      // Usa snapshot.dosesContrib quando disponível (mais preciso)
      if (item.snapshot?.dosesContrib) {
        for (const [rid, d] of Object.entries(item.snapshot.dosesContrib)) {
          map[rid] = (map[rid] || 0) + d
        }
      } else if (item.tipo === 'receita' && item.receitaId) {
        // Fallback p/ itens antigos
        const rec = receitas.find(r => r.id === item.receitaId)
        if (rec?.rendimento) {
          let d
          if (item.modo === 'peso_liquido' && rec.fatorPerda != null) d = (item.valorAlvo / (1 - rec.fatorPerda / 100)) / rec.rendimento
          else if (item.modo === 'unidades') d = (item.valorAlvo || 0) / rec.rendimento
          else d = item.quantidade || 0
          map[item.receitaId] = (map[item.receitaId] || 0) + d
        }
      }
    }
    return map
  }, [prod, receitas])

  return (
    <>
      <div className="sheet-overlay" style={{ zIndex: 65 }} onClick={onClose} />
      <div className="sheet" style={{ zIndex: 75 }}>
        <div className="sheet-title">
          <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 14, cursor: 'pointer', padding: '0 8px 0 0' }} onClick={onClose}>← </button>
          <span style={{ flex: 1 }}>{fmtDate(prod.createdAt)}</span>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer' }} onClick={onClose}>×</button>
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Itens</div>
        {prod.itens.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0', borderBottom: '0.5px solid var(--border)', fontSize: 13 }}>
            <span style={{ flex: 1, fontWeight: 600 }}>
              <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, marginRight: 6, background: item.tipo === 'produto' ? '#1e3a5f' : '#334155', color: item.tipo === 'produto' ? '#60a5fa' : '#94a3b8', fontWeight: 600 }}>
                {item.tipo === 'produto' ? 'P' : 'R'}
              </span>
              {item.nome}
            </span>
            <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
              {item.tipo === 'produto'
                ? `${fmtQtd(item.quantidade)} un`
                : item.modo === 'peso_liquido' ? `${fmtQtd(item.valorAlvo)} ${item.unidadeGera || 'g'} líq`
                  : item.modo === 'unidades' ? `${fmtQtd(item.valorAlvo)} ${item.unidadeGera || 'un'}`
                  : `${fmtQtd(item.quantidade)} dose(s)`}
            </span>
            <button onClick={() => onDelItem(item.id)} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', fontSize: 14, cursor: 'pointer' }}>×</button>
          </div>
        ))}

        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 14, marginBottom: 6 }}>Mise en place por receita</div>
        {Object.entries(dosesPerReceita).map(([recIdStr, doses]) => {
          const rec = receitas.find(r => r.id === Number(recIdStr))
          if (!rec || doses <= 0) return null
          return (
            <div key={recIdStr} style={{ marginBottom: 10, padding: '6px 10px', background: 'var(--bg-secondary, #1f2937)', borderRadius: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal)', marginBottom: 4 }}>
                {rec.nome} <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>· {fmtQtd(doses)} dose(s)</span>
              </div>
              {(rec.ingredientes || []).map((ing, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 12 }}>
                  <span>{ing.nome}</span>
                  <span style={{ fontWeight: 600 }}>{fmtQtd(ing.quantidade * doses)}{ing.unidade}</span>
                </div>
              ))}
            </div>
          )
        })}
        {Object.keys(dosesPerReceita).length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', paddingTop: 8 }}>Receitas não encontradas — podem ter sido excluídas.</div>
        )}
      </div>
    </>
  )
}

function ConfirmModal({ icon, title, msg, onCancel, onConfirm }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)' }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 14, padding: 24, maxWidth: 320, width: '90%', textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 18 }}>{msg}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}>Cancelar</button>
          <button onClick={onConfirm} style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: 'var(--alert-text, #ef4444)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>Apagar</button>
        </div>
      </div>
    </div>
  )
}
