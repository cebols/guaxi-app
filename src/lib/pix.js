// ── Pix copia e cola (BR Code estático, padrão do Banco Central) ─────────────
// Gera o código com a chave, o valor exato e o número do pedido (txid). O cliente
// cola no app do banco e o valor já vem preenchido. Não passa por nenhum banco
// intermediário (sem taxa), mas também não avisa sozinho quando foi pago.
// Cópia em supabase/functions/whatsapp-webhook/pix.ts — mudou aqui, muda lá.

const campo = (id, valor) => `${id}${String(valor.length).padStart(2, '0')}${valor}`

function crc16(txt) {
  let crc = 0xFFFF
  for (const b of new TextEncoder().encode(txt)) {
    crc ^= b << 8
    for (let i = 0; i < 8; i++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

function cpfValido(d) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false
  const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r }
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10])
}

// A chave do jeito que o Pix espera: telefone +55..., CPF/CNPJ só números, e-mail minúsculo
export function normalizarChavePix(chave) {
  const k = String(chave || '').trim()
  if (!k) return ''
  if (k.includes('@')) return k.toLowerCase()
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) return k.toLowerCase()
  const d = k.replace(/\D/g, '')
  if (k.startsWith('+')) return `+${d}`
  if (d.length === 14) return d                       // CNPJ
  if (d.length === 11 && cpfValido(d)) return d       // CPF
  if (d.length === 10 || d.length === 11) return `+55${d}`
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return `+${d}`
  return k
}

const limpo = (s, max) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 ]/g, '').trim().toUpperCase().slice(0, max)

export function pixCopiaECola({ chave, valor, txid, nome = 'GUAXI PATISSERIE', cidade = 'RIO DE JANEIRO' }) {
  const k = normalizarChavePix(chave)
  if (!k) return ''
  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', k)
  const id = String(txid || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***'
  const v = Number(valor) > 0 ? campo('54', Number(valor).toFixed(2)) : ''
  const corpo = campo('00', '01') + campo('26', conta) + campo('52', '0000') + campo('53', '986') + v +
    campo('58', 'BR') + campo('59', limpo(nome, 25) || 'GUAXI') + campo('60', limpo(cidade, 15) || 'RIO DE JANEIRO') +
    campo('62', campo('05', id)) + '6304'
  return corpo + crc16(corpo)
}
