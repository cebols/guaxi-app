import { useState, useEffect, useRef, useMemo } from 'react'
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
  const [estado, setEstado]   = useState('carregando')
  const [data, setData]       = useState(null)
  const [activeSection, setActiveSection] = useState(null)
  const navRef = useRef(null)
  const tabRefs = useRef({})
  const sectionRefs = useRef({})
  const observerRef = useRef(null)
  const NAV_HEIGHT = 110 // px reserved for sticky header

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

  const sections = useMemo(() => {
    if (!data) return []
    const map = new Map()
    for (const item of data.itens) {
      const cat = item.categoria?.trim() || 'Geral'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat).push(item)
    }
    return [...map.entries()].map(([name, items]) => ({ name, id: slugify(name), items }))
  }, [data])

  const hasNav = sections.length > 1

  // IntersectionObserver for active section
  useEffect(() => {
    if (!hasNav || sections.length === 0) return
    observerRef.current?.disconnect()

    observerRef.current = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setActiveSection(e.target.id)
            break
          }
        }
      },
      { rootMargin: `-${NAV_HEIGHT}px 0px -55% 0px`, threshold: 0 }
    )

    for (const sec of sections) {
      const el = sectionRefs.current[sec.id]
      if (el) observerRef.current.observe(el)
    }
    return () => observerRef.current?.disconnect()
  }, [sections, hasNav])

  // Scroll active tab into view in the nav bar
  useEffect(() => {
    if (!activeSection) return
    const tab = tabRefs.current[activeSection]
    if (tab && navRef.current) {
      tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    }
  }, [activeSection])

  const scrollToSection = (secId) => {
    const el = document.getElementById(secId)
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY - NAV_HEIGHT + 4
    window.scrollTo({ top, behavior: 'smooth' })
    setActiveSection(secId)
  }

  if (estado === 'carregando') return <Centered>Carregando cardápio…</Centered>
  if (estado === 'erro')       return <Centered>Cardápio não encontrado. Verifique o link.</Centered>

  const { nomeLoja, comFotos } = data

  return (
    <div style={{ background: '#f8fafc', minHeight: '100dvh', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#0f172a' }}>

      {/* ── Sticky header ─────────────────────────────────── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 30, background: '#fff', borderBottom: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
        {/* Store name row */}
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '12px 16px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>{nomeLoja || 'Cardápio'}</div>
          <div style={{ fontSize: 11, fontWeight: 800, color: TEAL, letterSpacing: 1.5 }}>CARDÁPIO</div>
        </div>

        {/* Section tabs */}
        {hasNav && (
          <div
            ref={navRef}
            style={{
              display: 'flex', gap: 4, overflowX: 'auto', padding: '0 12px 10px',
              scrollbarWidth: 'none', msOverflowStyle: 'none',
              maxWidth: 720, margin: '0 auto',
            }}
          >
            <style>{`.nav-tabs-scroll::-webkit-scrollbar { display: none }`}</style>
            {sections.map(sec => {
              const active = activeSection === sec.id || (!activeSection && sections[0].id === sec.id)
              return (
                <button
                  key={sec.id}
                  ref={el => { tabRefs.current[sec.id] = el }}
                  onClick={() => scrollToSection(sec.id)}
                  style={{
                    flexShrink: 0, padding: '6px 14px', borderRadius: 20,
                    fontSize: 13, fontWeight: active ? 700 : 500, cursor: 'pointer',
                    border: 'none',
                    background: active ? TEAL : 'transparent',
                    color: active ? '#fff' : '#64748b',
                    transition: 'background .15s, color .15s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {sec.name}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Content ───────────────────────────────────────── */}
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '20px 16px 60px' }}>
        {data.itens.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 14, textAlign: 'center', padding: 40 }}>Nenhum produto neste cardápio.</div>
        ) : (
          sections.map(sec => (
            <div
              key={sec.id}
              id={sec.id}
              ref={el => { sectionRefs.current[sec.id] = el }}
              style={{ marginBottom: 32 }}
            >
              {hasNav && (
                <div style={{ fontSize: 13, fontWeight: 800, color: TEAL, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 12, paddingBottom: 8, borderBottom: `2px solid ${TEAL}` }}>
                  {sec.name}
                </div>
              )}
              <div style={{ display: 'grid', gap: 10 }}>
                {sec.items.map((p, i) => (
                  <ProductRow key={i} produto={p} comFotos={comFotos} />
                ))}
              </div>
            </div>
          ))
        )}

        <div style={{ textAlign: 'center', marginTop: 8, fontSize: 11, color: '#94a3b8' }}>
          Cardápio gerado no Guaxi
        </div>
      </div>
    </div>
  )
}

function ProductRow({ produto: p, comFotos }) {
  return (
    <div style={{ display: 'flex', gap: 12, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, alignItems: 'center' }}>
      {comFotos && (
        p.imagemUrl
          ? (
            <div style={{ width: 80, flexShrink: 0, borderRadius: 8, overflow: 'hidden', aspectRatio: '4/3', background: '#f1f5f9' }}>
              <img src={p.imagemUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </div>
          )
          : <div style={{ width: 80, aspectRatio: '4/3', borderRadius: 8, background: '#f1f5f9', flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{p.nome}</div>
        {p.descricao && <div style={{ fontSize: 12, color: '#64748b', marginTop: 3, lineHeight: 1.4 }}>{p.descricao}</div>}
      </div>
      {p.preco > 0 && (
        <div style={{ fontSize: 16, fontWeight: 800, color: TEAL, whiteSpace: 'nowrap', flexShrink: 0 }}>R$ {fmtR(p.preco)}</div>
      )}
    </div>
  )
}

function slugify(str) {
  return str.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}
