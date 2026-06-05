import { useState, useMemo, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useData } from '../hooks/useData'
import {
  getProducao, getReceitas, getInsumos, getProdutos,
  updateProducaoChecks, deleteProducao, deleteProducaoItem,
  addProducaoItens, updateProducaoItemQtd, computeDebitos,
} from '../services/db'

function norm(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function parseSteps(instrucoes) {
  if (!instrucoes) return []
  try { const p = JSON.parse(instrucoes); return Array.isArray(p) ? p : [] }
  catch { return [] }
}

const THERMAL_TYPES = [
  { key: 'ferver',   steps: ['ferver'],   icon: '🍲', label: 'Ferver',   color: '#fb923c' },
  { key: 'assar',    steps: ['assar'],    icon: '🔥', label: 'Forno',    color: '#f97316' },
  { key: 'resfriar', steps: ['resfriar'], icon: '💧', label: 'Resfriar', color: '#2dd4bf' },
  { key: 'congelar', steps: ['congelar'], icon: '❄️', label: 'Congelar', color: '#60a5fa' },
]

function thermalOfRec(rec, key) {
  if (!rec) return false
  const tipos = new Set(parseSteps(rec.instrucoes).map(s => s.tipo))
  if (key === 'ferver')   return !!rec.temFerver || tipos.has('ferver')
  if (key === 'assar')    return tipos.has('assar') || Number(rec.tempoForno) > 0 || Number(rec.tempForno) > 0 || (Array.isArray(rec.temposForno) && rec.temposForno.length > 0)
  if (key === 'resfriar') return tipos.has('resfriar') || rec.tipoResfriamento === 'geladeira'
  if (key === 'congelar') return tipos.has('congelar') || rec.tipoResfriamento === 'congelador'
  return false
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

export default function ProducaoTodo() {
  const { id } = useParams()
  const navigate = useNavigate()
  const SCROLL_KEY = `scroll-producao-${id}`
  const abrirCozinha = (recId, doses) => {
    const page = document.querySelector('.main-content')
    if (page) sessionStorage.setItem(SCROLL_KEY, String(page.scrollTop))
    navigate(`/fichas/${recId}?doses=${doses}&prod=${id}`)
  }
  const { data: receitas } = useData(getReceitas)
  const { data: insumos, reload: reloadInsumos } = useData(getInsumos)
  const { data: produtos } = useData(getProdutos)

  const [prod, setProd]             = useState(null)
  const [loading, setLoading]       = useState(true)
  const [showDebit, setShowDebit]   = useState(false)
  const [showBases, setShowBases]   = useState(true)
  const [showCompras, setShowCompras] = useState(false)
  const [showPedido, setShowPedido] = useState(false) // "O que foi pedido" colapsável
  const [filtroThermal, setFiltroThermal] = useState(null) // null | 'ferver'
  const [confirmDel, setConfirmDel] = useState(false)
  const [confirmDelItem, setConfirmDelItem] = useState(null)
  const [expandReceita, setExpandReceita] = useState({})
  const [editMode, setEditMode]     = useState(false)
  const [qtdEdits, setQtdEdits]     = useState({}) // itemId -> string value
  const [savingQtd, setSavingQtd]   = useState({})
  const [showAddSheet, setShowAddSheet] = useState(false)
  const [addSaving, setAddSaving]   = useState(false)
  const [busca, setBusca]           = useState('')

  async function reload() {
    setLoading(true)
    const p = await getProducao(id)
    setProd(p)
    setLoading(false)
  }

  useEffect(() => { reload() }, [id])

  const pendingScroll = useRef(sessionStorage.getItem(SCROLL_KEY))
  useEffect(() => {
    if (!pendingScroll.current || loading) return
    const target = Number(pendingScroll.current)
    pendingScroll.current = null
    sessionStorage.removeItem(SCROLL_KEY)
    setTimeout(() => {
      const page = document.querySelector('.main-content')
      if (page) page.scrollTop = target
    }, 80)
  }, [loading])

  const checks = useMemo(() => new Set(prod?.checks || []), [prod])

  const dosesPerReceita = useMemo(() => {
    if (!prod) return {}
    const map = {}
    for (const item of prod.itens) {
      if (item.snapshot?.dosesContrib && Object.keys(item.snapshot.dosesContrib).length > 0) {
        for (const [rid, d] of Object.entries(item.snapshot.dosesContrib)) {
          map[rid] = (map[rid] || 0) + d
        }
      } else if (item.tipo === 'receita' && item.receitaId) {
        // fallback: recipe item saved without dosesContrib
        const d = item.quantidade || 0
        if (d > 0) map[String(item.receitaId)] = (map[String(item.receitaId)] || 0) + d
      }
    }
    return map
  }, [prod])

  const debitosTotais = useMemo(() => {
    if (!prod || !receitas) return []
    const debitos = computeDebitos(dosesPerReceita, receitas)
    const map = {}
    for (const [insumoId, q] of Object.entries(debitos)) {
      const ins = (insumos || []).find(i => String(i.id) === String(insumoId))
      map[insumoId] = { insumoId: Number(insumoId), nome: ins?.nome || `insumo#${insumoId}`, unidade: ins?.unidade || 'g', necessario: q, estoque: ins?.estoqueAtual ?? null, linkCompra: ins?.linkCompra || '', whatsapp: ins?.whatsapp || '', fornecedor: ins?.fornecedor || '' }
    }
    return Object.values(map).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [prod, insumos, receitas, dosesPerReceita])

  const faltas = debitosTotais.filter(d => d.estoque != null && d.estoque < d.necessario)

  const subReceitasTotal = useMemo(() => {
    if (!prod || !receitas) return []
    const topLevelIds = new Set(Object.keys(dosesPerReceita).map(Number))
    const map = {}

    function walk(recId, parentDoses, depth = 0) {
      if (depth > 5) return
      const rec = (receitas || []).find(r => r.id === recId)
      if (!rec) return
      for (const ing of (rec.ingredientes || [])) {
        if (!ing.subReceitaId) continue
        const subRec = (receitas || []).find(r => r.id === ing.subReceitaId)
        if (!subRec || !subRec.rendimento) continue
        const subDoses = (ing.quantidade * parentDoses) / subRec.rendimento
        if (!map[ing.subReceitaId]) map[ing.subReceitaId] = { rec: subRec, totalDoses: 0 }
        map[ing.subReceitaId].totalDoses += subDoses
        walk(ing.subReceitaId, subDoses, depth + 1)
      }
    }

    for (const [recIdStr, doses] of Object.entries(dosesPerReceita)) {
      walk(Number(recIdStr), doses)
    }

    return Object.entries(map)
      .filter(([id]) => !topLevelIds.has(Number(id)))
      .map(([id, { rec, totalDoses }]) => ({
        id: Number(id),
        idStr: `sub-${id}`,
        rec,
        totalDoses,
        totalPeso: totalDoses * (rec.rendimento || 0),
      }))
      .sort((a, b) => a.rec.nome.localeCompare(b.rec.nome, 'pt-BR'))
  }, [prod, receitas, dosesPerReceita])

  async function toggleCheck(receitaId) {
    const key = String(receitaId)
    const novoSet = new Set(prod.checks || [])
    if (novoSet.has(key)) novoSet.delete(key)
    else novoSet.add(key)
    const arr = Array.from(novoSet)
    setProd({ ...prod, checks: arr })
    try {
      await updateProducaoChecks(prod.id, arr)
      reloadInsumos()
    } catch (e) {
      alert('Erro ao salvar: ' + e.message)
      reload()
    }
  }

  async function handleDelProd() {
    setConfirmDel(false)
    await deleteProducao(prod.id)
    navigate('/mise-en-place')
  }

  async function handleDelItem() {
    const itemId = confirmDelItem
    setConfirmDelItem(null)
    await deleteProducaoItem(itemId)
    await reload()
  }

  async function handleSaveQtd(item) {
    const raw = qtdEdits[item.id]
    if (raw === undefined) return
    const val = parseFloat(raw)
    if (isNaN(val) || val < 0) return
    setSavingQtd(s => ({ ...s, [item.id]: true }))
    try {
      const isModo = item.modo === 'peso_liquido' || item.modo === 'unidades'
      await updateProducaoItemQtd(item.id, isModo ? item.quantidade : val, isModo ? val : undefined)
      await reload()
      setQtdEdits(s => { const n = { ...s }; delete n[item.id]; return n })
    } catch (e) {
      alert('Erro: ' + e.message)
    } finally {
      setSavingQtd(s => { const n = { ...s }; delete n[item.id]; return n })
    }
  }

  async function handleAddItens(lote) {
    setAddSaving(true)
    try {
      await addProducaoItens(prod.id, lote, receitas || [], produtos || [])
      await reload()
      setShowAddSheet(false)
    } catch (e) {
      alert('Erro ao adicionar: ' + e.message)
    } finally {
      setAddSaving(false)
    }
  }

  if (loading) return (
    <>
      <div className="topbar"><div className="topbar-inner"><div className="topbar-title">Carregando...</div></div></div>
    </>
  )
  if (!prod) return (
    <>
      <div className="topbar"><div className="topbar-inner"><div className="topbar-title">Produção não encontrada</div><button onClick={() => navigate('/mise-en-place')} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>← Voltar</button></div></div>
    </>
  )

  const totalItens = Object.keys(dosesPerReceita).length + subReceitasTotal.length
  const doneItens = Object.keys(dosesPerReceita).filter(rid => checks.has(rid)).length
    + subReceitasTotal.filter(s => checks.has(s.idStr)).length
  const pct = totalItens > 0 ? Math.round((doneItens / totalItens) * 100) : 0

  return (
    <>
      <div className="topbar" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
        <div className="topbar-inner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', padding: '0 4px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <div>
              <div className="topbar-title">Produção</div>
              <div className="topbar-sub">{fmtDate(prod.createdAt)}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setEditMode(e => !e); setQtdEdits({}) }} style={{
              background: editMode ? 'rgba(20,184,166,0.15)' : 'none',
              border: editMode ? '1px solid var(--teal)' : '1px solid var(--border)',
              color: editMode ? 'var(--teal)' : 'var(--text-secondary)',
              borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: editMode ? 700 : 400,
            }}>
              ✏️ Editar
            </button>
            <button onClick={() => setConfirmDel(true)} style={{ background: 'none', border: '1px solid #7f1d1d', color: '#ef4444', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
              🗑️
            </button>
          </div>
        </div>
        {/* Progresso — dentro do topbar para ficar sticky junto */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{doneItens} de {totalItens} pronto(s)</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: pct === 100 ? 'var(--teal)' : 'var(--text-primary)' }}>{pct}%</div>
          </div>
          <div style={{ height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? 'var(--teal)' : '#60a5fa', transition: 'width 0.3s' }} />
          </div>
        </div>
      </div>

      <div className="page-content">
        {/* Total a debitar — no topo */}
        {debitosTotais.length > 0 && (
          <div className="card" style={{ padding: 0, marginBottom: 12, overflow: 'hidden' }}>
            <button onClick={() => setShowDebit(s => !s)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 }}>
                Insumos necessários {faltas.length > 0 && <span title="Itens faltando" style={{ color: '#f59e0b', marginLeft: 4 }}>⚠</span>}
              </span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 14, transform: showDebit ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
            </button>
            {showDebit && (
              <div style={{ padding: '0 14px 12px' }}>
                {debitosTotais.map((it, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                    <span style={{ color: it.estoque != null && it.estoque < it.necessario ? '#ef4444' : 'var(--text-primary)' }}>{it.nome}</span>
                    <span style={{ fontWeight: 600 }}>{fmtQtd(it.necessario)}{it.unidade}{it.estoque != null && it.estoque < it.necessario ? ' ⚠' : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* O que foi pedido — toggle */}
        <div className="card" style={{ padding: 0, marginBottom: 12, overflow: 'hidden' }}>
          <button onClick={() => setShowPedido(s => !s)} style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 }}>
              O que foi pedido <span style={{ fontWeight: 400, opacity: 0.6 }}>({prod.itens.length})</span>
            </span>
            {editMode && (
              <button onClick={e => { e.stopPropagation(); setShowAddSheet(true) }} style={{
                fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 6,
                border: 'none', background: 'var(--teal)', color: '#fff', cursor: 'pointer',
              }}>+ Add</button>
            )}
            <span style={{ color: 'var(--text-secondary)', fontSize: 14, transform: showPedido ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>▾</span>
          </button>
          {showPedido && <div style={{ padding: '0 14px 12px' }}>
          {prod.itens.map((item, i) => {
            const isModo = item.modo === 'peso_liquido' || item.modo === 'unidades'
            const displayQtd = isModo ? item.valorAlvo : item.quantidade
            const editVal = qtdEdits[item.id] !== undefined ? qtdEdits[item.id] : String(displayQtd ?? '')
            const unidLabel = item.tipo === 'produto' ? 'un'
              : item.modo === 'peso_liquido' ? `${item.unidadeGera || 'g'} líq`
              : item.modo === 'unidades' ? (item.unidadeGera || 'un')
              : 'receita(s)'
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 0', borderBottom: i < prod.itens.length - 1 ? '0.5px solid var(--border)' : 'none', fontSize: 13 }}>
                <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: item.tipo === 'produto' ? '#1e3a5f' : '#334155', color: item.tipo === 'produto' ? '#60a5fa' : '#94a3b8', fontWeight: 600, flexShrink: 0 }}>
                  {item.tipo === 'produto' ? 'P' : 'R'}
                </span>
                <span style={{ flex: 1, fontWeight: 600 }}>{item.nome}</span>
                {editMode ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <input
                      type="text" inputMode="decimal"
                      value={editVal}
                      onChange={e => setQtdEdits(s => ({ ...s, [item.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') { e.target.blur(); handleSaveQtd(item) } }}
                      onFocus={e => e.target.select()}
                      style={{ width: 52, textAlign: 'center', border: '1px solid var(--teal)', borderRadius: 5, padding: '3px 4px', fontSize: 12, background: 'var(--card-bg)', color: 'var(--teal)', fontWeight: 700 }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{unidLabel}</span>
                    {savingQtd[item.id] ? (
                      <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>…</span>
                    ) : qtdEdits[item.id] !== undefined ? (
                      <button onClick={() => handleSaveQtd(item)} style={{ background: 'var(--teal)', border: 'none', color: '#fff', borderRadius: 5, fontSize: 12, fontWeight: 700, padding: '2px 6px', cursor: 'pointer', flexShrink: 0 }}>✓</button>
                    ) : null}
                    <button onClick={() => setConfirmDelItem(item.id)} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 14, cursor: 'pointer', padding: '0 2px' }}>×</button>
                  </div>
                ) : (
                  <span style={{ color: 'var(--text-secondary)', fontSize: 12, flexShrink: 0 }}>
                    {fmtQtd(displayQtd)} {unidLabel}
                  </span>
                )}
              </div>
            )
          })}
          {/* Soma das unidades produzidas */}
          {showPedido && (() => {
            const totais = {}
            for (const item of prod.itens) {
              if (item.tipo === 'produto') {
                const key = 'un'
                totais[key] = (totais[key] || 0) + (item.quantidade || 0)
              } else {
                const u = item.unidadeGera || 'un'
                const qty = item.rendimentoTotal || 0
                if (qty > 0) totais[u] = (totais[u] || 0) + qty
              }
            }
            const entries = Object.entries(totais).filter(([, v]) => v > 0)
            if (!entries.length) return null
            return (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 2px', marginTop: 4, borderTop: '1px solid var(--border)', fontSize: 12, fontWeight: 700, color: 'var(--teal)' }}>
                <span>Total a produzir</span>
                <span>{entries.map(([u, v]) => `${fmtQtd(v)} ${u}`).join(' · ')}</span>
              </div>
            )
          })()}
          </div>}
        </div>

        {/* Search */}
        {(subReceitasTotal.length > 0 || Object.keys(dosesPerReceita).length > 0) && (
          <div style={{ marginBottom: 10, position: 'relative' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }}>
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/>
              <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar receita ou preparação..."
              style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px 11px 36px', borderRadius: 12, border: '1.5px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }}
            />
          </div>
        )}

        {/* Preparações (sub-receitas) */}
        {subReceitasTotal.length > 0 && (() => {
          const q = norm(busca)
          const filtered = subReceitasTotal
            .filter(s => !q || norm(s.rec.nome).includes(q))
            .sort((a, b) => {
              const ca = checks.has(a.idStr) ? 1 : 0
              const cb = checks.has(b.idStr) ? 1 : 0
              return ca - cb || a.rec.nome.localeCompare(b.rec.nome, 'pt-BR')
            })
          if (!filtered.length && q) return null
          return (
          <div className="card" style={{ padding: 0, marginBottom: 12, overflow: 'hidden' }}>
            <button onClick={() => setShowBases(s => !s)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 }}>
                Preparações <span style={{ fontWeight: 400, opacity: 0.6 }}>({subReceitasTotal.filter(s => checks.has(s.idStr)).length}/{subReceitasTotal.length})</span>
              </span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 14, transform: showBases ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
            </button>
            {showBases && (
              <div style={{ padding: '0 0 8px' }}>
                {filtered.map((s, i) => {
                  const isChecked = checks.has(s.idStr)
                  const isExpanded = !!expandReceita[s.idStr]
                  const fp = s.rec.fatorPerda || 0
                  const liq = s.totalPeso * (1 - fp / 100)
                  return (
                    <div key={s.id} style={{
                      borderTop: i > 0 ? '1px solid #1a1a1a' : 'none',
                      opacity: isChecked ? 0.5 : 1,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer' }} onClick={() => abrirCozinha(s.id, s.totalDoses)}>
                        <button onClick={e => { e.stopPropagation(); toggleCheck(s.idStr) }} title="Marcar como pronto" style={{
                          width: 24, height: 24, borderRadius: '50%', flexShrink: 0, padding: 0,
                          border: `2px solid ${isChecked ? 'var(--teal)' : 'var(--border)'}`,
                          background: isChecked ? 'var(--teal)' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        }}>{isChecked ? '✓' : ''}</button>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, textDecoration: isChecked ? 'line-through' : 'none' }}>{s.rec.nome}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>
                            {fmtQtd(s.totalPeso)} {s.rec.unidadeGera}{fp > 0 ? ` (${fmtQtd(liq)} líq)` : ''}
                          </div>
                        </div>
                        <span style={{ fontSize: 15, flexShrink: 0 }}>👨‍🍳</span>
                        <button onClick={e => { e.stopPropagation(); setExpandReceita(prev => ({ ...prev, [s.idStr]: !prev[s.idStr] })) }}
                          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 14, cursor: 'pointer', padding: '4px 6px', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>▾</button>
                      </div>
                      {isExpanded && (
                        <div style={{ padding: '0 14px 10px 46px', background: 'var(--bg-secondary, #1f2937)' }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, padding: '6px 0 4px' }}>Ingredientes</div>
                          {(s.rec.ingredientes || []).map((ing, idx) => (
                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 12 }}>
                              <span style={{ color: ing.subReceitaId ? 'var(--teal)' : 'var(--text-primary)' }}>{ing.nome}</span>
                              <span style={{ fontWeight: 600 }}>{fmtQtd(ing.quantidade * s.totalDoses)}{ing.unidade}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          )
        })()}

        {/* Receitas a produzir */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 }}>
            Receitas <span style={{ fontWeight: 400, opacity: 0.6 }}>({Object.keys(dosesPerReceita).filter(rid => checks.has(rid)).length}/{Object.keys(dosesPerReceita).length})</span>
          </div>
          {THERMAL_TYPES.map(t => {
            const active = filtroThermal === t.key
            return (
              <button key={t.key} onClick={() => setFiltroThermal(active ? null : t.key)} style={{
                padding: '4px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
                border: `1px solid ${active ? t.color : 'var(--border-light-color)'}`,
                background: active ? `${t.color}22` : 'transparent',
                color: active ? t.color : 'var(--text-secondary)',
                fontWeight: active ? 700 : 400,
              }}>{t.icon} {t.label}</button>
            )
          })}
        </div>
        {(() => {
          const q = norm(busca)
          const sorted = Object.entries(dosesPerReceita)
            .filter(([recIdStr, doses]) => {
              const rec = (receitas || []).find(r => r.id === Number(recIdStr))
              if (!rec || doses <= 0) return false
              if (filtroThermal && !thermalOfRec(rec, filtroThermal)) return false
              if (q && !norm(rec.nome).includes(q)) return false
              return true
            })
            .sort(([aId], [bId]) => {
              const ca = checks.has(aId) ? 1 : 0
              const cb = checks.has(bId) ? 1 : 0
              if (ca !== cb) return ca - cb
              const ra = (receitas || []).find(r => r.id === Number(aId))
              const rb = (receitas || []).find(r => r.id === Number(bId))
              return (ra?.nome || '').localeCompare(rb?.nome || '', 'pt-BR')
            })
          return sorted.map(([recIdStr, doses]) => {
          const rec = (receitas || []).find(r => r.id === Number(recIdStr))
          const isChecked = checks.has(recIdStr)
          const isExpanded = !!expandReceita[recIdStr]
          const fp = rec.fatorPerda || 0
          const renderTotal = (rec.rendimento || 0) * doses
          const liq = renderTotal * (1 - fp / 100)
          return (
            <div key={recIdStr} className="card" style={{
              marginBottom: 8, padding: 0, overflow: 'hidden',
              opacity: isChecked ? 0.55 : 1,
              borderLeft: isChecked ? '3px solid var(--teal)' : '3px solid transparent',
            }}>
              <div onClick={() => abrirCozinha(recIdStr, doses)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', cursor: 'pointer' }}>
                <button onClick={e => { e.stopPropagation(); toggleCheck(recIdStr) }} title="Marcar como pronto" style={{
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0, padding: 0,
                  border: `2px solid ${isChecked ? 'var(--teal)' : 'var(--border)'}`,
                  background: isChecked ? 'var(--teal)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}>{isChecked ? '✓' : ''}</button>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, textDecoration: isChecked ? 'line-through' : 'none' }}>{rec.nome}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {fmtQtd(doses)} Receita original → {fmtQtd(renderTotal)} {rec.unidadeGera}{fp > 0 ? ` (${fmtQtd(liq)} líq)` : ''}
                  </div>
                </div>
                <span title="Abrir modo cozinha" style={{ fontSize: 16, flexShrink: 0 }}>👨‍🍳</span>
                <button onClick={e => { e.stopPropagation(); setExpandReceita(s => ({ ...s, [recIdStr]: !s[recIdStr] })) }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 14, cursor: 'pointer', padding: '4px 8px', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</button>
              </div>
              {isExpanded && (
                <div style={{ padding: '0 14px 12px 50px', background: 'var(--bg-secondary, #1f2937)' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, padding: '8px 0 4px' }}>Mise en place</div>
                  {(rec.ingredientes || []).map((ing, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12 }}>
                      <span>{ing.nome}</span>
                      <span style={{ fontWeight: 600 }}>{fmtQtd(ing.quantidade * doses)}{ing.unidade}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })
        })()}
        {Object.keys(dosesPerReceita).length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13, padding: 20 }}>Nenhuma receita nesta produção</div>
        )}

        {/* Lista de compras sugerida */}
        {faltas.length > 0 && (
          <div className="card" style={{ padding: 0, marginTop: 10, overflow: 'hidden', borderLeft: '3px solid #f59e0b' }}>
            <button onClick={() => setShowCompras(s => !s)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 }}>
                📋 Lista de compras sugerida ({faltas.length})
              </span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 14, transform: showCompras ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
            </button>
            {showCompras && (
              <div style={{ padding: '0 14px 12px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>Insumos com estoque abaixo do necessário:</div>
                {faltas.map((it, i) => {
                  const falta = it.necessario - (it.estoque || 0)
                  const waLink = it.whatsapp ? `https://wa.me/55${it.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`Olá! Preciso de ${it.nome}: ${fmtQtd(falta)}${it.unidade}`)}` : null
                  return (
                    <div key={i} style={{ padding: '7px 0', fontSize: 12, borderBottom: '0.5px solid var(--border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}>{it.nome}</div>
                          {it.fornecedor && <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{it.fornecedor}</div>}
                          <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>tem {fmtQtd(it.estoque || 0)}{it.unidade} · precisa {fmtQtd(it.necessario)}{it.unidade}</div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                          <span style={{ fontWeight: 700, color: '#f59e0b' }}>+{fmtQtd(falta)}{it.unidade}</span>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {it.linkCompra && <a href={it.linkCompra} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: 'var(--teal)', textDecoration: 'none', padding: '2px 6px', border: '1px solid var(--teal)', borderRadius: 4 }}>Loja</a>}
                            {waLink && <a href={waLink} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: '#fff', background: '#25d366', padding: '2px 6px', borderRadius: 4, textDecoration: 'none' }}>WA</a>}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
                <button onClick={() => {
                  const txt = faltas.map(it => `${it.nome}: ${fmtQtd(it.necessario - (it.estoque || 0))}${it.unidade}`).join('\n')
                  if (navigator.clipboard) navigator.clipboard.writeText('Lista de compras:\n' + txt)
                }} style={{ width: '100%', marginTop: 10, padding: '10px', borderRadius: 8, border: '1px solid #f59e0b', background: 'transparent', color: '#f59e0b', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  📋 Copiar lista
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {showAddSheet && (
        <AddItemSheet
          receitas={receitas || []}
          produtos={produtos || []}
          saving={addSaving}
          onClose={() => setShowAddSheet(false)}
          onConfirmar={handleAddItens}
        />
      )}

      {confirmDel && (
        <ConfirmModal
          icon="🗑️" title="Apagar esta produção?"
          msg="Estoque será revertido (insumos somados de volta, produtos/receitas debitados)."
          onCancel={() => setConfirmDel(false)}
          onConfirm={handleDelProd}
        />
      )}
      {confirmDelItem && (
        <ConfirmModal
          icon="🗑️" title="Apagar este item?"
          msg="Estoque será revertido apenas para esse item."
          onCancel={() => setConfirmDelItem(null)}
          onConfirm={handleDelItem}
        />
      )}
    </>
  )
}

function AddItemSheet({ receitas, produtos, saving, onClose, onConfirmar }) {
  const [busca, setBusca] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('todos')
  const [lote, setLote] = useState([])

  const inLote = (tipo, id) => lote.some(x => x.tipo === tipo && x.refId === id)

  const filtrados = useMemo(() => {
    const q = norm(busca)
    const recs = receitas.filter(r => norm(r.nome).includes(q))
      .map(r => ({ tipo: 'receita', id: r.id, nome: r.nome, sub: `rende ${r.rendimento} ${r.unidadeGera}` }))
    const prods = produtos.filter(p => p.tipo !== 'avulso' && norm(p.nome).includes(q))
      .map(p => ({ tipo: 'produto', id: p.id, nome: p.nome, sub: `${(p.receitas || []).length} receita(s)` }))
    if (filtroTipo === 'receitas') return recs
    if (filtroTipo === 'produtos') return prods
    return [...prods, ...recs]
  }, [receitas, produtos, busca, filtroTipo])

  function toggle(tipo, item) {
    if (inLote(tipo, item.id)) { setLote(l => l.filter(x => !(x.tipo === tipo && x.refId === item.id))); return }
    if (tipo === 'produto') setLote(l => [...l, { tipo: 'produto', refId: item.id, nome: item.nome, qtd: 1 }])
    else setLote(l => [...l, { tipo: 'receita', refId: item.id, nome: item.nome, qtd: 1, modo: 'doses', valorAlvo: null }])
  }

  function updateLote(idx, patch) { setLote(l => l.map((x, i) => i === idx ? { ...x, ...patch } : x)) }

  const btnStyle = { width: 26, height: 26, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }

  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div className="sheet" style={{ maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="sheet-title">
          <span>Adicionar itens</span>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer' }} onClick={onClose}>×</button>
        </div>

        {/* Lote selecionado */}
        {lote.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            {lote.map((item, idx) => {
              const rec = item.tipo === 'receita' ? receitas.find(r => r.id === item.refId) : null
              const isProd = item.tipo === 'produto'
              return (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '0.5px solid var(--border)' }}>
                  <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: isProd ? '#1e3a5f' : '#334155', color: isProd ? '#60a5fa' : '#94a3b8', fontWeight: 600, flexShrink: 0 }}>{isProd ? 'P' : 'R'}</span>
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{item.nome}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                    <button style={btnStyle} onClick={() => updateLote(idx, isProd ? { qtd: Math.max(0, (item.qtd || 0) - 1) } : { qtd: Math.max(0, (item.qtd || 0) - 1) })}>−</button>
                    <input type="text" inputMode="decimal" value={isProd ? item.qtd : item.qtd}
                      onChange={e => updateLote(idx, { qtd: parseFloat(e.target.value) || 0 })}
                      style={{ width: 42, textAlign: 'center', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 0', fontSize: 13, background: 'var(--card-bg)', color: 'var(--text-primary)', fontWeight: 700 }}
                    />
                    <button style={btnStyle} onClick={() => updateLote(idx, { qtd: (item.qtd || 0) + 1 })}>+</button>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 20 }}>{isProd ? 'un' : 'dose(s)'}</span>
                    <button onClick={() => setLote(l => l.filter((_, i) => i !== idx))} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', fontSize: 16, cursor: 'pointer', padding: 0 }}>×</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Filtro tipo */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {[['todos','Todos'],['produtos','Produtos'],['receitas','Receitas']].map(([k,l]) => (
            <button key={k} onClick={() => setFiltroTipo(k)} style={{
              padding: '4px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
              border: filtroTipo === k ? '1px solid var(--teal)' : '1px solid var(--border)',
              background: filtroTipo === k ? 'var(--teal)' : 'transparent',
              color: filtroTipo === k ? '#fff' : 'var(--text-secondary)', fontWeight: filtroTipo === k ? 600 : 400,
            }}>{l}</button>
          ))}
        </div>

        {/* Busca */}
        <input
          value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar..."
          style={{ marginBottom: 8, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 }}
        />

        {/* Lista scroll */}
        <div style={{ overflowY: 'auto', flex: 1, marginBottom: 10 }}>
          {filtrados.map(item => {
            const inLot = inLote(item.tipo, item.id)
            return (
              <div key={`${item.tipo}-${item.id}`}
                onClick={() => toggle(item.tipo, item)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: '0.5px solid var(--border)', cursor: 'pointer', background: inLot ? 'rgba(20,184,166,0.06)' : 'transparent' }}>
                <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: item.tipo === 'produto' ? '#1e3a5f' : '#334155', color: item.tipo === 'produto' ? '#60a5fa' : '#94a3b8', fontWeight: 600, flexShrink: 0 }}>
                  {item.tipo === 'produto' ? 'P' : 'R'}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{item.nome}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{item.sub}</div>
                </div>
                <span style={{ color: inLot ? 'var(--teal)' : 'var(--text-tertiary)', fontSize: inLot ? 14 : 20, fontWeight: 700 }}>{inLot ? '✓' : '+'}</span>
              </div>
            )
          })}
        </div>

        <button
          disabled={lote.length === 0 || saving}
          onClick={() => onConfirmar(lote)}
          style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: lote.length > 0 ? 'var(--teal)' : '#333', color: lote.length > 0 ? '#fff' : '#666', fontWeight: 700, fontSize: 14, cursor: lote.length > 0 ? 'pointer' : 'default' }}>
          {saving ? 'Salvando...' : lote.length > 0 ? `Adicionar ${lote.length} item(s)` : 'Selecione itens'}
        </button>
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
          <button onClick={onConfirm} style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>Apagar</button>
        </div>
      </div>
    </div>
  )
}
