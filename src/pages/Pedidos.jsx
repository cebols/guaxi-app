import { useState } from 'react'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { getProdutos, savePedido } from '../services/db'

const STATUS_OPTS = ['Pendente', 'Produzindo', 'Pronto', 'Entregue', 'Cancelado']
const PGTO_OPTS   = ['Aguardando', 'Pago parcial', 'Pago']
const CANAL_OPTS  = ['WhatsApp', 'iFood', '99Food', 'Keeta', 'Presencial']

export default function Pedidos() {
  const { data: produtos, loading } = useData(getProdutos)
  const { toast, show } = useToast()

  const [form, setForm] = useState({
    cliente: '', contato: '', canal: 'WhatsApp',
    dataEntrega: '', sinal: '', pgto: 'Aguardando', status: 'Pendente', obs: '',
  })
  const [itens, setItens] = useState([{ produto: '', quantidade: 1, precoUnit: '' }])
  const [saving, setSaving] = useState(false)

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setItem = (i, k, v) => setItens(prev => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it))
  const addItem = () => setItens(prev => [...prev, { produto: '', quantidade: 1, precoUnit: '' }])
  const removeItem = (i) => setItens(prev => prev.filter((_, idx) => idx !== i))

  const total = itens.reduce((s, it) => s + (parseFloat(it.precoUnit) || 0) * (parseFloat(it.quantidade) || 1), 0)

  const handleSave = async () => {
    if (!form.cliente) { show('Preencha o nome do cliente'); return }
    if (!form.dataEntrega) { show('Preencha a data de entrega'); return }
    if (itens.some(it => !it.produto)) { show('Selecione o produto de cada item'); return }
    setSaving(true)
    try {
      const id = await savePedido(form, itens)
      show(`Pedido ${id} salvo!`)
      setForm({ cliente: '', contato: '', canal: 'WhatsApp', dataEntrega: '', sinal: '', pgto: 'Aguardando', status: 'Pendente', obs: '' })
      setItens([{ produto: '', quantidade: 1, precoUnit: '' }])
    } catch (e) {
      show('Erro ao salvar: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="loading">Carregando produtos...</div>

  const prodNames = (produtos || []).map(p => p.nome)

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Novo pedido</div>
      </div>

      <div className="page" style={{ padding: '16px' }}>
        <div className="field-label">Cliente</div>
        <input className="field-input" placeholder="Nome do cliente" value={form.cliente} onChange={e => setField('cliente', e.target.value)} />

        <div className="field-label">Telefone / contato</div>
        <input className="field-input" placeholder="+55 11 9 ..." value={form.contato} onChange={e => setField('contato', e.target.value)} />

        <div className="field-row">
          <div>
            <div className="field-label">Canal</div>
            <select className="field-input" value={form.canal} onChange={e => setField('canal', e.target.value)}>
              {CANAL_OPTS.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <div className="field-label">Entrega</div>
            <input className="field-input" type="date" value={form.dataEntrega} onChange={e => setField('dataEntrega', e.target.value)} />
          </div>
        </div>

        <div className="section-label" style={{ marginTop: 4 }}>Itens do pedido</div>
        <div className="card card-flush" style={{ padding: '0 14px' }}>
          {itens.map((it, i) => (
            <div key={i} className="item-row">
              <select
                className="item-select"
                value={it.produto}
                onChange={e => {
                  const prod = (produtos || []).find(p => p.nome === e.target.value)
                  setItem(i, 'produto', e.target.value)
                  if (prod?.precoPraticado) setItem(i, 'precoUnit', prod.precoPraticado)
                  else if (prod?.precoSugerido) setItem(i, 'precoUnit', prod.precoSugerido)
                }}
              >
                <option value="">Selecionar produto</option>
                {prodNames.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <input
                className="item-qty"
                type="number"
                min="1"
                value={it.quantidade}
                onChange={e => setItem(i, 'quantidade', e.target.value)}
              />
              <input
                className="item-price"
                type="number"
                placeholder="R$"
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

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 12 }}>
          <div style={{ flex: 1, marginRight: 12 }}>
            <div className="field-label">Sinal (R$)</div>
            <input className="field-input" style={{ marginBottom: 0 }} type="number" placeholder="0,00" value={form.sinal} onChange={e => setField('sinal', e.target.value)} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="field-label">Total</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
              R$ {total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        <div className="field-row" style={{ marginTop: 10 }}>
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

        <div className="field-label">Observações</div>
        <textarea
          className="field-input"
          rows={2}
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
