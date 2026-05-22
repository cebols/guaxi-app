// Chama a serverless function /api/ifood que lê o cardápio do iFood.
// Funciona apenas no deploy (Vercel) — em dev local /api não existe.
export async function fetchIfoodCatalog(url) {
  let res
  try {
    res = await fetch(`/api/ifood?url=${encodeURIComponent(url)}`)
  } catch {
    throw new Error('Falha de rede ao contatar o servidor.')
  }

  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('application/json')) {
    throw new Error('Importação do iFood só funciona no app publicado, não em desenvolvimento local.')
  }

  let json = {}
  try { json = await res.json() } catch {}
  if (!res.ok) {
    throw new Error(json.error || 'Erro ao buscar o cardápio do iFood.')
  }
  return json // { merchant, total, items: [{ nome, descricao, preco, categoria, imagemUrl }] }
}
