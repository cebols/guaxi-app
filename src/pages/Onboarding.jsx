import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const ESTADOS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']

const CANAIS = [
  { key: 'direto', icon: '👥', label: 'Encomendas diretas', sub: 'WhatsApp, Instagram, telefone, pessoalmente...' },
  { key: 'ifood',  icon: '🛵', label: 'iFood',              sub: 'Pedidos pelo app de delivery' },
  { key: '99food', icon: '🛵', label: '99Food',             sub: 'Pedidos pelo app de delivery' },
]

function ProgressDots({ step, total }) {
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 32 }}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} style={{
          width: i === step ? 24 : 8, height: 8, borderRadius: 4,
          background: i === step ? 'var(--teal)' : '#333',
          transition: 'width 0.3s',
        }} />
      ))}
    </div>
  )
}

export default function Onboarding({ onComplete }) {
  const { user, updateProfile } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [nomeLoja, setNomeLoja] = useState('')
  const [estado, setEstado] = useState('SP')
  const [canais, setCanais] = useState(['direto'])
  const [saving, setSaving] = useState(false)

  const totalSteps = 3

  function toggleCanal(key) {
    setCanais(c => c.includes(key) ? c.filter(k => k !== key) : [...c, key])
  }

  async function finish(destino = '/') {
    setSaving(true)
    try {
      await updateProfile({
        nomeLoja,
        estado,
        canais,
        onboardingDone: true,
        checklistDismissed: false,
      })
      onComplete()
      navigate(destino)
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  const IMPORT_OPTS = [
    { icon: '📊', label: 'Importar receitas (planilha)', sub: 'Excel ou Google Sheets — ingredientes de cada receita são criados junto.', path: '/fichas' },
    { icon: '🖼', label: 'Imagem ou foto de receita',    sub: 'Foto de caderno, screenshot, imagem digital — qualquer receita em imagem.', path: '/fichas' },
    { icon: '🧂', label: 'Importar insumos primeiro',    sub: 'Planilha com seus ingredientes — útil pra montar a base antes das receitas.', path: '/cadastros' },
    { icon: '✏️', label: 'Cadastrar do zero',            sub: 'Comece pelos Insumos antes de criar receitas.', path: '/' },
  ]

  return (
    <div style={{ minHeight: '100dvh', background: '#0a0a0a', display: 'flex', flexDirection: 'column', padding: '0 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 0 0' }}>
        {step > 0
          ? <button onClick={() => setStep(s => s - 1)} style={{ background: 'none', border: 'none', color: '#888', fontSize: 15, cursor: 'pointer', padding: 0 }}>‹ Voltar</button>
          : <div />
        }
        <div style={{ fontSize: 13, color: '#555', background: '#1a1a1a', padding: '4px 10px', borderRadius: 20 }}>
          {step + 2} de {totalSteps + 1}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', paddingTop: 32 }}>
        <ProgressDots step={step} total={totalSteps} />

        {/* ─── Step 0: Nome da loja ─── */}
        {step === 0 && (
          <>
            <div style={{ fontWeight: 800, fontSize: 26, color: '#fff', marginBottom: 8 }}>Como se chama a sua loja?</div>
            <div style={{ fontSize: 14, color: '#888', marginBottom: 32, lineHeight: 1.5 }}>
              Aparece no topo do app e nas fichas técnicas que você imprime.
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Nome do estabelecimento</div>
                <input
                  autoFocus
                  value={nomeLoja}
                  onChange={e => setNomeLoja(e.target.value)}
                  placeholder="Ex: Guaxí Pâtisserie"
                  onKeyDown={e => e.key === 'Enter' && nomeLoja.trim() && setStep(1)}
                  style={{
                    width: '100%', padding: '14px 16px', borderRadius: 10, boxSizing: 'border-box',
                    border: '2px solid var(--teal)', background: '#1a1a1a',
                    color: '#fff', fontSize: 16, outline: 'none',
                  }}
                />
              </div>
              <div style={{ flexShrink: 0 }}>
                <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Estado</div>
                <select
                  value={estado}
                  onChange={e => setEstado(e.target.value)}
                  style={{
                    padding: '14px 12px', borderRadius: 10,
                    border: '1px solid #333', background: '#1a1a1a',
                    color: '#fff', fontSize: 16, cursor: 'pointer',
                  }}
                >
                  {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>
            </div>
            <div style={{ fontSize: 12, color: '#555', lineHeight: 1.5, marginTop: 4 }}>
              O estado ajuda o Guaxí a sugerir margens e preços de referência mais à frente.
            </div>
          </>
        )}

        {/* ─── Step 1: Canais ─── */}
        {step === 1 && (
          <>
            <div style={{ fontWeight: 800, fontSize: 26, color: '#fff', marginBottom: 8 }}>Onde você vende?</div>
            <div style={{ fontSize: 14, color: '#888', marginBottom: 28, lineHeight: 1.5 }}>
              Marque os canais que você usa hoje. O app mostra só o que se aplica e esconde o resto.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {CANAIS.map(c => {
                const active = canais.includes(c.key)
                return (
                  <button key={c.key} onClick={() => toggleCanal(c.key)} style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '16px 18px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                    border: active ? '1.5px solid var(--teal)' : '1px solid #2a2a2a',
                    background: active ? 'var(--teal-light)' : '#1a1a1a',
                  }}>
                    <span style={{ fontSize: 26 }}>{c.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 15, color: active ? 'var(--teal)' : '#fff' }}>{c.label}</div>
                      <div style={{ fontSize: 12, color: active ? 'var(--teal)' : '#888', marginTop: 2, opacity: 0.8 }}>{c.sub}</div>
                    </div>
                    <div style={{
                      width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                      border: active ? 'none' : '1.5px solid #444',
                      background: active ? 'var(--teal)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {active && <span style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>✓</span>}
                    </div>
                  </button>
                )
              })}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '16px 18px', borderRadius: 12, border: '1px solid #1e1e1e', opacity: 0.4,
              }}>
                <span style={{ fontSize: 26 }}>🏪</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: '#888' }}>Loja física / balcão</div>
                  <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>Venda presencial no ponto</div>
                </div>
                <div style={{ fontSize: 11, color: '#555', fontWeight: 700, background: '#1a1a1a', padding: '3px 8px', borderRadius: 6 }}>EM BREVE</div>
              </div>
            </div>
          </>
        )}

        {/* ─── Step 2: Trazer dados ─── */}
        {step === 2 && (
          <>
            <div style={{ fontWeight: 800, fontSize: 26, color: '#fff', marginBottom: 8 }}>Trazer seus dados</div>
            <div style={{ fontSize: 14, color: '#888', marginBottom: 28, lineHeight: 1.5 }}>
              Não precisa digitar tudo. Guaxí importa receitas e insumos de planilha ou imagem.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {IMPORT_OPTS.map((opt, i) => (
                <button key={i} onClick={() => finish(opt.path)} disabled={saving} style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '16px 18px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                  border: i === 0 ? '1.5px solid var(--teal)' : '1px solid #2a2a2a',
                  background: i === 0 ? 'var(--teal-light)' : '#1a1a1a',
                }}>
                  <span style={{ fontSize: 26, flexShrink: 0 }}>{opt.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: i === 0 ? 'var(--teal)' : '#fff' }}>{opt.label}</div>
                    <div style={{ fontSize: 12, color: '#888', marginTop: 2, lineHeight: 1.4 }}>{opt.sub}</div>
                  </div>
                  <span style={{ color: '#555', fontSize: 18 }}>›</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Bottom button */}
      <div style={{ paddingBottom: 36 }}>
        {step < 2 && (
          <button
            onClick={() => setStep(s => s + 1)}
            disabled={step === 0 && !nomeLoja.trim()}
            style={{
              width: '100%', padding: 16, borderRadius: 14, border: 'none',
              background: (step === 0 && !nomeLoja.trim()) ? '#1e1e1e' : 'var(--teal)',
              color: (step === 0 && !nomeLoja.trim()) ? '#555' : '#fff',
              fontSize: 16, fontWeight: 700, cursor: (step === 0 && !nomeLoja.trim()) ? 'default' : 'pointer',
            }}
          >
            Continuar
          </button>
        )}
        {step === 2 && (
          <button onClick={() => finish('/')} disabled={saving} style={{
            background: 'none', border: 'none', color: '#666', fontSize: 14,
            cursor: 'pointer', width: '100%', textAlign: 'center', padding: '12px 0',
          }}>
            {saving ? 'Salvando...' : 'Pular — faço isso depois'}
          </button>
        )}
      </div>
    </div>
  )
}
