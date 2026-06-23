import { useState } from 'react'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { useAuth } from '../contexts/AuthContext'
import {
  getPedidosParaAgrupar, getEnvios, gerarEnvios, desfazerEnvio,
  despacharEnvio, atualizarStatusEnvio, atualizarEnvio, cancelarEnvio, cotarEnvio,
} from '../services/db'

const fmtR = (n) => `R$ ${Number(n || 0).toFixed(2).replace('.', ',')}`
const VEIC_LABEL = { LALAGO: '🛵 Moto (LALAGO)', HATCHBACK: '🚗 Hatchback', CAR: '🚗 Carro (CAR)', VAN: '🚐 Van' }
const VEIC_OPTS = ['LALAGO', 'HATCHBACK', 'CAR', 'VAN']

const STATUS_LABEL = {
  FILA: 'Na fila', ASSIGNING_DRIVER: 'Buscando motorista', ON_GOING: 'A caminho da coleta',
  PICKED_UP: 'Coletado · em entrega', COMPLETED: 'Entregue', CANCELED: 'Cancelado',
  EXPIRED: 'Expirado', REJECTED: 'Rejeitado',
}
const EM_ROTA = ['ASSIGNING_DRIVER', 'ON_GOING', 'PICKED_UP']

function diaLabel(s) {
  if (!s) return '—'
  const d = new Date(s + 'T12:00:00')
  const dd = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  return `${dd[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}
const nItens = (peds) => peds.reduce((s, p) => s + p.itens.reduce((a, i) => a + (Number(i.quantidade) || 0), 0), 0)
const vTotal = (peds) => peds.reduce((s, p) => s + (Number(p.valor) || 0), 0)
const fTotal = (peds) => peds.reduce((s, p) => s + (Number(p.frete) || 0), 0)

const card = { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, padding: 12, marginBottom: 12 }
const btn = (bg, fg = '#000') => ({ background: bg, color: fg, border: 'none', borderRadius: 8, padding: '8px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' })
const col = { flex: '1 1 280px', minWidth: 280, background: '#141414', borderRadius: 14, padding: 12 }
const colTitle = { fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: '#888', marginBottom: 10, padding: '0 2px' }

function PedidoMini({ p }) {
  return (
    <div style={{ borderTop: '1px solid #242424', padding: '7px 0', fontSize: 12.5 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 600, color: '#e8e8e8' }}>{p.cliente} {p.frag === 'fragil' && '🍰'}</span>
        <span style={{ color: '#22b886', fontWeight: 700 }}>{fmtR(p.frete)}</span>
      </div>
      <div style={{ color: '#777', marginTop: 2 }}>{p.itens.map(i => `${i.quantidade}× ${i.produto}`).join(', ')}</div>
      {p.endereco && <div style={{ color: '#666', fontSize: 11, marginTop: 2 }}>{p.endereco}</div>}
      {p.obs && <div style={{ color: '#a98', fontSize: 11, marginTop: 2 }}>obs: {p.obs}</div>}
    </div>
  )
}

// Cabeçalho compacto clicável + resumo. Children = detalhe (mostrado se aberto).
function Chip({ children, color, bg }) {
  return <span style={{ fontSize: 11, fontWeight: 700, color: color || '#bbb', background: bg || '#242424', padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>{children}</span>
}

function CardBase({ titulo, tag, peds, aberto, onToggle, children, footer }) {
  const [hov, setHov] = useState(false)
  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden', borderColor: aberto ? '#3a3a3a' : (hov ? '#383838' : '#2a2a2a'), boxShadow: hov ? '0 2px 10px rgba(0,0,0,.35)' : 'none', transition: 'border-color .12s, box-shadow .12s' }}>
      <div onClick={onToggle} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
        style={{ cursor: 'pointer', padding: '11px 12px 10px', background: hov ? '#1f1f1f' : 'transparent', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <strong style={{ fontSize: 15 }}>{titulo}</strong>
            {tag}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
            <Chip>📦 {peds.length} ped</Chip>
            <Chip>🧁 {nItens(peds)} itens</Chip>
            <Chip color="#e8e8e8" bg="#2e2e2e">{fmtR(vTotal(peds))}</Chip>
            <Chip color="#22b886" bg="rgba(34,184,134,.13)">frete {fmtR(fTotal(peds))}</Chip>
          </div>
        </div>
        <div style={{ flexShrink: 0, width: 26, height: 26, borderRadius: '50%', background: aberto ? '#22b886' : '#262626', border: `1px solid ${aberto ? '#22b886' : '#3a3a3a'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: aberto ? '#000' : '#9a9a9a' }}>
          {aberto ? '▲' : '▼'}
        </div>
      </div>
      {(aberto || footer) && (
        <div style={{ padding: '0 12px 12px' }}>
          {aberto && peds.map(p => <PedidoMini key={p.id} p={p} />)}
          {aberto && children}
          {footer}
        </div>
      )}
    </div>
  )
}

export default function Envios() {
  const { user } = useAuth()
  const { show } = useToast()
  const { data: pendentes, loading: l1, reload: rP } = useData(getPedidosParaAgrupar)
  const { data: envios, loading: l2, reload: rE } = useData(getEnvios)
  const [busy, setBusy] = useState(null)
  const [mapaAberto, setMapaAberto] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())
  const [disp, setDisp] = useState(null)   // modal de despacho

  const reload = () => { rP(); rE() }
  const toggle = (k) => setExpanded(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const open = (k) => expanded.has(k)

  const run = async (key, fn, okMsg) => {
    setBusy(key)
    try { const r = await fn(); if (okMsg) show(typeof okMsg === 'function' ? okMsg(r) : okMsg); reload() }
    catch (e) { show('Erro: ' + e.message) }
    finally { setBusy(null) }
  }

  const porDia = {}
  for (const p of (pendentes || [])) (porDia[p.dataEntrega] ||= []).push(p)
  const fila   = (envios || []).filter(e => e.status === 'FILA')
  const emRota = (envios || []).filter(e => EM_ROTA.includes(e.status))
  // Finalizados: entregues, ou envios que falharam mas ainda têm pedidos pra reabrir.
  // Esconde "husks" vazios (cancelados/expirados sem pedidos — já voltaram à coluna 1).
  const finais = (envios || []).filter(e =>
    e.status !== 'FILA' && !EM_ROTA.includes(e.status) &&
    !(e.pedidos.length === 0 && e.status !== 'COMPLETED'))
  const mapEnvio = (envios || []).find(e => e.id === mapaAberto && e.shareLink)

  const whatsLink = (p, e) => {
    const fone = (p.contato || '').replace(/\D/g, '')
    const num = fone.startsWith('55') ? fone : `55${fone}`
    const msg = `Oi ${p.cliente}! Seu pedido sai para entrega ${diaLabel(e.dataEntrega)}. Frete: ${fmtR(p.frete)}.` +
      (e.shareLink ? ` Acompanhe a entrega: ${e.shareLink}` : '')
    return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`
  }

  // ── Modal de despacho (cotação por categoria) ──
  const abrirDespacho = async (e) => {
    setDisp({ envio: e, quotes: null, loading: true, sel: e.veiculo })
    try {
      const j = await cotarEnvio(user.id, e.id)
      setDisp(d => (d && d.envio.id === e.id) ? { ...d, quotes: j.quotes, loading: false, sandbox: j.sandbox } : d)
    } catch (err) { show('Erro ao cotar: ' + err.message); setDisp(null) }
  }
  const confirmarDespacho = async () => {
    const { envio, sel } = disp
    setDisp(d => ({ ...d, confirming: true }))
    try {
      if (sel !== envio.veiculo) await atualizarEnvio(envio.id, { veiculo: sel })
      const r = await despacharEnvio(user.id, envio.id)
      show(`Despachado! ${r.sandbox ? '(sandbox) ' : ''}custo ${fmtR(r.custo)}`)
      setDisp(null); reload()
    } catch (err) { show('Erro: ' + err.message); setDisp(d => d ? { ...d, confirming: false } : d) }
  }
  const selQuote = disp?.quotes?.find(q => q.veiculo === disp.sel)
  const minTotal = disp?.quotes ? Math.min(...disp.quotes.filter(q => q.total != null).map(q => q.total)) : null

  return (
    <div style={{ padding: '16px 14px 24px', color: '#e8e8e8', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Envios</h1>
        <button onClick={() => run('gerar', gerarEnvios, (ids) => ids.length ? `${ids.length} envio(s) criado(s)` : 'Nada para agrupar')}
          disabled={busy === 'gerar' || !(pendentes || []).length}
          style={{ ...btn('#22b886'), opacity: (pendentes || []).length ? 1 : 0.5 }}>
          {busy === 'gerar' ? 'Agrupando…' : '⚡ Gerar envios do dia'}
        </button>
      </div>
      {(l1 || l2) && <div style={{ color: '#666' }}>Carregando…</div>}

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', maxHeight: mapEnvio ? '42vh' : 'none', overflowY: mapEnvio ? 'auto' : 'visible', overflowX: 'auto' }}>

        {/* A ORGANIZAR */}
        <div style={col}>
          <div style={colTitle}>A organizar · {(pendentes || []).length}</div>
          {Object.keys(porDia).length === 0 && <div style={{ color: '#555', fontSize: 13 }}>Sem pedidos soltos.</div>}
          {Object.entries(porDia).map(([dia, peds]) => (
            <CardBase key={dia} titulo={diaLabel(dia)} peds={peds} aberto={open('d:' + dia)} onToggle={() => toggle('d:' + dia)} />
          ))}
        </div>

        {/* NA FILA */}
        <div style={col}>
          <div style={colTitle}>Na fila · {fila.length}</div>
          {fila.length === 0 && <div style={{ color: '#555', fontSize: 13 }}>Vazio.</div>}
          {fila.map(e => (
            <CardBase key={e.id} titulo={diaLabel(e.dataEntrega)} peds={e.pedidos} aberto={open('e:' + e.id)} onToggle={() => toggle('e:' + e.id)}
              tag={<span style={{ fontSize: 11, color: '#888' }}>{VEIC_LABEL[e.veiculo] || e.veiculo}</span>}
              footer={
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button onClick={() => abrirDespacho(e)} style={btn('#22b886')}>🚀 Despachar</button>
                  <button onClick={() => run('x' + e.id, () => desfazerEnvio(e.id), 'Desfeito')} disabled={busy === 'x' + e.id} style={btn('#2a2a2a', '#ccc')}>Desfazer</button>
                </div>
              } />
          ))}
        </div>

        {/* EM ROTA */}
        <div style={col}>
          <div style={colTitle}>Em rota · {emRota.length}</div>
          {emRota.length === 0 && <div style={{ color: '#555', fontSize: 13 }}>Vazio.</div>}
          {emRota.map(e => (
            <CardBase key={e.id} titulo={diaLabel(e.dataEntrega)} peds={e.pedidos} aberto={open('e:' + e.id)} onToggle={() => toggle('e:' + e.id)}
              tag={<span style={{ fontSize: 11, color: '#f0b429', fontWeight: 700 }}>{STATUS_LABEL[e.status] || e.status}</span>}
              footer={
                <>
                  {e.driverNome && <div style={{ fontSize: 12, color: '#aaa', marginTop: 6 }}>🧑‍✈️ {e.driverNome} · {e.driverPlate} · {e.driverPhone}</div>}
                  {open('e:' + e.id) && e.pedidos.map(p => (
                    <a key={p.id} href={whatsLink(p, e)} target="_blank" rel="noreferrer" style={{ ...btn('#1f6b50', '#9ff0cf'), display: 'inline-block', textDecoration: 'none', fontSize: 11, padding: '4px 9px', marginTop: 4, marginRight: 4 }}>📲 {p.cliente.split(' ')[0]}</a>
                  ))}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <button onClick={() => run('s' + e.id, () => atualizarStatusEnvio(user.id, e.id), (r) => `Status: ${STATUS_LABEL[r.status] || r.status}`)} disabled={busy === 's' + e.id} style={btn('#2a2a2a', '#ccc')}>{busy === 's' + e.id ? '…' : '🔄 Atualizar'}</button>
                    {e.shareLink && <button onClick={() => setMapaAberto(mapaAberto === e.id ? null : e.id)} style={btn(mapaAberto === e.id ? '#22b886' : '#2a2a2a', mapaAberto === e.id ? '#000' : '#ccc')}>🗺️ {mapaAberto === e.id ? 'Fechar' : 'Mapa'}</button>}
                    <button onClick={() => { if (confirm('Cancelar este envio? Os pedidos voltam para "A organizar".')) run('c' + e.id, () => cancelarEnvio(user.id, e.id), (r) => `Cancelado (${r.lalamoveCancel})`) }} disabled={busy === 'c' + e.id} style={btn('#3a1f1f', '#f87171')}>{busy === 'c' + e.id ? '…' : '✕ Cancelar'}</button>
                  </div>
                </>
              } />
          ))}
        </div>

        {/* FINALIZADOS */}
        <div style={col}>
          <div style={colTitle}>Finalizados · {finais.length}</div>
          {finais.length === 0 && <div style={{ color: '#555', fontSize: 13 }}>Vazio.</div>}
          {finais.map(e => (
            <CardBase key={e.id} titulo={diaLabel(e.dataEntrega)} peds={e.pedidos} aberto={open('e:' + e.id)} onToggle={() => toggle('e:' + e.id)}
              tag={<span style={{ fontSize: 11, color: e.status === 'COMPLETED' ? '#22b886' : '#f87171', fontWeight: 700 }}>{STATUS_LABEL[e.status] || e.status}</span>}
              footer={e.pedidos.length > 0 && e.status !== 'COMPLETED' && (
                <button onClick={() => run('r' + e.id, () => desfazerEnvio(e.id), 'Pedidos devolvidos para A organizar')} disabled={busy === 'r' + e.id} style={{ ...btn('#2a2a2a', '#ccc'), marginTop: 8 }}>{busy === 'r' + e.id ? '…' : '↩︎ Reabrir pedidos'}</button>
              )} />
          ))}
        </div>
      </div>

      {/* MAPA grande abaixo */}
      {mapEnvio && (
        <div style={{ marginTop: 14, background: '#141414', borderRadius: 14, padding: 12, height: '50vh', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong style={{ fontSize: 14 }}>🗺️ Rastreio · {diaLabel(mapEnvio.dataEntrega)} · {STATUS_LABEL[mapEnvio.status] || mapEnvio.status}</strong>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <a href={mapEnvio.shareLink} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#22b886' }}>abrir em nova aba ↗</a>
              <button onClick={() => setMapaAberto(null)} style={btn('#2a2a2a', '#ccc')}>Fechar</button>
            </div>
          </div>
          <iframe src={mapEnvio.shareLink} title={`tracking-${mapEnvio.id}`} style={{ flex: 1, width: '100%', border: '1px solid #2a2a2a', borderRadius: 10 }} />
        </div>
      )}

      {/* MODAL de despacho com cotação por categoria */}
      {disp && (
        <div onClick={() => !disp.confirming && setDisp(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
          <div onClick={ev => ev.stopPropagation()} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 16, padding: 18, width: 420, maxWidth: '100%' }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 2 }}>Despachar · {diaLabel(disp.envio.dataEntrega)}</div>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 14 }}>{disp.envio.pedidos.length} parada(s){disp.sandbox ? ' · sandbox' : ''}</div>

            {disp.loading && <div style={{ color: '#888', padding: '20px 0', textAlign: 'center' }}>Cotando categorias…</div>}

            {disp.quotes && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {disp.quotes.map(q => {
                  const ok = q.total != null
                  const sel = disp.sel === q.veiculo
                  const cheapest = ok && q.total === minTotal
                  return (
                    <div key={q.veiculo} onClick={() => ok && setDisp(d => ({ ...d, sel: q.veiculo }))}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 13px', borderRadius: 10, cursor: ok ? 'pointer' : 'not-allowed', opacity: ok ? 1 : 0.45, background: sel ? 'rgba(34,184,134,.12)' : '#222', border: `1.5px solid ${sel ? '#22b886' : '#2f2f2f'}` }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{VEIC_LABEL[q.veiculo] || q.veiculo}{cheapest && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 800, color: '#000', background: '#22b886', padding: '1px 6px', borderRadius: 6 }}>+ barato</span>}</span>
                      <span style={{ fontWeight: 700, color: ok ? (sel ? '#22b886' : '#e8e8e8') : '#f87171' }}>{ok ? fmtR(q.total) : (q.erro || 'indisponível')}</span>
                    </div>
                  )
                })}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={() => setDisp(null)} disabled={disp.confirming} style={{ ...btn('#2a2a2a', '#ccc'), flex: 1 }}>Cancelar</button>
              <button onClick={confirmarDespacho} disabled={disp.loading || disp.confirming || !selQuote?.total} style={{ ...btn('#22b886'), flex: 2, opacity: (disp.loading || disp.confirming || !selQuote?.total) ? 0.5 : 1 }}>
                {disp.confirming ? 'Despachando…' : `Confirmar ${selQuote?.total != null ? fmtR(selQuote.total) : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
