import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useData } from '../hooks/useData'
import {
  getProdutos, getDisponibilidade, getInteressesLista, marcarInteressesAvisados, desmarcarInteressesAvisados,
  apagarInteresse, getContatosAtendimento, acharContato, janelaAberta, enviarWhatsApp,
} from '../services/db'

// ── Interessados ─────────────────────────────────────────────────────────────
// Quem tocou em "Avise-me" no cardápio (ou pediu pra GuaxiMina) esperando um
// doce voltar. O WhatsApp da Guaxí só manda mensagem livre com a conversa aberta
// (cliente falou nas últimas 24h); fora disso, abre o seu WhatsApp com o texto pronto.

const soDig = (s) => String(s || '').replace(/\D/g, '')
const comDDI = (t) => { const d = soDig(t); return d.startsWith('55') && d.length > 11 ? d : `55${d}` }
const waLink = (tel, texto) => `https://wa.me/${comDDI(tel)}?text=${encodeURIComponent(texto)}`
const primeiro = (n) => String(n || '').trim().split(/\s+/)[0]
const telBonito = (t) => { const d = soDig(t).replace(/^55(?=\d{10,11}$)/, ''); return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : t }
function haQuanto(iso) {
  const min = (Date.now() - new Date(iso).getTime()) / 60000
  if (min < 60) return 'agora há pouco'
  if (min < 24 * 60) return `há ${Math.round(min / 60)}h`
  const d = Math.round(min / 1440)
  return d === 1 ? 'ontem' : `há ${d} dias`
}
const diaCurto = (iso) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')

function Aviso({ aviso, fechar }) {
  if (!aviso) return null
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 90, display: 'flex', justifyContent: 'center', zIndex: 300, pointerEvents: 'none', padding: '0 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#222', color: '#fff', borderRadius: 12, padding: '11px 16px', fontSize: 14, boxShadow: '0 6px 20px rgba(0,0,0,.4)', pointerEvents: 'auto', maxWidth: 520 }}>
        <span>{aviso.msg}</span>
        {aviso.href && <a href={aviso.href} target="_blank" rel="noopener noreferrer" onClick={fechar} style={{ color: '#34d39a', fontWeight: 800, whiteSpace: 'nowrap' }}>{aviso.rotulo}</a>}
        {aviso.undo && <button onClick={() => { aviso.undo(); fechar() }} style={{ background: 'none', border: 'none', color: '#34d39a', fontWeight: 800, cursor: 'pointer', fontSize: 14, padding: 0 }}>Desfazer</button>}
      </div>
    </div>
  )
}

export default function Interessados() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { data: produtos } = useData(getProdutos)
  const { data: lista, reload } = useData(getInteressesLista)
  const { data: contatos } = useData(getContatosAtendimento)
  const [disp, setDisp] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [enviando, setEnviando] = useState(null)   // id do interesse / 'todos-<prod>'
  const [fila, setFila] = useState(null)            // { prodId, ids: [...] } — um toque abre o WhatsApp de cada um
  const [verAvisados, setVerAvisados] = useState(false)
  const alvo = Number(new URLSearchParams(location.search).get('produto')) || null
  const rolou = useRef(false)

  useEffect(() => { if (user?.id) getDisponibilidade(user.id).then(setDisp).catch(() => setDisp({})) }, [user?.id])
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), aviso.href ? 9000 : 6000); return () => clearTimeout(t) }, [aviso])

  const prodPor = useMemo(() => Object.fromEntries((produtos || []).map(p => [p.id, p])), [produtos])
  const esperando = useMemo(() => (lista || []).filter(i => !i.avisadoEm), [lista])
  const avisados = useMemo(() => (lista || []).filter(i => i.avisadoEm).sort((a, b) => b.avisadoEm.localeCompare(a.avisadoEm)), [lista])

  // Um bloco por doce: os que já voltaram primeiro (é onde tem ação), depois por quantos esperam
  const grupos = useMemo(() => {
    const m = {}
    for (const i of esperando) (m[i.produtoId] ||= []).push(i)
    return Object.entries(m).map(([id, pessoas]) => {
      const prod = prodPor[id] || { id: Number(id), nome: 'Produto removido' }
      const d = disp?.[id] || { d: 0, c: 0 }
      return { prod, pessoas, prontos: d.d, aCaminho: d.c }
    }).sort((a, b) => ((b.prontos > 0) - (a.prontos > 0)) || (b.pessoas.length - a.pessoas.length))
  }, [esperando, prodPor, disp])
  const voltaram = grupos.filter(g => g.prontos > 0)
  const semEstoque = grupos.filter(g => g.prontos <= 0)

  // Veio de um aviso / da Prontidão: rola até o doce
  useEffect(() => {
    if (!alvo || rolou.current || !grupos.length) return
    const el = document.getElementById(`int-${alvo}`)
    if (el) { rolou.current = true; setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150) }
  }, [alvo, grupos])

  const link = (prod) => `${window.location.origin}/pedido/${user?.id}?produto=${prod.id}`
  const texto = (i, prod) => `Oi${primeiro(i.nome) ? `, ${primeiro(i.nome)}` : ''}! Boa notícia: *${prod.nome}* voltou pro cardápio 💙 Dá pra pedir por aqui: ${link(prod)}`

  async function marcar(ids, msg) {
    await marcarInteressesAvisados(ids).catch(() => {})
    await reload()
    setAviso({ msg, undo: async () => { await desmarcarInteressesAvisados(ids); await reload() } })
  }

  // Um cliente: pela Guaxí se a conversa está aberta; senão abre o seu WhatsApp
  async function avisar(i, prod) {
    const c = acharContato(contatos, i.telefone)
    const t = texto(i, prod)
    if (!janelaAberta(c)) {
      window.open(waLink(i.telefone, t), '_blank')
      await marcar([i.id], `${primeiro(i.nome) || 'Cliente'} marcado como avisado`)
      return
    }
    setEnviando(i.id)
    try {
      await enviarWhatsApp(c.telefone, t, { pausar: false })
      await marcar([i.id], `Enviado pelo WhatsApp da Guaxí pra ${primeiro(i.nome) || 'cliente'}`)
    } catch (e) {
      setAviso({ msg: `Não foi pela Guaxí (${e.message}).`, rotulo: 'Abrir no meu WhatsApp', href: waLink(i.telefone, t) })
    } finally { setEnviando(null) }
  }

  // Todos de um doce: quem tem conversa aberta vai direto pela Guaxí; o resto vira
  // uma fila — cada toque no botão abre o WhatsApp do próximo
  async function avisarTodos(g) {
    const abertos = g.pessoas.filter(i => janelaAberta(acharContato(contatos, i.telefone)))
    const fechados = g.pessoas.filter(i => !abertos.includes(i))
    setEnviando(`todos-${g.prod.id}`)
    const foram = []
    for (const i of abertos) {
      try { await enviarWhatsApp(acharContato(contatos, i.telefone).telefone, texto(i, g.prod), { pausar: false }); foram.push(i.id) }
      catch { fechados.push(i) }
    }
    setEnviando(null)
    if (foram.length) { await marcarInteressesAvisados(foram).catch(() => {}); await reload() }
    if (fechados.length) setFila({ prodId: g.prod.id, ids: fechados.map(i => i.id) })
    setAviso({ msg: foram.length ? `${foram.length} pelo WhatsApp da Guaxí${fechados.length ? ` · faltam ${fechados.length} pelo seu` : ''}` : `Toque pra abrir o WhatsApp de cada um (${fechados.length})` })
  }
  async function proximoDaFila(g) {
    const i = g.pessoas.find(p => p.id === fila.ids[0])
    const resto = fila.ids.slice(1)
    if (i) window.open(waLink(i.telefone, texto(i, g.prod)), '_blank')
    setFila(resto.length ? { ...fila, ids: resto } : null)
    setAviso(resto.length ? null : { msg: `Todos que esperavam ${g.prod.nome} foram avisados ✓` })
    if (i) { await marcarInteressesAvisados([i.id]).catch(() => {}); await reload() }
  }

  async function tirar(i) {
    if (!window.confirm(`Tirar ${i.nome || i.telefone} da lista?`)) return
    await apagarInteresse(i.id).catch(e => setAviso({ msg: e.message }))
    await reload()
  }

  const carregando = lista === null || produtos === null

  function bloco(g) {
    const voltou = g.prontos > 0
    const naFila = fila?.prodId === g.prod.id ? g.pessoas.find(p => p.id === fila.ids[0]) : null
    const img = g.prod.imagemUrl || g.prod.midias?.find(m => m.tipo !== 'video')?.url
    return (
      <section key={g.prod.id} id={`int-${g.prod.id}`} className={`pd-bloco${voltou ? ' int-voltou' : ''}${alvo === g.prod.id ? ' int-alvo' : ''}`} style={{ scrollMarginTop: 70 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {img ? <img src={img} alt="" className="int-thumb" /> : <div className="int-thumb">{g.prod.nome.charAt(0)}</div>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 15.5, lineHeight: 1.25 }}>{g.prod.nome}</div>
            <div style={{ fontSize: 12.5, marginTop: 2, color: voltou ? '#f5b544' : 'var(--text-tertiary)', fontWeight: voltou ? 700 : 500 }}>
              {voltou ? `Voltou · ${g.prontos} pronto${g.prontos > 1 ? 's' : ''} pra vender` : g.aCaminho > 0 ? `Sem estoque · ${g.aCaminho} a caminho` : 'Sem estoque'}
            </div>
          </div>
          <span className="int-num" title="esperando">{g.pessoas.length}</span>
        </div>

        {naFila ? (
          <button className="pd-grande" onClick={() => proximoDaFila(g)}>
            Abrir WhatsApp de {primeiro(naFila.nome) || telBonito(naFila.telefone)} · {fila.ids.length} {fila.ids.length > 1 ? 'faltam' : 'falta'} ›
          </button>
        ) : voltou && g.pessoas.length > 1 ? (
          <button className="pd-grande" disabled={enviando === `todos-${g.prod.id}`} onClick={() => avisarTodos(g)}>
            {enviando === `todos-${g.prod.id}` ? 'Enviando…' : `Avisar os ${g.pessoas.length} que voltou`}
          </button>
        ) : null}

        <div className="int-lista">
          {g.pessoas.map(i => {
            const aberta = janelaAberta(acharContato(contatos, i.telefone))
            return (
              <div key={i.id} className="int-pessoa">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{i.nome || 'Sem nome'}</div>
                  <div className="pd-linha" style={{ marginTop: 2 }}>
                    <span>{telBonito(i.telefone)} · {haQuanto(i.createdAt)}</span>
                  </div>
                  {aberta && <div style={{ fontSize: 11.5, color: '#34d39a', fontWeight: 700, marginTop: 3 }}>● conversa aberta · vai pela Guaxí</div>}
                </div>
                <button className="int-x" aria-label={`Tirar ${i.nome || i.telefone} da lista`} onClick={() => tirar(i)}>×</button>
                <button className={`pd-btn ${voltou ? 'verde' : ''}`} disabled={enviando === i.id} onClick={() => avisar(i, g.prod)}>
                  {enviando === i.id ? 'Enviando…' : 'Avisar'}
                </button>
              </div>
            )
          })}
        </div>
      </section>
    )
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => navigate(-1)} aria-label="Voltar" style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', padding: '0 4px', fontSize: 22, lineHeight: 1 }}>‹</button>
            <div className="topbar-title">Interessados</div>
          </div>
        </div>
      </div>

      <div className="page-inner pd" style={{ paddingTop: 14 }}>
        <section className="pd-resumo" aria-label="Resumo">
          <div className={`pd-tile${voltaram.length ? ' int-tile-ambar' : ''}`}><b>{carregando ? '—' : voltaram.length}</b><span>{voltaram.length === 1 ? 'doce voltou' : 'doces voltaram'}</span></div>
          <div className="pd-tile"><b>{carregando ? '—' : esperando.length}</b><span>{esperando.length === 1 ? 'pessoa esperando' : 'pessoas esperando'}</span></div>
          <div className="pd-tile"><b>{carregando ? '—' : avisados.length}</b><span>avisados em 30 dias</span></div>
        </section>

        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
          Quem toca em <b>Avise-me</b> no cardápio (ou pede pra GuaxiMina) aparece aqui e você recebe um aviso no celular. <b>Avisar</b> manda pelo WhatsApp da Guaxí se a conversa está aberta; se não, abre o seu com o texto pronto.
        </div>

        {carregando ? <div className="pd-vazio">Carregando…</div> : grupos.length === 0 ? (
          <div className="pd-vazio">Ninguém esperando doce voltar agora.</div>
        ) : (
          <>
            {voltaram.length > 0 && (
              <div className="pd-dia">
                <div className="pd-dia-topo"><h2>Voltaram · avise agora</h2></div>
                <div className="int-grade">{voltaram.map(bloco)}</div>
              </div>
            )}
            {semEstoque.length > 0 && (
              <div className="pd-dia">
                <div className="pd-dia-topo"><h2>Ainda sem estoque</h2><span>ajuda a decidir o que produzir</span></div>
                <div className="int-grade">{semEstoque.map(bloco)}</div>
              </div>
            )}
          </>
        )}

        {avisados.length > 0 && (
          <div className="pd-dia">
            <button className="pd-link" style={{ alignSelf: 'flex-start', fontSize: 13.5 }} onClick={() => setVerAvisados(v => !v)}>
              {verAvisados ? 'Esconder' : 'Ver'} {avisados.length === 1 ? 'o 1 já avisado' : `os ${avisados.length} já avisados`}
            </button>
            {verAvisados && (
              <div className="pd-bloco int-lista" style={{ gap: 0 }}>
                {avisados.map(i => (
                  <div key={i.id} className="int-pessoa">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{i.nome || telBonito(i.telefone)}</div>
                      <div className="pd-linha"><span>{prodPor[i.produtoId]?.nome || 'Produto'} · avisado {diaCurto(i.avisadoEm)}</span></div>
                    </div>
                    <button className="pd-btn vazado" onClick={async () => { await desmarcarInteressesAvisados([i.id]); await reload() }}>Voltar pra lista</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <Aviso aviso={aviso} fechar={() => setAviso(null)} />
    </>
  )
}
