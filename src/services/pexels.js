const BASE = 'https://api.pexels.com/v1'

export async function pexelsSearch(query, perPage = 6) {
  const key = import.meta.env.VITE_PEXELS_KEY
  if (!key) return []
  try {
    const res = await fetch(
      `${BASE}/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=square&size=medium`,
      { headers: { Authorization: key } }
    )
    if (!res.ok) return []
    const json = await res.json()
    return (json.photos || []).map(p => ({
      id: p.id,
      thumb: p.src.small,
      url: p.src.medium,
    }))
  } catch {
    return []
  }
}
