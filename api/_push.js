import webpush from 'web-push'

// Chave pública (vai no app); a privada fica só no Vercel (VAPID_PRIVATE_KEY)
export const VAPID_PUBLIC_KEY = 'BBAeLcmO2DhWlfhYt7bv4pijgtxvxnA2QjdRX52LVXH1uEPJQoMcLtFPhWsChlmXMgfhtdFmQjLdq-eCkeTLMgA'

export function configurarWebPush() {
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!priv) throw new Error('Missing VAPID_PRIVATE_KEY')
  webpush.setVapidDetails('https://guaxi-app.vercel.app', VAPID_PUBLIC_KEY, priv)
  return webpush
}

// Envia pra várias inscrições; devolve as que morreram (410/404) pra limpeza
export async function enviarPara(subs, payload) {
  const wp = configurarWebPush()
  const corpo = JSON.stringify(payload)
  const res = await Promise.allSettled(subs.map(s => wp.sendNotification(s, corpo, { TTL: 6 * 3600 })))
  const mortas = [], erros = []
  res.forEach((r, i) => {
    if (r.status === 'fulfilled') return
    const code = r.reason?.statusCode
    if (code === 404 || code === 410) mortas.push(subs[i].endpoint)
    else erros.push(`${code || ''} ${r.reason?.body || r.reason?.message || ''}`.trim())
  })
  return { enviados: subs.length - mortas.length - erros.length, mortas, erros }
}
