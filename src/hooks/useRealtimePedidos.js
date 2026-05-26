import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

export function useRealtimePedidos(userId, onNovoPedido) {
  const channelRef = useRef(null)

  useEffect(() => {
    if (!userId) return

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }

    // Sem filter= para não depender de Realtime row filtering do Supabase
    const channel = supabase
      .channel(`encomendas_${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'encomendas' },
        (payload) => {
          const enc = payload.new
          // Filtra pelo user do admin logado
          if (enc.user_id !== userId) return

          if (onNovoPedido) onNovoPedido(enc)

          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Novo pedido recebido! 🛒', {
              body: `${enc.cliente || 'Cliente'} fez um pedido`,
              icon: '/favicon.ico',
            })
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] encomendas conectado')
        }
      })

    channelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])
}
