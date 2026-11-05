import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  getAtendimentos, getConversa, marcarAtendimentoLido, setBotPausado, enviarWhatsApp, getPedidosDoTelefone,
} from '../services/db'
import { suportaPush, ativarAvisos, avisosAtivos } from '../lib/push'

// ── Atendimento do WhatsApp: conversas do bot, assumir e responder pelo app ──

const JANELA_H = 24
const fmtTel = (t) => {
  const d = String(t || '').replace(/\D/g, '').replace(/^55/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return t
}
const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
function quando(iso) {
  if (!iso) return ''
  const d = new Date(iso), hoje = new Date()
  if (d.toDateString() === hoje.toDateString()) return hora(iso)
  const ontem = new Date(hoje.getTime() - 86400e3)
  if (d.toDateString() === ontem.toDateString()) return 'ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}
const dia = (iso) => new Date(iso).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })
// Quanto falta pra fechar a janela de 24h da Meta (ms; <= 0 = fechada)
const restaJanela = (iso) => (iso ? new Date(iso).getTime() + JANELA_H * 3600e3 - Date.now() : -1)

function useIntervalo(fn, ms) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') ref.current() }, ms)
    return () => clearInterval(t)
  }, [ms])
}

export default function Atendimento() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const aberto = params.get('c')
  const [lista, setLista] = useState(undefined)
  const [filtro, setFiltro] = useState('todas')
  const [avisos, setAvisos] = useState(true)

  const carregar = () => getAtendimentos().then(setLista).catch(() => setLista(null))
  useEffect(() => { carregar() }, [])
  useIntervalo(carregar, 8000)
  useEffect(() => { if (suportaPush()) avisosAtivos().then(setAvisos) }, [])

  const abrir = (tel) => setParams(tel ? { c: tel } : {})
  const precisam = (lista || []).filter(a => a.precisaHumano)
  const naoLidas = (lista || []).filter(a => a.naoLidas > 0)
  const visiveis = filtro === 'precisam' ? precisam : filtro === 'naolidas' ? naoLidas : (lista || [])
  const atual = (lista || []).find(a => a.telefone === aberto)

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => (aberto ? abrir(null) : navigate(-1))} style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', padding: '0 4px', display: 'flex', alignItems: 'center' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <div>
              <div className="topbar-title">Atendimento</div>
              <div className="topbar-sub">WhatsApp da Guaxí</div>
            </div>
          </div>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 12, paddingBottom: 12, maxWidth: 1100 }}>
        {lista === null ? (
          <div className="card" style={{ color: 'var(--text-secondary)', fontSize: 14 }}>O atendimento ainda está sendo configurado no banco.</div>
        ) : (
          <div className="atd-grid" data-aberto={aberto ? '1' : '0'}>
            <div className="atd-lista">
              {!avisos && suportaPush() && (
                <button onClick={() => ativarAvisos().then(() => setAvisos(true)).catch(e => alert(e.message))}
                  style={{ width: '100%', marginBottom: 10, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--teal)', background: 'rgba(34,184,134,.08)', color: 'var(--teal)', fontWeight: 700, fontSize: 13, cursor: 'pointer', textAlign: 'left' }}>
                  🔔 Avisar neste aparelho quando um cliente chamar
                </button>
              )}
              <div style={{ display: 'flex', gap: 6, marginBottom: 10, overflowX: 'auto' }}>
                {[['todas', 'Todas', (lista || []).length], ['precisam', '🙋 Precisam de você', precisam.length], ['naolidas', 'Não lidas', naoLidas.length]].map(([k, l, n]) => (
                  <button key={k} onClick={() => setFiltro(k)} style={{
                    flexShrink: 0, fontSize: 12.5, padding: '6px 12px', borderRadius: 20, cursor: 'pointer', fontWeight: 600,
                    border: `1px solid ${filtro === k ? 'var(--teal)' : '#333'}`, background: filtro === k ? 'var(--teal)' : 'transparent',
                    color: filtro === k ? '#fff' : (k === 'precisam' && n ? '#f5b544' : 'var(--text-secondary)'),
                  }}>{l} <span style={{ opacity: 0.75 }}>{n}</span></button>
                ))}
              </div>
              {lista === undefined ? <div className="loading">Carregando...</div> : (
                <div className="card card-flush lista-prod" style={{ overflow: 'hidden' }}>
                  {visiveis.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Nenhuma conversa</div>}
                  {visiveis.map(a => <ItemConversa key={a.telefone} a={a} ativo={a.telefone === aberto} onClick={() => abrir(a.telefone)} />)}
                </div>
              )}
            </div>
            <div className="atd-chat">
              {atual ? <Conversa key={atual.telefone} a={atual} onMudou={carregar} />
                : <div className="card" style={{ height: '100%', display: 'grid', placeItems: 'center', color: 'var(--text-tertiary)', fontSize: 14 }}>Escolha uma conversa</div>}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function ItemConversa({ a, ativo, onClick }) {
  const u = a.ultima
  const prefixo = u ? (u.role === 'assistant' ? '🤖 ' : u.role === 'humano' ? 'Você: ' : '') : ''
  return (
    <div onClick={onClick} style={{ display: 'flex', gap: 10, padding: '11px 12px', cursor: 'pointer', background: ativo ? 'rgba(34,184,134,.08)' : 'transparent' }}>
      <div style={{ width: 40, height: 40, borderRadius: 20, flexShrink: 0, display: 'grid', placeItems: 'center', fontWeight: 800, background: '#2a2a2a', color: 'var(--text-secondary)' }}>
        {(a.nome || '?').charAt(0).toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ flex: 1, minWidth: 0, fontWeight: a.naoLidas ? 800 : 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.nome || fmtTel(a.telefone)}</span>
          <span style={{ fontSize: 11, color: a.naoLidas ? 'var(--teal)' : 'var(--text-tertiary)', flexShrink: 0 }}>{quando(a.ultimaMsgEm)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prefixo}{u?.conteudo || ''}</span>
          {a.naoLidas > 0 && <span style={{ fontSize: 11, fontWeight: 800, background: 'var(--teal)', color: '#fff', borderRadius: 10, padding: '1px 7px', flexShrink: 0 }}>{a.naoLidas}</span>}
        </div>
        <div style={{ display: 'flex', gap: 5, marginTop: 4 }}>
          {a.precisaHumano && <span style={{ fontSize: 10.5, fontWeight: 700, color: '#f5b544', background: 'rgba(245,181,68,.12)', borderRadius: 10, padding: '1px 7px' }}>🙋 precisa de você</span>}
          <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-tertiary)', background: 'rgba(255,255,255,.05)', borderRadius: 10, padding: '1px 7px' }}>{a.botPausado ? '🧑 com você' : '🤖 bot atendendo'}</span>
        </div>
      </div>
    </div>
  )
}

function Conversa({ a, onMudou }) {
  const navigate = useNavigate()
  const [msgs, setMsgs] = useState(null)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [pedidos, setPedidos] = useState([])
  const fimRef = useRef(null)
  const qtdRef = useRef(0)

  const carregar = async () => {
    const m = await getConversa(a.telefone).catch(() => null)
    if (!m) return
    setMsgs(m)
    if (m.length !== qtdRef.current) {
      qtdRef.current = m.length
      await marcarAtendimentoLido(a.telefone)
      onMudou()
      setTimeout(() => fimRef.current?.scrollIntoView({ block: 'end' }), 30)
    }
  }
  useEffect(() => { carregar(); getPedidosDoTelefone(a.telefone).then(setPedidos) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useIntervalo(carregar, 5000)

  const resta = restaJanela(a.ultimaMsgClienteEm)
  const aberta = resta > 0
  async function enviar() {
    const t = texto.trim()
    if (!t || enviando) return
    setEnviando(true)
    try {
      await enviarWhatsApp(a.telefone, t)
      setTexto('')
      await carregar()
      onMudou()
    } catch (e) { alert(e.message) } finally { setEnviando(false) }
  }
  async function alternarBot() {
    try { await setBotPausado(a.telefone, !a.botPausado); onMudou() } catch (e) { alert('Erro: ' + e.message) }
  }

  const grupos = useMemo(() => {
    const g = []
    for (const m of (msgs || [])) {
      const d = new Date(m.created_at).toDateString()
      if (!g.length || g[g.length - 1].d !== d) g.push({ d, iso: m.created_at, itens: [] })
      g[g.length - 1].itens.push(m)
    }
    return g
  }, [msgs])

  return (
    <div className="card card-flush" style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Cabeçalho */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.nome || fmtTel(a.telefone)}</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            <a href={`https://wa.me/${a.telefone}`} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{fmtTel(a.telefone)}</a>
          </div>
        </div>
        <button onClick={alternarBot} style={{
          padding: '8px 12px', borderRadius: 9, cursor: 'pointer', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap',
          border: a.botPausado ? '1px solid #333' : 'none', background: a.botPausado ? 'transparent' : 'var(--teal)', color: a.botPausado ? 'var(--text-secondary)' : '#fff',
        }}>{a.botPausado ? '🤖 Devolver pro bot' : '🧑 Assumir'}</button>
      </div>
      {pedidos.length > 0 && (
        <div style={{ padding: '7px 12px', borderBottom: '1px solid #2a2a2a', display: 'flex', gap: 6, overflowX: 'auto' }}>
          {pedidos.map(p => {
            const rota = ['ASSIGNING_DRIVER', 'ON_GOING', 'PICKED_UP'].includes(p.envioStatus)
            return (
              <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, fontSize: 12, padding: '4px 9px', borderRadius: 999, background: 'var(--bg-input)', border: '1px solid #333' }}>
                <span onClick={() => navigate('/pedidos', { state: { openPedidoId: p.id } })} style={{ cursor: 'pointer', fontWeight: 700 }}>{p.id}</span>
                <span style={{ color: p.status === 'Entregue' ? '#4ade80' : 'var(--text-tertiary)' }}>{rota ? '🛵 em rota' : p.status}</span>
                {rota && p.rastreio && <a href={p.rastreio} target="_blank" rel="noreferrer" style={{ color: 'var(--teal)', fontWeight: 700, textDecoration: 'none' }}>rastrear ↗</a>}
              </span>
            )
          })}
        </div>
      )}
      {a.precisaHumano && (
        <div style={{ padding: '8px 12px', fontSize: 12.5, color: '#f5b544', background: 'rgba(245,181,68,.08)', borderBottom: '1px solid #2a2a2a' }}>
          🙋 O bot chamou você{a.motivo ? `: ${a.motivo}` : ''}. Ele fica quieto até você devolver a conversa.
        </div>
      )}

      {/* Mensagens */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {msgs === null && <div className="loading">Carregando...</div>}
        {grupos.map(g => (
          <div key={g.d} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ alignSelf: 'center', fontSize: 11, color: 'var(--text-tertiary)', background: 'rgba(255,255,255,.05)', borderRadius: 10, padding: '2px 10px', margin: '6px 0' }}>{dia(g.iso)}</div>
            {g.itens.map(m => <Bolha key={m.id} m={m} />)}
          </div>
        ))}
        <div ref={fimRef} />
      </div>

      {/* Resposta */}
      <div style={{ borderTop: '1px solid #2a2a2a', padding: 10 }}>
        {aberta ? (
          <>
            {resta < 3 * 3600e3 && <div style={{ fontSize: 11.5, color: '#f5b544', marginBottom: 6 }}>A janela da Meta pra responder fecha às {hora(Date.now() + resta)}.</div>}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={2} placeholder={a.botPausado ? 'Escreva sua resposta…' : 'Responder (o bot pausa nessa conversa)…'}
                onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) enviar() }}
                style={{ flex: 1, resize: 'none', padding: '10px 12px', borderRadius: 12, border: '1px solid #333', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14, fontFamily: 'inherit', maxHeight: 140 }} />
              <button onClick={enviar} disabled={enviando || !texto.trim()} style={{ padding: '11px 16px', borderRadius: 12, border: 'none', background: 'var(--teal)', color: '#fff', fontWeight: 800, cursor: 'pointer', opacity: enviando || !texto.trim() ? 0.5 : 1 }}>
                {enviando ? '…' : 'Enviar'}
              </button>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
            Já passou de 24h desde a última mensagem do cliente: a Meta só libera responder quando ele mandar mensagem de novo.
          </div>
        )}
      </div>
    </div>
  )
}

function Bolha({ m }) {
  const cliente = m.role === 'user'
  const bot = m.role === 'assistant'
  return (
    <div style={{ alignSelf: cliente ? 'flex-start' : 'flex-end', maxWidth: '82%' }}>
      <div style={{
        padding: '8px 11px', borderRadius: cliente ? '4px 14px 14px 14px' : '14px 4px 14px 14px', fontSize: 14, lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        background: cliente ? 'var(--bg-input)' : bot ? '#23302b' : 'var(--teal)', color: cliente || bot ? 'var(--text-primary)' : '#fff',
      }}>{m.conteudo}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 2, textAlign: cliente ? 'left' : 'right' }}>
        {bot ? '🤖 bot · ' : m.role === 'humano' ? 'você · ' : ''}{hora(m.created_at)}
      </div>
    </div>
  )
}
