import { useState, useEffect, useCallback, useRef } from 'react'

// Stale-while-revalidate cache keyed by the fetch function reference.
// Only dependency-free fetches are cached — that covers every named module
// fetcher (getInsumos, getVendas, …) without touching call sites. On revisit
// the cached value paints instantly while a fresh fetch runs in background.
const cache = new Map()

export function clearDataCache() {
  cache.clear()
}

export function useData(fetchFn, deps = []) {
  const fetchRef = useRef(fetchFn)
  fetchRef.current = fetchFn

  const cacheable = deps.length === 0
  const seeded = cacheable && cache.has(fetchFn)

  const [data, setData] = useState(seeded ? cache.get(fetchFn) : null)
  const [loading, setLoading] = useState(!seeded)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    const fn = fetchRef.current
    const hasCache = deps.length === 0 && cache.has(fn)
    if (!hasCache) setLoading(true)
    try {
      const result = await fn()
      if (deps.length === 0) cache.set(fn, result)
      setData(result)
    } catch (e) {
      setError(e.message)
      console.error('useData error:', e)
    } finally {
      setLoading(false)
    }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  return { data, loading, error, reload: load }
}
