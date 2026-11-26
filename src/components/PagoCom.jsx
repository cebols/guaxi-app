import { taxaCartao } from '../lib/financeiro'

// Como o pedido foi pago: Pix, dinheiro, débito ou crédito (Tap to Pay).
// No cartão mostra a taxa e o que entra de fato.
export const PAGO_COM = [
  { k: 'pix', nome: 'Pix' },
  { k: 'dinheiro', nome: 'Dinheiro' },
  { k: 'debito', nome: 'Débito' },
  { k: 'credito', nome: 'Crédito' },
]
export const nomePagoCom = (k) => PAGO_COM.find(x => x.k === k)?.nome || null

const fmtR = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtPct = (f) => `${(f * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`

export function taxaTexto(cfg, pagoCom, valor) {
  const t = taxaCartao(cfg, pagoCom)
  if (!t) return null
  const taxa = Math.round(valor * t * 100) / 100
  return { taxa, entra: valor - taxa, pct: fmtPct(t) }
}

// Chips (detalhe do pedido e novo pedido)
export function ChipsPagoCom({ valor, total = 0, cfg, onChange, disabled }) {
  const tx = taxaTexto(cfg, valor, total)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="pc-chips" role="radiogroup" aria-label="Pago com">
        {PAGO_COM.map(o => (
          <button key={o.k} type="button" role="radio" aria-checked={valor === o.k} disabled={disabled}
            className={`pc-chip${valor === o.k ? ' on' : ''}`} onClick={() => onChange(o.k)}>{o.nome}</button>
        ))}
      </div>
      {tx
        ? <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>Taxa do cartão ({tx.pct}): <b style={{ color: '#f87171' }}>−{fmtR(tx.taxa)}</b> · entra <b style={{ color: 'var(--text-primary)' }}>{fmtR(tx.entra)}</b></div>
        : !valor && <div style={{ fontSize: 12.5, color: '#f5b544' }}>Como recebeu? (no cartão a taxa entra nas contas)</div>}
    </div>
  )
}

// "Recebi": pergunta como antes de marcar pago (Início e lista de pedidos)
export function SheetComoRecebeu({ pedido, cfg, onEscolher, onClose }) {
  const valor = Math.max(0, (Number(pedido.valor) || 0) - (Number(pedido.sinal) || 0))
  const sugestao = pedido.formaPgto === 'cartao' ? ['debito', 'credito'] : []
  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="Como recebeu">
        <div className="sheet-title">
          <span>Como {String(pedido.cliente || '').split(' ')[0] || 'o cliente'} pagou {fmtR(valor)}?</span>
          <button onClick={onClose} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, paddingBottom: 8 }}>
          {PAGO_COM.map(o => {
            const tx = taxaTexto(cfg, o.k, valor)
            return (
              <button key={o.k} type="button" onClick={() => onEscolher(o.k)} style={{
                padding: '14px 12px', borderRadius: 12, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                border: `1.5px solid ${sugestao.includes(o.k) ? 'var(--teal)' : '#3a3a3a'}`, background: '#1e1e1e', color: 'var(--text-primary)',
              }}>
                <b style={{ display: 'block', fontSize: 16 }}>{o.nome}</b>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>
                  {tx ? `taxa ${tx.pct} (−${fmtR(tx.taxa)}) · entra ${fmtR(tx.entra)}` : 'sem taxa'}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}
