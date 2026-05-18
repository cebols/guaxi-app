import { useState, useMemo } from 'react'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { getProdutos, getInsumos, getReceitas, getEncomendas, getClientes, saveCliente, savePedido, updateStatusEncomenda, deletePedido, adjustEstoqueProduto } from '../services/db'

// ── Constants ─────────────────────────────────────────────────
const STATUS_OPTS = ['Pendente', 'Pronto', 'Entregue', 'Cancelado']
const PGTO_OPTS   = ['Aguardando', 'Pago', 'Atrasado']
const CANAL_OPTS  = ['WhatsApp', 'iFood', '99Food', 'Keeta', 'Presencial']

// Smart filters: each has a `match(p, ctx)` predicate
const SMART_FILTROS = [
  { key: 'todos',      label: 'Todos',     match: () => true },
  { key: 'atrasados',  label: '🔴 Atrasados', match: p => {
      if (['Entregue', 'Cancelado'].includes(p.status)) return false
      if (!p.dataEntrega) return false
      const t = new Date(); t.setHours(0,0,0,0)
      return new Date(p.dataEntrega + 'T00:00:00') < t
    }},
  { key: 'hoje',       label: '🟠 Hoje',   match: p => {
      if (!p.dataEntrega) return false
      const t = new Date(); t.setHours(0,0,0,0)
      const d = new Date(p.dataEntrega + 'T00:00:00')
      return d.getTime() === t.getTime() && p.status !== 'Cancelado'
    }},
  { key: 'amanha',     label: '🟡 Amanhã', match: p => {
      if (!p.dataEntrega) return false
      const t = new Date(); t.setHours(0,0,0,0); t.setDate(t.getDate() + 1)
      const d = new Date(p.dataEntrega + 'T00:00:00')
      return d.getTime() === t.getTime() && p.status !== 'Cancelado'
    }},
  { key: 'areceber',   label: '💰 A receber', match: p => p.status !== 'Cancelado' && p.pgto !== 'Pago' },
  { key: 'Pendente',   label: 'Pendente',   match: p => p.status === 'Pendente' },
  { key: 'Pronto',     label: 'Pronto',     match: p => p.status === 'Pronto' },
  { key: 'Entregue',   label: 'Entregue',   match: p => p.status === 'Entregue' },
]

// WhatsApp message templates
const WA_TEMPLATES = [
  { label: '✅ Pedido pronto',     msg: 'Oi {nome}! Seu pedido {id} tá pronto pra retirada. ❤️' },
  { label: '🛵 Saiu pra entrega',  msg: 'Oi {nome}! Saiu pra entrega o pedido {id}, chega em breve!' },
  { label: '⏰ Lembrete entrega',  msg: 'Oi {nome}! Passando pra lembrar do seu pedido {id} pra {data}. Tudo certo?' },
  { label: '⭐ Pedir feedback',    msg: 'Oi {nome}! Espero que tenha curtido o pedido {id}. Manda foto e me conta o que achou! 😍' },
  { label: '💰 Cobrança gentil',   msg: 'Oi {nome}! Passando pra lembrar do pagamento do pedido {id} (R$ {valor}). Posso te enviar o pix?' },
]
function fillTemplate(tpl, pedido) {
  const nome = (pedido.cliente || '').split(' ')[0]
  return tpl
    .replace('{nome}', nome)
    .replace('{id}', pedido.id)
    .replace('{data}', fmtDate(pedido.dataEntrega))
    .replace('{valor}', fmtR(pedido.valor))
}

const STATUS_STYLE = {
  Pendente:   { bg: '#334155', color: '#94a3b8' },
  Pronto:     { bg: '#14532d', color: '#4ade80' },
  Entregue:   { bg: '#1a1a2e', color: '#6b7280' },
  Cancelado:  { bg: '#3b1f1f', color: '#ef4444' },
}
const PGTO_STYLE = {
  Aguardando: { bg: '#3b2700', color: '#f59e0b' },
  Pago:       { bg: '#14532d', color: '#4ade80' },
  Atrasado:   { bg: '#3b1f1f', color: '#ef4444' },
}

// ── Helpers ───────────────────────────────────────────────────
function fmtR(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(d) {
  if (!d) return ''
  return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
function urgency(dataEntrega) {
  if (!dataEntrega) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dt = new Date(dataEntrega + 'T00:00:00')
  const diff = Math.round((dt - today) / 86400000)
  if (diff < 0)   return { label: 'ATRASADO', bg: '#7f1d1d', color: '#fca5a5' }
  if (diff === 0) return { label: 'HOJE',     bg: '#7c2d12', color: '#fb923c' }
  if (diff === 1) return { label: 'AMANHÃ',   bg: '#713f12', color: '#fbbf24' }
  return null
}
function waLink(phone) {
  const digits = (phone || '').replace(/\D/g, '')
  if (!digits) return null
  return `https://wa.me/${digits.startsWith('55') ? digits : '55' + digits}`
}
function buildAlertMap(produtos, receitas, insumos) {
  const criticalNomes = new Set(
    (insumos || [])
      .filter(i => i.estoqueAtual != null && i.estoqueMin > 0 && i.estoqueAtual <= i.estoqueMin * 0.5)
      .map(i => i.nome)
  )
  if (criticalNomes.size === 0) return {}
  const criticalReceitaIds = new Set(
    (receitas || [])
      .filter(r => (r.ingredientes || []).some(ing => criticalNomes.has(ing.nome)))
      .map(r => r.id)
  )
  const map = {}
  for (const prod of (produtos || [])) {
    if (prod.tipo !== 'produto') continue
    if ((prod.receitas || []).some(r => criticalReceitaIds.has(r.receitaId))) map[prod.nome] = true
  }
  return map
}

// ── DateInput — accepts dd/mm/aaaa, stores YYYY-MM-DD ─────────
function DateInput({ value, onChange, className, style }) {
  // Display stored ISO value (YYYY-MM-DD) as dd/mm/aaaa
  function toDisplay(iso) {
    if (!iso) return ''
    const [y, m, d] = iso.split('-')
    return y && m && d ? `${d}/${m}/${y}` : iso
  }
  // Parse dd/mm/aaaa → YYYY-MM-DD
  function toISO(raw) {
    const clean = raw.replace(/\D/g, '')
    if (clean.length === 8) {
      return `${clean.slice(4)}-${clean.slice(2, 4)}-${clean.slice(0, 2)}`
    }
    return ''
  }
  const [display, setDisplay] = useState(toDisplay(value))

  const handleChange = (e) => {
    let raw = e.target.value
    // Auto-insert slashes
    const digits = raw.replace(/\D/g, '').slice(0, 8)
    let formatted = digits
    if (digits.length > 2) formatted = digits.slice(0, 2) + '/' + digits.slice(2)
    if (digits.length > 4) formatted = digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4)
    setDisplay(formatted)
    const iso = toISO(digits)
    if (iso) onChange(iso)
    else if (digits.length === 0) onChange('')
  }

  return (
    <input
      className={className}
      style={style}
      type="text"
      inputMode="numeric"
      placeholder="dd/mm/aaaa"
      value={display}
      onChange={handleChange}
      maxLength={10}
    />
  )
}

// ── Badge ─────────────────────────────────────────────────────
function Badge({ label, style }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.03em',
      padding: '2px 7px', borderRadius: 10,
      background: style.bg, color: style.color, whiteSpace: 'nowrap',
    }}>{label}</span>
  )
}

// ── Order card ────────────────────────────────────────────────
function PedidoCard({ pedido, alertMap, onClick, onLongPress, selected, selecaoMode }) {
  const urg      = urgency(pedido.dataEntrega)
  const stStyle  = STATUS_STYLE[pedido.status] || STATUS_STYLE.Pendente
  const pgStyle  = PGTO_STYLE[pedido.pgto]     || PGTO_STYLE.Aguardando
  const hasAlert = (pedido.itens || []).some(it => alertMap[it.produto])

  // Long press to enter selection mode (mobile)
  const [pressTimer, setPressTimer] = useState(null)
  const startPress = () => {
    if (selecaoMode) return
    const t = setTimeout(() => {
      onLongPress?.()
      if (navigator.vibrate) navigator.vibrate(40)
    }, 500)
    setPressTimer(t)
  }
  const cancelPress = () => { if (pressTimer) clearTimeout(pressTimer); setPressTimer(null) }

  return (
    <div className="card"
      onClick={onClick}
      onTouchStart={startPress} onTouchEnd={cancelPress} onTouchMove={cancelPress}
      onMouseDown={startPress} onMouseUp={cancelPress} onMouseLeave={cancelPress}
      style={{
        padding: '12px 14px', marginBottom: 8, cursor: 'pointer',
        border: selected ? '2px solid var(--teal)' : undefined,
        background: selected ? 'var(--teal-light)' : undefined,
        position: 'relative',
      }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 3 }}>
            {urg && <Badge label={urg.label} style={urg} />}
            {hasAlert && (
              <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', padding: '2px 6px', background: '#3b2700', borderRadius: 10 }}>
                ⚠️ estoque
              </span>
            )}
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{pedido.id}</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>{pedido.cliente}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: pedido.obs ? 4 : 0 }}>
            {fmtDate(pedido.dataEntrega)}
            {pedido.contato ? ` · ${pedido.contato}` : ''}
          </div>
          {pedido.obs ? (
            <div style={{
              fontSize: 11, color: 'var(--text-tertiary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              maxWidth: 220,
            }}>{pedido.obs}</div>
          ) : null}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>R$ {fmtR(pedido.valor)}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <Badge label={pedido.status} style={stStyle} />
        <Badge label={pedido.pgto}   style={pgStyle} />
      </div>
    </div>
  )
}

// ── Detail view ───────────────────────────────────────────────
function DetalheView({ pedido, alertMap, onBack, onSaved }) {
  const { toast, show } = useToast()
  const [status, setStatus]           = useState(pedido.status)
  const [pgto, setPgto]               = useState(pedido.pgto)
  const [tipoEntrega, setTipoEntrega] = useState(pedido.tipoEntrega || 'Retirada')
  const [frete, setFrete]             = useState(pedido.frete > 0 ? String(pedido.frete) : '')
  const [saving, setSaving]           = useState(false)
  const [confirm, setConfirm]         = useState(false)

  const urg = urgency(pedido.dataEntrega)
  const wa  = waLink(pedido.contato)
  const itensSubtotal = (pedido.itens || []).reduce((s, it) => s + (it.precoUnit || 0) * (it.quantidade || 1), 0)
  const freteNum = tipoEntrega === 'Entrega' ? (parseFloat(frete) || 0) : 0
  const totalAtual = itensSubtotal + freteNum

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateStatusEncomenda(pedido.id, status, pgto, tipoEntrega, frete, totalAtual)
      show('Salvo!')
      setTimeout(() => { onSaved(); onBack() }, 700)
    } catch (e) {
      show('Erro: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <button
            onClick={onBack}
            style={{ background: 'none', border: 'none', color: 'var(--teal)', fontSize: 15, fontWeight: 600, cursor: 'pointer', padding: 0 }}
          >← voltar</button>
          <div style={{ textAlign: 'right' }}>
            <div className="topbar-title">{pedido.id}</div>
          </div>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 16 }}>
        {/* Header */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{pedido.cliente}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {urg && <Badge label={urg.label} style={urg} />}
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Entrega: {fmtDate(pedido.dataEntrega)}
            </span>
            {pedido.canal && <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{pedido.canal}</span>}
          </div>
        </div>

        {/* WhatsApp */}
        {wa && (
          <>
            <a href={wa} target="_blank" rel="noreferrer" style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'var(--card-bg)', border: '1px solid #14532d', color: '#4ade80',
              borderRadius: 10, padding: '10px 14px', marginBottom: 8,
              textDecoration: 'none', fontSize: 13, fontWeight: 500,
            }}>
              <span>📲</span>
              <span>{pedido.contato}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.7 }}>Abrir WhatsApp →</span>
            </a>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>Mensagens rápidas</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
              {WA_TEMPLATES.map(t => {
                const msg = fillTemplate(t.msg, pedido)
                const href = `${wa}?text=${encodeURIComponent(msg)}`
                return (
                  <a key={t.label} href={href} target="_blank" rel="noreferrer"
                    style={{
                      fontSize: 11, padding: '5px 10px',
                      background: 'var(--card-bg)', border: '1px solid var(--border)',
                      borderRadius: 16, color: 'var(--text-secondary)',
                      textDecoration: 'none', whiteSpace: 'nowrap',
                    }}>
                    {t.label}
                  </a>
                )
              })}
            </div>
          </>
        )}

        {/* Itens */}
        <div className="section-label">Itens</div>
        <div className="card card-flush" style={{ padding: '0 14px', marginBottom: 12 }}>
          {(pedido.itens || []).map((it, i, arr) => (
            <div key={it.id || i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '9px 0',
              borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <div>
                <span style={{ fontSize: 13 }}>{it.produto}</span>
                {alertMap[it.produto] && (
                  <span style={{ marginLeft: 6, fontSize: 11, color: '#f59e0b' }}>⚠️</span>
                )}
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 6 }}>× {it.quantidade}</span>
              </div>
              <span style={{ fontSize: 13, fontWeight: 500 }}>R$ {fmtR((it.precoUnit || 0) * (it.quantidade || 1))}</span>
            </div>
          ))}
        </div>

        {/* Financeiro */}
        <div className="card" style={{ padding: '12px 14px', marginBottom: 14 }}>
          <div className="field-row" style={{ marginBottom: 10 }}>
            <div>
              <div className="field-label">Tipo</div>
              <select className="field-input" value={tipoEntrega} onChange={e => setTipoEntrega(e.target.value)}>
                <option>Retirada</option>
                <option>Entrega</option>
              </select>
            </div>
            {tipoEntrega === 'Entrega' && (
              <div>
                <div className="field-label">Frete (R$)</div>
                <input
                  className="field-input"
                  type="text" inputMode="decimal" placeholder="0,00"
                  value={frete}
                  onChange={e => setFrete(e.target.value)}
                />
              </div>
            )}
          </div>
          {tipoEntrega === 'Entrega' && freteNum > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Itens R$ {fmtR(itensSubtotal)} + frete R$ {fmtR(freteNum)}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Total a receber</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: pgto === 'Pago' ? 'var(--teal)' : '#f59e0b' }}>
              R$ {fmtR(totalAtual)}
            </span>
          </div>
        </div>

        {/* Status + Pgto */}
        <div className="field-row" style={{ marginBottom: 12 }}>
          <div>
            <div className="field-label">Status de produção</div>
            <select className="field-input" value={status} onChange={e => {
              const v = e.target.value
              setStatus(v)
              if (v === 'Entregue' && pgto !== 'Pago') setPgto('Atrasado')
            }}>
              {STATUS_OPTS.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <div className="field-label">Pagamento</div>
            <select className="field-input" value={pgto} onChange={e => setPgto(e.target.value)}>
              {PGTO_OPTS.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
        </div>

        {/* Obs */}
        {pedido.obs && (
          <div style={{
            fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14,
            background: 'var(--card-bg)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '10px 14px',
          }}>
            {pedido.obs}
          </div>
        )}

        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Salvando...' : 'Salvar alterações'}
        </button>

        {!confirm ? (
          <button
            onClick={() => setConfirm(true)}
            style={{
              width: '100%', marginTop: 10, padding: '11px',
              background: 'transparent', border: '1px solid #7f1d1d',
              color: '#ef4444', borderRadius: 10, fontSize: 14,
              fontWeight: 600, cursor: 'pointer',
            }}
          >Apagar pedido</button>
        ) : (
          <div style={{ marginTop: 10, padding: '12px 14px', background: '#1a0a0a', borderRadius: 10, border: '1px solid #7f1d1d' }}>
            <div style={{ fontSize: 13, color: '#fca5a5', marginBottom: 10 }}>
              Tem certeza? Isso apaga {pedido.id} ({pedido.cliente}) permanentemente.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={async () => {
                  setSaving(true)
                  try {
                    await deletePedido(pedido.id)
                    onSaved(); onBack()
                  } catch (e) { show('Erro: ' + e.message); setSaving(false) }
                }}
                style={{ flex: 1, padding: '9px', background: '#7f1d1d', color: '#fca5a5', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}
                disabled={saving}
              >Apagar</button>
              <button
                onClick={() => setConfirm(false)}
                style={{ flex: 1, padding: '9px', background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}
              >Cancelar</button>
            </div>
          </div>
        )}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}

// ── New order form ────────────────────────────────────────────
function NovoView({ produtos, clientes, alertMap, onBack, onSaved }) {
  const { toast, show } = useToast()
  const [form, setForm] = useState({
    cliente: '', contato: '', canal: 'WhatsApp',
    dataEntrega: '', pgto: 'Aguardando', status: 'Pendente', obs: '',
    tipoEntrega: 'Retirada', frete: '',
  })
  const [itens, setItens]           = useState([{ produto: '', quantidade: 1, precoUnit: '' }])
  const [saving, setSaving]         = useState(false)
  const [salvarCliente, setSalvarCliente] = useState(false)

  const setField   = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setItem    = (i, k, v) => setItens(prev => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it))
  const addItem    = () => setItens(prev => [...prev, { produto: '', quantidade: 1, precoUnit: '' }])
  const removeItem = (i) => setItens(prev => prev.filter((_, idx) => idx !== i))

  const itensTotal = itens.reduce((s, it) => s + (parseFloat(it.precoUnit) || 0) * (parseFloat(it.quantidade) || 1), 0)
  const frete = form.tipoEntrega === 'Entrega' ? (parseFloat(form.frete) || 0) : 0
  const total = itensTotal + frete

  const handleClienteChange = (nome) => {
    setField('cliente', nome)
    const existing = (clientes || []).find(c => c.nome.toLowerCase() === nome.toLowerCase())
    if (existing) {
      if (existing.telefone && !form.contato) setField('contato', existing.telefone)
      setSalvarCliente(false)
    } else {
      setSalvarCliente(nome.trim().length > 1)
    }
  }

  const handleProdutoChange = (i, nome) => {
    setItem(i, 'produto', nome)
    const prod = (produtos || []).find(p => p.nome === nome)
    if (prod) {
      const preco = prod.precoDireta ?? prod.precoPraticado ?? prod.precoSugerido ?? ''
      if (preco) setItem(i, 'precoUnit', String(preco))
    }
  }

  const handleSave = async () => {
    if (!form.cliente)     { show('Preencha o nome do cliente'); return }
    if (!form.dataEntrega) { show('Preencha a data de entrega'); return }
    if (itens.some(it => !it.produto)) { show('Preencha todos os itens'); return }
    setSaving(true)
    try {
      if (salvarCliente) {
        const exists = (clientes || []).some(c => c.nome.toLowerCase() === form.cliente.toLowerCase())
        if (!exists) await saveCliente({ nome: form.cliente, telefone: form.contato })
      }
      const id = await savePedido(form, itens)
      show(`Pedido ${id} salvo!`)
      setTimeout(() => { onSaved(); onBack() }, 700)
    } catch (e) {
      show('Erro: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const isClienteNovo = form.cliente.trim().length > 1 &&
    !(clientes || []).some(c => c.nome.toLowerCase() === form.cliente.toLowerCase())

  const wa = waLink(form.contato)

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <button
            onClick={onBack}
            style={{ background: 'none', border: 'none', color: 'var(--teal)', fontSize: 15, fontWeight: 600, cursor: 'pointer', padding: 0 }}
          >← voltar</button>
          <div className="topbar-title">Novo pedido</div>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 16 }}>
        {/* Cliente com autocomplete */}
        <div className="field-label">Cliente *</div>
        <input
          className="field-input"
          list="clientes-list"
          placeholder="Nome do cliente"
          value={form.cliente}
          onChange={e => handleClienteChange(e.target.value)}
          autoComplete="off"
        />
        <datalist id="clientes-list">
          {(clientes || []).map(c => <option key={c.id} value={c.nome} />)}
        </datalist>

        {/* Salvar como cliente novo */}
        {isClienteNovo && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--teal)', marginTop: -4, marginBottom: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={salvarCliente}
              onChange={e => setSalvarCliente(e.target.checked)}
              style={{ accentColor: 'var(--teal)', width: 14, height: 14 }}
            />
            Salvar {form.cliente} como cliente
          </label>
        )}

        {/* Telefone */}
        <div className="field-label">Telefone</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <input
            className="field-input"
            style={{ marginBottom: 0, flex: 1 }}
            placeholder="+55 11 9 ..."
            value={form.contato}
            onChange={e => setField('contato', e.target.value)}
          />
          {wa && (
            <a href={wa} target="_blank" rel="noreferrer" style={{
              background: '#14532d', color: '#4ade80',
              padding: '9px 12px', borderRadius: 8, fontSize: 12,
              textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0,
            }}>📲 WA</a>
          )}
        </div>

        {/* Canal + Entrega */}
        <div className="field-row">
          <div>
            <div className="field-label">Canal</div>
            <select className="field-input" value={form.canal} onChange={e => setField('canal', e.target.value)}>
              {CANAL_OPTS.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <div className="field-label">Entrega *</div>
            <DateInput className="field-input" value={form.dataEntrega} onChange={v => setField('dataEntrega', v)} />
          </div>
        </div>

        {/* Pgto + Status */}
        <div className="field-row">
          <div>
            <div className="field-label">Pagamento</div>
            <select className="field-input" value={form.pgto} onChange={e => setField('pgto', e.target.value)}>
              {PGTO_OPTS.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <div className="field-label">Status</div>
            <select className="field-input" value={form.status} onChange={e => setField('status', e.target.value)}>
              {STATUS_OPTS.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* Tipo de entrega */}
        <div className="field-row">
          <div>
            <div className="field-label">Tipo</div>
            <select className="field-input" value={form.tipoEntrega} onChange={e => setField('tipoEntrega', e.target.value)}>
              <option>Retirada</option>
              <option>Entrega</option>
            </select>
          </div>
          {form.tipoEntrega === 'Entrega' && (
            <div>
              <div className="field-label">Frete (R$)</div>
              <input
                className="field-input"
                type="text" inputMode="decimal" placeholder="0,00"
                value={form.frete}
                onChange={e => setField('frete', e.target.value)}
              />
            </div>
          )}
        </div>

        {/* Itens — texto livre com sugestões */}
        <div className="section-label">Itens do pedido</div>
        <datalist id="produtos-list">
          {(produtos || []).map(p => <option key={p.id} value={p.nome} />)}
        </datalist>
        <div className="card card-flush" style={{ padding: '0 14px', marginBottom: 6 }}>
          {itens.map((it, i) => (
            <div key={i} className="item-row">
              <input
                className="item-select"
                list="produtos-list"
                placeholder="Produto ou item personalizado"
                value={it.produto}
                onChange={e => handleProdutoChange(i, e.target.value)}
                autoComplete="off"
                style={{ fontFamily: 'inherit' }}
              />
              <input
                className="item-qty"
                type="text" inputMode="decimal" min="1"
                value={it.quantidade}
                onChange={e => setItem(i, 'quantidade', e.target.value)}
              />
              <input
                className="item-price"
                type="text" inputMode="decimal" placeholder="R$"
                value={it.precoUnit}
                onChange={e => setItem(i, 'precoUnit', e.target.value)}
              />
              {itens.length > 1 && (
                <button className="item-rm" onClick={() => removeItem(i)}>&#215;</button>
              )}
            </div>
          ))}
        </div>
        <button className="btn-add-item" onClick={addItem}>+ adicionar item</button>

        {/* Total */}
        <div style={{ textAlign: 'right', marginTop: 12 }}>
          {frete > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2 }}>
              Itens R$ {fmtR(itensTotal)} + frete R$ {fmtR(frete)}
            </div>
          )}
          <div className="field-label">Total</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>R$ {fmtR(total)}</div>
        </div>

        {/* Obs */}
        <div className="field-label" style={{ marginTop: 12 }}>Observações</div>
        <textarea
          className="field-input"
          rows={3}
          placeholder="Anotações, endereço, preferências..."
          value={form.obs}
          onChange={e => setField('obs', e.target.value)}
          style={{ resize: 'none' }}
        />

        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Salvando...' : 'Salvar pedido'}
        </button>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}

// ── NovoPedidoSheet — self-contained sheet for use outside Pedidos ──
export function NovoPedidoSheet({ onClose, onSaved }) {
  const { toast, show }   = useToast()
  const { data: produtos } = useData(getProdutos)
  const { data: clientes } = useData(getClientes)

  const [form, setForm] = useState({
    cliente: '', contato: '', canal: 'WhatsApp',
    dataEntrega: '', pgto: 'Aguardando', status: 'Pendente', obs: '',
    tipoEntrega: 'Retirada', frete: '',
  })
  const [itens, setItens]               = useState([{ produto: '', quantidade: 1, precoUnit: '' }])
  const [saving, setSaving]             = useState(false)
  const [salvarCliente, setSalvarCliente] = useState(false)

  const setField   = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setItem    = (i, k, v) => setItens(prev => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it))
  const addItem    = () => setItens(prev => [...prev, { produto: '', quantidade: 1, precoUnit: '' }])
  const removeItem = (i) => setItens(prev => prev.filter((_, idx) => idx !== i))

  const sheetItensTotal = itens.reduce((s, it) => s + (parseFloat(it.precoUnit) || 0) * (parseFloat(it.quantidade) || 1), 0)
  const sheetFrete = form.tipoEntrega === 'Entrega' ? (parseFloat(form.frete) || 0) : 0
  const total = sheetItensTotal + sheetFrete

  const handleClienteChange = (nome) => {
    setField('cliente', nome)
    const existing = (clientes || []).find(c => c.nome.toLowerCase() === nome.toLowerCase())
    if (existing) {
      if (existing.telefone && !form.contato) setField('contato', existing.telefone)
      setSalvarCliente(false)
    } else {
      setSalvarCliente(nome.trim().length > 1)
    }
  }

  const handleProdutoChange = (i, nome) => {
    setItem(i, 'produto', nome)
    const prod = (produtos || []).find(p => p.nome === nome)
    if (prod) {
      const preco = prod.precoDireta ?? prod.precoPraticado ?? prod.precoSugerido ?? ''
      if (preco) setItem(i, 'precoUnit', String(preco))
    }
  }

  const handleSave = async () => {
    if (!form.cliente)     { show('Preencha o nome do cliente'); return }
    if (!form.dataEntrega) { show('Preencha a data de entrega'); return }
    if (itens.some(it => !it.produto)) { show('Preencha todos os itens'); return }
    setSaving(true)
    try {
      if (salvarCliente) {
        const exists = (clientes || []).some(c => c.nome.toLowerCase() === form.cliente.toLowerCase())
        if (!exists) await saveCliente({ nome: form.cliente, telefone: form.contato })
      }
      const id = await savePedido(form, itens)
      show(`Pedido ${id} salvo!`)
      setTimeout(() => { onSaved?.(); onClose() }, 700)
    } catch (e) {
      show('Erro: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const isClienteNovo = form.cliente.trim().length > 1 &&
    !(clientes || []).some(c => c.nome.toLowerCase() === form.cliente.toLowerCase())
  const wa = waLink(form.contato)

  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div className="sheet" style={{ maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="sheet-title">
          <span>Novo pedido</span>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer' }} onClick={onClose}>×</button>
        </div>

        <div className="field-label">Cliente *</div>
        <input className="field-input" list="sheet-clientes-list" placeholder="Nome do cliente"
          value={form.cliente} onChange={e => handleClienteChange(e.target.value)} autoComplete="off" />
        <datalist id="sheet-clientes-list">
          {(clientes || []).map(c => <option key={c.id} value={c.nome} />)}
        </datalist>

        {isClienteNovo && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--teal)', marginTop: -4, marginBottom: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={salvarCliente} onChange={e => setSalvarCliente(e.target.checked)} style={{ accentColor: 'var(--teal)', width: 14, height: 14 }} />
            Salvar {form.cliente} como cliente
          </label>
        )}

        <div className="field-label">Telefone</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <input className="field-input" style={{ marginBottom: 0, flex: 1 }} placeholder="+55 11 9 ..."
            value={form.contato} onChange={e => setField('contato', e.target.value)} />
          {wa && (
            <a href={wa} target="_blank" rel="noreferrer" style={{ background: '#14532d', color: '#4ade80', padding: '9px 12px', borderRadius: 8, fontSize: 12, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}>📲 WA</a>
          )}
        </div>

        <div className="field-row">
          <div>
            <div className="field-label">Canal</div>
            <select className="field-input" value={form.canal} onChange={e => setField('canal', e.target.value)}>
              {CANAL_OPTS.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <div className="field-label">Entrega *</div>
            <DateInput className="field-input" value={form.dataEntrega} onChange={v => setField('dataEntrega', v)} />
          </div>
        </div>

        <div className="field-row">
          <div>
            <div className="field-label">Pagamento</div>
            <select className="field-input" value={form.pgto} onChange={e => setField('pgto', e.target.value)}>
              {PGTO_OPTS.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <div className="field-label">Status</div>
            <select className="field-input" value={form.status} onChange={e => setField('status', e.target.value)}>
              {STATUS_OPTS.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="field-row">
          <div>
            <div className="field-label">Tipo</div>
            <select className="field-input" value={form.tipoEntrega} onChange={e => setField('tipoEntrega', e.target.value)}>
              <option>Retirada</option>
              <option>Entrega</option>
            </select>
          </div>
          {form.tipoEntrega === 'Entrega' && (
            <div>
              <div className="field-label">Frete (R$)</div>
              <input
                className="field-input"
                type="text" inputMode="decimal" placeholder="0,00"
                value={form.frete}
                onChange={e => setField('frete', e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="section-label">Itens do pedido</div>
        <datalist id="sheet-produtos-list">
          {(produtos || []).map(p => <option key={p.id} value={p.nome} />)}
        </datalist>
        <div className="card card-flush" style={{ padding: '0 14px', marginBottom: 6 }}>
          {itens.map((it, i) => (
            <div key={i} className="item-row">
              <input className="item-select" list="sheet-produtos-list" placeholder="Produto ou item personalizado"
                value={it.produto} onChange={e => handleProdutoChange(i, e.target.value)} autoComplete="off" style={{ fontFamily: 'inherit' }} />
              <input className="item-qty" type="text" inputMode="decimal" min="1"
                value={it.quantidade} onChange={e => setItem(i, 'quantidade', e.target.value)} />
              <input className="item-price" type="text" inputMode="decimal" placeholder="R$"
                value={it.precoUnit} onChange={e => setItem(i, 'precoUnit', e.target.value)} />
              {itens.length > 1 && <button className="item-rm" onClick={() => removeItem(i)}>&#215;</button>}
            </div>
          ))}
        </div>
        <button className="btn-add-item" onClick={addItem}>+ adicionar item</button>

        <div style={{ textAlign: 'right', marginTop: 12 }}>
          {sheetFrete > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2 }}>
              Itens R$ {fmtR(sheetItensTotal)} + frete R$ {fmtR(sheetFrete)}
            </div>
          )}
          <div className="field-label">Total</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>R$ {fmtR(total)}</div>
        </div>

        <div className="field-label" style={{ marginTop: 12 }}>Observações</div>
        <textarea className="field-input" rows={3} placeholder="Anotações, endereço, preferências..."
          value={form.obs} onChange={e => setField('obs', e.target.value)} style={{ resize: 'none' }} />

        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Salvando...' : 'Salvar pedido'}
        </button>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}

// ── Production view ───────────────────────────────────────────
function fmtQty(q, unidade) {
  const n = Number(q)
  const str = n % 1 === 0 ? String(n) : n.toFixed(1)
  return `${str} ${unidade || 'un'}`
}

function ProducaoView({ pedidos, produtos, receitas, onEstoqueUpdated }) {
  const ativos = (pedidos || []).filter(p => !['Entregue', 'Cancelado'].includes(p.status))

  const receitaMap = Object.fromEntries((receitas || []).map(r => [r.id, r]))
  const prodMap    = Object.fromEntries((produtos  || []).map(p => [p.nome, p]))

  // Expand a product (expanding combos into components) and accumulate into targets
  function addProd(nomeProd, qty, itemAcc, receitaAcc, depth = 0) {
    if (depth > 5) return
    const prod = prodMap[nomeProd]

    if (prod?.tipo === 'combo' && prod.componentes?.length > 0) {
      // Expand each combo component recursively
      for (const comp of prod.componentes) {
        const compNome = comp.nome || comp.produtoNome || ''
        const compQty  = (Number(comp.quantidade) || 1) * qty
        addProd(compNome, compQty, itemAcc, receitaAcc, depth + 1)
      }
    } else {
      // Leaf item: count in itens
      itemAcc[nomeProd] = (itemAcc[nomeProd] || 0) + qty

      // Expand into receitas
      if (!prod?.receitas?.length) return
      for (const pr of prod.receitas) {
        const totalRec = (Number(pr.quantidade) || 1) * qty
        const unidade  = pr.unidadeGera || pr.unidade || 'un'
        const key = pr.nome
        if (!receitaAcc[key]) receitaAcc[key] = { quantidade: 0, unidade }
        receitaAcc[key].quantidade += totalRec
      }
    }
  }

  const itemQtd    = {}
  const receitaQtd = {}

  for (const ped of ativos) {
    for (const it of (ped.itens || [])) {
      addProd(it.produto, Number(it.quantidade) || 1, itemQtd, receitaQtd)
    }
  }

  const itensOrdenados    = Object.entries(itemQtd).sort((a, b) => b[1] - a[1])
  const receitasOrdenadas = Object.entries(receitaQtd).sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))

  // "Marcar como produzido" state
  const [produzido, setProduzido] = useState({})
  const [savingProd, setSavingProd] = useState(false)
  const { toast, show } = useToast()

  const handleConfirmarProducao = async () => {
    const entries = Object.entries(produzido).filter(([, q]) => parseFloat(q) > 0)
    if (entries.length === 0) return
    setSavingProd(true)
    try {
      await Promise.all(entries.map(([nome, q]) => {
        const prod = prodMap[nome]
        if (prod?.id) return adjustEstoqueProduto(prod.id, parseFloat(q))
      }))
      setProduzido({})
      show('Estoque atualizado!')
      onEstoqueUpdated()
    } catch (e) {
      show('Erro: ' + e.message)
    } finally {
      setSavingProd(false)
    }
  }

  if (ativos.length === 0) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', marginTop: 48, fontSize: 14 }}>
        Nenhum pedido ativo
      </div>
    )
  }

  const SectionTable = ({ title, rows, emptyMsg }) => (
    <>
      <div className="section-label" style={{ marginTop: 16 }}>{title}</div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '8px 0' }}>{emptyMsg}</div>
      ) : (
        <div className="card card-flush" style={{ padding: '0 14px' }}>
          {rows.map(([nome, info], i, arr) => (
            <div key={nome} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '9px 0',
              borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <span style={{ fontSize: 13 }}>{nome}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--teal)' }}>
                {fmtQty(info.quantidade ?? info, info.unidade)}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  )

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '4px 10px', background: 'var(--card-bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
          {ativos.length} pedido{ativos.length !== 1 ? 's' : ''} ativo{ativos.length !== 1 ? 's' : ''}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '4px 10px', background: 'var(--card-bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
          {itensOrdenados.length} item{itensOrdenados.length !== 1 ? 'ns' : ''} distintos
        </div>
      </div>

      <div className="section-label" style={{ marginTop: 16 }}>Itens a produzir</div>
      <div className="card card-flush" style={{ padding: '0 14px', marginBottom: 6 }}>
        {itensOrdenados.map(([nome, needed], i, arr) => {
          const prod = prodMap[nome]
          const emEstoque = prod?.estoqueAtual ?? null
          const falta = emEstoque !== null ? Math.max(0, needed - emEstoque) : null
          return (
            <div key={nome} style={{
              padding: '10px 0',
              borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{nome}</span>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--teal)' }}>{needed} un</span>
                  {emEstoque !== null && (
                    <div style={{ fontSize: 11, color: falta === 0 ? 'var(--teal)' : 'var(--text-secondary)', marginTop: 1 }}>
                      {falta === 0
                        ? `✓ em estoque (${emEstoque})`
                        : `estoque: ${emEstoque} · produzir: ${falta}`}
                    </div>
                  )}
                </div>
              </div>
              {prod?.id && falta !== 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Produziu hoje:</span>
                  <input
                    type="text" inputMode="decimal" min="0"
                    className="item-qty"
                    style={{ width: 64 }}
                    placeholder="0"
                    value={produzido[nome] || ''}
                    onChange={e => setProduzido(p => ({ ...p, [nome]: e.target.value }))}
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>un</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {Object.values(produzido).some(q => parseFloat(q) > 0) && (
        <button
          className="btn-primary"
          onClick={handleConfirmarProducao}
          disabled={savingProd}
          style={{ marginBottom: 8 }}
        >
          {savingProd ? 'Salvando...' : 'Confirmar produção → estoque'}
        </button>
      )}

      <SectionTable
        title="Receitas necessárias"
        rows={receitasOrdenadas}
        emptyMsg="Sem receitas vinculadas — itens podem ser avulsos ou personalizados"
      />
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────
export default function Pedidos() {
  const { data: pedidos,  loading: loadingPed, reload: reloadPedidos } = useData(getEncomendas)
  const { data: produtos, loading: loadingProd, reload: reloadProdutos } = useData(getProdutos)
  const { data: insumos  } = useData(getInsumos)
  const { data: receitas } = useData(getReceitas)
  const { data: clientes, reload: reloadClientes } = useData(getClientes)

  // mode: 'list' | 'novo' | pedido-object
  const [mode, setMode]   = useState('list')
  const [filtro, setFiltro] = useState(() => localStorage.getItem('pedidos_filtro') || 'todos')
  const [aba, setAba]     = useState('pedidos') // 'pedidos' | 'producao'
  const [selecao, setSelecao] = useState({}) // { [pedidoId]: true }
  const selecaoMode = Object.keys(selecao).some(k => selecao[k])

  const setFiltroAndSave = (f) => {
    setFiltro(f)
    localStorage.setItem('pedidos_filtro', f)
  }

  const alertMap = useMemo(
    () => buildAlertMap(produtos || [], receitas || [], insumos || []),
    [produtos, receitas, insumos]
  )

  const pedidosFiltrados = useMemo(() => {
    const list = pedidos || []
    const f = SMART_FILTROS.find(x => x.key === filtro) || SMART_FILTROS[0]
    return list.filter(p => f.match(p))
  }, [pedidos, filtro])

  // Counts for filter chip badges
  const filterCounts = useMemo(() => {
    const out = {}
    for (const f of SMART_FILTROS) {
      if (f.key === 'todos') continue
      out[f.key] = (pedidos || []).filter(p => f.match(p)).length
    }
    return out
  }, [pedidos])

  const handleBulkStatus = async (novoStatus) => {
    const ids = Object.keys(selecao).filter(k => selecao[k])
    try {
      await Promise.all(ids.map(id => {
        const p = (pedidos || []).find(x => x.id === id)
        if (!p) return null
        const novoPgto = novoStatus === 'Entregue' && p.pgto !== 'Pago' ? 'Atrasado' : p.pgto
        return updateStatusEncomenda(id, novoStatus, novoPgto, p.tipoEntrega, p.frete, p.valor)
      }))
      setSelecao({})
      reloadPedidos()
    } catch (e) {
      alert('Erro: ' + e.message)
    }
  }

  if (loadingPed || loadingProd) return <div className="loading">Carregando...</div>

  if (mode === 'novo') {
    return (
      <NovoView
        produtos={produtos || []}
        clientes={clientes || []}
        alertMap={alertMap}
        onBack={() => setMode('list')}
        onSaved={() => { reloadPedidos(); reloadClientes() }}
      />
    )
  }

  if (mode !== 'list') {
    return (
      <DetalheView
        pedido={mode}
        alertMap={alertMap}
        onBack={() => setMode('list')}
        onSaved={reloadPedidos}
      />
    )
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div className="topbar-title">Pedidos</div>
          <button
            onClick={() => setMode('novo')}
            style={{
              background: 'var(--teal)', color: '#fff',
              border: 'none', borderRadius: 8,
              padding: '7px 14px', fontSize: 13, fontWeight: 600,
              cursor: 'pointer',
            }}
          >+ Novo</button>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 12 }}>
        {/* Abas Pedidos / Produção */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 14, borderBottom: '1px solid var(--border)' }}>
          {[['pedidos', 'Pedidos'], ['producao', 'Produção']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setAba(key)}
              style={{
                padding: '7px 18px', fontSize: 13, fontWeight: 600,
                border: 'none', background: 'transparent', cursor: 'pointer',
                color: aba === key ? 'var(--teal)' : 'var(--text-secondary)',
                borderBottom: aba === key ? '2px solid var(--teal)' : '2px solid transparent',
                marginBottom: -1,
              }}
            >{label}</button>
          ))}
        </div>

        {aba === 'producao' ? (
          <ProducaoView pedidos={pedidos} produtos={produtos} receitas={receitas} onEstoqueUpdated={reloadProdutos} />
        ) : (
          <>
            {/* Smart filter chips com contadores */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 14, overflowX: 'auto', paddingBottom: 2 }}>
              {SMART_FILTROS.map(f => {
                const count = filterCounts[f.key]
                const active = filtro === f.key
                return (
                  <button
                    key={f.key}
                    onClick={() => setFiltroAndSave(f.key)}
                    style={{
                      padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                      border: '1px solid',
                      borderColor: active ? 'var(--teal)' : 'var(--border)',
                      background:  active ? 'var(--teal-light)' : 'transparent',
                      color:       active ? 'var(--teal)' : 'var(--text-secondary)',
                      cursor: 'pointer', whiteSpace: 'nowrap',
                      display: 'flex', alignItems: 'center', gap: 5,
                    }}
                  >
                    {f.label}
                    {count > 0 && (
                      <span style={{
                        background: active ? 'var(--teal)' : 'var(--border)',
                        color: active ? '#fff' : 'var(--text-secondary)',
                        fontSize: 10, padding: '1px 5px', borderRadius: 10,
                      }}>{count}</span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Bulk action bar */}
            {selecaoMode && (
              <div style={{
                display: 'flex', gap: 8, alignItems: 'center',
                background: 'var(--teal-light)', border: '1px solid var(--teal)',
                borderRadius: 10, padding: '8px 12px', marginBottom: 10,
                flexWrap: 'wrap',
              }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--teal)' }}>
                  {Object.values(selecao).filter(Boolean).length} selecionado(s)
                </span>
                <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
                  {['Pronto', 'Entregue'].map(s => (
                    <button key={s} onClick={() => handleBulkStatus(s)}
                      style={{ padding: '5px 10px', borderRadius: 6, border: 'none', background: 'var(--teal)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      → {s}
                    </button>
                  ))}
                  <button onClick={() => setSelecao({})}
                    style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {pedidosFiltrados.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', marginTop: 48, fontSize: 14 }}>
                {filtro === 'todos' ? 'Nenhum pedido ainda' : 'Nenhum pedido neste filtro'}
              </div>
            ) : (
              pedidosFiltrados.map(p => (
                <PedidoCard
                  key={p.id}
                  pedido={p}
                  alertMap={alertMap}
                  selected={!!selecao[p.id]}
                  selecaoMode={selecaoMode}
                  onToggleSelect={() => setSelecao(s => ({ ...s, [p.id]: !s[p.id] }))}
                  onClick={() => selecaoMode ? setSelecao(s => ({ ...s, [p.id]: !s[p.id] })) : setMode(p)}
                  onLongPress={() => setSelecao({ [p.id]: true })}
                />
              ))
            )}
          </>
        )}
      </div>
    </>
  )
}
