import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { useAuth } from '../contexts/AuthContext'
import {
  getPedidosParaAgrupar, getEnvios, gerarEnvios, desfazerEnvio,
  despacharEnvio, atualizarStatusEnvio, atualizarEnvio, cancelarEnvio, cotarEnvio,
  getContatosAtendimento, acharContato, janelaAberta, enviarWhatsApp,
} from '../services/db'

const fmtR = (n) => `R$ ${Number(n || 0).toFixed(2).replace('.', ',')}`
const VEIC = { LALAGO: { icon: '🛵', nome: 'Moto' }, HATCHBACK: { icon: '🚗', nome: 'Hatch' }, CAR: { icon: '🚗', nome: 'Carro' }, VAN: { icon: '🚐', nome: 'Van' } }
const VEIC_LABEL = { LALAGO: '🛵 Moto (LALAGO)', HATCHBACK: '🚗 Hatchback', CAR: '🚗 Carro (CAR)', VAN: '🚐 Van' }

const STATUS = {
  ORGANIZAR:        { nome: 'A organizar',          cor: '#9ca3af' },
  FILA:             { nome: 'Na fila',              cor: '#9ca3af' },
  ASSIGNING_DRIVER: { nome: 'Buscando motorista',   cor: '#f5b544', pulsa: true },
  ON_GOING:         { nome: 'Motorista indo buscar', cor: '#60a5fa', pulsa: true },
  PICKED_UP:        { nome: 'Saiu pra entrega',     cor: '#2dd4bf', pulsa: true },
  COMPLETED:        { nome: 'Entregue',             cor: '#4ade80' },
  CANCELED:         { nome: 'Cancelado',            cor: '#f87171' },
  EXPIRED:          { nome: 'Expirado',             cor: '#f87171' },
  REJECTED:         { nome: 'Rejeitado',            cor: '#f87171' },
}
const EM_ROTA = ['ASSIGNING_DRIVER', 'ON_GOING', 'PICKED_UP']
const CANAL = { FormExterno: '🌐 cardápio', WhatsApp: '💬 WhatsApp', iFood: 'iFood', '99Food': '99Food', Presencial: 'balcão' }

const PERIODO_NOME = { manha: 'manhã · 9–12h', tarde: 'tarde · 12–18h', noite: 'noite · 18–22h' }
function diaLabel(s) {
  if (!s) return '—'
  const d = new Date(s + 'T12:00:00')
  const dd = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  return `${dd[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}
const nItens = (peds) => peds.reduce((s, p) => s + p.itens.reduce((a, i) => a + (Number(i.quantidade) || 0), 0), 0)
const vTotal = (peds) => peds.reduce((s, p) => s + (Number(p.valor) || 0), 0)
const fTotal = (peds) => peds.reduce((s, p) => s + (Number(p.frete) || 0), 0)

const btn = (bg, fg = '#000') => ({ background: bg, color: fg, border: 'none', borderRadius: 9, padding: '9px 13px', fontSize: 13, fontWeight: 700, cursor: 'pointer' })
const miniBtn = { background: '#242424', color: '#cfcfcf', border: '1px solid #303030', borderRadius: 8, padding: '5px 9px', fontSize: 12, fontWeight: 600, cursor: 'pointer', textDecoration: 'none', whiteSpace: 'nowrap' }
const col = { minWidth: 0, background: '#141414', borderRadius: 14, padding: 12 }
const colTitle = { fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: '#888', marginBottom: 10, padding: '0 2px' }

function StatusPill({ status }) {
  const s = STATUS[status] || { nome: status, cor: '#9ca3af' }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, color: s.cor, background: `${s.cor}1a`, border: `1px solid ${s.cor}40`, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap' }}>
      <span className={s.pulsa ? 'env-pulsa' : ''} style={{ width: 7, height: 7, borderRadius: 4, background: s.cor }} />
      {s.nome}
    </span>
  )
}

// Uma parada (pedido) do envio
function Parada({ n, p, envio, contato, detalhe, onConversa, onPedido, onAvisar, avisando }) {
  const primeiro = p.cliente.split(' ')[0]
  const itens = p.itens.map(i => `${i.quantidade}× ${i.produto}`).join(', ')
  return (
    <div style={{ display: 'flex', gap: 10, padding: '9px 0', borderTop: '1px solid #242424' }}>
      <div style={{ width: 22, height: 22, borderRadius: 11, flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 11.5, fontWeight: 800, background: '#262626', color: '#bbb', marginTop: 1 }}>{n}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span onClick={onPedido} style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 13.5, color: '#ececec', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.cliente}{p.frag === 'fragil' && <span title="frágil" style={{ fontSize: 12, marginLeft: 5 }}>🍰</span>}
          </span>
          <span style={{ fontSize: 12, color: '#22b886', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtR(p.frete)}</span>
        </div>
        <div style={{ fontSize: 12, color: '#8d8d8d', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: detalhe ? 'normal' : 'nowrap' }}>
          {CANAL[p.canal] && <span style={{ fontSize: 10.5, color: '#9a9a9a', background: '#242424', borderRadius: 6, padding: '1px 6px', marginRight: 6 }}>{CANAL[p.canal]}</span>}
          {itens}
        </div>
        {detalhe && p.endereco && <div style={{ fontSize: 11.5, color: '#6f6f6f', marginTop: 3 }}>📍 {p.endereco}</div>}
        {detalhe && p.obs && <div style={{ fontSize: 11.5, color: '#b59b80', marginTop: 3 }}>📝 {p.obs}</div>}
        {detalhe && (
          <div style={{ display: 'flex', gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
            <button onClick={onPedido} style={miniBtn}>📄 Pedido {p.id}</button>
            {contato && <button onClick={onConversa} style={miniBtn}>💬 Conversa</button>}
            {envio && <button onClick={onAvisar} disabled={avisando} style={miniBtn}>{avisando ? '…' : `📲 Avisar ${primeiro}`}</button>}
          </div>
        )}
      </div>
    </div>
  )
}

function EnvioCard({ periodo, dia, status, veiculo, peds, envio, contatos, aberto, onToggle, acoes, onConversa, onPedido, onAvisar, avisando }) {
  const v = VEIC[veiculo]
  const custo = Number(envio?.precoTotal) || 0
  const frete = fTotal(peds)
  const sobra = frete - custo
  return (
    <div style={{ background: '#1a1a1a', border: `1px solid ${aberto ? '#3a3a3a' : '#2a2a2a'}`, borderRadius: 14, marginBottom: 12, overflow: 'hidden' }}>
      <div onClick={onToggle} style={{ padding: '12px 13px 10px', cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong style={{ fontSize: 16, flex: 1 }}>{diaLabel(dia)}{periodo !== undefined && <span style={{ fontWeight: 600, fontSize: 13, color: periodo ? '#b8b8b8' : '#f5b544' }}> · {PERIODO_NOME[periodo] || 'período a combinar'}</span>}</strong>
          <StatusPill status={status} />
        </div>
        <div style={{ fontSize: 12, color: '#8a8a8a', marginTop: 4 }}>
          {v ? `${v.icon} ${v.nome} · ` : ''}{peds.length} parada{peds.length === 1 ? '' : 's'} · {nItens(peds)} itens · {fmtR(vTotal(peds))}
        </div>
      </div>

      <div style={{ padding: '0 13px' }}>
        {peds.map((p, i) => (
          <Parada key={p.id} n={i + 1} p={p} envio={envio} contato={acharContato(contatos, p.contato)} detalhe={aberto}
            onConversa={() => onConversa(p)} onPedido={() => onPedido(p)} onAvisar={() => onAvisar(p, envio)} avisando={avisando === p.id} />
        ))}
      </div>

      {envio?.driverNome && (
        <div style={{ margin: '4px 13px 0', padding: '8px 10px', background: '#202020', borderRadius: 10, fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>🧑‍✈️</span>
          <span style={{ flex: 1, minWidth: 0 }}><b>{envio.driverNome}</b>{envio.driverPlate ? ` · ${envio.driverPlate}` : ''}</span>
          {envio.driverPhone && <a href={`tel:${envio.driverPhone}`} style={{ ...miniBtn, padding: '4px 8px' }}>📞</a>}
        </div>
      )}

      <div style={{ margin: '10px 13px 0', paddingTop: 9, borderTop: '1px solid #242424', display: 'flex', gap: 14, fontSize: 12, color: '#8a8a8a', flexWrap: 'wrap' }}>
        <span>Frete cobrado <b style={{ color: '#22b886' }}>{fmtR(frete)}</b></span>
        {custo > 0 && <span>Lalamove <b style={{ color: '#e8e8e8' }}>{fmtR(custo)}</b></span>}
        {custo > 0 && <span>{sobra >= 0 ? 'sobra' : 'falta'} <b style={{ color: sobra >= 0 ? '#4ade80' : '#f87171' }}>{fmtR(Math.abs(sobra))}</b></span>}
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '10px 13px 13px', flexWrap: 'wrap', alignItems: 'center' }}>
        {acoes}
        <button onClick={onToggle} style={{ ...miniBtn, marginLeft: 'auto', background: 'transparent' }}>{aberto ? 'menos ▲' : 'detalhes ▼'}</button>
      </div>
    </div>
  )
}

export default function Envios() {
  const { user } = useAuth()
  const { show } = useToast()
  const navigate = useNavigate()
  const { data: pendentes, loading: l1, reload: rP } = useData(getPedidosParaAgrupar)
  const { data: envios, loading: l2, reload: rE } = useData(getEnvios)
  const { data: contatos, reload: rC } = useData(getContatosAtendimento)
  const [busy, setBusy] = useState(null)
  const [mapaAberto, setMapaAberto] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())
  const [disp, setDisp] = useState(null)   // modal de despacho
  const [avisando, setAvisando] = useState(null)

  const reload = () => { rP(); rE(); rC() }
  const toggle = (k) => setExpanded(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const open = (k) => expanded.has(k)

  const run = async (key, fn, okMsg) => {
    setBusy(key)
    try { const r = await fn(); if (okMsg) show(typeof okMsg === 'function' ? okMsg(r) : okMsg); reload() }
    catch (e) { show('Erro: ' + e.message) }
    finally { setBusy(null) }
  }

  const porDia = {}
  for (const p of (pendentes || [])) (porDia[`${p.dataEntrega}|${p.periodo || ''}`] ||= []).push(p)
  const fila   = (envios || []).filter(e => e.status === 'FILA')
  const emRota = (envios || []).filter(e => EM_ROTA.includes(e.status))
  // Finalizados: entregues, ou envios que falharam mas ainda têm pedidos pra reabrir.
  // Esconde "husks" vazios (cancelados/expirados sem pedidos — já voltaram à coluna 1).
  const finais = (envios || []).filter(e =>
    e.status !== 'FILA' && !EM_ROTA.includes(e.status) &&
    !(e.pedidos.length === 0 && e.status !== 'COMPLETED'))
  const mapEnvio = (envios || []).find(e => e.id === mapaAberto && e.shareLink)

  const irConversa = (p) => { const c = acharContato(contatos, p.contato); if (c) navigate(`/atendimento?c=${c.telefone}`) }
  const irPedido = (p) => navigate('/pedidos', { state: { openPedidoId: p.id } })

  // Avisa o cliente da entrega: pelo WhatsApp da Guaxí quando dá (janela de 24h),
  // senão abre o seu WhatsApp com a mensagem pronta.
  const avisar = async (p, e) => {
    const primeiro = p.cliente.split(' ')[0]
    const msg = EM_ROTA.includes(e.status) && e.shareLink
      ? `Oi ${primeiro}! Seu pedido da Guaxí saiu pra entrega 🛵 Dá pra acompanhar por aqui: ${e.shareLink}`
      : `Oi ${primeiro}! Seu pedido da Guaxí sai pra entrega ${diaLabel(e.dataEntrega)} 💛`
    const c = acharContato(contatos, p.contato)
    if (janelaAberta(c)) {
      if (!confirm(`Mandar pelo WhatsApp da Guaxí pra ${p.cliente}?\n\n${msg}`)) return
      setAvisando(p.id)
      try { await enviarWhatsApp(c.telefone, msg, { pausar: false }); show(`Enviado pra ${primeiro}`) }
      catch (err) { show('Erro: ' + err.message) }
      finally { setAvisando(null) }
      return
    }
    const fone = (p.contato || '').replace(/\D/g, '')
    if (!fone) { show('Pedido sem telefone'); return }
    window.open(`https://wa.me/${fone.startsWith('55') ? fone : `55${fone}`}?text=${encodeURIComponent(msg)}`, '_blank')
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
      show(r.sandbox ? `Despacho de teste feito (custo simulado ${fmtR(r.custo)})` : `Motorista chamado! Custo ${fmtR(r.custo)}`)
      setDisp(null); reload()
    } catch (err) { show('Erro: ' + err.message); setDisp(d => d ? { ...d, confirming: false } : d) }
  }
  const selQuote = disp?.quotes?.find(q => q.veiculo === disp.sel)
  const minTotal = disp?.quotes ? Math.min(...disp.quotes.filter(q => q.total != null).map(q => q.total)) : null

  const comum = { contatos, onConversa: irConversa, onPedido: irPedido, onAvisar: avisar, avisando }

  return (
    <div style={{ padding: '16px 14px 24px', color: '#e8e8e8', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 10 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Envios</h1>
        <button onClick={() => run('gerar', gerarEnvios, (ids) => ids.length ? `${ids.length} envio(s) criado(s)` : 'Nada para agrupar')}
          disabled={busy === 'gerar' || !(pendentes || []).length}
          style={{ ...btn('#22b886'), opacity: (pendentes || []).length ? 1 : 0.5 }}>
          {busy === 'gerar' ? 'Agrupando…' : '⚡ Gerar envios'}
        </button>
      </div>
      {(l1 || l2) && <div style={{ color: '#666' }}>Carregando…</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12, alignItems: 'start' }}>

        {/* A ORGANIZAR */}
        <div style={col}>
          <div style={colTitle}>A organizar · {(pendentes || []).length}</div>
          {Object.keys(porDia).length === 0 && <div style={{ color: '#555', fontSize: 13 }}>Sem pedidos soltos.</div>}
          {Object.entries(porDia).sort(([a], [b]) => a.localeCompare(b)).map(([chave, peds]) => {
            const [dia, periodo] = chave.split('|')
            return <EnvioCard key={chave} dia={dia} periodo={periodo || null} status="ORGANIZAR" peds={peds} aberto={open('d:' + chave)} onToggle={() => toggle('d:' + chave)} {...comum} />
          })}
        </div>

        {/* NA FILA */}
        <div style={col}>
          <div style={colTitle}>Na fila · {fila.length}</div>
          {fila.length === 0 && <div style={{ color: '#555', fontSize: 13 }}>Vazio.</div>}
          {fila.map(e => (
            <EnvioCard key={e.id} dia={e.dataEntrega} periodo={e.periodo} status={e.status} veiculo={e.veiculo} peds={e.pedidos} envio={e}
              aberto={open('e:' + e.id)} onToggle={() => toggle('e:' + e.id)} {...comum}
              acoes={<>
                <button onClick={() => abrirDespacho(e)} style={btn('#22b886')}>🚀 Despachar</button>
                <button onClick={() => run('x' + e.id, () => desfazerEnvio(e.id), 'Desfeito')} disabled={busy === 'x' + e.id} style={btn('#262626', '#ccc')}>Desfazer</button>
              </>} />
          ))}
        </div>

        {/* EM ROTA */}
        <div style={col}>
          <div style={colTitle}>Em rota · {emRota.length}</div>
          {emRota.length === 0 && <div style={{ color: '#555', fontSize: 13 }}>Vazio.</div>}
          {emRota.map(e => (
            <EnvioCard key={e.id} dia={e.dataEntrega} periodo={e.periodo} status={e.status} veiculo={e.veiculo} peds={e.pedidos} envio={e}
              aberto={open('e:' + e.id)} onToggle={() => toggle('e:' + e.id)} {...comum}
              acoes={<>
                {e.shareLink && <button onClick={() => setMapaAberto(mapaAberto === e.id ? null : e.id)} style={btn(mapaAberto === e.id ? '#22b886' : '#1f3b33', mapaAberto === e.id ? '#000' : '#9ff0cf')}>🗺️ {mapaAberto === e.id ? 'Fechar mapa' : 'Mapa'}</button>}
                <button onClick={() => run('s' + e.id, () => atualizarStatusEnvio(user.id, e.id), (r) => `Status: ${STATUS[r.status]?.nome || r.status}`)} disabled={busy === 's' + e.id} style={btn('#262626', '#ccc')}>{busy === 's' + e.id ? '…' : '🔄 Atualizar'}</button>
                <button onClick={() => { if (confirm('Cancelar este envio? Os pedidos voltam para "A organizar".')) run('c' + e.id, () => cancelarEnvio(user.id, e.id), (r) => `Cancelado (${r.lalamoveCancel})`) }} disabled={busy === 'c' + e.id} style={btn('transparent', '#f87171')}>{busy === 'c' + e.id ? '…' : 'Cancelar'}</button>
              </>} />
          ))}
        </div>

        {/* FINALIZADOS */}
        <div style={col}>
          <div style={colTitle}>Finalizados · {finais.length}</div>
          {finais.length === 0 && <div style={{ color: '#555', fontSize: 13 }}>Vazio.</div>}
          {finais.map(e => (
            <EnvioCard key={e.id} dia={e.dataEntrega} periodo={e.periodo} status={e.status} veiculo={e.veiculo} peds={e.pedidos} envio={e}
              aberto={open('e:' + e.id)} onToggle={() => toggle('e:' + e.id)} {...comum}
              acoes={e.pedidos.length > 0 && e.status !== 'COMPLETED' && (
                <button onClick={() => run('r' + e.id, () => desfazerEnvio(e.id), 'Pedidos devolvidos para A organizar')} disabled={busy === 'r' + e.id} style={btn('#262626', '#ccc')}>{busy === 'r' + e.id ? '…' : '↩︎ Reabrir pedidos'}</button>
              )} />
          ))}
        </div>
      </div>

      {/* MAPA de rastreio */}
      {mapEnvio && (
        <div style={{ marginTop: 14, background: '#141414', border: '1px solid #262626', borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', flexWrap: 'wrap', borderBottom: '1px solid #262626' }}>
            <span style={{ fontSize: 18 }}>🗺️</span>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontWeight: 800, fontSize: 14.5 }}>Rastreio · {diaLabel(mapEnvio.dataEntrega)}{mapEnvio.periodo ? ` · ${PERIODO_NOME[mapEnvio.periodo]}` : ''}</div>
              <div style={{ fontSize: 12, color: '#8a8a8a', marginTop: 2 }}>
                {mapEnvio.pedidos.map(p => p.cliente.split(' ')[0]).join(', ')}{mapEnvio.driverNome ? ` · 🧑‍✈️ ${mapEnvio.driverNome}` : ''}
              </div>
            </div>
            <StatusPill status={mapEnvio.status} />
            <a href={mapEnvio.shareLink} target="_blank" rel="noreferrer" style={{ ...miniBtn, color: '#22b886' }}>Abrir ↗</a>
            <button onClick={() => setMapaAberto(null)} style={miniBtn}>✕</button>
          </div>
          <iframe src={mapEnvio.shareLink} title={`tracking-${mapEnvio.id}`} style={{ display: 'block', width: '100%', height: '62vh', minHeight: 360, border: 'none', background: '#e5e5e5' }} />
        </div>
      )}

      {/* MODAL de despacho com cotação por categoria */}
      {disp && (
        <div onClick={() => !disp.confirming && setDisp(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
          <div onClick={ev => ev.stopPropagation()} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 16, padding: 18, width: 420, maxWidth: '100%' }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 2 }}>Despachar · {diaLabel(disp.envio.dataEntrega)}{disp.envio.periodo ? ` · ${PERIODO_NOME[disp.envio.periodo]}` : ''}</div>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>{disp.envio.pedidos.length} parada(s)</div>
            {disp.quotes && (
              <div style={{ fontSize: 12.5, fontWeight: 700, padding: '8px 10px', borderRadius: 9, marginBottom: 12,
                ...(disp.sandbox ? { background: '#262626', color: '#bbb' } : { background: 'rgba(245,181,68,.12)', color: '#f5b544', border: '1px solid rgba(245,181,68,.45)' }) }}>
                {disp.sandbox ? 'Modo teste: nenhum motorista vem e nada é cobrado.' : 'Valendo: chama motorista de verdade e cobra da sua carteira Lalamove.'}
              </div>
            )}

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
                {disp.confirming ? 'Despachando…' : `${disp.sandbox === false ? 'Chamar motorista' : 'Despachar (teste)'} ${selQuote?.total != null ? fmtR(selQuote.total) : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
