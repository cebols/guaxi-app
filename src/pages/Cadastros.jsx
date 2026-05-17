import { useState, useMemo, useEffect } from 'react'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import {
  getInsumos, saveInsumo, deleteInsumo,
  getEmbalagens, saveEmbalagem, deleteEmbalagem,
  getInsumoFornecedores, saveInsumoFornecedores, getAllInsumoFornecedores,
} from '../services/db'

const UNID_OPTS = ['g', 'ml', 'un', 'kg', 'L', 'cx']

function waLink(phone) {
  const digits = (phone || '').replace(/\D/g, '')
  if (!digits) return null
  return `https://wa.me/55${digits}`
}

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

function CalcBadge({ label, value }) {
  if (!value) return null
  return (
    <div style={{ fontSize: 12, color: 'var(--teal)', marginBottom: 10, padding: '5px 10px', background: 'var(--teal-light)', borderRadius: 6, display: 'inline-block' }}>
      {label}: <strong>R$ {Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 5, maximumFractionDigits: 5 })}</strong>
    </div>
  )
}

// ── Insumos ───────────────────────────────────────────────────

const INSUMO_EMPTY = {
  nome: '', marca: '', categoria: '', unidade: 'g',
  pesoEmb: '', custoEmb: '', pesoUn: '',
  linkCompra: '', estoqueAtual: '', estoqueMin: '',
  fornecedor: '', whatsapp: '',
}

const FONTE_EMPTY = { marca: '', pesoEmb: '', custoEmb: '', fornecedor: '', linkCompra: '', telefone: '' }

function calcCustoUnitInsumo(form) {
  const pesoEmb = parseFloat(form.pesoEmb) || 0
  const custoEmb = parseFloat(form.custoEmb) || 0
  const pesoUn = parseFloat(form.pesoUn) || 0
  if (pesoEmb > 0 && custoEmb > 0) {
    return form.unidade === 'un' && pesoUn > 0
      ? (custoEmb / pesoEmb) / pesoUn
      : custoEmb / pesoEmb
  }
  return null
}

function SupplierFields({ s, i, unidade, onChange, children }) {
  const cu = parseFloat(s.pesoEmb) > 0 && parseFloat(s.custoEmb) > 0
    ? parseFloat(s.custoEmb) / parseFloat(s.pesoEmb) : null
  const upd = (k, v) => onChange(i, k, v)
  return (
    <>
      <div className="field-row">
        <div>
          <div className="field-label">Marca</div>
          <input className="field-input" placeholder="ex: Anaconda" value={s.marca} onChange={e => upd('marca', e.target.value)} />
        </div>
        <div>
          <div className="field-label">Fornecedor</div>
          <input className="field-input" placeholder="Nome" value={s.fornecedor} onChange={e => upd('fornecedor', e.target.value)} />
        </div>
      </div>
      <div className="field-row">
        <div>
          <div className="field-label">{unidade === 'un' ? 'Qtd. emb (un)' : `Peso emb. (${unidade})`}</div>
          <input className="field-input" type="number" inputMode="decimal" min="0" placeholder="ex: 1000" value={s.pesoEmb} onChange={e => upd('pesoEmb', e.target.value)} />
        </div>
        <div>
          <div className="field-label">Custo (R$)</div>
          <input className="field-input" type="number" inputMode="decimal" min="0" placeholder="0,00" value={s.custoEmb} onChange={e => upd('custoEmb', e.target.value)} />
        </div>
      </div>
      {cu !== null && (
        <div style={{ fontSize: 11, color: 'var(--teal)', marginBottom: 6 }}>
          R$ {cu.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}/{unidade}
        </div>
      )}
      <div className="field-label">Link da loja</div>
      <input className="field-input" type="url" placeholder="https://..." value={s.linkCompra} onChange={e => upd('linkCompra', e.target.value)} />
      <div className="field-label">Telefone</div>
      <input className="field-input" type="tel" placeholder="11 9 1234-5678" value={s.telefone} onChange={e => upd('telefone', e.target.value)} />
      {children}
    </>
  )
}

function InsumoForm({ item, categorias, onSave, onDelete, onClose }) {
  const [form, setForm] = useState(item ? {
    ...item,
    marca: item.marca || '',
    pesoEmb: item.pesoEmb || '',
    custoEmb: item.custoEmb || '',
    pesoUn: item.pesoUn ?? '',
    linkCompra: item.linkCompra || '',
    estoqueAtual: item.estoqueAtual ?? '',
    estoqueMin: item.estoqueMin || '',
  } : INSUMO_EMPTY)

  // Edit mode: unified supplier list
  const [suppliers, setSuppliers] = useState([])
  const [primaryIdx, setPrimaryIdx] = useState(0)
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!item?.id) return
    const main = {
      marca: item.marca || '',
      fornecedor: item.fornecedor || '',
      pesoEmb: item.pesoEmb > 0 ? String(item.pesoEmb) : '',
      custoEmb: item.custoEmb > 0 ? String(item.custoEmb) : '',
      linkCompra: item.linkCompra || '',
      telefone: item.whatsapp || '',
    }
    getInsumoFornecedores(item.id)
      .then(fontes => setSuppliers([main, ...fontes.map(f => ({
        marca: f.marca || '',
        fornecedor: f.fornecedor || '',
        pesoEmb: f.pesoEmb > 0 ? String(f.pesoEmb) : '',
        custoEmb: f.custoEmb > 0 ? String(f.custoEmb) : '',
        linkCompra: f.linkCompra || '',
        telefone: f.telefone || '',
      }))]))
      .catch(() => setSuppliers([main]))
  }, [item?.id])

  const custoUnitCalc = calcCustoUnitInsumo(form)
  const pesoUnNum = parseFloat(form.pesoUn) || 0

  const updSup = (i, k, v) => setSuppliers(prev => prev.map((s, idx) => idx === i ? { ...s, [k]: v } : s))
  const removeSup = i => {
    setSuppliers(prev => prev.filter((_, idx) => idx !== i))
    if (primaryIdx >= i && primaryIdx > 0) setPrimaryIdx(p => p - 1)
  }

  const handle = async (keepOpen = false) => {
    if (!form.nome) return
    setSaving(true)
    try {
      if (item) {
        const primary = suppliers[primaryIdx] || suppliers[0] || {}
        const others = suppliers.filter((_, i) => i !== primaryIdx)
        await onSave({
          ...form,
          marca: primary.marca || '',
          fornecedor: primary.fornecedor || '',
          pesoEmb: primary.pesoEmb || '',
          custoEmb: primary.custoEmb || '',
          linkCompra: primary.linkCompra || '',
          whatsapp: primary.telefone || '',
        }, others)
      } else {
        await onSave(form, [])
      }
      if (keepOpen) setForm(INSUMO_EMPTY)
      else onClose()
    } catch (e) { alert(e.message) } finally { setSaving(false) }
  }

  return (
    <Sheet title={item ? 'Editar insumo' : 'Novo insumo'} onClose={onClose}>
      {!item && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>Só o nome é obrigatório — complete o resto quando tiver.</div>}

      <div className="field-label">Nome *</div>
      <input className="field-input" placeholder="ex: Farinha de trigo" value={form.nome} onChange={e => set('nome', e.target.value)} />

      <div className="field-row">
        <div>
          <div className="field-label">Categoria</div>
          <input className="field-input" list="cats-insumo" placeholder="ex: Farinhas" value={form.categoria} onChange={e => set('categoria', e.target.value)} />
          <datalist id="cats-insumo">{(categorias || []).map(c => <option key={c} value={c} />)}</datalist>
        </div>
        <div>
          <div className="field-label">Unidade de uso</div>
          <select className="field-input" value={form.unidade} onChange={e => set('unidade', e.target.value)}>
            {UNID_OPTS.map(u => <option key={u}>{u}</option>)}
          </select>
        </div>
      </div>

      {/* pesoUn is product-level, shown in both modes */}
      {form.unidade === 'un' && (
        <>
          <div className="field-label">Peso por unidade (g) — para calcular custo</div>
          <input className="field-input" type="number" inputMode="decimal" min="0" step="any" placeholder="ex: 50 para ovos de 50g" value={form.pesoUn} onChange={e => set('pesoUn', e.target.value)} />
        </>
      )}

      {/* Create mode: single supplier inline */}
      {!item && (
        <>
          <div className="section-label" style={{ marginTop: 4 }}>Precificação</div>
          <div className="field-row">
            <div>
              <div className="field-label">{form.unidade === 'un' ? 'Qtd. na embalagem (un)' : `Peso/vol. da embalagem (${form.unidade})`}</div>
              <input className="field-input" type="number" inputMode="decimal" min="0" step="any" placeholder="ex: 1000" value={form.pesoEmb} onChange={e => set('pesoEmb', e.target.value)} />
            </div>
            <div>
              <div className="field-label">Custo da embalagem (R$)</div>
              <input className="field-input" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0,00" value={form.custoEmb} onChange={e => set('custoEmb', e.target.value)} />
            </div>
          </div>
          {custoUnitCalc !== null && (
            <CalcBadge label={`Custo por ${form.unidade === 'un' && pesoUnNum > 0 ? 'g' : form.unidade}`} value={custoUnitCalc} />
          )}
          <div className="field-label">Marca</div>
          <input className="field-input" placeholder="ex: Anaconda" value={form.marca} onChange={e => set('marca', e.target.value)} />
          <div className="field-label">Link da loja (Shopee, etc.)</div>
          <input className="field-input" type="url" placeholder="https://shopee.com.br/..." value={form.linkCompra} onChange={e => set('linkCompra', e.target.value)} />
        </>
      )}

      <div className="section-label" style={{ marginTop: 4 }}>Estoque</div>
      <div className="field-row">
        <div>
          <div className="field-label">Estoque atual ({form.unidade})</div>
          <input className="field-input" type="number" inputMode="decimal" min="0" placeholder="—" value={form.estoqueAtual} onChange={e => set('estoqueAtual', e.target.value)} />
        </div>
        <div>
          <div className="field-label">Estoque mínimo ({form.unidade})</div>
          <input className="field-input" type="number" inputMode="decimal" min="0" placeholder="0" value={form.estoqueMin} onChange={e => set('estoqueMin', e.target.value)} />
        </div>
      </div>

      {/* Create mode: fornecedor fields */}
      {!item && (
        <>
          <div className="section-label" style={{ marginTop: 4 }}>Fornecedor</div>
          <input className="field-input" placeholder="Nome do fornecedor" value={form.fornecedor} onChange={e => set('fornecedor', e.target.value)} />
          <div className="field-label">Telefone</div>
          <input className="field-input" type="tel" placeholder="11 9 1234-5678" value={form.whatsapp} onChange={e => set('whatsapp', e.target.value)} />
        </>
      )}

      {/* Edit mode: unified selectable supplier list */}
      {item && suppliers.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 8 }}>Fornecedores</div>
          {suppliers.map((s, i) => {
            const isPrimary = i === primaryIdx
            return (
              <div key={i} style={{
                border: isPrimary ? '2px solid var(--teal)' : '1px solid var(--border)',
                borderRadius: 12, padding: '12px 14px', marginBottom: 10,
                background: isPrimary ? 'rgba(20,184,166,0.06)' : 'var(--card-bg)',
                transition: 'border-color 0.15s',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  {isPrimary ? (
                    <span style={{
                      fontSize: 11, fontWeight: 700, color: 'var(--teal)',
                      background: 'rgba(20,184,166,0.15)', padding: '3px 10px', borderRadius: 10,
                    }}>✓ Prioritário</span>
                  ) : (
                    <button
                      onClick={() => setPrimaryIdx(i)}
                      style={{
                        fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)',
                        background: 'transparent', border: '1px solid var(--border)',
                        padding: '3px 10px', borderRadius: 10, cursor: 'pointer',
                      }}
                    >Definir como prioritário</button>
                  )}
                  {suppliers.length > 1 && (
                    <button className="item-rm" onClick={() => removeSup(i)}>×</button>
                  )}
                </div>
                <SupplierFields s={s} i={i} unidade={form.unidade} onChange={updSup} />
              </div>
            )
          })}
          <button className="btn-add-item" style={{ marginBottom: 12 }} onClick={() => setSuppliers(prev => [...prev, { ...FONTE_EMPTY }])}>
            + novo fornecedor
          </button>
        </>
      )}

      <button className="btn-primary" onClick={() => handle(false)} disabled={saving || !form.nome}>
        {saving ? 'Salvando...' : item ? 'Atualizar' : 'Criar insumo'}
      </button>
      {!item && (
        <button className="btn-outline-teal" onClick={() => handle(true)} disabled={saving || !form.nome}>
          Salvar e adicionar outro
        </button>
      )}
      {item && (
        <button className="btn-danger" onClick={() => { if (confirm('Excluir?')) onDelete(item.id).then(onClose).catch(e => alert(e.message)) }}>
          Excluir
        </button>
      )}
    </Sheet>
  )
}

// ── Embalagens ────────────────────────────────────────────────

const EMB_EMPTY = {
  nome: '', categoria: '', qtdCompra: '', custoCompra: '',
  linkCompra: '', estoqueAtual: '', estoqueMin: '', fornecedor: '', whatsapp: '',
}

function EmbalagemForm({ item, categorias, onSave, onDelete, onClose }) {
  const [form, setForm] = useState(item ? {
    ...item,
    qtdCompra: item.qtdCompra || '',
    custoCompra: item.custoCompra || '',
    linkCompra: item.linkCompra || '',
    estoqueAtual: item.estoqueAtual ?? '',
    estoqueMin: item.estoqueMin || '',
  } : EMB_EMPTY)
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const qtdCompra = parseFloat(form.qtdCompra) || 0
  const custoCompra = parseFloat(form.custoCompra) || 0
  const custoUnitCalc = qtdCompra > 0 ? custoCompra / qtdCompra : null

  const handle = async (keepOpen = false) => {
    if (!form.nome) return
    setSaving(true)
    try {
      await onSave(form)
      if (keepOpen) setForm(EMB_EMPTY)
      else onClose()
    } catch (e) { alert(e.message) } finally { setSaving(false) }
  }

  return (
    <Sheet title={item ? 'Editar embalagem' : 'Nova embalagem'} onClose={onClose}>
      {!item && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>Só o nome é obrigatório — complete o resto quando tiver.</div>}
      <div className="field-label">Nome *</div>
      <input className="field-input" placeholder="ex: Caixinha 15×15cm" value={form.nome} onChange={e => set('nome', e.target.value)} />

      <div className="field-label">Categoria</div>
      <input className="field-input" list="cats-embalagem" placeholder="ex: Caixas" value={form.categoria} onChange={e => set('categoria', e.target.value)} />
      <datalist id="cats-embalagem">{(categorias || []).map(c => <option key={c} value={c} />)}</datalist>

      <div className="section-label" style={{ marginTop: 4 }}>Precificação</div>
      <div className="field-row">
        <div>
          <div className="field-label">Qtd. na compra (un)</div>
          <input className="field-input" type="number" inputMode="decimal" min="1" step="1" placeholder="ex: 10" value={form.qtdCompra} onChange={e => set('qtdCompra', e.target.value)} />
        </div>
        <div>
          <div className="field-label">Custo da compra (R$)</div>
          <input className="field-input" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0,00" value={form.custoCompra} onChange={e => set('custoCompra', e.target.value)} />
        </div>
      </div>

      {custoUnitCalc !== null && <CalcBadge label="Custo por unidade" value={custoUnitCalc} />}

      <div className="field-label">Link da Shopee / loja</div>
      <input className="field-input" type="url" placeholder="https://shopee.com.br/..." value={form.linkCompra} onChange={e => set('linkCompra', e.target.value)} />

      <div className="section-label" style={{ marginTop: 4 }}>Estoque</div>
      <div className="field-row">
        <div>
          <div className="field-label">Estoque atual (un)</div>
          <input className="field-input" type="number" inputMode="decimal" min="0" placeholder="—" value={form.estoqueAtual} onChange={e => set('estoqueAtual', e.target.value)} />
        </div>
        <div>
          <div className="field-label">Estoque mínimo (un)</div>
          <input className="field-input" type="number" inputMode="decimal" min="0" placeholder="0" value={form.estoqueMin} onChange={e => set('estoqueMin', e.target.value)} />
        </div>
      </div>

      <div className="section-label" style={{ marginTop: 4 }}>Fornecedor</div>
      <input className="field-input" placeholder="Nome do fornecedor" value={form.fornecedor} onChange={e => set('fornecedor', e.target.value)} />
      <div className="field-label">Telefone</div>
      <input className="field-input" type="tel" placeholder="11 9 1234-5678" value={form.whatsapp} onChange={e => set('whatsapp', e.target.value)} />

      <button className="btn-primary" onClick={() => handle(false)} disabled={saving || !form.nome}>
        {saving ? 'Salvando...' : item ? 'Atualizar' : 'Criar embalagem'}
      </button>
      {!item && (
        <button className="btn-outline-teal" onClick={() => handle(true)} disabled={saving || !form.nome}>
          Salvar e adicionar outro
        </button>
      )}
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
  const [sheet, setSheet] = useState(null)
  const { toast, show } = useToast()

  const { data: insumos,    loading: lIns, reload: rIns } = useData(getInsumos)
  const { data: embalagens, loading: lEmb, reload: rEmb } = useData(getEmbalagens)
  const { data: todasFontes, reload: rFontes } = useData(getAllInsumoFornecedores)

  const fontesMap = useMemo(() => {
    const map = {}
    for (const f of todasFontes || []) {
      if (!map[f.insumoId]) map[f.insumoId] = []
      map[f.insumoId].push(f)
    }
    return map
  }, [todasFontes])

  const catsInsumo = useMemo(() =>
    [...new Set((insumos || []).map(i => i.categoria).filter(Boolean))].sort(),
    [insumos]
  )

  const fornecedores = useMemo(() => {
    const map = {}
    ;[...(insumos || []), ...(embalagens || [])].forEach(i => {
      if (i.fornecedor && !map[i.fornecedor]) {
        map[i.fornecedor] = { nome: i.fornecedor, whatsapp: i.whatsapp || '' }
      }
    })
    return Object.values(map).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [insumos, embalagens])

  const catsEmbalagem = useMemo(() =>
    [...new Set((embalagens || []).map(e => e.categoria).filter(Boolean))].sort(),
    [embalagens]
  )

  const withReload = (fn, reload) => async (...args) => { await fn(...args); reload(); show('Salvo!') }

  const insActions = {
    save: async (form, fontes) => {
      const data = await saveInsumo(form)
      if (fontes?.length > 0 || (form.id && fontes)) {
        await saveInsumoFornecedores(data.id, fontes || [], calcCustoUnitInsumo(form) || 0)
      }
      rIns(); rFontes(); show('Salvo!')
    },
    del: withReload(deleteInsumo, rIns),
    swapPrimary: async (ins, selectedIdx) => {
      const fontes = fontesMap[ins.id] || []
      const all = [
        { marca: ins.marca || '', fornecedor: ins.fornecedor || '', pesoEmb: ins.pesoEmb > 0 ? String(ins.pesoEmb) : '', custoEmb: ins.custoEmb > 0 ? String(ins.custoEmb) : '', linkCompra: ins.linkCompra || '', telefone: ins.whatsapp || '' },
        ...fontes.map(f => ({ marca: f.marca || '', fornecedor: f.fornecedor || '', pesoEmb: f.pesoEmb > 0 ? String(f.pesoEmb) : '', custoEmb: f.custoEmb > 0 ? String(f.custoEmb) : '', linkCompra: f.linkCompra || '', telefone: f.telefone || '' })),
      ]
      const primary = all[selectedIdx]
      const others = all.filter((_, i) => i !== selectedIdx)
      const formWithPrimary = { ...ins, marca: primary.marca, fornecedor: primary.fornecedor, pesoEmb: primary.pesoEmb, custoEmb: primary.custoEmb, linkCompra: primary.linkCompra, whatsapp: primary.telefone }
      await saveInsumo(formWithPrimary)
      await saveInsumoFornecedores(ins.id, others, calcCustoUnitInsumo(formWithPrimary) || 0)
      rIns(); rFontes(); show('Prioritário atualizado!')
    },
  }
  const embActions = { save: withReload(saveEmbalagem, rEmb), del: withReload(deleteEmbalagem, rEmb) }

  const loading = tab === 'insumos' ? lIns : lEmb
  const openNew = () => setSheet({ type: tab === 'embalagens' ? 'embalagem' : 'insumo' })

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div className="topbar-title">Insumos &amp; Embalagens</div>
          <button
            className="btn-ghost"
            onClick={openNew}
            style={{ fontSize: 20, padding: '4px 12px', border: 'none', color: 'var(--teal)' }}
          >+</button>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 16 }}>
        <div className="tab-bar">
          <button className={`tab-btn ${tab === 'insumos'    ? 'active' : ''}`} onClick={() => setTab('insumos')}>Insumos</button>
          <button className={`tab-btn ${tab === 'embalagens' ? 'active' : ''}`} onClick={() => setTab('embalagens')}>Embalagens</button>
        </div>

        {loading ? (
          <div className="loading">Carregando...</div>
        ) : tab === 'insumos' ? (
          <>
            {/* Desktop */}
            <div className="desktop-only">
              <div className="card card-flush">
                {(insumos || []).length === 0
                  ? <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Nenhum insumo cadastrado</div>
                  : <table className="dt">
                      <thead><tr>
                        <th>Nome</th><th>Marca</th><th>Categoria</th>
                        <th>Emb.</th><th>Custo emb.</th><th>Custo/un</th>
                        <th>Estoque</th><th>Fornecedor</th><th></th>
                      </tr></thead>
                      <tbody>
                        {(insumos || []).map(ins => {
                          const fontes = fontesMap[ins.id] || []
                          const fornecedorLabel = ins.fornecedor || '—'
                          const marcaLabel = ins.marca || '—'
                          const allOpts = [
                            { marca: ins.marca || '', fornecedor: ins.fornecedor || '' },
                            ...fontes.map(f => ({ marca: f.marca || '', fornecedor: f.fornecedor || '' })),
                          ]
                          return (
                            <tr key={ins.id} onClick={() => setSheet({ type: 'insumo', item: ins })}>
                              <td style={{ fontWeight: 600 }}>{ins.nome}</td>
                              <td className="muted">{marcaLabel}</td>
                              <td className="muted">{ins.categoria || '—'}</td>
                              <td className="muted">{ins.pesoEmb > 0 ? `${ins.pesoEmb} ${ins.unidade}` : '—'}</td>
                              <td className="muted">{fmtR(ins.custoEmb)}</td>
                              <td className="teal">{ins.custoUnit > 0 ? `R$ ${ins.custoUnit.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}` : '—'}</td>
                              <td>
                                {ins.estoqueAtual !== null && ins.estoqueAtual !== undefined
                                  ? <span style={{ color: ins.estoqueAtual < ins.estoqueMin ? 'var(--alert-text)' : 'var(--ok-text)', fontWeight: 600, fontSize: 13 }}>
                                      {ins.estoqueAtual} {ins.unidade}
                                    </span>
                                  : <span className="muted">—</span>}
                              </td>
                              <td onClick={e => e.stopPropagation()}>
                                {allOpts.length > 1 ? (
                                  <select
                                    value={0}
                                    onChange={e => insActions.swapPrimary(ins, parseInt(e.target.value))}
                                    style={{ fontSize: 12, background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-secondary)', padding: '2px 4px', cursor: 'pointer' }}
                                  >
                                    {allOpts.map((o, i) => (
                                      <option key={i} value={i}>
                                        {[o.marca, o.fornecedor].filter(Boolean).join(' · ') || '—'}
                                        {i === 0 ? ' ✓' : ''}
                                      </option>
                                    ))}
                                  </select>
                                ) : <span className="muted">{fornecedorLabel}</span>}
                              </td>
                              <td onClick={e => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                                {ins.linkCompra && (
                                  <a href={ins.linkCompra} target="_blank" rel="noreferrer"
                                    style={{ fontSize: 11, color: 'var(--teal)', textDecoration: 'none', marginRight: 8 }}>Loja</a>
                                )}
                                {waLink(ins.whatsapp) && (
                                  <a href={waLink(ins.whatsapp)} target="_blank" rel="noreferrer"
                                    style={{ fontSize: 11, color: 'var(--teal)', textDecoration: 'none' }}>WA</a>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                }
              </div>
            </div>

            {/* Mobile */}
            <div className="mobile-only">
              <div className="card card-flush" style={{ padding: '0 14px' }}>
                {(insumos || []).length === 0
                  ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Nenhum insumo cadastrado</div>
                  : (insumos || []).map(ins => {
                    const fontes = fontesMap[ins.id] || []
                    const allOpts = [
                      { marca: ins.marca || '', fornecedor: ins.fornecedor || '' },
                      ...fontes.map(f => ({ marca: f.marca || '', fornecedor: f.fornecedor || '' })),
                    ]
                    const hasMany = allOpts.length > 1
                    return (
                      <div key={ins.id} className="list-item" onClick={() => setSheet({ type: 'insumo', item: ins })}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="list-item-name">{ins.nome}</div>
                          <div className="list-item-sub">
                            {ins.pesoEmb > 0 ? `${ins.pesoEmb}${ins.unidade}` : ins.categoria || ''}
                          </div>
                          {hasMany ? (
                            <select
                              value={0}
                              onClick={e => e.stopPropagation()}
                              onChange={e => { e.stopPropagation(); insActions.swapPrimary(ins, parseInt(e.target.value)) }}
                              style={{
                                marginTop: 4, fontSize: 11, padding: '2px 6px', borderRadius: 8,
                                border: '1px solid var(--border)', background: 'var(--card-bg)',
                                color: 'var(--text-secondary)', cursor: 'pointer', maxWidth: 180,
                              }}
                            >
                              {allOpts.map((o, i) => (
                                <option key={i} value={i}>
                                  {[o.marca, o.fornecedor].filter(Boolean).join(' · ') || '—'}
                                  {i === 0 ? ' ✓' : ''}
                                </option>
                              ))}
                            </select>
                          ) : (ins.marca || ins.fornecedor) ? (
                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                              {[ins.marca, ins.fornecedor].filter(Boolean).join(' · ')}
                            </div>
                          ) : null}
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 10 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--teal)' }}>
                            {ins.custoUnit > 0 ? `R$ ${ins.custoUnit.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}/${ins.unidade}` : '—'}
                          </div>
                          {ins.linkCompra && (
                            <a href={ins.linkCompra} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                              style={{ fontSize: 11, color: 'var(--teal)', textDecoration: 'none' }}>Loja</a>
                          )}
                        </div>
                      </div>
                    )
                  })
                }
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Desktop */}
            <div className="desktop-only">
              <div className="card card-flush">
                {(embalagens || []).length === 0
                  ? <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Nenhuma embalagem cadastrada</div>
                  : <table className="dt">
                      <thead><tr>
                        <th>Nome</th><th>Categoria</th><th>Qtd compra</th>
                        <th>Custo compra</th><th>Custo unit.</th><th>Estoque</th><th>Fornecedor</th><th></th>
                      </tr></thead>
                      <tbody>
                        {(embalagens || []).map(emb => (
                          <tr key={emb.id} onClick={() => setSheet({ type: 'embalagem', item: emb })}>
                            <td style={{ fontWeight: 600 }}>
                              {emb.linkCompra
                                ? <a href={emb.linkCompra} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: 'var(--text-primary)', textDecoration: 'underline dotted' }}>{emb.nome}</a>
                                : emb.nome}
                            </td>
                            <td className="muted">{emb.categoria || '—'}</td>
                            <td className="muted">{emb.qtdCompra > 0 ? `${emb.qtdCompra} un` : '—'}</td>
                            <td className="muted">{fmtR(emb.custoCompra)}</td>
                            <td className="teal">{fmtR(emb.custoUnit)}</td>
                            <td>
                              {emb.estoqueAtual !== null && emb.estoqueAtual !== undefined
                                ? <span style={{ color: emb.estoqueAtual < emb.estoqueMin ? 'var(--alert-text)' : 'var(--ok-text)', fontWeight: 600, fontSize: 13 }}>
                                    {emb.estoqueAtual} un
                                  </span>
                                : <span className="muted">—</span>}
                            </td>
                            <td className="muted">{emb.fornecedor || '—'}</td>
                            <td onClick={e => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                              {waLink(emb.whatsapp) && (
                                <a href={waLink(emb.whatsapp)} target="_blank" rel="noreferrer"
                                  style={{ fontSize: 11, color: 'var(--teal)', textDecoration: 'none' }}>WA</a>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                }
              </div>
            </div>

            {/* Mobile */}
            <div className="mobile-only">
              <div className="card card-flush" style={{ padding: '0 14px' }}>
                {(embalagens || []).length === 0
                  ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Nenhuma embalagem cadastrada</div>
                  : (embalagens || []).map(emb => (
                    <div key={emb.id} className="list-item" onClick={() => setSheet({ type: 'embalagem', item: emb })}>
                      <div>
                        <div className="list-item-name">{emb.nome}</div>
                        <div className="list-item-sub">{emb.categoria}{emb.fornecedor ? ` · ${emb.fornecedor}` : ''}</div>
                      </div>
                      <div className="list-item-right" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--teal)' }}>{fmtR(emb.custoUnit)}/un</div>
                        {emb.linkCompra && (
                          <a href={emb.linkCompra} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                            style={{ fontSize: 11, color: 'var(--teal)', textDecoration: 'none' }}>Shopee</a>
                        )}
                        {waLink(emb.whatsapp) && (
                          <a href={waLink(emb.whatsapp)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                            style={{ fontSize: 11, color: 'var(--teal)', textDecoration: 'none' }}>WhatsApp</a>
                        )}
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>
          </>
        )}
      </div>

      <button className="fab mobile-only" onClick={openNew}>+</button>

      {sheet?.type === 'insumo' && (
        <InsumoForm item={sheet.item} categorias={catsInsumo} onSave={insActions.save} onDelete={insActions.del} onClose={() => setSheet(null)} />
      )}
      {sheet?.type === 'embalagem' && (
        <EmbalagemForm item={sheet.item} categorias={catsEmbalagem} onSave={embActions.save} onDelete={embActions.del} onClose={() => setSheet(null)} />
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
