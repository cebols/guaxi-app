// Quem está chamando? Confere o token de login do Supabase (Authorization: Bearer
// <access_token>) e devolve o usuário — o userId NUNCA vem do corpo da requisição.
export async function usuarioLogado(req, sb) {
  const h = req.headers?.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : ''
  if (!token) return null
  try {
    const { data, error } = await sb.auth.getUser(token)
    return error ? null : (data?.user || null)
  } catch {
    return null
  }
}
