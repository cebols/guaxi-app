import { useState } from 'react'
import { etapasDoProduto, LOCAL } from '../lib/prontidao'
import { corrigirEtapaProntidao } from '../services/db'

// Contagem de um produto do Prontidão: quantas unidades tem DE VERDADE em cada etapa.
// Usado no Prontidão (botão Contar do cartão) e no Estoque › Produtos.

const fmtN = (n) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
const lerNum = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : null }

export function qtdPorEtapa(prodId, lotes) {
  const m = {}
  for (const l of (lotes || [])) if (Number(l.produto_id) === Number(prodId)) m[l.etapa] = (m[l.etapa] || 0) + (Number(l.qtd) || 0)
  return m
}

// Grava só as etapas preenchidas e diferentes do que o app tem. Aumento entra como
// unidades já prontas naquela etapa; diminuição tira dos lotes mais antigos.
export async function salvarContagemEtapas(prod, valores, atuais) {
  let mudou = 0
  for (const e of etapasDoProduto(prod)) {
    const n = lerNum(valores[e.key])
    if (n == null || n === (atuais[e.key] || 0)) continue
    await corrigirEtapaProntidao(prod.id, e.key, n, e.tempoH, [], prod)
    mudou++
  }
  return mudou
}

export default function ContarEtapas({ prod, lotes, onSalvo, compacto = false }) {
  const etapas = etapasDoProduto(prod)
  const atuais = qtdPorEtapa(prod.id, lotes)
  const [valores, setValores] = useState({})
  const [salvando, setSalvando] = useState(false)
  const total = etapas.reduce((s, e) => s + (atuais[e.key] || 0), 0)
  const novoTotal = etapas.reduce((s, e) => s + (lerNum(valores[e.key]) ?? (atuais[e.key] || 0)), 0)
  const sujo = etapas.some(e => { const n = lerNum(valores[e.key]); return n != null && n !== (atuais[e.key] || 0) })

  async function salvar() {
    setSalvando(true)
    try {
      const n = await salvarContagemEtapas(prod, valores, atuais)
      setValores({})
      onSalvo?.(n ? `${prod.nome}: agora ${fmtN(novoTotal)} no total` : 'Nada mudou')
    } catch (err) {
      alert('Erro ao salvar: ' + err.message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div style={{ padding: compacto ? '12px 0' : 0, borderTop: compacto ? '1px solid var(--border-color, #2a2a2a)' : 'none' }}>
      {compacto && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <b style={{ flex: 1, fontSize: 14, minWidth: 0 }}>{prod.nome}</b>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
            {sujo ? <>{fmtN(total)} → <b style={{ color: 'var(--teal)' }}>{fmtN(novoTotal)}</b></> : `${fmtN(total)} no total`}
          </span>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 8 }}>
        {etapas.map(e => {
          const loc = LOCAL[e.local] || LOCAL.freezer
          const v = valores[e.key] ?? ''
          const n = lerNum(v)
          const mudou = n != null && n !== (atuais[e.key] || 0)
          return (
            <label key={e.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: loc.cor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {loc.icon ? `${loc.icon} ` : ''}{e.nome}
              </span>
              <input className="field-input" type="text" inputMode="decimal" aria-label={`${prod.nome}: quantas em ${e.nome}`}
                placeholder={fmtN(atuais[e.key] || 0)} value={v}
                onChange={ev => setValores(x => ({ ...x, [e.key]: ev.target.value.replace(/[^\d.,]/g, '') }))}
                style={{ marginBottom: 0, fontSize: 18, fontWeight: 700, textAlign: 'center', borderColor: mudou ? 'var(--teal)' : undefined }} />
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center' }}>app: {fmtN(atuais[e.key] || 0)}</span>
            </label>
          )
        })}
      </div>
      {!compacto && (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '12px 0' }}>
          Total: {sujo ? <>{fmtN(total)} → <b style={{ color: 'var(--teal)' }}>{fmtN(novoTotal)}</b></> : <b>{fmtN(total)}</b>}
          <span style={{ display: 'block', fontSize: 12, color: 'var(--text-tertiary)', marginTop: 3 }}>
            Digite o que você contou de verdade. Em branco = não mexe.
          </span>
        </div>
      )}
      {(sujo || !compacto) && (
        <button className="btn-primary" disabled={salvando || !sujo} onClick={salvar} style={{ marginTop: compacto ? 10 : 0 }}>
          {salvando ? 'Salvando...' : compacto ? `Salvar ${prod.nome.split(' ').slice(0, 2).join(' ')}` : 'Salvar contagem'}
        </button>
      )}
    </div>
  )
}
