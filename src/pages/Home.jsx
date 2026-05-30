import { useState, useMemo, useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useData } from '../hooks/useData'
import { getEncomendas, getInsumos, getEmbalagens, getProdutos, getProducoes, computeAjustesPendentes, getReceitas, updateProducaoChecks } from '../services/db'
import { getConfig, CONFIG_DEFAULTS } from '../hooks/useConfig'
import { NovoPedidoSheet } from './Pedidos'
import { useToast } from '../hooks/useToast'
import { useNavigate } from 'react-router-dom'

function ThermalChip({ icon, count, color, bg }) {
  if (!count) return null
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 11, fontWeight: 600, color,
      background: bg, borderRadius: 20, padding: '3px 8px',
    }}>
      {icon} {count}
    </span>
  )
}

const THERMAL_TYPES_HOME = [
  { key: 'ferver',   steps: ['ferver'],   icon: '🍲', color: '#fb923c' },
  { key: 'assar',    steps: ['assar'],    icon: '🔥', color: '#f97316' },
  { key: 'resfriar', steps: ['resfriar'], icon: '💧', color: '#2dd4bf' },
  { key: 'congelar', steps: ['congelar'], icon: '❄️', color: '#60a5fa' },
]

function parseSteps(instrucoes) {
  if (!instrucoes) return []
  try { const p = JSON.parse(instrucoes); return Array.isArray(p) ? p : [] }
  catch { return [] }
}

function thermalsOfHome(rec) {
  if (!rec) return []
  const tipos = new Set(parseSteps(rec.instrucoes).map(s => s.tipo))
  const result = []
  if (tipos.has('ferver'))                                              result.push(THERMAL_TYPES_HOME[0])
  if (tipos.has('assar') || Number(rec.tempoForno) > 0 || Number(rec.tempForno) > 0)  result.push(THERMAL_TYPES_HOME[1])
  if (tipos.has('resfriar') || rec.tipoResfriamento === 'geladeira')   result.push(THERMAL_TYPES_HOME[2])
  if (tipos.has('congelar') || rec.tipoResfriamento === 'congelador')  result.push(THERMAL_TYPES_HOME[3])
  return result
}

function ThermalDots({ thermals }) {
  if (!thermals?.length) return null
  return (
    <span style={{ display: 'inline-flex', gap: 1 }}>
      {thermals.map(t => <span key={t.key} style={{ fontSize: 12 }}>{t.icon}</span>)}
    </span>
  )
}


function formatDate(val) {
  if (!val) return ''
  const d = new Date(val + 'T00:00:00')
  if (isNaN(d)) return val
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function isToday(val) {
  if (!val) return false
  const today = new Date()
  const d = new Date(val + 'T00:00:00')
  return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear()
}

function isUpcoming(val) {
  if (!val) return false
  const d = new Date(val + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return d >= today
}

function nivelEstoque(atual, min) {
  if (atual === null || atual === undefined || !min || min <= 0) return 2
  const ratio = atual / min
  if (ratio <= 0.5) return 0
  if (ratio < 1)    return 1
  return 2
}



function dateLabel(val) {
  if (!val) return null
  const today = new Date(); today.setHours(0,0,0,0)
  const d = new Date(val + 'T00:00:00')
  const diff = Math.round((d - today) / 86400000)
  if (diff < 0)   return { text: 'Atrasado', color: 'var(--alert-text)', bg: 'var(--alert-bg)', pill: true }
  if (diff === 0) return { text: 'Hoje',     color: 'var(--warn-text)',  bg: 'var(--warn-bg)',  pill: true }
  if (diff === 1) return { text: 'Amanhã',   color: 'var(--text-secondary)', bg: null }
  return {
    text: d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric' }).replace('.', ''),
    color: 'var(--text-secondary)', bg: null,
  }
}

function EncomendaCard({ enc }) {
  const navigate = useNavigate()
  const itemStr = (enc.itens || [])
    .map(i => i.quantidade > 1 ? `${i.produto} ×${i.quantidade}` : i.produto)
    .join(', ') || '—'
  const dl = enc.dataEntrega ? dateLabel(enc.dataEntrega) : null

  return (
    <div
      onClick={() => navigate('/pedidos', { state: { openPedidoId: enc.id } })}
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border-light-color)',
        borderRadius: 12,
        padding: '12px 14px',
        marginBottom: 6,
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', marginBottom: 2 }}>{enc.cliente}</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{itemStr}</div>
      </div>
      {dl && (
        <span style={{
          fontSize: 12, fontWeight: 700, flexShrink: 0,
          color: dl.color,
          ...(dl.pill ? { background: dl.bg, borderRadius: 6, padding: '3px 8px' } : {}),
        }}>
          {dl.text}
        </span>
      )}
      {!dl && <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>📱 Online</span>}
    </div>
  )
}

export default function Home() {
  const { signOut, user, profile, updateProfile } = useAuth()
  const navigate = useNavigate()
  const { toast, show } = useToast()
  const [novoPedido, setNovoPedido] = useState(false)
  const [localChecks, setLocalChecks] = useState(null) // { producaoId, checks: Set }
  const checksRef = useRef(null) // mesma estrutura, evita closure stale
  const { data: encomendas, loading: loadEnc, reload: reloadEnc } = useData(getEncomendas)
  const { data: insumos,    loading: loadIns, reload: reloadIns } = useData(getInsumos)
  const { data: embalagens, loading: loadEmb, reload: reloadEmb } = useData(getEmbalagens)
  const { data: produtos,   loading: loadProd, reload: reloadProd } = useData(getProdutos)
  const { data: producoes, reload: reloadProducoes } = useData(getProducoes)
  const { data: receitas }  = useData(getReceitas)
  const ajustes = useMemo(() => computeAjustesPendentes(producoes || []), [producoes])

  const aplicarAjuste = (itens, map) => {
    if (!map || Object.keys(map).length === 0) return itens
    return itens.map(i => {
      const d = map[i.id] || 0
      if (d === 0) return i
      return { ...i, estoqueAtual: Math.max(0, (i.estoqueAtual ?? 0) + d) }
    })
  }

  const reloadAll = () => { reloadEnc(); reloadIns(); reloadEmb(); reloadProd() }

  const toggleCheck = useCallback(async (producaoId, receitaId) => {
    const key = String(receitaId)
    // Sempre lê do ref para evitar closure stale em clicks rápidos
    const prevSet = checksRef.current?.producaoId === producaoId
      ? new Set(checksRef.current.checks)
      : new Set((producoes || []).find(p => p.id === producaoId)?.checks?.map(String) || [])
    if (prevSet.has(key)) prevSet.delete(key)
    else prevSet.add(key)
    checksRef.current = { producaoId, checks: prevSet }
    setLocalChecks({ producaoId, checks: new Set(prevSet) })
    try {
      await updateProducaoChecks(producaoId, Array.from(prevSet))
    } catch {
      checksRef.current = null
      setLocalChecks(null)
      reloadProducoes()
    }
  }, [producoes, reloadProducoes])

  // Active mise en place
  const receitaMap = useMemo(() => {
    const m = {}
    for (const r of (receitas || [])) m[r.id] = r
    return m
  }, [receitas])

  const ultimaProducaoAtiva = useMemo(() => {
    for (const prod of (producoes || [])) {
      const dosesPerReceita = {}
      for (const item of prod.itens) {
        if (item.snapshot?.dosesContrib) {
          for (const [rid, d] of Object.entries(item.snapshot.dosesContrib)) {
            dosesPerReceita[rid] = (dosesPerReceita[rid] || 0) + d
          }
        }
      }
      const topLevelIds = new Set(Object.keys(dosesPerReceita).map(Number))

      // walk sub-receitas
      const subMap = {}
      function walkSub(recId, parentDoses, depth = 0) {
        if (depth > 5) return
        const rec = receitaMap[recId]
        if (!rec) return
        for (const ing of (rec.ingredientes || [])) {
          if (!ing.subReceitaId) continue
          const subRec = receitaMap[ing.subReceitaId]
          if (!subRec || !subRec.rendimento) continue
          const subDoses = (ing.quantidade * parentDoses) / subRec.rendimento
          if (!subMap[ing.subReceitaId]) subMap[ing.subReceitaId] = 0
          subMap[ing.subReceitaId] += subDoses
          walkSub(ing.subReceitaId, subDoses, depth + 1)
        }
      }
      for (const [recIdStr, doses] of Object.entries(dosesPerReceita)) {
        walkSub(Number(recIdStr), doses)
      }
      const subIds = Object.keys(subMap)
        .filter(sid => !topLevelIds.has(Number(sid)))
        .map(sid => `sub-${sid}`)

      const receitaIds = new Set(Object.keys(dosesPerReceita))
      const total = receitaIds.size + subIds.length
      const checkedSet = localChecks?.producaoId === prod.id
        ? localChecks.checks
        : new Set((prod.checks || []).map(String))
      const done = [...receitaIds].filter(id => checkedSet.has(id)).length
        + subIds.filter(id => checkedSet.has(id)).length
      if (total > 0 && done < total) {
        // Build a lookup: receitaId (string) -> { nome, qtd, unidade }
        const recipeInfoMap = {}
        for (const item of prod.itens) {
          if (item.tipo === 'receita' && item.receitaId) {
            const key = String(item.receitaId)
            recipeInfoMap[key] = { nome: item.nome, qtd: item.rendimentoTotal || 0, unidade: item.unidadeGera || 'un' }
          }
          for (const [rid, doses] of Object.entries(item.snapshot?.dosesContrib || {})) {
            if (!recipeInfoMap[rid]) {
              const rec = receitaMap[Number(rid)]
              recipeInfoMap[rid] = { nome: rec?.nome || '', qtd: 0, unidade: rec?.unidadeGera || 'un' }
            }
            recipeInfoMap[rid].qtd += doses * (receitaMap[Number(rid)]?.rendimento || 0)
          }
        }
        // Mantém ordem original, checked fica na posição e fica riscado
        const allItems = [...receitaIds]
          .map(id => {
            const info = recipeInfoMap[id]
            const rec  = receitaMap[Number(id)]
            return {
              id,
              nome: info?.nome || rec?.nome || '',
              qtd: info?.qtd || 0,
              unidade: info?.unidade || rec?.unidadeGera || 'un',
              thermals: thermalsOfHome(rec),
              checked: checkedSet.has(id),
            }
          })
          .filter(i => i.nome)
        const pendingItems = allItems.filter(i => !i.checked)
        const thermalCounts = {}
        for (const item of pendingItems) for (const t of (item.thermals || [])) thermalCounts[t.key] = (thermalCounts[t.key] || 0) + 1
        return { ...prod, total, done, pct: Math.round(done / total * 100), allItems, pendingItems, thermalCounts }
      }
    }
    return null
  }, [producoes, receitaMap, localChecks])

  const proximas = (encomendas || [])
    .filter(e => {
      if (e.status === 'Cancelado') return false
      if (e.status === 'Entregue' && e.pgto === 'Pago') return false
      if (!e.dataEntrega) return true
      return isUpcoming(e.dataEntrega)
    })
    .sort((a, b) => {
      if (!a.dataEntrega && !b.dataEntrega) return 0
      if (!a.dataEntrega) return -1
      if (!b.dataEntrega) return 1
      return new Date(a.dataEntrega) - new Date(b.dataEntrega)
    })
    .slice(0, 8)

  const insumosFut = aplicarAjuste(insumos || [], ajustes?.insumos)
  const produtosFut = aplicarAjuste(produtos || [], ajustes?.produtos)
  const alertasInsumos = insumosFut.filter(i => i.estoqueAtual !== null && i.estoqueMin > 0 && nivelEstoque(i.estoqueAtual, i.estoqueMin) < 2)
  const alertasEmb = (embalagens || []).filter(e => e.estoqueAtual !== null && e.estoqueMin > 0 && nivelEstoque(e.estoqueAtual, e.estoqueMin) < 2)
  const alertasProd = produtosFut.filter(p => p.estoqueAtual !== null && p.estoqueMin > 0 && nivelEstoque(p.estoqueAtual, p.estoqueMin) < 2)
  const totalAlertas = alertasInsumos.length + alertasEmb.length + alertasProd.length

  const acoesAgora = useMemo(() => {
    const out = []
    const t = new Date(); t.setHours(0, 0, 0, 0)
    const atrasados = (encomendas || []).filter(e =>
      e.status !== 'Cancelado' && e.status !== 'Entregue' &&
      e.dataEntrega && new Date(e.dataEntrega + 'T00:00:00') < t
    )
    if (atrasados.length > 0) {
      out.push({ label: `${atrasados.length} entrega${atrasados.length !== 1 ? 's' : ''} atrasada${atrasados.length !== 1 ? 's' : ''}`, color: 'var(--alert-text)', bg: 'var(--alert-bg)', onClick: () => navigate('/pedidos') })
    }
    const cobranca = (encomendas || []).filter(e =>
      e.status !== 'Cancelado' && e.pgto !== 'Pago' && e.saldo > 0 &&
      e.dataEntrega && new Date(e.dataEntrega + 'T00:00:00') < t
    )
    if (cobranca.length > 0) {
      const tot = cobranca.reduce((s, e) => s + (e.saldo || 0), 0)
      out.push({ label: `Cobrar R$ ${tot.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`, color: 'var(--warn-text)', bg: 'var(--warn-bg)', onClick: () => navigate('/pedidos') })
    }
    if (totalAlertas > 0) {
      out.push({ label: `${totalAlertas} insumo${totalAlertas !== 1 ? 's' : ''} → Compras`, color: 'var(--alert-text)', bg: 'var(--alert-bg)', onClick: () => navigate('/contagem') })
    }
    return out
  }, [encomendas, totalAlertas, navigate])

  const hoje = new Date()
  const horaAtual = hoje.getHours()
  const saudacao = horaAtual < 12 ? 'Bom dia' : horaAtual < 18 ? 'Boa tarde' : 'Boa noite'
  const diaSemana = hoje.toLocaleDateString('pt-BR', { weekday: 'long' })
  const dataStr = hoje.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })
  const primeiroNome = user?.user_metadata?.given_name || user?.user_metadata?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'você'

  return (
    <>
      {/* Desktop topbar */}
      <div className="topbar desktop-only">
        <div className="topbar-inner">
          <div>
            <div className="topbar-title">Olá, {primeiroNome}</div>
            <div className="topbar-sub">{diaSemana.charAt(0).toUpperCase() + diaSemana.slice(1)}, {dataStr}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn-ghost" onClick={reloadAll} style={{ fontSize: 18, padding: '4px 10px', border: 'none', color: 'var(--text-secondary)' }} title="Atualizar">↻</button>
            <button onClick={() => setNovoPedido(true)} style={{ background: 'var(--teal)', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>+ Pedido</button>
          </div>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 16 }}>
        {/* Mobile greeting */}
        <div className="mobile-only" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            {saudacao}, {primeiroNome}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            {diaSemana.charAt(0).toUpperCase() + diaSemana.slice(1)}, {dataStr}
          </div>
        </div>

        {/* Setup checklist */}
        {(() => {
          if (!profile?.onboardingDone) return null
          if (loadEnc || loadIns || loadProd) return null
          const cfg = getConfig()
          const steps = [
            { label: 'Cadastrar insumos', sub: 'Ingredientes e embalagens', path: '/cadastros', done: (insumos || []).length > 0 },
            { label: 'Montar seu cardápio', sub: 'Produtos que você vende', path: '/produtos', done: (produtos || []).filter(p => p.tipo !== 'combo').length > 0 },
            { label: 'Definir margens & custos', sub: 'Margem de lucro e custos fixos', path: '/configuracoes', done: cfg.custoFixoMensal > 0 || cfg.margem !== CONFIG_DEFAULTS.margem },
            { label: 'Registrar primeiras vendas', sub: 'Anote seus pedidos e encomendas', path: '/pedidos', done: (encomendas || []).length > 0 },
          ]
          if (steps.every(s => s.done)) return null
          const doneCt = steps.filter(s => s.done).length
          return (
            <div className="card" style={{ background: 'var(--teal-light)', border: '1px solid var(--teal-dark)', marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--teal)', marginBottom: 2 }}>
                Vamos preparar a {profile?.nomeLoja || 'sua loja'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--teal)', opacity: 0.7, marginBottom: 14 }}>
                {doneCt} de {steps.length} concluídos
              </div>
              {steps.map((step, i) => (
                <button key={i} onClick={() => !step.done && navigate(step.path)} style={{
                  display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                  padding: '10px 12px', borderRadius: 8, marginBottom: 6, textAlign: 'left',
                  border: '1px solid rgba(34,184,134,0.2)',
                  background: step.done ? 'rgba(13,51,38,0.3)' : 'rgba(13,51,38,0.6)',
                  cursor: step.done ? 'default' : 'pointer', opacity: step.done ? 0.6 : 1,
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                    background: step.done ? 'transparent' : 'var(--teal)',
                    border: step.done ? '2px solid var(--teal)' : 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 800, color: step.done ? 'var(--teal)' : '#fff',
                  }}>{step.done ? '✓' : i + 1}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--teal)', textDecoration: step.done ? 'line-through' : 'none', opacity: step.done ? 0.7 : 1 }}>{step.label}</div>
                    {!step.done && <div style={{ fontSize: 11, color: 'var(--teal)', opacity: 0.6, marginTop: 1 }}>{step.sub}</div>}
                  </div>
                  {!step.done && <span style={{ color: 'var(--teal)', opacity: 0.5, fontSize: 16 }}>›</span>}
                </button>
              ))}
            </div>
          )
        })()}

        {/* Action chips */}
        {acoesAgora.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            {acoesAgora.map((a, i) => (
              <button key={i} onClick={a.onClick} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '6px 11px', borderRadius: 16,
                background: a.bg, border: 'none', color: a.color,
                fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
              }}>
                {a.label}
              </button>
            ))}
          </div>
        )}

        {/* Production card — active mise en place */}
        {ultimaProducaoAtiva && (
          <div style={{ marginBottom: 16 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)',
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8,
            }}>Produção ativa</div>
            <div
              onClick={() => navigate(`/producao/${ultimaProducaoAtiva.id}`)}
              style={{ background: 'var(--bg-card)', borderRadius: 14, border: '0.5px solid var(--border-light-color)', overflow: 'hidden', cursor: 'pointer' }}
            >
              {/* Header row */}
              <div style={{ padding: '14px 14px 10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                      Mise en Place #{ultimaProducaoAtiva.id}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                      {ultimaProducaoAtiva.done} de {ultimaProducaoAtiva.total} prontos
                    </div>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--teal)', lineHeight: 1 }}>
                    {ultimaProducaoAtiva.pct}%
                  </div>
                </div>
                {/* Progress bar */}
                <div style={{ height: 4, borderRadius: 2, background: 'var(--border-light-color)', marginTop: 10, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${ultimaProducaoAtiva.pct}%`, borderRadius: 2, background: 'linear-gradient(90deg, var(--teal), #28d9a0)', transition: 'width .4s ease' }}/>
                </div>
                {/* Thermal summary chips */}
                {Object.keys(ultimaProducaoAtiva.thermalCounts || {}).length > 0 && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {THERMAL_TYPES_HOME.map(t => (
                      <ThermalChip key={t.key} icon={t.icon} count={ultimaProducaoAtiva.thermalCounts[t.key]} color={t.color} bg={`${t.color}1a`} />
                    ))}
                  </div>
                )}
              </div>

              {/* Checklist preview */}
              {ultimaProducaoAtiva.allItems.length > 0 && (
                <div style={{ borderTop: '0.5px solid var(--border-light-color)', padding: '8px 14px 0' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                    Pendentes ({ultimaProducaoAtiva.total - ultimaProducaoAtiva.done})
                  </div>
                  {ultimaProducaoAtiva.allItems.slice(0, 5).map((item, i) => (
                    <div
                      key={item.id}
                      onClick={e => { e.stopPropagation(); toggleCheck(ultimaProducaoAtiva.id, item.id) }}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: i < Math.min(ultimaProducaoAtiva.allItems.length, 5) - 1 ? '0.5px solid var(--border-light-color)' : 'none', cursor: 'pointer' }}
                    >
                      <div style={{
                        width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                        border: item.checked ? 'none' : '1.5px solid var(--border-light-color)',
                        background: item.checked ? 'var(--teal)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'background .15s, border .15s',
                      }}>
                        {item.checked && (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M2 5l2.5 2.5L8 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: item.checked ? 'var(--text-tertiary)' : 'var(--text-primary)', textDecoration: item.checked ? 'line-through' : 'none', transition: 'color .15s' }}>{item.nome}</span>
                      {!item.checked && <ThermalDots thermals={item.thermals} />}
                      {!item.checked && item.qtd > 0 && <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{Math.round(item.qtd)} {item.unidade}</span>}
                    </div>
                  ))}
                </div>
              )}

              {/* Footer */}
              <div style={{ padding: '10px 14px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                {ultimaProducaoAtiva.allItems.length > 5 && (
                  <span style={{ fontSize: 12, color: 'var(--teal)', fontWeight: 600 }}>
                    + {ultimaProducaoAtiva.allItems.length - 5} itens · Ver tudo →
                  </span>
                )}
                {ultimaProducaoAtiva.allItems.length <= 5 && (
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {new Date(ultimaProducaoAtiva.createdAt).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}
                  </span>
                )}
                <span style={{ fontSize: 12, color: 'var(--teal)', fontWeight: 600, marginLeft: 'auto' }}>Continuar →</span>
              </div>
            </div>
          </div>
        )}

        {/* Upcoming orders */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Pedidos próximos
            </span>
            <button onClick={() => navigate('/pedidos')} style={{ fontSize: 12, color: 'var(--teal)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }}>
              ver todos →
            </button>
          </div>

          {loadEnc ? (
            <div className="loading">Carregando...</div>
          ) : proximas.length === 0 ? (
            <div className="empty">
              <span>Nenhuma encomenda ativa</span>
              <button className="btn-outline-teal" style={{ marginTop: 8, maxWidth: 220 }} onClick={() => setNovoPedido(true)}>
                + Novo pedido
              </button>
            </div>
          ) : (
            proximas.map(enc => (
              <EncomendaCard key={enc.id} enc={enc} />
            ))
          )}
        </div>

        {/* Stock alert row */}
        {totalAlertas > 0 && (
          <button
            onClick={() => navigate('/contagem')}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              width: '100%', padding: '12px 14px',
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border-light-color)',
              borderRadius: 12, cursor: 'pointer',
              marginBottom: 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--alert-text)' }}>⚠</span>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {totalAlertas} insumo{totalAlertas !== 1 ? 's' : ''} abaixo do mínimo
              </span>
            </div>
            <span style={{ fontSize: 12, color: 'var(--teal)', fontWeight: 600 }}>Compras →</span>
          </button>
        )}
      </div>

      {novoPedido && <NovoPedidoSheet onClose={() => setNovoPedido(false)} onSaved={reloadEnc} />}
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
