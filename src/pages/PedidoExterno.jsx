import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { getPublicProdutos, submitPedidoExterno } from '../services/db'

const fmtR = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// ── Animated check ────────────────────────────────────────────
function CheckAnim() {
  return (
    <svg viewBox="0 0 52 52" style={{ width: 72, height: 72 }}>
      <style>{`
        @keyframes stroke { to { stroke-dashoffset: 0 } }
        @keyframes scale  { 0%,100%{transform:none} 50%{transform:scale3d(1.1,1.1,1)} }
        .check-circle {
          stroke-dasharray:166; stroke-dashoffset:166;
          animation: stroke .6s cubic-bezier(.65,0,.45,1) forwards;
        }
        .check-mark {
          stroke-dasharray:48; stroke-dashoffset:48;
          animation: stroke .3s cubic-bezier(.65,0,.45,1) .6s forwards;
        }
        .check-wrap { animation: scale .3s ease-in-out .9s both; }
      `}</style>
      <g className="check-wrap">
        <circle className="check-circle" cx="26" cy="26" r="25"
          fill="none" stroke="#22b886" strokeWidth="2" />
        <path className="check-mark" fill="none" stroke="#22b886"
          strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"
          d="M14 27l8 8 16-16" />
      </g>
    </svg>
  )
}

// ── Product card ──────────────────────────────────────────────
function ProdutoCard({ produto, qtd, onAdd, onRemove }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid #2a2a2a',
      borderRadius: 14,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Photo */}
      <div style={{ position: 'relative', paddingTop: '50%', background: '#1a1a1a', flexShrink: 0 }}>
        {produto.imagemUrl ? (
          <img
            src={produto.imagemUrl}
            alt={produto.nome}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 40, color: '#333',
          }}>🍫</div>
        )}
        {produto.estoqueAtual != null && (
          <div style={{
            position: 'absolute', top: 8, right: 8,
            background: 'rgba(0,0,0,.7)', borderRadius: 6,
            fontSize: 10, fontWeight: 700, padding: '2px 7px',
            color: produto.estoqueAtual <= 3 ? '#f59e0b' : '#999',
          }}>
            {produto.estoqueAtual <= 3 ? `⚠ Últimas ${produto.estoqueAtual}` : `${produto.estoqueAtual} un`}
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: '10px 12px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3 }}>{produto.nome}</div>
        {produto.descricao && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{produto.descricao}</div>
        )}
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--teal)', marginTop: 'auto', paddingTop: 4 }}>
          {fmtR(produto.precoDireta)}
        </div>

        {/* Add / counter */}
        {qtd === 0 ? (
          <button
            onClick={onAdd}
            style={{
              width: '100%', padding: '9px 0', borderRadius: 9,
              background: 'var(--teal)', color: '#000',
              border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer',
              marginTop: 6,
            }}
          >
            Adicionar
          </button>
        ) : (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginTop: 6, background: 'var(--teal-light)', borderRadius: 9, padding: '5px 10px',
          }}>
            <button onClick={onRemove} style={{ background: 'none', border: 'none', color: 'var(--teal)', fontSize: 22, fontWeight: 700, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>−</button>
            <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--teal)' }}>{qtd} no carrinho</span>
            <button onClick={onAdd} style={{ background: 'none', border: 'none', color: 'var(--teal)', fontSize: 22, fontWeight: 700, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>+</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Field helpers ─────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  )
}

function Input({ style, ...props }) {
  return (
    <input
      style={{
        width: '100%', padding: '11px 14px', borderRadius: 10,
        background: '#1e1e1e', border: '1px solid #333',
        color: '#e8e8e8', fontSize: 15, fontFamily: 'inherit', outline: 'none',
        ...style,
      }}
      {...props}
    />
  )
}

// ── Main page ─────────────────────────────────────────────────
export default function PedidoExterno() {
  const { userId } = useParams()

  const [produtos, setProdutos]     = useState(null)
  const [loadError, setLoadError]   = useState(null)
  const [carrinho, setCarrinho]     = useState({}) // {prodId: qtd}
  const [step, setStep]             = useState('catalog') // catalog | checkout | receipt | confirm
  const [submitting, setSubmitting] = useState(false)
  const [pedidoId, setPedidoId]     = useState(null)

  const [form, setForm] = useState({
    nome: '', telefone: '', tipoEntrega: 'Retirada',
    cep: '', ruaBairro: '', cidade: '', numero: '', complemento: '', obs: '',
  })
  const [loadingCep, setLoadingCep] = useState(false)
  const [cepError, setCepError]     = useState('')

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!userId) return
    getPublicProdutos(userId)
      .then(setProdutos)
      .catch(e => setLoadError(e.message))
  }, [userId])

  const carrinhoItens = useMemo(() => {
    if (!produtos) return []
    return Object.entries(carrinho)
      .filter(([, q]) => q > 0)
      .map(([id, qtd]) => ({ produto: produtos.find(p => String(p.id) === id), qtd }))
      .filter(it => it.produto)
  }, [carrinho, produtos])

  const total = useMemo(
    () => carrinhoItens.reduce((s, it) => s + (it.produto.precoDireta || 0) * it.qtd, 0),
    [carrinhoItens]
  )

  const addItem = (prod) => {
    const current = carrinho[prod.id] || 0
    if (current >= (prod.estoqueAtual || 99)) return
    setCarrinho(c => ({ ...c, [prod.id]: current + 1 }))
  }
  const removeItem = (prod) => {
    const current = carrinho[prod.id] || 0
    if (current <= 0) return
    setCarrinho(c => ({ ...c, [prod.id]: current - 1 }))
  }

  const fetchCep = async (cep) => {
    const clean = cep.replace(/\D/g, '')
    setCepError('')
    if (clean.length !== 8) return
    setLoadingCep(true)
    try {
      const r = await fetch(`https://viacep.com.br/ws/${clean}/json/`)
      const d = await r.json()
      if (d.erro) { setCepError('CEP não encontrado'); return }
      setF('ruaBairro', [d.logradouro, d.bairro].filter(Boolean).join(', '))
      setF('cidade', d.localidade + ' - ' + d.uf)
    } catch {
      setCepError('Erro ao buscar CEP')
    } finally {
      setLoadingCep(false)
    }
  }

  const handleSubmit = async () => {
    if (!form.nome.trim()) { alert('Informe seu nome'); return }
    if (!form.telefone.trim()) { alert('Informe seu WhatsApp'); return }
    if (form.tipoEntrega === 'Entrega' && !form.cep.replace(/\D/g, '')) { alert('Informe o CEP'); return }
    if (carrinhoItens.length === 0) return

    const endereco = form.tipoEntrega === 'Entrega'
      ? [form.ruaBairro, form.numero, form.complemento, form.cidade].filter(Boolean).join(', ')
      : ''

    setSubmitting(true)
    try {
      const id = await submitPedidoExterno(userId, { ...form, endereco }, carrinhoItens)
      setPedidoId(id)
      setStep('confirm')
    } catch (e) {
      alert('Erro ao enviar pedido: ' + e.message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Loading / error ──────────────────────────────────────────
  if (!produtos && !loadError) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#121212', color: '#999', fontFamily: 'system-ui,sans-serif' }}>
        Carregando...
      </div>
    )
  }
  if (loadError) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#121212', color: '#f07070', fontFamily: 'system-ui,sans-serif', padding: 32, textAlign: 'center' }}>
        Não foi possível carregar o cardápio.
      </div>
    )
  }

  const shell = {
    background: '#121212',
    minHeight: '100dvh',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    color: '#e8e8e8',
    maxWidth: 640,
    margin: '0 auto',
  }

  // ── Confirmation ─────────────────────────────────────────────
  if (step === 'confirm') {
    return (
      <div style={shell}>
        <div style={{ padding: '60px 24px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 20 }}>
          <CheckAnim />
          <div style={{ fontSize: 24, fontWeight: 700 }}>Pedido enviado!</div>
          <div style={{ fontSize: 14, color: '#999', lineHeight: 1.6, maxWidth: 300 }}>
            Seu pedido <strong style={{ color: '#22b886' }}>{pedidoId}</strong> foi recebido.<br />
            Entraremos em contato pelo WhatsApp em breve.
          </div>

          {/* Receipt */}
          <div style={{ width: '100%', maxWidth: 400, marginTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Resumo do pedido</div>
            <div style={{ background: '#1e1e1e', borderRadius: 12, overflow: 'hidden' }}>
              {carrinhoItens.map((it, i) => (
                <div key={it.produto.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '12px 16px',
                  borderBottom: i < carrinhoItens.length - 1 ? '1px solid #2a2a2a' : 'none',
                  fontSize: 14,
                }}>
                  <span>
                    <span style={{ fontWeight: 600 }}>{it.produto.nome}</span>
                    <span style={{ color: '#666', marginLeft: 6 }}>×{it.qtd}</span>
                  </span>
                  <span style={{ fontWeight: 600 }}>{fmtR((it.produto.precoDireta || 0) * it.qtd)}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 4px', fontWeight: 700, fontSize: 17 }}>
              <span>Total</span>
              <span style={{ color: '#22b886' }}>{fmtR(total)}</span>
            </div>
          </div>

          <button
            onClick={() => { setStep('catalog'); setCarrinho({}) }}
            style={{ marginTop: 8, padding: '12px 32px', borderRadius: 10, background: '#22b886', color: '#000', border: 'none', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}
          >
            Fechar
          </button>
        </div>
      </div>
    )
  }

  // ── Checkout form ─────────────────────────────────────────────
  if (step === 'checkout') {
    return (
      <div style={shell}>
        {/* Header */}
        <div style={{ position: 'sticky', top: 0, background: '#1e1e1e', borderBottom: '1px solid #2a2a2a', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, zIndex: 10 }}>
          <button onClick={() => setStep('catalog')} style={{ background: 'none', border: 'none', color: '#999', fontSize: 22, cursor: 'pointer', padding: 0, lineHeight: 1 }}>←</button>
          <span style={{ fontWeight: 700, fontSize: 16 }}>Finalizar pedido</span>
        </div>

        <div style={{ padding: '20px 20px 120px' }}>
          {/* Order summary */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Seu pedido</div>
            <div style={{ background: '#1e1e1e', borderRadius: 12, overflow: 'hidden' }}>
              {carrinhoItens.map((it, i) => (
                <div key={it.produto.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '11px 14px',
                  borderBottom: i < carrinhoItens.length - 1 ? '1px solid #2a2a2a' : 'none',
                  fontSize: 13,
                }}>
                  <span>{it.produto.nome} <span style={{ color: '#666' }}>×{it.qtd}</span></span>
                  <span style={{ fontWeight: 600 }}>{fmtR((it.produto.precoDireta || 0) * it.qtd)}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 4px', fontWeight: 700, fontSize: 16 }}>
              <span>Total</span>
              <span style={{ color: '#22b886' }}>{fmtR(total)}</span>
            </div>
          </div>

          {/* Form */}
          <Field label="Nome completo">
            <Input placeholder="Seu nome" value={form.nome} onChange={e => setF('nome', e.target.value)} />
          </Field>

          <Field label="WhatsApp">
            <Input type="tel" placeholder="(11) 99999-9999" value={form.telefone} onChange={e => setF('telefone', e.target.value)} />
          </Field>

          {/* Entrega/Retirada toggle */}
          <Field label="Tipo de entrega">
            <div style={{ display: 'flex', gap: 8 }}>
              {['Retirada', 'Entrega'].map(opt => (
                <button
                  key={opt}
                  onClick={() => setF('tipoEntrega', opt)}
                  style={{
                    flex: 1, padding: '11px 0', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer',
                    border: `1.5px solid ${form.tipoEntrega === opt ? '#22b886' : '#333'}`,
                    background: form.tipoEntrega === opt ? 'rgba(34,184,134,.12)' : 'transparent',
                    color: form.tipoEntrega === opt ? '#22b886' : '#666',
                  }}
                >{opt}</button>
              ))}
            </div>
          </Field>

          {form.tipoEntrega === 'Entrega' && (
            <>
              <Field label="CEP">
                <div style={{ position: 'relative' }}>
                  <Input
                    type="text" inputMode="numeric" placeholder="00000-000"
                    value={form.cep}
                    onChange={e => {
                      const v = e.target.value.replace(/\D/g, '').slice(0, 8)
                      const fmt = v.length > 5 ? v.slice(0,5) + '-' + v.slice(5) : v
                      setF('cep', fmt)
                      if (v.length === 8) fetchCep(v)
                    }}
                    style={{ paddingRight: 40 }}
                  />
                  {loadingCep && (
                    <div style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: '#666', fontSize: 13 }}>...</div>
                  )}
                </div>
                {cepError && <div style={{ fontSize: 12, color: '#f07070', marginTop: 4 }}>{cepError}</div>}
              </Field>

              {form.ruaBairro && (
                <Field label="Rua, Bairro">
                  <Input value={form.ruaBairro} readOnly style={{ color: '#666', background: '#161616' }} />
                  {form.cidade && <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>{form.cidade}</div>}
                </Field>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <Field label="Número" >
                  <Input placeholder="123" value={form.numero} onChange={e => setF('numero', e.target.value)} style={{ width: 100 }} />
                </Field>
                <div style={{ flex: 1 }}>
                  <Field label="Complemento">
                    <Input placeholder="Apto, bloco..." value={form.complemento} onChange={e => setF('complemento', e.target.value)} />
                  </Field>
                </div>
              </div>
            </>
          )}

          <Field label="Observações (opcional)">
            <textarea
              placeholder="Alguma preferência ou informação adicional..."
              value={form.obs}
              onChange={e => setF('obs', e.target.value)}
              rows={2}
              style={{
                width: '100%', padding: '11px 14px', borderRadius: 10,
                background: '#1e1e1e', border: '1px solid #333',
                color: '#e8e8e8', fontSize: 14, fontFamily: 'inherit', outline: 'none', resize: 'vertical',
              }}
            />
          </Field>
        </div>

        {/* Sticky submit */}
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, maxWidth: 640, margin: '0 auto', padding: '16px 20px', background: '#1a1a1a', borderTop: '1px solid #2a2a2a' }}>
          <button
            onClick={handleSubmit}
            disabled={submitting || !form.nome || !form.telefone}
            style={{
              width: '100%', padding: 14, borderRadius: 12,
              background: '#22b886', color: '#000', border: 'none',
              fontWeight: 700, fontSize: 16, cursor: 'pointer',
              opacity: (!form.nome || !form.telefone || submitting) ? 0.5 : 1,
            }}
          >
            {submitting ? 'Enviando...' : `Enviar pedido · ${fmtR(total)}`}
          </button>
        </div>
      </div>
    )
  }

  // ── Catalog ───────────────────────────────────────────────────
  const carrinhoCount = Object.values(carrinho).reduce((s, q) => s + q, 0)

  return (
    <div style={shell}>
      {/* Header */}
      <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid #1e1e1e' }}>
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 2 }}>Fazer pedido</div>
        <div style={{ fontSize: 13, color: '#666' }}>Escolha os produtos abaixo</div>
      </div>

      {/* Grid */}
      {produtos.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#555', fontSize: 14 }}>
          Nenhum produto disponível no momento.
        </div>
      ) : (
        <div style={{ padding: '16px 16px 120px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {produtos.map(prod => (
            <ProdutoCard
              key={prod.id}
              produto={prod}
              qtd={carrinho[prod.id] || 0}
              onAdd={() => addItem(prod)}
              onRemove={() => removeItem(prod)}
            />
          ))}
        </div>
      )}

      {/* Floating cart bar */}
      {carrinhoCount > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          maxWidth: 640, margin: '0 auto',
          padding: '14px 20px',
          background: '#22b886',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(0,0,0,.6)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{carrinhoCount} item{carrinhoCount !== 1 ? 's' : ''}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#000', letterSpacing: '-0.02em' }}>{fmtR(total)}</div>
          </div>
          <button
            onClick={() => setStep('checkout')}
            style={{
              background: '#000', color: '#22b886', border: 'none',
              borderRadius: 10, padding: '11px 22px',
              fontWeight: 700, fontSize: 15, cursor: 'pointer',
            }}
          >
            Finalizar pedido →
          </button>
        </div>
      )}
    </div>
  )
}
