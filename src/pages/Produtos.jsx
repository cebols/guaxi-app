import { useState, useMemo } from 'react'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { getConfig, calcPrecos } from '../hooks/useConfig'
import {
  getProdutos, saveProduto, deleteProduto,
  getReceitas, getEmbalagens,
} from '../services/db'

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

const PROD_EMPTY = { nome: '', precoPraticado: '' }

function ProdutoForm({ item, receitas, embalagens, onSave, onDelete, onClose }) {
  const [form, setForm] = useState(item
    ? { nome: item.nome, precoPraticado: item.precoPraticado ?? '' }
    : { ...PROD_EMPTY }
  )
  const [recRows, setRecRows] = useState(
    item?.receitas?.length > 0
      ? item.receitas.map(r => ({
          receitaId: r.receitaId, nome: r.nome,
          quantidade: r.quantidade, unidade: r.unidadeGera || 'un',
          custoUnid: r.custoUnid,
        }))
      : [{ receitaId: null, nome: '', quantidade: 1, unidade: 'un', custoUnid: 0 }]
  )
  const [embRows, setEmbRows] = useState(
    item?.embalagens?.length > 0
      ? item.embalagens.map(e => ({ embalagemId: e.embalagemId, nome: e.nome, quantidade: e.quantidade, custoUnit: e.custoUnit }))
      : [{ embalagemId: null, nome: '', quantidade: 1, custoUnit: 0 }]
  )
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleRecSelect = (i, nome) => {
    const rec = receitas?.find(r => r.nome === nome)
    setRecRows(prev => prev.map((row, idx) => idx === i ? {
      ...row, nome, receitaId: rec?.id ?? null,
      custoUnid: rec?.custoUnid || 0,
      unidade: rec?.unidadeGera || row.unidade,
    } : row))
  }

  const setRecField = (i, k, v) => setRecRows(prev => prev.map((row, idx) => idx === i ? { ...row, [k]: v } : row))
  const addRec = () => setRecRows(prev => [...prev, { receitaId: null, nome: '', quantidade: 1, unidade: 'un', custoUnid: 0 }])
  const removeRec = i => setRecRows(prev => prev.filter((_, idx) => idx !== i))

  const handleEmbSelect = (i, nome) => {
    const emb = embalagens?.find(e => e.nome === nome)
    setEmbRows(prev => prev.map((row, idx) => idx === i ? {
      ...row, nome, embalagemId: emb?.id ?? null, custoUnit: emb?.custoUnit || 0,
    } : row))
  }

  const setEmbField = (i, k, v) => setEmbRows(prev => prev.map((row, idx) => idx === i ? { ...row, [k]: v } : row))
  const addEmb = () => setEmbRows(prev => [...prev, { embalagemId: null, nome: '', quantidade: 1, custoUnit: 0 }])
  const removeEmb = i => setEmbRows(prev => prev.filter((_, idx) => idx !== i))

  const custoTotal = useMemo(() => {
    const rec = recRows.reduce((s, r) => s + (r.custoUnid || 0) * (parseFloat(r.quantidade) || 1), 0)
    const emb = embRows.reduce((s, e) => s + (e.custoUnit || 0) * (parseFloat(e.quantidade) || 1), 0)
    return rec + emb
  }, [recRows, embRows])

  const cfg = getConfig()
  const precos = calcPrecos(custoTotal, cfg)

  const handle = async () => {
    if (!form.nome) return
    setSaving(true)
    try {
      const recItems = recRows.filter(r => r.receitaId)
      const embItems = embRows.filter(e => e.embalagemId)
      await onSave({ ...form, id: item?.id, precoSugerido: precos.base }, recItems, embItems)
      onClose()
    } catch (e) { alert(e.message) } finally { setSaving(false) }
  }

  return (
    <Sheet title={item ? 'Editar produto' : 'Novo produto'} onClose={onClose}>
      <div className="field-label">Nome do produto *</div>
      <input className="field-input" placeholder="ex: Choux Craquelin" value={form.nome} onChange={e => set('nome', e.target.value)} />

      <div className="section-label" style={{ marginTop: 4 }}>Composição — Receitas</div>
      <div className="card card-flush" style={{ padding: '0 14px', marginBottom: 4 }}>
        {recRows.map((row, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 0', borderBottom: i < recRows.length - 1 ? '1px solid var(--border)' : 'none', flexWrap: 'wrap' }}>
            <input
              className="field-input"
              style={{ flex: '1 1 140px', minWidth: 100, marginBottom: 0, fontSize: 13 }}
              list="receitas-list"
              placeholder="Receita"
              value={row.nome}
              onChange={e => handleRecSelect(i, e.target.value)}
            />
            <input
              className="item-qty"
              type="number"
              min="0"
              step="0.5"
              placeholder="Qtd"
              value={row.quantidade}
              onChange={e => setRecField(i, 'quantidade', e.target.value)}
            />
            <input
              className="item-qty"
              style={{ width: 52, textAlign: 'left', fontSize: 12 }}
              placeholder="un"
              value={row.unidade}
              onChange={e => setRecField(i, 'unidade', e.target.value)}
            />
            {recRows.length > 1 && (
              <button className="item-rm" onClick={() => removeRec(i)}>&#215;</button>
            )}
          </div>
        ))}
      </div>
      <datalist id="receitas-list">
        {(receitas || []).map(r => <option key={r.id} value={r.nome} />)}
      </datalist>
      <button className="btn-add-item" onClick={addRec}>+ receita</button>

      <div className="section-label" style={{ marginTop: 8 }}>Composição — Embalagens</div>
      <div className="card card-flush" style={{ padding: '0 14px', marginBottom: 4 }}>
        {embRows.map((row, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 0', borderBottom: i < embRows.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <input
              className="field-input"
              style={{ flex: 3, marginBottom: 0, fontSize: 13 }}
              list="embalagens-list"
              placeholder="Embalagem"
              value={row.nome}
              onChange={e => handleEmbSelect(i, e.target.value)}
            />
            <input
              className="item-qty"
              type="number"
              min="0"
              step="1"
              placeholder="Qtd"
              value={row.quantidade}
              onChange={e => setEmbField(i, 'quantidade', e.target.value)}
            />
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 28 }}>un</span>
            {embRows.length > 1 && (
              <button className="item-rm" onClick={() => removeEmb(i)}>&#215;</button>
            )}
          </div>
        ))}
      </div>
      <datalist id="embalagens-list">
        {(embalagens || []).map(e => <option key={e.id} value={e.nome} />)}
      </datalist>
      <button className="btn-add-item" onClick={addEmb}>+ embalagem</button>

      {custoTotal > 0 && (
        <div style={{ margin: '12px 0 4px', padding: '10px 14px', background: 'var(--teal-light)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--teal)', marginBottom: 6 }}>
            Custo total: <strong>R$ {custoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          </div>
          <div style={{ fontSize: 13, color: 'var(--teal)', fontWeight: 600 }}>
            Venda direta: {fmtR(precos.base)}
          </div>
          <div style={{ fontSize: 12, color: '#f59e0b', marginTop: 3 }}>
            99Food: {fmtR(precos.p99)}
          </div>
          <div style={{ fontSize: 12, color: '#ef4444', marginTop: 2 }}>
            iFood: {fmtR(precos.pIfood)}
          </div>
        </div>
      )}

      <div className="section-label" style={{ marginTop: 8 }}>Preço praticado (opcional)</div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
        Deixe em branco para usar o preço sugerido. Preencha se cobrar diferente.
      </div>
      <input
        className="field-input"
        type="number"
        min="0"
        step="0.50"
        placeholder={custoTotal > 0 ? `Sugerido: ${fmtR(precos.base)}` : 'Preço praticado (R$)'}
        value={form.precoPraticado}
        onChange={e => set('precoPraticado', e.target.value)}
      />

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

export default function Produtos() {
  const [sheet, setSheet] = useState(null)
  const { toast, show } = useToast()

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
            <button
              className="btn-outline-teal desktop-only"
              onClick={() => setSheet({ type: 'produto' })}
              style={{ fontSize: 13, padding: '6px 14px' }}
            >
              + Novo produto
            </button>
            <button
              className="btn-ghost mobile-only"
              onClick={() => setSheet({ type: 'produto' })}
              style={{ fontSize: 20, padding: '4px 12px', border: 'none', color: 'var(--teal)' }}
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 16 }}>
        {loading ? (
          <div className="loading">Carregando...</div>
        ) : (
          <>
            <div className="desktop-only">
              <div className="card card-flush">
                {(produtos || []).length === 0
                  ? <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Nenhum produto cadastrado</div>
                  : <table className="dt">
                      <thead><tr>
                        <th>Nome</th>
                        <th>Composição</th>
                        <th>Custo total</th>
                        <th>Preço sugerido</th>
                        <th>Preço praticado</th>
                      </tr></thead>
                      <tbody>
                        {(produtos || []).map(prod => (
                          <tr key={prod.id} onClick={() => setSheet({ type: 'produto', item: prod })}>
                            <td style={{ fontWeight: 600 }}>{prod.nome}</td>
                            <td className="muted" style={{ fontSize: 12 }}>
                              {[
                                ...(prod.receitas || []).map(r => `${r.quantidade} ${r.unidadeGera} ${r.nome}`),
                                ...(prod.embalagens || []).map(e => `${e.quantidade}× ${e.nome}`),
                              ].join(', ') || '—'}
                            </td>
                            <td className="muted">{prod.custoTotal > 0 ? fmtR(prod.custoTotal) : '—'}</td>
                            <td className="teal">{prod.precoSugerido > 0 ? fmtR(prod.precoSugerido) : '—'}</td>
                            <td>{prod.precoPraticado != null ? fmtR(prod.precoPraticado) : <span className="muted">—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                }
              </div>
            </div>

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
                      <div>
                        <div className="list-item-name">{prod.nome}</div>
                        <div className="list-item-sub">
                          {[
                            ...(prod.receitas || []).map(r => `${r.quantidade} ${r.unidadeGera} ${r.nome}`),
                            ...(prod.embalagens || []).map(e => `${e.quantidade}× ${e.nome}`),
                          ].join(' · ') || 'Sem composição'}
                        </div>
                      </div>
                      <div className="list-item-right">
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--teal)' }}>
                          {prod.precoPraticado != null ? fmtR(prod.precoPraticado) : fmtR(prod.precoSugerido)}
                        </div>
                        {prod.custoTotal > 0 && (
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>custo {fmtR(prod.custoTotal)}</div>
                        )}
                      </div>
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
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setSheet(null)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
