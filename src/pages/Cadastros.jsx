import { useState, useMemo } from 'react'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import {
  getInsumos, saveInsumo, deleteInsumo,
  getEmbalagens, saveEmbalagem, deleteEmbalagem,
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
  nome: '', categoria: '', unidade: 'g',
  pesoEmb: '', custoEmb: '', pesoUn: '',
  linkCompra: '',
  estoqueAtual: '', estoqueMin: '',
  fornecedor: '', whatsapp: '',
}

function InsumoForm({ item, categorias, fornecedores, onSave, onDelete, onClose }) {
  const [form, setForm] = useState(item ? {
    ...item,
    pesoEmb: item.pesoEmb || '',
    custoEmb: item.custoEmb || '',
    pesoUn: item.pesoUn ?? '',
    linkCompra: item.linkCompra || '',
    estoqueAtual: item.estoqueAtual ?? '',
    estoqueMin: item.estoqueMin || '',
  } : INSUMO_EMPTY)
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const pesoEmb = parseFloat(form.pesoEmb) || 0
  const custoEmb = parseFloat(form.custoEmb) || 0
  const pesoUn = parseFloat(form.pesoUn) || 0
  let custoUnitCalc = null
  if (pesoEmb > 0 && custoEmb > 0) {
    if (form.unidade === 'un' && pesoUn > 0) {
      custoUnitCalc = (custoEmb / pesoEmb) / pesoUn
    } else {
      custoUnitCalc = custoEmb / pesoEmb
    }
  }

  const handle = async (keepOpen = false) => {
    if (!form.nome) return
    setSaving(true)
    try {
      await onSave(form)
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
          <input
            className="field-input"
            list="cats-insumo"
            placeholder="ex: Farinhas"
            value={form.categoria}
            onChange={e => set('categoria', e.target.value)}
          />
          <datalist id="cats-insumo">
            {(categorias || []).map(c => <option key={c} value={c} />)}
          </datalist>
        </div>
        <div>
          <div className="field-label">Unidade de uso</div>
          <select className="field-input" value={form.unidade} onChange={e => set('unidade', e.target.value)}>
            {UNID_OPTS.map(u => <option key={u}>{u}</option>)}
          </select>
        </div>
      </div>

      <div className="section-label" style={{ marginTop: 4 }}>Precificação</div>

      <div className="field-row">
        <div>
          <div className="field-label">
            {form.unidade === 'un' ? 'Qtd. na embalagem (un)' : `Peso/vol. da embalagem (${form.unidade})`}
          </div>
          <input className="field-input" type="number" inputMode="decimal" min="0" step="any" placeholder="ex: 1000" value={form.pesoEmb} onChange={e => set('pesoEmb', e.target.value)} />
        </div>
        <div>
          <div className="field-label">Custo da embalagem (R$)</div>
          <input className="field-input" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0,00" value={form.custoEmb} onChange={e => set('custoEmb', e.target.value)} />
        </div>
      </div>

      {form.unidade === 'un' && (
        <>
          <div className="field-label">Peso por unidade (g) — para calcular custo</div>
          <input className="field-input" type="number" inputMode="decimal" min="0" step="any" placeholder="ex: 50 para ovos de 50g" value={form.pesoUn} onChange={e => set('pesoUn', e.target.value)} />
        </>
      )}

      {custoUnitCalc !== null && (
        <CalcBadge
          label={`Custo por ${form.unidade === 'un' && pesoUn > 0 ? 'g' : form.unidade}`}
          value={custoUnitCalc}
        />
      )}

      <div className="field-label">Link da loja (Shopee, etc.)</div>
      <input className="field-input" type="url" placeholder="https://shopee.com.br/..." value={form.linkCompra} onChange={e => set('linkCompra', e.target.value)} />

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

      <div className="section-label" style={{ marginTop: 4 }}>Fornecedor</div>
      <input
        className="field-input"
        list="fornecedores-list"
        placeholder="Nome do fornecedor"
        value={form.fornecedor}
        onChange={e => {
          const nome = e.target.value
          set('fornecedor', nome)
          const known = (fornecedores || []).find(f => f.nome === nome)
          if (known?.whatsapp && !form.whatsapp) set('whatsapp', known.whatsapp)
        }}
      />
      <datalist id="fornecedores-list">
        {(fornecedores || []).map(f => <option key={f.nome} value={f.nome} />)}
      </datalist>
      <div className="field-label">WhatsApp <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>(DDD + número, sem +55)</span></div>
      <input className="field-input" type="tel" placeholder="11 9 1234-5678" value={form.whatsapp} onChange={e => set('whatsapp', e.target.value)} />

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
      <input
        className="field-input"
        list="cats-embalagem"
        placeholder="ex: Caixas"
        value={form.categoria}
        onChange={e => set('categoria', e.target.value)}
      />
      <datalist id="cats-embalagem">
        {(categorias || []).map(c => <option key={c} value={c} />)}
      </datalist>

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

      {custoUnitCalc !== null && (
        <CalcBadge label="Custo por unidade" value={custoUnitCalc} />
      )}

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
      <div className="field-label">WhatsApp <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>(DDD + número, sem +55)</span></div>
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

  const insActions = { save: withReload(saveInsumo, rIns), del: withReload(deleteInsumo, rIns) }
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
          >
            +
          </button>
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
            <div className="desktop-only">
              <div className="card card-flush">
                {(insumos || []).length === 0
                  ? <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Nenhum insumo cadastrado</div>
                  : <table className="dt">
                      <thead><tr>
                        <th>Nome</th><th>Categoria</th><th>Unidade</th>
                        <th>Emb.</th><th>Custo emb.</th><th>Custo/un</th>
                        <th>Estoque</th><th>Fornecedor</th><th></th>
                      </tr></thead>
                      <tbody>
                        {(insumos || []).map(ins => (
                          <tr key={ins.id} onClick={() => setSheet({ type: 'insumo', item: ins })}>
                            <td style={{ fontWeight: 600 }}>{ins.nome}</td>
                            <td className="muted">{ins.categoria || '—'}</td>
                            <td className="muted">{ins.unidade}</td>
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
                            <td className="muted">{ins.fornecedor || '—'}</td>
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
                        ))}
                      </tbody>
                    </table>
                }
              </div>
            </div>
            <div className="mobile-only">
              <div className="card card-flush" style={{ padding: '0 14px' }}>
                {(insumos || []).length === 0
                  ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Nenhum insumo cadastrado</div>
                  : (insumos || []).map(ins => (
                    <div key={ins.id} className="list-item" onClick={() => setSheet({ type: 'insumo', item: ins })}>
                      <div>
                        <div className="list-item-name">{ins.nome}</div>
                        <div className="list-item-sub">{ins.categoria} · {ins.unidade}{ins.fornecedor ? ` · ${ins.fornecedor}` : ''}</div>
                      </div>
                      <div className="list-item-right" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--teal)' }}>
                          {ins.custoUnit > 0 ? `R$ ${ins.custoUnit.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}/${ins.unidade}` : '—'}
                        </div>
                        {ins.linkCompra && (
                          <a href={ins.linkCompra} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                            style={{ fontSize: 11, color: 'var(--teal)', textDecoration: 'none' }}>Loja</a>
                        )}
                        {waLink(ins.whatsapp) && (
                          <a href={waLink(ins.whatsapp)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                            style={{ fontSize: 11, color: 'var(--teal)', textDecoration: 'none' }}>WhatsApp</a>
                        )}
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>
          </>
        ) : (
          <>
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
        <InsumoForm item={sheet.item} categorias={catsInsumo} fornecedores={fornecedores} onSave={insActions.save} onDelete={insActions.del} onClose={() => setSheet(null)} />
      )}
      {sheet?.type === 'embalagem' && (
        <EmbalagemForm item={sheet.item} categorias={catsEmbalagem} onSave={embActions.save} onDelete={embActions.del} onClose={() => setSheet(null)} />
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
