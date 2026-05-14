import { useState } from 'react'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import {
  getInsumos, saveInsumo, deleteInsumo,
  getEmbalagens, saveEmbalagem, deleteEmbalagem,
  getProdutos, saveProduto, deleteProduto,
} from '../services/db'

const UNID_OPTS = ['g', 'ml', 'un', 'kg', 'L', 'cx']

// ── Generic sheet form ────────────────────────────────────────

function Sheet({ title, children, onClose }) {
  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-title">
          <span>{title}</span>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer' }} onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </>
  )
}

// ── Insumos ───────────────────────────────────────────────────

const INSUMO_EMPTY = { nome: '', categoria: '', unidade: 'g', custoEmb: '', custoUnit: '', estoqueAtual: '', estoqueMin: '', fornecedor: '', whatsapp: '' }

function InsumoForm({ item, onSave, onDelete, onClose }) {
  const [form, setForm] = useState(item ? {
    ...item,
    custoEmb: item.custoEmb || '',
    custoUnit: item.custoUnit || '',
    estoqueAtual: item.estoqueAtual ?? '',
    estoqueMin: item.estoqueMin || '',
  } : INSUMO_EMPTY)
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handle = async () => {
    if (!form.nome) return
    setSaving(true)
    try { await onSave(form); onClose() } catch (e) { alert(e.message) } finally { setSaving(false) }
  }

  return (
    <Sheet title={item ? 'Editar insumo' : 'Novo insumo'} onClose={onClose}>
      <div className="field-label">Nome *</div>
      <input className="field-input" placeholder="ex: Farinha de trigo" value={form.nome} onChange={e => set('nome', e.target.value)} />

      <div className="field-row">
        <div>
          <div className="field-label">Categoria</div>
          <input className="field-input" placeholder="ex: Farinhas" value={form.categoria} onChange={e => set('categoria', e.target.value)} />
        </div>
        <div>
          <div className="field-label">Unidade</div>
          <select className="field-input" value={form.unidade} onChange={e => set('unidade', e.target.value)}>
            {UNID_OPTS.map(u => <option key={u}>{u}</option>)}
          </select>
        </div>
      </div>

      <div className="field-row">
        <div>
          <div className="field-label">Custo emb. (R$)</div>
          <input className="field-input" type="number" min="0" step="0.01" placeholder="0,00" value={form.custoEmb} onChange={e => set('custoEmb', e.target.value)} />
        </div>
        <div>
          <div className="field-label">Custo unit. (R$)</div>
          <input className="field-input" type="number" min="0" step="0.001" placeholder="0,000" value={form.custoUnit} onChange={e => set('custoUnit', e.target.value)} />
        </div>
      </div>

      <div className="field-row">
        <div>
          <div className="field-label">Estoque atual</div>
          <input className="field-input" type="number" min="0" placeholder="—" value={form.estoqueAtual} onChange={e => set('estoqueAtual', e.target.value)} />
        </div>
        <div>
          <div className="field-label">Estoque mínimo</div>
          <input className="field-input" type="number" min="0" placeholder="0" value={form.estoqueMin} onChange={e => set('estoqueMin', e.target.value)} />
        </div>
      </div>

      <div className="field-label">Fornecedor</div>
      <input className="field-input" placeholder="Nome do fornecedor" value={form.fornecedor} onChange={e => set('fornecedor', e.target.value)} />

      <div className="field-label">WhatsApp</div>
      <input className="field-input" type="tel" placeholder="+55 11 9 ..." value={form.whatsapp} onChange={e => set('whatsapp', e.target.value)} />

      <button className="btn-primary" onClick={handle} disabled={saving || !form.nome}>
        {saving ? 'Salvando...' : item ? 'Atualizar' : 'Criar insumo'}
      </button>
      {item && (
        <button className="btn-danger" onClick={() => { if (confirm('Excluir?')) onDelete(item.id).then(onClose).catch(e => alert(e.message)) }}>
          Excluir
        </button>
      )}
    </Sheet>
  )
}

// ── Embalagens ────────────────────────────────────────────────

const EMB_EMPTY = { nome: '', categoria: '', custoUnit: '', estoqueAtual: '', estoqueMin: '', fornecedor: '', whatsapp: '' }

function EmbalagemForm({ item, onSave, onDelete, onClose }) {
  const [form, setForm] = useState(item ? {
    ...item,
    custoUnit: item.custoUnit || '',
    estoqueAtual: item.estoqueAtual ?? '',
    estoqueMin: item.estoqueMin || '',
  } : EMB_EMPTY)
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handle = async () => {
    if (!form.nome) return
    setSaving(true)
    try { await onSave(form); onClose() } catch (e) { alert(e.message) } finally { setSaving(false) }
  }

  return (
    <Sheet title={item ? 'Editar embalagem' : 'Nova embalagem'} onClose={onClose}>
      <div className="field-label">Nome *</div>
      <input className="field-input" placeholder="ex: Caixinha 15x15" value={form.nome} onChange={e => set('nome', e.target.value)} />

      <div className="field-row">
        <div>
          <div className="field-label">Categoria</div>
          <input className="field-input" placeholder="ex: Caixas" value={form.categoria} onChange={e => set('categoria', e.target.value)} />
        </div>
        <div>
          <div className="field-label">Custo unit. (R$)</div>
          <input className="field-input" type="number" min="0" step="0.01" placeholder="0,00" value={form.custoUnit} onChange={e => set('custoUnit', e.target.value)} />
        </div>
      </div>

      <div className="field-row">
        <div>
          <div className="field-label">Estoque atual</div>
          <input className="field-input" type="number" min="0" placeholder="—" value={form.estoqueAtual} onChange={e => set('estoqueAtual', e.target.value)} />
        </div>
        <div>
          <div className="field-label">Estoque mínimo</div>
          <input className="field-input" type="number" min="0" placeholder="0" value={form.estoqueMin} onChange={e => set('estoqueMin', e.target.value)} />
        </div>
      </div>

      <div className="field-label">Fornecedor</div>
      <input className="field-input" placeholder="Nome do fornecedor" value={form.fornecedor} onChange={e => set('fornecedor', e.target.value)} />

      <div className="field-label">WhatsApp</div>
      <input className="field-input" type="tel" placeholder="+55 11 9 ..." value={form.whatsapp} onChange={e => set('whatsapp', e.target.value)} />

      <button className="btn-primary" onClick={handle} disabled={saving || !form.nome}>
        {saving ? 'Salvando...' : item ? 'Atualizar' : 'Criar embalagem'}
      </button>
      {item && (
        <button className="btn-danger" onClick={() => { if (confirm('Excluir?')) onDelete(item.id).then(onClose).catch(e => alert(e.message)) }}>
          Excluir
        </button>
      )}
    </Sheet>
  )
}

// ── Produtos ──────────────────────────────────────────────────

const PROD_EMPTY = { nome: '', custoTotal: '', precoSugerido: '', precoPraticado: '' }

function ProdutoForm({ item, onSave, onDelete, onClose }) {
  const [form, setForm] = useState(item ? {
    ...item,
    custoTotal: item.custoTotal || '',
    precoSugerido: item.precoSugerido || '',
    precoPraticado: item.precoPraticado ?? '',
  } : PROD_EMPTY)
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handle = async () => {
    if (!form.nome) return
    setSaving(true)
    try { await onSave(form); onClose() } catch (e) { alert(e.message) } finally { setSaving(false) }
  }

  return (
    <Sheet title={item ? 'Editar produto' : 'Novo produto'} onClose={onClose}>
      <div className="field-label">Nome *</div>
      <input className="field-input" placeholder="ex: Bolo de Pote Chocolate" value={form.nome} onChange={e => set('nome', e.target.value)} />

      <div className="field-row">
        <div>
          <div className="field-label">Custo total (R$)</div>
          <input className="field-input" type="number" min="0" step="0.01" placeholder="0,00" value={form.custoTotal} onChange={e => set('custoTotal', e.target.value)} />
        </div>
        <div>
          <div className="field-label">Preço sugerido</div>
          <input className="field-input" type="number" min="0" step="0.01" placeholder="0,00" value={form.precoSugerido} onChange={e => set('precoSugerido', e.target.value)} />
        </div>
      </div>

      <div className="field-label">Preço praticado (R$)</div>
      <input className="field-input" type="number" min="0" step="0.01" placeholder="0,00" value={form.precoPraticado} onChange={e => set('precoPraticado', e.target.value)} />

      <button className="btn-primary" onClick={handle} disabled={saving || !form.nome}>
        {saving ? 'Salvando...' : item ? 'Atualizar' : 'Criar produto'}
      </button>
      {item && (
        <button className="btn-danger" onClick={() => { if (confirm('Excluir?')) onDelete(item.id).then(onClose).catch(e => alert(e.message)) }}>
          Excluir
        </button>
      )}
    </Sheet>
  )
}

// ── Main page ─────────────────────────────────────────────────

function fmtR(val) {
  if (!val) return '—'
  return `R$ ${Number(val).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
}

export default function Cadastros() {
  const [tab, setTab] = useState('insumos')
  const [sheet, setSheet] = useState(null) // { type, item? }
  const { toast, show } = useToast()

  const { data: insumos,   loading: lIns, reload: rIns } = useData(getInsumos)
  const { data: embalagens, loading: lEmb, reload: rEmb } = useData(getEmbalagens)
  const { data: produtos,   loading: lProd, reload: rProd } = useData(getProdutos)

  const withReload = (fn, reload) => async (...args) => { await fn(...args); reload(); show('Salvo!') }

  const insActions = {
    save: withReload(saveInsumo, rIns),
    del: withReload(deleteInsumo, rIns),
  }
  const embActions = {
    save: withReload(saveEmbalagem, rEmb),
    del: withReload(deleteEmbalagem, rEmb),
  }
  const prodActions = {
    save: withReload(saveProduto, rProd),
    del: withReload(deleteProduto, rProd),
  }

  const loading = { insumos: lIns, embalagens: lEmb, produtos: lProd }[tab]

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Cadastros</div>
      </div>

      <div className="page" style={{ padding: '16px' }}>
        <div className="tab-bar">
          <button className={`tab-btn ${tab === 'insumos' ? 'active' : ''}`} onClick={() => setTab('insumos')}>Insumos</button>
          <button className={`tab-btn ${tab === 'embalagens' ? 'active' : ''}`} onClick={() => setTab('embalagens')}>Embalagens</button>
          <button className={`tab-btn ${tab === 'produtos' ? 'active' : ''}`} onClick={() => setTab('produtos')}>Produtos</button>
        </div>

        {loading ? (
          <div className="loading">Carregando...</div>
        ) : tab === 'insumos' ? (
          <div className="card card-flush" style={{ padding: '0 14px' }}>
            {(insumos || []).length === 0
              ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Nenhum insumo cadastrado</div>
              : (insumos || []).map(ins => (
                <div key={ins.id} className="list-item" onClick={() => setSheet({ type: 'insumo', item: ins })}>
                  <div>
                    <div className="list-item-name">{ins.nome}</div>
                    <div className="list-item-sub">{ins.categoria} · {ins.unidade}{ins.fornecedor ? ` · ${ins.fornecedor}` : ''}</div>
                  </div>
                  <div className="list-item-right">
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--teal)' }}>{fmtR(ins.custoUnit)}/{ins.unidade}</div>
                    {ins.estoqueAtual !== null && (
                      <div style={{ fontSize: 11, color: ins.estoqueAtual < ins.estoqueMin ? 'var(--alert-text)' : 'var(--text-secondary)', marginTop: 2 }}>
                        {ins.estoqueAtual} {ins.unidade}
                      </div>
                    )}
                  </div>
                </div>
              ))
            }
          </div>
        ) : tab === 'embalagens' ? (
          <div className="card card-flush" style={{ padding: '0 14px' }}>
            {(embalagens || []).length === 0
              ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Nenhuma embalagem cadastrada</div>
              : (embalagens || []).map(emb => (
                <div key={emb.id} className="list-item" onClick={() => setSheet({ type: 'embalagem', item: emb })}>
                  <div>
                    <div className="list-item-name">{emb.nome}</div>
                    <div className="list-item-sub">{emb.categoria}{emb.fornecedor ? ` · ${emb.fornecedor}` : ''}</div>
                  </div>
                  <div className="list-item-right">
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--teal)' }}>{fmtR(emb.custoUnit)}/un</div>
                    {emb.estoqueAtual !== null && (
                      <div style={{ fontSize: 11, color: emb.estoqueAtual < emb.estoqueMin ? 'var(--alert-text)' : 'var(--text-secondary)', marginTop: 2 }}>
                        {emb.estoqueAtual} un
                      </div>
                    )}
                  </div>
                </div>
              ))
            }
          </div>
        ) : (
          <div className="card card-flush" style={{ padding: '0 14px' }}>
            {(produtos || []).length === 0
              ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Nenhum produto cadastrado</div>
              : (produtos || []).map(prod => (
                <div key={prod.id} className="list-item" onClick={() => setSheet({ type: 'produto', item: prod })}>
                  <div>
                    <div className="list-item-name">{prod.nome}</div>
                    <div className="list-item-sub">Custo: {fmtR(prod.custoTotal)}</div>
                  </div>
                  <div className="list-item-right">
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--teal)' }}>
                      {fmtR(prod.precoPraticado || prod.precoSugerido)}
                    </div>
                  </div>
                </div>
              ))
            }
          </div>
        )}
      </div>

      <button
        className="fab"
        onClick={() => setSheet({ type: tab === 'produtos' ? 'produto' : tab === 'embalagens' ? 'embalagem' : 'insumo' })}
      >
        +
      </button>

      {sheet?.type === 'insumo' && (
        <InsumoForm item={sheet.item} onSave={insActions.save} onDelete={insActions.del} onClose={() => setSheet(null)} />
      )}
      {sheet?.type === 'embalagem' && (
        <EmbalagemForm item={sheet.item} onSave={embActions.save} onDelete={embActions.del} onClose={() => setSheet(null)} />
      )}
      {sheet?.type === 'produto' && (
        <ProdutoForm item={sheet.item} onSave={prodActions.save} onDelete={prodActions.del} onClose={() => setSheet(null)} />
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
