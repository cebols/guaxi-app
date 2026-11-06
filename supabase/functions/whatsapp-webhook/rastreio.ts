// ── Rastreio automático da entrega ───────────────────────────────────────────
// Quando o motorista da Lalamove sai com os pedidos (envio vira PICKED_UP), o
// banco chama esta função (gatilho em envios). Cada cliente do envio recebe o
// link de rastreio pelo WhatsApp da Guaxí:
// - conversa aberta (cliente falou nas últimas 24h): mensagem normal, de graça;
// - fechada: modelo aprovado pela Meta, se WHATSAPP_TEMPLATE_RASTREIO existir;
// - sem como mandar: avisa a dona no celular pra mandar pelo app.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { OWNER_USER_ID } from './cardapio.ts'
import { sendMetaMessage } from './providers.ts'

const JANELA_MS = 24 * 3600e3
const soDigitos = (s: string) => String(s || '').replace(/\D/g, '')

interface Cfg { phoneNumberId: string; accessToken: string }

async function enviarModelo(to: string, nome: string, pedido: string, link: string, cfg: Cfg): Promise<boolean> {
  const modelo = Deno.env.get('WHATSAPP_TEMPLATE_RASTREIO')
  if (!modelo) return false
  const r = await fetch(`https://graph.facebook.com/v19.0/${cfg.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to, type: 'template',
      template: {
        name: modelo, language: { code: Deno.env.get('WHATSAPP_TEMPLATE_IDIOMA') || 'pt_BR' },
        components: [{ type: 'body', parameters: [nome || 'oi', pedido, link].map(text => ({ type: 'text', text })) }],
      },
    }),
  })
  if (!r.ok) console.error('modelo rastreio', r.status, await r.text().catch(() => ''))
  return r.ok
}

export async function avisarRastreio(sb: SupabaseClient, envioId: number, cfg: Cfg) {
  const { data: envio } = await sb.from('envios').select('id, status, share_link').eq('id', envioId).maybeSingle()
  const link = String(envio?.share_link || '')
  if (!envio || !link) return { enviados: 0, pendentes: [] as string[], motivo: 'sem link' }

  const [{ data: peds }, { data: ats }] = await Promise.all([
    sb.from('encomendas').select('id, cliente, contato, status, rastreio_auto, rastreio_enviado_em').eq('envio_id', envioId),
    sb.from('atendimentos').select('telefone, ultima_msg_cliente_em'),
  ])
  const agora = new Date().toISOString()
  let enviados = 0
  const pendentes: string[] = []

  for (const p of (peds || []) as Record<string, unknown>[]) {
    if (p.status === 'Cancelado' || p.rastreio_auto === false || p.rastreio_enviado_em) continue
    const nome = String(p.cliente || '').trim().split(/\s+/)[0]
    const fim = soDigitos(String(p.contato || '')).slice(-8)
    const at = fim.length === 8 ? ((ats || []) as Record<string, unknown>[]).find(a => String(a.telefone).endsWith(fim)) : null
    const destino = at ? String(at.telefone) : (soDigitos(String(p.contato || '')).length >= 10 ? (s => s.startsWith('55') ? s : `55${s}`)(soDigitos(String(p.contato))) : '')
    if (!destino) { pendentes.push(nome || String(p.id)); continue }

    const aberta = at?.ultima_msg_cliente_em && Date.now() - new Date(String(at.ultima_msg_cliente_em)).getTime() < JANELA_MS
    const texto = `Oi${nome ? `, ${nome}` : ''}! Seu pedido ${p.id} saiu pra entrega 🛵 Dá pra acompanhar o motorista por aqui: ${link}`
    let ok = false
    try {
      if (aberta) { await sendMetaMessage(destino, texto, cfg); ok = true }
      else ok = await enviarModelo(destino, nome, String(p.id), link, cfg)
    } catch (e) { console.error('rastreio', p.id, e) }

    if (!ok) { pendentes.push(nome || String(p.id)); continue }
    enviados++
    await sb.from('encomendas').update({ rastreio_enviado_em: agora }).eq('id', p.id)
    if (at) {
      await sb.from('agent_conversas').insert({ telefone: destino, role: 'assistant', conteudo: texto, user_id: OWNER_USER_ID })
      await sb.from('atendimentos').update({ ultima_msg_em: agora }).eq('telefone', destino)
    }
  }

  if (pendentes.length) {
    const { error } = await sb.rpc('avisar_dono', {
      p_user_id: OWNER_USER_ID, p_titulo: '🛵 Saiu pra entrega',
      p_corpo: `Manda o link de rastreio pra ${pendentes.join(', ')} — a conversa no WhatsApp da Guaxí tá fechada.`,
      p_url: '/envios', p_tag: `rastreio-${envioId}`,
    })
    if (error) console.error('avisar_dono', error.message)
  }
  return { enviados, pendentes }
}
