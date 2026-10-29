import { enviarPara } from './_push.js'

// Notificação de teste pro próprio aparelho. Exige o token de login do app.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const url = process.env.VITE_SUPABASE_URL, anon = process.env.VITE_SUPABASE_ANON_KEY
    const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: req.headers.authorization || '' } })
    if (!r.ok) return res.status(401).json({ error: 'login inválido' })
    const { subscription } = req.body || {}
    if (!subscription?.endpoint) return res.status(400).json({ error: 'subscription ausente' })
    const out = await enviarPara([subscription], {
      title: 'Teste do Guaxí ✓',
      body: 'Se você está vendo isso, o lembrete de fim do dia vai chegar neste aparelho.',
      url: '/prontidao',
      tag: 'teste',
    })
    if (out.erros.length || out.mortas.length) return res.status(502).json({ error: out.erros[0] || 'inscrição expirada — desative e ative de novo' })
    res.status(200).json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
