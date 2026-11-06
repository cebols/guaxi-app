import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { getPublicProdutos, submitPedidoExterno, getPublicDeliveryConfig, registrarInteresse } from '../services/db'

const fmtR = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// ── Animated check ────────────────────────────────────────────
function CheckAnim({ size = 72 }) {
  return (
    <svg viewBox="0 0 52 52" style={{ width: size, height: size }}>
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
          fill="none" stroke="#185D9C" strokeWidth="2" />
        <path className="check-mark" fill="none" stroke="#185D9C"
          strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"
          d="M14 27l8 8 16-16" />
      </g>
    </svg>
  )
}

// ── Identidade Guaxí ──────────────────────────────────────────
const C = { rosa: '#FBDAE1', azul: '#185D9C', azulEsc: '#0E3C68', azulClaro: '#E3EDF7', creme: '#FFF9F7', tinta: '#1D2B3A', tinta2: '#5B6878', linha: '#EBCDD5' }
const FONTE = 'Figtree, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
const SERIF = '"Cormorant Garamond", Georgia, "Times New Roman", serif'
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

function useFontesMarca() {
  useEffect(() => {
    if (document.getElementById('fontes-guaxi')) return
    const l = document.createElement('link')
    l.id = 'fontes-guaxi'; l.rel = 'stylesheet'
    l.href = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Figtree:wght@400;500;600;700;800&display=swap'
    document.head.appendChild(l)
  }, [])
}

// Dados do cliente guardados só neste aparelho (não precisa digitar de novo)
const CHAVE_CLIENTE = 'guaxi_cliente'
export const lerCliente = () => { try { return JSON.parse(localStorage.getItem(CHAVE_CLIENTE) || '{}') } catch { return {} } }
export const salvarCliente = (d) => { try { localStorage.setItem(CHAVE_CLIENTE, JSON.stringify({ ...lerCliente(), ...d })) } catch {} }

const fmtTel = (v) => {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length > 7) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length > 2) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  return d
}

// Vídeo que só toca quando está na tela (economiza dado no 4G)
function VideoLoop({ src, poster, style }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) el.play().catch(() => {}); else el.pause() }, { threshold: 0.4 })
    io.observe(el)
    return () => io.disconnect()
  }, [src])
  return <video ref={ref} src={src} poster={poster || undefined} muted loop playsInline preload="metadata" style={style} />
}

// Carrossel de fotos/vídeos com bolinhas (arrasta pro lado)
function Midias({ midias, nome, aspect = '4 / 5', altura, radius = 0, onIndex }) {
  const [idx, setIdx] = useState(0)
  const ref = useRef(null)
  const lista = midias?.length ? midias : [null]
  const onScroll = () => {
    const el = ref.current
    if (!el) return
    const i = Math.round(el.scrollLeft / el.clientWidth)
    if (i !== idx) { setIdx(i); onIndex?.(i) }
  }
  const cover = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }
  return (
    <div style={{ position: 'relative', ...(altura ? { height: altura } : { aspectRatio: aspect }), background: C.rosa, borderRadius: radius, overflow: 'hidden' }}>
      <div ref={ref} onScroll={onScroll} style={{ display: 'flex', width: '100%', height: '100%', overflowX: lista.length > 1 ? 'auto' : 'hidden', scrollSnapType: 'x mandatory', scrollbarWidth: 'none' }}>
        {lista.map((m, i) => (
          <div key={i} style={{ flex: '0 0 100%', height: '100%', scrollSnapAlign: 'start' }}>
            {!m ? (
              <div style={{ ...cover, display: 'grid', placeItems: 'center' }}><img src="/brand/guaxinim.png" alt="" style={{ width: '45%', opacity: 0.35 }} /></div>
            ) : m.tipo === 'video' ? (
              <VideoLoop src={m.url} poster={m.poster} style={cover} />
            ) : (
              <img src={m.url} alt={nome} loading="lazy" style={cover} />
            )}
          </div>
        ))}
      </div>
      {lista.some(m => m?.tipo === 'video') && (
        <span style={{ position: 'absolute', top: 8, left: 8, fontSize: 10.5, fontWeight: 800, padding: '3px 8px', borderRadius: 99, background: 'rgba(255,255,255,.92)', color: C.azulEsc }}>▶ vídeo</span>
      )}
      {lista.length > 1 && (
        <div style={{ position: 'absolute', bottom: 7, left: 0, right: 0, display: 'flex', gap: 4, justifyContent: 'center', pointerEvents: 'none' }}>
          {lista.map((_, i) => <i key={i} style={{ width: i === idx ? 12 : 5, height: 5, borderRadius: 3, background: i === idx ? '#fff' : 'rgba(255,255,255,.6)', transition: 'width .2s' }} />)}
        </div>
      )}
    </div>
  )
}

function ProdutoCard({ produto, qtd, onAdd, onRemove, onAbrir }) {
  const esg = produto.esgotado
  return (
    <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: `0 1px 0 ${C.linha}, 0 6px 14px rgba(14,60,104,.06)`, display: 'flex', flexDirection: 'column' }}>
      <div onClick={onAbrir} style={{ position: 'relative', cursor: 'pointer', opacity: esg ? 0.55 : 1, filter: esg ? 'grayscale(.35)' : 'none' }}>
        <Midias midias={produto.midias} nome={produto.nome} />
        {!esg && produto.estoqueAtual > 0 && produto.estoqueAtual <= 3 && (
          <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 10.5, fontWeight: 800, padding: '3px 8px', borderRadius: 99, background: 'rgba(255,255,255,.92)', color: C.azulEsc }}>Últimas {produto.estoqueAtual}</span>
        )}
        {esg && (
          <span style={{ position: 'absolute', left: 8, right: 8, bottom: 8, textAlign: 'center', fontSize: 11.5, fontWeight: 800, color: C.azulEsc, background: 'rgba(255,255,255,.94)', borderRadius: 8, padding: '4px' }}>
            {produto.aCaminho > 0 ? 'volta em breve' : 'esgotado'}
          </span>
        )}
      </div>
      <div style={{ padding: '9px 10px 10px', display: 'flex', flexDirection: 'column', flex: 1 }}>
        <div onClick={onAbrir} style={{ cursor: 'pointer', fontFamily: SERIF, fontWeight: 700, fontSize: 17, lineHeight: 1.08, color: C.azulEsc }}>{produto.nome}</div>
        {produto.descricao && (
          <div style={{ fontSize: 11.5, color: C.tinta2, marginTop: 3, lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{produto.descricao}</div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 8, gap: 6 }}>
          <b style={{ fontSize: 15, fontWeight: 800, color: C.tinta }}>{fmtR(produto.precoDireta)}</b>
          {esg ? (
            <button onClick={onAbrir} style={{ border: `1.5px solid ${C.azul}`, background: 'transparent', color: C.azul, borderRadius: 99, padding: '5px 10px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONTE }}>Avise-me</button>
          ) : qtd === 0 ? (
            <button onClick={onAdd} aria-label={`Adicionar ${produto.nome}`} style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', background: C.azul, color: '#fff', fontSize: 21, fontWeight: 700, lineHeight: 1, cursor: 'pointer' }}>+</button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', background: C.azulClaro, borderRadius: 99 }}>
              <button onClick={onRemove} style={{ width: 30, height: 32, border: 'none', background: 'none', color: C.azul, fontSize: 19, fontWeight: 800, cursor: 'pointer' }}>−</button>
              <span style={{ minWidth: 16, textAlign: 'center', fontWeight: 800, color: C.azul }}>{qtd}</span>
              <button onClick={onAdd} style={{ width: 30, height: 32, border: 'none', background: 'none', color: C.azul, fontSize: 19, fontWeight: 800, cursor: 'pointer' }}>+</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Página do doce: galeria grande, descrição inteira, quantidade — ou "Avise-me"
function ProdutoSheet({ produto, qtdNoCarrinho, onClose, onConfirmar, userId }) {
  const [qtd, setQtd] = useState(Math.max(1, qtdNoCarrinho || 1))
  const [idx, setIdx] = useState(0)
  const cli = lerCliente()
  const [nome, setNome] = useState(cli.nome || '')
  const [tel, setTel] = useState(cli.telefone || '')
  const [estado, setEstado] = useState(null) // null | 'enviando' | 'ok' | erro
  const max = produto.estoqueAtual > 0 ? produto.estoqueAtual : 99
  const esg = produto.esgotado
  useEffect(() => {
    const h = document.documentElement, b = document.body
    const antes = [h.style.overflow, b.style.overflow]
    h.style.overflow = 'hidden'; b.style.overflow = 'hidden'
    return () => { h.style.overflow = antes[0]; b.style.overflow = antes[1] }
  }, [])

  async function avisar() {
    if (tel.replace(/\D/g, '').length < 10) { setEstado('Informe um WhatsApp com DDD'); return }
    setEstado('enviando')
    try {
      await registrarInteresse(userId, produto.id, nome.trim(), tel)
      salvarCliente({ nome: nome.trim(), telefone: tel })
      setEstado('ok')
    } catch (e) { setEstado('Não deu pra registrar agora. Tenta de novo?') }
  }

  const inp = { width: '100%', padding: '11px 12px', borderRadius: 10, border: `1.5px solid ${C.linha}`, background: '#fff', color: C.tinta, fontSize: 15, fontFamily: FONTE, outline: 'none', boxSizing: 'border-box' }
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(14,30,50,.45)', zIndex: 40, touchAction: 'none' }} />
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, maxWidth: 560, margin: '0 auto', maxHeight: '92dvh', display: 'flex', flexDirection: 'column', background: C.creme, borderRadius: '22px 22px 0 0', overflow: 'hidden', zIndex: 41, fontFamily: FONTE, color: C.tinta }}>
       <div style={{ overflowY: 'auto', overscrollBehavior: 'contain', flex: '0 1 auto', minHeight: 0 }}>
        <div style={{ position: 'relative' }}>
          <Midias midias={produto.midias} nome={produto.nome} altura="min(100vw, 560px, 52dvh)" onIndex={setIdx} />
          <button onClick={onClose} aria-label="Fechar" style={{ position: 'absolute', top: 10, right: 10, width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,.92)', color: C.azulEsc, fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: '14px 18px 22px' }}>
          {produto.midias?.length > 1 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 10, overflowX: 'auto' }}>
              {produto.midias.map((m, i) => (
                <div key={i} style={{ width: 46, height: 46, flexShrink: 0, borderRadius: 9, overflow: 'hidden', border: `2px solid ${i === idx ? C.azul : 'transparent'}`, background: C.rosa }}>
                  {m.tipo === 'video'
                    ? (m.poster ? <img src={m.poster} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: C.azul, fontSize: 14 }}>▶</div>)
                    : <img src={m.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                </div>
              ))}
            </div>
          )}
          <div style={{ fontFamily: SERIF, fontWeight: 700, fontSize: 26, lineHeight: 1.05, color: C.azulEsc }}>{produto.nome}</div>
          {produto.descricao && <div style={{ fontSize: 14, color: C.tinta2, marginTop: 8, lineHeight: 1.5, whiteSpace: 'pre-line' }}>{produto.descricao}</div>}
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 10 }}>{fmtR(produto.precoDireta)}</div>

          {!esg ? null : estado === 'ok' ? (
            <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 12, background: C.azulClaro, color: C.azulEsc, fontWeight: 700, fontSize: 14 }}>
              Pronto! A gente te chama no WhatsApp quando voltar 💙
            </div>
          ) : (
            <div style={{ marginTop: 16, padding: '14px', borderRadius: 14, background: '#fff', border: `1px solid ${C.linha}` }}>
              <div style={{ fontWeight: 800, color: C.azulEsc, marginBottom: 2 }}>{produto.aCaminho > 0 ? 'Volta em breve' : 'Esgotado no momento'}</div>
              <div style={{ fontSize: 13, color: C.tinta2, marginBottom: 10 }}>Deixa seu WhatsApp que a gente avisa quando voltar.</div>
              <input style={{ ...inp, marginBottom: 8 }} placeholder="Seu nome" value={nome} onChange={e => setNome(e.target.value)} />
              <input style={{ ...inp, marginBottom: 10 }} type="tel" inputMode="numeric" placeholder="WhatsApp com DDD" value={tel} onChange={e => setTel(fmtTel(e.target.value))} />
              {estado && estado !== 'enviando' && <div style={{ fontSize: 12.5, color: '#c0392b', marginBottom: 8 }}>{estado}</div>}
              <button onClick={avisar} disabled={estado === 'enviando'} style={{ width: '100%', height: 46, borderRadius: 12, border: 'none', background: C.azul, color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer', fontFamily: FONTE }}>
                {estado === 'enviando' ? 'Enviando...' : 'Avisar quando voltar'}
              </button>
            </div>
          )}
        </div>
       </div>
        {!esg && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 18px calc(12px + env(safe-area-inset-bottom))', borderTop: `1px solid ${C.linha}`, background: C.creme, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', border: `1.5px solid ${C.linha}`, borderRadius: 12, background: '#fff' }}>
              <button onClick={() => setQtd(q => Math.max(1, q - 1))} style={{ width: 42, height: 46, border: 'none', background: 'none', color: C.azul, fontSize: 20, fontWeight: 800, cursor: 'pointer' }}>−</button>
              <b style={{ minWidth: 24, textAlign: 'center' }}>{qtd}</b>
              <button onClick={() => setQtd(q => Math.min(max, q + 1))} style={{ width: 42, height: 46, border: 'none', background: 'none', color: C.azul, fontSize: 20, fontWeight: 800, cursor: 'pointer' }}>+</button>
            </div>
            <button onClick={() => onConfirmar(qtd)} style={{ flex: 1, height: 48, borderRadius: 12, border: 'none', background: C.azul, color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer', fontFamily: FONTE }}>
              {qtdNoCarrinho ? 'Atualizar' : 'Adicionar'} · {fmtR(produto.precoDireta * qtd)}
            </button>
          </div>
        )}
      </div>
    </>
  )
}

// ── Field helpers ─────────────────────────────────────────────
// Enquanto busca o CEP / calcula o frete: motinho indo até a casa + cards "fantasma"
const ANIM_CSS = `
  @keyframes gx-moto { 0% { left: -8%; opacity: 0 } 12% { opacity: 1 } 80% { left: 78%; opacity: 1 } 100% { left: 84%; opacity: 0 } }
  @keyframes gx-estrada { to { background-position: -24px 0 } }
  @keyframes gx-brilho { 0% { background-position: 100% 0 } 100% { background-position: -100% 0 } }
  @keyframes gx-gira { to { transform: rotate(360deg) } }
  @keyframes gx-surge { from { opacity: 0; transform: translateY(3px) } to { opacity: 1; transform: none } }
  @media (prefers-reduced-motion: reduce) { .gx-anim { animation: none !important } }
`
function CalculandoFrete({ etapa }) {
  const msgs = etapa === 'cep'
    ? ['Buscando seu endereço…']
    : ['Localizando seu endereço…', 'Calculando a rota até você…', 'Vendo os melhores dias de entrega…']
  const [i, setI] = useState(0)
  useEffect(() => {
    setI(0)
    if (msgs.length < 2) return
    const t = setInterval(() => setI(x => Math.min(x + 1, msgs.length - 1)), 1600)
    return () => clearInterval(t)
  }, [etapa]) // eslint-disable-line react-hooks/exhaustive-deps
  const fantasma = {
    flex: '1 1 30%', minWidth: 100, height: 74, borderRadius: 10,
    background: `linear-gradient(90deg, #F7EEF0 25%, #FFFFFF 50%, #F7EEF0 75%)`, backgroundSize: '200% 100%',
    animation: 'gx-brilho 1.3s linear infinite',
  }
  return (
    <div role="status" aria-live="polite" style={{ marginBottom: 14, padding: '14px 14px 12px', borderRadius: 12, background: '#FFFFFF', border: `1px solid ${C.linha}` }}>
      <div key={i} style={{ fontSize: 13.5, fontWeight: 700, color: C.azulEsc, animation: 'gx-surge .3s ease' }} className="gx-anim">{msgs[i]}</div>
      <div style={{ position: 'relative', height: 30, margin: '6px 0 4px', overflow: 'hidden' }}>
        <div className="gx-anim" style={{ position: 'absolute', left: 0, right: 26, bottom: 5, height: 2, opacity: .35, backgroundImage: `linear-gradient(to right, ${C.azul} 50%, transparent 50%)`, backgroundSize: '24px 2px', animation: 'gx-estrada .6s linear infinite' }} />
        <span className="gx-anim" style={{ position: 'absolute', bottom: 5, fontSize: 22, lineHeight: 1, transform: 'scaleX(-1)', animation: 'gx-moto 2.4s ease-in-out infinite' }}>🛵</span>
        <span style={{ position: 'absolute', right: 0, bottom: 4, fontSize: 19, lineHeight: 1 }}>🏠</span>
      </div>
      {etapa !== 'cep' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          {[0, 1, 2].map(k => <div key={k} className="gx-anim" style={{ ...fantasma, animationDelay: `${k * 0.15}s` }} />)}
        </div>
      )}
    </div>
  )
}

// Períodos de entrega (iguais aos do app)
const PERIODOS_PE = { manha: { nome: 'Manhã', faixa: '9–12h' }, tarde: { nome: 'Tarde', faixa: '12–18h' }, noite: { nome: 'Noite', faixa: '18–22h' } }
const SEM_LONGO_PE = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
function diaLongoPE(ymd) {
  const d = new Date(ymd + 'T12:00:00')
  return `${SEM_LONGO_PE[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}
// A rota que já sai (dia + período com outras entregas e frete mais barato)
function rotaEmDestaque(dias) {
  let melhor = null
  for (const dia of dias || []) for (const per of dia.periodos || []) {
    if (!per.compartilhado) continue
    if (!melhor || per.preco < melhor.per.preco || (per.preco === melhor.per.preco && per.pedidos > melhor.per.pedidos)) melhor = { dia, per }
  }
  return melhor
}

// Número do WhatsApp da Guaxí (o mesmo do agente GuaxiMina)
const WHATS_GUAXI = '5521998718459'
const RECIBO_CSS = `
  @keyframes gx-cai { 0% { transform: translateY(0) rotate(0); opacity: 0 } 12% { opacity: 1 } 100% { transform: translateY(240px) rotate(300deg); opacity: 0 } }
  @keyframes gx-pula { 0% { transform: scale(.6) translateY(24px); opacity: 0 } 70% { transform: scale(1.05) translateY(-4px); opacity: 1 } 100% { transform: none; opacity: 1 } }
  @keyframes gx-acena { 0%, 100% { transform: rotate(0) } 30% { transform: rotate(-5deg) } 60% { transform: rotate(4deg) } }
  @media (prefers-reduced-motion: reduce) { .gx-anim { animation: none !important } }
`
// Linha picotada de comanda, com os "furinhos" nas laterais
function Picote() {
  return (
    <div aria-hidden="true" style={{ position: 'relative', height: 18 }}>
      <div style={{ position: 'absolute', left: 18, right: 18, top: 8, borderTop: `2px dashed ${C.linha}` }} />
      <div style={{ position: 'absolute', left: -9, top: 0, width: 18, height: 18, borderRadius: '50%', background: C.creme }} />
      <div style={{ position: 'absolute', right: -9, top: 0, width: 18, height: 18, borderRadius: '50%', background: C.creme }} />
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#8A95A3', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  )
}

function Input({ style, ...props }) {
  return (
    <input
      style={{
        width: '100%', padding: '11px 14px', borderRadius: 10,
        background: '#FFFFFF', border: '1px solid #EBCDD5',
        color: '#1D2B3A', fontSize: 15, fontFamily: 'inherit', outline: 'none',
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

  // Já vem com nome/WhatsApp/endereço da última compra (guardados só neste aparelho)
  const [form, setForm] = useState(() => {
    const c = lerCliente()
    return {
      nome: c.nome || '', telefone: c.telefone || '', tipoEntrega: 'Entrega',
      cep: '', ruaBairro: '', cidade: '', numero: c.numero || '', complemento: c.complemento || '', obs: '',
      cepSalvo: c.cep || '',
    }
  })
  const [loadingCep, setLoadingCep] = useState(false)
  const [cepError, setCepError]     = useState('')
  const [frete, setFrete]           = useState(null)
  const [freteError, setFreteError] = useState('')
  const [calculandoFrete, setCalcFrete] = useState(false)
  const [freteDias, setFreteDias]   = useState(null)   // cards de frete por dia
  const [diaSel, setDiaSel]         = useState(null)   // data escolhida (YYYY-MM-DD)
  const [perSel, setPerSel]         = useState(null)   // manha | tarde | noite
  const [precoSolo, setPrecoSolo]   = useState(null)   // frete de uma entrega sozinha (pra mostrar a economia)
  const [coordCliente, setCoordCliente] = useState(null)
  const [deliveryCfg, setDeliveryCfg] = useState(null)
  const [secoesOrdem, setSecoesOrdem] = useState([])
  const [secaoAtiva, setSecaoAtiva]   = useState(null)
  const [aberto, setAberto]           = useState(null) // produto com a página aberta
  useFontesMarca()
  // Endereço da última compra: ao ir pro checkout com Entrega, já preenche o CEP e calcula o frete
  useEffect(() => {
    if (step !== 'checkout' || form.tipoEntrega !== 'Entrega' || form.cep || !form.cepSalvo) return
    const v = form.cepSalvo.replace(/\D/g, '')
    if (v.length !== 8) return
    setForm(f => ({ ...f, cep: v.slice(0, 5) + '-' + v.slice(5) }))
    fetchCep(v)
  }, [step, form.tipoEntrega]) // eslint-disable-line react-hooks/exhaustive-deps
  const deliveryCfgRef = useRef(null)

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!userId) return
    getPublicProdutos(userId)
      .then(lista => {
        setProdutos(lista)
        // link direto pro doce: /pedido/<loja>?produto=<id> (usado no aviso do WhatsApp)
        const pid = new URLSearchParams(window.location.search).get('produto')
        const alvo = pid && lista.find(p => String(p.id) === pid)
        if (alvo) setAberto(alvo)
      })
      .catch(e => setLoadError(e.message))
    getPublicDeliveryConfig(userId)
      .then(cfg => {
        if (!cfg) return
        // cfg may be { delivery: {...}, secoesOrdem: [...] } (new format)
        // or the flat delivery object (old format)
        const delivery = cfg.delivery ?? cfg
        const secoes = cfg.secoesOrdem ?? []
        deliveryCfgRef.current = delivery
        setDeliveryCfg(delivery)
        setSecoesOrdem(secoes)
      })
      .catch(() => {})
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

  // Fragilidade do carrinho: se qualquer item é frágil, a viagem toda é frágil (carro)
  const fragCarrinho = useMemo(
    () => carrinhoItens.some(it => it.produto.fragilidade === 'fragil') ? 'fragil' : 'robusto',
    [carrinhoItens]
  )

  const diaLabel = (dateStr) => {
    const d = new Date(dateStr + 'T12:00:00')
    const dd = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
    return `${dd[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
  }

  const produtosPorSecao = useMemo(() => {
    if (!produtos) return []
    const semSecao = produtos.filter(p => !p.secao)
    const comSecao = produtos.filter(p => p.secao)
    const secaoSet = [...new Set(comSecao.map(p => p.secao))]
    const ordered = [
      ...secoesOrdem.filter(s => secaoSet.includes(s)),
      ...secaoSet.filter(s => !secoesOrdem.includes(s)),
    ]
    const groups = ordered.map(sec => ({ secao: sec, items: comSecao.filter(p => p.secao === sec) }))
    if (semSecao.length > 0) groups.push({ secao: null, items: semSecao })
    return groups
  }, [produtos, secoesOrdem])

  // Barra de seções: marca a seção que está na tela enquanto rola, mantém o chip
  // ativo à vista e mostra que dá pra arrastar pro lado quando não cabe tudo.
  const barraRef = useRef(null)
  const travaSpy = useRef(0)       // depois de tocar num chip, espera a rolagem suave
  const jaMostrouDica = useRef(false)
  const [setas, setSetas] = useState({ esq: false, dir: false })
  const nomesSecoes = produtosPorSecao.filter(g => g.secao).map(g => g.secao)
  const chaveSecoes = nomesSecoes.join('|')
  const atualizarSetas = () => {
    const b = barraRef.current
    if (!b) return
    const esq = b.scrollLeft > 4, dir = b.scrollLeft + b.clientWidth < b.scrollWidth - 4
    setSetas(s => (s.esq === esq && s.dir === dir ? s : { esq, dir }))
  }
  useEffect(() => {
    if (step !== 'catalog' || nomesSecoes.length < 2) return
    let raf = 0
    const medir = () => {
      raf = 0
      if (Date.now() < travaSpy.current) return
      const topoBarra = (barraRef.current?.parentElement?.offsetHeight || 54) + 24
      const noFim = window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
      let atual = nomesSecoes[0]
      if (noFim) atual = nomesSecoes[nomesSecoes.length - 1]
      else for (const s of nomesSecoes) {
        const el = document.getElementById(`secao-${s}`)
        if (el && el.getBoundingClientRect().top <= topoBarra) atual = s
      }
      setSecaoAtiva(a => (a === atual ? a : atual))
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(medir) }
    const onResize = () => { onScroll(); atualizarSetas() }
    medir(); atualizarSetas()
    // Dica: se as categorias não cabem, dá uma "espiadinha" pro lado uma vez
    const dica = setTimeout(() => {
      const b = barraRef.current
      if (!b || jaMostrouDica.current || b.scrollWidth <= b.clientWidth + 4 || b.scrollLeft > 0) return
      jaMostrouDica.current = true
      b.scrollTo({ left: 64, behavior: 'smooth' })
      setTimeout(() => b.scrollTo({ left: 0, behavior: 'smooth' }), 700)
    }, 900)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(dica)
      window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onResize)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [step, chaveSecoes]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const b = barraRef.current
    if (!b || !secaoAtiva) return
    const chip = [...b.querySelectorAll('[data-secao]')].find(el => el.dataset.secao === secaoAtiva)
    if (!chip) return
    b.scrollTo({ left: Math.max(0, chip.offsetLeft - (b.clientWidth - chip.offsetWidth) / 2), behavior: 'smooth' })
  }, [secaoAtiva])

  const addItem = (prod) => {
    if (prod.esgotado) return
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
      const r = await fetch(`https://brasilapi.com.br/api/cep/v2/${clean}`)
      if (!r.ok) { setCepError('CEP não encontrado'); return }
      const d = await r.json()
      setF('ruaBairro', [d.street, d.neighborhood].filter(Boolean).join(', '))
      setF('cidade', [d.city, d.state].filter(Boolean).join(' - '))
    } catch {
      setCepError('Erro ao buscar CEP')
    } finally {
      setLoadingCep(false)
    }
    // Tenta os cards de frete por dia (server-side); se não houver, cai no cálculo por faixa
    const ok = await calcularFreteDias(cep)
    if (!ok) calcularFrete(cep)
  }

  // Cards de frete por dia — custo marginal real calculado server-side (/api/frete-dias)
  async function calcularFreteDias(cepCliente) {
    const clean = cepCliente.replace(/\D/g, '')
    if (clean.length !== 8 || carrinhoItens.length === 0) return false
    setCalcFrete(true); setFrete(null); setFreteError(''); setFreteDias(null); setDiaSel(null); setPerSel(null)
    try {
      const c = await geocodeCep(clean)
      // 5 casas (~1 m): o mesmo valor vai pro cálculo do frete e pro pedido (assinatura)
      const r5 = (x) => Math.round(Number(x) * 1e5) / 1e5
      const coord = { lat: r5(c.lat), lng: r5(c.lon) }
      setCoordCliente(coord)
      const r = await fetch('/api/frete-dias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, lat: coord.lat, lng: coord.lng, frag: fragCarrinho, total }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setFreteError(j.error || 'Não foi possível calcular o frete por dia'); return false }
      if (!Array.isArray(j.dias) || j.dias.length === 0) {
        // Sem dias de entrega configurados → silencioso, usa o cálculo por faixa
        return false
      }
      setFreteDias(j.dias)
      setPrecoSolo(typeof j.precoSolo === 'number' ? j.precoSolo : null)
      // Já começa na rota que já existe (mais barata); sem rota, no dia mais barato e o cliente escolhe o período
      const dest = rotaEmDestaque(j.dias)
      if (dest) {
        setDiaSel(dest.dia.date); setPerSel(dest.per.periodo)
        setFrete({ valor: dest.per.preco, dia: dest.dia.date, periodo: dest.per.periodo, viaDias: true, assinatura: dest.per.assinatura || null })
      } else {
        const best = [...j.dias].sort((a, b) => a.preco - b.preco)[0]
        setDiaSel(best.date); setPerSel(null)
        setFrete({ valor: best.preco, dia: best.date, periodo: null, viaDias: true, assinatura: null })
      }
      return true
    } catch {
      return false
    } finally {
      setCalcFrete(false)
    }
  }

  const escolherPeriodo = (card, periodo) => {
    const per = (card.periodos || []).find(x => x.periodo === periodo)
    setDiaSel(card.date)
    if (!per) { setPerSel(null); setFrete({ valor: card.preco, dia: card.date, periodo: null, viaDias: true, assinatura: card.assinatura || null }); return }
    setPerSel(periodo)
    setFrete({ valor: per.preco, dia: card.date, periodo, viaDias: true, assinatura: per.assinatura || null })
  }
  const escolherDia = (card) => {
    // mantém o período escolhido se o dia novo também tem; senão o cliente escolhe de novo
    if (perSel && (card.periodos || []).some(x => x.periodo === perSel)) { escolherPeriodo(card, perSel); return }
    setDiaSel(card.date); setPerSel(null)
    setFrete({ valor: card.preco, dia: card.date, periodo: null, viaDias: true, assinatura: (card.periodos || []).length ? null : (card.assinatura || null) })
  }

  async function geocodeCep(cep) {
    const clean = cep.replace(/\D/g, '')
    const r = await fetch(`https://brasilapi.com.br/api/cep/v2/${clean}`)
    if (!r.ok) throw new Error('CEP não encontrado')
    const d = await r.json()

    if (d.latitude && d.longitude) {
      return { lat: parseFloat(d.latitude), lon: parseFloat(d.longitude) }
    }

    // Fallback: geocodifica pelo bairro/cidade via Nominatim
    const query = [d.neighborhood, d.city, d.state, 'Brazil'].filter(Boolean).join(', ')
    const nr = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`, {
      headers: { 'User-Agent': 'GuaxiApp/1.0' }
    })
    const nd = await nr.json()
    if (!nd?.[0]) throw new Error('Localização não encontrada para este CEP')
    return { lat: parseFloat(nd[0].lat), lon: parseFloat(nd[0].lon) }
  }

  function haversineKm(a, b) {
    const R = 6371
    const dLat = (b.lat - a.lat) * Math.PI / 180
    const dLon = (b.lon - a.lon) * Math.PI / 180
    const x = Math.sin(dLat/2) ** 2 +
      Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon/2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
  }

  function applyFreteTiers(distKm, tiers) {
    if (!tiers || tiers.length === 0) return 0
    const sorted = [...tiers].sort((a, b) => a.ate - b.ate)
    for (const tier of sorted) {
      if (distKm <= tier.ate) return tier.valor
    }
    return sorted[sorted.length - 1].valor
  }

  async function calcularFrete(cepCliente) {
    const cfg = deliveryCfgRef.current
    if (!cfg?.lojaCEP || !cfg?.freteTiers?.length) return
    const clean = cepCliente.replace(/\D/g, '')
    if (clean.length !== 8) return
    setCalcFrete(true)
    setFrete(null)
    setFreteError('')
    try {
      const [origem, destino] = await Promise.all([
        geocodeCep(cfg.lojaCEP),
        geocodeCep(clean),
      ])
      // Distância em linha reta × fator de rota 1.35
      const distKm = haversineKm(origem, destino) * 1.35
      const valor = applyFreteTiers(distKm, cfg.freteTiers)
      const freteGratis = cfg.freteGratis || 0
      setFrete({ distKm, valor: freteGratis > 0 && total >= freteGratis ? 0 : valor })
    } catch (e) {
      setFreteError(e.message || 'Erro ao calcular frete')
    } finally {
      setCalcFrete(false)
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

    if (form.tipoEntrega === 'Entrega' && freteDias && !diaSel) { alert('Escolha o dia de entrega'); return }
    if (form.tipoEntrega === 'Entrega' && freteDias && freteDias.some(d => d.periodos?.length) && !perSel) { alert('Escolha o período da entrega (manhã, tarde ou noite)'); return }

    const freteValor = form.tipoEntrega === 'Entrega' && frete ? frete.valor : 0
    const entrega = form.tipoEntrega === 'Entrega'
      ? { dataEntrega: diaSel, periodo: perSel || null, lat: coordCliente?.lat, lng: coordCliente?.lng, frag: fragCarrinho, freteAssinatura: frete?.viaDias ? frete.assinatura : null }
      : {}

    setSubmitting(true)
    try {
      const id = await submitPedidoExterno(userId, { ...form, endereco }, carrinhoItens, freteValor, entrega)
      salvarCliente({ nome: form.nome, telefone: form.telefone, tipoEntrega: form.tipoEntrega, cep: form.cep, numero: form.numero, complemento: form.complemento })
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
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FFF9F7', color: '#5B6878', fontFamily: FONTE }}>
        Carregando...
      </div>
    )
  }
  if (loadError) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FFF9F7', color: '#c0392b', fontFamily: FONTE, padding: 32, textAlign: 'center' }}>
        Não foi possível carregar o cardápio.
      </div>
    )
  }

  const shell = {
    background: '#FFF9F7',
    minHeight: '100dvh',
    fontFamily: FONTE,
    color: '#1D2B3A',
    maxWidth: 640,
    margin: '0 auto',
  }

  // ── Confirmation (recibo) ────────────────────────────────────
  if (step === 'confirm') {
    const primeiro = (form.nome || '').trim().split(/\s+/)[0]
    const ehEntrega = form.tipoEntrega === 'Entrega'
    const dia = ehEntrega ? (frete?.dia || diaSel) : null
    const enderecoTxt = [form.ruaBairro, form.numero, form.complemento].filter(Boolean).join(', ')
    const freteValor = ehEntrega && frete ? frete.valor : 0
    const msgWa = `Oi, GuaxiMina! Acabei de fazer o pedido ${pedidoId} pelo cardápio 🧁`
    const linkWa = `https://wa.me/${WHATS_GUAXI}?text=${encodeURIComponent(msgWa)}`
    const CONFETES = ['#185D9C', '#F4A3B5', '#F6C453', '#7FB8E8', '#FFFFFF', '#0E3C68', '#F4A3B5', '#F6C453', '#7FB8E8', '#185D9C', '#FFFFFF', '#F4A3B5']
    const linha = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, fontSize: 14, padding: '7px 0' }
    return (
      <div style={{ ...shell, background: C.creme }}>
        <style>{RECIBO_CSS}</style>
        {/* Topo da marca com confete */}
        <div style={{ background: C.rosa, padding: '26px 20px 70px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
          {CONFETES.map((cor, i) => (
            <i key={i} aria-hidden="true" className="gx-anim" style={{
              position: 'absolute', top: -12, left: `${6 + i * 8}%`, width: i % 3 ? 7 : 5, height: i % 3 ? 12 : 5, borderRadius: i % 3 ? 2 : '50%',
              background: cor, animation: `gx-cai ${1.6 + (i % 4) * 0.35}s ease-in ${(i % 5) * 0.12}s both`,
            }} />
          ))}
          <div style={{ position: 'relative', width: 124, margin: '0 auto' }}>
            <img src="/brand/guaxinim.png" alt="Guaxí" className="gx-anim" style={{ width: 124, height: 'auto', display: 'block', animation: 'gx-pula .7s cubic-bezier(.2,.9,.3,1.3) both, gx-acena 2.4s ease-in-out .9s 2' }} />
            <div style={{ position: 'absolute', right: -6, bottom: 2, width: 44, height: 44, borderRadius: '50%', background: '#FFFFFF', display: 'grid', placeItems: 'center', boxShadow: '0 4px 12px rgba(14,60,104,.18)' }}>
              <CheckAnim size={34} />
            </div>
          </div>
          <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 32, color: C.azul, lineHeight: 1.1, marginTop: 10 }}>Pedido recebido!</div>
          <div style={{ fontSize: 15, color: C.azulEsc, marginTop: 6 }}>
            {primeiro ? `Obrigada, ${primeiro}!` : 'Obrigada!'} Já tá tudo anotadinho aqui 💛
          </div>
        </div>

        <div style={{ padding: '0 16px 36px', marginTop: -50, position: 'relative' }}>
          {/* Recibo em formato de comanda */}
          <div style={{ background: '#FFFFFF', borderRadius: 18, boxShadow: '0 10px 30px rgba(14,60,104,.12)', position: 'relative', maxWidth: 440, margin: '0 auto' }}>
            <div style={{ padding: '18px 18px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 20, letterSpacing: '.08em', color: C.azul, lineHeight: 1 }}>GUAXÍ</div>
                <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 10, letterSpacing: '.3em', color: C.azul }}>PÂTISSERIE</div>
              </div>
              <span style={{ fontSize: 13, fontWeight: 800, color: C.azul, background: C.azulClaro, padding: '5px 10px', borderRadius: 99 }}>{pedidoId}</span>
            </div>
            <Picote />
            <div style={{ padding: '6px 18px 4px' }}>
              {carrinhoItens.map(it => (
                <div key={it.produto.id} style={linha}>
                  <span><b style={{ fontWeight: 700 }}>{it.qtd}×</b> {it.produto.nome}</span>
                  <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtR((it.produto.precoDireta || 0) * it.qtd)}</span>
                </div>
              ))}
              {freteValor > 0 && (
                <div style={{ ...linha, color: C.tinta2, fontSize: 13 }}>
                  <span>Frete</span><span>{fmtR(freteValor)}</span>
                </div>
              )}
              <div style={{ ...linha, fontSize: 18, fontWeight: 800, paddingTop: 10 }}>
                <span>Total</span><span style={{ color: C.azul }}>{fmtR(total + freteValor)}</span>
              </div>
            </div>
            <Picote />
            <div style={{ padding: '8px 18px 18px', display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <span style={{ fontSize: 18 }}>{ehEntrega ? '🛵' : '🏠'}</span>
                <div>
                  <b>{ehEntrega ? (dia ? `Entrega ${diaLabel(dia)}${perSel ? ` · ${PERIODOS_PE[perSel].nome.toLowerCase()} (${PERIODOS_PE[perSel].faixa})` : ''}` : 'Entrega') : 'Retirada'}</b>
                  <div style={{ color: C.tinta2, fontSize: 13, marginTop: 1 }}>
                    {ehEntrega ? (enderecoTxt || 'no endereço informado') : 'a gente combina o dia e o horário pelo WhatsApp'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <span style={{ fontSize: 18 }}>💸</span>
                <div>
                  <b>Pagamento por Pix</b>
                  <div style={{ color: C.tinta2, fontSize: 13, marginTop: 1 }}>a chave vai pelo WhatsApp</div>
                </div>
              </div>
            </div>
          </div>

          {/* WhatsApp da Guaxí */}
          <div style={{ maxWidth: 440, margin: '18px auto 0', textAlign: 'center' }}>
            <a href={linkWa} target="_blank" rel="noreferrer" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 54, borderRadius: 16,
              background: '#25D366', color: '#073B1E', fontWeight: 800, fontSize: 16, textDecoration: 'none',
              boxShadow: '0 8px 20px rgba(37,211,102,.35)', fontFamily: FONTE,
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z" stroke="#073B1E" strokeWidth="2" strokeLinejoin="round" /><path d="M9 9.5c.3 1.7 1.8 3.6 3.6 4.4l1.1-1.1 1.8.8-.4 1.6c-3.2.2-6.6-3-6.6-6.3l1.6-.4.8 1.8z" fill="#073B1E" /></svg>
              Confirmar no WhatsApp
            </a>
            <div style={{ fontSize: 13, color: C.tinta2, marginTop: 10, lineHeight: 1.45 }}>
              A <b style={{ color: C.azul }}>GuaxiMina</b> te manda o recibo por lá e tira qualquer dúvida&nbsp;🦝
            </div>
            <button onClick={() => { setStep('catalog'); setCarrinho({}); window.scrollTo(0, 0) }} style={{
              marginTop: 18, background: 'none', border: 'none', color: C.azul, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: FONTE, padding: 8,
            }}>Voltar ao cardápio</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Checkout form ─────────────────────────────────────────────
  if (step === 'checkout') {
    return (
      <div style={shell}>
        <style>{ANIM_CSS}</style>
        {/* Header */}
        <div style={{ position: 'sticky', top: 0, background: '#FFFFFF', borderBottom: '1px solid #EBCDD5', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, zIndex: 10 }}>
          <button onClick={() => setStep('catalog')} style={{ background: 'none', border: 'none', color: '#5B6878', fontSize: 22, cursor: 'pointer', padding: 0, lineHeight: 1 }}>←</button>
          <span style={{ fontWeight: 700, fontSize: 16 }}>Finalizar pedido</span>
        </div>

        <div style={{ padding: '20px 20px 120px' }}>
          {/* Order summary */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#5B6878', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Seu pedido</div>
            <div style={{ background: '#FFFFFF', borderRadius: 12, overflow: 'hidden' }}>
              {carrinhoItens.map((it, i) => (
                <div key={it.produto.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '11px 14px',
                  borderBottom: i < carrinhoItens.length - 1 ? '1px solid #EBCDD5' : 'none',
                  fontSize: 13,
                }}>
                  <span>{it.produto.nome} <span style={{ color: '#5B6878' }}>×{it.qtd}</span></span>
                  <span style={{ fontWeight: 600 }}>{fmtR((it.produto.precoDireta || 0) * it.qtd)}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 4px', fontWeight: 700, fontSize: 16 }}>
              <span>Total</span>
              <span style={{ color: '#185D9C' }}>{fmtR(total)}</span>
            </div>
          </div>

          {/* Form */}
          <Field label="Nome completo">
            <Input placeholder="Seu nome" value={form.nome} onChange={e => setF('nome', e.target.value)} />
          </Field>

          <Field label="WhatsApp">
            <Input
              type="tel"
              inputMode="numeric"
              placeholder="(11) 99999-9999"
              value={form.telefone}
              onChange={e => {
                const digits = e.target.value.replace(/\D/g, '').slice(0, 11)
                let fmt = digits
                if (digits.length > 2) fmt = `(${digits.slice(0,2)}) ${digits.slice(2)}`
                if (digits.length > 7) fmt = `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}`
                setF('telefone', fmt)
              }}
            />
          </Field>

          {/* Entrega/Retirada toggle */}
          <Field label="Tipo de entrega">
            <div style={{ display: 'flex', gap: 8 }}>
              {['Entrega', 'Retirada'].map(opt => (
                <button
                  key={opt}
                  onClick={() => setF('tipoEntrega', opt)}
                  style={{
                    flex: 1, padding: '11px 0', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer',
                    border: `1.5px solid ${form.tipoEntrega === opt ? '#185D9C' : '#EBCDD5'}`,
                    background: form.tipoEntrega === opt ? 'rgba(24,93,156,.1)' : 'transparent',
                    color: form.tipoEntrega === opt ? '#185D9C' : '#666',
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
                    <span aria-hidden="true" className="gx-anim" style={{ position: 'absolute', right: 14, top: '50%', width: 16, height: 16, marginTop: -8, borderRadius: '50%', border: `2px solid ${C.azulClaro}`, borderTopColor: C.azul, animation: 'gx-gira .7s linear infinite' }} />
                  )}
                </div>
                {cepError && <div style={{ fontSize: 12, color: '#c0392b', marginTop: 4 }}>{cepError}</div>}
              </Field>

              {form.ruaBairro && (
                <Field label="Rua, Bairro">
                  <Input value={form.ruaBairro} readOnly style={{ color: '#5B6878', background: '#F7EEF0' }} />
                  {form.cidade && <div style={{ fontSize: 12, color: '#5B6878', marginTop: 4 }}>{form.cidade}</div>}
                </Field>
              )}

              {/* Frete */}
              {(calculandoFrete || loadingCep) && <CalculandoFrete etapa={loadingCep ? 'cep' : 'frete'} />}
              {freteError && !calculandoFrete && !loadingCep && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ fontSize: 12, color: '#c0392b' }}>{freteError}</span>
                  <button onClick={() => calcularFrete(form.cep)} style={{ fontSize: 12, color: '#185D9C', background: 'none', border: 'none', cursor: 'pointer' }}>🔄 Tentar novamente</button>
                </div>
              )}
              {/* Dia e período: destaque pra rota que já sai (mais barata), depois os outros dias */}
              {freteDias && !calculandoFrete && !loadingCep && (() => {
                const dest = rotaEmDestaque(freteDias)
                const diaAtual = freteDias.find(d => d.date === diaSel)
                const destSel = dest && diaSel === dest.dia.date && perSel === dest.per.periodo
                const temPeriodos = freteDias.some(d => d.periodos?.length)
                const fmtP = v => (v === 0 ? 'Grátis' : fmtR(v))
                return (
                <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 24, color: C.azulEsc, lineHeight: 1.1 }}>Quando você quer receber?</div>
                  {dest && (
                    <button type="button" onClick={() => escolherPeriodo(dest.dia, dest.per.periodo)} style={{
                      textAlign: 'left', padding: 16, borderRadius: 16, cursor: 'pointer', fontFamily: FONTE, color: C.tinta,
                      border: `2px solid ${destSel ? C.azul : '#B9CDE2'}`, background: '#FFFFFF',
                      boxShadow: destSel ? '0 0 0 4px rgba(24,93,156,.12), 0 8px 20px rgba(24,93,156,.16)' : '0 4px 12px rgba(24,93,156,.08)',
                      display: 'flex', flexDirection: 'column', gap: 6,
                    }}>
                      <span style={{ alignSelf: 'flex-start', fontSize: 11, fontWeight: 800, letterSpacing: '.04em', color: '#FFFFFF', background: C.azul, padding: '3px 9px', borderRadius: 99 }}>JÁ TEM ENTREGA SAINDO</span>
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 18, fontWeight: 800, flex: 1, minWidth: 170 }}>{diaLongoPE(dest.dia.date)} · {PERIODOS_PE[dest.per.periodo].nome.toLowerCase()}</span>
                        {precoSolo != null && precoSolo > dest.per.preco && <span style={{ fontSize: 13, color: C.tinta2, textDecoration: 'line-through' }}>{fmtR(precoSolo)}</span>}
                        <span style={{ fontSize: 20, fontWeight: 800, color: C.azul }}>{fmtP(dest.per.preco)}</span>
                      </span>
                      <span style={{ fontSize: 13.5, color: C.tinta2, lineHeight: 1.4 }}>
                        Seu pedido vai junto com {dest.per.pedidos === 1 ? 'outra entrega' : `outras ${dest.per.pedidos} entregas`} da região. Prefere receber nesse dia e pagar menos?
                      </span>
                      {destSel && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: C.azul }}>
                          <span style={{ width: 18, height: 18, borderRadius: '50%', background: C.azul, display: 'grid', placeItems: 'center' }}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12l5 5 9-10" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </span>
                          Escolhido · entre {PERIODOS_PE[dest.per.periodo].faixa.replace('–', 'h e ')}
                        </span>
                      )}
                    </button>
                  )}
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: C.tinta2, paddingTop: dest ? 4 : 0 }}>{dest ? 'Ou escolha outro dia' : 'Escolha o dia'}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                    {freteDias.map(card => {
                      const sel = diaSel === card.date && !destSel
                      const precos = (card.periodos || []).map(x => x.preco)
                      const varia = precos.length > 1 && Math.min(...precos) < Math.max(...precos)
                      return (
                        <button type="button" key={card.date} onClick={() => escolherDia(card)} style={{
                          padding: '10px 6px', borderRadius: 12, cursor: 'pointer', fontFamily: FONTE, color: C.tinta,
                          border: `${sel ? 2 : 1.5}px solid ${sel ? C.azul : C.linha}`, background: sel ? 'rgba(24,93,156,.06)' : '#FFFFFF',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minHeight: 72,
                        }}>
                          <span style={{ fontSize: 13.5, fontWeight: 700 }}>{diaLabel(card.date)}</span>
                          <span style={{ fontSize: 11.5, color: C.tinta2 }}>{card.pedidos > 0 ? `${card.pedidos} ${card.pedidos === 1 ? 'entrega' : 'entregas'}` : 'primeiro do dia'}</span>
                          <span style={{ fontSize: 14, fontWeight: 700, color: sel ? C.azul : C.tinta }}>{varia ? `a partir de ${fmtP(card.preco)}` : fmtP(card.preco)}</span>
                        </button>
                      )
                    })}
                  </div>
                  {diaAtual && temPeriodos && (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: C.tinta2, paddingTop: 6 }}>
                        Período {diaAtual.date ? `· ${diaLabel(diaAtual.date)}` : ''}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                        {(diaAtual.periodos || []).map(per => {
                          const sel = perSel === per.periodo
                          const info = PERIODOS_PE[per.periodo]
                          return (
                            <button type="button" key={per.periodo} onClick={() => escolherPeriodo(diaAtual, per.periodo)} style={{
                              minHeight: 66, borderRadius: 12, cursor: 'pointer', fontFamily: FONTE,
                              border: `${sel ? 2 : 1.5}px solid ${sel ? C.azul : C.linha}`, background: sel ? 'rgba(24,93,156,.08)' : '#FFFFFF',
                              color: sel ? C.azul : C.tinta, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                            }}>
                              <span style={{ fontSize: 14, fontWeight: sel ? 800 : 700 }}>{info.nome}</span>
                              <span style={{ fontSize: 12, color: sel ? C.azul : C.tinta2 }}>{info.faixa}</span>
                              <span style={{ fontSize: 11.5, fontWeight: 800, color: sel ? C.azul : C.tinta2 }}>{fmtP(per.preco)}</span>
                            </button>
                          )
                        })}
                      </div>
                      {!perSel && <div style={{ fontSize: 12.5, fontWeight: 700, color: '#B45309' }}>Escolha um período pra continuar</div>}
                    </>
                  )}
                  <div style={{ fontSize: 12, color: C.tinta2, lineHeight: 1.45 }}>
                    O horário certinho a gente combina com você pelo WhatsApp. O frete pode <strong style={{ color: C.azul }}>abaixar</strong> se mais gente pedir pro mesmo dia e período.
                  </div>
                </div>
                )
              })()}
              {frete !== null && !frete.viaDias && !calculandoFrete && !loadingCep && (
                <div style={{ display: 'flex', justifyContent: 'space-between', background: '#FFFFFF', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>
                  <div>
                    <div style={{ fontWeight: 600, color: '#1D2B3A' }}>Frete ({frete.distKm.toFixed(1)} km)</div>
                    {frete.valor === 0 && deliveryCfg?.freteGratis > 0 && <div style={{ fontSize: 11, color: '#185D9C' }}>Frete grátis acima de {fmtR(deliveryCfg.freteGratis)}</div>}
                  </div>
                  <div style={{ fontWeight: 700, color: frete.valor === 0 ? '#185D9C' : '#1D2B3A' }}>
                    {frete.valor === 0 ? 'Grátis' : fmtR(frete.valor)}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <Field label="Número" >
                  <Input type="text" inputMode="numeric" placeholder="123" value={form.numero} onChange={e => setF('numero', e.target.value)} style={{ width: 100 }} />
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
                background: '#FFFFFF', border: '1px solid #EBCDD5',
                color: '#1D2B3A', fontSize: 14, fontFamily: 'inherit', outline: 'none', resize: 'vertical',
              }}
            />
          </Field>
        </div>

        {/* Sticky submit */}
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, maxWidth: 640, margin: '0 auto', padding: '16px 20px', background: '#FFFFFF', borderTop: '1px solid #EBCDD5' }}>
          <button
            onClick={handleSubmit}
            disabled={submitting || !form.nome || !form.telefone}
            style={{
              width: '100%', padding: 14, borderRadius: 12,
              background: '#185D9C', color: '#fff', border: 'none',
              fontWeight: 700, fontSize: 16, cursor: 'pointer',
              opacity: (!form.nome || !form.telefone || submitting) ? 0.5 : 1,
            }}
          >
            {submitting ? 'Enviando...' : `Enviar pedido · ${fmtR(total + (form.tipoEntrega === 'Entrega' && frete ? frete.valor : 0))}`}
          </button>
        </div>
      </div>
    )
  }

  // ── Catálogo ──────────────────────────────────────────────────
  const carrinhoCount = Object.values(carrinho).reduce((s, q) => s + q, 0)
  const secoes = produtosPorSecao.filter(g => g.secao).map(g => g.secao)
  const scrollToSecao = (secao) => {
    const el = document.getElementById(`secao-${secao}`)
    travaSpy.current = Date.now() + 900
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setSecaoAtiva(secao)
  }
  const dias = (deliveryCfg?.diasEntrega || []).slice().sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7)).map(d => DIAS[d])
  const chip = { fontSize: 11.5, fontWeight: 700, color: C.azulEsc, background: 'rgba(255,255,255,.7)', border: '1px solid rgba(24,93,156,.18)', padding: '4px 10px', borderRadius: 99 }

  return (
    <div style={{ ...shell, background: C.creme }}>
      {/* Marca */}
      <div style={{ background: C.rosa, padding: '20px 18px 16px', textAlign: 'center' }}>
        <img src="/brand/guaxinim.png" alt="Guaxí" style={{ width: 104, height: 'auto', display: 'block', margin: '0 auto -2px' }} />
        <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 36, letterSpacing: '.06em', color: C.azul, lineHeight: 1 }}>GUAXÍ</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 200, margin: '7px auto 4px' }}>
          <i style={{ flex: 1, height: 1, background: C.azul }} /><b style={{ width: 6, height: 6, background: C.azul, transform: 'rotate(45deg)' }} /><i style={{ flex: 1, height: 1, background: C.azul }} />
        </div>
        <div style={{ fontFamily: SERIF, fontWeight: 600, letterSpacing: '.32em', fontSize: 13, color: C.azul }}>PÂTISSERIE</div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap', marginTop: 12 }}>
          {dias.length > 0 && <span style={chip}>🛵 Entregas {dias.join(' · ')}</span>}
          <span style={chip}>Retirada</span>
        </div>
      </div>

      {/* Seções */}
      {secoes.length > 1 && (
        <div style={{ position: 'sticky', top: 0, zIndex: 10, background: C.creme, borderBottom: `1px solid ${C.linha}` }}>
          <nav ref={barraRef} onScroll={atualizarSetas} aria-label="Categorias" style={{ position: 'relative', overflowX: 'auto', display: 'flex', gap: 6, padding: '9px 14px', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
            {secoes.map(sec => {
              const on = secaoAtiva === sec
              return (
                <button key={sec} data-secao={sec} aria-current={on ? 'true' : undefined} onClick={() => scrollToSecao(sec)} style={{
                  flexShrink: 0, minHeight: 36, padding: '0 14px', borderRadius: 99, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: FONTE,
                  border: `1px solid ${on ? C.azul : C.linha}`, background: on ? C.azul : '#FFFFFF', color: on ? '#fff' : C.tinta2,
                  transition: 'background .2s, color .2s, border-color .2s',
                }}>{sec}</button>
              )
            })}
            <span aria-hidden="true" style={{ flexShrink: 0, width: setas.dir ? 26 : 0 }} />
          </nav>
          {setas.esq && (
            <div aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 30, pointerEvents: 'none', background: `linear-gradient(to right, ${C.creme}, rgba(255,249,247,0))` }} />
          )}
          {setas.dir && (
            <button aria-label="Ver mais categorias" onClick={() => { const b = barraRef.current; if (b) b.scrollBy({ left: b.clientWidth * 0.6, behavior: 'smooth' }) }} style={{
              position: 'absolute', right: 0, top: 0, bottom: 0, width: 52, border: 'none', cursor: 'pointer', padding: '0 10px 0 0',
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
              background: `linear-gradient(to left, ${C.creme} 50%, rgba(255,249,247,0))`,
            }}>
              <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#FFFFFF', border: `1px solid ${C.linha}`, boxShadow: '0 2px 6px rgba(14,60,104,.12)', color: C.azul, display: 'grid', placeItems: 'center', fontSize: 17, fontWeight: 700, lineHeight: 1 }}>›</span>
            </button>
          )}
        </div>
      )}

      {produtos.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: C.tinta2, fontSize: 14 }}>Nenhum produto no cardápio agora.</div>
      ) : (
        <div style={{ padding: '4px 12px 120px' }}>
          {produtosPorSecao.map(({ secao, items }) => (
            <div key={secao || '__sem_secao'} id={secao ? `secao-${secao}` : undefined} style={{ scrollMarginTop: 58 }}>
              {secao && <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 22, color: C.azulEsc, padding: '14px 4px 8px' }}>{secao}</div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginBottom: 8 }}>
                {[...items].sort((x, y) => ((x.esgotado ? 1 : 0) - (y.esgotado ? 1 : 0)) || ((x.ordem ?? 1e9) - (y.ordem ?? 1e9))).map(prod => (
                  <ProdutoCard key={prod.id} produto={prod} qtd={carrinho[prod.id] || 0}
                    onAdd={() => addItem(prod)} onRemove={() => removeItem(prod)} onAbrir={() => setAberto(prod)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {aberto && (
        <ProdutoSheet produto={aberto} userId={userId} qtdNoCarrinho={carrinho[aberto.id] || 0} onClose={() => setAberto(null)}
          onConfirmar={(q) => { setCarrinho(c => ({ ...c, [aberto.id]: q })); setAberto(null) }} />
      )}

      {/* Carrinho */}
      {carrinhoCount > 0 && !aberto && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 12, maxWidth: 616, margin: '0 auto', padding: '0 12px', zIndex: 20 }}>
          <button onClick={() => setStep('checkout')} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', borderRadius: 16, border: 'none', background: C.azul, color: '#fff', cursor: 'pointer', boxShadow: '0 10px 24px rgba(14,60,104,.35)', fontFamily: FONTE }}>
            <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#fff', color: C.azul, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13 }}>{carrinhoCount}</span>
            <b style={{ flex: 1, textAlign: 'left', fontSize: 15 }}>Ver carrinho</b>
            <b style={{ fontSize: 15 }}>{fmtR(total)}</b>
          </button>
        </div>
      )}
    </div>
  )
}
