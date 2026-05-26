import { useState, useMemo, useEffect, useRef } from 'react'
import { useLocation, useNavigate as useRRNavigate } from 'react-router-dom'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { useAuth } from '../contexts/AuthContext'
import { getProdutos, getInsumos, getReceitas, getEncomendas, getClientes, saveCliente, savePedido, updateStatusEncomenda, deletePedido, adjustEstoqueProduto } from '../services/db'

const STATUS_OPTS = ['Pendente', 'Pronto', 'Entregue', 'Cancelado']
const PGTO_OPTS   = ['Aguardando', 'Pago', 'Atrasado']
const CANAL_OPTS  = ['WhatsApp', 'Instagram']
const PIPE_STEPS  = ['Pendente', 'Pronto', 'Entregue']

// Urgency/temporal filters (row 1)
const FILTROS_URGENCIA = [
  { key: 'todos',     label: 'Todos',        match: () => true },
  { key: 'atrasados', label: '🔴 Atrasados', match: p => {
      if (['Entregue','Cancelado'].includes(p.status)) return false
      if (!p.dataEntrega) return false
      const t = new Date(); t.setHours(0,0,0,0)
      return new Date(p.dataEntrega + 'T00:00:00') < t
    }},
  { key: 'hoje',      label: '🟠 Hoje',      match: p => {
      if (!p.dataEntrega) return false
      const t = new Date(); t.setHours(0,0,0,0)
      return new Date(p.dataEntrega + 'T00:00:00').getTime() === t.getTime() && p.status !== 'Cancelado'
    }},
  { key: 'amanha',    label: '🟡 Amanhã',    match: p => {
      if (!p.dataEntrega) return false
      const t = new Date(); t.setHours(0,0,0,0); t.setDate(t.getDate()+1)
      return new Date(p.dataEntrega + 'T00:00:00').getTime() === t.getTime() && p.status !== 'Cancelado'
    }},
  { key: 'areceber',  label: '💰 A receber', match: p => p.status !== 'Cancelado' && p.pgto !== 'Pago' },
]
// Status filters (row 2)
const STATUS_FILTROS = ['Pendente', 'Pronto', 'Entregue']

const WA_TEMPLATES = [
  { icon: '✅', label: 'Pedido pronto',    msg: 'Oi {nome}! Seu pedido {id} tá pronto pra retirada. ❤️' },
  { icon: '🛵', label: 'Saiu pra entrega', msg: 'Oi {nome}! Saiu pra entrega o pedido {id}, chega em breve!' },
  { icon: '⏰', label: 'Lembrete entrega', msg: 'Oi {nome}! Passando pra lembrar do seu pedido {id} pra {data}. Tudo certo?' },
  { icon: '⭐', label: 'Pedir feedback',   msg: 'Oi {nome}! Espero que tenha curtido o pedido {id}. Manda foto! 😍' },
  { icon: '💰', label: 'Cobrança gentil',  msg: 'Oi {nome}! Passando pra lembrar do pagamento do pedido {id} (R$ {valor}). Posso te enviar o pix?' },
]

function fillTemplate(tpl, pedido) {
  const nome = (pedido.cliente || '').split(' ')[0]
  return tpl
    .replace('{nome}', nome)
    .replace('{id}', pedido.id)
    .replace('{data}', fmtDate(pedido.dataEntrega))
    .replace('{valor}', fmtR(pedido.valor))
}

const PGTO_STYLE = {
  Aguardando: { bg: 'var(--warn-bg)',   border: 'var(--warn-text)',  dot: 'var(--warn-text)',  color: 'var(--warn-text)',  label: 'Aguardando pagamento' },
  Pago:       { bg: 'var(--ok-bg)',     border: 'var(--ok-text)',    dot: 'var(--ok-text)',    color: 'var(--ok-text)',    label: 'Pago' },
  Atrasado:   { bg: 'var(--alert-bg)',  border: 'var(--alert-text)', dot: 'var(--alert-text)', color: 'var(--alert-text)', label: 'Pagamento atrasado' },
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
  const today = new Date(); today.setHours(0,0,0,0)
  const dt = new Date(dataEntrega + 'T00:00:00')
  const diff = Math.round((dt - today) / 86400000)
  if (diff < 0)   return { label: 'ATRASADO', bg: 'var(--alert-bg)', color: 'var(--alert-text)' }
  if (diff === 0) return { label: 'HOJE',     bg: 'var(--warn-bg)',  color: 'var(--warn-text)' }
  if (diff === 1) return { label: 'AMANHÃ',   bg: '#713f12',         color: '#fbbf24' }
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

function nextWeekday(day) {
  const d = new Date()
  d.setHours(0,0,0,0)
  while (d.getDay() !== day) d.setDate(d.getDate()+1)
  return d
}

// ── Pipeline visual ───────────────────────────────────────────
function Pipeline({ status, onStepClick, height = 26, fontSize = 9 }) {
  const idx = PIPE_STEPS.indexOf(status)
  return (
    <div style={{ display: 'flex', gap: 2, height }}>
      {PIPE_STEPS.map((s, i) => {
        const done    = i < idx
        const current = i === idx
        return (
          <div
            key={s}
            onClick={onStepClick ? (e) => { e.stopPropagation(); onStepClick(s, i) } : undefined}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize, fontWeight: current ? 800 : 700, letterSpacing: '0.04em', textTransform: 'uppercase',
              transition: 'background 0.3s, color 0.3s, border-color 0.3s',
              cursor: onStepClick ? 'pointer' : 'default',
              borderRadius: i === 0 ? '7px 0 0 7px' : i === 2 ? '0 7px 7px 0' : 0,
              background: done ? 'rgba(34,184,134,.15)' : current ? 'var(--teal)' : 'transparent',
              border: done || current ? 'none' : '1.5px dashed #333',
              color: done ? 'var(--teal)' : current ? '#000' : 'var(--text-tertiary)',
            }}
          >{s}</div>
        )
      })}
    </div>
  )
}

// ── Pgto toggle ───────────────────────────────────────────────
function PgtoToggle({ pgto, valor, onClick }) {
  const s = PGTO_STYLE[pgto] || PGTO_STYLE.Aguardando
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', padding: '9px 12px', borderRadius: 9,
        background: s.bg, border: `1.5px solid ${s.border}`,
        cursor: 'pointer', textAlign: 'left',
      }}
    >
      <div style={{ width: 10, height: 10, borderRadius: '50%', background: s.dot, flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: s.color }}>{s.label}</span>
      {valor > 0 && <span style={{ fontSize: 12, color: s.color, opacity: 0.8 }}>R$ {fmtR(valor)}</span>}
    </button>
  )
}

// ── Date chips para formulário ────────────────────────────────
function DateChipsForm({ value, onChange }) {
  const hoje = new Date(); hoje.setHours(0,0,0,0)
  const amanha = new Date(hoje); amanha.setDate(hoje.getDate()+1)
  const sab = nextWeekday(6)
  const dom = nextWeekday(0)

  const fmt = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  const toISO = (d) => d.toISOString().split('T')[0]

  const chips = [
    { key: 'hoje',    label: 'Hoje',    sub: fmt(hoje),   iso: toISO(hoje),   cls: 'today' },
    { key: 'amanha',  label: 'Amanhã',  sub: fmt(amanha), iso: toISO(amanha)  },
    { key: 'sab',     label: 'Sáb',     sub: fmt(sab),    iso: toISO(sab)     },
    { key: 'dom',     label: 'Dom',     sub: fmt(dom),    iso: toISO(dom)     },
    { key: 'agendar', label: '📅',       sub: 'Agendar',   iso: null           },
  ]

  const initKey = () => {
    if (!value) return null
    const chip = chips.find(c => c.iso === value)
    return chip ? chip.key : 'agendar'
  }
  const [chip, setChip] = useState(initKey)

  const select = (c) => {
    setChip(c.key)
    if (c.iso) onChange(c.iso)
  }

  const isToday = (c) => c.key === 'hoje'
  const isSelected = (c) => chip === c.key

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
        {chips.map(c => {
          const sel = isSelected(c)
          const today = isToday(c)
          return (
            <button
              key={c.key}
              onClick={() => select(c)}
              style={{
                flexShrink: 0, padding: '6px 8px', borderRadius: 8, fontSize: 12,
                cursor: 'pointer', border: 'none', textAlign: 'center', minWidth: 50,
                background: sel ? (today ? 'var(--warn-bg)' : 'var(--teal-light)') : 'var(--bg-secondary)',
                outline: sel ? `1.5px solid ${today ? 'var(--warn-text)' : 'var(--teal)'}` : '1.5px solid transparent',
                color: sel ? (today ? 'var(--warn-text)' : 'var(--teal)') : 'var(--text-secondary)',
              }}
            >
              <div style={{ fontWeight: 700 }}>{c.label}</div>
              {c.sub && <div style={{ fontSize: 10, marginTop: 1, opacity: 0.8 }}>{c.sub}</div>}
            </button>
          )
        })}
      </div>
      {chip === 'agendar' && (
        <input
          type="date"
          className="field-input"
          style={{ marginTop: 8, colorScheme: 'dark' }}
          value={value !== chips.find(c => c.iso === value)?.iso ? value : ''}
          onChange={e => onChange(e.target.value)}
        />
      )}
    </div>
  )
}

// ── Product modal ─────────────────────────────────────────────
function ProdModal({ produtos, itens, onAdd, onClose }) {
  const [search, setSearch] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [customNome, setCustomNome] = useState('')
  const [customPreco, setCustomPreco] = useState('')

  const filtered = (produtos || []).filter(p =>
    !search || p.nome.toLowerCase().includes(search.toLowerCase())
  )

  const addProd = (prod) => {
    onAdd({ produto: prod.nome, quantidade: 1, precoUnit: String(prod.precoDireta ?? prod.precoPraticado ?? prod.precoSugerido ?? 0) })
  }

  const addCustom = () => {
    if (!customNome.trim()) return
    const preco = parseFloat(customPreco.replace(',', '.')) || 0
    onAdd({ produto: customNome.trim(), quantidade: 1, precoUnit: String(preco), avulso: true })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--teal)', fontSize: 15, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
          ← Voltar
        </button>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Escolher produto</span>
      </div>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <input
          className="field-input"
          style={{ background: 'var(--bg-secondary)', margin: 0 }}
          placeholder="Buscar produto..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
        />
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.map(p => {
          const existing = itens.find(it => it.produto === p.nome)
          return (
            <div
              key={p.nome}
              onClick={() => addProd(p)}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '11px 14px', borderBottom: '1px solid var(--border)',
                background: existing ? 'var(--teal-light)' : 'transparent', cursor: 'pointer',
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{p.nome}</div>
                {existing && <div style={{ fontSize: 11, color: 'var(--teal)', marginTop: 2 }}>{existing.quantidade} no pedido</div>}
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--teal)' }}>
                R$ {fmtR(p.precoDireta ?? p.precoPraticado ?? p.precoSugerido ?? 0)}
              </span>
            </div>
          )
        })}

        {/* Custom item */}
        <div style={{ padding: '10px 14px' }}>
          {!showCustom ? (
            <button
              onClick={() => setShowCustom(true)}
              style={{
                width: '100%', padding: 12, background: 'transparent',
                border: '1.5px dashed #444', borderRadius: 10, fontSize: 13,
                color: 'var(--text-secondary)', cursor: 'pointer', textAlign: 'left',
                display: 'flex', alignItems: 'center', gap: 10,
              }}
            >
              <span style={{ fontSize: 18 }}>✏️</span>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  {search ? `"${search}" não está no cardápio` : 'Item personalizado'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>
                  Adicionar com nome e preço livres
                </div>
              </div>
            </button>
          ) : (
            <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                Item avulso
              </div>
              <input
                className="field-input"
                style={{ marginBottom: 8 }}
                placeholder="Nome do item"
                value={customNome}
                onChange={e => setCustomNome(e.target.value)}
                autoFocus
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="field-input"
                  style={{ flex: 1, marginBottom: 0 }}
                  placeholder="Preço (R$)"
                  inputMode="decimal"
                  value={customPreco}
                  onChange={e => setCustomPreco(e.target.value)}
                />
                <button
                  onClick={addCustom}
                  disabled={!customNome.trim()}
                  style={{
                    padding: '11px 16px', background: 'var(--teal)', color: '#000',
                    border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 700,
                    cursor: 'pointer', opacity: customNome.trim() ? 1 : 0.4,
                  }}
                >Adicionar</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Item row (form) ───────────────────────────────────────────
function ItemRow({ item, onChange, onRemove, canRemove }) {
  const total = (parseFloat(item.precoUnit) || 0) * (parseFloat(item.quantidade) || 1)
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: 10, background: 'var(--bg-secondary)', borderRadius: 10, marginBottom: 6,
      borderLeft: item.avulso ? '2px solid #555' : 'none',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: item.avulso ? 2 : 0 }}>{item.produto}</div>
        {item.avulso && <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>item avulso</div>}
      </div>
      <input
        type="text" inputMode="numeric"
        value={item.quantidade}
        onChange={e => onChange('quantidade', e.target.value)}
        style={{
          width: 52, textAlign: 'center', padding: '5px 6px',
          background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
          borderRadius: 7, color: 'var(--text-primary)', fontSize: 14, fontWeight: 700,
        }}
      />
      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>un</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--teal)', whiteSpace: 'nowrap' }}>R$ {fmtR(total)}</span>
      {canRemove && (
        <button onClick={onRemove} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', fontSize: 18, cursor: 'pointer', padding: '0 2px' }}>×</button>
      )}
    </div>
  )
}

// ── Form fields (shared between NovoView + NovoPedidoSheet) ───
function FormFields({ form, setField, itens, setItens, produtos, clientes, showModal, setShowModal, showMore, setShowMore }) {
  const handleClienteChange = (nome) => {
    setField('cliente', nome)
    const existing = (clientes || []).find(c => c.nome.toLowerCase() === nome.toLowerCase())
    if (existing?.telefone && !form.contato) setField('contato', existing.telefone)
  }

  const addItem = (item) => {
    setItens(prev => {
      const existing = prev.findIndex(it => it.produto === item.produto)
      if (existing >= 0) {
        return prev.map((it, i) => i === existing ? { ...it, quantidade: (parseInt(it.quantidade)||1) + 1 } : it)
      }
      return [...prev, item]
    })
    setShowModal(false)
  }

  const changeItem = (i, k, v) => setItens(prev => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it))
  const removeItem = (i) => setItens(prev => prev.filter((_, idx) => idx !== i))

  return (
    <>
      {showModal && (
        <ProdModal
          produtos={produtos}
          itens={itens}
          onAdd={addItem}
          onClose={() => setShowModal(false)}
        />
      )}

      {/* Cliente */}
      <div style={{ marginBottom: 14 }}>
        <div className="field-label">Cliente</div>
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
      </div>

      {/* Data */}
      <div style={{ marginBottom: 14 }}>
        <div className="field-label">Data de entrega</div>
        <DateChipsForm value={form.dataEntrega} onChange={v => setField('dataEntrega', v)} />
      </div>

      {/* Itens */}
      <div style={{ marginBottom: 14 }}>
        <div className="field-label">Itens</div>
        {itens.map((it, i) => (
          <ItemRow
            key={i}
            item={it}
            onChange={(k, v) => changeItem(i, k, v)}
            onRemove={() => removeItem(i)}
            canRemove={itens.length > 1}
          />
        ))}
        <button
          onClick={() => setShowModal(true)}
          style={{
            width: '100%', padding: 10, background: 'transparent',
            border: '1.5px dashed #333', borderRadius: 9, fontSize: 13,
            color: 'var(--teal)', fontWeight: 600, cursor: 'pointer',
          }}
        >+ Adicionar produto</button>
      </div>

      {/* Mais detalhes toggle */}
      <button
        onClick={() => setShowMore(s => !s)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '6px 0', marginBottom: 10, color: 'var(--text-tertiary)',
        }}
      >
        <div style={{ flex: 1, height: 1, background: 'var(--bg-secondary)' }} />
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', whiteSpace: 'nowrap' }}>
          {showMore ? '▲ Menos detalhes' : '▼ Mais detalhes'}
        </span>
        <div style={{ flex: 1, height: 1, background: 'var(--bg-secondary)' }} />
      </button>

      {showMore && (
        <div style={{ marginBottom: 14 }}>
          {/* Telefone */}
          <div className="field-label">Telefone</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <input
              className="field-input"
              style={{ marginBottom: 0, flex: 1 }}
              placeholder="+55 11 9 ..."
              value={form.contato}
              onChange={e => setField('contato', e.target.value)}
            />
            {waLink(form.contato) && (
              <a href={waLink(form.contato)} target="_blank" rel="noreferrer" style={{ background: '#14532d', color: '#4ade80', padding: '9px 12px', borderRadius: 8, fontSize: 12, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}>
                📲 WA
              </a>
            )}
          </div>

          {/* Canal + Tipo */}
          <div className="field-row">
            <div>
              <div className="field-label">Canal</div>
              <select className="field-input" value={form.canal} onChange={e => setField('canal', e.target.value)}>
                {CANAL_OPTS.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <div className="field-label">Tipo</div>
              <select className="field-input" value={form.tipoEntrega} onChange={e => setField('tipoEntrega', e.target.value)}>
                <option>Retirada</option>
                <option>Entrega</option>
              </select>
            </div>
          </div>
          {form.tipoEntrega === 'Entrega' && (
            <>
              <div className="field-label">Frete (R$)</div>
              <input className="field-input" type="text" inputMode="decimal" placeholder="0,00"
                value={form.frete} onChange={e => setField('frete', e.target.value)} />
            </>
          )}

          {/* Obs */}
          <div className="field-label">Observações</div>
          <textarea
            className="field-input"
            rows={3}
            placeholder="Anotações, endereço, preferências..."
            value={form.obs}
            onChange={e => setField('obs', e.target.value)}
            style={{ resize: 'none' }}
          />
        </div>
      )}
    </>
  )
}

// ── New order view (full page) ────────────────────────────────
function NovoView({ produtos, clientes, onBack, onSaved }) {
  const { toast, show } = useToast()
  const [form, setFormState] = useState({
    cliente: '', contato: '', canal: 'WhatsApp',
    dataEntrega: '', pgto: 'Aguardando', status: 'Pendente', obs: '',
    tipoEntrega: 'Entrega', frete: '10',
  })
  const [itens, setItens]       = useState([])
  const [saving, setSaving]     = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [showMore, setShowMore] = useState(false)

  const setField = (k, v) => setFormState(f => ({ ...f, [k]: v }))

  const frete = form.tipoEntrega === 'Entrega' ? (parseFloat(form.frete) || 0) : 0
  const itensTotal = itens.reduce((s, it) => s + (parseFloat(it.precoUnit)||0) * (parseInt(it.quantidade)||1), 0)
  const total = itensTotal + frete

  const handleSave = async () => {
    if (!form.cliente)     { show('Preencha o nome do cliente'); return }
    if (!form.dataEntrega) { show('Preencha a data de entrega'); return }
    if (itens.length === 0){ show('Adicione ao menos um item'); return }
    setSaving(true)
    try {
      const isClienteNovo = form.cliente.trim().length > 1 &&
        !(clientes || []).some(c => c.nome.toLowerCase() === form.cliente.toLowerCase())
      if (isClienteNovo) await saveCliente({ nome: form.cliente, telefone: form.contato })
      const id = await savePedido(form, itens)
      show(`Pedido ${id} salvo!`)
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
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--teal)', fontSize: 15, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
            ← voltar
          </button>
          <div className="topbar-title">Novo pedido</div>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 16, paddingBottom: 0 }}>
        <FormFields
          form={form} setField={setField}
          itens={itens} setItens={setItens}
          produtos={produtos} clientes={clientes}
          showModal={showModal} setShowModal={setShowModal}
          showMore={showMore} setShowMore={setShowMore}
        />
      </div>

      {/* Total bar */}
      <div style={{
        position: 'sticky', bottom: 0, background: 'var(--bg-card)',
        borderTop: '1px solid var(--border)', padding: '8px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>Total</span>
        <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>R$ {fmtR(total)}</span>
      </div>
      <div style={{ padding: '8px 16px 16px', background: 'var(--bg-card)' }}>
        <button
          className="btn-primary"
          onClick={handleSave}
          disabled={saving || !form.cliente || !form.dataEntrega || itens.length === 0}
          style={{ opacity: (!form.cliente || !form.dataEntrega || itens.length === 0) ? 0.4 : 1 }}
        >
          {saving ? 'Salvando...' : 'Salvar pedido'}
        </button>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}

// ── Pgto bar (like pipeline but 3 independent states) ─────────
function PgtoBar({ pgto, onChange, height = 36, fontSize = 11 }) {
  const opts = [
    { key: 'Aguardando', label: 'Aguardando', activeBg: '#713f12', activeColor: '#fbbf24' },
    { key: 'Pago',       label: 'Pago',       activeBg: '#14532d', activeColor: '#4ade80' },
    { key: 'Atrasado',   label: 'Atrasado',   activeBg: '#3b1f1f', activeColor: '#ef4444' },
  ]
  return (
    <div style={{ display: 'flex', gap: 2, height }}>
      {opts.map((o, i) => {
        const active = pgto === o.key
        return (
          <div key={o.key} onClick={() => onChange(o.key)} style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize, fontWeight: active ? 800 : 700, letterSpacing: '0.04em', textTransform: 'uppercase',
            cursor: 'pointer',
            borderRadius: i === 0 ? '7px 0 0 7px' : i === 2 ? '0 7px 7px 0' : 0,
            background: active ? o.activeBg : 'transparent',
            border: active ? 'none' : '1.5px dashed #333',
            color: active ? o.activeColor : 'var(--text-tertiary)',
            transition: 'background 0.3s, color 0.3s',
          }}>{o.label}</div>
        )
      })}
    </div>
  )
}

// ── Order card ────────────────────────────────────────────────
function PedidoCard({ pedido, alertMap, expanded, onToggle, onEdit, onQuickStatus, onTogglePgto }) {
  const urg      = urgency(pedido.dataEntrega)
  const hasAlert = (pedido.itens || []).some(it => alertMap[it.produto])

  const dateChipStyle = (() => {
    if (!pedido.dataEntrega) return null
    const today = new Date(); today.setHours(0,0,0,0)
    const diff = Math.round((new Date(pedido.dataEntrega + 'T00:00:00') - today) / 86400000)
    if (diff < 0)   return { color: 'var(--alert-text)' }
    if (diff === 0) return { color: 'var(--warn-text)' }
    if (diff === 1) return { color: '#fbbf24' }
    return { color: 'var(--text-tertiary)' }
  })()

  const pgtoS = PGTO_STYLE[pedido.pgto] || PGTO_STYLE.Aguardando
  const itensStr = (pedido.itens || []).map(it => `${it.produto} ×${it.quantidade}`).join(' · ')

  return (
    <div style={{ marginBottom: expanded ? 0 : 8 }}>
      <div
        className="card"
        onClick={onToggle}
        style={{
          padding: '12px 14px', cursor: 'pointer',
          borderRadius: expanded ? '12px 12px 0 0' : 12,
          marginBottom: 0,
          borderLeft: (urg?.label === 'HOJE' || urg?.label === 'ATRASADO') ? '3px solid var(--alert-text)' : undefined,
        }}
      >
        {/* Head */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {urg && (
              <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: urg.bg, color: urg.color, letterSpacing: '.04em' }}>
                {urg.label}
              </span>
            )}
            {hasAlert && <span style={{ fontSize: 10, color: '#f59e0b' }}>⚠️</span>}
            {pedido.canal === 'FormExterno' && (
              <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: 'var(--info-bg)', color: 'var(--info-text)', letterSpacing: '.04em' }}>ONLINE</span>
            )}
            <span style={{ fontSize: 15, fontWeight: 700 }}>{pedido.cliente}</span>
          </div>
          {pedido.dataEntrega && dateChipStyle && (
            <span style={{ fontSize: 12, fontWeight: 700, color: dateChipStyle.color, flexShrink: 0, marginLeft: 10 }}>
              {fmtDate(pedido.dataEntrega)}
            </span>
          )}
        </div>

        {/* Items summary */}
        {itensStr && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {itensStr}
          </div>
        )}

        {/* Footer: pipeline + pgto */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            {pedido.status === 'Cancelado' ? (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: '#3b1f1f', color: '#ef4444' }}>Cancelado</span>
            ) : (
              <Pipeline
                status={pedido.status}
                onStepClick={(s) => { onQuickStatus(s) }}
              />
            )}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onTogglePgto() }}
            style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: pgtoS.bg, color: pgtoS.color, whiteSpace: 'nowrap', flexShrink: 0, border: 'none', cursor: 'pointer' }}
          >
            {pgtoS.label}
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ background: 'var(--bg-tertiary)', border: '1px solid #2a2a2a', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '10px 14px', marginBottom: 8 }}>
          {(pedido.itens || []).map((it, i, arr) => (
            <div key={it.id || i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < arr.length - 1 ? '1px solid #1e1e1e' : 'none', fontSize: 13 }}>
              <span>{it.produto} <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>×{it.quantidade}</span></span>
              <span style={{ fontWeight: 600 }}>R$ {fmtR((it.precoUnit||0) * (it.quantidade||1))}</span>
            </div>
          ))}
          {pedido.frete > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 12, color: 'var(--text-secondary)', borderTop: '1px solid #1e1e1e', marginTop: 2 }}>
              <span>Frete</span>
              <span style={{ fontWeight: 600 }}>R$ {fmtR(pedido.frete)}</span>
            </div>
          )}
          {pedido.canal && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>Canal: {pedido.canal}</div>}
          {hasAlert && (
            <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 6, background: '#3b2700', padding: '5px 8px', borderRadius: 6 }}>
              ⚠️ Insumo crítico: {(pedido.itens || []).filter(it => alertMap[it.produto]).map(it => it.produto).join(', ')} com estoque abaixo do mínimo
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={onEdit} style={{ padding: '7px 14px', borderRadius: 8, border: '1.5px solid var(--teal)', background: 'var(--teal-light)', color: 'var(--teal)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Editar detalhes
            </button>
          </div>
        </div>
      )}
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
  const [dataEntrega, setDataEntrega] = useState(pedido.dataEntrega || '')
  const [saving, setSaving]           = useState(false)
  const [confirm, setConfirm]         = useState(false)

  const wa = waLink(pedido.contato)
  const itensSubtotal = (pedido.itens || []).reduce((s, it) => s + (it.precoUnit||0) * (it.quantidade||1), 0)
  const freteNum = tipoEntrega === 'Entrega' ? (parseFloat(frete) || 0) : 0
  const totalAtual = itensSubtotal + freteNum

  const cycleStatus = (s) => {
    setStatus(s)
    if (s === 'Entregue' && pgto !== 'Pago') setPgto('Atrasado')
  }
  const cyclePgto = () => {
    setPgto(p => p === 'Aguardando' ? 'Pago' : p === 'Pago' ? 'Atrasado' : 'Aguardando')
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateStatusEncomenda(pedido.id, status, pgto, tipoEntrega, frete, totalAtual, dataEntrega)
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
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--teal)', fontSize: 15, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
            ← voltar
          </button>
          <div style={{ textAlign: 'right' }}>
            <div className="topbar-title">{pedido.cliente}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{pedido.id}</div>
          </div>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 16 }}>

        {/* Data entrega — editável */}
        <div style={{ background: 'var(--bg-secondary)', borderRadius: 12, padding: 12, marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, marginBottom: 8 }}>
            Data de entrega
          </div>
          <DateChipsForm value={dataEntrega} onChange={setDataEntrega} />
        </div>

        {/* Status pipeline */}
        <div style={{ background: 'var(--bg-secondary)', borderRadius: 12, padding: 12, marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, marginBottom: 10 }}>
            Status da produção — toque para avançar
          </div>
          <Pipeline status={status} height={36} fontSize={11} onStepClick={(s) => cycleStatus(s)} />
        </div>

        {/* Pgto bar */}
        <div style={{ background: 'var(--bg-secondary)', borderRadius: 12, padding: 12, marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, marginBottom: 10 }}>
            Pagamento — toque para alterar
          </div>
          <PgtoBar pgto={pgto} onChange={setPgto} height={36} fontSize={11} />
        </div>

        {/* Itens */}
        <div style={{ background: 'var(--bg-secondary)', borderRadius: 12, padding: 12, marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, marginBottom: 10 }}>
            Itens
          </div>
          {(pedido.itens || []).map((it, i, arr) => (
            <div key={it.id || i} style={{
              display: 'flex', justifyContent: 'space-between', padding: '6px 0',
              borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none', fontSize: 13,
            }}>
              <span>
                {it.produto}
                {alertMap[it.produto] && <span style={{ marginLeft: 6, fontSize: 11, color: '#f59e0b' }}>⚠️</span>}
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 6 }}>×{it.quantidade}</span>
              </span>
              <span style={{ fontWeight: 600, color: 'var(--teal)' }}>R$ {fmtR((it.precoUnit||0) * (it.quantidade||1))}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', fontWeight: 700, fontSize: 14 }}>
            <span>Total</span>
            <span>R$ {fmtR(totalAtual)}</span>
          </div>
        </div>

        {/* WhatsApp */}
        {wa && (
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 12, padding: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, marginBottom: 10 }}>
              WhatsApp — {pedido.cliente?.split(' ')[0]}
            </div>
            {WA_TEMPLATES.map(t => {
              const msg = fillTemplate(t.msg, { ...pedido, valor: totalAtual })
              return (
                <a
                  key={t.label}
                  href={`${wa}?text=${encodeURIComponent(msg)}`}
                  target="_blank" rel="noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 8px', borderRadius: 8,
                    background: 'rgba(37,211,102,.06)', border: '1.5px solid rgba(37,211,102,.15)',
                    marginBottom: 6, textDecoration: 'none',
                  }}
                >
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{t.icon}</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.35 }}>{t.label}</span>
                  <span style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>›</span>
                </a>
              )
            })}
          </div>
        )}

        {/* Frete */}
        {tipoEntrega === 'Entrega' && (
          <div style={{ marginBottom: 10 }}>
            <div className="field-label">Frete (R$)</div>
            <input className="field-input" type="text" inputMode="decimal" placeholder="0,00"
              value={frete} onChange={e => setFrete(e.target.value)} />
          </div>
        )}
        {pedido.tipoEntrega === 'Retirada' && (
          <div style={{ marginBottom: 10 }}>
            <div className="field-label">Tipo de entrega</div>
            <select className="field-input" value={tipoEntrega} onChange={e => setTipoEntrega(e.target.value)}>
              <option>Retirada</option>
              <option>Entrega</option>
            </select>
          </div>
        )}

        {/* Obs */}
        {pedido.obs && (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14, background: 'var(--bg-secondary)', borderRadius: 10, padding: '10px 14px' }}>
            {pedido.obs}
          </div>
        )}

        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Salvando...' : 'Salvar alterações'}
        </button>

        {!confirm ? (
          <button onClick={() => setConfirm(true)} style={{ width: '100%', marginTop: 10, padding: 11, background: 'transparent', border: '1px solid #7f1d1d', color: '#ef4444', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            Apagar pedido
          </button>
        ) : (
          <div style={{ marginTop: 10, padding: '12px 14px', background: '#1a0a0a', borderRadius: 10, border: '1px solid #7f1d1d' }}>
            <div style={{ fontSize: 13, color: '#fca5a5', marginBottom: 10 }}>
              Tem certeza? Isso apaga {pedido.id} ({pedido.cliente}) permanentemente.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={async () => { setSaving(true); try { await deletePedido(pedido.id); await onSaved(); onBack() } catch(e) { show('Erro: '+e.message); setSaving(false) } }} style={{ flex: 1, padding: 9, background: '#7f1d1d', color: '#fca5a5', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 13 }} disabled={saving}>Apagar</button>
              <button onClick={() => setConfirm(false)} style={{ flex: 1, padding: 9, background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>Cancelar</button>
            </div>
          </div>
        )}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}

// ── NovoPedidoSheet — sheet para uso externo ──────────────────
export function NovoPedidoSheet({ onClose, onSaved }) {
  const { toast, show }   = useToast()
  const { data: produtos } = useData(getProdutos)
  const { data: clientes } = useData(getClientes)

  const [form, setFormState] = useState({
    cliente: '', contato: '', canal: 'WhatsApp',
    dataEntrega: '', pgto: 'Aguardando', status: 'Pendente', obs: '',
    tipoEntrega: 'Entrega', frete: '10',
  })
  const [itens, setItens]       = useState([])
  const [saving, setSaving]     = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [showMore, setShowMore] = useState(false)

  const setField = (k, v) => setFormState(f => ({ ...f, [k]: v }))

  const frete = form.tipoEntrega === 'Entrega' ? (parseFloat(form.frete) || 0) : 0
  const itensTotal = itens.reduce((s, it) => s + (parseFloat(it.precoUnit)||0) * (parseInt(it.quantidade)||1), 0)
  const total = itensTotal + frete

  const handleSave = async () => {
    if (!form.cliente)     { show('Preencha o nome do cliente'); return }
    if (!form.dataEntrega) { show('Preencha a data de entrega'); return }
    if (itens.length === 0){ show('Adicione ao menos um item'); return }
    setSaving(true)
    try {
      const isClienteNovo = form.cliente.trim().length > 1 &&
        !(clientes || []).some(c => c.nome.toLowerCase() === form.cliente.toLowerCase())
      if (isClienteNovo) await saveCliente({ nome: form.cliente, telefone: form.contato })
      const id = await savePedido(form, itens)
      show(`Pedido ${id} salvo!`)
      setTimeout(() => { onSaved?.(); onClose() }, 700)
    } catch (e) {
      show('Erro: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div className="sheet" style={{ maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="sheet-title">
          <span>Novo pedido</span>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer' }} onClick={onClose}>×</button>
        </div>

        <FormFields
          form={form} setField={setField}
          itens={itens} setItens={setItens}
          produtos={produtos} clientes={clientes}
          showModal={showModal} setShowModal={setShowModal}
          showMore={showMore} setShowMore={setShowMore}
        />

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase' }}>Total</span>
            <span style={{ fontSize: 20, fontWeight: 700 }}>R$ {fmtR(total)}</span>
          </div>
          <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ opacity: (!form.cliente || !form.dataEntrega || itens.length === 0) ? 0.4 : 1 }}>
            {saving ? 'Salvando...' : 'Salvar pedido'}
          </button>
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}

// ── Production view ───────────────────────────────────────────
function fmtQty(q, unidade) {
  const n = Number(q)
  return `${n % 1 === 0 ? String(n) : n.toFixed(1)} ${unidade || 'un'}`
}

function ProducaoView({ pedidos, produtos, receitas, onEstoqueUpdated }) {
  const ativos = (pedidos || []).filter(p => !['Entregue','Cancelado'].includes(p.status))
  const receitaMap = Object.fromEntries((receitas || []).map(r => [r.id, r]))
  const prodMap    = Object.fromEntries((produtos  || []).map(p => [p.nome, p]))

  function addProd(nomeProd, qty, itemAcc, receitaAcc, depth = 0) {
    if (depth > 5) return
    const prod = prodMap[nomeProd]
    if (prod?.tipo === 'combo' && prod.componentes?.length > 0) {
      for (const comp of prod.componentes) {
        addProd(comp.nome || comp.produtoNome || '', (Number(comp.quantidade)||1) * qty, itemAcc, receitaAcc, depth+1)
      }
    } else {
      itemAcc[nomeProd] = (itemAcc[nomeProd] || 0) + qty
      if (!prod?.receitas?.length) return
      for (const pr of prod.receitas) {
        const key = pr.nome
        if (!receitaAcc[key]) receitaAcc[key] = { quantidade: 0, unidade: pr.unidadeGera || pr.unidade || 'un' }
        receitaAcc[key].quantidade += (Number(pr.quantidade)||1) * qty
      }
    }
  }

  const itemQtd = {}; const receitaQtd = {}
  for (const ped of ativos) for (const it of (ped.itens || [])) addProd(it.produto, Number(it.quantidade)||1, itemQtd, receitaQtd)

  const itensOrdenados    = Object.entries(itemQtd).sort((a,b) => b[1]-a[1])
  const receitasOrdenadas = Object.entries(receitaQtd).sort((a,b) => a[0].localeCompare(b[0],'pt-BR'))

  const [produzido, setProduzido] = useState({})
  const [savingProd, setSavingProd] = useState(false)
  const { toast, show } = useToast()

  const handleConfirmarProducao = async () => {
    const entries = Object.entries(produzido).filter(([,q]) => parseFloat(q) > 0)
    if (entries.length === 0) return
    setSavingProd(true)
    try {
      await Promise.all(entries.map(([nome, q]) => { const prod = prodMap[nome]; if (prod?.id) return adjustEstoqueProduto(prod.id, parseFloat(q)) }))
      setProduzido({}); show('Estoque atualizado!'); onEstoqueUpdated()
    } catch(e) { show('Erro: '+e.message) } finally { setSavingProd(false) }
  }

  if (ativos.length === 0) return <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', marginTop: 48, fontSize: 14 }}>Nenhum pedido ativo</div>

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '4px 10px', background: 'var(--card-bg)', borderRadius: 8, border: '1px solid var(--border)' }}>{ativos.length} pedido{ativos.length!==1?'s':''} ativo{ativos.length!==1?'s':''}</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '4px 10px', background: 'var(--card-bg)', borderRadius: 8, border: '1px solid var(--border)' }}>{itensOrdenados.length} item{itensOrdenados.length!==1?'ns':''} distintos</div>
      </div>
      <div className="section-label" style={{ marginTop: 16 }}>Itens a produzir</div>
      <div className="card card-flush" style={{ padding: '0 14px', marginBottom: 6 }}>
        {itensOrdenados.map(([nome, needed], i, arr) => {
          const prod = prodMap[nome]
          const emEstoque = prod?.estoqueAtual ?? null
          const falta = emEstoque !== null ? Math.max(0, needed - emEstoque) : null
          return (
            <div key={nome} style={{ padding: '10px 0', borderBottom: i < arr.length-1 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{nome}</span>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--teal)' }}>{needed} un</span>
                  {emEstoque !== null && <div style={{ fontSize: 11, color: falta===0 ? 'var(--teal)' : 'var(--text-secondary)', marginTop: 1 }}>{falta===0 ? `✓ em estoque (${emEstoque})` : `estoque: ${emEstoque} · produzir: ${falta}`}</div>}
                </div>
              </div>
              {prod?.id && falta !== 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Produziu hoje:</span>
                  <input type="text" inputMode="decimal" className="item-qty" style={{ width: 64 }} placeholder="0"
                    value={produzido[nome] || ''} onChange={e => setProduzido(p => ({...p, [nome]: e.target.value}))} />
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>un</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {Object.values(produzido).some(q => parseFloat(q) > 0) && (
        <button className="btn-primary" onClick={handleConfirmarProducao} disabled={savingProd} style={{ marginBottom: 8 }}>
          {savingProd ? 'Salvando...' : 'Confirmar produção → estoque'}
        </button>
      )}
      <div className="section-label" style={{ marginTop: 16 }}>Receitas necessárias</div>
      {receitasOrdenadas.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '8px 0' }}>Sem receitas vinculadas</div>
      ) : (
        <div className="card card-flush" style={{ padding: '0 14px' }}>
          {receitasOrdenadas.map(([nome, info], i, arr) => (
            <div key={nome} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: i < arr.length-1 ? '1px solid var(--border)' : 'none' }}>
              <span style={{ fontSize: 13 }}>{nome}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--teal)' }}>{fmtQty(info.quantidade, info.unidade)}</span>
            </div>
          ))}
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────
export default function Pedidos() {
  const { user } = useAuth()
  const location = useLocation()
  const navTo    = useRRNavigate()
  const { data: pedidos,  loading: loadingPed, reload: reloadPedidos } = useData(getEncomendas)
  const { data: produtos, loading: loadingProd, reload: reloadProdutos } = useData(getProdutos)
  const { data: insumos  } = useData(getInsumos)
  const { data: receitas } = useData(getReceitas)
  const { data: clientes, reload: reloadClientes } = useData(getClientes)

  const [mode, setMode]               = useState('list')

  const handledState = useRef(false)
  useEffect(() => {
    if (handledState.current) return
    if (location.state?.openNew) {
      handledState.current = true
      setMode('novo')
      navTo(location.pathname, { replace: true, state: null })
    }
  }, [])

  useEffect(() => {
    if (handledState.current || !location.state?.openPedidoId || !pedidos) return
    const ped = pedidos.find(p => p.id === location.state.openPedidoId)
    if (!ped) return
    handledState.current = true
    setMode(ped)
    navTo(location.pathname, { replace: true, state: null })
  }, [pedidos])
  const [filtroUrgencia, setFiltroUrgencia] = useState(() => localStorage.getItem('pedidos_filtro') || 'todos')
  const [filtroStatus, setFiltroStatus]     = useState(['Pendente', 'Pronto'])
  const [aba, setAba]                 = useState('pedidos')
  const [selecao, setSelecao]         = useState({})
  const [expandedPedidoId, setExpandedPedidoId] = useState(null)
  const selecaoMode = Object.keys(selecao).some(k => selecao[k])

  const setFiltroUrgenciaAndSave = (f) => { setFiltroUrgencia(f); localStorage.setItem('pedidos_filtro', f) }

  const alertMap = useMemo(
    () => buildAlertMap(produtos || [], receitas || [], insumos || []),
    [produtos, receitas, insumos]
  )

  const pedidosFiltrados = useMemo(() => {
    const list = pedidos || []
    const fu = FILTROS_URGENCIA.find(x => x.key === filtroUrgencia) || FILTROS_URGENCIA[0]
    return list.filter(p => {
      if (!fu.match(p)) return false
      if (filtroStatus.length > 0 && !filtroStatus.includes(p.status)) return false
      return true
    })
  }, [pedidos, filtroUrgencia, filtroStatus])

  const urgenciaCounts = useMemo(() => {
    const out = {}
    for (const f of FILTROS_URGENCIA) {
      if (f.key === 'todos') continue
      out[f.key] = (pedidos || []).filter(p => f.match(p)).length
    }
    return out
  }, [pedidos])

  const statusCounts = useMemo(() => {
    const out = {}
    const fu = FILTROS_URGENCIA.find(x => x.key === filtroUrgencia) || FILTROS_URGENCIA[0]
    for (const s of STATUS_FILTROS) {
      out[s] = (pedidos || []).filter(p => fu.match(p) && p.status === s).length
    }
    return out
  }, [pedidos, filtroUrgencia])

  const toggleStatusFiltro = (s) =>
    setFiltroStatus(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])

  const handleQuickStatus = async (pedido, novoStatus) => {
    try {
      const novoPgto = novoStatus === 'Entregue' && pedido.pgto !== 'Pago' ? 'Atrasado' : pedido.pgto
      await updateStatusEncomenda(pedido.id, novoStatus, novoPgto, pedido.tipoEntrega, pedido.frete, pedido.valor)
      reloadPedidos()
      setExpandedPedidoId(null)
    } catch(e) { alert('Erro: '+e.message) }
  }

  const handleTogglePgto = async (pedido) => {
    const ordem = ['Aguardando', 'Pago', 'Atrasado']
    const nextPgto = ordem[(ordem.indexOf(pedido.pgto) + 1) % 3]
    try {
      await updateStatusEncomenda(pedido.id, pedido.status, nextPgto, pedido.tipoEntrega, pedido.frete, pedido.valor)
      reloadPedidos()
    } catch(e) { alert('Erro: '+e.message) }
  }

  const handleBulkStatus = async (novoStatus) => {
    const ids = Object.keys(selecao).filter(k => selecao[k])
    try {
      await Promise.all(ids.map(id => {
        const p = (pedidos || []).find(x => x.id === id)
        if (!p) return null
        const novoPgto = novoStatus === 'Entregue' && p.pgto !== 'Pago' ? 'Atrasado' : p.pgto
        return updateStatusEncomenda(id, novoStatus, novoPgto, p.tipoEntrega, p.frete, p.valor)
      }))
      setSelecao({}); reloadPedidos()
    } catch(e) { alert('Erro: '+e.message) }
  }

  if ((loadingPed && !pedidos) || (loadingProd && !produtos)) return <div className="loading">Carregando...</div>

  if (mode === 'novo') {
    return <NovoView produtos={produtos||[]} clientes={clientes||[]} onBack={() => setMode('list')} onSaved={() => { reloadPedidos(); reloadClientes() }} />
  }
  if (mode !== 'list') {
    return <DetalheView pedido={mode} alertMap={alertMap} onBack={() => setMode('list')} onSaved={reloadPedidos} />
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div className="topbar-title">Pedidos</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {user?.id && (
              <button
                onClick={() => {
                  const url = `${window.location.origin}/pedido/${user.id}`
                  navigator.clipboard.writeText(url).then(() => alert('Link copiado!'))
                }}
                style={{ background: 'transparent', color: 'var(--teal)', border: '1px solid var(--teal)', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                title="Copiar link do formulário de pedidos"
              >
                🔗 Link
              </button>
            )}
            <button onClick={() => setMode('novo')} style={{ background: 'var(--teal)', color: '#000', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              + Novo
            </button>
          </div>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 12 }}>
        {/* Abas */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 14, borderBottom: '1px solid var(--border)' }}>
          {[['pedidos','Pedidos'],['producao','Produção']].map(([key, label]) => (
            <button key={key} onClick={() => setAba(key)} style={{
              padding: '7px 18px', fontSize: 13, fontWeight: 600,
              border: 'none', background: 'transparent', cursor: 'pointer',
              color: aba === key ? 'var(--teal)' : 'var(--text-secondary)',
              borderBottom: aba === key ? '2px solid var(--teal)' : '2px solid transparent',
              marginBottom: -1,
            }}>{label}</button>
          ))}
        </div>

        {aba === 'producao' ? (
          <ProducaoView pedidos={pedidos} produtos={produtos} receitas={receitas} onEstoqueUpdated={reloadProdutos} />
        ) : (
          <>
            {/* Mini dashboard */}
            {(() => {
              const todos = pedidos || []
              const pendentes = todos.filter(p => p.status !== 'Entregue' && p.status !== 'Cancelado').length
              const abertos   = todos.filter(p => p.status !== 'Cancelado' && p.pgto !== 'Pago').length
              const aReceber  = todos.filter(p => p.status !== 'Cancelado' && p.pgto !== 'Pago').reduce((s, p) => s + (p.saldo || 0), 0)
              const stats = [
                { label: 'Em aberto', value: String(pendentes), sub: pendentes === 1 ? 'pedido' : 'pedidos' },
                { label: 'Pgto pendente', value: String(abertos), sub: abertos === 1 ? 'pedido' : 'pedidos' },
                { label: 'A receber', value: `R$ ${Number(aReceber).toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`, sub: '' },
              ]
              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
                  {stats.map(s => (
                    <div key={s.label} className="card" style={{ padding: '12px 14px' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700, marginBottom: 4 }}>{s.label}</div>
                      <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>{s.value}</div>
                      {s.sub && <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>{s.sub}</div>}
                    </div>
                  ))}
                </div>
              )
            })()}

            {/* Filter row 1: urgência/temporal — wraps se não couber */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              {FILTROS_URGENCIA.map(f => {
                const count  = urgenciaCounts[f.key]
                const active = filtroUrgencia === f.key
                return (
                  <button key={f.key} onClick={() => setFiltroUrgenciaAndSave(f.key)} style={{
                    padding: '4px 9px', borderRadius: 14, fontSize: 11, fontWeight: 600,
                    border: '1.5px solid', whiteSpace: 'nowrap', cursor: 'pointer',
                    borderColor: active ? 'var(--teal)' : '#333',
                    background:  active ? 'var(--teal-light)' : 'transparent',
                    color:       active ? 'var(--teal)' : 'var(--text-secondary)',
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    {f.label}
                    {count > 0 && (
                      <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.8 }}>{count}</span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Filter row 2: status — multi-select, Entregue off by default */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              <button
                onClick={() => setFiltroStatus([])}
                style={{
                  padding: '4px 9px', borderRadius: 14, fontSize: 11, fontWeight: 600,
                  border: '1.5px solid', cursor: 'pointer', whiteSpace: 'nowrap',
                  borderColor: filtroStatus.length === 0 ? 'var(--teal)' : '#333',
                  background:  filtroStatus.length === 0 ? 'var(--teal-light)' : 'transparent',
                  color:       filtroStatus.length === 0 ? 'var(--teal)' : 'var(--text-tertiary)',
                }}
              >Todos</button>
              {STATUS_FILTROS.map(s => {
                const active = filtroStatus.includes(s)
                const count  = statusCounts[s]
                return (
                  <button key={s} onClick={() => toggleStatusFiltro(s)} style={{
                    padding: '4px 9px', borderRadius: 14, fontSize: 11, fontWeight: 600,
                    border: '1.5px solid', whiteSpace: 'nowrap', cursor: 'pointer',
                    borderColor: active ? 'var(--teal)' : '#333',
                    background:  active ? 'var(--teal-light)' : 'transparent',
                    color:       active ? 'var(--teal)' : 'var(--text-tertiary)',
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    {s}
                    {count > 0 && <span style={{ fontSize: 9, opacity: 0.7 }}>{count}</span>}
                  </button>
                )
              })}
            </div>

            {/* Bulk action bar */}
            {selecaoMode && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--teal-light)', border: '1px solid var(--teal)', borderRadius: 10, padding: '8px 12px', marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--teal)' }}>{Object.values(selecao).filter(Boolean).length} selecionado(s)</span>
                <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
                  {['Pronto','Entregue'].map(s => (
                    <button key={s} onClick={() => handleBulkStatus(s)} style={{ padding: '5px 10px', borderRadius: 6, border: 'none', background: 'var(--teal)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>→ {s}</button>
                  ))}
                  <button onClick={() => setSelecao({})} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}>Cancelar</button>
                </div>
              </div>
            )}

            {pedidosFiltrados.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', marginTop: 48, fontSize: 14 }}>
                {filtroUrgencia === 'todos' ? 'Nenhum pedido ainda' : 'Nenhum pedido neste filtro'}
              </div>
            ) : (
              pedidosFiltrados.map(p => (
                <PedidoCard
                  key={p.id}
                  pedido={p}
                  alertMap={alertMap}
                  expanded={expandedPedidoId === p.id}
                  onToggle={() => setExpandedPedidoId(id => id === p.id ? null : p.id)}
                  onEdit={() => setMode(p)}
                  onQuickStatus={(status) => handleQuickStatus(p, status)}
                  onTogglePgto={() => handleTogglePgto(p)}
                />
              ))
            )}
          </>
        )}
      </div>
    </>
  )
}
