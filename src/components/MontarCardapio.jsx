import { useState, useMemo } from 'react'
import { calcPrecos } from '../hooks/useConfig'
import { saveCardapio } from '../services/db'
import { ItemThumb } from './ItemThumb'

const fmtR = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const PRECO_OPTS = [
  { id: 'direta', label: 'Direta' },
  { id: 'p99',    label: '99Food' },
  { id: 'ifood',  label: 'iFood' },
]

export function MontarCardapio({ produtos, nomeLoja, cfg, custoSacola, secoesOrdem = [], onClose }) {
  const [sel, setSel] = useState([])
  const [size, setSize] = useState('a4')
  const [comFotos, setComFotos] = useState(true)
  const [precoTipo, setPrecoTipo] = useState('direta')
  const [gerando, setGerando] = useState(false)
  const [gerandoLink, setGerandoLink] = useState(false)
  const [link, setLink] = useState('')
  const [copiado, setCopiado] = useState(false)

  const lista = produtos || []

  const precoFor = (prod) => {
    const precos = calcPrecos(prod.custoTotal, cfg, custoSacola)
    if (precoTipo === 'direta') return prod.precoDireta ?? precos.base
    if (precoTipo === 'p99')    return prod.preco99 ?? precos.p99
    return prod.precoIfood ?? precos.pIfood
  }

  const itensCardapio = useMemo(() => {
    const items = lista.filter(p => sel.includes(p.id)).map(p => ({
      nome: p.nome,
      descricao: p.descricao || '',
      categoria: p.secao || '',
      preco: precoFor(p),
      imagemUrl: p.imagemUrl || null,
    }))
    if (secoesOrdem.length > 0) {
      items.sort((a, b) => {
        const ia = secoesOrdem.indexOf(a.categoria)
        const ib = secoesOrdem.indexOf(b.categoria)
        const ra = ia === -1 ? 999 : ia
        const rb = ib === -1 ? 999 : ib
        return ra - rb
      })
    }
    return items
  }, [sel, precoTipo, lista, secoesOrdem])

  const handleGerar = async () => {
    if (itensCardapio.length === 0) return
    setGerando(true)
    try {
      const [{ pdf }, { CardapioDocument }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('./CardapioPDF'),
      ])
      const blob = await pdf(
        <CardapioDocument produtos={itensCardapio} nomeLoja={nomeLoja} size={size} comFotos={comFotos} />
      ).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `cardapio-${new Date().toISOString().slice(0, 10)}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      onClose()
    } catch (e) {
      alert('Erro ao gerar PDF: ' + e.message)
    } finally {
      setGerando(false)
    }
  }

  const handleGerarLink = async () => {
    if (itensCardapio.length === 0) return
    setGerandoLink(true)
    setCopiado(false)
    try {
      const id = await saveCardapio({
        nomeLoja,
        dados: { itens: itensCardapio, comFotos },
      })
      setLink(`${window.location.origin}/cardapio/${id}`)
    } catch (e) {
      alert('Erro ao gerar link: ' + e.message)
    } finally {
      setGerandoLink(false)
    }
  }

  const copiarLink = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {}
  }

  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-title">
          <span>Montar cardápio</span>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer' }} onClick={onClose}>×</button>
        </div>

        {/* Tamanho */}
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Tamanho</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {[
            { id: 'a4', label: 'A4', desc: '2 colunas' },
            { id: 'a5', label: 'A5', desc: '1 coluna' },
          ].map(s => (
            <button key={s.id} onClick={() => setSize(s.id)} style={{
              flex: 1, padding: '10px 8px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
              border: size === s.id ? '2px solid var(--teal)' : '1px solid var(--border)',
              background: size === s.id ? 'rgba(20,184,166,0.08)' : 'var(--card-bg)',
            }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: size === s.id ? 'var(--teal)' : 'var(--text-primary)' }}>{s.label}</div>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>{s.desc}</div>
            </button>
          ))}
        </div>

        {/* Preço + Fotos */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Preço exibido</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {PRECO_OPTS.map(o => (
                <button key={o.id} onClick={() => setPrecoTipo(o.id)} style={{
                  flex: 1, padding: '7px 0', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                  border: precoTipo === o.id ? '2px solid var(--teal)' : '1px solid var(--border)',
                  background: precoTipo === o.id ? 'rgba(20,184,166,0.08)' : 'transparent',
                  color: precoTipo === o.id ? 'var(--teal)' : 'var(--text-secondary)',
                  fontWeight: precoTipo === o.id ? 700 : 400,
                }}>{o.label}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Fotos</div>
            <button onClick={() => setComFotos(v => !v)} style={{
              padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontWeight: 600,
              border: comFotos ? '2px solid var(--teal)' : '1px solid var(--border)',
              background: comFotos ? 'rgba(20,184,166,0.08)' : 'transparent',
              color: comFotos ? 'var(--teal)' : 'var(--text-secondary)',
            }}>{comFotos ? 'Com fotos' : 'Sem fotos'}</button>
          </div>
        </div>

        {/* Preview */}
        {itensCardapio.length > 0 && (
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 9, color: 'var(--teal)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              Preview · {size.toUpperCase()}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '2px solid var(--teal)', paddingBottom: 8, marginBottom: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 18, color: '#111' }}>{nomeLoja || 'Cardápio'}</div>
              <div style={{ fontSize: 11, color: 'var(--teal)', fontWeight: 700, letterSpacing: 1 }}>CARDÁPIO</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: size === 'a5' ? '1fr' : '1fr 1fr', gap: 8 }}>
              {itensCardapio.slice(0, 6).map((p, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, border: '0.5px solid var(--border)', borderRadius: 6, padding: 6 }}>
                  {comFotos && <ItemThumb url={p.imagemUrl} nome={p.nome} size={44} radius={4} />}
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.nome}</div>
                    {p.preco > 0 && <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--teal)', marginTop: 2 }}>R$ {fmtR(p.preco)}</div>}
                  </div>
                </div>
              ))}
            </div>
            {itensCardapio.length > 6 && (
              <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-secondary)', marginTop: 8 }}>
                + {itensCardapio.length - 6} produto(s)
              </div>
            )}
          </div>
        )}

        {/* Seleção */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <input type="checkbox"
              checked={sel.length === lista.length && lista.length > 0}
              onChange={e => setSel(e.target.checked ? lista.map(p => p.id) : [])}
            /> Todos os produtos
          </label>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{sel.length} selecionado(s)</span>
        </div>
        <div style={{ maxHeight: '40vh', overflowY: 'auto', marginBottom: 16 }}>
          {lista.map(prod => (
            <label key={prod.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
              <input type="checkbox"
                checked={sel.includes(prod.id)}
                onChange={e => setSel(s => e.target.checked ? [...s, prod.id] : s.filter(id => id !== prod.id))}
              />
              <ItemThumb url={prod.imagemUrl} nome={prod.nome} size={36} radius={6} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{prod.nome}</div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal)' }}>R$ {fmtR(precoFor(prod))}</div>
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            disabled={!itensCardapio.length || gerando}
            onClick={handleGerar}
            style={{
              flex: 1, padding: '13px', borderRadius: 10, border: 'none', fontSize: 14,
              fontWeight: 700, cursor: itensCardapio.length && !gerando ? 'pointer' : 'not-allowed',
              background: itensCardapio.length ? 'var(--teal)' : 'var(--border)', color: '#fff',
            }}>
            {gerando ? 'Gerando PDF…' : '📄 Baixar PDF'}
          </button>
          <button
            disabled={!itensCardapio.length || gerandoLink}
            onClick={handleGerarLink}
            style={{
              flex: 1, padding: '13px', borderRadius: 10, fontSize: 14, fontWeight: 700,
              cursor: itensCardapio.length && !gerandoLink ? 'pointer' : 'not-allowed',
              border: `2px solid ${itensCardapio.length ? 'var(--teal)' : 'var(--border)'}`,
              background: 'transparent', color: itensCardapio.length ? 'var(--teal)' : 'var(--text-secondary)',
            }}>
            {gerandoLink ? 'Gerando…' : '🔗 Gerar link'}
          </button>
        </div>
        {!itensCardapio.length && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', marginTop: 8 }}>
            Selecione produtos acima
          </div>
        )}

        {link && (
          <div style={{ marginTop: 12, padding: 12, background: 'var(--teal-light, rgba(20,184,166,0.08))', borderRadius: 10, border: '1px solid var(--teal)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal)', marginBottom: 6 }}>
              Link público do cardápio
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
              Link fixo da loja — gerar de novo atualiza este mesmo link.
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                readOnly
                value={link}
                onFocus={e => e.target.select()}
                style={{ flex: 1, minWidth: 0, fontSize: 12, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text-primary)' }}
              />
              <button onClick={copiarLink} style={{
                padding: '8px 12px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 700,
                cursor: 'pointer', background: 'var(--teal)', color: '#fff', whiteSpace: 'nowrap',
              }}>
                {copiado ? '✓ Copiado' : 'Copiar'}
              </button>
            </div>
            <a href={link} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 8, fontSize: 12, color: 'var(--teal)', fontWeight: 600 }}>
              Abrir cardápio →
            </a>
          </div>
        )}
      </div>
    </>
  )
}
