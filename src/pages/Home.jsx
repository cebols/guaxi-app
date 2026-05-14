import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useData } from '../hooks/useData'
import { getEncomendas, getInsumos, updateStatusEncomenda } from '../services/db'
import { useToast } from '../hooks/useToast'
import { useNavigate } from 'react-router-dom'

const STATUS_PROD = ['Pendente', 'Produzindo', 'Pronto', 'Entregue', 'Cancelado']
const STATUS_PGTO = ['Aguardando', 'Pago parcial', 'Pago']

const PROD_BADGE = {
  'Pendente':   'badge-warn',
  'Produzindo': 'badge-info',
  'Pronto':     'badge-info',
  'Entregue':   'badge-teal',
  'Cancelado':  '',
}
const PGTO_BADGE = {
  'Aguardando':   'badge-alert',
  'Pago parcial': 'badge-warn',
  'Pago':         'badge-ok',
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
          background: 'var(--bg-card)', border: '1px solid #e5e7eb', borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0,0,0,.12)', marginTop: 4, minWidth: 140,
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
  const itemStr = (enc.itens || [])
    .map(i => i.quantidade > 1 ? `${i.produto} x${i.quantidade}` : i.produto)
    .join(', ') || '—'
  return (
    <div className="card" style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>{enc.cliente}</span>
        <span style={{ fontSize: 12, color: isToday(enc.dataEntrega) ? '#854F0B' : '#aaa' }}>
          {isToday(enc.dataEntrega) ? 'hoje' : formatDate(enc.dataEntrega)}
        </span>
      </div>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>{itemStr}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <StatusSelect
          value={enc.status}
          options={STATUS_PROD}
          badgeMap={PROD_BADGE}
          onChange={(val) => onUpdateStatus(enc, val, enc.pgto)}
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
  const { data: encomendas, loading: loadEnc, reload: reloadEnc } = useData(getEncomendas)
  const { data: insumos, loading: loadIns } = useData(getInsumos)

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
  const alertas = (insumos || []).filter(i => i.estoqueAtual !== null && i.estoqueMin > 0 && i.estoqueAtual < i.estoqueMin)

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
        <div>
          <div className="topbar-title">Olá, {primeiroNome}</div>
          <div className="topbar-sub">{diaSemana.charAt(0).toUpperCase() + diaSemana.slice(1)}, {dataStr}</div>
        </div>
        <button className="avatar" onClick={signOut} title="Sair">
          {primeiroNome.charAt(0).toUpperCase()}
        </button>
      </div>

      <div className="page" style={{ padding: '16px' }}>
        <div className="metric-grid">
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
            <div className="metric-value" style={{ color: pgtosPendentes > 0 ? '#854F0B' : '#111' }}>
              {loadEnc ? '—' : pgtosPendentes}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Falta no estoque</div>
            <div className="metric-value" style={{ color: alertas.length > 0 ? '#A32D2D' : '#111' }}>
              {loadIns ? '—' : alertas.length}
            </div>
          </div>
        </div>

        <div className="section-label">Próximas entregas</div>
        {loadEnc ? (
          <div className="loading">Carregando...</div>
        ) : proximas.length === 0 ? (
          <div className="empty">
            <span>Nenhuma encomenda ativa</span>
            <button className="btn-outline-teal" style={{ marginTop: 8 }} onClick={() => navigate('/pedidos')}>
              + Novo pedido
            </button>
          </div>
        ) : (
          proximas.map(enc => (
            <EncomendaCard key={enc.id} enc={enc} onUpdateStatus={handleUpdateStatus} />
          ))
        )}

        {alertas.length > 0 && (
          <>
            <div className="section-label" style={{ marginTop: 16 }}>Alertas de estoque</div>
            {alertas.slice(0, 5).map(ins => {
              const waLink = ins.whatsapp
                ? ins.whatsapp.toString().startsWith('http')
                  ? ins.whatsapp
                  : `https://wa.me/${ins.whatsapp.toString().replace(/\D/g, '')}`
                : null
              return (
                <div
                  key={ins.id}
                  className="card"
                  style={{ borderColor: '#F09595', cursor: waLink ? 'pointer' : 'default' }}
                  onClick={() => waLink && window.open(waLink, '_blank')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: '#A32D2D' }}>{ins.nome}</div>
                      <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                        Atual: {ins.estoqueAtual ?? '—'} · Mín: {ins.estoqueMin} {ins.unidade}
                        {ins.fornecedor ? ` · ${ins.fornecedor}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <span className="badge badge-alert">Pedir</span>
                      {waLink && <span style={{ fontSize: 11, color: '#1D9E75' }}>💬 WhatsApp</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
