import { useState } from 'react'
import { fetchIfoodCatalog } from '../services/ifood'
import { saveProduto } from '../services/db'
import { ItemThumb } from './ItemThumb'

const fmtR = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function ImportariFood({ onClose, onImported }) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')
  const [result, setResult] = useState(null) // { merchant, items }
  const [sel, setSel] = useState([])
  const [salvando, setSalvando] = useState(false)

  const buscar = async () => {
    if (!url.trim()) return
    setLoading(true); setErro(''); setResult(null)
    try {
      const data = await fetchIfoodCatalog(url.trim())
      if (!data.items?.length) { setErro('Nenhum produto encontrado nessa loja.'); return }
      setResult(data)
      setSel(data.items.map((_, i) => i))
    } catch (e) {
      setErro(e.message)
    } finally {
      setLoading(false)
    }
  }

  const toggle = i => setSel(s => s.includes(i) ? s.filter(x => x !== i) : [...s, i])
  const allSel = result && sel.length === result.items.length

  const importar = async () => {
    if (!result || sel.length === 0) return
    setSalvando(true)
    try {
      const escolhidos = sel.map(i => result.items[i])
      await Promise.all(escolhidos.map(p => saveProduto({
        nome: p.nome,
        tipo: 'avulso',
        custoDireto: '',
        precoDireta: p.preco || '',
        preco99: '',
        precoIfood: p.preco || '',
        fornecedor: result.merchant || 'iFood',
        whatsapp: '',
        linkCompra: '',
        estoqueMin: '',
        imagemUrl: p.imagemUrl || '',
        componentes: [],
      }, [], [])))
      onImported(escolhidos.length)
      onClose()
    } catch (e) {
      setErro('Erro ao salvar: ' + e.message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div className="sheet" style={{ maxWidth: 540 }}>
        <div className="sheet-title">
          <span>Importar do iFood</span>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer' }} onClick={onClose}>×</button>
        </div>

        {!result ? (
          <>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>
              Cole o link de uma loja do iFood. O app lê o cardápio e importa os produtos com nome, preço e foto.
            </div>
            <input
              className="field-input"
              placeholder="https://www.ifood.com.br/delivery/..."
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && buscar()}
            />
            {erro && <div style={{ fontSize: 12, color: 'var(--danger, #ef4444)', marginBottom: 10 }}>{erro}</div>}
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 14 }}>
              Funciona apenas no app publicado (não em desenvolvimento local).
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={onClose} className="btn-secondary" style={{ flex: 1 }}>Cancelar</button>
              <button onClick={buscar} disabled={!url.trim() || loading} className="btn-primary" style={{ flex: 2 }}>
                {loading ? 'Buscando…' : 'Buscar cardápio'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, marginBottom: 4 }}>
              {result.merchant && <span style={{ fontWeight: 700 }}>{result.merchant} · </span>}
              <span style={{ color: 'var(--text-secondary)' }}>{result.items.length} produtos encontrados</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '10px 0 8px' }}>
              <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={allSel}
                  onChange={e => setSel(e.target.checked ? result.items.map((_, i) => i) : [])} />
                Todos
              </label>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{sel.length} selecionado(s)</span>
            </div>
            <div style={{ maxHeight: '48vh', overflowY: 'auto', marginBottom: 14 }}>
              {result.items.map((p, i) => (
                <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={sel.includes(i)} onChange={() => toggle(i)} />
                  <ItemThumb url={p.imagemUrl} nome={p.nome} size={40} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.nome}</div>
                    {p.categoria && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{p.categoria}</div>}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--teal)', whiteSpace: 'nowrap' }}>
                    {p.preco > 0 ? fmtR(p.preco) : '—'}
                  </div>
                </label>
              ))}
            </div>
            {erro && <div style={{ fontSize: 12, color: 'var(--danger, #ef4444)', marginBottom: 10 }}>{erro}</div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setResult(null); setSel([]) }} className="btn-secondary" style={{ flex: 1 }}>← Voltar</button>
              <button onClick={importar} disabled={sel.length === 0 || salvando} className="btn-primary" style={{ flex: 2 }}>
                {salvando ? 'Importando…' : `Importar ${sel.length} produto(s)`}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
