import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

export function useRealtimePedidos(userId, onNovoPedido) {
  const channelRef = useRef(null)

  useEffect(() => {
    if (!userId) return

    async function requestPermission() {
      if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission()
      }
    }
    requestPermission()

    const channel = supabase
      .channel(`pedidos_${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'encomendas',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const enc = payload.new
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

    channelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])
}
