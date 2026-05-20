import { useState, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useData } from '../hooks/useData'
import { getEncomendas, getInsumos, getEmbalagens, getProdutos, updateStatusEncomenda, getCompras, getVendas } from '../services/db'
import { NovoPedidoSheet } from './Pedidos'
import { useToast } from '../hooks/useToast'
import { useNavigate } from 'react-router-dom'

const STATUS_PROD = ['Pendente', 'Pronto', 'Entregue', 'Cancelado']
const STATUS_PGTO = ['Aguardando', 'Pago', 'Atrasado']

const PROD_BADGE = {
  'Pendente':   'badge-warn',
  'Pronto':     'badge-info',
  'Entregue':   'badge-teal',
  'Cancelado':  '',
}
const PGTO_BADGE = {
  'Aguardando': 'badge-alert',
  'Pago':       'badge-ok',
  'Atrasado':   'badge-alert',
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

// ── Sparkline helpers ─────────────────────────────────────────

function dailyValues(rows, getDate, getValue, days = 7) {
  const today = new Date()
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today)
    d.setDate(today.getDate() - (days - 1 - i))
    const dateStr = d.toISOString().slice(0, 10)
    return (rows || []).filter(r => getDate(r) === dateStr).reduce((s, r) => s + getValue(r), 0)
  })
}

function pctDiff(curr, prev) {
  const sc = curr.reduce((a, b) => a + b, 0)
  const sp = prev.reduce((a, b) => a + b, 0)
  if (sp === 0) return null
  return Math.round(((sc - sp) / sp) * 100)
}

// Full-width edge-to-edge sparkline for card bottoms
function SparklineEdge({ data, color, height = 40 }) {
  if (!data || data.length < 2) return <div style={{ height }} />
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const W = 100; const H = 100
  // Keep amplitude in lower 55% of height so line doesn't eat the card
  const floor = H * 0.38; const ceiling = H * 0.06
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W
    const y = floor + ceiling - ((v - min) / range) * (floor - ceiling)
    return [x, y]
  })
  // Smooth bezier: control points at midpoint x between each pair
  const line = pts.map(([x, y], i) => {
    if (i === 0) return `M${x},${y}`
    const [px, py] = pts[i - 1]
    const cx = (px + x) / 2
    return `C${cx},${py} ${cx},${y} ${x},${y}`
  }).join(' ')
  const area = `${line} L${W},${H} L0,${H} Z`
  return (
    <svg
      width="100%" height={height}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ display: 'block' }}
    >
      <path d={area} fill={color} fillOpacity="0.18" />
      <path d={line} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function InlineDiff({ pct, positive = true }) {
  if (pct === null || pct === undefined) return null
  const good = positive ? pct >= 0 : pct <= 0
  const color = good ? '#4ade80' : '#f87171'
  return (
    <span style={{ fontSize: 12, fontWeight: 600, color }}>
      {pct >= 0 ? '+' : ''}{pct}%
    </span>
  )
}

// Card with embedded sparkline at bottom
function MetricCard({ label, value, valueColor, diff, diffPositive = true, sparkData, sparkColor, subValue }) {
  return (
    <div style={{
      background: '#242424',
      border: '1px solid #333',
      borderRadius: 14,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 2px 12px rgba(0,0,0,0.45)',
    }}>
      <div style={{ padding: '14px 14px 8px', flex: 1 }}>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>
          {label}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: valueColor || 'var(--text-primary)', lineHeight: 1 }}>
            {value}
          </div>
          {subValue && (
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{subValue}</span>
          )}
          {diff !== undefined && <InlineDiff pct={diff} positive={diffPositive} />}
        </div>
      </div>
      <SparklineEdge data={sparkData} color={sparkColor} height={52} />
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────

function StatusSelect({ value, options, badgeMap, onChange }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className={`badge ${badgeMap[value] || 'badge-warn'}`}
        style={{ border: 'none', cursor: 'pointer', padding: '4px 10px' }}
        onClick={() => setOpen(!open)}
      >
        {value} ▾
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 50,
          background: 'var(--bg-card)', border: '1px solid #333', borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0,0,0,.3)', marginTop: 4, minWidth: 140,
          overflow: 'hidden',
        }}>
          {options.map(opt => (
            <button
              key={opt}
              onClick={() => { onChange(opt); setOpen(false) }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '8px 12px', border: 'none',
                background: opt === value ? '#333' : 'var(--bg-card)',
                cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)',
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function nivelEstoque(atual, min) {
  if (atual === null || atual === undefined || !min || min <= 0) return 2
  const ratio = atual / min
  if (ratio <= 0.5) return 0
  if (ratio < 1)    return 1
  return 2
}

function AlertaItem({ item }) {
  const nivel = nivelEstoque(item.estoqueAtual, item.estoqueMin)
  const cor         = nivel === 0 ? 'var(--alert-text)' : '#f59e0b'
  const borderColor = nivel === 0 ? 'var(--alert-text)' : '#92400e'
  const badgeLabel  = nivel === 0 ? 'Pedir' : 'Atenção'
  const badgeClass  = nivel === 0 ? 'badge-alert' : 'badge-warn'
  const digits = (item.whatsapp || '').toString().replace(/\D/g, '')
  const waHref = digits ? `https://wa.me/55${digits}` : null
  const pct = item.estoqueMin > 0 ? Math.min(100, (item.estoqueAtual / item.estoqueMin) * 100) : 0

  return (
    <div className="card" style={{ borderColor, marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: cor }}>{item.nome}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            Atual: {item.estoqueAtual ?? '—'} · Mín: {item.estoqueMin} {item.unidade}
            {item.fornecedor ? ` · ${item.fornecedor}` : ''}
          </div>
          <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, marginTop: 6, maxWidth: 160 }}>
            <div style={{ height: '100%', width: `${pct}%`, background: cor, borderRadius: 2, transition: 'width 0.3s' }} />
          </div>
          <div style={{ fontSize: 10, color: cor, marginTop: 2 }}>
            {pct.toFixed(0)}% do mínimo
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, marginLeft: 8, flexShrink: 0 }}>
          <span className={`badge ${badgeClass}`}>{badgeLabel}</span>
          {waHref && (
            <a href={waHref} target="_blank" rel="noreferrer"
              style={{ fontSize: 11, color: 'var(--teal)', textDecoration: 'none' }}>💬 WhatsApp</a>
          )}
          {item.linkCompra && (
            <a href={item.linkCompra} target="_blank" rel="noreferrer"
              style={{ fontSize: 11, color: 'var(--teal)', textDecoration: 'none' }}>🛒 Loja</a>
          )}
        </div>
      </div>
    </div>
  )
}

function EncomendaCard({ enc, onUpdateStatus }) {
  const itemStr = (enc.itens || [])
    .map(i => i.quantidade > 1 ? `${i.produto} x${i.quantidade}` : i.produto)
    .join(', ') || '—'
  return (
    <div className="card" style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>{enc.cliente}</span>
        <span style={{ fontSize: 12, color: isToday(enc.dataEntrega) ? 'var(--warn-text)' : 'var(--text-secondary)' }}>
          {formatDate(enc.dataEntrega)}{isToday(enc.dataEntrega) ? ' · hoje' : ''}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: enc.obs ? 4 : 8 }}>{itemStr}</div>
      {enc.obs && (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {enc.obs}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <StatusSelect
          value={enc.status}
          options={STATUS_PROD}
          badgeMap={PROD_BADGE}
          onChange={(val) => {
            const newPgto = val === 'Entregue' && enc.pgto !== 'Pago' ? 'Atrasado' : enc.pgto
            onUpdateStatus(enc, val, newPgto)
          }}
        />
        <StatusSelect
          value={enc.pgto || 'Aguardando'}
          options={STATUS_PGTO}
          badgeMap={PGTO_BADGE}
          onChange={(val) => onUpdateStatus(enc, enc.status, val)}
        />
      </div>
    </div>
  )
}

export default function Home() {
  const { signOut, user, profile, updateProfile } = useAuth()
  const navigate = useNavigate()
  const { toast, show } = useToast()
  const [alertasOpen, setAlertasOpen]   = useState(false)
  const [novoPedido, setNovoPedido]     = useState(false)
  const { data: encomendas, loading: loadEnc, reload: reloadEnc } = useData(getEncomendas)
  const { data: insumos,    loading: loadIns, reload: reloadIns } = useData(getInsumos)
  const { data: embalagens, loading: loadEmb, reload: reloadEmb } = useData(getEmbalagens)
  const { data: produtos,   loading: loadProd, reload: reloadProd } = useData(getProdutos)
  const { data: compras } = useData(getCompras)
  const { data: vendas }  = useData(getVendas)

  const reloadAll = () => { reloadEnc(); reloadIns(); reloadEmb(); reloadProd() }

  const proximas = (encomendas || [])
    .filter(e => {
      if (e.status === 'Cancelado') return false
      if (e.status === 'Entregue' && e.pgto === 'Pago') return false
      return isUpcoming(e.dataEntrega)
    })
    .sort((a, b) => new Date(a.dataEntrega) - new Date(b.dataEntrega))
    .slice(0, 8)

  const naoEntregues    = (encomendas || []).filter(e => e.status !== 'Cancelado' && e.status !== 'Entregue')
  const aReceber        = (encomendas || []).filter(e => e.status !== 'Cancelado' && e.pgto !== 'Pago').reduce((s, e) => s + (e.saldo || 0), 0)
  const pgtosPendentes  = (encomendas || []).filter(e => e.status !== 'Cancelado' && e.pgto !== 'Pago').length

  const alertasInsumos = (insumos || [])
    .filter(i => i.estoqueAtual !== null && i.estoqueAtual !== undefined && i.estoqueMin > 0 && nivelEstoque(i.estoqueAtual, i.estoqueMin) < 2)
    .sort((a, b) => nivelEstoque(a.estoqueAtual, a.estoqueMin) - nivelEstoque(b.estoqueAtual, b.estoqueMin))
  const alertasEmb = (embalagens || [])
    .filter(e => e.estoqueAtual !== null && e.estoqueAtual !== undefined && e.estoqueMin > 0 && nivelEstoque(e.estoqueAtual, e.estoqueMin) < 2)
    .sort((a, b) => nivelEstoque(a.estoqueAtual, a.estoqueMin) - nivelEstoque(b.estoqueAtual, b.estoqueMin))
  const alertasProd = (produtos || [])
    .filter(p => p.estoqueAtual !== null && p.estoqueAtual !== undefined && p.estoqueMin > 0 && nivelEstoque(p.estoqueAtual, p.estoqueMin) < 2)
    .map(p => ({ ...p, unidade: 'un' }))
    .sort((a, b) => nivelEstoque(a.estoqueAtual, a.estoqueMin) - nivelEstoque(b.estoqueAtual, b.estoqueMin))

  const totalAlertas = alertasInsumos.length + alertasEmb.length + alertasProd.length
  const criticos = [...alertasInsumos, ...alertasEmb, ...alertasProd].filter(i => nivelEstoque(i.estoqueAtual, i.estoqueMin) === 0)

  // Ações de agora
  const acoesAgora = useMemo(() => {
    const out = []
    const t = new Date(); t.setHours(0, 0, 0, 0)
    const atrasados = (encomendas || []).filter(e =>
      e.status !== 'Cancelado' && e.status !== 'Entregue' &&
      e.dataEntrega && new Date(e.dataEntrega + 'T00:00:00') < t
    )
    if (atrasados.length > 0) {
      out.push({ icon: '🔴', label: `${atrasados.length} pedido(s) atrasado(s)`, color: 'var(--alert-text)', bg: '#3b1f1f', onClick: () => navigate('/pedidos') })
    }
    const hoje = (encomendas || []).filter(e => {
      if (['Cancelado', 'Entregue'].includes(e.status)) return false
      if (!e.dataEntrega) return false
      const d = new Date(e.dataEntrega + 'T00:00:00')
      return d.getTime() === t.getTime()
    })
    if (hoje.length > 0) {
      out.push({ icon: '🟠', label: `${hoje.length} entrega(s) hoje`, color: '#fb923c', bg: '#7c2d12', onClick: () => navigate('/pedidos') })
    }
    const cobranca = (encomendas || []).filter(e =>
      e.status !== 'Cancelado' && e.pgto !== 'Pago' && e.saldo > 0 &&
      e.dataEntrega && new Date(e.dataEntrega + 'T00:00:00') < t
    )
    if (cobranca.length > 0) {
      const tot = cobranca.reduce((s, e) => s + (e.saldo || 0), 0)
      out.push({ icon: '💰', label: `Cobrar R$ ${tot.toLocaleString('pt-BR', { minimumFractionDigits: 0 })} (${cobranca.length})`, color: '#fbbf24', bg: '#3b2700', onClick: () => navigate('/pedidos') })
    }
    return out
  }, [encomendas, navigate])

  // Clientes recorrentes (últimos 60 dias)
  const recorrentes = useMemo(() => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 60)
    const map = {}
    for (const e of (encomendas || [])) {
      if (e.status === 'Cancelado') continue
      if (!e.dataEntrega) continue
      const d = new Date(e.dataEntrega + 'T00:00:00')
      if (d < cutoff) continue
      const k = e.cliente
      if (!map[k]) map[k] = { nome: k, count: 0, totalValor: 0, ultima: null }
      map[k].count++
      map[k].totalValor += e.valor || 0
      if (!map[k].ultima || d > map[k].ultima) map[k].ultima = d
    }
    return Object.values(map).filter(c => c.count >= 2).sort((a, b) => b.count - a.count).slice(0, 3)
  }, [encomendas])

  // ── Sparkline data ──────────────────────────────────────────
  const vendas7  = dailyValues(vendas, r => r.data, r => (r.quantidade || 0) * (r.precoUnit || 0), 7)
  const vendas7p = dailyValues(vendas, r => r.data, r => (r.quantidade || 0) * (r.precoUnit || 0), 14).slice(0, 7)
  const vendasTotal  = vendas7.reduce((a, b) => a + b, 0)
  const vendasDiff   = pctDiff(vendas7, vendas7p)

  const compras7  = dailyValues(compras, r => r.data, r => r.total || 0, 7)
  const compras7p = dailyValues(compras, r => r.data, r => r.total || 0, 14).slice(0, 7)
  const comprasDiff = pctDiff(compras7, compras7p)

  const mesAtual  = new Date().toISOString().slice(0, 7)
  const mesAnt    = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().slice(0, 7)

  const enc7cut  = new Date(); enc7cut.setDate(enc7cut.getDate() - 7); enc7cut.setHours(0,0,0,0)
  const enc14cut = new Date(); enc14cut.setDate(enc14cut.getDate() - 14); enc14cut.setHours(0,0,0,0)
  const enc7  = (encomendas || []).filter(e => e.status !== 'Cancelado' && e.dataEntrega && new Date(e.dataEntrega + 'T00:00:00') >= enc7cut).reduce((s, e) => s + (e.valor || 0), 0)
  const enc7p = (encomendas || []).filter(e => e.status !== 'Cancelado' && e.dataEntrega && new Date(e.dataEntrega + 'T00:00:00') >= enc14cut && new Date(e.dataEntrega + 'T00:00:00') < enc7cut).reduce((s, e) => s + (e.valor || 0), 0)
  const fatLiquido7  = vendas7.reduce((a, b) => a + b, 0) + enc7
  const fatLiquido7p = vendas7p.reduce((a, b) => a + b, 0) + enc7p
  const fatLiquidoDiff = fatLiquido7p !== 0 ? Math.round(((fatLiquido7 - fatLiquido7p) / Math.abs(fatLiquido7p)) * 100) : null

  const fmtR = (v) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

  const handleUpdateStatus = async (enc, novoStatus, novoPgto) => {
    try {
      await updateStatusEncomenda(enc.id, novoStatus, novoPgto)
      show(`${enc.cliente}: ${novoStatus} · ${novoPgto}`)
      reloadEnc()
    } catch (e) {
      show('Erro ao atualizar: ' + e.message)
    }
  }

  const hoje = new Date()
  const diaSemana = hoje.toLocaleDateString('pt-BR', { weekday: 'long' })
  const dataStr = hoje.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
  const primeiroNome = user?.user_metadata?.given_name || user?.user_metadata?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'você'

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div>
            <div className="topbar-title">Olá, {primeiroNome}</div>
            <div className="topbar-sub">{diaSemana.charAt(0).toUpperCase() + diaSemana.slice(1)}, {dataStr}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn-ghost" onClick={reloadAll} style={{ fontSize: 18, padding: '4px 10px', border: 'none', color: 'var(--text-secondary)' }} title="Atualizar">↻</button>
            <button onClick={() => setNovoPedido(true)} style={{ background: 'var(--teal)', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>+ Pedido</button>
            <button className="avatar mobile-only" onClick={signOut} title="Sair">
              {primeiroNome.charAt(0).toUpperCase()}
            </button>
          </div>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 16 }}>
        {/* Checklist de setup — baseado em dados reais */}
        {(() => {
          if (!profile?.onboardingDone) return null
          const steps = [
            {
              label: 'Cadastrar insumos',
              sub: 'Ingredientes e embalagens',
              path: '/cadastros',
              done: (insumos || []).length > 0,
            },
            {
              label: 'Montar seu cardápio',
              sub: 'Produtos que você vende',
              path: '/produtos',
              done: (produtos || []).filter(p => p.tipo !== 'combo').length > 0,
            },
            {
              label: 'Registrar primeiro pedido',
              sub: 'Anote sua primeira encomenda',
              path: '/pedidos',
              done: (encomendas || []).length > 0,
            },
          ]
          const allDone = steps.every(s => s.done)
          if (allDone) return null
          const doneCt = steps.filter(s => s.done).length
          return (
            <div className="card" style={{ background: 'var(--teal-light)', border: '1px solid var(--teal-dark)', marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--teal)', marginBottom: 2 }}>
                Vamos preparar a {profile?.nomeLoja || 'sua loja'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--teal)', opacity: 0.7, marginBottom: 14 }}>
                {doneCt} de {steps.length} concluídos · Some quando terminar tudo.
              </div>
              {steps.map((step, i) => (
                <button key={i} onClick={() => !step.done && navigate(step.path)} style={{
                  display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                  padding: '10px 12px', borderRadius: 8, marginBottom: 6, textAlign: 'left',
                  border: '1px solid rgba(34,184,134,0.2)',
                  background: step.done ? 'rgba(13,51,38,0.3)' : 'rgba(13,51,38,0.6)',
                  cursor: step.done ? 'default' : 'pointer',
                  opacity: step.done ? 0.6 : 1,
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                    background: step.done ? 'transparent' : 'var(--teal)',
                    border: step.done ? '2px solid var(--teal)' : 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 800, color: step.done ? 'var(--teal)' : '#fff',
                  }}>{step.done ? '✓' : i + 1}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontSize: 14, fontWeight: 500, color: 'var(--teal)',
                      textDecoration: step.done ? 'line-through' : 'none',
                      opacity: step.done ? 0.7 : 1,
                    }}>{step.label}</div>
                    {!step.done && <div style={{ fontSize: 11, color: 'var(--teal)', opacity: 0.6, marginTop: 1 }}>{step.sub}</div>}
                  </div>
                  {!step.done && <span style={{ color: 'var(--teal)', opacity: 0.5, fontSize: 16 }}>›</span>}
                </button>
              ))}
            </div>
          )
        })()}
        {/* 2×2 metric cards with embedded sparklines */}
        <div className="metric-grid" style={{ marginBottom: 16 }}>
          <MetricCard
            label="Pedidos ativos"
            value={loadEnc ? '—' : naoEntregues.length}
            sparkData={vendas7}
            sparkColor="#4ade80"
          />
          <MetricCard
            label="A receber"
            value={loadEnc ? '—' : fmtR(aReceber)}
            diff={vendasDiff}
            diffPositive
            sparkData={vendas7}
            sparkColor="#fb923c"
          />
          <MetricCard
            label="Pgto pendente"
            value={loadEnc ? '—' : pgtosPendentes}
            valueColor={pgtosPendentes > 0 ? 'var(--warn-text)' : undefined}
            sparkData={compras7}
            sparkColor="#eab308"
          />
          <MetricCard
            label="Fat. líquido 7d"
            value={vendas === null ? '—' : fmtR(fatLiquido7)}
            valueColor={fatLiquido7 < 0 ? 'var(--alert-text)' : undefined}
            diff={fatLiquidoDiff}
            diffPositive
            sparkData={vendas7}
            sparkColor="#a78bfa"
          />
        </div>

        {acoesAgora.length > 0 && (
          <>
            <div className="section-label">Ações de agora</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
              {acoesAgora.map((a, i) => (
                <button key={i} onClick={a.onClick} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 12px', borderRadius: 20,
                  background: a.bg, border: 'none', color: a.color,
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}>
                  <span>{a.icon}</span>
                  <span>{a.label}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="section-label">Próximas entregas</div>
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
            <EncomendaCard key={enc.id} enc={enc} onUpdateStatus={handleUpdateStatus} />
          ))
        )}

        {recorrentes.length > 0 && (
          <>
            <div className="section-label" style={{ marginTop: 16 }}>⭐ Clientes recorrentes</div>
            <div className="card card-flush" style={{ padding: '0 14px' }}>
              {recorrentes.map((c, i) => (
                <div key={c.nome} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 0',
                  borderBottom: i < recorrentes.length - 1 ? '1px solid var(--border)' : 'none',
                }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{c.nome}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      {c.count} pedidos · R$ {c.totalValor.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 10, background: 'var(--teal-light)', color: 'var(--teal)', fontWeight: 600 }}>
                    {c.count}× em 60d
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {totalAlertas > 0 && (
          <div style={{ marginTop: 16 }}>
            <button
              onClick={() => setAlertasOpen(o => !o)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                padding: '0 0 8px 0',
              }}
            >
              <span className="section-label" style={{ margin: 0 }}>Alertas de estoque</span>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {criticos.length > 0 && <span className="badge badge-alert">{criticos.length} pedir</span>}
                {(totalAlertas - criticos.length) > 0 && <span className="badge badge-warn">{totalAlertas - criticos.length} atenção</span>}
                <span style={{ color: 'var(--text-secondary)', fontSize: 13, marginLeft: 2 }}>{alertasOpen ? '▲' : '▼'}</span>
              </div>
            </button>
            {alertasOpen && (
              <>
                {alertasProd.length > 0 && (
                  <>
                    <div className="section-label" style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>Produtos</div>
                    {alertasProd.map(item => <AlertaItem key={`prod-${item.id}`} item={item} />)}
                  </>
                )}
                {alertasInsumos.length > 0 && (
                  <>
                    <div className="section-label" style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: alertasProd.length > 0 ? 10 : 0, marginBottom: 6 }}>Insumos</div>
                    {alertasInsumos.map(item => <AlertaItem key={`ins-${item.id}`} item={item} />)}
                  </>
                )}
                {alertasEmb.length > 0 && (
                  <>
                    <div className="section-label" style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: (alertasInsumos.length > 0 || alertasProd.length > 0) ? 10 : 0, marginBottom: 6 }}>Embalagens</div>
                    {alertasEmb.map(item => <AlertaItem key={`emb-${item.id}`} item={{ ...item, unidade: 'un' }} />)}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {novoPedido && <NovoPedidoSheet onClose={() => setNovoPedido(false)} onSaved={reloadEnc} />}
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
