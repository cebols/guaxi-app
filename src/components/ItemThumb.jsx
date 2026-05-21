const COLORS = ['#22b886', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4']

function colorFor(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xfffffff
  return COLORS[h % COLORS.length]
}

export function ItemThumb({ url, nome, size = 40, radius = 8 }) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        style={{ width: size, height: size, borderRadius: radius, objectFit: 'cover', flexShrink: 0, display: 'block' }}
        onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling?.style && (e.currentTarget.nextSibling.style.display = 'flex') }}
      />
    )
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: radius, flexShrink: 0,
      background: colorFor(nome || '?'),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.4, fontWeight: 700, color: '#fff',
    }}>
      {(nome || '?').charAt(0).toUpperCase()}
    </div>
  )
}
