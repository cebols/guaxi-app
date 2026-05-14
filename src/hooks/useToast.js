import { useState, useCallback } from 'react'

export function useToast(duration = 2500) {
  const [toast, setToast] = useState(null)

  const show = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), duration)
  }, [duration])

  return { toast, show }
}
