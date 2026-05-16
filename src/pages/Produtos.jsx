import { useState, useMemo } from 'react'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { getConfig, calcPrecos } from '../hooks/useConfig'
import {
  getProdutos, saveProduto, deleteProduto,
  getReceitas, getEmbalagens,
} from '../services/db'

const PLAT_COLOR  = { Direta: 'var(--teal)', '99Food': '#f59e0b', iFood: '#ef4444' }
const TIPO_LABELS = { produto: 'Produzido', avulso: 'Avulso', combo: 'Combo' }
const TIPO_BADGE  = { produto: null, avulso: { bg: '#334155', color: '#94a3b8', label: 'Avulso' }, combo: { bg: '#1e3a5f', color: '#60a5fa', label: 'Combo' } }

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

function fmtR(val) {
  if (!val && val !== 0) return '—'
  const rounded = Math.ceil(Number(val) * 100) / 100
  return `R$ ${rounded.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function TipoBadge({ tipo }) {
  const b = TIPO_BADGE[tipo]
  if (!b) return null
  return <span style={{ marginLeft: 6, fontSize: 10, background: b.bg, color: b.color, borderRadius: 4, padding: '1px 5px', verticalAlign: 'middle' }}>{b.label}</span>
}

const FORM_EMPTY = { nome: '', tipo: 'produto', custoDireto: '', fornecedor: '', whatsapp: '', linkCompra: '', precoDireta: '', preco99: '', precoIfood: '', estoqueMin: '' }

function ProdutoForm({ item, receitas, embalagens, produtos, onSave, onDelete, onClose }) {
  const [form, setForm] = useState(item
    ? {
        nome:        item.nome,
        tipo:        item.tipo        || 'produto',
        custoDireto: item.custoDireto ?? '',
        fornecedor:  item.fornecedor  || '',
        whatsapp:    item.whatsapp    || '',
        linkCompra:  item.linkCompra  || '',
        precoDireta: item.precoDireta ?? '',
        preco99:     item.preco99     ?? '',
        precoIfood:  item.precoIfood  ?? '',
        estoqueMin:  item.estoqueMin  ?? '',
      }
    : { ...FORM_EMPTY }
  )

  const [recRows, setRecRows] = useState(
    item?.receitas?.length > 0
      ? item.receitas.map(r => ({ receitaId: r.receitaId, nome: r.nome, quantidade: r.quantidade, unidade: r.unidadeGera || 'un', custoUnid: r.custoUnid }))
      : [{ receitaId: null, nome: '', quantidade: 1, unidade: 'un', custoUnid: 0 }]
  )
  const [embRows, setEmbRows] = useState(
    item?.embalagens?.length > 0
      ? item.embalagens.map(e => ({ embalagemId: e.embalagemId, nome: e.nome, quantidade: e.quantidade, custoUnit: e.custoUnit }))
      : [{ embalagemId: null, nome: '', quantidade: 1, custoUnit: 0 }]
  )
  const [comboRows, setComboRows] = useState(
    item?.componentes?.length > 0
      ? item.componentes.map(c => ({ produtoId: c.produtoId, nome: c.produtoNome, quantidade: c.quantidade, custoUnit: c.custoUnit }))
      : [{ produtoId: null, nome: '', quantidade: 1, custoUnit: 0 }]
  )
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const isAvulso = form.tipo === 'avulso'
  const isCombo  = form.tipo === 'combo'

  // ── Receita rows ────────────────────────────────────────────
  const handleRecSelect = (i, nome) => {
    const rec = receitas?.find(r => r.nome === nome)
    setRecRows(prev => prev.map((row, idx) => idx === i ? { ...row, nome, receitaId: rec?.id ?? null, custoUnid: rec?.custoUnid || 0, unidade: rec?.unidadeGera || row.unidade } : row))
  }
  const setRecField = (i, k, v) => setRecRows(prev => prev.map((row, idx) => idx === i ? { ...row, [k]: v } : row))
  const addRec    = () => setRecRows(prev => [...prev, { receitaId: null, nome: '', quantidade: 1, unidade: 'un', custoUnid: 0 }])
  const removeRec = i  => setRecRows(prev => prev.filter((_, idx) => idx !== i))

  // ── Embalagem rows ──────────────────────────────────────────
  const handleEmbSelect = (i, nome) => {
    const emb = embalagens?.find(e => e.nome === nome)
    setEmbRows(prev => prev.map((row, idx) => idx === i ? { ...row, nome, embalagemId: emb?.id ?? null, custoUnit: emb?.custoUnit || 0 } : row))
  }
  const setEmbField = (i, k, v) => setEmbRows(prev => prev.map((row, idx) => idx === i ? { ...row, [k]: v } : row))
  const addEmb    = () => setEmbRows(prev => [...prev, { embalagemId: null, nome: '', quantidade: 1, custoUnit: 0 }])
  const removeEmb = i  => setEmbRows(prev => prev.filter((_, idx) => idx !== i))

  // ── Combo rows ──────────────────────────────────────────────
  const handleComboSelect = (i, nome) => {
    const prod = produtos?.find(p => p.nome === nome && p.id !== item?.id)
    setComboRows(prev => prev.map((row, idx) => idx === i ? { ...row, nome, produtoId: prod?.id ?? null, custoUnit: prod?.custoTotal || 0 } : row))
  }
  const setComboField = (i, k, v) => setComboRows(prev => prev.map((row, idx) => idx === i ? { ...row, [k]: v } : row))
  const addCombo    = () => setComboRows(prev => [...prev, { produtoId: null, nome: '', quantidade: 1, custoUnit: 0 }])
  const removeCombo = i  => setComboRows(prev => prev.filter((_, idx) => idx !== i))

  // ── Custo total ─────────────────────────────────────────────
  const custoTotal = useMemo(() => {
    if (isAvulso) return parseFloat(form.custoDireto) || 0
    if (isCombo)  return comboRows.reduce((s, r) => s + (r.custoUnit || 0) * (parseFloat(r.quantidade) || 1), 0)
    const rec = recRows.reduce((s, r) => s + (r.custoUnid || 0) * (parseFloat(r.quantidade) || 1), 0)
    const emb = embRows.reduce((s, e) => s + (e.custoUnit || 0) * (parseFloat(e.quantidade) || 1), 0)
    return rec + emb
  }, [form.custoDireto, recRows, embRows, comboRows, isAvulso, isCombo])

  const cfg    = getConfig()
  const precos = calcPrecos(custoTotal, cfg)

  const platFields = [
    { key: 'precoDireta', label: 'Direta',  sugerido: precos.base,   color: PLAT_COLOR.Direta    },
    { key: 'preco99',     label: '99Food',  sugerido: precos.p99,    color: PLAT_COLOR['99Food'] },
    { key: 'precoIfood',  label: 'iFood',   sugerido: precos.pIfood, color: PLAT_COLOR.iFood     },
  ]

  const handle = async () => {
    if (!form.nome) return
    setSaving(true)
    try {
      const recItems   = isAvulso || isCombo ? [] : recRows.filter(r => r.receitaId)
      const embItems   = isAvulso || isCombo ? [] : embRows.filter(e => e.embalagemId)
      const componentes = isCombo ? comboRows.filter(r => r.produtoId) : []
      await onSave({ ...form, id: item?.id, precoSugerido: precos.base, componentes }, recItems, embItems)
      onClose()
    } catch (e) { alert(e.message) } finally { setSaving(false) }
  }

  return (
    <Sheet title={item ? 'Editar produto' : 'Novo produto'} onClose={onClose}>
      <div className="field-label">Nome *</div>
      <input className="field-input" placeholder="ex: Choux Craquelin" value={form.nome} onChange={e => set('nome', e.target.value)} />

      {/* ── Tipo toggle ───────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {Object.entries(TIPO_LABELS).map(([val, label]) => (
          <button key={val} onClick={() => set('tipo', val)} style={{
            flex: 1, padding: '7px 0', borderRadius: 8, fontSize: 13, cursor: 'pointer',
            border: `1px solid ${form.tipo === val ? 'var(--teal)' : 'var(--border)'}`,
            background: form.tipo === val ? 'var(--teal-light)' : 'transparent',
            color: form.tipo === val ? 'var(--teal)' : 'var(--text-secondary)',
            fontWeight: form.tipo === val ? 600 : 400,
          }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Avulso ───────────────────────────────────────── */}
      {isAvulso && (
        <>
          <div className="field-label">Custo de aquisição (R$/un)</div>
          <input className="field-input" type="number" inputMode="decimal" min="0" step="0.10" placeholder="ex: 3.50"
            value={form.custoDireto} onChange={e => set('custoDireto', e.target.value)} />

          <div className="field-label">Fornecedor</div>
          <input className="field-input" placeholder="Nome do fornecedor" value={form.fornecedor} onChange={e => set('fornecedor', e.target.value)} />

          <div className="field-row">
            <div>
              <div className="field-label">WhatsApp</div>
              <input className="field-input" placeholder="11 99999-9999" value={form.whatsapp} onChange={e => set('whatsapp', e.target.value)} />
            </div>
            <div>
              <div className="field-label">Link de compra</div>
              <input className="field-input" placeholder="https://..." value={form.linkCompra} onChange={e => set('linkCompra', e.target.value)} />
            </div>
          </div>
        </>
      )}

      {/* ── Combo ─────────────────────────────────────────── */}
      {isCombo && (
        <>
          <div className="section-label" style={{ marginTop: 4 }}>Componentes do combo</div>
          <div className="card card-flush" style={{ padding: '0 14px', marginBottom: 4 }}>
            {comboRows.map((row, i) => {
              const lineCost = (row.custoUnit || 0) * (parseFloat(row.quantidade) || 1)
              return (
                <div key={i} style={{ padding: '6px 0', borderBottom: i < comboRows.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      className="field-input"
                      style={{ flex: '1 1 140px', minWidth: 100, marginBottom: 0, fontSize: 13 }}
                      list="combo-prod-list"
                      placeholder="Produto"
                      value={row.nome}
                      onChange={e => handleComboSelect(i, e.target.value)}
                    />
                    <input className="item-qty" type="number" inputMode="decimal" min="1" step="1" placeholder="Qtd"
                      value={row.quantidade} onChange={e => setComboField(i, 'quantidade', e.target.value)} />
                    {comboRows.length > 1 && <button className="item-rm" onClick={() => removeCombo(i)}>&#215;</button>}
                  </div>
                  {lineCost > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--teal)', paddingTop: 2, paddingLeft: 2 }}>
                      {fmtR(row.custoUnit)}/un × {row.quantidade} = <strong>{fmtR(lineCost)}</strong>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <datalist id="combo-prod-list">
            {(produtos || []).filter(p => p.id !== item?.id).map(p => <option key={p.id} value={p.nome} />)}
          </datalist>
          <button className="btn-add-item" onClick={addCombo}>+ produto</button>
        </>
      )}

      {/* ── Produzido: receitas + embalagens ─────────────── */}
      {!isAvulso && !isCombo && (
        <>
          <div className="section-label" style={{ marginTop: 4 }}>Composição — Receitas</div>
          <div className="card card-flush" style={{ padding: '0 14px', marginBottom: 4 }}>
            {recRows.map((row, i) => {
              const lineCost = (row.custoUnid || 0) * (parseFloat(row.quantidade) || 1)
              return (
                <div key={i} style={{ padding: '6px 0', borderBottom: i < recRows.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input className="field-input" style={{ flex: '1 1 140px', minWidth: 100, marginBottom: 0, fontSize: 13 }}
                      list="receitas-list" placeholder="Receita" value={row.nome} onChange={e => handleRecSelect(i, e.target.value)} />
                    <input className="item-qty" type="number" inputMode="decimal" min="0" step="0.5" placeholder="Qtd"
                      value={row.quantidade} onChange={e => setRecField(i, 'quantidade', e.target.value)} />
                    <input className="item-qty" style={{ width: 52, textAlign: 'left', fontSize: 12 }}
                      placeholder="un" value={row.unidade} onChange={e => setRecField(i, 'unidade', e.target.value)} />
                    {recRows.length > 1 && <button className="item-rm" onClick={() => removeRec(i)}>&#215;</button>}
                  </div>
                  {lineCost > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--teal)', paddingTop: 2, paddingLeft: 2 }}>
                      R$ {row.custoUnid.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}/{row.unidade} × {row.quantidade} = <strong>R$ {lineCost.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</strong>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <datalist id="receitas-list">{(receitas || []).map(r => <option key={r.id} value={r.nome} />)}</datalist>
          <button className="btn-add-item" onClick={addRec}>+ receita</button>

          <div className="section-label" style={{ marginTop: 8 }}>Composição — Embalagens</div>
          <div className="card card-flush" style={{ padding: '0 14px', marginBottom: 4 }}>
            {embRows.map((row, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 0', borderBottom: i < embRows.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <input className="field-input" style={{ flex: 3, marginBottom: 0, fontSize: 13 }}
                  list="embalagens-list" placeholder="Embalagem" value={row.nome} onChange={e => handleEmbSelect(i, e.target.value)} />
                <input className="item-qty" type="number" inputMode="decimal" min="0" step="1" placeholder="Qtd"
                  value={row.quantidade} onChange={e => setEmbField(i, 'quantidade', e.target.value)} />
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 28 }}>un</span>
                {embRows.length > 1 && <button className="item-rm" onClick={() => removeEmb(i)}>&#215;</button>}
              </div>
            ))}
          </div>
          <datalist id="embalagens-list">{(embalagens || []).map(e => <option key={e.id} value={e.nome} />)}</datalist>
          <button className="btn-add-item" onClick={addEmb}>+ embalagem</button>
        </>
      )}

      {/* ── Custo summary + preços ────────────────────────── */}
      {custoTotal > 0 && (
        <div style={{ margin: '12px 0 4px', padding: '10px 14px', background: 'var(--teal-light)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--teal)', marginBottom: 4 }}>
            Custo total: <strong>R$ {custoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Sugerido → <span style={{ color: PLAT_COLOR.Direta }}>Direta {fmtR(precos.base)}</span>
            {' · '}<span style={{ color: PLAT_COLOR['99Food'] }}>99Food {fmtR(precos.p99)}</span>
            {' · '}<span style={{ color: PLAT_COLOR.iFood }}>iFood {fmtR(precos.pIfood)}</span>
          </div>
        </div>
      )}

      <div className="section-label" style={{ marginTop: 10 }}>Preços praticados por plataforma</div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
        Deixe em branco para usar o preço sugerido.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {platFields.map(({ key, label, sugerido, color }) => (
          <div key={key} style={{ flex: 1 }}>
            <div className="field-label" style={{ color, marginBottom: 4 }}>{label}</div>
            <input className="field-input" type="number" inputMode="decimal" min="0" step="0.50"
              placeholder={custoTotal > 0 ? fmtR(sugerido).replace('R$ ', '') : '—'}
              value={form[key]} onChange={e => set(key, e.target.value)} style={{ fontSize: 13 }} />
          </div>
        ))}
      </div>

      <div className="section-label" style={{ marginTop: 10 }}>Estoque mínimo</div>
      <input className="field-input" type="number" inputMode="decimal" min="0" step="1"
        placeholder="ex: 5 (deixe em branco para sem mínimo)"
        value={form.estoqueMin} onChange={e => set('estoqueMin', e.target.value)} />

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

function PlatPrecos({ prod, cfg }) {
  const precos = calcPrecos(prod.custoTotal, cfg)
  return (
    <div style={{ fontSize: 11, marginTop: 2 }}>
      <span style={{ color: PLAT_COLOR.Direta }}>D {fmtR(prod.precoDireta ?? precos.base)}</span>
      {' · '}
      <span style={{ color: PLAT_COLOR['99Food'] }}>99 {fmtR(prod.preco99 ?? precos.p99)}</span>
      {' · '}
      <span style={{ color: PLAT_COLOR.iFood }}>iF {fmtR(prod.precoIfood ?? precos.pIfood)}</span>
    </div>
  )
}

function subtext(prod) {
  if (prod.tipo === 'avulso') return [prod.fornecedor, 'Item avulso'].filter(Boolean).join(' · ')
  if (prod.tipo === 'combo')  return (prod.componentes || []).map(c => `${c.quantidade}× ${c.produtoNome}`).join(' + ') || 'Combo'
  return [
    ...(prod.receitas   || []).map(r => `${r.quantidade} ${r.unidadeGera} ${r.nome}`),
    ...(prod.embalagens || []).map(e => `${e.quantidade}× ${e.nome}`),
  ].join(' · ') || 'Sem composição'
}

export default function Produtos() {
  const [sheet, setSheet] = useState(null)
  const { toast, show }   = useToast()
  const cfg               = getConfig()

  const { data: produtos,   loading: lProd, reload: rProd } = useData(getProdutos)
  const { data: receitas,   loading: lRec  } = useData(getReceitas)
  const { data: embalagens, loading: lEmb  } = useData(getEmbalagens)

  const loading = lProd || lRec || lEmb

  const handleSave = async (prod, recItems, embItems) => {
    await saveProduto(prod, recItems, embItems)
    rProd()
    show('Salvo!')
  }
  const handleDelete = async (id) => {
    await deleteProduto(id)
    rProd()
    show('Excluído!')
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div className="topbar-title">Produtos</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn-outline-teal desktop-only" onClick={() => setSheet({ type: 'produto' })} style={{ fontSize: 13, padding: '6px 14px' }}>
              + Novo produto
            </button>
            <button className="btn-ghost mobile-only" onClick={() => setSheet({ type: 'produto' })} style={{ fontSize: 20, padding: '4px 12px', border: 'none', color: 'var(--teal)' }}>
              +
            </button>
          </div>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 16 }}>
        {loading ? <div className="loading">Carregando...</div> : (
          <>
            {/* Desktop */}
            <div className="desktop-only">
              <div className="card card-flush">
                {(produtos || []).length === 0
                  ? <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Nenhum produto cadastrado</div>
                  : <table className="dt">
                      <thead><tr>
                        <th>Nome</th>
                        <th>Composição</th>
                        <th>Custo</th>
                        <th style={{ color: PLAT_COLOR.Direta }}>Direta</th>
                        <th style={{ color: PLAT_COLOR['99Food'] }}>99Food</th>
                        <th style={{ color: PLAT_COLOR.iFood }}>iFood</th>
                      </tr></thead>
                      <tbody>
                        {(produtos || []).map(prod => {
                          const p = calcPrecos(prod.custoTotal, cfg)
                          return (
                            <tr key={prod.id} onClick={() => setSheet({ type: 'produto', item: prod })}>
                              <td style={{ fontWeight: 600 }}>
                                {prod.nome}<TipoBadge tipo={prod.tipo} />
                              </td>
                              <td className="muted" style={{ fontSize: 12 }}>{subtext(prod)}</td>
                              <td className="muted">{prod.custoTotal > 0 ? fmtR(prod.custoTotal) : '—'}</td>
                              <td style={{ color: PLAT_COLOR.Direta }}>{fmtR(prod.precoDireta ?? p.base)}</td>
                              <td style={{ color: PLAT_COLOR['99Food'] }}>{fmtR(prod.preco99 ?? p.p99)}</td>
                              <td style={{ color: PLAT_COLOR.iFood }}>{fmtR(prod.precoIfood ?? p.pIfood)}</td>
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
              {(produtos || []).length === 0 ? (
                <div className="empty">
                  <span>Nenhum produto cadastrado</span>
                  <button className="btn-outline-teal" style={{ marginTop: 8, maxWidth: 220 }} onClick={() => setSheet({ type: 'produto' })}>
                    + Novo produto
                  </button>
                </div>
              ) : (
                <div className="card card-flush" style={{ padding: '0 14px' }}>
                  {(produtos || []).map(prod => (
                    <div key={prod.id} className="list-item" onClick={() => setSheet({ type: 'produto', item: prod })}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="list-item-name">
                          {prod.nome}<TipoBadge tipo={prod.tipo} />
                        </div>
                        <div className="list-item-sub">{subtext(prod)}</div>
                        <PlatPrecos prod={prod} cfg={cfg} />
                      </div>
                      {prod.custoTotal > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0, textAlign: 'right' }}>
                          custo<br />{fmtR(prod.custoTotal)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <button className="fab mobile-only" onClick={() => setSheet({ type: 'produto' })}>+</button>

      {sheet?.type === 'produto' && (
        <ProdutoForm
          item={sheet.item}
          receitas={receitas}
          embalagens={embalagens}
          produtos={produtos}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setSheet(null)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
