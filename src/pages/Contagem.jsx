import { useState, useMemo } from 'react'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { getInsumos, getEmbalagens, updateEstoqueInsumos, updateEstoqueEmbalagens } from '../services/db'

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

  // Group by fornecedor for WhatsApp context
  const byFornecedor = useMemo(() => {
    const map = {}
    pedir.forEach(p => {
      const key = p.whatsapp || '__sem_contato__'
      if (!map[key]) map[key] = { fornecedor: p.fornecedor, whatsapp: p.whatsapp, items: [] }
      map[key].items.push(p)
    })
    return Object.values(map)
  }, [pedir])

  if (pedir.length === 0) return (
    <div className="card" style={{ background: 'var(--ok-bg)', borderColor: '#3a6b1a', marginTop: 4 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ok-text)' }}>Tudo ok!</div>
      <div style={{ fontSize: 12, color: 'var(--ok-text)', marginTop: 2 }}>Estoque acima do mínimo em todos os itens</div>
    </div>
  )

  return (
    <div className="card" style={{ background: 'var(--warn-bg)', borderColor: '#6b4a1a', marginTop: 4 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--warn-text)', marginBottom: 8 }}>Lista de compras</div>
      {byFornecedor.map((grupo, gi) => {
        const wa = waLink(grupo.whatsapp)
        const msg = grupo.items.map(p => `${p.nome}: ${p.falta} ${p.unidade}`).join('\n')
        const waComMsg = wa ? `${wa}?text=${encodeURIComponent(`Olá! Preciso pedir:\n${msg}`)}` : null
        return (
          <div key={gi} style={{ marginBottom: gi < byFornecedor.length - 1 ? 12 : 0 }}>
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
                  <a
                    href={p.linkCompra}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 11, color: 'var(--teal)', textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}
                  >
                    Ver loja
                  </a>
                )}
              </div>
            ))}
            {waComMsg && (
              <a
                href={waComMsg}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-block',
                  marginTop: 6,
                  fontSize: 12,
                  color: '#fff',
                  background: '#25d366',
                  borderRadius: 6,
                  padding: '4px 10px',
                  textDecoration: 'none',
                  fontWeight: 600,
                }}
              >
                Pedir no WhatsApp
              </a>
            )}
          </div>
        )
      })}
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
