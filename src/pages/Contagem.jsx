import { useState, useRef, useMemo, useEffect } from 'react'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { getInsumos, getEmbalagens, getProdutos, updateEstoqueInsumos, updateEstoqueEmbalagens, updateEstoqueProdutos, updateEstoqueMinProdutos, updateEstoqueMinInsumos, updateEstoqueMinEmbalagens, registrarCompras, getCompras, deleteCompra, getInsumoFornecedores } from '../services/db'

function waLink(phone) {
  const digits = (phone || '').replace(/\D/g, '')
  if (!digits) return null
  return `https://wa.me/55${digits}`
}

function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key] || 'Outros'
    if (!acc[k]) acc[k] = []
    acc[k].push(item)
    return acc
  }, {})
}

function calcPedir(atual, min) {
  const a = parseFloat(atual)
  const m = parseFloat(min)
  if (isNaN(a) || isNaN(m)) return null
  return Math.max(0, m - a)
}

function fmt(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtQtd(v) {
  const n = Number(v || 0)
  return n % 1 === 0 ? String(n) : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

function fmtN(v) {
  const n = Number(v || 0)
  return n % 1 === 0 ? String(n) : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

function normStr(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function getStep(item) {
  if (item._tipo === 'insumo' || item.pesoEmb != null) {
    if (item.pesoEmb > 0) return item.pesoEmb
  }
  if (item._tipo === 'embalagem' || item.qtdCompra != null) {
    if (item.qtdCompra > 0) return item.qtdCompra
  }
  return 1
}

// ─── ListaCompras ───────────────────────────────────────────────────────────
function ListaCompras({ contagem, itens }) {
  const pedir = itens
    .map(item => {
      const val = parseFloat(contagem[item.id] ?? item.estoqueAtual)
      const falta = calcPedir(val, item.estoqueMin)
      if (!falta || falta <= 0) return null
      return { id: item.id, nome: item.nome, falta, unidade: item.unidade || '', whatsapp: item.whatsapp || '', fornecedor: item.fornecedor || '', linkCompra: item.linkCompra || '' }
    })
    .filter(Boolean)

  const byFornecedor = pedir.reduce((map, p) => {
    const key = p.whatsapp || '__sem_contato__'
    if (!map[key]) map[key] = { fornecedor: p.fornecedor, whatsapp: p.whatsapp, items: [] }
    map[key].items.push(p)
    return map
  }, {})

  if (pedir.length === 0) return (
    <div className="card" style={{ background: 'var(--ok-bg)', borderColor: '#3a6b1a', marginTop: 4 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ok-text)' }}>Tudo ok!</div>
      <div style={{ fontSize: 12, color: 'var(--ok-text)', marginTop: 2 }}>Estoque acima do mínimo em todos os itens</div>
    </div>
  )

  return (
    <div className="card" style={{ background: 'var(--warn-bg)', borderColor: '#6b4a1a', marginTop: 4 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--warn-text)', marginBottom: 8 }}>Lista de compras</div>
      {Object.values(byFornecedor).map((grupo, gi, arr) => {
        const wa = waLink(grupo.whatsapp)
        const msg = grupo.items.map(p => `${p.nome}: ${p.falta} ${p.unidade}`).join('\n')
        const waComMsg = wa ? `${wa}?text=${encodeURIComponent(`Olá! Preciso pedir:\n${msg}`)}` : null
        return (
          <div key={gi} style={{ marginBottom: gi < arr.length - 1 ? 12 : 0 }}>
            {grupo.fornecedor && <div style={{ fontSize: 11, color: 'var(--warn-text)', fontWeight: 600, marginBottom: 4, opacity: 0.8 }}>{grupo.fornecedor}</div>}
            {grupo.items.map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span style={{ fontSize: 12, color: 'var(--warn-text)', flex: 1 }}>· {p.nome}: {p.falta} {p.unidade}</span>
                {p.linkCompra && <a href={p.linkCompra} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--teal)', textDecoration: 'none', whiteSpace: 'nowrap' }}>Ver loja</a>}
              </div>
            ))}
            {waComMsg && (
              <a href={waComMsg} target="_blank" rel="noreferrer"
                style={{ display: 'inline-block', marginTop: 6, fontSize: 12, color: '#fff', background: '#25d366', borderRadius: 6, padding: '4px 10px', textDecoration: 'none', fontWeight: 600 }}>
                Pedir no WhatsApp
              </a>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── StockTab ────────────────────────────────────────────────────────────────
function StockTab({ itens, contagem, onChange, minValues, labelPedir = 'pedir', filtro = 'todos' }) {
  const filtered = useMemo(() => {
    if (filtro === 'todos') return itens
    return itens.filter(item => {
      const val = contagem[item.id]
      const effectiveMin = minValues?.[item.id] ?? item.estoqueMin
      const stockVal = val !== undefined && val !== '' ? parseFloat(val) : item.estoqueAtual
      if (filtro === 'faltando') return stockVal !== null && stockVal !== undefined && stockVal < effectiveMin
      if (filtro === 'naocontados') return val === undefined || val === ''
      return true
    })
  }, [itens, contagem, minValues, filtro])

  const grupos = groupBy(filtered, 'categoria')
  const orderedIds = useMemo(() => Object.values(grupos).flat().map(i => i.id), [grupos])
  const inputRefs = useRef({})

  const handleKey = (id) => (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const idx = orderedIds.indexOf(id)
      const nextId = orderedIds[idx + 1]
      if (nextId && inputRefs.current[nextId]) { inputRefs.current[nextId].focus(); inputRefs.current[nextId].select() }
      else e.target.blur()
    }
  }

  if (filtered.length === 0) {
    return <div className="empty" style={{ marginTop: 8 }}><span>Nenhum item neste filtro</span></div>
  }

  return (
    <>
      {Object.entries(grupos).map(([cat, items]) => (
        <div key={cat}>
          <div className="cat-header">{cat}</div>
          <div className="card card-flush" style={{ padding: '0 14px', marginBottom: 8 }}>
            {items.map(item => {
              const val = contagem[item.id] ?? (item.estoqueAtual ?? '')
              const effectiveMin = minValues?.[item.id] ?? item.estoqueMin
              const falta = val !== '' ? calcPedir(val, effectiveMin) : null
              return (
                <div key={item.id} className="stock-row">
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{item.nome}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>mín. {effectiveMin} {item.unidade}</div>
                  </div>
                  <div>
                    <input
                      ref={el => { if (el) inputRefs.current[item.id] = el }}
                      className="stock-input"
                      type="text" inputMode="decimal" min="0"
                      value={val} placeholder="—"
                      onChange={e => onChange(item.id, e.target.value)}
                      onKeyDown={handleKey(item.id)}
                      onFocus={e => e.target.select()}
                    />
                    {falta !== null && falta > 0 && <div className="pedir-txt">{labelPedir} {falta} {item.unidade}</div>}
                    {falta !== null && falta === 0 && <div className="ok-txt">ok</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </>
  )
}

// ─── GastosTab ───────────────────────────────────────────────────────────────
function GastosTab() {
  const { data: compras, loading, reload } = useData(getCompras)
  const { show, toast } = useToast()
  const [filtro, setFiltro] = useState('todos')

  const mesAtual = new Date().toISOString().slice(0, 7)

  const filtradas = useMemo(() => {
    if (!compras) return []
    return compras.filter(c => filtro === 'todos' || c.tipo === filtro)
  }, [compras, filtro])

  const totalMes = useMemo(() =>
    filtradas.filter(c => c.data?.startsWith(mesAtual)).reduce((s, c) => s + (c.total || 0), 0),
    [filtradas, mesAtual]
  )

  const porMes = useMemo(() => {
    const map = {}
    filtradas.forEach(c => {
      const mes = c.data?.slice(0, 7) || 'sem data'
      if (!map[mes]) map[mes] = []
      map[mes].push(c)
    })
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]))
  }, [filtradas])

  function fmtMes(ym) {
    if (!ym || ym === 'sem data') return 'Sem data'
    const [y, m] = ym.split('-')
    const nomes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
    return `${nomes[parseInt(m) - 1]} ${y}`
  }

  async function handleDelete(id) {
    try { await deleteCompra(id); reload(); show('Removido!') }
    catch (e) { show('Erro: ' + e.message) }
  }

  if (loading) return <div className="loading">Carregando...</div>

  if (!compras || compras.length === 0) return (
    <div className="empty" style={{ marginTop: 24 }}>
      <span>Nenhuma compra registrada ainda</span>
    </div>
  )

  return (
    <>
      <div className="card" style={{ background: 'var(--bg-secondary)', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Gasto este mês</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--teal)', marginTop: 2 }}>R$ {fmt(totalMes)}</div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
          {filtradas.filter(c => c.data?.startsWith(mesAtual)).length} compras registradas
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {[['todos', 'Todos'], ['insumo', 'Insumos'], ['embalagem', 'Embalagens']].map(([val, label]) => (
          <button key={val} onClick={() => setFiltro(val)} style={{
            fontSize: 12, padding: '4px 12px', borderRadius: 20,
            border: '1px solid var(--border-color)',
            background: filtro === val ? 'var(--teal)' : 'transparent',
            color: filtro === val ? '#fff' : 'var(--text-secondary)', cursor: 'pointer',
          }}>{label}</button>
        ))}
      </div>
      {porMes.map(([mes, itens]) => {
        const totalGrupo = itens.reduce((s, c) => s + (c.total || 0), 0)
        return (
          <div key={mes}>
            <div className="cat-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{fmtMes(mes)}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>R$ {fmt(totalGrupo)}</span>
            </div>
            <div className="card card-flush" style={{ padding: '0 14px', marginBottom: 8 }}>
              {itens.map((c, i) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: i < itens.length - 1 ? '1px solid #222' : 'none' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.itemNome}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                      {fmtQtd(c.quantidade)} {c.unidade}
                      {c.precoUnit > 0 && ` · R$ ${fmt(c.precoUnit)}/${c.unidade || 'un'}`}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    {c.total > 0
                      ? <div style={{ fontWeight: 600, fontSize: 14 }}>R$ {fmt(c.total)}</div>
                      : <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>sem preço</div>
                    }
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                      {c.data ? new Date(c.data + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : ''}
                    </div>
                  </div>
                  <button onClick={() => handleDelete(c.id)} style={{ background: 'none', border: 'none', color: '#555', fontSize: 16, cursor: 'pointer', padding: '4px 6px', flexShrink: 0 }} title="Remover">×</button>
                </div>
              ))}
            </div>
          </div>
        )
      })}
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}

// ─── Recibo (contagem) ───────────────────────────────────────────────────────
function Recibo({ tab, itens, contagem, onConfirmar, onVoltar, saving }) {
  const tabLabel = { insumos: 'Insumos', embalagens: 'Embalagens', produtos: 'Produtos' }[tab]
  const [fornecedores, setFornecedores] = useState({})
  const [fornSel, setFornSel] = useState({})
  const [openPicker, setOpenPicker] = useState(null)

  const alterados = itens.filter(item => contagem[item.id] !== undefined && contagem[item.id] !== '')
  const aumentos = alterados.filter(item => parseFloat(contagem[item.id]) - (item.estoqueAtual ?? 0) > 0)

  useEffect(() => {
    if (tab !== 'insumos' || aumentos.length === 0) return
    Promise.all(aumentos.map(item => getInsumoFornecedores(item.id).then(fs => ({ id: item.id, fs, item }))))
      .then(results => {
        const map = {}
        results.forEach(({ id, fs, item }) => {
          const opts = fs.length > 0 ? fs : (item.fornecedor ? [{ fornecedor: item.fornecedor, marca: item.marca || '', custoUnit: item.custoUnit || 0 }] : [])
          map[id] = opts
          if (opts.length > 0) setFornSel(s => ({ ...s, [id]: opts[0] }))
        })
        setFornecedores(map)
      }).catch(() => {})
  }, [])

  function getOpts(item) {
    if (tab === 'insumos') return fornecedores[item.id] || []
    return item.fornecedor ? [{ fornecedor: item.fornecedor, marca: '', custoUnit: item.custoUnit || 0 }] : []
  }

  const totalCompra = alterados.reduce((sum, item) => {
    const diff = parseFloat(contagem[item.id]) - (item.estoqueAtual ?? 0)
    const sel = fornSel[item.id]
    const price = sel?.custoUnit ?? item.custoUnit ?? 0
    return diff > 0 && price > 0 ? sum + diff * price : sum
  }, 0)

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div>
            <div className="topbar-title">Recibo de contagem</div>
            <div className="topbar-sub">{tabLabel} · {alterados.length} item(s) preenchido(s)</div>
          </div>
        </div>
      </div>
      <div className="page-inner" style={{ paddingTop: 16 }}>
        <div className="card card-flush" style={{ padding: '0 14px', marginBottom: 12 }}>
          {alterados.map((item, i) => {
            const old = item.estoqueAtual ?? 0
            const novo = parseFloat(contagem[item.id])
            const diff = novo - old
            const isAumento = diff > 0
            const opts = isAumento ? getOpts(item) : []
            const sel = fornSel[item.id]
            const selLabel = sel ? (sel.fornecedor || sel.marca || 'Fornecedor') : 'Selecionar fornecedor'
            return (
              <div key={item.id} style={{ padding: '11px 0', borderBottom: i < alterados.length - 1 ? '1px solid #222' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{item.nome}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                      {fmtN(old)} → <strong style={{ color: 'var(--text-primary)' }}>{fmtN(novo)}</strong> {item.unidade}
                    </div>
                  </div>
                  <div style={{ flexShrink: 0, textAlign: 'right' }}>
                    {diff > 0 && <div style={{ fontSize: 12, color: 'var(--teal)', fontWeight: 600 }}>+{fmtN(diff)} {item.unidade}</div>}
                    {diff < 0 && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{fmtN(diff)} {item.unidade}</div>}
                    {diff === 0 && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>sem alteração</div>}
                  </div>
                </div>
                {isAumento && opts.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <button onClick={() => setOpenPicker(openPicker === item.id ? null : item.id)} style={{
                      fontSize: 12, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                      border: sel ? '1px solid var(--teal)' : '1px dashed #555',
                      background: sel ? 'var(--teal-light)' : 'transparent',
                      color: sel ? 'var(--teal)' : 'var(--text-secondary)',
                      fontWeight: sel ? 600 : 400,
                    }}>
                      {selLabel}{sel?.custoUnit > 0 ? ` · R$${fmt(sel.custoUnit * diff)}` : ''}
                    </button>
                    {openPicker === item.id && (
                      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {opts.map((opt, oi) => (
                          <button key={oi} onClick={() => { setFornSel(s => ({ ...s, [item.id]: opt })); setOpenPicker(null) }} style={{
                            textAlign: 'left', fontSize: 12, padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                            border: '1px solid #333', background: '#1a1a1a', color: 'var(--text-primary)',
                          }}>
                            <span style={{ fontWeight: 600 }}>{opt.fornecedor || opt.marca || '—'}</span>
                            {opt.marca && opt.fornecedor && <span style={{ color: 'var(--text-secondary)' }}> · {opt.marca}</span>}
                            {opt.custoEmb > 0 && <span style={{ color: 'var(--teal)', marginLeft: 6 }}>R$ {fmt(opt.custoEmb)} / {fmtN(opt.pesoEmb)}{' '}</span>}
                            {!opt.custoEmb && opt.custoUnit > 0 && <span style={{ color: 'var(--teal)', marginLeft: 6 }}>R$ {fmt(opt.custoUnit)}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {totalCompra > 0 && (
          <div className="card" style={{ background: 'var(--teal-light)', border: '1px solid var(--teal-dark)', marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--teal)' }}>Gasto estimado nesta contagem</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--teal)', marginTop: 2 }}>R$ {fmt(totalCompra)}</div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          <button onClick={onVoltar} disabled={saving} style={{ flex: 1, padding: 12, borderRadius: 8, border: '1px solid #444', background: 'transparent', color: 'var(--text-primary)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>← Editar</button>
          <button onClick={() => onConfirmar(fornSel)} disabled={saving} style={{ flex: 2, padding: 12, borderRadius: 8, border: 'none', background: 'var(--teal)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            {saving ? 'Salvando...' : 'Confirmar contagem'}
          </button>
        </div>
      </div>
    </>
  )
}

// ─── ReciboCompra ────────────────────────────────────────────────────────────
function ReciboCompra({ itens, qtds, fornSel, setFornSel, fornOpts, onVoltar, onConfirmar, saving }) {
  const [openPicker, setOpenPicker] = useState(null)

  const selecionados = itens.filter(i => parseFloat(qtds[i.id] || '0') > 0)

  const total = selecionados.reduce((sum, item) => {
    const qty = parseFloat(qtds[item.id] || '0')
    const sel = fornSel[item.id]
    const price = sel?.custoUnit ?? item.custoUnit ?? 0
    return sum + qty * price
  }, 0)

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div>
            <div className="topbar-title">Recibo de compra</div>
            <div className="topbar-sub">{selecionados.length} item(s) selecionado(s)</div>
          </div>
        </div>
      </div>
      <div className="page-inner" style={{ paddingTop: 16 }}>
        <div className="card card-flush" style={{ padding: '0 14px', marginBottom: 12 }}>
          {selecionados.map((item, i) => {
            const qty = parseFloat(qtds[item.id] || '0')
            const opts = item._tipo === 'insumo'
              ? (fornOpts[item.id] || (item.fornecedor ? [{ fornecedor: item.fornecedor, marca: item.marca || '', custoUnit: item.custoUnit || 0, pesoEmb: item.pesoEmb || 0, custoEmb: item.custoEmb || 0 }] : []))
              : (item.fornecedor ? [{ fornecedor: item.fornecedor, marca: '', custoUnit: item.custoUnit || 0, custoCompra: item.custoCompra || 0, qtdCompra: item.qtdCompra || 0 }] : [])
            const sel = fornSel[item.id]
            const selLabel = sel ? (sel.fornecedor || sel.marca || 'Fornecedor') : 'Selecionar fornecedor'
            return (
              <div key={item.id} style={{ padding: '11px 0', borderBottom: i < selecionados.length - 1 ? '1px solid #222' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{item.nome}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                      em estoque: {fmtN(item.estoqueAtual ?? 0)} {item.unidade}
                    </div>
                  </div>
                  <div style={{ flexShrink: 0, textAlign: 'right' }}>
                    <div style={{ fontSize: 13, color: 'var(--teal)', fontWeight: 700 }}>+{fmtN(qty)} {item.unidade}</div>
                    {sel?.custoUnit > 0 && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>R$ {fmt(sel.custoUnit * qty)}</div>}
                  </div>
                </div>
                {opts.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <button onClick={() => setOpenPicker(openPicker === item.id ? null : item.id)} style={{
                      fontSize: 12, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                      border: sel ? '1px solid var(--teal)' : '1px dashed #555',
                      background: sel ? 'var(--teal-light)' : 'transparent',
                      color: sel ? 'var(--teal)' : 'var(--text-secondary)',
                      fontWeight: sel ? 600 : 400,
                    }}>
                      {selLabel}
                    </button>
                    {openPicker === item.id && (
                      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {opts.map((opt, oi) => (
                          <button key={oi} onClick={() => { setFornSel(s => ({ ...s, [item.id]: opt })); setOpenPicker(null) }} style={{
                            textAlign: 'left', fontSize: 12, padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                            border: '1px solid #333', background: '#1a1a1a', color: 'var(--text-primary)',
                          }}>
                            <span style={{ fontWeight: 600 }}>{opt.fornecedor || opt.marca || '—'}</span>
                            {opt.marca && opt.fornecedor && <span style={{ color: 'var(--text-secondary)' }}> · {opt.marca}</span>}
                            {item._tipo === 'insumo' && opt.custoEmb > 0 && <span style={{ color: 'var(--teal)', marginLeft: 6 }}>R$ {fmt(opt.custoEmb)} / {fmtN(opt.pesoEmb)}{item.unidade}</span>}
                            {item._tipo === 'embalagem' && opt.custoCompra > 0 && <span style={{ color: 'var(--teal)', marginLeft: 6 }}>R$ {fmt(opt.custoCompra)} / {fmtN(opt.qtdCompra || 1)}{item.unidade}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {total > 0 && (
          <div className="card" style={{ background: 'var(--teal-light)', border: '1px solid var(--teal-dark)', marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--teal)' }}>Total estimado</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--teal)', marginTop: 2 }}>R$ {fmt(total)}</div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          <button onClick={onVoltar} disabled={saving} style={{ flex: 1, padding: 12, borderRadius: 8, border: '1px solid #444', background: 'transparent', color: 'var(--text-primary)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>← Editar</button>
          <button onClick={onConfirmar} disabled={saving} style={{ flex: 2, padding: 12, borderRadius: 8, border: 'none', background: 'var(--teal)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            {saving ? 'Registrando...' : 'Confirmar compra'}
          </button>
        </div>
      </div>
    </>
  )
}

// ─── CompraView ──────────────────────────────────────────────────────────────
function CompraView({ insumos, embalagens, onVoltar, onSalvar, saving }) {
  const [tab, setTab] = useState('insumos')
  const [busca, setBusca] = useState('')
  const [qtds, setQtds] = useState({})
  const [fornSel, setFornSel] = useState({})
  const [fornOpts, setFornOpts] = useState({})
  const [showRecibo, setShowRecibo] = useState(false)

  const todos = useMemo(() => [
    ...(insumos || []).map(i => ({ ...i, _tipo: 'insumo' })),
    ...(embalagens || []).map(e => ({ ...e, _tipo: 'embalagem' })),
  ], [insumos, embalagens])

  const itensTab = useMemo(() => {
    const base = tab === 'insumos' ? (insumos || []).map(i => ({ ...i, _tipo: 'insumo' })) : (embalagens || []).map(e => ({ ...e, _tipo: 'embalagem' }))
    if (!busca) return base
    const q = normStr(busca)
    return base.filter(i => normStr(i.nome).includes(q) || normStr(i.categoria || '').includes(q))
  }, [tab, insumos, embalagens, busca])

  const temItens = todos.some(i => parseFloat(qtds[i.id] || '0') > 0)
  const qtdSelecionados = todos.filter(i => parseFloat(qtds[i.id] || '0') > 0).length

  async function handleQty(item, val) {
    setQtds(q => ({ ...q, [item.id]: val }))
    if (item._tipo === 'insumo' && parseFloat(val) > 0 && !fornOpts[item.id]) {
      try {
        const fs = await getInsumoFornecedores(item.id)
        const opts = fs.length > 0 ? fs : (item.fornecedor ? [{ fornecedor: item.fornecedor, marca: item.marca || '', custoUnit: item.custoUnit || 0, pesoEmb: item.pesoEmb || 0, custoEmb: item.custoEmb || 0 }] : [])
        setFornOpts(o => ({ ...o, [item.id]: opts }))
        if (opts.length > 0) setFornSel(s => ({ ...s, [item.id]: s[item.id] || opts[0] }))
      } catch {}
    }
  }

  function bump(item, delta) {
    const step = getStep(item)
    const cur = parseFloat(qtds[item.id] || '0')
    const novo = Math.max(0, cur + delta * step)
    handleQty(item, novo === 0 ? '' : String(novo))
  }

  if (showRecibo) {
    return (
      <>
        <ReciboCompra
          itens={todos}
          qtds={qtds}
          fornSel={fornSel}
          setFornSel={setFornSel}
          fornOpts={fornOpts}
          onVoltar={() => setShowRecibo(false)}
          onConfirmar={() => onSalvar(qtds, fornSel, todos)}
          saving={saving}
        />
      </>
    )
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <button onClick={onVoltar} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 22, cursor: 'pointer', padding: '0 8px 0 0', lineHeight: 1 }}>‹</button>
          <div>
            <div className="topbar-title">Nova compra</div>
            <div className="topbar-sub">Registrar insumos ou embalagens comprados</div>
          </div>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 16 }}>
        <div className="tab-bar" style={{ marginBottom: 12 }}>
          {[['insumos', 'Insumos'], ['embalagens', 'Embalagens']].map(([key, label]) => (
            <button key={key} className={`tab-btn ${tab === key ? 'active' : ''}`} onClick={() => { setTab(key); setBusca('') }}>{label}</button>
          ))}
        </div>

        <div style={{ position: 'relative', marginBottom: 12 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--text-tertiary)', pointerEvents: 'none' }}>🔍</span>
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar..."
            style={{ width: '100%', paddingLeft: 32, paddingRight: busca ? 28 : 10, paddingTop: 9, paddingBottom: 9, borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14, boxSizing: 'border-box' }}
          />
          {busca && <button onClick={() => setBusca('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-tertiary)', fontSize: 16, cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>}
        </div>

        <div className="card card-flush" style={{ padding: '0 14px', marginBottom: 12 }}>
          {itensTab.length === 0 && <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 14 }}>Nenhum item encontrado</div>}
          {itensTab.map((item, i) => {
            const qty = qtds[item.id] || ''
            const hasQty = parseFloat(qty) > 0
            const step = getStep(item)
            return (
              <div key={item.id} style={{ padding: '12px 0', borderBottom: i < itensTab.length - 1 ? '1px solid #222' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.nome}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                      em estoque: {fmtN(item.estoqueAtual ?? 0)} {item.unidade}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <button onClick={() => bump(item, -1)} style={{
                      width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border-color)',
                      background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 18,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                    }}>−</button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input
                        type="text" inputMode="decimal"
                        value={qty}
                        placeholder="0"
                        onChange={e => handleQty(item, e.target.value)}
                        onFocus={e => e.target.select()}
                        style={{ width: 60, padding: '6px 6px', borderRadius: 6, border: hasQty ? '1.5px solid var(--teal)' : '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14, textAlign: 'center' }}
                      />
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 20 }}>{item.unidade}</span>
                    </div>
                    <button onClick={() => bump(item, 1)} style={{
                      width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border-color)',
                      background: hasQty ? 'var(--teal)' : 'var(--bg-secondary)',
                      color: hasQty ? '#fff' : 'var(--text-primary)', fontSize: 18,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                    }}>+</button>
                  </div>
                </div>
                {hasQty && step > 1 && (
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4, textAlign: 'right' }}>
                    incremento: {step} {item.unidade}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <button
          onClick={() => setShowRecibo(true)}
          disabled={!temItens}
          style={{ width: '100%', padding: 12, borderRadius: 8, border: 'none', background: temItens ? 'var(--teal)' : '#333', color: temItens ? '#fff' : '#666', fontSize: 14, fontWeight: 600, cursor: temItens ? 'pointer' : 'default', marginBottom: 24 }}
        >
          {temItens ? `Ver recibo (${qtdSelecionados} item${qtdSelecionados > 1 ? 's' : ''}) →` : 'Selecione os itens comprados'}
        </button>
      </div>
    </>
  )
}

// ─── ConsultarView ───────────────────────────────────────────────────────────
function ConsultarView({ insumos, embalagens, produtos, onVoltar }) {
  const [tab, setTab] = useState('insumos')

  const produtosParaConsulta = useMemo(() => (produtos || [])
    .filter(p => p.tipo !== 'combo')
    .map(p => ({ ...p, unidade: 'un', categoria: p.tipo === 'avulso' ? 'Avulso' : 'Produzido' })),
    [produtos])

  const itens = tab === 'insumos' ? (insumos || []) : tab === 'embalagens' ? (embalagens || []) : tab === 'produtos' ? produtosParaConsulta : []
  const grupos = groupBy(itens, 'categoria')

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <button onClick={onVoltar} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 22, cursor: 'pointer', padding: '0 8px 0 0', lineHeight: 1 }}>‹</button>
          <div>
            <div className="topbar-title">Consultar</div>
            <div className="topbar-sub">Estoque atual e histórico de compras</div>
          </div>
        </div>
      </div>
      <div className="page-inner" style={{ paddingTop: 16 }}>
        <div className="tab-bar" style={{ marginBottom: 12 }}>
          {[['insumos','Insumos'],['embalagens','Embalagens'],['produtos','Produtos'],['compras','Compras']].map(([key, label]) => (
            <button key={key} className={`tab-btn ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>
        {tab === 'compras' ? (
          <GastosTab />
        ) : (
          <>
            {itens.length === 0 && <div className="empty" style={{ marginTop: 24 }}><span>Nenhum item cadastrado</span></div>}
            {Object.entries(grupos).map(([cat, items]) => (
              <div key={cat}>
                <div className="cat-header">{cat}</div>
                <div className="card card-flush" style={{ padding: '0 14px', marginBottom: 8 }}>
                  {items.map((item, i) => {
                    const pct = item.estoqueMin > 0 ? Math.min(100, Math.max(0, (item.estoqueAtual ?? 0) / item.estoqueMin * 100)) : 100
                    const barColor = pct < 50 ? '#ef4444' : pct < 100 ? '#f59e0b' : 'var(--teal)'
                    return (
                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < items.length - 1 ? '1px solid #222' : 'none' }}>
                      <div style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{item.nome}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>mín. {item.estoqueMin} {item.unidade}</div>
                        <div style={{ marginTop: 5, height: 4, borderRadius: 2, background: '#2a2a2a', overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 2 }} />
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 16, color: pct < 100 ? barColor : 'var(--text-primary)' }}>
                          {fmtN(item.estoqueAtual ?? 0)}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{item.unidade}</div>
                      </div>
                    </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  )
}

// ─── Contagem (main) ─────────────────────────────────────────────────────────
export default function Contagem() {
  const { data: insumos,    loading: loadIns,  reload: reloadIns  } = useData(getInsumos)
  const { data: embalagens, loading: loadEmb,  reload: reloadEmb  } = useData(getEmbalagens)
  const { data: produtos,   loading: loadProd, reload: reloadProd } = useData(getProdutos)
  const { toast, show } = useToast()

  const [vista, setVista]   = useState(null) // null | 'contagem' | 'compra' | 'consultar'
  const [tab, setTab]       = useState('insumos')
  const [busca, setBusca]   = useState('')
  const [filtroContagem, setFiltroContagem] = useState('todos')
  const [contagemIns,  setContagemIns]  = useState({})
  const [contagemEmb,  setContagemEmb]  = useState({})
  const [contagemProd, setContagemProd] = useState({})
  const [minIns,  setMinIns]  = useState({})
  const [minEmb,  setMinEmb]  = useState({})
  const [minProd, setMinProd] = useState({})
  const [modalMin, setModalMin] = useState(null)
  const [savingMin, setSavingMin] = useState(false)
  const [semEstoqueAberto, setSemEstoqueAberto] = useState(false)
  const [recibo, setRecibo] = useState(null)
  const [saving, setSaving] = useState(false)

  const setIns  = (id, val) => setContagemIns(c  => ({ ...c, [id]: val }))
  const setEmb  = (id, val) => setContagemEmb(c  => ({ ...c, [id]: val }))
  const setProd = (id, val) => setContagemProd(c => ({ ...c, [id]: val }))

  const produtosParaContagem = useMemo(() => (produtos || [])
    .filter(p => p.tipo !== 'combo')
    .map(p => ({ ...p, unidade: 'un', categoria: p.tipo === 'avulso' ? 'Avulso' : 'Produzido' })),
    [produtos])

  const itensDoTab = tab === 'insumos' ? (insumos || []) : tab === 'embalagens' ? (embalagens || []) : produtosParaContagem
  const contagemDoTab = tab === 'insumos' ? contagemIns : tab === 'embalagens' ? contagemEmb : contagemProd
  const minDoTab = tab === 'insumos' ? minIns : tab === 'embalagens' ? minEmb : minProd

  function norm(s) { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() }

  const itensComEstoque = useMemo(() => itensDoTab.filter(i => i.estoqueAtual > 0), [itensDoTab])
  const itensSemEstoque = useMemo(() => itensDoTab.filter(i => !(i.estoqueAtual > 0)), [itensDoTab])

  const itensFiltrados = useMemo(() => {
    const q = norm(busca)
    if (!q) return itensComEstoque
    return itensComEstoque.filter(i => norm(i.nome).includes(q) || norm(i.categoria).includes(q))
  }, [itensComEstoque, busca])

  // For products: show ALL (including zero stock) filtered by search
  const produtosFiltrados = useMemo(() => {
    const q = norm(busca)
    if (!q) return produtosParaContagem
    return produtosParaContagem.filter(i => norm(i.nome).includes(q) || norm(i.categoria).includes(q))
  }, [produtosParaContagem, busca])

  const itensSemEstoqueFiltrados = useMemo(() => {
    const q = norm(busca)
    if (!q) return itensSemEstoque
    return itensSemEstoque.filter(i => norm(i.nome).includes(q) || norm(i.categoria).includes(q))
  }, [itensSemEstoque, busca])

  function changeTab(key) { setTab(key); setBusca('') }

  function openModalMin() {
    const values = {}
    itensDoTab.forEach(item => {
      const cur = minDoTab[item.id]
      values[item.id] = cur !== undefined ? String(cur) : String(item.estoqueMin ?? 0)
    })
    setModalMin({ type: tab, itens: itensDoTab, values, busca: '' })
  }

  async function saveModalMin() {
    setSavingMin(true)
    try {
      const { type, itens, values } = modalMin
      const payload = itens.map(item => ({ id: item.id, estoqueMin: parseFloat(values[item.id] ?? item.estoqueMin) || 0 }))
      if (type === 'insumos') { await updateEstoqueMinInsumos(payload); setMinIns(prev => { const n = { ...prev }; payload.forEach(p => n[p.id] = p.estoqueMin); return n }) }
      else if (type === 'embalagens') { await updateEstoqueMinEmbalagens(payload); setMinEmb(prev => { const n = { ...prev }; payload.forEach(p => n[p.id] = p.estoqueMin); return n }) }
      else { await updateEstoqueMinProdutos(payload); setMinProd(prev => { const n = { ...prev }; payload.forEach(p => n[p.id] = p.estoqueMin); return n }) }
      setModalMin(null)
      show('Mínimos salvos!')
    } catch (e) { show('Erro: ' + e.message) }
    finally { setSavingMin(false) }
  }

  const handleEnviar = () => {
    const preenchidos = itensDoTab.filter(item => contagemDoTab[item.id] !== undefined && contagemDoTab[item.id] !== '')
    if (preenchidos.length === 0) { show('Nenhum valor preenchido'); return }
    setRecibo(tab)
  }

  const handleConfirmar = async (fornSel = {}) => {
    setSaving(true)
    try {
      const itens = recibo === 'insumos' ? (insumos || []) : recibo === 'embalagens' ? (embalagens || []) : produtosParaContagem
      const contagem = recibo === 'insumos' ? contagemIns : recibo === 'embalagens' ? contagemEmb : contagemProd
      const preenchidos = itens.filter(item => contagem[item.id] !== undefined && contagem[item.id] !== '')
      const payload = preenchidos.map(item => ({ id: item.id, estoqueAtual: parseFloat(contagem[item.id]) }))

      if (recibo === 'insumos') await updateEstoqueInsumos(payload)
      else if (recibo === 'embalagens') await updateEstoqueEmbalagens(payload)
      else await updateEstoqueProdutos(payload)

      let comprasRegistradas = 0
      if (recibo !== 'produtos') {
        const tipo = recibo === 'insumos' ? 'insumo' : 'embalagem'
        const hoje = new Date().toISOString().split('T')[0]
        const novasCompras = preenchidos
          .map(item => ({ item, novo: parseFloat(contagem[item.id]), old: parseFloat(item.estoqueAtual ?? 0) }))
          .filter(({ novo, old }) => novo > old)
          .map(({ item, novo, old }) => {
            const sel = fornSel[item.id]
            const precoUnit = sel?.custoUnit ?? item.custoUnit ?? 0
            return { tipo, item_id: item.id, item_nome: item.nome, unidade: item.unidade || '', quantidade: novo - old, preco_unit: precoUnit, total: (novo - old) * precoUnit, data: hoje }
          })
        comprasRegistradas = novasCompras.length
        if (novasCompras.length > 0) await registrarCompras(novasCompras)
      }

      if (recibo === 'insumos') { setContagemIns({}); reloadIns() }
      else if (recibo === 'embalagens') { setContagemEmb({}); reloadEmb() }
      else { setContagemProd({}); reloadProd() }
      setRecibo(null)
      show(comprasRegistradas > 0 ? `Contagem salva! ${comprasRegistradas} compra(s) registrada(s)` : 'Contagem salva!')
    } catch (e) { show('Erro: ' + e.message) }
    finally { setSaving(false) }
  }

  const handleNovaCompra = async (qtds, fornSel, todos) => {
    const hoje = new Date().toISOString().split('T')[0]
    const comprasPayload = []
    const insumosPayload = []
    const embalagensPayload = []
    todos.forEach(item => {
      const qty = parseFloat(qtds[item.id] || '0')
      if (qty <= 0) return
      const sel = fornSel[item.id]
      const precoUnit = sel?.custoUnit ?? item.custoUnit ?? 0
      comprasPayload.push({ tipo: item._tipo, item_id: item.id, item_nome: item.nome, unidade: item.unidade || '', quantidade: qty, preco_unit: precoUnit, total: qty * precoUnit, data: hoje })
      const novoEstoque = (item.estoqueAtual ?? 0) + qty
      if (item._tipo === 'insumo') insumosPayload.push({ id: item.id, estoqueAtual: novoEstoque })
      else embalagensPayload.push({ id: item.id, estoqueAtual: novoEstoque })
    })
    if (comprasPayload.length === 0) { show('Nenhuma quantidade preenchida'); return }
    setSaving(true)
    try {
      await registrarCompras(comprasPayload)
      if (insumosPayload.length > 0) await updateEstoqueInsumos(insumosPayload)
      if (embalagensPayload.length > 0) await updateEstoqueEmbalagens(embalagensPayload)
      reloadIns()
      reloadEmb()
      setVista(null)
      show(`${comprasPayload.length} compra(s) registrada(s)!`)
    } catch (e) { show('Erro: ' + e.message) }
    finally { setSaving(false) }
  }

  // ── Vista: compra ──────────────────────────────────────────────────────────
  if (vista === 'compra') {
    return (
      <>
        <CompraView
          insumos={insumos}
          embalagens={embalagens}
          onVoltar={() => setVista(null)}
          onSalvar={handleNovaCompra}
          saving={saving}
        />
        {toast && <div className="toast">{toast}</div>}
      </>
    )
  }

  // ── Vista: consultar ───────────────────────────────────────────────────────
  if (vista === 'consultar') {
    return (
      <>
        <ConsultarView
          insumos={insumos}
          embalagens={embalagens}
          produtos={produtos}
          onVoltar={() => setVista(null)}
        />
        {toast && <div className="toast">{toast}</div>}
      </>
    )
  }

  // ── Vista: contagem (recibo) ───────────────────────────────────────────────
  if (recibo) {
    const itens = recibo === 'insumos' ? (insumos || []) : recibo === 'embalagens' ? (embalagens || []) : produtosParaContagem
    const contagem = recibo === 'insumos' ? contagemIns : recibo === 'embalagens' ? contagemEmb : contagemProd
    return (
      <>
        <Recibo tab={recibo} itens={itens} contagem={contagem} onConfirmar={handleConfirmar} onVoltar={() => setRecibo(null)} saving={saving} />
        {toast && <div className="toast">{toast}</div>}
      </>
    )
  }

  // ── Vista: null (home) ou 'contagem' ──────────────────────────────────────
  const loading = tab === 'insumos' ? loadIns : tab === 'embalagens' ? loadEmb : loadProd

  if (vista === null) {
    return (
      <>
        <div className="topbar">
          <div className="topbar-inner">
            <div>
              <div className="topbar-title">Estoque</div>
              <div className="topbar-sub">O que você deseja fazer?</div>
            </div>
          </div>
        </div>
        <div className="page-inner" style={{ paddingTop: 24 }}>
          {[
            { key: 'contagem', icon: '📦', titulo: 'Contar estoque', sub: 'Fazer a contagem dos seus insumos, embalagens ou produtos' },
            { key: 'compra',   icon: '🛒', titulo: 'Nova compra',    sub: 'Registrar uma compra de insumos ou embalagens' },
            { key: 'consultar',icon: '👁', titulo: 'Consultar',      sub: 'Consultar seu estoque atual ou histórico de compras' },
          ].map(c => (
            <button key={c.key} onClick={() => setVista(c.key)} className="card" style={{
              width: '100%', textAlign: 'left', cursor: 'pointer', marginBottom: 12,
              display: 'flex', gap: 14, alignItems: 'center', background: 'var(--bg-card)',
              border: '1px solid var(--border-color)', borderRadius: 12, padding: 16,
            }}>
              <span style={{ fontSize: 30, flexShrink: 0 }}>{c.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>{c.titulo}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 3 }}>{c.sub}</div>
              </div>
              <span style={{ color: 'var(--text-tertiary)', fontSize: 20 }}>›</span>
            </button>
          ))}
        </div>
        {toast && <div className="toast">{toast}</div>}
      </>
    )
  }

  // ── Vista: contagem ────────────────────────────────────────────────────────
  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <button onClick={() => setVista(null)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 22, cursor: 'pointer', padding: '0 8px 0 0', lineHeight: 1 }}>‹</button>
          <div>
            <div className="topbar-title">Contagem</div>
            <div className="topbar-sub">Digite o estoque físico atual</div>
          </div>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 16 }}>
        <div className="tab-bar">
          {[['insumos','Insumos'],['embalagens','Embalagens'],['produtos','Produtos'],['gastos','Gastos']].map(([key, label]) => (
            <button key={key} className={`tab-btn ${tab === key ? 'active' : ''}`} onClick={() => changeTab(key)}>{label}</button>
          ))}
        </div>

        {loading ? (
          <div className="loading">Carregando...</div>
        ) : tab === 'gastos' ? (
          <GastosTab />
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--text-tertiary)', pointerEvents: 'none' }}>🔍</span>
                <input
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  placeholder="Buscar..."
                  style={{ width: '100%', paddingLeft: 32, paddingRight: busca ? 28 : 10, paddingTop: 9, paddingBottom: 9, borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14, boxSizing: 'border-box' }}
                />
                {busca && <button onClick={() => setBusca('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-tertiary)', fontSize: 16, cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>}
              </div>
              <button onClick={openModalMin} style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                Editar Mínimo
              </button>
            </div>

            {(tab === 'insumos' || tab === 'embalagens') && (() => {
              const contagem = tab === 'insumos' ? contagemIns : contagemEmb
              const onChange = tab === 'insumos' ? setIns : setEmb
              const minVals  = tab === 'insumos' ? minIns : minEmb
              const todosItens = tab === 'insumos' ? (insumos || []) : (embalagens || [])
              const semFiltrados = itensSemEstoqueFiltrados

              return (
                <>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 10, overflowX: 'auto' }}>
                    {[['todos', 'Tudo'], ['faltando', '🔴 Faltando'], ['naocontados', '👁 Não contados']].map(([k, l]) => (
                      <button key={k} onClick={() => setFiltroContagem(k)} style={{
                        padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                        border: '1px solid',
                        borderColor: filtroContagem === k ? 'var(--teal)' : 'var(--border)',
                        background:  filtroContagem === k ? 'var(--teal-light)' : 'transparent',
                        color:       filtroContagem === k ? 'var(--teal)' : 'var(--text-secondary)',
                        cursor: 'pointer', whiteSpace: 'nowrap',
                      }}>{l}</button>
                    ))}
                  </div>
                  <StockTab itens={itensFiltrados} contagem={contagem} onChange={onChange} minValues={minVals} filtro={filtroContagem} />
                  {busca && semFiltrados.length > 0 && (
                    <>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, margin: '12px 0 6px', textTransform: 'uppercase', letterSpacing: 1 }}>Sem estoque</div>
                      <StockTab itens={semFiltrados} contagem={contagem} onChange={onChange} minValues={minVals} filtro={filtroContagem} />
                    </>
                  )}
                  {!busca && itensSemEstoque.length > 0 && (
                    <button onClick={() => setSemEstoqueAberto(v => !v)} style={{ width: '100%', textAlign: 'left', padding: '10px 14px', marginBottom: 8, borderRadius: 8, border: '1px dashed var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}>
                      <span>Não contabilizados ({itensSemEstoque.length})</span>
                      <span>{semEstoqueAberto ? '▲' : '▼'}</span>
                    </button>
                  )}
                  {!busca && semEstoqueAberto && <StockTab itens={itensSemEstoque} contagem={contagem} onChange={onChange} minValues={minVals} />}
                  <button onClick={handleEnviar} style={{ width: '100%', padding: 12, borderRadius: 8, border: 'none', background: 'var(--teal)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', margin: '12px 0' }}>
                    Enviar contagem →
                  </button>
                  <ListaCompras contagem={contagem} itens={todosItens} />
                </>
              )
            })()}

            {tab === 'produtos' && (
              <>
                <StockTab itens={produtosFiltrados} contagem={contagemProd} onChange={setProd} minValues={minProd} labelPedir="produzir" />
                <button onClick={handleEnviar} style={{ width: '100%', padding: 12, borderRadius: 8, border: 'none', background: 'var(--teal)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', margin: '12px 0' }}>
                  Enviar contagem →
                </button>
              </>
            )}
          </>
        )}
      </div>

      {/* Modal Editar Mínimo */}
      {modalMin && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }} onClick={e => { if (e.target === e.currentTarget) setModalMin(null) }}>
          <div style={{ background: 'var(--bg-primary)', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 680, margin: '0 auto', maxHeight: '80vh', overflow: 'auto', padding: '20px 20px 32px' }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12 }}>Editar Estoque Mínimo</div>
            <input
              value={modalMin.busca}
              onChange={e => setModalMin(m => ({ ...m, busca: e.target.value }))}
              placeholder="Buscar..."
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14, boxSizing: 'border-box', marginBottom: 12 }}
            />
            {modalMin.itens.filter(i => norm(i.nome).includes(norm(modalMin.busca))).map(item => (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid #1e1e1e' }}>
                <div style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{item.nome}</div>
                <input
                  type="text" inputMode="decimal" min="0"
                  value={modalMin.values[item.id] ?? ''}
                  onChange={e => setModalMin(m => ({ ...m, values: { ...m.values, [item.id]: e.target.value } }))}
                  style={{ width: 80, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14, textAlign: 'right' }}
                />
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', width: 32 }}>{item.unidade}</span>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button onClick={() => setModalMin(null)} style={{ flex: 1, padding: 12, borderRadius: 8, border: '1px solid #444', background: 'transparent', color: 'var(--text-primary)', fontSize: 14, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={saveModalMin} disabled={savingMin} style={{ flex: 2, padding: 12, borderRadius: 8, border: 'none', background: 'var(--teal)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                {savingMin ? 'Salvando...' : 'Salvar mínimos'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
