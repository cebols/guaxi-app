import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useData } from '../hooks/useData'
import {
  getEncomendas, getInsumos, getEmbalagens, getProdutos, getProducoes, computeAjustesPendentes, getReceitas,
  insumosDoCardapio, reconciliarBaixasPedidos, reservasPorProduto, updateStatusEncomenda,
  getProntidaoLotes, getInteresses, moverProntidao, desfazerMovimento, embalarProduto, desfazerEmbalar,
  descartarVencidosProntidao, marcarEtapaPronta, desfazerEtapaPronta,
  getAtendimentos, getEnvios, acharContato, janelaAberta, enviarWhatsApp,
} from '../services/db'
import {
  fluxoAtivo, analisarProduto, etapasDoProduto, hhmm, GRUPOS_TAREFA, FEITO, grupoDe, montarTarefas, destinosEmbalar,
} from '../lib/prontidao'
import { NovoPedidoSheet } from './Pedidos'

// Código de cores do Início: cinza = normal; âmbar = precisa de você agora;
// verde = ação principal / navegação.
const AMBAR = '#f5b544'

const fmtN = (n) => String(Math.round((n || 0) * 10) / 10).replace('.', ',')
const fmtR = (v) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`
const hoje0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
const diaDe = (ymd) => new Date(ymd + 'T00:00:00')
const diasAte = (ymd) => Math.round((diaDe(ymd) - hoje0()) / 864e5)
const diaCurto = (ymd) => diaDe(ymd).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '')
const diaRel = (ymd) => { const n = diasAte(ymd); return n === 0 ? 'hoje' : n === 1 ? 'amanhã' : diaCurto(ymd) }

function tempoDesde(ts) {
  if (!ts) return ''
  const min = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  return `há ${Math.floor(h / 24)} dia(s)`
}

function fmtTelefone(t) {
  const d = String(t || '').replace(/\D/g, '').replace(/^55/, '')
  return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : t
}

const STATUS_ENVIO = {
  FILA: 'na fila', ASSIGNING_DRIVER: 'buscando motorista', ON_GOING: 'motorista indo buscar', PICKED_UP: 'saiu pra entrega',
}

// ── Peças ─────────────────────────────────────────────────────────────────────
function Secao({ titulo, acao, onAcao, children }) {
  return (
    <section aria-label={titulo} className="home-sec">
      <div className="home-sec-topo">
        <h2 className="home-h2">{titulo}</h2>
        {acao && <button className="home-btn-verde" onClick={onAcao}>{acao}</button>}
      </div>
      {children}
    </section>
  )
}

function Numero({ valor, rotulo, urgente, onClick }) {
  return (
    <button className={`home-tile${urgente ? ' urgente' : ''}`} onClick={onClick}>
      <span className="home-tile-num">{valor}</span>
      <span className="home-tile-rot">{rotulo}</span>
    </button>
  )
}

function LinhaTarefa({ t, a, agora, onFeito }) {
  const [ocupado, setOcupado] = useState(false)
  const g = GRUPOS_TAREFA.find(x => x.key === grupoDe(t))
  const etapas = a?.etapas || []
  const src = etapas.find(e => e.key === (t.de || t.etapa))
  const nomeSrc = (src?.nome || t.de || t.etapa || '').toLowerCase()

  let sub, rotulo, vazado = false
  if (t.tipo === 'produzir') { sub = a?.vendaveis > 0 ? `faltam ${fmtN(t.n)}` : `esgotado · faltam ${fmtN(t.n)}`; rotulo = 'Planejar'; vazado = true }
  else if (t.tipo === 'avisar') { sub = `voltou · ${fmtN(t.n)} pessoa(s) pediram aviso`; rotulo = 'Avisar'; vazado = true }
  else if (t.tipo === 'vencidos') { sub = `${fmtN(t.n)} vencido(s) em ${nomeSrc}`; rotulo = `Descartar ${fmtN(t.n)}` }
  else if (t.tipo === 'aguardando') { sub = `${fmtN(t.n)} em ${nomeSrc} · pronto às ${hhmm(t.prontoAs || agora)}`; rotulo = 'Já está pronto' }
  else if (t.verbo === 'Congelar de volta') { sub = `${fmtN(t.n)} ${nomeSrc} de ontem · voltam pro freezer`; rotulo = `${FEITO[t.verbo]} ${fmtN(t.n)}` }
  else { sub = t.de === 'embalar' ? `${fmtN(t.n)} sem embalagem` : `${fmtN(t.n)} ${t.de === 'freezer' ? 'do' : 'de'} ${nomeSrc}`; rotulo = `${FEITO[t.verbo] || 'Feito'} ${fmtN(t.n)}` }

  async function feito() {
    setOcupado(true)
    try { await onFeito(t) } finally { setOcupado(false) }
  }

  return (
    <div className="home-linha">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="home-rotulo">{g?.nome || 'Tarefa'}</div>
        <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{t.prod.nome}</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 1 }}>{sub}</div>
      </div>
      <button className={`home-btn${vazado ? ' vazado' : ''}`} onClick={feito} disabled={ocupado}>{ocupado ? '…' : rotulo}</button>
    </div>
  )
}

function CardPedido({ enc, onAbrir, onCobrar, onStatus, onPago }) {
  const [ocupado, setOcupado] = useState(false)
  const dias = enc.dataEntrega ? diasAte(enc.dataEntrega) : null
  const entregue = enc.status === 'Entregue'
  const atrasado = !entregue && dias != null && dias < 0
  const aPagar = enc.pgto !== 'Pago' && enc.saldo > 0
  const cobrarJa = aPagar && (entregue || (dias != null && dias <= 0))

  const quando = enc.dataEntrega ? (atrasado ? `atrasado · ${diaCurto(enc.dataEntrega)}` : diaRel(enc.dataEntrega)) : 'sem data'
  const itens = (enc.itens || []).map(i => `${fmtN(i.quantidade)}× ${i.produto}`).join(', ') || '—'
  const urgente = cobrarJa ? (enc.pgto === 'Atrasado' ? 'pagamento atrasado' : 'falta pagar') : null
  const estado = [entregue ? 'entregue' : enc.status === 'Pronto' ? 'pronto' : 'a fazer', enc.pgto === 'Pago' ? 'pago' : !urgente && aPagar ? 'a pagar' : null]
    .filter(Boolean).join(' · ')

  const proximo = enc.status === 'Pendente' ? 'Pronto'
    : enc.status === 'Pronto' && enc.tipoEntrega !== 'Entrega' ? 'Entregue' : null

  const rodar = async (fn) => { setOcupado(true); try { await fn() } finally { setOcupado(false) } }
  const parar = (fn) => (e) => { e.stopPropagation(); rodar(fn) }

  return (
    <div className="home-card home-pedido" onClick={onAbrir} role="button" tabIndex={0}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{enc.cliente}</span>
        <span style={{ fontSize: 12.5, color: atrasado ? AMBAR : 'var(--text-secondary)', fontWeight: atrasado ? 700 : 400, whiteSpace: 'nowrap' }}>
          {quando} · {(enc.tipoEntrega || 'Retirada').toLowerCase()}
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{itens} · {fmtR(enc.valor)}</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.35 }}>
          {urgente && <span style={{ fontWeight: 700, color: AMBAR }}>{urgente} · </span>}{estado}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {aPagar && <button className="home-btn vazado peq" disabled={ocupado} onClick={parar(onCobrar)}>Cobrar</button>}
          {entregue && aPagar && <button className="home-btn peq" disabled={ocupado} onClick={parar(onPago)}>Recebi</button>}
          {proximo && <button className="home-btn peq" disabled={ocupado} onClick={parar(() => onStatus(proximo))}>{proximo}</button>}
          {!aPagar && !proximo && <button className="home-btn vazado peq" onClick={e => { e.stopPropagation(); onAbrir() }}>Abrir</button>}
        </div>
      </div>
    </div>
  )
}

// ── Página ────────────────────────────────────────────────────────────────────
export default function Home() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [novoPedido, setNovoPedido] = useState(false)
  const [aviso, setAviso] = useState(null) // { msg, undo? }
  const [agora, setAgora] = useState(Date.now())

  const { data: encomendas, reload: reloadEnc } = useData(getEncomendas)
  const { data: insumos, reload: reloadIns } = useData(getInsumos)
  const { data: embalagens, reload: reloadEmb } = useData(getEmbalagens)
  const { data: produtos, reload: reloadProd } = useData(getProdutos)
  const { data: producoes, reload: reloadProducoes } = useData(getProducoes)
  const { data: receitas } = useData(getReceitas)
  const { data: lotes, reload: reloadLotes } = useData(getProntidaoLotes)
  const { data: interesses, reload: reloadInt } = useData(getInteresses)
  const { data: atendimentos, reload: reloadAtd } = useData(getAtendimentos)
  const { data: envios, reload: reloadEnv } = useData(getEnvios)

  // Pedido entregue (inclusive pelo Lalamove) baixa o estoque
  useEffect(() => { reconciliarBaixasPedidos().then(n => { if (n) { reloadProd(); reloadLotes() } }).catch(() => {}) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Relógio + conversas novas
  useEffect(() => {
    const t = setInterval(() => { setAgora(Date.now()); reloadAtd() }, 60000)
    return () => clearInterval(t)
  }, [reloadAtd])
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 6000); return () => clearTimeout(t) }, [aviso])

  const recarregarTudo = () => Promise.all([reloadEnc(), reloadIns(), reloadEmb(), reloadProd(), reloadProducoes(), reloadLotes(), reloadInt(), reloadAtd(), reloadEnv()])
  const recarregarProntidao = () => Promise.all([reloadLotes(), reloadProd(), reloadEmb()])

  // ── Atendimento: quem está esperando você ──
  const esperando = useMemo(() => (atendimentos || [])
    .filter(a => a.precisaHumano || (a.botPausado && a.naoLidas > 0))
    .sort((a, b) => new Date(b.ultimaMsgClienteEm || 0) - new Date(a.ultimaMsgClienteEm || 0)), [atendimentos])

  // ── Produção ativa (mise en place) ──
  const receitaMap = useMemo(() => Object.fromEntries((receitas || []).map(r => [r.id, r])), [receitas])
  const producaoAtiva = useMemo(() => {
    for (const prod of (producoes || [])) {
      const doses = {}
      for (const item of prod.itens) {
        for (const [rid, d] of Object.entries(item.snapshot?.dosesContrib || {})) doses[rid] = (doses[rid] || 0) + d
      }
      const topo = new Set(Object.keys(doses).map(Number))
      const subs = new Set()
      const walk = (recId, depth = 0) => {
        if (depth > 5) return
        for (const ing of (receitaMap[recId]?.ingredientes || [])) {
          if (!ing.subReceitaId || !receitaMap[ing.subReceitaId]?.rendimento) continue
          if (!topo.has(Number(ing.subReceitaId))) subs.add(`sub-${ing.subReceitaId}`)
          walk(ing.subReceitaId, depth + 1)
        }
      }
      for (const rid of Object.keys(doses)) walk(Number(rid))
      const ids = [...Object.keys(doses), ...subs]
      const checks = new Set((prod.checks || []).map(String))
      const total = ids.length
      const done = ids.filter(id => checks.has(id)).length
      if (total > 0 && done < total) return { id: prod.id, total, done, pct: Math.round(done / total * 100) }
    }
    return null
  }, [producoes, receitaMap])

  // ── Prontidão: tarefas de agora ──
  const reservas = useMemo(() => reservasPorProduto(encomendas, produtos), [encomendas, produtos])
  const interessadosPor = useMemo(() => {
    const m = {}
    for (const i of (interesses || [])) (m[i.produtoId] ||= []).push(i)
    return m
  }, [interesses])
  const analises = useMemo(() => (produtos || [])
    .filter(p => p.ativo !== false && p.tipo !== 'combo' && fluxoAtivo(p))
    .map(p => ({ prod: p, a: analisarProduto(p, lotes || [], agora, reservas[p.id] || 0) })), [produtos, lotes, agora, reservas])
  const analisePor = useMemo(() => Object.fromEntries(analises.map(x => [x.prod.id, x.a])), [analises])
  const tarefas = useMemo(() => montarTarefas(analises, interessadosPor), [analises, interessadosPor])
  const prontosPraVender = analises.filter(x => x.a.vendaveis > 0).length
  const unidadesProntas = analises.reduce((s, x) => s + (x.a.vendaveis || 0), 0)

  async function fazerTarefa(t) {
    const a = analisePor[t.prod.id]
    try {
      if (t.tipo === 'produzir') { navigate('/mise-en-place', { state: { adicionar: [{ produtoId: t.prod.id, n: t.n }] } }); return }
      if (t.tipo === 'avisar') { navigate(`/interessados?produto=${t.prod.id}`); return }
      if (t.tipo === 'aguardando') {
        const info = await marcarEtapaPronta(t.prod.id, t.etapa, t.tempoH)
        await recarregarProntidao()
        setAviso({ msg: `${fmtN(t.n)} ${t.prod.nome} pronto(s)`, undo: async () => { await desfazerEtapaPronta(info); await recarregarProntidao(); setAviso({ msg: 'Desfeito' }) } })
        return
      }
      if (t.tipo === 'vencidos') {
        if (!window.confirm(`Descartar ${fmtN(t.n)} ${t.prod.nome} vencido(s)?`)) return
        const e = etapasDoProduto(t.prod).find(x => x.key === t.etapa)
        await descartarVencidosProntidao(t.prod.id, t.etapa, e?.validadeH || 0)
        await recarregarProntidao(); setAviso({ msg: `${fmtN(t.n)} descartado(s)` })
        return
      }
      if (t.de === 'embalar') {
        const info = await embalarProduto(t.prod, destinosEmbalar(t, a) || [{ etapa: t.para, qtd: t.n }])
        await recarregarProntidao()
        setAviso({ msg: `${fmtN(info.n)} embalado(s) · ${t.prod.nome}`, undo: async () => { await desfazerEmbalar(info); await recarregarProntidao(); setAviso({ msg: 'Desfeito' }) } })
        return
      }
      const mov = await moverProntidao(t.prod.id, t.de, t.para, t.n)
      await recarregarProntidao()
      setAviso({ msg: `${FEITO[t.verbo] || 'Feito'} ${fmtN(mov.n)} · ${t.prod.nome}`, undo: async () => { await desfazerMovimento(mov); await recarregarProntidao(); setAviso({ msg: 'Desfeito' }) } })
    } catch (e) { setAviso({ msg: 'Erro: ' + e.message }) }
  }

  // ── Pedidos: hoje e amanhã (+ atrasados e entregues sem pagar) ──
  const pedidos = useMemo(() => (encomendas || [])
    .filter(e => {
      if (e.status === 'Cancelado' || !e.dataEntrega) return false
      if (e.status === 'Entregue') return e.pgto !== 'Pago' && e.saldo > 0 && diasAte(e.dataEntrega) <= 1
      return diasAte(e.dataEntrega) <= 1
    })
    .sort((a, b) => diaDe(a.dataEntrega) - diaDe(b.dataEntrega)), [encomendas])
  const abertosJanela = pedidos.filter(e => e.status !== 'Entregue').length
  const proximoPedido = useMemo(() => (encomendas || [])
    .find(e => e.status !== 'Cancelado' && e.status !== 'Entregue' && e.dataEntrega && diasAte(e.dataEntrega) > 1), [encomendas])

  const vendidoSemana = useMemo(() => {
    const seg = hoje0(); seg.setDate(seg.getDate() - ((seg.getDay() + 6) % 7))
    return (encomendas || [])
      .filter(e => e.status !== 'Cancelado' && e.createdAt && diaDe(e.createdAt) >= seg)
      .reduce((s, e) => s + (Number(e.valor) || 0), 0)
  }, [encomendas])

  const abrirPedido = (enc) => navigate('/pedidos', { state: { openPedidoId: enc.id } })

  async function mudarStatus(enc, novo) {
    const antes = { status: enc.status, pgto: enc.pgto }
    const pgto = novo === 'Entregue' && enc.pgto !== 'Pago' ? 'Atrasado' : enc.pgto
    try {
      await updateStatusEncomenda(enc.id, novo, pgto, enc.tipoEntrega, enc.frete, enc.valor)
      if (novo === 'Entregue') await reconciliarBaixasPedidos().catch(() => {})
      await Promise.all([reloadEnc(), recarregarProntidao()])
      setAviso({
        msg: `${enc.cliente.split(' ')[0]}: ${novo.toLowerCase()}`,
        undo: async () => {
          await updateStatusEncomenda(enc.id, antes.status, antes.pgto, enc.tipoEntrega, enc.frete, enc.valor)
          if (novo === 'Entregue') await reconciliarBaixasPedidos().catch(() => {})
          await Promise.all([reloadEnc(), recarregarProntidao()]); setAviso({ msg: 'Desfeito' })
        },
      })
    } catch (e) { setAviso({ msg: 'Erro: ' + e.message }) }
  }

  async function marcarPago(enc) {
    const antes = enc.pgto
    try {
      await updateStatusEncomenda(enc.id, enc.status, 'Pago', enc.tipoEntrega, enc.frete, enc.valor)
      await reloadEnc()
      setAviso({ msg: `${enc.cliente.split(' ')[0]}: pago`, undo: async () => { await updateStatusEncomenda(enc.id, enc.status, antes, enc.tipoEntrega, enc.frete, enc.valor); await reloadEnc(); setAviso({ msg: 'Desfeito' }) } })
    } catch (e) { setAviso({ msg: 'Erro: ' + e.message }) }
  }

  async function cobrar(enc) {
    const nome = (enc.cliente || '').split(' ')[0]
    const msg = `Oi ${nome}! Passando pra lembrar do pagamento do pedido ${enc.id} (${fmtR(enc.saldo)}). Posso te enviar o pix?`
    const contato = acharContato(atendimentos || [], enc.contato)
    if (janelaAberta(contato)) {
      if (!window.confirm(`Mandar pelo WhatsApp da Guaxí?\n\n${msg}`)) return
      try { await enviarWhatsApp(contato.telefone, msg, { pausar: false }); setAviso({ msg: 'Cobrança enviada pelo WhatsApp da Guaxí' }) }
      catch (e) { setAviso({ msg: 'Erro: ' + e.message }) }
      return
    }
    const dig = String(enc.contato || '').replace(/\D/g, '')
    if (!dig) { abrirPedido(enc); return }
    window.open(`https://wa.me/${dig.startsWith('55') ? dig : '55' + dig}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  // ── Envios e compras ──
  const enviosAtivos = (envios || []).filter(e => STATUS_ENVIO[e.status] && e.pedidos.length > 0).slice(0, 2)
  const ajustes = useMemo(() => computeAjustesPendentes(producoes || []), [producoes])
  const insumosUso = useMemo(() => insumosDoCardapio(produtos, receitas, insumos), [produtos, receitas, insumos])
  const abaixoMin = (i) => i.estoqueAtual !== null && i.estoqueAtual !== undefined && i.estoqueMin > 0 && i.estoqueAtual < i.estoqueMin
  const nCompras = (insumos || [])
    .map(i => ({ ...i, estoqueAtual: (i.estoqueAtual ?? 0) + (ajustes?.insumos?.[i.id] || 0) }))
    .filter(i => insumosUso.has(Number(i.id)) && abaixoMin(i)).length
    + (embalagens || []).filter(abaixoMin).length

  // ── Cabeçalho ──
  const d = new Date(agora)
  const saudacao = d.getHours() < 12 ? 'Bom dia' : d.getHours() < 18 ? 'Boa tarde' : 'Boa noite'
  const dataStr = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
  const dataCap = dataStr.charAt(0).toUpperCase() + dataStr.slice(1)
  const primeiroNome = user?.user_metadata?.given_name || user?.user_metadata?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'você'

  const temTopo = esperando.length > 0 || producaoAtiva

  return (
    <>
      {/* Desktop / tablet */}
      <div className="topbar desktop-only">
        <div className="topbar-inner">
          <div>
            <div className="topbar-title">{saudacao}, {primeiroNome}</div>
            <div className="topbar-sub">{dataCap}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn-ghost" onClick={recarregarTudo} style={{ fontSize: 18, padding: '4px 10px', border: 'none', color: 'var(--text-secondary)' }} title="Atualizar">↻</button>
            <button className="home-btn-pedido" onClick={() => setNovoPedido(true)}>+ Pedido</button>
          </div>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 14 }}>
        {/* Celular */}
        <div className="mobile-only" style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{saudacao}, {primeiroNome}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>{dataCap}</div>
            </div>
            <button className="home-btn-pedido" onClick={() => setNovoPedido(true)}>+ Pedido</button>
          </div>
        </div>

        <div className="home">
          {/* Números do dia */}
          <div className="home-topo">
            <Numero valor={atendimentos ? esperando.length : '—'} rotulo={esperando.length === 1 ? 'cliente esperando você' : 'clientes esperando você'}
              urgente={esperando.length > 0} onClick={() => navigate('/atendimento')} />
            <Numero valor={encomendas ? abertosJanela : '—'} rotulo="pedidos hoje e amanhã" onClick={() => navigate('/pedidos')} />
            <Numero valor={produtos ? prontosPraVender : '—'} rotulo={`${prontosPraVender === 1 ? 'produto' : 'produtos'} à venda · ${fmtN(unidadesProntas)} un`} onClick={() => navigate('/prontidao')} />
            <Numero valor={encomendas ? `R$ ${Math.round(vendidoSemana).toLocaleString('pt-BR')}` : '—'} rotulo="vendido nesta semana" onClick={() => navigate('/pedidos')} />
          </div>

          {/* Quem precisa de você + produção */}
          {temTopo && (
            <div className="home-par topo">
              {esperando.length > 0 && (
                <Secao titulo="Atendimento" acao="conversas" onAcao={() => navigate('/atendimento')}>
                  {esperando.slice(0, 2).map(a => {
                    const nome = a.nome || fmtTelefone(a.telefone)
                    const ultimaCliente = a.ultima?.role === 'user' ? a.ultima.conteudo : ''
                    const resumo = a.motivo || ultimaCliente || 'pediu pra falar com você'
                    return (
                      <div key={a.telefone} className="home-urgente">
                        <div className="home-avatar">{nome.charAt(0).toUpperCase()}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {nome} <span style={{ fontWeight: 400, fontSize: 12.5, color: 'var(--text-secondary)' }}>· {tempoDesde(a.ultimaMsgClienteEm || a.ultimaMsgEm)}</span>
                          </div>
                          <div className="home-2linhas" style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2 }}>{resumo}</div>
                        </div>
                        <button className="home-btn-ambar" onClick={() => navigate(`/atendimento?c=${encodeURIComponent(a.telefone)}`)}>Responder</button>
                      </div>
                    )
                  })}
                  {esperando.length > 2 && (
                    <button className="home-mais home-card" onClick={() => navigate('/atendimento')}>+ {esperando.length - 2} conversa(s) esperando</button>
                  )}
                </Secao>
              )}
              {producaoAtiva && (
                <Secao titulo="Produção">
                  <button className="home-card home-prod" onClick={() => navigate(`/producao/${producaoAtiva.id}`)} aria-label={`Abrir Mise en Place #${producaoAtiva.id}`}>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <span style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>Mise en Place #{producaoAtiva.id}</span>
                        <span style={{ fontSize: 16, fontWeight: 800 }}>{producaoAtiva.pct}%</span>
                      </div>
                      <div style={{ height: 8, borderRadius: 4, background: 'var(--border-light-color)', overflow: 'hidden' }}>
                        <div style={{ width: `${producaoAtiva.pct}%`, height: '100%', borderRadius: 4, background: 'var(--teal)', transition: 'width .4s ease' }} />
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{producaoAtiva.done} de {producaoAtiva.total} feitas</div>
                    </div>
                    <span aria-hidden="true" style={{ fontSize: 26, lineHeight: 1, color: 'var(--text-tertiary)' }}>›</span>
                  </button>
                </Secao>
              )}
            </div>
          )}

          <div className="home-par">
            {/* Agora · Prontidão */}
            <Secao titulo="Agora · Prontidão" acao="ver tudo" onAcao={() => navigate('/prontidao')}>
              <div className="home-card">
                {lotes === null && produtos === null ? (
                  <div className="home-vazio">Carregando…</div>
                ) : analises.length === 0 ? (
                  <button className="home-mais" onClick={() => navigate('/prontidao')}>Configurar a prontidão dos produtos</button>
                ) : tarefas.length === 0 ? (
                  <div className="home-vazio">Tudo em dia na prontidão.</div>
                ) : (
                  <>
                    <div className="home-lista">
                      {tarefas.slice(0, 3).map(t => (
                        <LinhaTarefa key={`${t.prod.id}-${t.tipo}-${t.de || t.etapa || ''}-${t.para || ''}`} t={t} a={analisePor[t.prod.id]} agora={agora} onFeito={fazerTarefa} />
                      ))}
                    </div>
                    {tarefas.length > 3 && (
                      <button className="home-mais" style={{ borderTop: '1px solid var(--border-light-color)' }} onClick={() => navigate('/prontidao')}>
                        + {tarefas.length - 3} {tarefas.length - 3 === 1 ? 'tarefa' : 'tarefas'} além dessas
                      </button>
                    )}
                  </>
                )}
              </div>
            </Secao>

            <div className="home-col">
              {/* Pedidos */}
              <Secao titulo="Pedidos · hoje e amanhã" acao="todos" onAcao={() => navigate('/pedidos')}>
                {encomendas === null ? (
                  <div className="home-card home-vazio">Carregando…</div>
                ) : pedidos.length === 0 ? (
                  <div className="home-card home-vazio">
                    Nada pra hoje e amanhã.
                    {proximoPedido && (
                      <button className="home-link" onClick={() => abrirPedido(proximoPedido)}>
                        Próximo: {proximoPedido.cliente.split(' ')[0]} · {diaCurto(proximoPedido.dataEntrega)}
                      </button>
                    )}
                  </div>
                ) : pedidos.map(enc => (
                  <CardPedido key={enc.id} enc={enc}
                    onAbrir={() => abrirPedido(enc)}
                    onCobrar={() => cobrar(enc)}
                    onPago={() => marcarPago(enc)}
                    onStatus={(novo) => mudarStatus(enc, novo)} />
                ))}
              </Secao>

              {/* Envios e compras */}
              {(enviosAtivos.length > 0 || nCompras > 0) && (
                <section aria-label="Envios e compras" className="home-card home-lista">
                  {enviosAtivos.map(e => (
                    <button key={e.id} className="home-linha-link" onClick={() => navigate('/envios')}>
                      <span style={{ flex: 1 }}>Envio {e.dataEntrega ? diaRel(e.dataEntrega) : ''} <span style={{ color: 'var(--text-secondary)' }}>· {STATUS_ENVIO[e.status]}</span></span>
                      <span className="home-linha-dir">{e.status === 'FILA' ? 'abrir' : 'mapa'}</span>
                    </button>
                  ))}
                  {nCompras > 0 && (
                    <button className="home-linha-link" onClick={() => navigate('/contagem')}>
                      <span style={{ flex: 1 }}>{nCompras} {nCompras === 1 ? 'item' : 'itens'} <span style={{ color: 'var(--text-secondary)' }}>abaixo do mínimo</span></span>
                      <span className="home-linha-dir">compras</span>
                    </button>
                  )}
                </section>
              )}
            </div>
          </div>
        </div>
      </div>

      {novoPedido && <NovoPedidoSheet onClose={() => setNovoPedido(false)} onSaved={reloadEnc} />}
      {aviso && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 90, display: 'flex', justifyContent: 'center', zIndex: 300, pointerEvents: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#222', color: '#fff', borderRadius: 12, padding: '11px 16px', fontSize: 14, boxShadow: '0 6px 20px rgba(0,0,0,.4)', pointerEvents: 'auto' }}>
            <span>{aviso.msg}</span>
            {aviso.undo && <button onClick={() => { const u = aviso.undo; setAviso(null); u().catch(e => setAviso({ msg: 'Erro: ' + e.message })) }} style={{ background: 'none', border: 'none', color: 'var(--teal)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Desfazer</button>}
          </div>
        </div>
      )}
    </>
  )
}
