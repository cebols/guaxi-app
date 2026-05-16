import { useState, useMemo } from 'react'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { getProdutos, getInsumos, getReceitas, getEncomendas, savePedido, updateStatusEncomenda, deletePedido } from '../services/db'

// ── Constants ─────────────────────────────────────────────────
const STATUS_OPTS = ['Pendente', 'Produzindo', 'Pronto', 'Entregue', 'Cancelado']
const PGTO_OPTS   = ['Aguardando', 'Pago', 'Atrasado']
const CANAL_OPTS  = ['WhatsApp', 'iFood', '99Food', 'Keeta', 'Presencial']
const FILTROS     = ['Todos', 'Pendente', 'Produzindo', 'Pronto', 'Entregue']

const STATUS_STYLE = {
  Pendente:   { bg: '#334155', color: '#94a3b8' },
  Produzindo: { bg: '#1e3a5f', color: '#60a5fa' },
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
function PedidoCard({ pedido, alertMap, onClick }) {
  const urg      = urgency(pedido.dataEntrega)
  const saldo    = pedido.valor - (pedido.sinal || 0)
  const stStyle  = STATUS_STYLE[pedido.status] || STATUS_STYLE.Pendente
  const pgStyle  = PGTO_STYLE[pedido.pgto]     || PGTO_STYLE.Aguardando
  const hasAlert = (pedido.itens || []).some(it => alertMap[it.produto])

  return (
    <div className="card" onClick={onClick} style={{ padding: '12px 14px', marginBottom: 8, cursor: 'pointer' }}>
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
          {saldo > 0 && pedido.pgto !== 'Pago' && (
            <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 1 }}>saldo R$ {fmtR(saldo)}</div>
          )}
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
  const [status, setStatus]   = useState(pedido.status)
  const [pgto, setPgto]       = useState(pedido.pgto)
  const [saving, setSaving]   = useState(false)
  const [confirm, setConfirm] = useState(false)

  const saldo = pedido.valor - (pedido.sinal || 0)
  const urg   = urgency(pedido.dataEntrega)
  const wa    = waLink(pedido.contato)

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateStatusEncomenda(pedido.id, status, pgto)
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
          <a href={wa} target="_blank" rel="noreferrer" style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--card-bg)', border: '1px solid #14532d', color: '#4ade80',
            borderRadius: 10, padding: '10px 14px', marginBottom: 14,
            textDecoration: 'none', fontSize: 13, fontWeight: 500,
          }}>
            <span>📲</span>
            <span>{pedido.contato}</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.7 }}>Abrir WhatsApp →</span>
          </a>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Total</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>R$ {fmtR(pedido.valor)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Sinal recebido</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>R$ {fmtR(pedido.sinal)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Saldo a receber</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: saldo > 0 ? '#f59e0b' : 'var(--teal)' }}>
              R$ {fmtR(saldo)}
            </span>
          </div>
        </div>

        {/* Status + Pgto */}
        <div className="field-row" style={{ marginBottom: 12 }}>
          <div>
            <div className="field-label">Status de produção</div>
            <select className="field-input" value={status} onChange={e => setStatus(e.target.value)}>
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
function NovoView({ produtos, alertMap, onBack, onSaved }) {
  const { toast, show } = useToast()
  const [form, setForm] = useState({
    cliente: '', contato: '', canal: 'WhatsApp',
    dataEntrega: '', sinal: '', pgto: 'Aguardando', status: 'Pendente', obs: '',
  })
  const [itens, setItens] = useState([{ produto: '', quantidade: 1, precoUnit: '' }])
  const [saving, setSaving] = useState(false)

  const setField   = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setItem    = (i, k, v) => setItens(prev => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it))
  const addItem    = () => setItens(prev => [...prev, { produto: '', quantidade: 1, precoUnit: '' }])
  const removeItem = (i) => setItens(prev => prev.filter((_, idx) => idx !== i))

  const total = itens.reduce((s, it) => s + (parseFloat(it.precoUnit) || 0) * (parseFloat(it.quantidade) || 1), 0)
  const saldo = total - (parseFloat(form.sinal) || 0)

  const handleProdutoChange = (i, nome) => {
    const prod = (produtos || []).find(p => p.nome === nome)
    setItem(i, 'produto', nome)
    const preco = prod?.precoDireta ?? prod?.precoPraticado ?? prod?.precoSugerido ?? ''
    if (preco) setItem(i, 'precoUnit', String(preco))
  }

  const handleSave = async () => {
    if (!form.cliente)     { show('Preencha o nome do cliente'); return }
    if (!form.dataEntrega) { show('Preencha a data de entrega'); return }
    if (itens.some(it => !it.produto)) { show('Selecione o produto de cada item'); return }
    setSaving(true)
    try {
      const id = await savePedido(form, itens)
      show(`Pedido ${id} salvo!`)
      setTimeout(() => { onSaved(); onBack() }, 700)
    } catch (e) {
      show('Erro: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const prodNames = (produtos || []).map(p => p.nome)
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
        {/* Cliente */}
        <div className="field-label">Cliente *</div>
        <input className="field-input" placeholder="Nome do cliente" value={form.cliente} onChange={e => setField('cliente', e.target.value)} />

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

        {/* Itens */}
        <div className="section-label">Itens do pedido</div>
        <div className="card card-flush" style={{ padding: '0 14px', marginBottom: 6 }}>
          {itens.map((it, i) => (
            <div key={i} className="item-row">
              <select
                className="item-select"
                value={it.produto}
                onChange={e => handleProdutoChange(i, e.target.value)}
              >
                <option value="">Selecionar produto</option>
                {prodNames.map(p => (
                  <option key={p} value={p}>{alertMap[p] ? '⚠️ ' : ''}{p}</option>
                ))}
              </select>
              <input
                className="item-qty"
                type="number" min="1"
                value={it.quantidade}
                onChange={e => setItem(i, 'quantidade', e.target.value)}
              />
              <input
                className="item-price"
                type="number" placeholder="R$"
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

        {/* Sinal + Total */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 12 }}>
          <div style={{ flex: 1, marginRight: 12 }}>
            <div className="field-label">Sinal (R$)</div>
            <input
              className="field-input"
              style={{ marginBottom: 0 }}
              type="number" placeholder="0,00"
              value={form.sinal}
              onChange={e => setField('sinal', e.target.value)}
            />
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="field-label">Total</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>R$ {fmtR(total)}</div>
            {parseFloat(form.sinal) > 0 && (
              <div style={{ fontSize: 12, color: '#f59e0b', marginTop: 2 }}>Saldo: R$ {fmtR(saldo)}</div>
            )}
          </div>
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

// ── Main page ─────────────────────────────────────────────────
export default function Pedidos() {
  const { data: pedidos,  loading: loadingPed, reload: reloadPedidos } = useData(getEncomendas)
  const { data: produtos, loading: loadingProd } = useData(getProdutos)
  const { data: insumos  } = useData(getInsumos)
  const { data: receitas } = useData(getReceitas)

  // mode: 'list' | 'novo' | pedido-object
  const [mode, setMode] = useState('list')
  const [filtro, setFiltro] = useState('Todos')

  const alertMap = useMemo(
    () => buildAlertMap(produtos || [], receitas || [], insumos || []),
    [produtos, receitas, insumos]
  )

  const pedidosFiltrados = useMemo(() => {
    const list = pedidos || []
    return filtro === 'Todos' ? list : list.filter(p => p.status === filtro)
  }, [pedidos, filtro])

  if (loadingPed || loadingProd) return <div className="loading">Carregando...</div>

  if (mode === 'novo') {
    return (
      <NovoView
        produtos={produtos || []}
        alertMap={alertMap}
        onBack={() => setMode('list')}
        onSaved={reloadPedidos}
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
        {/* Filtros */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, overflowX: 'auto', paddingBottom: 2 }}>
          {FILTROS.map(f => (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              style={{
                padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                border: '1px solid',
                borderColor: filtro === f ? 'var(--teal)' : 'var(--border)',
                background:  filtro === f ? 'var(--teal-light)' : 'transparent',
                color:       filtro === f ? 'var(--teal)' : 'var(--text-secondary)',
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >{f}</button>
          ))}
        </div>

        {pedidosFiltrados.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', marginTop: 48, fontSize: 14 }}>
            {filtro === 'Todos' ? 'Nenhum pedido ainda' : `Nenhum pedido ${filtro.toLowerCase()}`}
          </div>
        ) : (
          pedidosFiltrados.map(p => (
            <PedidoCard
              key={p.id}
              pedido={p}
              alertMap={alertMap}
              onClick={() => setMode(p)}
            />
          ))
        )}
      </div>
    </>
  )
}
