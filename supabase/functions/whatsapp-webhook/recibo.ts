// ── Recibo pelo WhatsApp ─────────────────────────────────────────────────────
// Quem pede pelo cardápio toca em "Confirmar no WhatsApp" no fim e manda
// "Oi! Fiz o pedido PED-021". A GuaxiMina responde na hora com o recibo — sem
// passar pelo modelo (resposta fixa e confiável) e só pro número do pedido.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { OWNER_USER_ID } from './cardapio.ts'

const COD = /\bPED[-\s]?#?(\d{1,6})\b/i
const soDigitos = (s: string) => String(s || '').replace(/\D/g, '')
const fmtR = (v: number) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const PERIODO: Record<string, string> = { manha: 'manhã (9–12h)', tarde: 'tarde (12–18h)', noite: 'noite (18–22h)' }
const dia = (s: string) => {
  const d = new Date(s + 'T12:00:00')
  return `${DIAS[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

export interface Recibo { resposta: string; outroNumero: boolean; pedidoId: string }

export async function reciboDoPedido(sb: SupabaseClient, telefone: string, texto: string): Promise<Recibo | null> {
  const m = String(texto || '').match(COD)
  if (!m) return null
  const pedidoId = `PED-${m[1].padStart(3, '0')}`
  const { data: p } = await sb.from('encomendas')
    .select('id, cliente, contato, data_entrega, periodo, tipo_entrega, endereco, valor, frete, pgto, status, encomenda_itens(produto, quantidade, preco_unit)')
    .eq('user_id', OWNER_USER_ID).eq('id', pedidoId).maybeSingle()
  if (!p) return null   // código que não existe: segue a conversa normal

  const fim = soDigitos(telefone).slice(-8)
  if (fim.length < 8 || !soDigitos(String(p.contato || '')).endsWith(fim)) {
    // Pedido feito com outro número: não mostra nada dele aqui, chama a Guaxí
    return {
      pedidoId, outroNumero: true,
      resposta: `Oii! Eu sou a GuaxiMina, a guaxinim virtual da Guaxí 🦝 Vi que o pedido *${pedidoId}* foi feito com outro número de WhatsApp, então uma pessoa da Guaxí já vai confirmar tudo com você por aqui 💛`,
    }
  }

  const nome = String(p.cliente || '').trim().split(/\s+/)[0]
  const itens = ((p.encomenda_itens || []) as { produto: string; quantidade: number; preco_unit: number }[])
  const linhas = itens.map(i => {
    const q = Number(i.quantidade) || 0
    const n = String(i.produto || '')
    if (n.startsWith('↳')) return `   ${n} (${q})`
    return `• ${q}x ${n} — ${fmtR(q * (Number(i.preco_unit) || 0))}`
  }).join('\n')
  const entrega = p.tipo_entrega === 'Entrega'
  const frete = Number(p.frete) || 0
  const per = PERIODO[String(p.periodo || '')] ? ` · ${PERIODO[String(p.periodo)]}` : ''
  const quando = p.data_entrega
    ? (entrega ? `🛵 *Entrega ${dia(String(p.data_entrega))}${per}*${p.endereco ? `\n${p.endereco}` : ''}` : `🏠 *Retirada ${dia(String(p.data_entrega))}${per}*`)
    : (entrega ? '🛵 *Entrega* — a gente combina o dia por aqui' : '🏠 *Retirada* — a gente combina o dia e o horário por aqui')
  const pago = p.pgto === 'Pago'
  const { data: cfg } = await sb.from('user_config').select('config').eq('user_id', OWNER_USER_ID).maybeSingle()
  const pix = String(((cfg?.config as Record<string, Record<string, unknown>> | undefined)?.delivery?.pix) || '').trim()

  const resposta = [
    `Oii${nome ? `, ${nome}` : ''}! Aqui é a GuaxiMina, a guaxinim virtual da Guaxí 🦝`,
    `Recebi seu pedido *${pedidoId}*, tá tudo anotadinho:`,
    '',
    linhas || '• (sem itens)',
    entrega && frete > 0 ? `• Frete — ${fmtR(frete)}` : null,
    `*Total: ${fmtR(Number(p.valor) || 0)}*`,
    '',
    quando,
    '',
    pago ? 'Pagamento: confirmado ✅' : pix ? `Pagamento por Pix — chave: *${pix}*` : 'Pagamento: Pix — a Guaxí te manda a chave por aqui.',
    entrega ? 'Quando o motorista sair daqui, a gente te manda o link pra acompanhar 🛵' : null,
    'Qualquer dúvida, é só me chamar aqui mesmo 💛',
  ].filter(l => l !== null).join('\n')

  return { pedidoId, outroNumero: false, resposta }
}
