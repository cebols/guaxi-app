import { useState, useRef } from 'react'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { getInsumos, getEmbalagens, getProdutos, updateEstoqueInsumos, updateEstoqueEmbalagens, updateEstoqueProdutos, updateEstoqueMinProdutos } from '../services/db'

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

function StockTab({ itens, contagem, onChange, minValues, onChangeMin, labelPedir = 'pedir' }) {
  const grupos = groupBy(itens, 'categoria')
  return (
    <>
      {Object.entries(grupos).map(([cat, items]) => (
        <div key={cat}>
          <div className="cat-header">{cat}</div>
          <div className="card card-flush" style={{ padding: '0 14px', marginBottom: 8 }}>
            {items.map(item => {
              const val = contagem[item.id] ?? (item.estoqueAtual ?? '')
              const effectiveMin = onChangeMin ? (minValues?.[item.id] ?? item.estoqueMin) : item.estoqueMin
              const falta = val !== '' ? calcPedir(val, effectiveMin) : null
              return (
                <div key={item.id} className="stock-row">
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{item.nome}</div>
                    {onChangeMin ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>mín.</span>
                        <input
                          className="stock-input"
                          type="number" inputMode="decimal"
                          min="0"
                          style={{ width: 52 }}
                          value={minValues?.[item.id] ?? item.estoqueMin}
                          onChange={e => onChangeMin(item.id, e.target.value)}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.unidade}</span>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>mín. {item.estoqueMin} {item.unidade}</div>
                    )}
                  </div>
                  <div>
                    <input
                      className="stock-input"
                      type="number" inputMode="decimal"
                      min="0"
                      value={val}
                      placeholder="—"
                      onChange={e => onChange(item.id, e.target.value)}
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

export default function Contagem() {
  const { data: insumos,    loading: loadIns } = useData(getInsumos)
  const { data: embalagens, loading: loadEmb } = useData(getEmbalagens)
  const { data: produtos,   loading: loadProd } = useData(getProdutos)
  const { toast, show } = useToast()

  const [tab, setTab] = useState('insumos')
  const [contagemIns,  setContagemIns]  = useState({})
  const [contagemEmb,  setContagemEmb]  = useState({})
  const [contagemProd, setContagemProd] = useState({})
  const [minProd,      setMinProd]      = useState({})
  const [autoSaveState, setAutoSaveState] = useState('idle')
  const debounceRef = useRef({})

  const autoSave = (type, id, val) => {
    const key = `${type}-${id}`
    if (debounceRef.current[key]) clearTimeout(debounceRef.current[key])
    setAutoSaveState('saving')
    debounceRef.current[key] = setTimeout(async () => {
      try {
        const payload = [{ id, estoqueAtual: val !== '' ? parseFloat(val) : null }]
        if (type === 'ins')  await updateEstoqueInsumos(payload)
        else if (type === 'emb') await updateEstoqueEmbalagens(payload)
        else await updateEstoqueProdutos(payload)
        setAutoSaveState('saved')
        setTimeout(() => setAutoSaveState('idle'), 1500)
      } catch (e) {
        show('Erro ao salvar: ' + e.message)
        setAutoSaveState('idle')
      }
    }, 700)
  }

  const autoSaveMin = (id, val) => {
    const key = `min-prod-${id}`
    if (debounceRef.current[key]) clearTimeout(debounceRef.current[key])
    setAutoSaveState('saving')
    debounceRef.current[key] = setTimeout(async () => {
      try {
        await updateEstoqueMinProdutos([{ id, estoqueMin: val }])
        setAutoSaveState('saved')
        setTimeout(() => setAutoSaveState('idle'), 1500)
      } catch (e) {
        show('Erro ao salvar: ' + e.message)
        setAutoSaveState('idle')
      }
    }, 700)
  }

  const setIns    = (id, val) => { setContagemIns(c  => ({ ...c, [id]: val })); autoSave('ins',  id, val) }
  const setEmb    = (id, val) => { setContagemEmb(c  => ({ ...c, [id]: val })); autoSave('emb',  id, val) }
  const setProd   = (id, val) => { setContagemProd(c => ({ ...c, [id]: val })); autoSave('prod', id, val) }
  const setMinP   = (id, val) => { setMinProd(m => ({ ...m, [id]: val })); autoSaveMin(id, val) }

  // Produtos as StockTab items (unidade = 'un', sem categoria → grupo por tipo)
  const produtosParaContagem = (produtos || [])
    .filter(p => p.tipo !== 'combo') // combos não têm estoque próprio
    .map(p => ({ ...p, unidade: 'un', categoria: p.tipo === 'avulso' ? 'Avulso' : 'Produzido' }))

  const loading = tab === 'insumos' ? loadIns : tab === 'embalagens' ? loadEmb : loadProd

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div>
            <div className="topbar-title">Contagem semanal</div>
            <div className="topbar-sub">Digite o estoque físico atual</div>
          </div>
          <div style={{ fontSize: 12, color: autoSaveState === 'saving' ? 'var(--text-secondary)' : autoSaveState === 'saved' ? 'var(--teal)' : 'transparent' }}>
            {autoSaveState === 'saving' ? 'Salvando...' : 'Salvo ✓'}
          </div>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 16 }}>
        <div className="tab-bar">
          <button className={`tab-btn ${tab === 'insumos'    ? 'active' : ''}`} onClick={() => setTab('insumos')}>Insumos</button>
          <button className={`tab-btn ${tab === 'embalagens' ? 'active' : ''}`} onClick={() => setTab('embalagens')}>Embalagens</button>
          <button className={`tab-btn ${tab === 'produtos'   ? 'active' : ''}`} onClick={() => setTab('produtos')}>Produtos</button>
        </div>

        {loading ? (
          <div className="loading">Carregando...</div>
        ) : tab === 'insumos' ? (
          <>
            <StockTab itens={insumos || []} contagem={contagemIns} onChange={setIns} />
            <ListaCompras contagem={contagemIns} itens={insumos || []} />
          </>
        ) : tab === 'embalagens' ? (
          <>
            <StockTab itens={embalagens || []} contagem={contagemEmb} onChange={setEmb} />
            <ListaCompras contagem={contagemEmb} itens={embalagens || []} />
          </>
        ) : (
          <StockTab itens={produtosParaContagem} contagem={contagemProd} onChange={setProd} minValues={minProd} onChangeMin={setMinP} labelPedir="produzir" />
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
