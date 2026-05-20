import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'

const PAD = 10

export function SpotlightHint({ targetRef, stepKey, title, body, show: showProp = true }) {
  const [rect, setRect] = useState(null)
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(`hint_${stepKey}`) === '1'
  )

  useEffect(() => {
    if (dismissed) return
    const update = () => {
      const el = targetRef?.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    }
    // slight delay so layout is stable
    const t = setTimeout(update, 120)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      clearTimeout(t)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [targetRef, dismissed])

  if (!showProp || dismissed || !rect) return null

  const dismiss = () => {
    sessionStorage.setItem(`hint_${stepKey}`, '1')
    setDismissed(true)
  }

  const holeTop  = rect.top  - PAD
  const holeLeft = rect.left - PAD
  const holeW    = rect.width  + PAD * 2
  const holeH    = rect.height + PAD * 2

  const TOOLTIP_H = 170
  const tipLeft = Math.max(16, Math.min(holeLeft, window.innerWidth - 312))
  // prefer below, fall back to above if not enough space
  const spaceBelow = window.innerHeight - (holeTop + holeH)
  const tipTop = spaceBelow >= TOOLTIP_H + 14
    ? holeTop + holeH + 14
    : Math.max(16, holeTop - TOOLTIP_H - 14)

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9000, pointerEvents: 'none' }}>
      {/* SVG overlay with hole */}
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <mask id={`sm-${stepKey}`}>
            <rect width="100%" height="100%" fill="white" />
            <rect
              x={holeLeft} y={holeTop}
              width={holeW} height={holeH}
              rx={10}
              fill="black"
            />
          </mask>
        </defs>
        <rect
          width="100%" height="100%"
          fill="rgba(0,0,0,0.72)"
          mask={`url(#sm-${stepKey})`}
        />
      </svg>

      {/* Glow border around target */}
      <div style={{
        position: 'absolute',
        top: holeTop, left: holeLeft,
        width: holeW, height: holeH,
        borderRadius: 10,
        border: '2px solid var(--teal)',
        boxShadow: '0 0 0 1px rgba(34,184,134,0.3), 0 0 20px rgba(34,184,134,0.4)',
        pointerEvents: 'none',
      }} />

      {/* Tooltip */}
      <div style={{
        position: 'absolute',
        top: tipTop, left: tipLeft,
        width: 296,
        background: '#1a2e26',
        border: '1px solid var(--teal)',
        borderRadius: 14,
        padding: '14px 16px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        pointerEvents: 'auto',
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--teal)', marginBottom: 6 }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14, lineHeight: 1.5 }}>
          {body}
        </div>
        <button
          onClick={dismiss}
          style={{
            background: 'var(--teal)', color: '#fff', border: 'none',
            borderRadius: 8, padding: '8px 0', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', width: '100%',
          }}
        >
          Entendi ✓
        </button>
      </div>
    </div>,
    document.body
  )
}
