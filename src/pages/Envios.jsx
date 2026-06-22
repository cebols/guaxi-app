import { useState } from 'react'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { useAuth } from '../contexts/AuthContext'
import {
  getPedidosParaAgrupar, getEnvios, gerarEnvios, desfazerEnvio,
  despacharEnvio, atualizarStatusEnvio, atualizarEnvio, cancelarEnvio,
} from '../services/db'

const fmtR = (n) => `R$ ${Number(n || 0).toFixed(2).replace('.', ',')}`
const VEIC_LABEL = { LALAGO: '🛵 Moto (LALAGO)', HATCHBACK: '🚗 Hatchback', CAR: '🚗 Carro (CAR)', VAN: '🚐 Van' }
const VEIC_OPTS = ['LALAGO', 'HATCHBACK', 'CAR', 'VAN']

const STATUS_LABEL = {
  FILA: 'Na fila',
  ASSIGNING_DRIVER: 'Buscando motorista',
  ON_GOING: 'A caminho da coleta',
  PICKED_UP: 'Coletado · em entrega',
  COMPLETED: 'Entregue',
  CANCELED: 'Cancelado',
  EXPIRED: 'Expirado',
  REJECTED: 'Rejeitado',
}
const EM_ROTA = ['ASSIGNING_DRIVER', 'ON_GOING', 'PICKED_UP']

function diaLabel(s) {
  if (!s) return '—'
  const d = new Date(s + 'T12:00:00')
  const dd = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  return `${dd[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

const card = { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, padding: 14, marginBottom: 12 }
const btn = (bg, fg = '#000') => ({ background: bg, color: fg, border: 'none', borderRadius: 8, padding: '8px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' })
const col = { flex: '1 1 280px', minWidth: 280, background: '#141414', borderRadius: 14, padding: 12 }
const colTitle = { fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: '#888', marginBottom: 10, padding: '0 2px' }
const selectStyle = { background: '#222', color: '#e8e8e8', border: '1px solid #333', borderRadius: 7, padding: '4px 8px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }

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

export default function Envios() {
  const { user } = useAuth()
  const { show } = useToast()
  const { data: pendentes, loading: l1, reload: rP } = useData(getPedidosParaAgrupar)
  const { data: envios, loading: l2, reload: rE } = useData(getEnvios)
  const [busy, setBusy] = useState(null)
  const [mapaAberto, setMapaAberto] = useState(null)

  const reload = () => { rP(); rE() }

  const run = async (key, fn, okMsg) => {
    setBusy(key)
    try { const r = await fn(); if (okMsg) show(typeof okMsg === 'function' ? okMsg(r) : okMsg); reload() }
    catch (e) { show('Erro: ' + e.message) }
    finally { setBusy(null) }
  }

  // Pendentes agrupados por dia
  const porDia = {}
  for (const p of (pendentes || [])) (porDia[p.dataEntrega] ||= []).push(p)

  const fila   = (envios || []).filter(e => e.status === 'FILA')
  const emRota = (envios || []).filter(e => EM_ROTA.includes(e.status))
  // Tudo que não é fila nem em-rota cai aqui (COMPLETED/CANCELED/EXPIRED/REJECTED
  // ou qualquer status desconhecido) — assim nenhum envio some do kanban.
  const finais = (envios || []).filter(e => e.status !== 'FILA' && !EM_ROTA.includes(e.status))
  const mapEnvio = (envios || []).find(e => e.id === mapaAberto && e.shareLink)

  const whatsLink = (p, e) => {
    const fone = (p.contato || '').replace(/\D/g, '')
    const num = fone.startsWith('55') ? fone : `55${fone}`
    const msg = `Oi ${p.cliente}! Seu pedido sai para entrega ${diaLabel(e.dataEntrega)}. Frete: ${fmtR(p.frete)}.` +
      (e.shareLink ? ` Acompanhe a entrega: ${e.shareLink}` : '')
    return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`
  }

  return (
    <div style={{ padding: '16px 14px 24px', color: '#e8e8e8', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Envios</h1>
        <button
          onClick={() => run('gerar', gerarEnvios, (ids) => ids.length ? `${ids.length} envio(s) criado(s)` : 'Nada para agrupar')}
          disabled={busy === 'gerar' || !(pendentes || []).length}
          style={{ ...btn('#22b886'), opacity: (pendentes || []).length ? 1 : 0.5 }}>
          {busy === 'gerar' ? 'Agrupando…' : '⚡ Gerar envios do dia'}
        </button>
      </div>

      {(l1 || l2) && <div style={{ color: '#666' }}>Carregando…</div>}

      {/* KANBAN — altura limitada quando o mapa está aberto */}
      <div style={{
        display: 'flex', gap: 12, alignItems: 'flex-start',
        maxHeight: mapEnvio ? '42vh' : 'none',
        overflowY: mapEnvio ? 'auto' : 'visible',
        overflowX: 'auto',
      }}>

        {/* A ORGANIZAR */}
        <div style={col}>
          <div style={colTitle}>A organizar · {(pendentes || []).length}</div>
          {Object.keys(porDia).length === 0 && <div style={{ color: '#555', fontSize: 13 }}>Sem pedidos soltos.</div>}
          {Object.entries(porDia).map(([dia, peds]) => (
            <div key={dia} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>{diaLabel(dia)}</strong>
                <span style={{ fontSize: 12, color: '#888' }}>{peds.length} pedido(s)</span>
              </div>
              {peds.map(p => <PedidoMini key={p.id} p={p} />)}
            </div>
          ))}
        </div>

        {/* NA FILA */}
        <div style={col}>
          <div style={colTitle}>Na fila · {fila.length}</div>
          {fila.length === 0 && <div style={{ color: '#555', fontSize: 13 }}>Vazio.</div>}
          {fila.map(e => (
            <div key={e.id} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <strong>{diaLabel(e.dataEntrega)}</strong>
                <select value={e.veiculo} disabled={busy === 'v' + e.id}
                  onChange={ev => run('v' + e.id, () => atualizarEnvio(e.id, { veiculo: ev.target.value }), 'Veículo atualizado')}
                  style={selectStyle}>
                  {VEIC_OPTS.map(v => <option key={v} value={v}>{VEIC_LABEL[v]}</option>)}
                </select>
              </div>
              <div style={{ fontSize: 11, color: '#888', margin: '3px 0 2px' }}>{e.pedidos.length} parada(s)</div>
              {e.pedidos.map(p => <PedidoMini key={p.id} p={p} />)}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button onClick={() => run('d' + e.id, () => despacharEnvio(user.id, e.id), (r) => `Despachado! ${r.sandbox ? '(sandbox) ' : ''}custo ${fmtR(r.custo)}`)}
                  disabled={busy === 'd' + e.id} style={btn('#22b886')}>
                  {busy === 'd' + e.id ? 'Despachando…' : '🚀 Despachar'}
                </button>
                <button onClick={() => run('x' + e.id, () => desfazerEnvio(e.id), 'Desfeito')}
                  disabled={busy === 'x' + e.id} style={btn('#2a2a2a', '#ccc')}>Desfazer</button>
              </div>
            </div>
          ))}
        </div>

        {/* EM ROTA */}
        <div style={col}>
          <div style={colTitle}>Em rota · {emRota.length}</div>
          {emRota.length === 0 && <div style={{ color: '#555', fontSize: 13 }}>Vazio.</div>}
          {emRota.map(e => (
            <div key={e.id} style={{ ...card, border: mapaAberto === e.id ? '1px solid #22b886' : card.border }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>{diaLabel(e.dataEntrega)}</strong>
                <span style={{ fontSize: 11, color: '#f0b429', fontWeight: 700 }}>{STATUS_LABEL[e.status] || e.status}</span>
              </div>
              {e.driverNome && <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>🧑‍✈️ {e.driverNome} · {e.driverPlate} · {e.driverPhone}</div>}
              {e.pedidos.map(p => (
                <div key={p.id} style={{ borderTop: '1px solid #242424', padding: '7px 0' }}>
                  <PedidoMini p={p} />
                  <a href={whatsLink(p, e)} target="_blank" rel="noreferrer" style={{ ...btn('#1f6b50', '#9ff0cf'), display: 'inline-block', textDecoration: 'none', fontSize: 11, padding: '4px 9px', marginTop: 4 }}>📲 Tracking p/ {p.cliente.split(' ')[0]}</a>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button onClick={() => run('s' + e.id, () => atualizarStatusEnvio(user.id, e.id), (r) => `Status: ${STATUS_LABEL[r.status] || r.status}`)}
                  disabled={busy === 's' + e.id} style={btn('#2a2a2a', '#ccc')}>
                  {busy === 's' + e.id ? '…' : '🔄 Atualizar'}
                </button>
                {e.shareLink && (
                  <button onClick={() => setMapaAberto(mapaAberto === e.id ? null : e.id)} style={btn(mapaAberto === e.id ? '#22b886' : '#2a2a2a', mapaAberto === e.id ? '#000' : '#ccc')}>
                    🗺️ {mapaAberto === e.id ? 'Fechar mapa' : 'Mapa'}
                  </button>
                )}
                <button onClick={() => { if (confirm('Cancelar este envio? Os pedidos voltam para "A organizar".')) run('c' + e.id, () => cancelarEnvio(user.id, e.id), (r) => `Cancelado (${r.lalamoveCancel})`) }}
                  disabled={busy === 'c' + e.id} style={btn('#3a1f1f', '#f87171')}>
                  {busy === 'c' + e.id ? '…' : '✕ Cancelar'}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* FINALIZADOS */}
        <div style={col}>
          <div style={colTitle}>Finalizados · {finais.length}</div>
          {finais.length === 0 && <div style={{ color: '#555', fontSize: 13 }}>Vazio.</div>}
          {finais.map(e => (
            <div key={e.id} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>{diaLabel(e.dataEntrega)}</strong>
                <span style={{ fontSize: 11, color: e.status === 'COMPLETED' ? '#22b886' : '#f87171', fontWeight: 700 }}>{STATUS_LABEL[e.status] || e.status}</span>
              </div>
              <div style={{ fontSize: 12, color: '#777', margin: '4px 0' }}>{e.pedidos.length} parada(s) · {fmtR(e.precoTotal)}</div>
              {e.pedidos.length > 0 && e.status !== 'COMPLETED' && (
                <button onClick={() => run('r' + e.id, () => desfazerEnvio(e.id), 'Pedidos devolvidos para A organizar')}
                  disabled={busy === 'r' + e.id} style={{ ...btn('#2a2a2a', '#ccc'), marginTop: 4 }}>
                  {busy === 'r' + e.id ? '…' : '↩︎ Reabrir pedidos'}
                </button>
              )}
            </div>
          ))}
        </div>

      </div>

      {/* MAPA — abre grande abaixo do kanban */}
      {mapEnvio && (
        <div style={{ marginTop: 14, background: '#141414', borderRadius: 14, padding: 12, height: '50vh', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong style={{ fontSize: 14 }}>🗺️ Rastreio · {diaLabel(mapEnvio.dataEntrega)} · {STATUS_LABEL[mapEnvio.status] || mapEnvio.status}</strong>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <a href={mapEnvio.shareLink} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#22b886' }}>abrir em nova aba ↗</a>
              <button onClick={() => setMapaAberto(null)} style={btn('#2a2a2a', '#ccc')}>Fechar</button>
            </div>
          </div>
          <iframe
            src={mapEnvio.shareLink}
            title={`tracking-${mapEnvio.id}`}
            style={{ flex: 1, width: '100%', border: '1px solid #2a2a2a', borderRadius: 10 }}
          />
        </div>
      )}
    </div>
  )
}
