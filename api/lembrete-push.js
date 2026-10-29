import { enviarPara } from './_push.js'

// Chamado pelo pg_cron do Supabase (enviar_lembretes_push), que já escolhe
// quem está na hora e manda as inscrições no corpo. Protegido por CRON_SECRET.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' })
  try {
    const { subs = [], titulo, corpo, url } = req.body || {}
    if (!subs.length) return res.status(200).json({ enviados: 0 })
    const out = await enviarPara(subs, {
      title: titulo || 'Fechar o dia',
      body: corpo || 'Atualiza o Prontidão: o que saiu, o que foi pro degelo e o que fica pra amanhã.',
      url: url || '/prontidao',
      tag: 'lembrete-fim-do-dia',
    })
    res.status(200).json(out)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
