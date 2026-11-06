import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

const notifiedIds = new Set()

export function useRealtimePedidos(userId, onNovoPedido) {
  useEffect(() => {
    if (!userId) return

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }

    const channel = supabase
      .channel(`encomendas_${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'encomendas' },
        (payload) => {
          const enc = payload.new
          if (enc.user_id !== userId) return
          // Deduplica — Supabase pode entregar o evento mais de uma vez
          if (notifiedIds.has(enc.id)) return
          notifiedIds.add(enc.id)
          setTimeout(() => notifiedIds.delete(enc.id), 15000)

          if (onNovoPedido) onNovoPedido(enc)
          window.dispatchEvent(new CustomEvent('guaxi:pedido-mudou', { detail: enc }))

          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Novo pedido recebido! 🛒', {
              body: `${enc.cliente || 'Cliente'} fez um pedido`,
              icon: '/favicon.ico',
            })
          }
        }
      )
      // Mudou um pedido (ex.: o Pix caiu e ele virou Pago, ou cancelou sozinho): as telas abertas se atualizam
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'encomendas' },
        (payload) => {
          if (payload.new?.user_id !== userId) return
          window.dispatchEvent(new CustomEvent('guaxi:pedido-mudou', { detail: payload.new }))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])
}

// Recarrega a tela quando algum pedido muda (vem do canal acima). Junta mudanças em sequência.
export function usePedidoMudou(fn) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    let t
    const h = (e) => { clearTimeout(t); const d = e.detail; t = setTimeout(() => ref.current?.(d), 400) }
    window.addEventListener('guaxi:pedido-mudou', h)
    return () => { clearTimeout(t); window.removeEventListener('guaxi:pedido-mudou', h) }
  }, [])
}
