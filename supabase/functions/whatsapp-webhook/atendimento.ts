// ── Atendimento: quem está falando, se o bot pode responder e avisos pra dona ──
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { OWNER_USER_ID } from './cardapio.ts'

// Registra a mensagem do cliente no atendimento e diz se o bot está pausado
// (você assumiu a conversa). Sem a tabela, segue como antes (bot responde).
export async function registrarContato(sb: SupabaseClient, telefone: string, nome?: string): Promise<{ botPausado: boolean; nome: string }> {
  const agora = new Date().toISOString()
  const { data, error } = await sb.from('atendimentos')
    .upsert({ telefone, user_id: OWNER_USER_ID, ...(nome ? { nome } : {}), ultima_msg_em: agora, ultima_msg_cliente_em: agora }, { onConflict: 'telefone' })
    .select('bot_pausado, nome').maybeSingle()
  if (error) { console.error('atendimentos', error.message); return { botPausado: false, nome: nome || '' } }
  return { botPausado: !!data?.bot_pausado, nome: String(data?.nome || nome || '') }
}

export async function tocarConversa(sb: SupabaseClient, telefone: string) {
  await sb.from('atendimentos').update({ ultima_msg_em: new Date().toISOString() }).eq('telefone', telefone)
}

// O bot chamou você: pausa o bot nessa conversa até você devolver
export async function marcarPrecisaHumano(sb: SupabaseClient, telefone: string, motivo: string) {
  await sb.from('atendimentos').update({ precisa_humano: true, bot_pausado: true, motivo: motivo.slice(0, 200) }).eq('telefone', telefone)
}

// Notificação no celular/tablet da dona (mesmas inscrições do lembrete de fim do dia)
export async function avisarDono(sb: SupabaseClient, titulo: string, corpo: string, telefone?: string) {
  const { error } = await sb.rpc('avisar_dono', {
    p_user_id: OWNER_USER_ID, p_titulo: titulo, p_corpo: corpo,
    p_url: telefone ? `/atendimento?c=${telefone}` : '/atendimento', p_tag: telefone ? `atd-${telefone}` : 'atendimento',
  })
  if (error) console.error('avisar_dono', error.message)
}

// Rede de segurança: sinais claros de que o cliente quer uma pessoa (não depende
// do bot decidir). Cuidado com falso positivo: "bolo pra 20 pessoas" não conta.
const PEDE_HUMANO: RegExp[] = [
  /\b(atendente|atendimento humano|um humano|uma humana|pessoa de verdade|pessoa real|gente de verdade|ser humano)\b/,
  /\b(falar|conversar|tratar) (com|c\/) (alguem|uma pessoa|um humano|a dona|o dono|a responsavel|o responsavel|a guaxi|gente de verdade|o gerente|a gerente)\b/,
  /\b(e|eh|vc e|voce e|to falando com|estou falando com|isso e)( um| uma)? (robo|bot|maquina|ia|inteligencia artificial)\b/,
  /\b(nao quero|chega de|para de|cansei de)( falar com)?( o| um| esse)? (robo|bot)\b/,
  /\bme (liga|ligue|ligar)\b/,
  /\b(quero|vou) (reclamar|fazer uma reclamacao)\b/,
  /\b(reclamacao|procon|reembolso|estorno|veio errado|veio estragado|nao chegou|pessimo atendimento)\b/,
]

export function pedeHumano(texto: string): boolean {
  const t = String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  return PEDE_HUMANO.some(r => r.test(t))
}
