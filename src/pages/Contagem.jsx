import { useState, useRef, useMemo } from 'react'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { getInsumos, getEmbalagens, getProdutos, updateEstoqueInsumos, updateEstoqueEmbalagens, updateEstoqueProdutos, updateEstoqueMinProdutos, updateEstoqueMinInsumos, updateEstoqueMinEmbalagens, registrarCompras, getCompras, deleteCompra } from '../services/db'

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

function ListaCompras({ contagem, itens }) {
  const pedir = itens
    .map(item => {
      const val = parseFloat(contagem[item.id] ?? item.estoqueAtual)
      const falta = calcPedir(val, item.estoqueMin)
      if (!falta || falta <= 0) return null
      return {
        id: item.id,
        nome: item.nome,
        falta,
        unidade: item.unidade || '',
        whatsapp: item.whatsapp || '',
        fornecedor: item.fornecedor || '',
        linkCompra: item.linkCompra || '',
      }
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
            {grupo.fornecedor && (
              <div style={{ fontSize: 11, color: 'var(--warn-text)', fontWeight: 600, marginBottom: 4, opacity: 0.8 }}>
                {grupo.fornecedor}
              </div>
            )}
            {grupo.items.map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span style={{ fontSize: 12, color: 'var(--warn-text)', flex: 1 }}>
                  · {p.nome}: {p.falta} {p.unidade}
                </span>
                {p.linkCompra && (
                  <a href={p.linkCompra} target="_blank" rel="noreferrer"
                    style={{ fontSize: 11, color: 'var(--teal)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                    Ver loja
                  </a>
                )}
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

function StockTab({ itens, contagem, onChange, minValues, labelPedir = 'pedir', filtro = 'todos' }) {
  // Apply filter
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

  // Flat ordered list for Enter-to-next navigation
  const orderedIds = useMemo(() =>
    Object.values(grupos).flat().map(i => i.id),
    [grupos]
  )
  const inputRefs = useRef({})
  const handleKey = (id) => (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const idx = orderedIds.indexOf(id)
      const nextId = orderedIds[idx + 1]
      if (nextId && inputRefs.current[nextId]) {
        inputRefs.current[nextId].focus()
        inputRefs.current[nextId].select()
      } else {
        e.target.blur()
      }
    }
  }

  if (filtered.length === 0) {
    return <div className="empty" style={{ marginTop: 24 }}><span>Nenhum item neste filtro</span></div>
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
                      value={val}
                      placeholder="—"
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

function fmt(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtQtd(v) {
  const n = Number(v || 0)
  return n % 1 === 0 ? String(n) : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

function GastosTab() {
  const { data: compras, loading, reload } = useData(getCompras)
  const { show, toast } = useToast()
  const [filtro, setFiltro] = useState('todos')

  const hoje = new Date()
  const mesAtual = hoje.toISOString().slice(0, 7) // YYYY-MM

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
      <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
        As compras são detectadas automaticamente quando o estoque sobe na contagem
      </span>
    </div>
  )

  return (
    <>
      {/* Resumo mês */}
      <div className="card" style={{ background: 'var(--bg-secondary)', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Gasto este mês</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--teal)', marginTop: 2 }}>
          R$ {fmt(totalMes)}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
          {filtradas.filter(c => c.data?.startsWith(mesAtual)).length} compras registradas
        </div>
      </div>

      {/* Filtro tipo */}
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

      {/* Lista por mês */}
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
                <div key={c.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 0',
                  borderBottom: i < itens.length - 1 ? '1px solid #222' : 'none',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.itemNome}
                    </div>
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
                  <button onClick={() => handleDelete(c.id)} style={{
                    background: 'none', border: 'none', color: '#555', fontSize: 16, cursor: 'pointer', padding: '4px 6px', flexShrink: 0,
                  }} title="Remover">×</button>
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

function fmtN(v) {
  const n = Number(v || 0)
  return n % 1 === 0 ? String(n) : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

function Recibo({ tab, itens, contagem, onConfirmar, onVoltar, saving }) {
  const tabLabel = { insumos: 'Insumos', embalagens: 'Embalagens', produtos: 'Produtos' }[tab]

  const alterados = itens.filter(item =>
    contagem[item.id] !== undefined && contagem[item.id] !== ''
  )

  const totalCompra = alterados.reduce((sum, item) => {
    const diff = parseFloat(contagem[item.id]) - (item.estoqueAtual ?? 0)
    return diff > 0 && item.custoUnit > 0 ? sum + diff * item.custoUnit : sum
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
            return (
              <div key={item.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                padding: '11px 0',
                borderBottom: i < alterados.length - 1 ? '1px solid #222' : 'none',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{item.nome}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {fmtN(old)} → <strong style={{ color: 'var(--text-primary)' }}>{fmtN(novo)}</strong> {item.unidade}
                  </div>
                </div>
                <div style={{ flexShrink: 0, textAlign: 'right' }}>
                  {diff > 0 && <div style={{ fontSize: 12, color: 'var(--teal)', fontWeight: 600 }}>+{fmtN(diff)} compra</div>}
                  {diff < 0 && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{fmtN(diff)} {item.unidade}</div>}
                  {diff === 0 && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>sem alteração</div>}
                </div>
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
          <button onClick={onVoltar} disabled={saving} style={{
            flex: 1, padding: 12, borderRadius: 8, border: '1px solid #444',
            background: 'transparent', color: 'var(--text-primary)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>← Editar</button>
          <button onClick={onConfirmar} disabled={saving} style={{
            flex: 2, padding: 12, borderRadius: 8, border: 'none',
            background: 'var(--teal)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>{saving ? 'Salvando...' : 'Confirmar contagem'}</button>
        </div>
      </div>
    </>
  )
}

export default function Contagem() {
  const { data: insumos,    loading: loadIns } = useData(getInsumos)
  const { data: embalagens, loading: loadEmb } = useData(getEmbalagens)
  const { data: produtos,   loading: loadProd } = useData(getProdutos)
  const { toast, show } = useToast()

  const [tab, setTab] = useState('insumos')
  const [busca, setBusca] = useState('')
  const [filtroContagem, setFiltroContagem] = useState('todos') // todos | faltando | naocontados
  const [contagemIns,  setContagemIns]  = useState({})
  const [contagemEmb,  setContagemEmb]  = useState({})
  const [contagemProd, setContagemProd] = useState({})
  const [minIns,  setMinIns]  = useState({})
  const [minEmb,  setMinEmb]  = useState({})
  const [minProd, setMinProd] = useState({})
  const [modalMin, setModalMin] = useState(null)  // { type, itens, values, busca }
  const [savingMin, setSavingMin] = useState(false)
  const [semEstoqueAberto, setSemEstoqueAberto] = useState(false)
  const [recibo,   setRecibo]  = useState(null)
  const [saving,   setSaving]  = useState(false)
  const debounceRef = useRef({})

  const setIns  = (id, val) => setContagemIns(c  => ({ ...c, [id]: val }))
  const setEmb  = (id, val) => setContagemEmb(c  => ({ ...c, [id]: val }))
  const setProd = (id, val) => setContagemProd(c => ({ ...c, [id]: val }))

  const produtosParaContagem = (produtos || [])
    .filter(p => p.tipo !== 'combo')
    .map(p => ({ ...p, unidade: 'un', categoria: p.tipo === 'avulso' ? 'Avulso' : 'Produzido' }))

  const itensDoTab = tab === 'insumos' ? (insumos || []) : tab === 'embalagens' ? (embalagens || []) : produtosParaContagem
  const contagemDoTab = tab === 'insumos' ? contagemIns : tab === 'embalagens' ? contagemEmb : contagemProd
  const minDoTab = tab === 'insumos' ? minIns : tab === 'embalagens' ? minEmb : minProd

  function norm(s) {
    return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  }

  const itensComEstoque  = useMemo(() => itensDoTab.filter(i => i.estoqueAtual > 0), [itensDoTab])
  const itensSemEstoque  = useMemo(() => itensDoTab.filter(i => !(i.estoqueAtual > 0)), [itensDoTab])

  const itensFiltrados = useMemo(() => {
    const q = norm(busca)
    if (!q) return itensComEstoque
    return itensComEstoque.filter(i => norm(i.nome).includes(q) || norm(i.categoria).includes(q))
  }, [itensComEstoque, busca])

  const itensSemEstoqueFiltrados = useMemo(() => {
    const q = norm(busca)
    if (!q) return itensSemEstoque
    return itensSemEstoque.filter(i => norm(i.nome).includes(q) || norm(i.categoria).includes(q))
  }, [itensSemEstoque, busca])

  function changeTab(key) {
    setTab(key)
    setBusca('')
  }

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
      const payload = itens.map(item => ({
        id: item.id,
        estoqueMin: parseFloat(values[item.id] ?? item.estoqueMin) || 0,
      }))
      if (type === 'insumos') {
        await updateEstoqueMinInsumos(payload)
        setMinIns(prev => { const n = { ...prev }; payload.forEach(p => n[p.id] = p.estoqueMin); return n })
      } else if (type === 'embalagens') {
        await updateEstoqueMinEmbalagens(payload)
        setMinEmb(prev => { const n = { ...prev }; payload.forEach(p => n[p.id] = p.estoqueMin); return n })
      } else {
        await updateEstoqueMinProdutos(payload)
        setMinProd(prev => { const n = { ...prev }; payload.forEach(p => n[p.id] = p.estoqueMin); return n })
      }
      setModalMin(null)
      show('Mínimos salvos!')
    } catch (e) {
      show('Erro: ' + e.message)
    } finally {
      setSavingMin(false)
    }
  }

  const handleEnviar = () => {
    const preenchidos = itensDoTab.filter(item => contagemDoTab[item.id] !== undefined && contagemDoTab[item.id] !== '')
    if (preenchidos.length === 0) { show('Nenhum valor preenchido'); return }
    setRecibo(tab)
  }

  const handleConfirmar = async () => {
    setSaving(true)
    try {
      const itens = recibo === 'insumos' ? (insumos || []) : recibo === 'embalagens' ? (embalagens || []) : produtosParaContagem
      const contagem = recibo === 'insumos' ? contagemIns : recibo === 'embalagens' ? contagemEmb : contagemProd

      const preenchidos = itens.filter(item => contagem[item.id] !== undefined && contagem[item.id] !== '')
      const payload = preenchidos.map(item => ({ id: item.id, estoqueAtual: parseFloat(contagem[item.id]) }))

      if (recibo === 'insumos')        await updateEstoqueInsumos(payload)
      else if (recibo === 'embalagens') await updateEstoqueEmbalagens(payload)
      else                              await updateEstoqueProdutos(payload)

      let comprasRegistradas = 0
      if (recibo !== 'produtos') {
        const tipo = recibo === 'insumos' ? 'insumo' : 'embalagem'
        const hoje = new Date().toISOString().split('T')[0]
        const diffs = preenchidos.map(item => ({
          item,
          novo: parseFloat(contagem[item.id]),
          old: parseFloat(item.estoqueAtual ?? 0),
        }))
        const novasCompras = diffs
          .filter(({ novo, old }) => novo > old)
          .map(({ item, novo, old }) => ({
            tipo,
            item_id: item.id,
            item_nome: item.nome,
            unidade: item.unidade || '',
            quantidade: novo - old,
            preco_unit: item.custoUnit || 0,
            total: (novo - old) * (item.custoUnit || 0),
            data: hoje,
          }))
        comprasRegistradas = novasCompras.length
        if (novasCompras.length > 0) await registrarCompras(novasCompras)
      }

      if (recibo === 'insumos')        setContagemIns({})
      else if (recibo === 'embalagens') setContagemEmb({})
      else                              setContagemProd({})

      setRecibo(null)
      show(comprasRegistradas > 0
        ? `Contagem salva! ${comprasRegistradas} compra(s) registrada(s)`
        : 'Contagem salva! Nenhuma compra detectada'
      )
    } catch (e) {
      show('Erro: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const loading = tab === 'insumos' ? loadIns : tab === 'embalagens' ? loadEmb : loadProd

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

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div>
            <div className="topbar-title">Contagem semanal</div>
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
            {/* Search + Editar Mínimo row */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--text-tertiary)', pointerEvents: 'none' }}>🔍</span>
                <input
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  placeholder="Buscar..."
                  style={{ width: '100%', paddingLeft: 32, paddingRight: busca ? 28 : 10, paddingTop: 9, paddingBottom: 9, borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14, boxSizing: 'border-box' }}
                />
                {busca && (
                  <button onClick={() => setBusca('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-tertiary)', fontSize: 16, cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
                )}
              </div>
              <button
                onClick={openModalMin}
                style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                Editar Mínimo
              </button>
            </div>

            {(tab === 'insumos' || tab === 'embalagens') && (() => {
              const contagem = tab === 'insumos' ? contagemIns : contagemEmb
              const onChange = tab === 'insumos' ? setIns : setEmb
              const minVals  = tab === 'insumos' ? minIns : minEmb
              const todosItens = tab === 'insumos' ? (insumos || []) : (embalagens || [])
              const semFiltrados = itensSemEstoqueFiltrados
              const mostrarSemEstoque = busca ? semFiltrados.length > 0 : semEstoqueAberto

              return (
                <>
                  {/* Filter chips */}
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

                  {/* Resultados sem estoque na busca */}
                  {busca && semFiltrados.length > 0 && (
                    <>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, margin: '12px 0 6px', textTransform: 'uppercase', letterSpacing: 1 }}>
                        Sem estoque
                      </div>
                      <StockTab itens={semFiltrados} contagem={contagem} onChange={onChange} minValues={minVals} filtro={filtroContagem} />
                    </>
                  )}

                  {/* Seção colapsável quando sem busca */}
                  {!busca && itensSemEstoque.length > 0 && (
                    <button
                      onClick={() => setSemEstoqueAberto(v => !v)}
                      style={{ width: '100%', textAlign: 'left', padding: '10px 14px', marginBottom: 8, borderRadius: 8, border: '1px dashed var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}
                    >
                      <span>Não contabilizados ({itensSemEstoque.length})</span>
                      <span>{semEstoqueAberto ? '▲' : '▼'}</span>
                    </button>
                  )}
                  {!busca && semEstoqueAberto && (
                    <StockTab itens={itensSemEstoque} contagem={contagem} onChange={onChange} minValues={minVals} />
                  )}

                  <button onClick={handleEnviar}
                    style={{ width: '100%', padding: '12px', borderRadius: 8, border: 'none', background: 'var(--teal)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', margin: '12px 0' }}>
                    Enviar contagem →
                  </button>
                  <ListaCompras contagem={contagem} itens={todosItens} />
                </>
              )
            })()}
            {tab === 'produtos' && (
              <>
                <StockTab itens={itensFiltrados} contagem={contagemProd} onChange={setProd} minValues={minProd} labelPedir="produzir" />
                <button
                  onClick={handleEnviar}
                  style={{ width: '100%', padding: '12px', borderRadius: 8, border: 'none', background: 'var(--teal)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', margin: '12px 0' }}
                >
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
