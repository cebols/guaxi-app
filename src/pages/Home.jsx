import { useState, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useData } from '../hooks/useData'
import { getEncomendas, getInsumos, getEmbalagens, getProdutos, updateStatusEncomenda, getCompras, getVendas, getProducoes, computeAjustesPendentes } from '../services/db'
import { getConfig, CONFIG_DEFAULTS } from '../hooks/useConfig'
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

function nivelEstoque(atual, min) {
  if (atual === null || atual === undefined || !min || min <= 0) return 2
  const ratio = atual / min
  if (ratio <= 0.5) return 0
  if (ratio < 1)    return 1
  return 2
}

function StatusSelect({ value, options, badgeMap, onChange }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative', display: 'inline-block' }} onClick={e => e.stopPropagation()}>
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

function EncomendaCard({ enc, onUpdateStatus }) {
  const navigate = useNavigate()
  const itemStr = (enc.itens || [])
    .map(i => i.quantidade > 1 ? `${i.produto} x${i.quantidade}` : i.produto)
    .join(', ') || '—'
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
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{enc.cliente}</span>
        <span style={{
          fontSize: 12, fontWeight: 700,
          color: isToday(enc.dataEntrega) ? 'var(--warn-text)' : 'var(--text-secondary)',
          padding: '3px 8px', borderRadius: 6,
          background: isToday(enc.dataEntrega) ? 'var(--warn-bg)' : 'transparent',
        }}>
          {enc.dataEntrega ? formatDate(enc.dataEntrega) : '📱 Online'}
          {isToday(enc.dataEntrega) ? ' · hoje' : ''}
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
  const [novoPedido, setNovoPedido] = useState(false)
  const { data: encomendas, loading: loadEnc, reload: reloadEnc } = useData(getEncomendas)
  const { data: insumos,    loading: loadIns, reload: reloadIns } = useData(getInsumos)
  const { data: embalagens, loading: loadEmb, reload: reloadEmb } = useData(getEmbalagens)
  const { data: produtos,   loading: loadProd, reload: reloadProd } = useData(getProdutos)
  const { data: producoes } = useData(getProducoes)
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

  // Active mise en place
  const ultimaProducaoAtiva = useMemo(() => {
    for (const prod of (producoes || [])) {
      const receitaIds = new Set(
        prod.itens.flatMap(i =>
          i.snapshot?.dosesContrib
            ? Object.keys(i.snapshot.dosesContrib)
            : (i.receitaId ? [String(i.receitaId)] : [])
        )
      )
      const total = receitaIds.size
      const checkedSet = new Set((prod.checks || []).map(String))
      const done = [...receitaIds].filter(id => checkedSet.has(id)).length
      if (total > 0 && done < total) {
        const pendingItems = prod.itens
          .filter(i => !checkedSet.has(String(i.receitaId || '')))
          .map(i => i.nome).filter(Boolean).slice(0, 3)
        return { ...prod, total, done, pct: Math.round(done / total * 100), pendingItems }
      }
    }
    return null
  }, [producoes])

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

  const handleUpdateStatus = async (enc, novoStatus, novoPgto) => {
    try {
      await updateStatusEncomenda(enc.id, novoStatus, novoPgto)
      show(`${enc.cliente}: ${novoStatus} · ${novoPgto}`)
      reloadEnc()
    } catch (e) {
      show('Erro ao atualizar: ' + e.message)
    }
  }

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
              onClick={() => navigate('/mise-en-place')}
              style={{
                background: 'var(--bg-card)',
                borderRadius: 14,
                border: '0.5px solid var(--border-light-color)',
                overflow: 'hidden',
                cursor: 'pointer',
              }}
            >
              <div style={{ padding: '14px 14px 12px', borderBottom: '0.5px solid var(--border-light-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                      Mise en Place
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                      {ultimaProducaoAtiva.done} de {ultimaProducaoAtiva.total} prontos
                    </div>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--teal)', lineHeight: 1 }}>
                    {ultimaProducaoAtiva.pct}%
                  </div>
                </div>
                <div style={{ height: 4, borderRadius: 2, background: 'var(--border-light-color)', marginTop: 10, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: `${ultimaProducaoAtiva.pct}%`, borderRadius: 2,
                    background: 'linear-gradient(90deg, var(--teal), #28d9a0)',
                    transition: 'width .4s ease',
                  }}/>
                </div>
              </div>
              {ultimaProducaoAtiva.pendingItems?.length > 0 && (
                <div style={{ padding: '8px 14px 0', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {ultimaProducaoAtiva.pendingItems.map((nome, i) => (
                    <span key={i} style={{
                      fontSize: 11, color: 'var(--text-secondary)', background: 'var(--bg-secondary)',
                      borderRadius: 6, padding: '2px 7px', border: '0.5px solid var(--border-light-color)',
                    }}>{nome}</span>
                  ))}
                  {ultimaProducaoAtiva.total - ultimaProducaoAtiva.done > 3 && (
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: '2px 7px' }}>
                      +{ultimaProducaoAtiva.total - ultimaProducaoAtiva.done - ultimaProducaoAtiva.pendingItems.length} mais
                    </span>
                  )}
                </div>
              )}
              <div style={{ padding: '10px 14px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {new Date(ultimaProducaoAtiva.createdAt).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}
                </span>
                <span style={{ fontSize: 12, color: 'var(--teal)', fontWeight: 600 }}>Continuar →</span>
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
              <EncomendaCard key={enc.id} enc={enc} onUpdateStatus={handleUpdateStatus} />
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
