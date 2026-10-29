import { useState, useMemo, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useData } from '../hooks/useData'
import {
  getProducao, getReceitas, getInsumos, getProdutos,
  updateProducaoChecks, deleteProducao, deleteProducaoItem,
  addProducaoItens, updateProducaoItemQtd, computeDebitos, lotePadraoProduto, aguardarDosesPendentes,
  marcarMontado, desmarcarMontado, atualizarPorcaoProduto, setPorcaoProducao,
} from '../services/db'
import { montarLinhaDoTempo } from '../lib/linhaTempo'
import { etapasDoProduto, LOCAL } from '../lib/prontidao'

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

// Última versão vista de cada produção: a tela abre na hora com ela e atualiza em seguida
const cacheProducao = new Map()

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
  const { data: produtos, reload: reloadProdutos } = useData(getProdutos)

  const [prod, setProdState]        = useState(() => cacheProducao.get(String(id)) || null)
  const [loading, setLoading]       = useState(() => !cacheProducao.has(String(id)))
  const setProd = (p) => { if (p) cacheProducao.set(String(id), p); setProdState(p) }
  const [folha, setFolha]           = useState(null) // 'pedido' | 'insumos' | 'estoque'
  const [abertas, setAbertas]       = useState({})   // etapa -> aberta (sobrescreve o padrão)
  const [montarAlvo, setMontarAlvo] = useState(null) // { item, p, comps }
  const [porcaoAlvo, setPorcaoAlvo] = useState(null) // { item, p, comps }
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
    if (!cacheProducao.has(String(id))) setLoading(true)
    await aguardarDosesPendentes() // edição feita no modo cozinha ainda salvando
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
    // Formato novo: débitos já vêm líquidos do estoque de preparos no snapshot
    const debitos = {}
    for (const item of prod.itens) {
      const snap = item.snapshot
      const parcial = snap?.fracoes && snap.debitosPorReceita
        ? Object.values(snap.debitosPorReceita).reduce((acc, d) => { for (const [k, v] of Object.entries(d)) acc[k] = (acc[k] || 0) + v; return acc }, {})
        : computeDebitos(snap?.dosesContrib || {}, receitas)
      for (const [k, v] of Object.entries(parcial)) debitos[k] = (debitos[k] || 0) + v
    }
    const map = {}
    for (const [insumoId, q] of Object.entries(debitos)) {
      const ins = (insumos || []).find(i => String(i.id) === String(insumoId))
      map[insumoId] = { insumoId: Number(insumoId), nome: ins?.nome || `insumo#${insumoId}`, unidade: ins?.unidade || 'g', necessario: q, estoque: ins?.estoqueAtual ?? null, linkCompra: ins?.linkCompra || '', whatsapp: ins?.whatsapp || '', fornecedor: ins?.fornecedor || '' }
    }
    return Object.values(map).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [prod, insumos, receitas, dosesPerReceita])

  const faltas = debitosTotais.filter(d => d.estoque != null && d.estoque < d.necessario)

  // Preparos que esta produção tirou do estoque (já descontados na criação)
  const usoEstoque = useMemo(() => {
    if (!prod) return []
    const map = {}
    for (const item of prod.itens) for (const [rid, q] of Object.entries(item.snapshot?.usoEstoque || {})) map[rid] = (map[rid] || 0) + q
    return Object.entries(map).map(([rid, q]) => ({ rec: (receitas || []).find(r => r.id === Number(rid)), q })).filter(x => x.rec)
  }, [prod, receitas])

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

    for (const item of prod.itens) {
      const snap = item.snapshot
      if (snap?.fracoes) {
        // Formato novo: preparos internos já descontados do estoque
        for (const [sid, d] of Object.entries(snap.subDoses || {})) {
          const subRec = (receitas || []).find(r => r.id === Number(sid))
          if (!subRec) continue
          if (!map[sid]) map[sid] = { rec: subRec, totalDoses: 0 }
          map[sid].totalDoses += d
        }
      } else {
        for (const [recIdStr, doses] of Object.entries(snap?.dosesContrib || {})) walk(Number(recIdStr), doses)
      }
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
    cacheProducao.delete(String(id))
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
      <div className="topbar"><div className="topbar-inner"><div className="topbar-title">Produção não encontrada</div><button onClick={() => navigate('/mise-en-place')} style={{ background: 'none', border: '1px solid #333', color: 'var(--text-secondary)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>← Voltar</button></div></div>
    </>
  )

  // ── Linha do tempo: tudo que vai ao fogo, ordenado pela cadeia ──────────────
  const aProduzir = [
    ...Object.entries(dosesPerReceita).filter(([, d]) => d > 0).map(([rid, d]) => ({ id: Number(rid), chave: rid, doses: d })),
    ...subReceitasTotal.map(sr => ({ id: sr.id, chave: sr.idStr, doses: sr.totalDoses })),
  ]
  const idsAProduzir = new Set(aProduzir.map(x => x.id))
  const chaveDe = (rid) => (dosesPerReceita[String(rid)] > 0 ? String(rid) : `sub-${rid}`)
  const feita = (rid) => checks.has(chaveDe(rid))

  const produtosDaProducao = prod.itens
    .filter(it => it.tipo === 'produto')
    .map(it => ({ item: it, p: (produtos || []).find(pp => Number(pp.id) === Number(it.produtoId)) }))
    .filter(x => x.p && (x.p.receitas || []).length)
  const linha = montarLinhaDoTempo(aProduzir, receitas || [], produtosDaProducao.map(x => x.p))

  const montagem = produtosDaProducao.map(({ item, p }) => {
    const comps = (p.receitas || []).map(rr => {
      const porUn = item.snapshot?.porcoes?.[rr.receitaId] ?? rr.quantidade ?? 1
      const doEstoque = !idsAProduzir.has(Number(rr.receitaId))
      return {
        receitaId: Number(rr.receitaId), nome: rr.nome, porUn, unidade: rr.unidade || rr.unidadeGera || 'un',
        total: porUn * (item.quantidade || 0), doEstoque, pronta: doEstoque || feita(rr.receitaId),
      }
    })
    return { item, p, comps, novo: !!item.snapshot?.creditoNaMontagem, montado: item.snapshot?.montado || null }
  })

  const q = norm(busca)
  const passaFiltro = (x) => (!q || norm(x.rec.nome).includes(q)) && (!filtroThermal || thermalOfRec(x.rec, filtroThermal))
  const etapasVisiveis = linha.etapas.map(e => ({ ...e, itens: e.itens.filter(passaFiltro) })).filter(e => e.itens.length)

  const montagensNovas = montagem.filter(m => m.novo)
  const totalItens = aProduzir.length + montagensNovas.length
  const doneItens = aProduzir.filter(x => checks.has(x.chave)).length + montagensNovas.filter(m => m.montado).length
  const pct = totalItens > 0 ? Math.round((doneItens / totalItens) * 100) : 0

  const estaAberta = (k, tudoFeito) => abertas[k] ?? !tudoFeito
  const alternar = (k, tudoFeito) => setAbertas(a => ({ ...a, [k]: !estaAberta(k, tudoFeito) }))

  const chip = (k, label, n, alerta) => (
    <button key={k} onClick={() => setFolha(k)} style={{
      flex: 1, minWidth: 0, padding: '9px 10px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
      border: `1px solid ${alerta ? '#f59e0b' : '#333'}`, background: alerta ? 'rgba(245,158,11,.08)' : 'var(--bg-card)',
      color: 'var(--text-primary)',
    }}>
      <div style={{ fontSize: 11, color: alerta ? '#f59e0b' : 'var(--text-secondary)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800 }}>{n}{alerta ? <span style={{ fontSize: 12, color: '#f59e0b', marginLeft: 5 }}>⚠ {alerta}</span> : null}</div>
    </button>
  )

  const linhaReceita = (x) => {
    const rec = x.rec
    const isChecked = checks.has(x.chave)
    const isExpanded = !!expandReceita[x.chave]
    const fp = rec.fatorPerda || 0
    const total = (rec.rendimento || 0) * x.doses
    const espera = x.precisa.filter(rid => !feita(rid)).map(rid => (receitas || []).find(r => r.id === rid)?.nome).filter(Boolean)
    return (
      <div key={x.chave} style={{ borderTop: '1px solid #262626', opacity: isChecked ? 0.5 : 1 }}>
        <div onClick={() => abrirCozinha(x.id, x.doses)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', cursor: 'pointer' }}>
          <button onClick={e => { e.stopPropagation(); toggleCheck(x.chave) }} title="Marcar como pronto" style={{
            width: 28, height: 28, borderRadius: '50%', flexShrink: 0, padding: 0,
            border: `2px solid ${isChecked ? 'var(--teal)' : '#444'}`, background: isChecked ? 'var(--teal)' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}>{isChecked ? '✓' : ''}</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, fontWeight: 700, textDecoration: isChecked ? 'line-through' : 'none' }}>{rec.nome}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--teal)' }}>{fmtQtd(total)} {rec.unidadeGera}</span>
              {fp > 0 && <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>({fmtQtd(total * (1 - fp / 100))} líq)</span>}
            </div>
            {x.vaiEm.length > 0 && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>→ vai em {x.vaiEm.join(', ')}</div>}
            {!isChecked && espera.length > 0 && <div style={{ fontSize: 12, color: '#f59e0b', marginTop: 1 }}>espera: {espera.join(', ')}</div>}
          </div>
          <span title="Abrir modo cozinha" style={{ fontSize: 16, flexShrink: 0 }}>👨‍🍳</span>
          <button onClick={e => { e.stopPropagation(); setExpandReceita(st => ({ ...st, [x.chave]: !st[x.chave] })) }}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 14, cursor: 'pointer', padding: '4px 6px', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>▾</button>
        </div>
        {isExpanded && (
          <div style={{ padding: '0 14px 12px 54px' }}>
            {(rec.ingredientes || []).map((ing, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12 }}>
                <span style={{ color: ing.subReceitaId ? 'var(--teal)' : 'var(--text-primary)' }}>{ing.nome}</span>
                <span style={{ fontWeight: 600 }}>{fmtQtd(ing.quantidade * x.doses)}{ing.unidade}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const cabecalhoEtapa = (k, titulo, feitos, total, extra) => {
    const tudo = total > 0 && feitos >= total
    const aberta = estaAberta(k, tudo)
    return (
      <button onClick={() => alternar(k, tudo)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--text-primary)' }}>
        <span style={{ width: 28, height: 28, borderRadius: 14, flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 800,
          background: tudo ? 'var(--teal)' : 'var(--bg-input)', color: tudo ? '#fff' : 'var(--text-primary)' }}>{tudo ? '✓' : extra}</span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: tudo ? 'var(--text-tertiary)' : 'var(--text-primary)' }}>{titulo}</span>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{feitos} de {total}</span>
        <span style={{ color: 'var(--text-secondary)', fontSize: 14, transform: aberta ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
      </button>
    )
  }

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
          <button onClick={() => setConfirmDel(true)} style={{ background: 'none', border: '1px solid #7f1d1d', color: '#ef4444', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>🗑️</button>
        </div>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{doneItens} de {totalItens} pronto(s)</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: pct === 100 ? 'var(--teal)' : 'var(--text-primary)' }}>{pct}%</div>
          </div>
          <div style={{ height: 5, background: '#333', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? 'var(--teal)' : '#60a5fa', transition: 'width 0.3s' }} />
          </div>
        </div>
      </div>

      <div className="page-content" style={{ maxWidth: 760, margin: '0 auto' }}>
        {/* Resumo em chips — abrem em folha */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {chip('pedido', '🧾 Pedido', prod.itens.length)}
          {chip('insumos', '🥚 Insumos', debitosTotais.length, faltas.length || null)}
          {usoEstoque.length > 0 && chip('estoque', '📦 Do estoque', usoEstoque.length)}
        </div>

        {/* Busca + filtros térmicos */}
        {aProduzir.length > 0 && (
          <>
            <div style={{ marginBottom: 8, position: 'relative' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }}>
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/><path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar receita..."
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px 10px 36px', borderRadius: 12, border: '1.5px solid #333', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }} />
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto' }}>
              {THERMAL_TYPES.map(t => {
                const active = filtroThermal === t.key
                return (
                  <button key={t.key} onClick={() => setFiltroThermal(active ? null : t.key)} style={{
                    padding: '4px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer', flexShrink: 0,
                    border: `1px solid ${active ? t.color : 'var(--border-light-color)'}`, background: active ? `${t.color}22` : 'transparent',
                    color: active ? t.color : 'var(--text-secondary)', fontWeight: active ? 700 : 400,
                  }}>{t.icon} {t.label}</button>
                )
              })}
            </div>
          </>
        )}

        {/* Etapas da cadeia */}
        {etapasVisiveis.map((e, i) => {
          const k = `e${e.n}`
          const feitos = e.itens.filter(x => checks.has(x.chave)).length
          const tudo = feitos >= e.itens.length
          return (
            <div key={k} className="card" style={{ padding: 0, marginBottom: 10, overflow: 'hidden' }}>
              {cabecalhoEtapa(k, i === 0 && etapasVisiveis.length > 1 ? 'Começa por aqui' : `Etapa ${i + 1}`, feitos, e.itens.length, i + 1)}
              {estaAberta(k, tudo) && [...e.itens].sort((a, b) => (checks.has(a.chave) ? 1 : 0) - (checks.has(b.chave) ? 1 : 0)).map(linhaReceita)}
            </div>
          )
        })}
        {aProduzir.length === 0 && montagem.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13, padding: 20 }}>Nenhuma receita nesta produção</div>
        )}

        {/* Montagem — o produto fechado */}
        {montagem.length > 0 && !q && !filtroThermal && (() => {
          const feitos = montagem.filter(m => m.novo ? m.montado : m.comps.every(c => c.pronta)).length
          const tudo = feitos >= montagem.length
          return (
            <div className="card" style={{ padding: 0, marginBottom: 10, overflow: 'hidden', borderLeft: '3px solid var(--teal)' }}>
              {cabecalhoEtapa('montagem', 'Montagem', feitos, montagem.length, '◎')}
              {estaAberta('montagem', tudo) && montagem.map(m => {
                const faltam = m.comps.filter(c => !c.pronta)
                return (
                  <div key={m.item.id} style={{ borderTop: '1px solid #262626', padding: '12px 14px', opacity: m.montado ? 0.6 : 1 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                      <span style={{ flex: 1, fontSize: 15, fontWeight: 700 }}>{m.p.nome} <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>· {fmtQtd(m.item.quantidade)} un</span></span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: m.montado ? 'var(--teal)' : faltam.length ? '#f59e0b' : '#4ade80', whiteSpace: 'nowrap' }}>
                        {m.montado ? `✓ montado ${fmtQtd(m.montado.qtd)}` : faltam.length ? `falta ${faltam.length}` : 'pronto pra montar'}
                      </span>
                    </div>
                    {m.comps.map(c => (
                      <div key={c.receitaId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 }}>
                        <span style={{ width: 16, color: c.pronta ? 'var(--teal)' : 'var(--text-tertiary)', fontWeight: 700 }}>{c.pronta ? '✓' : '○'}</span>
                        <span style={{ flex: 1, minWidth: 0 }}>{c.nome}{c.doEstoque && <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}> · do estoque</span>}</span>
                        <span style={{ fontWeight: 700 }}>{fmtQtd(c.total)} {c.unidade}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', minWidth: 62, textAlign: 'right' }}>{fmtQtd(c.porUn)} {c.unidade}/un</span>
                      </div>
                    ))}
                    {m.novo ? (
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button onClick={() => setPorcaoAlvo(m)} style={{ padding: '9px 12px', borderRadius: 9, border: '1px solid #333', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer' }}>⚖ Ajustar porção</button>
                        <button onClick={() => setMontarAlvo(m)} style={{
                          flex: 1, padding: '9px 12px', borderRadius: 9, cursor: 'pointer', fontSize: 14, fontWeight: 700,
                          border: m.montado || faltam.length ? '1px solid var(--teal)' : 'none',
                          background: m.montado || faltam.length ? 'transparent' : 'var(--teal)',
                          color: m.montado || faltam.length ? 'var(--teal)' : '#fff',
                        }}>{m.montado ? 'Montado ✓' : 'Montado'}</button>
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8 }}>Produção antiga: o produto entra no estoque ao concluir as receitas.</div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })()}
      </div>

      {/* Folha: pedido */}
      {folha === 'pedido' && (
        <Folha title={`Pedido · ${prod.itens.length} item(s)`} onClose={() => { setFolha(null); setEditMode(false); setQtdEdits({}) }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button onClick={() => { setEditMode(e => !e); setQtdEdits({}) }} style={{ flex: 1, padding: 9, borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
              border: `1px solid ${editMode ? 'var(--teal)' : '#333'}`, background: editMode ? 'rgba(20,184,166,0.15)' : 'transparent', color: editMode ? 'var(--teal)' : 'var(--text-secondary)' }}>✏️ {editMode ? 'Editando' : 'Editar quantidades'}</button>
            <button onClick={() => setShowAddSheet(true)} style={{ flex: 1, padding: 9, borderRadius: 8, border: 'none', background: 'var(--teal)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>+ Adicionar</button>
          </div>
          {prod.itens.map((item, i) => {
            const isModo = item.modo === 'peso_liquido' || item.modo === 'unidades'
            const displayQtd = isModo ? item.valorAlvo : item.quantidade
            const editVal = qtdEdits[item.id] !== undefined ? qtdEdits[item.id] : String(displayQtd ?? '')
            const unidLabel = item.tipo === 'produto' ? 'un'
              : item.modo === 'peso_liquido' ? `${item.unidadeGera || 'g'} líq`
              : item.modo === 'unidades' ? (item.unidadeGera || 'un')
              : 'receita(s)'
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 0', borderTop: i ? '1px solid #262626' : 'none', fontSize: 14 }}>
                <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: item.tipo === 'produto' ? '#1e3a5f' : '#334155', color: item.tipo === 'produto' ? '#60a5fa' : '#94a3b8', fontWeight: 600, flexShrink: 0 }}>
                  {item.tipo === 'produto' ? 'P' : 'R'}
                </span>
                <span style={{ flex: 1, fontWeight: 600 }}>{item.nome}</span>
                {editMode ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <input type="text" inputMode="decimal" value={editVal}
                      onChange={e => setQtdEdits(st => ({ ...st, [item.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') { e.target.blur(); handleSaveQtd(item) } }}
                      onFocus={e => e.target.select()}
                      style={{ width: 56, textAlign: 'center', border: '1px solid var(--teal)', borderRadius: 5, padding: '4px', fontSize: 13, background: 'var(--bg-input)', color: 'var(--teal)', fontWeight: 700 }} />
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{unidLabel}</span>
                    {savingQtd[item.id] ? <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>…</span>
                      : qtdEdits[item.id] !== undefined ? <button onClick={() => handleSaveQtd(item)} style={{ background: 'var(--teal)', border: 'none', color: '#fff', borderRadius: 5, fontSize: 12, fontWeight: 700, padding: '3px 7px', cursor: 'pointer' }}>✓</button> : null}
                    <button onClick={() => setConfirmDelItem(item.id)} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 16, cursor: 'pointer', padding: '0 2px' }}>×</button>
                  </div>
                ) : (
                  <span style={{ color: 'var(--text-secondary)', fontSize: 13, flexShrink: 0 }}>{fmtQtd(displayQtd)} {unidLabel}</span>
                )}
              </div>
            )
          })}
        </Folha>
      )}

      {/* Folha: insumos */}
      {folha === 'insumos' && (
        <Folha title="Insumos necessários" onClose={() => setFolha(null)}>
          {faltas.length > 0 && (
            <div style={{ border: '1px solid #f59e0b', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', marginBottom: 6 }}>⚠ Faltam {faltas.length} no estoque</div>
              {faltas.map((it, i) => {
                const falta = it.necessario - (it.estoque || 0)
                const waLink = it.whatsapp ? `https://wa.me/55${it.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`Olá! Preciso de ${it.nome}: ${fmtQtd(falta)}${it.unidade}`)}` : null
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 13, borderTop: i ? '1px solid #262626' : 'none' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{it.nome}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>tem {fmtQtd(it.estoque || 0)}{it.unidade} · precisa {fmtQtd(it.necessario)}{it.unidade}</div>
                    </div>
                    <span style={{ fontWeight: 700, color: '#f59e0b' }}>+{fmtQtd(falta)}{it.unidade}</span>
                    {it.linkCompra && <a href={it.linkCompra} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--teal)', textDecoration: 'none', padding: '2px 6px', border: '1px solid var(--teal)', borderRadius: 4 }}>Loja</a>}
                    {waLink && <a href={waLink} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#fff', background: '#25d366', padding: '2px 6px', borderRadius: 4, textDecoration: 'none' }}>WA</a>}
                  </div>
                )
              })}
              <button onClick={() => {
                const txt = faltas.map(it => `${it.nome}: ${fmtQtd(it.necessario - (it.estoque || 0))}${it.unidade}`).join('\n')
                if (navigator.clipboard) navigator.clipboard.writeText('Lista de compras:\n' + txt)
              }} style={{ width: '100%', marginTop: 8, padding: 9, borderRadius: 8, border: '1px solid #f59e0b', background: 'transparent', color: '#f59e0b', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>📋 Copiar lista de compras</button>
            </div>
          )}
          {debitosTotais.map((it, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13 }}>
              <span style={{ color: it.estoque != null && it.estoque < it.necessario ? '#ef4444' : 'var(--text-primary)' }}>{it.nome}</span>
              <span style={{ fontWeight: 600 }}>{fmtQtd(it.necessario)}{it.unidade}</span>
            </div>
          ))}
        </Folha>
      )}

      {/* Folha: do estoque */}
      {folha === 'estoque' && (
        <Folha title="Do estoque · não precisa fazer" onClose={() => setFolha(null)}>
          {usoEstoque.map(({ rec, q: qq }) => (
            <div key={rec.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '6px 0' }}>
              <span>{rec.nome}</span>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{fmtQtd(qq)} {rec.unidadeGera}</span>
            </div>
          ))}
        </Folha>
      )}

      {montarAlvo && (
        <MontarSheet alvo={montarAlvo} onClose={() => setMontarAlvo(null)}
          onDone={async () => { setMontarAlvo(null); await reload(); reloadProdutos() }} />
      )}
      {porcaoAlvo && (
        <PorcaoSheet alvo={porcaoAlvo} prodId={prod.id} dosesPerReceita={dosesPerReceita} onClose={() => setPorcaoAlvo(null)}
          onDone={async () => { setPorcaoAlvo(null); await reload(); reloadProdutos() }} />
      )}

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

function Folha({ title, onClose, children }) {
  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div className="sheet" style={{ maxHeight: '88vh', overflowY: 'auto' }}>
        <div className="sheet-title">
          <span>{title}</span>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 22, cursor: 'pointer' }} onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </>
  )
}

// Montado: quantos saíram de verdade → entra no estoque (1ª etapa do Prontidão)
function MontarSheet({ alvo, onClose, onDone }) {
  const { item, p, comps, montado } = alvo
  const [qtd, setQtd] = useState(String(montado?.qtd ?? item.quantidade ?? 1))
  // Etapas do Prontidão desse produto — lembra a última escolhida por produto
  const etapas = etapasDoProduto(p)
  const chaveMem = `montagem_etapa_${p.id}`
  const [etapa, setEtapa] = useState(() => {
    const salva = montado?.etapa || (() => { try { return localStorage.getItem(chaveMem) } catch { return null } })()
    return etapas.some(e => e.key === salva) ? salva : (etapas[0]?.key || null)
  })
  const [salvando, setSalvando] = useState(false)
  const faltam = comps.filter(c => !c.pronta)
  const n = parseFloat(qtd) || 0
  const btn = { width: 54, height: 54, borderRadius: 14, border: '1px solid #333', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 26, cursor: 'pointer' }

  async function rodar(fn) {
    setSalvando(true)
    try { await fn(); onDone() } catch (e) { alert('Erro: ' + e.message); setSalvando(false) }
  }

  return (
    <Folha title={`Montar · ${p.nome}`} onClose={onClose}>
      {faltam.length > 0 && !montado && (
        <div style={{ fontSize: 13, color: '#f59e0b', background: 'rgba(245,158,11,.08)', borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
          Ainda não marcado como pronto: {faltam.map(c => c.nome).join(', ')}
        </div>
      )}
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center' }}>Quantos você montou?</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, margin: '8px 0 6px' }}>
        <button style={btn} onClick={() => setQtd(v => String(Math.max(0, (parseFloat(v) || 0) - 1)))}>−</button>
        <input type="text" inputMode="numeric" value={qtd} onChange={e => setQtd(e.target.value.replace(/[^\d.]/g, ''))} onFocus={e => e.target.select()}
          style={{ width: 90, textAlign: 'center', fontSize: 40, fontWeight: 800, background: 'transparent', border: 'none', color: 'var(--text-primary)', outline: 'none' }} />
        <button style={btn} onClick={() => setQtd(v => String((parseFloat(v) || 0) + 1))}>+</button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center', marginBottom: 14 }}>
        planejado: {item.quantidade}
      </div>
      {etapas.length > 1 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Vai para</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
            {etapas.map(e => {
              const on = etapa === e.key
              const cor = (LOCAL[e.local] || LOCAL.freezer).cor
              return (
                <button key={e.key} onClick={() => setEtapa(e.key)} style={{
                  flex: 1, minWidth: 90, padding: '10px 8px', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 700,
                  border: `1.5px solid ${on ? cor : '#333'}`, background: on ? `${cor}1f` : 'transparent', color: on ? cor : 'var(--text-secondary)',
                }}>{e.local === 'freezer' ? '❄ ' : ''}{e.nome}</button>
              )
            })}
          </div>
        </>
      )}
      <button className="btn-primary" disabled={salvando || !(n > 0)} onClick={() => rodar(() => { try { if (etapa) localStorage.setItem(chaveMem, etapa) } catch {} return marcarMontado(item.id, n, etapas.length ? etapa : null) })}>
        {salvando ? 'Salvando...' : montado ? `Corrigir para ${n}` : `Montado · ${n}`}
      </button>
      {montado && (
        <button disabled={salvando} onClick={() => rodar(() => desmarcarMontado(item.id))} style={{ width: '100%', marginTop: 8, padding: 11, borderRadius: 10, border: '1px solid #7f1d1d', background: 'transparent', color: '#f87171', fontWeight: 600, cursor: 'pointer' }}>
          Desfazer montagem (tira {fmtQtd(montado.qtd)} do estoque)
        </button>
      )}
    </Folha>
  )
}

// Ajustar porção por unidade — só nesta produção, ou na ficha do produto
function PorcaoSheet({ alvo, prodId, dosesPerReceita, onClose, onDone }) {
  const { item, p, comps } = alvo
  const [vals, setVals] = useState(() => Object.fromEntries(comps.map(c => [c.receitaId, String(c.porUn)])))
  const [salvando, setSalvando] = useState(false)
  const mudados = comps.filter(c => { const v = parseFloat(vals[c.receitaId]); return v > 0 && Math.abs(v - c.porUn) > 1e-9 })

  async function salvar(naFicha) {
    setSalvando(true)
    try {
      for (const c of mudados) {
        const novo = parseFloat(vals[c.receitaId])
        // quanto desta receita sai deste item, escalado pela nova porção
        const contrib = item.snapshot?.dosesContrib?.[c.receitaId] || 0
        const total = dosesPerReceita[String(c.receitaId)] || 0
        const novoTotal = contrib > 0 && total > 0 ? total + contrib * (novo / c.porUn - 1) : 0
        if (naFicha) await atualizarPorcaoProduto(p, c.receitaId, novo)
        await setPorcaoProducao(prodId, item.id, c.receitaId, novo, novoTotal)
      }
      onDone()
    } catch (e) { alert('Erro: ' + e.message); setSalvando(false) }
  }

  return (
    <Folha title={`Porção · ${p.nome}`} onClose={onClose}>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
        Quanto de cada receita vai em <b>uma unidade</b>. Mudar aqui recalcula o quanto produzir.
      </div>
      {comps.map(c => (
        <div key={c.receitaId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid #262626' }}>
          <span style={{ flex: 1, fontSize: 14 }}>{c.nome}</span>
          <input type="text" inputMode="decimal" value={vals[c.receitaId]} onFocus={e => e.target.select()}
            onChange={e => setVals(v => ({ ...v, [c.receitaId]: e.target.value.replace(',', '.') }))}
            style={{ width: 80, textAlign: 'center', fontSize: 16, fontWeight: 700, padding: '6px', borderRadius: 8, border: `1px solid ${mudados.includes(c) ? 'var(--teal)' : '#333'}`, background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)', width: 40 }}>{c.unidade}/un</span>
        </div>
      ))}
      <button className="btn-primary" style={{ marginTop: 14 }} disabled={salvando || !mudados.length} onClick={() => salvar(true)}>
        {salvando ? 'Salvando...' : 'Salvar no produto (esta e as próximas)'}
      </button>
      <button disabled={salvando || !mudados.length} onClick={() => salvar(false)} style={{ width: '100%', marginTop: 8, padding: 12, borderRadius: 10, border: '1px solid #333', background: 'transparent', color: 'var(--text-primary)', fontWeight: 600, cursor: 'pointer', opacity: mudados.length ? 1 : 0.5 }}>
        Só nesta produção
      </button>
    </Folha>
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
    const prods = produtos.filter(p => p.tipo !== 'avulso' && p.tipo !== 'combo' && !(p.componentes || []).length && norm(p.nome).includes(q) && (q || p.ativo !== false))
      .map(p => ({ tipo: 'produto', id: p.id, nome: p.nome, sub: `${(p.receitas || []).length} receita(s)` }))
    if (filtroTipo === 'receitas') return recs
    if (filtroTipo === 'produtos') return prods
    return [...prods, ...recs]
  }, [receitas, produtos, busca, filtroTipo])

  function toggle(tipo, item) {
    if (inLote(tipo, item.id)) { setLote(l => l.filter(x => !(x.tipo === tipo && x.refId === item.id))); return }
    if (tipo === 'produto') setLote(l => [...l, { tipo: 'produto', refId: item.id, nome: item.nome, qtd: lotePadraoProduto(produtos.find(p => p.id === item.id), receitas) }])
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
