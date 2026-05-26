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

          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Novo pedido recebido! 🛒', {
              body: `${enc.cliente || 'Cliente'} fez um pedido`,
              icon: '/favicon.ico',
            })
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])
}
