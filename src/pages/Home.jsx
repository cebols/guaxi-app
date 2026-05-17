import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useData } from '../hooks/useData'
import { getEncomendas, getInsumos, getEmbalagens, getProdutos, updateStatusEncomenda, getCompras } from '../services/db'
import { NovoPedidoSheet } from './Pedidos'
import { useToast } from '../hooks/useToast'
import { useNavigate } from 'react-router-dom'

const STATUS_PROD = ['Pendente', 'Produzindo', 'Pronto', 'Entregue', 'Cancelado']
const STATUS_PGTO = ['Aguardando', 'Pago', 'Atrasado']

const PROD_BADGE = {
  'Pendente':   'badge-warn',
  'Produzindo': 'badge-info',
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

// 0=crítico (≤50% do mínimo), 1=atenção (50–100%), 2=ok (≥100%)
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
          {/* Progress bar */}
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
          {isToday(enc.dataEntrega) ? 'hoje' : formatDate(enc.dataEntrega)}
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
  const { signOut, user } = useAuth()
  const navigate = useNavigate()
  const { toast, show } = useToast()
  const [alertasOpen, setAlertasOpen]   = useState(false)
  const [novoPedido, setNovoPedido]     = useState(false)
  const { data: encomendas, loading: loadEnc, reload: reloadEnc } = useData(getEncomendas)
  const { data: insumos,    loading: loadIns, reload: reloadIns } = useData(getInsumos)
  const { data: embalagens, loading: loadEmb, reload: reloadEmb } = useData(getEmbalagens)
  const { data: produtos,   loading: loadProd, reload: reloadProd } = useData(getProdutos)
  const { data: compras } = useData(getCompras)

  const mesAtual = new Date().toISOString().slice(0, 7)
  const comprasMes = (compras || []).filter(c => c.data?.startsWith(mesAtual)).reduce((s, c) => s + (c.total || 0), 0)

  const reloadAll = () => { reloadEnc(); reloadIns(); reloadEmb(); reloadProd() }

  const proximas = (encomendas || [])
    .filter(e => {
      if (e.status === 'Cancelado') return false
      if (e.status === 'Entregue' && e.pgto === 'Pago') return false
      return isUpcoming(e.dataEntrega)
    })
    .sort((a, b) => new Date(a.dataEntrega) - new Date(b.dataEntrega))
    .slice(0, 8)

  const naoEntregues = (encomendas || []).filter(e => e.status !== 'Cancelado' && e.status !== 'Entregue')
  const aReceber = (encomendas || [])
    .filter(e => e.status !== 'Cancelado' && e.pgto !== 'Pago')
    .reduce((s, e) => s + (e.saldo || 0), 0)
  const pgtosPendentes = (encomendas || []).filter(e => e.status !== 'Cancelado' && e.pgto !== 'Pago').length

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
  const primeiroNome = user?.email?.split('@')[0] || 'Felipe'

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
        <div className="metric-grid" style={{ marginBottom: 16 }}>
          <div className="metric-card">
            <div className="metric-label">Pedidos ativos</div>
            <div className="metric-value">{loadEnc ? '—' : naoEntregues.length}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">A receber</div>
            <div className="metric-value" style={{ fontSize: 15 }}>
              {loadEnc ? '—' : `R$ ${aReceber.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Pgto pendente</div>
            <div className="metric-value" style={{ color: pgtosPendentes > 0 ? 'var(--warn-text)' : 'var(--text-primary)' }}>
              {loadEnc ? '—' : pgtosPendentes}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Compras mês</div>
            <div className="metric-value" style={{ fontSize: 14, color: comprasMes > 0 ? 'var(--alert-text)' : 'var(--text-primary)' }}>
              {compras === null ? '—' : comprasMes > 0 ? `R$ ${comprasMes.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}` : 'R$ 0'}
            </div>
          </div>
        </div>

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
                {criticos.length > 0 && (
                  <span className="badge badge-alert">{criticos.length} pedir</span>
                )}
                {(totalAlertas - criticos.length) > 0 && (
                  <span className="badge badge-warn">{totalAlertas - criticos.length} atenção</span>
                )}
                <span style={{ color: 'var(--text-secondary)', fontSize: 13, marginLeft: 2 }}>
                  {alertasOpen ? '▲' : '▼'}
                </span>
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
