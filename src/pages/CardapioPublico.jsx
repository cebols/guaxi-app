import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { getCardapioPublico } from '../services/db'

const TEAL = '#0d9488'

const fmtR = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function Centered({ children }) {
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', color: '#64748b', fontSize: 15, fontFamily: 'system-ui, -apple-system, sans-serif', padding: 24, textAlign: 'center' }}>
      {children}
    </div>
  )
}

export default function CardapioPublico() {
  const { id } = useParams()
  const [estado, setEstado] = useState('carregando') // carregando | ok | erro
  const [data, setData] = useState(null)

  useEffect(() => {
    let vivo = true
    getCardapioPublico(id).then(res => {
      if (!vivo) return
      if (!res) { setEstado('erro'); return }
      setData(res)
      setEstado('ok')
      document.title = res.nomeLoja ? `${res.nomeLoja} · Cardápio` : 'Cardápio'
    })
    return () => { vivo = false }
  }, [id])

  if (estado === 'carregando') return <Centered>Carregando cardápio…</Centered>
  if (estado === 'erro') return <Centered>Cardápio não encontrado. Verifique o link.</Centered>

  const { nomeLoja, itens, comFotos } = data

  return (
    <div style={{ minHeight: '100dvh', background: '#f8fafc', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#0f172a' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '28px 16px 48px' }}>
        {/* Cabeçalho */}
        <div style={{ borderBottom: `3px solid ${TEAL}`, paddingBottom: 14, marginBottom: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
          <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.15 }}>{nomeLoja || 'Cardápio'}</div>
          <div style={{ fontSize: 12, fontWeight: 800, color: TEAL, letterSpacing: 1.5, whiteSpace: 'nowrap' }}>CARDÁPIO</div>
        </div>

        {itens.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 14, textAlign: 'center', padding: 40 }}>Nenhum produto neste cardápio.</div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {itens.map((p, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, alignItems: 'center' }}>
                {comFotos && (
                  p.imagemUrl
                    ? <img src={p.imagemUrl} alt="" style={{ width: 64, height: 64, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                    : <div style={{ width: 64, height: 64, borderRadius: 8, background: '#f1f5f9', flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{p.nome}</div>
                  {p.descricao ? <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{p.descricao}</div> : null}
                </div>
                {p.preco > 0 && (
                  <div style={{ fontSize: 16, fontWeight: 800, color: TEAL, whiteSpace: 'nowrap' }}>R$ {fmtR(p.preco)}</div>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: 28, fontSize: 11, color: '#94a3b8' }}>
          Cardápio gerado no Guaxi
        </div>
      </div>
    </div>
  )
}
