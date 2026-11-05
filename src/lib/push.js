// Notificações push (lembrete de fim do dia) — lado do app
import { supabase } from './supabase'

export const VAPID_PUBLIC_KEY = 'BBAeLcmO2DhWlfhYt7bv4pijgtxvxnA2QjdRX52LVXH1uEPJQoMcLtFPhWsChlmXMgfhtdFmQjLdq-eCkeTLMgA'

export const suportaPush = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

// Inscreve no serviço de push do navegador, com erro explicado em português
async function inscrever(reg) {
  const atual = await reg.pushManager.getSubscription()
  if (atual) return atual
  try {
    return await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) })
  } catch (e) {
    if (/push service|registration failed/i.test(e?.message || '') || e?.name === 'AbortError') {
      throw new Error('O navegador deste aparelho recusou as notificações (serviço de push indisponível). ' +
        'No Brave: ative "Usar serviços do Google para mensagens push" em brave://settings/privacy. ' +
        'No Chrome/Edge: não use janela anônima e confira se as notificações estão permitidas pro site. ' +
        'No celular costuma funcionar direto.')
    }
    throw e
  }
}

async function registro() {
  // garante o service worker mesmo se o registro do main.jsx ainda não rodou
  const reg = await navigator.serviceWorker.getRegistration() || await navigator.serviceWorker.register('/sw.js')
  return navigator.serviceWorker.ready.then(() => reg)
}

export async function inscricaoAtual() {
  if (!suportaPush()) return null
  const reg = await registro()
  return reg.pushManager.getSubscription()
}

function nomeAparelho() {
  const ua = navigator.userAgent
  if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet'
  if (/Mobi|Android|iPhone/i.test(ua)) return 'celular'
  return 'computador'
}

export async function ativarLembrete(hora) {
  if (!suportaPush()) throw new Error('Este navegador não suporta notificações')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Permissão de notificação negada. Libere nas configurações do navegador/app.')
  const reg = await registro()
  const sub = await inscrever(reg)
  const j = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert({
    endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth,
    hora_lembrete: hora, fuso: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo',
    aparelho: nomeAparelho(), ativo: true,
  }, { onConflict: 'endpoint' })
  if (error) throw error
  return sub
}

// Avisos na hora (ex.: cliente chamou no WhatsApp) neste aparelho, sem mexer no
// horário do lembrete de fim do dia (aparelho novo entra sem lembrete).
export async function ativarAvisos() {
  if (!suportaPush()) throw new Error('Este navegador não suporta notificações')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Permissão de notificação negada. Libere nas configurações do navegador/app.')
  const reg = await registro()
  const sub = await inscrever(reg)
  const j = sub.toJSON()
  const { data: existe } = await supabase.from('push_subscriptions').select('id').eq('endpoint', j.endpoint).maybeSingle()
  const { error } = existe
    ? await supabase.from('push_subscriptions').update({ ativo: true }).eq('endpoint', j.endpoint)
    : await supabase.from('push_subscriptions').insert({
        endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, hora_lembrete: null,
        fuso: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo', aparelho: nomeAparelho(), ativo: true,
      })
  if (error) throw error
  return sub
}

// Este aparelho já recebe avisos?
export async function avisosAtivos() {
  try {
    const sub = await inscricaoAtual()
    if (!sub) return false
    const { data } = await supabase.from('push_subscriptions').select('ativo').eq('endpoint', sub.endpoint).maybeSingle()
    return !!data?.ativo
  } catch { return false }
}

export async function lerLembrete() {
  const sub = await inscricaoAtual()
  if (!sub) return null
  const { data, error } = await supabase.from('push_subscriptions').select('hora_lembrete, ativo, ultimo_envio').eq('endpoint', sub.endpoint).maybeSingle()
  if (error) throw error
  return data ? { ...data, sub } : null
}

export async function desativarLembrete() {
  const sub = await inscricaoAtual()
  if (!sub) return
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe().catch(() => {})
}

export async function testarLembrete() {
  const sub = await inscricaoAtual()
  if (!sub) throw new Error('Ative o lembrete neste aparelho primeiro')
  const { data: { session } } = await supabase.auth.getSession()
  const r = await fetch('/api/push-teste', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `erro ${r.status}`)
}
