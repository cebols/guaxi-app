import { useState, useMemo } from 'react'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { getInsumos, getEmbalagens, updateEstoqueInsumos, updateEstoqueEmbalagens } from '../services/db'

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
      return falta > 0 ? `${item.nome}: ${falta} ${item.unidade || ''}` : null
    })
    .filter(Boolean)

  if (pedir.length === 0) return (
    <div className="card" style={{ background: 'var(--ok-bg)', borderColor: '#3a6b1a', marginTop: 4 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ok-text)' }}>Tudo ok!</div>
      <div style={{ fontSize: 12, color: 'var(--ok-text)', marginTop: 2 }}>Estoque acima do mínimo em todos os itens</div>
    </div>
  )
  return (
    <div className="card" style={{ background: 'var(--warn-bg)', borderColor: '#6b4a1a', marginTop: 4 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--warn-text)', marginBottom: 4 }}>Lista de compras</div>
      {pedir.map((p, i) => (
        <div key={i} style={{ fontSize: 12, color: 'var(--warn-text)' }}>· {p}</div>
      ))}
    </div>
  )
}

function StockTab({ itens, contagem, onChange }) {
  const grupos = useMemo(() => groupBy(itens, 'categoria'), [itens])

  return (
    <>
      {Object.entries(grupos).map(([cat, items]) => (
        <div key={cat}>
          <div className="cat-header">{cat}</div>
          <div className="card card-flush" style={{ padding: '0 14px', marginBottom: 8 }}>
            {items.map(item => {
              const val = contagem[item.id] ?? (item.estoqueAtual ?? '')
              const falta = val !== '' ? calcPedir(val, item.estoqueMin) : null
              return (
                <div key={item.id} className="stock-row">
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{item.nome}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>mín. {item.estoqueMin} {item.unidade}</div>
                  </div>
                  <div>
                    <input
                      className="stock-input"
                      type="number"
                      min="0"
                      value={val}
                      placeholder="—"
                      onChange={e => onChange(item.id, e.target.value)}
                    />
                    {falta !== null && falta > 0 && <div className="pedir-txt">pedir {falta} {item.unidade}</div>}
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
  const { toast, show } = useToast()

  const [tab, setTab] = useState('insumos')
  const [contagemIns, setContagemIns] = useState({})
  const [contagemEmb, setContagemEmb] = useState({})
  const [saving, setSaving] = useState(false)

  const setIns = (id, val) => setContagemIns(c => ({ ...c, [id]: val }))
  const setEmb = (id, val) => setContagemEmb(c => ({ ...c, [id]: val }))

  const handleSave = async () => {
    setSaving(true)
    try {
      if (tab === 'insumos') {
        const payload = Object.entries(contagemIns)
          .filter(([, v]) => v !== '')
          .map(([id, v]) => ({ id: parseInt(id), estoqueAtual: parseFloat(v) }))
        await updateEstoqueInsumos(payload)
      } else {
        const payload = Object.entries(contagemEmb)
          .filter(([, v]) => v !== '')
          .map(([id, v]) => ({ id: parseInt(id), estoqueAtual: parseFloat(v) }))
        await updateEstoqueEmbalagens(payload)
      }
      show('Contagem salva!')
    } catch (e) {
      show('Erro: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const loading = tab === 'insumos' ? loadIns : loadEmb

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
          <button className={`tab-btn ${tab === 'insumos'    ? 'active' : ''}`} onClick={() => setTab('insumos')}>Insumos</button>
          <button className={`tab-btn ${tab === 'embalagens' ? 'active' : ''}`} onClick={() => setTab('embalagens')}>Embalagens</button>
        </div>

        {loading ? (
          <div className="loading">Carregando...</div>
        ) : tab === 'insumos' ? (
          <>
            <StockTab itens={insumos || []} contagem={contagemIns} onChange={setIns} />
            <ListaCompras contagem={contagemIns} itens={insumos || []} />
          </>
        ) : (
          <>
            <StockTab itens={embalagens || []} contagem={contagemEmb} onChange={setEmb} />
            <ListaCompras contagem={contagemEmb} itens={embalagens || []} />
          </>
        )}

        <button className="btn-primary" onClick={handleSave} disabled={saving || loading} style={{ marginTop: 16 }}>
          {saving ? 'Salvando...' : 'Salvar contagem'}
        </button>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
