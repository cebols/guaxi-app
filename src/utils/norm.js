export function norm(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

// Returns score: 3=exact, 2=substring, 1=all tokens found, 0=no match
export function fuzzyScore(query, candidate) {
  const q = norm(query)
  const c = norm(candidate)
  if (!q) return 0
  if (q === c) return 3
  if (c.includes(q)) return 2
  if (q.includes(c) && c.length > 3) return 2
  const tokens = q.split(/\s+/).filter(t => t.length > 1)
  if (tokens.length > 0 && tokens.every(t => c.includes(t))) return 1
  return 0
}

export function bestFuzzyMatch(query, list, getLabel = x => x) {
  let best = null, bestScore = 0
  for (const item of list) {
    const s = fuzzyScore(query, getLabel(item))
    if (s > bestScore) { bestScore = s; best = item }
  }
  return bestScore > 0 ? best : null
}
