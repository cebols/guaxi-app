import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { pexelsSearch } from '../services/pexels'

export function PexelsPicker({ query, onPick, onSkip }) {
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    setLoading(true)
    pexelsSearch(query, 6).then(ps => {
      setPhotos(ps)
      setLoading(false)
      if (ps.length > 0) setSelected(ps[0].url)
    })
  }, [query])

  const confirm = () => onPick(selected)
  const skip = () => onSkip()

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)',
      zIndex: 8000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={skip}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#1a1a1a', borderRadius: '16px 16px 0 0', padding: '20px 16px 32px',
        width: '100%', maxWidth: 540,
      }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#fff', marginBottom: 4 }}>
          Imagem para "{query}"
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14 }}>
          Escolha uma ou pule — vamos usar a primeira automaticamente.
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-secondary)', fontSize: 13 }}>
            Buscando fotos…
          </div>
        ) : photos.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-secondary)', fontSize: 13 }}>
            Nenhuma foto encontrada.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
            {photos.map(p => (
              <div
                key={p.id}
                onClick={() => setSelected(p.url)}
                style={{
                  aspectRatio: '1', borderRadius: 10, overflow: 'hidden', cursor: 'pointer',
                  border: selected === p.url ? '2px solid var(--teal)' : '2px solid transparent',
                  boxShadow: selected === p.url ? '0 0 0 1px var(--teal)' : 'none',
                }}
              >
                <img src={p.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={skip} style={{
            flex: 1, padding: '12px 0', borderRadius: 10, border: '1px solid var(--border)',
            background: 'transparent', color: 'var(--text-secondary)', fontSize: 14, cursor: 'pointer',
          }}>
            Sem imagem
          </button>
          <button onClick={confirm} disabled={!selected} style={{
            flex: 2, padding: '12px 0', borderRadius: 10, border: 'none',
            background: selected ? 'var(--teal)' : '#333', color: '#fff',
            fontSize: 14, fontWeight: 600, cursor: selected ? 'pointer' : 'default',
          }}>
            Usar esta
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
