import { useState, useMemo, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { useAuth } from '../contexts/AuthContext'
import NovoPedidoForm from '../components/NovoPedidoForm'
import {
  getProdutos, getEncomendas, getClientes, updateStatusEncomenda, updateEncomendaItens, deletePedido,
  reconciliarBaixasPedidos, getContatosAtendimento, acharContato, janelaAberta, enviarWhatsApp,
  atualizarPedido, loadUserConfig, pixDoPedido, aguardandoPix,
} from '../services/db'
import { usePedidoMudou } from '../hooks/useRealtimePedidos'
import { pixCopiaECola } from '../lib/pix'

// ── Pedidos: lista agrupada por dia e período + detalhe com mensagens ────────
// Código de cores: cinza = normal · âmbar = precisa de você · verde = ação.

const AMBAR = '#f5b544'
export const PERIODOS = [
  { v: 'manha', nome: 'Manhã', faixa: '9–12h' },
  { v: 'tarde', nome: 'Tarde', faixa: '12–18h' },
  { v: 'noite', nome: 'Noite', faixa: '18–22h' },
]
const periodoDe = v => PERIODOS.find(p => p.v === v) || null
const ORDEM_PERIODO = { manha: 0, tarde: 1, noite: 2 }
const CANAL_NOME = { FormExterno: 'Cardápio', WhatsApp: 'WhatsApp', Instagram: 'Instagram', iFood: 'iFood', Presencial: 'Presencial' }
const ENVIO_STATUS = {
  FILA: 'na fila', ASSIGNING_DRIVER: 'buscando motorista', ON_GOING: 'motorista indo buscar',
  PICKED_UP: 'saiu pra entrega', COMPLETED: 'entregue', CANCELED: 'cancelado', EXPIRED: 'expirado', REJECTED: 'rejeitado',
}
const EM_ROTA = ['ASSIGNING_DRIVER', 'ON_GOING', 'PICKED_UP']

const fmtR = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtQ = q => String(Math.round((Number(q) || 0) * 100) / 100).replace('.', ',')
const num = v => parseFloat(String(v ?? '').replace(',', '.')) || 0
const fmtM = v => Number(v || 0).toFixed(2).replace('.', ',')
const hoje0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
const diaDe = ymd => new Date(ymd + 'T00:00:00')
const diasAte = ymd => Math.round((diaDe(ymd) - hoje0()) / 864e5)
const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const SEM_LONGO = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const ddmm = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
const diaCurto = ymd => { const d = diaDe(ymd); return `${SEM[d.getDay()]} ${ddmm(d)}` }
const diaLongo = ymd => { const d = diaDe(ymd); return `${SEM_LONGO[d.getDay()]}, ${ddmm(d)}` }
const cap = s => s.charAt(0).toUpperCase() + s.slice(1)
// O app rola dentro de .main-content (não na janela)
const rolador = () => document.querySelector('.main-content') || document.scrollingElement || document.documentElement

function tituloDia(ymd, passadoNormal) {
  if (!ymd) return 'Sem data'
  const n = diasAte(ymd), c = diaCurto(ymd)
  if (n === 0) return `Hoje · ${c}`
  if (n === 1) return `Amanhã · ${c}`
  if (n < 0 && !passadoNormal) return `Atrasado · ${c}`
  return cap(c)
}

const aberto = p => p.status !== 'Entregue' && p.status !== 'Cancelado'
const faltaPagar = p => (p.status === 'Cancelado' || p.pgto === 'Pago') ? 0 : Math.max(0, Number(p.saldo) || 0)
const primeiroNome = p => (p.cliente || '').trim().split(/\s+/)[0] || ''
const canalNome = c => CANAL_NOME[c] || c || '—'

// Combos guardam os sabores como linhas "↳ Produto" logo abaixo
function agruparItens(itens) {
  const out = []
  for (const it of itens || []) {
    const nome = String(it.produto || '')
    if (nome.startsWith('↳') && out.length) out[out.length - 1].subs.push({ nome: nome.replace(/^↳\s*/, ''), q: it.quantidade })
    else out.push({ ...it, subs: [] })
  }
  return out
}
function nomesSubs(subs) {
  const primeira = s => s.nome.split(/\s+/)[0]
  const comum = subs.length && subs.every(s => primeira(s) === primeira(subs[0])) ? primeira(subs[0]) : null
  return subs.map(s => `${fmtQ(s.q)} ${comum ? s.nome.slice(comum.length).trim() || s.nome : s.nome}`).join(', ')
}
const resumoItens = itens => agruparItens(itens).map(i => `${fmtQ(i.quantidade)}× ${i.produto}${i.subs.length ? ` (${nomesSubs(i.subs)})` : ''}`).join(' · ') || '—'

const horaDe = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

function alertasDe(p) {
  const out = []
  if (aguardandoPix(p)) return out   // ainda não é pedido confirmado: nada pra cobrar nem fazer
  const n = p.dataEntrega ? diasAte(p.dataEntrega) : null
  if (aberto(p) && n != null && n < 0) out.push('atrasado')
  if (faltaPagar(p) > 0 && (p.status === 'Entregue' || (n != null && n <= 0))) out.push(p.pgto === 'Atrasado' ? 'pagamento atrasado' : 'falta pagar')
  if (aberto(p) && p.tipoEntrega === 'Entrega' && !p.periodo && n != null && n <= 2) out.push('combinar o período')
  return out
}

function estadoTexto(p) {
  if (aguardandoPix(p)) return `aguardando o Pix · cancela sozinho às ${horaDe(p.aguardaPixAte)}`
  const st = p.status === 'Pendente' ? 'a fazer' : p.status === 'Pronto' ? 'pronto' : p.status === 'Entregue' ? 'entregue' : 'cancelado'
  const jaAvisou = alertasDe(p).some(a => a.includes('pag'))
  const pg = p.pgto === 'Pago' ? (p.pixPagoEm ? 'pago no Pix ✓' : 'pago') : jaAvisou ? null : p.sinal > 0 ? `sinal ${fmtR(p.sinal)}` : 'a receber'
  const env = p.envio && p.status !== 'Entregue' ? ENVIO_STATUS[p.envio.status] : null
  return [st, env ? `envio ${env}` : null, p.status === 'Cancelado' ? null : pg].filter(Boolean).join(' · ')
}

// Próxima ação de cada pedido (botão principal do card / detalhe)
function proximaAcao(p) {
  if (p.status === 'Pendente') return { key: 'pronto', label: 'Pronto', longo: 'Marcar como pronto' }
  if (p.status === 'Pronto') {
    if (p.tipoEntrega !== 'Entrega') return { key: 'entregue', label: 'Entregue', longo: 'Marcar como entregue' }
    if (p.envio && EM_ROTA.includes(p.envio.status) && p.envio.shareLink) return { key: 'rastreio', label: 'Rastreio', longo: 'Acompanhar entrega' }
    return { key: 'envios', label: 'Envios', longo: p.envio ? 'Ver envio' : 'Despachar nos envios' }
  }
  if (p.status === 'Entregue' && faltaPagar(p) > 0) return { key: 'recebi', label: 'Recebi', longo: 'Marcar como pago' }
  if (p.status === 'Cancelado') return { key: 'reabrir', label: 'Reabrir', longo: 'Reabrir pedido' }
  return null
}

// ── Mensagens prontas ─────────────────────────────────────────────────────────
function quandoTexto(p) {
  if (!p.dataEntrega) return null
  const per = periodoDe(p.periodo)
  const dia = diasAte(p.dataEntrega) === 0 ? 'hoje' : diasAte(p.dataEntrega) === 1 ? 'amanhã' : diaLongo(p.dataEntrega)
  return `${dia}${per ? `, de ${per.nome.toLowerCase()} (${per.faixa})` : ''}`
}
function modelosDe(p, pix, codigoMP) {
  const nome = primeiroNome(p)
  const oi = `Oi${nome ? `, ${nome}` : ''}!`
  const quando = quandoTexto(p)
  const entrega = p.tipoEntrega === 'Entrega'
  const falta = faltaPagar(p)
  // Pix copia e cola com o valor que falta: vai numa mensagem separada (o cliente copia com um toque)
  // codigoMP = Pix do Mercado Pago (o pedido vira Pago sozinho quando cai); sem ele, o da chave
  const codigo = falta > 0 ? (codigoMP || (pix ? pixCopiaECola({ chave: pix, valor: falta, txid: p.id }) : '')) : ''
  const pixTxt = codigo ? ' Te mando o Pix copia e cola logo abaixo 👇' : pix ? ` A chave Pix é ${pix}.` : ''
  const link = p.envio?.shareLink
  const m = []
  m.push({ key: 'confirmar', label: falta > 0 ? 'Confirmar + Pix' : 'Confirmar', extra: falta > 0 ? codigo : '',
    texto: `${oi} Seu pedido ${p.id} tá confirmado${quando ? ` pra ${entrega ? '' : 'retirada '}${quando}` : ''}.${falta > 0 ? ` O total é ${fmtR(falta)}.${pixTxt}` : ''} Qualquer coisa é só chamar aqui!` })
  if (entrega && p.dataEntrega) m.push({ key: 'periodo', label: 'Combinar período',
    texto: `${oi} Sobre o pedido ${p.id} pra ${diaLongo(p.dataEntrega)}: qual período fica melhor pra receber — manhã (9–12h), tarde (12–18h) ou noite (18–22h)?` })
  if (p.dataEntrega) m.push({ key: 'lembrete', label: 'Lembrete do dia',
    texto: entrega
      ? `${oi} Passando pra lembrar que seu pedido ${p.id} sai ${quando}. Vou te mandar o link pra acompanhar assim que o motorista sair daqui.`
      : `${oi} Passando pra lembrar que seu pedido ${p.id} fica pronto pra retirada ${quando}.` })
  if (entrega) m.push({ key: 'saiu', label: 'Saiu pra entrega',
    texto: `${oi} Seu pedido ${p.id} saiu pra entrega 🛵${link ? ` Dá pra acompanhar por aqui: ${link}` : ''}` })
  else m.push({ key: 'pronto', label: 'Pronto pra retirar', texto: `${oi} Seu pedido ${p.id} tá pronto pra retirada 💛` })
  if (falta > 0) m.push({ key: 'cobrar', label: 'Cobrar', extra: codigo,
    texto: `${oi} Passando pra lembrar do pagamento do pedido ${p.id} (${fmtR(falta)}).${codigo ? ' Segue o Pix copia e cola logo abaixo 👇 (o valor já vem certinho)' : pix ? ` Chave Pix: ${pix}` : ' Posso te mandar o Pix?'}` })
  if (codigo) m.push({ key: 'pix', label: 'Só o código Pix', texto: codigo })
  m.push({ key: 'avaliar', label: 'Pedir avaliação', texto: `${oi} Espero que tenha curtido o pedido ${p.id}! Se puder, manda uma foto ou conta o que achou 💛` })
  return m
}
function modeloPadrao(p) {
  if (alertasDe(p).includes('combinar o período')) return 'periodo'
  if (p.envio && EM_ROTA.includes(p.envio.status)) return 'saiu'
  if (p.status === 'Pronto' && p.tipoEntrega !== 'Entrega') return 'pronto'
  if (p.status === 'Entregue') return faltaPagar(p) > 0 ? 'cobrar' : 'avaliar'
  return 'confirmar'
}

function waLink(phone, texto) {
  const d = String(phone || '').replace(/\D/g, '')
  if (!d) return null
  return `https://wa.me/${d.startsWith('55') ? d : '55' + d}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`
}

// ── Peças ─────────────────────────────────────────────────────────────────────
const IconeLocal = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21z" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="9.5" r="2.5" stroke="currentColor" strokeWidth="2" /></svg>
)
const IconeCasa = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
)
const IconeVoltar = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
)

function Aviso({ aviso, fechar }) {
  if (!aviso) return null
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 90, display: 'flex', justifyContent: 'center', zIndex: 300, pointerEvents: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#222', color: '#fff', borderRadius: 12, padding: '11px 16px', fontSize: 14, boxShadow: '0 6px 20px rgba(0,0,0,.4)', pointerEvents: 'auto' }}>
        <span>{aviso.msg}</span>
        {aviso.undo && <button onClick={() => { const u = aviso.undo; fechar(); u() }} style={{ background: 'none', border: 'none', color: 'var(--teal)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Desfazer</button>}
      </div>
    </div>
  )
}

function CardPedido({ p, onAbrir, onAcao }) {
  const [ocupado, setOcupado] = useState(false)
  const alertas = alertasDe(p)
  const combinar = alertas.includes('combinar o período')
  const outros = alertas.filter(a => a !== 'combinar o período')
  const esperando = aguardandoPix(p)
  const prox = esperando ? null : proximaAcao(p)
  const cobrar = faltaPagar(p) > 0 && p.status !== 'Entregue' && p.status !== 'Cancelado'
  const rodar = key => async e => { e.stopPropagation(); setOcupado(true); try { await onAcao(p, key) } finally { setOcupado(false) } }
  const entrega = p.tipoEntrega === 'Entrega'
  return (
    <article className={`pd-card${alertas.length ? ' alerta' : ''}${esperando ? ' esperando' : ''}`} onClick={onAbrir} tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onAbrir() }} aria-label={`Pedido ${p.id} de ${p.cliente}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.cliente}</span>
        <span className="pd-chip">{canalNome(p.canal)}</span>
        <span style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtR(p.valor)}</span>
      </div>
      <div className="pd-2l" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{resumoItens(p.itens)}</div>
      <div className="pd-linha">
        {entrega ? <IconeLocal /> : <IconeCasa />}
        <span>{entrega ? `Entrega${p.endereco ? ` · ${p.endereco}` : ''}` : 'Retirada'}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.35 }}>
          {(combinar ? ['combinar o período', ...outros] : outros).map(a => <b key={a} style={{ color: AMBAR }}>{a} · </b>)}
          {estadoTexto(p)}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {combinar
            ? <button className="pd-btn ambar" disabled={ocupado} onClick={e => { e.stopPropagation(); onAcao(p, 'combinar') }}>Combinar</button>
            : <>
                {cobrar && <button className="pd-btn vazado" disabled={ocupado} onClick={rodar('cobrar')}>{esperando ? 'Lembrar' : 'Cobrar'}</button>}
                {prox && <button className="pd-btn" disabled={ocupado} onClick={rodar(prox.key)}>{prox.label}</button>}
              </>}
        </div>
      </div>
    </article>
  )
}

// ── Detalhe ───────────────────────────────────────────────────────────────────
function DetalhePedido({ p, pix, contatos, msgInicial, onBack, onAcao, recarregar, avisar }) {
  const navigate = useNavigate()
  const [editItens, setEditItens] = useState(false)
  const [itensEd, setItensEd] = useState([])
  const [mudarDia, setMudarDia] = useState(false)
  const [endereco, setEndereco] = useState(p.endereco || '')
  const [frete, setFrete] = useState(p.frete ? fmtM(p.frete) : '')
  const [sinal, setSinal] = useState(p.sinal ? fmtM(p.sinal) : '')
  const [apagar, setApagar] = useState(false)
  const [modelo, setModelo] = useState(msgInicial || modeloPadrao(p))
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const entrega = p.tipoEntrega === 'Entrega'

  useEffect(() => { setEndereco(p.endereco || ''); setFrete(p.frete ? fmtM(p.frete) : ''); setSinal(p.sinal ? fmtM(p.sinal) : '') }, [p.id, p.endereco, p.frete, p.sinal])
  // Pix automático do Mercado Pago pra esse pedido (cria ou reaproveita; se falhar, fica o da chave)
  const [pixMP, setPixMP] = useState(null)
  const faltaAgora = faltaPagar(p)
  useEffect(() => {
    setPixMP(null)
    if (!(faltaAgora > 0)) return
    let vivo = true
    pixDoPedido(p.id).then(d => { if (vivo) setPixMP(d?.codigo || null) }).catch(() => {})
    return () => { vivo = false }
  }, [p.id, faltaAgora])
  const modelos = useMemo(() => modelosDe(p, pix, pixMP), [p, pix, pixMP])
  useEffect(() => { setTexto(modelos.find(m => m.key === modelo)?.texto || modelos[0]?.texto || '') }, [modelo, p.id, pix, pixMP, p.periodo, p.dataEntrega, p.tipoEntrega, p.pgto]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { rolador().scrollTo(0, 0) }, [p.id])

  const itensTotal = (p.itens || []).reduce((s, it) => s + (Number(it.precoUnit) || 0) * (Number(it.quantidade) || 0), 0)
  const contato = acharContato(contatos, p.contato)
  const janela = janelaAberta(contato)
  const ate = contato?.ultimaMsgClienteEm ? new Date(new Date(contato.ultimaMsgClienteEm).getTime() + 24 * 3600e3) : null
  const ateTxt = ate ? `${ate.toDateString() === new Date().toDateString() ? 'hoje' : 'amanhã'} ${ate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''
  const prox = proximaAcao(p)
  const passos = ['Pendente', 'Pronto', 'Entregue']
  const idx = passos.indexOf(p.status)

  async function salvar(fn, msg) {
    setOcupado(true)
    try { await fn(); await recarregar(); if (msg) avisar({ msg }) }
    catch (e) { avisar({ msg: 'Erro: ' + e.message }) }
    finally { setOcupado(false) }
  }
  const salvarCampos = (campos, msg) => salvar(() => atualizarPedido(p.id, campos), msg)
  const mudarTipo = t => salvar(() => updateStatusEncomenda(p.id, p.status, p.pgto, t, num(frete), itensTotal + (t === 'Entrega' ? num(frete) : 0)), t === 'Entrega' ? 'Agora é entrega' : 'Agora é retirada')
  const salvarFrete = () => { if (num(frete) === Number(p.frete || 0)) return; salvar(() => updateStatusEncomenda(p.id, p.status, p.pgto, p.tipoEntrega, num(frete), itensTotal + num(frete)), 'Frete salvo') }
  const salvarEndereco = () => { if (endereco.trim() === (p.endereco || '')) return; salvarCampos({ endereco: endereco.trim() }, 'Endereço salvo') }
  const salvarSinal = () => { if (num(sinal) === Number(p.sinal || 0)) return; salvarCampos({ sinal: num(sinal) }, 'Sinal salvo') }
  const salvarPgto = v => salvar(() => updateStatusEncomenda(p.id, p.status, v, p.tipoEntrega, p.frete, p.valor), v === 'Pago' ? 'Marcado como pago' : 'Marcado como a receber')

  function abrirEdicao() {
    setItensEd((p.itens || []).map(it => ({ ...it, quantidade: fmtQ(it.quantidade), precoUnit: fmtQ(it.precoUnit) })))
    setEditItens(true)
  }
  const salvarItens = () => salvar(async () => {
    const lista = itensEd.map(it => ({ ...it, quantidade: num(it.quantidade), precoUnit: num(it.precoUnit) }))
    await updateEncomendaItens(p.id, lista)
    const novo = lista.reduce((s, it) => s + it.precoUnit * it.quantidade, 0) + (entrega ? Number(p.frete || 0) : 0)
    await atualizarPedido(p.id, { valor: novo })
    setEditItens(false)
  }, 'Itens salvos')

  async function enviarMsg() {
    if (!texto.trim()) return
    const extra = modelos.find(m => m.key === modelo)?.extra || ''   // o Pix copia e cola, em mensagem separada
    if (janela) {
      setEnviando(true)
      try {
        await enviarWhatsApp(contato.telefone, texto.trim(), { pausar: false })
        if (extra) await enviarWhatsApp(contato.telefone, extra, { pausar: false })
        avisar({ msg: extra ? 'Enviado pela Guaxí, com o Pix copia e cola' : 'Enviado pelo WhatsApp da Guaxí' })
      }
      catch (e) { avisar({ msg: 'Erro: ' + e.message }) }
      finally { setEnviando(false) }
      return
    }
    const link = waLink(p.contato, texto.trim())
    if (!link) { avisar({ msg: 'Esse pedido não tem telefone' }); return }
    window.open(link, '_blank')
    // No seu WhatsApp vai uma mensagem por vez: já deixa o código Pix pronto pra mandar em seguida
    if (extra) { setModelo('pix'); avisar({ msg: 'Agora toque de novo pra mandar só o código Pix' }) }
  }

  const proximosDias = Array.from({ length: 8 }, (_, i) => { const d = hoje0(); d.setDate(d.getDate() + i); return d })
  const agrupados = agruparItens(p.itens)
  const criado = p.createdAtTs ? new Date(p.createdAtTs) : null

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 15, fontWeight: 600, padding: '6px 4px' }}>
            <IconeVoltar /> Pedidos
          </button>
          <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-secondary)' }}>{p.id}</span>
        </div>
      </div>

      <div className="page-inner pd" style={{ paddingTop: 16 }}>
        <section aria-label="Cliente e andamento" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 style={{ margin: 0, flex: 1, minWidth: 0, fontSize: 22, fontWeight: 800 }}>{p.cliente}</h1>
            <span className="pd-chip">{canalNome(p.canal)}</span>
          </div>
          {criado && <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>Feito {SEM[criado.getDay()]} {ddmm(criado)} às {criado.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>}
          {alertasDe(p).length > 0 && <div style={{ fontSize: 13, fontWeight: 700, color: AMBAR }}>{alertasDe(p).join(' · ')}</div>}
          {aguardandoPix(p) && (
            <div className="pd-janela fechada" role="status">
              <i style={{ background: '#8a8a8a' }} />
              <span><b style={{ color: 'var(--text-primary)' }}>Aguardando o Pix do cliente.</b> Quando cair, o pedido se confirma sozinho. Se não pagar até {horaDe(p.aguardaPixAte)}, ele é cancelado e o estoque volta.</span>
            </div>
          )}
          {p.status === 'Cancelado' ? (
            <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Pedido cancelado.</div>
          ) : (
            <ol className="pd-passos" aria-label="Andamento">
              {passos.map((s, i) => (
                <li key={s} style={{ display: 'contents' }}>
                  {i > 0 && <span className="pd-passos-traco" aria-hidden="true" style={{ flex: 1, height: 2, background: i <= idx ? 'var(--teal)' : '#2a2a2a' }} />}
                  <span className={`passo${i <= idx ? ' feito' : ''}`} style={{ listStyle: 'none' }}>
                    <button type="button" disabled={ocupado || i === idx} onClick={() => onAcao(p, s === 'Pendente' ? 'reabrir' : s === 'Pronto' ? 'pronto' : 'entregue')}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: '6px 0', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', color: i <= idx ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                      <i style={{ width: 10, height: 10, borderRadius: '50%', boxSizing: 'border-box', background: i <= idx ? 'var(--teal)' : 'transparent', border: i <= idx ? 'none' : '2px solid #4a4a4a' }} />
                      {s === 'Pendente' ? 'A fazer' : s}
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {prox && !aguardandoPix(p) && (
            <button className={`pd-grande${prox.key === 'reabrir' ? ' neutro' : ''}`} disabled={ocupado}
              onClick={async () => { setOcupado(true); try { await onAcao(p, prox.key) } finally { setOcupado(false) } }}>{prox.longo}</button>
          )}
        </section>

        <div className="pd-det">
          <div className="pd-col">
            <section className="pd-bloco" aria-label="Itens">
              <div className="pd-bloco-topo">
                <h2>Itens</h2>
                {!editItens && <button className="pd-link" onClick={abrirEdicao}>Editar</button>}
              </div>
              {!editItens ? (
                <>
                  {agrupados.map((it, i) => (
                    <div key={it.id || i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div className="pd-kv" style={{ fontSize: 14 }}>
                        <span style={{ color: 'var(--text-primary)' }}>{fmtQ(it.quantidade)}× {it.produto}</span>
                        <span>{fmtR((Number(it.precoUnit) || 0) * (Number(it.quantidade) || 0))}</span>
                      </div>
                      {it.subs.length > 0 && <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{nomesSubs(it.subs)}</div>}
                    </div>
                  ))}
                  <div style={{ height: 1, background: 'var(--border-light-color)' }} />
                  {entrega && <div className="pd-kv" style={{ fontSize: 13 }}><span>Frete</span><span>{fmtR(p.frete)}</span></div>}
                  <div className="pd-kv" style={{ fontSize: 16, fontWeight: 800 }}><span style={{ color: 'var(--text-primary)' }}>Total</span><span>{fmtR(p.valor)}</span></div>
                </>
              ) : (
                <>
                  {itensEd.map((it, i) => (
                    <div key={it.id || i} className="pd-item-ed">
                      <span style={{ flex: 1, minWidth: 0 }}>{it.produto}</span>
                      <input inputMode="decimal" aria-label={`Quantidade de ${it.produto}`} value={it.quantidade}
                        onChange={e => setItensEd(l => l.map((x, k) => k === i ? { ...x, quantidade: e.target.value } : x))} />
                      <span style={{ color: 'var(--text-tertiary)' }}>× R$</span>
                      <input inputMode="decimal" style={{ width: 70 }} aria-label={`Preço de ${it.produto}`} value={it.precoUnit}
                        onChange={e => setItensEd(l => l.map((x, k) => k === i ? { ...x, precoUnit: e.target.value } : x))} />
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="pd-btn vazado" style={{ flex: 1 }} onClick={() => setEditItens(false)}>Cancelar</button>
                    <button className="pd-btn verde" style={{ flex: 1 }} disabled={ocupado} onClick={salvarItens}>Salvar itens</button>
                  </div>
                </>
              )}
            </section>

            <section className="pd-bloco" aria-label="Entrega">
              <div className="pd-bloco-topo">
                <h2>{entrega ? 'Entrega' : 'Retirada'}{p.dataEntrega ? ` · ${diaCurto(p.dataEntrega)}` : ' · sem data'}</h2>
                <button className="pd-link" onClick={() => setMudarDia(v => !v)}>{mudarDia ? 'Fechar' : 'Mudar dia'}</button>
              </div>
              {mudarDia && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="pd-msgs">
                    {proximosDias.map(d => {
                      const iso = isoLocal(d)
                      return <button key={iso} className={p.dataEntrega === iso ? 'on' : ''} onClick={() => { salvarCampos({ data_entrega: iso }, `Dia: ${diaCurto(iso)}`); setMudarDia(false) }}>{diaCurto(iso)}</button>
                    })}
                  </div>
                  <input type="date" className="pd-input" style={{ colorScheme: 'dark' }} value={p.dataEntrega || ''}
                    onChange={e => { if (e.target.value) { salvarCampos({ data_entrega: e.target.value }, `Dia: ${diaCurto(e.target.value)}`); setMudarDia(false) } }} />
                </div>
              )}
              <div className="pd-seg" role="group" aria-label="Tipo">
                {['Entrega', 'Retirada'].map(t => (
                  <button key={t} className={p.tipoEntrega === t || (!p.tipoEntrega && t === 'Retirada') ? 'on' : ''} disabled={ocupado} onClick={() => p.tipoEntrega !== t && mudarTipo(t)}>{t}</button>
                ))}
              </div>
              <div className="pd-seg" role="group" aria-label="Período">
                {PERIODOS.map(per => (
                  <button key={per.v} className={p.periodo === per.v ? 'on' : ''} disabled={ocupado}
                    onClick={() => salvarCampos({ periodo: p.periodo === per.v ? null : per.v }, p.periodo === per.v ? 'Período a combinar' : `Período: ${per.nome.toLowerCase()}`)}>
                    {per.nome}<small>{per.faixa}</small>
                  </button>
                ))}
              </div>
              {!p.periodo && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Período a combinar com o cliente</div>}
              {entrega && (
                <>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Endereço</span>
                    <textarea className="pd-input" rows={2} style={{ resize: 'none' }} value={endereco}
                      placeholder="Rua, número, complemento, bairro" onChange={e => setEndereco(e.target.value)} onBlur={salvarEndereco} />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ flex: 1, fontSize: 13, color: 'var(--text-secondary)' }}>Frete cobrado (R$)</span>
                    <input className="pd-input" style={{ width: 100, textAlign: 'right' }} inputMode="decimal" value={frete}
                      onChange={e => setFrete(e.target.value)} onBlur={salvarFrete} />
                  </label>
                  {p.envio ? (
                    <button onClick={() => (p.envio.shareLink && EM_ROTA.includes(p.envio.status) ? window.open(p.envio.shareLink, '_blank') : navigate('/envios'))}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, background: '#262626', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left' }}>
                      <span style={{ flex: 1 }}>
                        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700 }}>Envio {p.envio.periodo ? `· ${periodoDe(p.envio.periodo)?.nome.toLowerCase()}` : ''}</span>
                        <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{ENVIO_STATUS[p.envio.status] || p.envio.status}</span>
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#34d39a' }}>{p.envio.shareLink && EM_ROTA.includes(p.envio.status) ? 'Rastrear' : 'Ver envio'}</span>
                    </button>
                  ) : aberto(p) && (
                    <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>Ainda sem envio — vai pra fila em Envios.</div>
                  )}
                </>
              )}
            </section>
          </div>

          <div className="pd-col">
            {p.status !== 'Cancelado' && (
              <section className="pd-bloco" aria-label="Pagamento">
                <div className="pd-bloco-topo"><h2>Pagamento</h2></div>
                <div className="pd-seg" role="group" aria-label="Situação do pagamento">
                  <button className={p.pgto !== 'Pago' ? 'on' : ''} disabled={ocupado} onClick={() => p.pgto === 'Pago' && salvarPgto('Aguardando')}>A receber</button>
                  <button className={p.pgto === 'Pago' ? 'on' : ''} disabled={ocupado} onClick={() => p.pgto !== 'Pago' && salvarPgto('Pago')}>Pago</button>
                </div>
                {p.pgto === 'Pago' && p.pixPagoEm && (
                  <div style={{ fontSize: 13, color: '#34d39a', fontWeight: 700 }}>Pago no Pix (Mercado Pago) às {horaDe(p.pixPagoEm)} ✓</div>
                )}
                {p.pgto !== 'Pago' && (
                  <>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--text-secondary)' }}>Sinal recebido (R$)</span>
                      <input className="pd-input" style={{ width: 100, textAlign: 'right' }} inputMode="decimal" placeholder="0,00" value={sinal}
                        onChange={e => setSinal(e.target.value)} onBlur={salvarSinal} />
                    </label>
                    <div className="pd-kv" style={{ fontWeight: 700 }}><span style={{ color: 'var(--text-primary)' }}>Falta</span><span style={{ color: faltaPagar(p) > 0 && alertasDe(p).some(a => a.includes('pag')) ? AMBAR : 'var(--text-primary)' }}>{fmtR(faltaPagar(p))}</span></div>
                  </>
                )}
              </section>
            )}

            <section className="pd-bloco" aria-label="Mensagens">
              <div className="pd-bloco-topo">
                <h2>Mensagens</h2>
                {contato && <button className="pd-link" onClick={() => navigate(`/atendimento?c=${encodeURIComponent(contato.telefone)}`)}>Abrir conversa</button>}
              </div>
              <div className={`pd-janela ${janela ? 'aberta' : 'fechada'}`}>
                <i style={{ background: janela ? 'var(--teal)' : '#6b6b6b' }} />
                <span>{janela
                  ? <>Conversa aberta até <b>{ateTxt}</b> · vai pelo número da Guaxí</>
                  : <>Conversa fechada · abre o seu WhatsApp com o texto pronto</>}</span>
              </div>
              <div className="pd-msgs" role="group" aria-label="Mensagens prontas">
                {modelos.map(m => <button key={m.key} className={modelo === m.key ? 'on' : ''} onClick={() => setModelo(m.key)}>{m.label}</button>)}
              </div>
              {!pix && modelos.find(m => m.key === modelo)?.texto.includes('Pix') && (
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Dica: cadastre sua chave Pix em Configurações › Delivery e ela entra sozinha aqui.</div>
              )}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Mensagem</span>
                <textarea className="pd-input" rows={5} style={{ resize: 'vertical', lineHeight: 1.45 }} value={texto} onChange={e => setTexto(e.target.value)} />
              </label>
              <button className="pd-grande" disabled={enviando || !texto.trim() || (!janela && !p.contato)} onClick={enviarMsg}>
                {enviando ? 'Enviando…' : janela ? 'Enviar pela Guaxí' : 'Abrir no meu WhatsApp'}
              </button>
              {entrega && p.status !== 'Cancelado' && (
                <>
                  <div style={{ height: 1, background: 'var(--border-light-color)' }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700 }}>Rastreio automático</div>
                      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                        {p.rastreioEnviadoEm
                          ? `Link enviado ${new Date(p.rastreioEnviadoEm).toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}.`
                          : 'Quando o motorista sair daqui com o pedido, o cliente recebe o link da Lalamove.'}
                      </div>
                    </div>
                    <button className={`pd-switch${p.rastreioAuto ? ' on' : ''}`} role="switch" aria-checked={p.rastreioAuto} aria-label="Rastreio automático"
                      disabled={ocupado} onClick={() => salvarCampos({ rastreio_auto: !p.rastreioAuto }, p.rastreioAuto ? 'Rastreio automático desligado' : 'Rastreio automático ligado')}><span /></button>
                  </div>
                </>
              )}
            </section>

            <section className="pd-bloco" aria-label="Contato e observações">
              <div className="pd-kv"><span>WhatsApp</span><span>{p.contato || '—'}</span></div>
              {p.obs && <div className="pd-kv"><span>Observações</span><span style={{ textAlign: 'right', whiteSpace: 'pre-line' }}>{p.obs}</span></div>}
            </section>

            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
              {p.status !== 'Cancelado' && <button className="pd-btn perigo" onClick={() => onAcao(p, 'cancelar')}>Cancelar pedido</button>}
              {!apagar
                ? <button className="pd-btn perigo" onClick={() => setApagar(true)}>Apagar</button>
                : <button className="pd-btn perigo-cheio"
                    onClick={() => salvar(async () => { await deletePedido(p.id); onBack() }, 'Pedido apagado')}>Confirmar: apagar {p.id}</button>}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Novo pedido (página) ──────────────────────────────────────────────────────
function NovoView({ produtos, clientes, pedidos, onBack, onSaved }) {
  const { toast, show } = useToast()
  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--teal)', fontSize: 15, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
            ← voltar
          </button>
          <div className="topbar-title">Novo pedido</div>
        </div>
      </div>
      <div className="page-inner" style={{ paddingTop: 16, paddingBottom: 0, maxWidth: 640 }}>
        <NovoPedidoForm variante="pagina" produtos={produtos} clientes={clientes} encomendas={pedidos}
          show={show} onSaved={onSaved} onClose={onBack} />
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}

// ── NovoPedidoSheet — usado no Início ─────────────────────────────────────────
export function NovoPedidoSheet({ onClose, onSaved, modoInicial, titulo = 'Novo pedido' }) {
  const { toast, show }   = useToast()
  const { data: produtos } = useData(getProdutos)
  const { data: clientes } = useData(getClientes)
  const { data: encomendas } = useData(getEncomendas)
  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div className="sheet np-folha">
        <div className="sheet-title">
          <span>{titulo}</span>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 24, cursor: 'pointer', padding: '0 4px' }} onClick={onClose} aria-label="Fechar">×</button>
        </div>
        <NovoPedidoForm variante="sheet" produtos={produtos} clientes={clientes} encomendas={encomendas}
          show={show} onSaved={onSaved} onClose={onClose} modoInicial={modoInicial} />
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}

// ── Página ────────────────────────────────────────────────────────────────────
const FILTROS = [
  { key: 'proximos', label: 'Próximos' },
  { key: 'receber', label: 'A receber' },
  { key: 'entregues', label: 'Entregues' },
  { key: 'todos', label: 'Todos' },
]

export default function Pedidos() {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const { data: pedidos, loading: loadingPed, reload: reloadPedidos } = useData(getEncomendas)
  const { data: produtos, reload: reloadProdutos } = useData(getProdutos)
  const { data: clientes, reload: reloadClientes } = useData(getClientes)
  const { data: contatos, reload: reloadContatos } = useData(getContatosAtendimento)
  const [modo, setModo] = useState('lista')             // lista | novo | { id, msg }
  const [filtro, setFiltro] = useState(() => { try { return localStorage.getItem('pedidos_filtro2') || 'proximos' } catch { return 'proximos' } })
  const [busca, setBusca] = useState('')
  const [aviso, setAviso] = useState(null)
  const [pix, setPix] = useState('')
  const rolagem = useRef(0)

  useEffect(() => { reconciliarBaixasPedidos().then(n => { if (n) reloadProdutos() }).catch(() => {}) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadUserConfig().then(c => setPix(c?.delivery?.pix || '')).catch(() => {}) }, [])
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 6000); return () => clearTimeout(t) }, [aviso])
  useEffect(() => { try { localStorage.setItem('pedidos_filtro2', filtro) } catch { /* sem storage */ } }, [filtro])

  // Vindo do Início / Atendimento / Envios
  const tratou = useRef(false)
  useEffect(() => {
    if (tratou.current) return
    if (location.state?.openNew) { tratou.current = true; setModo('novo'); navigate(location.pathname, { replace: true, state: null }); return }
    if (location.state?.openPedidoId && pedidos) {
      tratou.current = true
      setModo({ id: location.state.openPedidoId })
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [pedidos]) // eslint-disable-line react-hooks/exhaustive-deps

  const recarregar = () => Promise.all([reloadPedidos(), reloadContatos()])

  // Pedido mudou em outro lugar (Pix caiu, cancelou sozinho, pedido novo): atualiza na hora
  usePedidoMudou(d => {
    reloadPedidos()
    if (d?.pgto === 'Pago' && d.pix_pago_em && Date.now() - new Date(d.pix_pago_em).getTime() < 3 * 60e3) {
      setAviso({ msg: `💸 ${d.id} pagou no Pix${d.cliente ? ` (${String(d.cliente).split(' ')[0]})` : ''}` })
    } else if (d?.status === 'Cancelado' && String(d.obs || '').startsWith('⌛')) {
      setAviso({ msg: `⌛ ${d.id} cancelado: o Pix não foi pago` })
    }
  })

  async function mudarStatus(p, novo) {
    const antes = { status: p.status, pgto: p.pgto }
    const pgto = novo === 'Entregue' && p.pgto !== 'Pago' ? 'Atrasado' : (p.status === 'Entregue' && p.pgto === 'Atrasado' ? 'Aguardando' : p.pgto)
    await updateStatusEncomenda(p.id, novo, pgto, p.tipoEntrega, p.frete, p.valor)
    if (novo === 'Entregue' || p.status === 'Entregue') await reconciliarBaixasPedidos().catch(() => {})
    await recarregar()
    const nomes = { Pendente: 'a fazer', Pronto: 'pronto', Entregue: 'entregue', Cancelado: 'cancelado' }
    setAviso({
      msg: `${primeiroNome(p) || p.id}: ${nomes[novo]}`,
      undo: async () => {
        await updateStatusEncomenda(p.id, antes.status, antes.pgto, p.tipoEntrega, p.frete, p.valor)
        await reconciliarBaixasPedidos().catch(() => {})
        await recarregar(); setAviso({ msg: 'Desfeito' })
      },
    })
  }

  async function cobrar(p) {
    const falta = faltaPagar(p)
    const texto = `Oi${primeiroNome(p) ? `, ${primeiroNome(p)}` : ''}! Passando pra lembrar do pagamento do pedido ${p.id} (${fmtR(falta)}).${pix ? ` Chave Pix: ${pix}` : ' Posso te mandar o Pix?'}`
    const contato = acharContato(contatos || [], p.contato)
    if (janelaAberta(contato)) {
      if (!window.confirm(`Mandar pelo WhatsApp da Guaxí?\n\n${texto}`)) return
      await enviarWhatsApp(contato.telefone, texto, { pausar: false })
      setAviso({ msg: 'Cobrança enviada pelo WhatsApp da Guaxí' })
      return
    }
    const link = waLink(p.contato, texto)
    if (link) window.open(link, '_blank')
    else setModo({ id: p.id, msg: 'cobrar' })
  }

  async function acao(p, key) {
    try {
      if (key === 'pronto') return await mudarStatus(p, 'Pronto')
      if (key === 'entregue') return await mudarStatus(p, 'Entregue')
      if (key === 'reabrir') return await mudarStatus(p, 'Pendente')
      if (key === 'cancelar') { if (window.confirm(`Cancelar o pedido ${p.id}?`)) await mudarStatus(p, 'Cancelado'); return }
      if (key === 'recebi') {
        const antes = p.pgto
        await updateStatusEncomenda(p.id, p.status, 'Pago', p.tipoEntrega, p.frete, p.valor)
        await recarregar()
        setAviso({ msg: `${primeiroNome(p) || p.id}: pago`, undo: async () => { await updateStatusEncomenda(p.id, p.status, antes, p.tipoEntrega, p.frete, p.valor); await recarregar(); setAviso({ msg: 'Desfeito' }) } })
        return
      }
      // esperando o Pix: abre o pedido com o lembrete e o código do Mercado Pago
      if (key === 'cobrar' && aguardandoPix(p)) { rolagem.current = rolador().scrollTop; setModo({ id: p.id, msg: 'cobrar' }); return }
      if (key === 'cobrar') return await cobrar(p)
      if (key === 'rastreio') { window.open(p.envio.shareLink, '_blank'); return }
      if (key === 'envios') { navigate('/envios'); return }
      if (key === 'combinar') { rolagem.current = rolador().scrollTop; setModo({ id: p.id, msg: 'periodo' }); return }
    } catch (e) { setAviso({ msg: 'Erro: ' + e.message }) }
  }

  // ── Lista filtrada e agrupada ──
  // Pedidos do cardápio esperando o Pix ficam num grupo à parte, fora das contas
  const confirmados = useMemo(() => (pedidos || []).filter(p => !aguardandoPix(p)), [pedidos])
  const resumo = useMemo(() => {
    const ab = confirmados.filter(aberto)
    return {
      hoje: ab.filter(p => p.dataEntrega && diasAte(p.dataEntrega) <= 0).length,
      semana: ab.filter(p => p.dataEntrega && diasAte(p.dataEntrega) >= 0 && diasAte(p.dataEntrega) <= 7).length,
      receber: confirmados.reduce((s, p) => s + faltaPagar(p), 0),
    }
  }, [confirmados])

  const grupos = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const dig = q.replace(/\D/g, '')
    let lista = confirmados.filter(p => {
      if (filtro === 'proximos') return aberto(p)
      if (filtro === 'receber') return faltaPagar(p) > 0
      if (filtro === 'entregues') return p.status === 'Entregue'
      return true
    })
    if (q) lista = lista.filter(p => (p.cliente || '').toLowerCase().includes(q) || (p.id || '').toLowerCase().includes(q) || (dig.length >= 3 && String(p.contato || '').replace(/\D/g, '').includes(dig)))
    const desc = filtro === 'entregues' || filtro === 'todos'
    const chaveData = p => p.dataEntrega || (desc ? '0000' : '9999')
    lista.sort((a, b) => (desc ? chaveData(b).localeCompare(chaveData(a)) : chaveData(a).localeCompare(chaveData(b)))
      || ((ORDEM_PERIODO[a.periodo] ?? 3) - (ORDEM_PERIODO[b.periodo] ?? 3))
      || String(a.createdAtTs || '').localeCompare(String(b.createdAtTs || '')))
    const porDia = new Map()
    for (const p of lista) {
      const k = p.dataEntrega || 'sem-data'
      if (!porDia.has(k)) porDia.set(k, [])
      porDia.get(k).push(p)
    }
    return [...porDia.entries()].map(([k, ps]) => {
      const subsMap = new Map()
      for (const p of ps) {
        const sk = p.periodo || 'nenhum'
        if (!subsMap.has(sk)) subsMap.set(sk, [])
        subsMap.get(sk).push(p)
      }
      const entregas = ps.filter(p => p.tipoEntrega === 'Entrega').length
      const subs = [...subsMap.entries()].map(([sk, sps]) => {
        const per = periodoDe(sk)
        const envio = sps.find(p => p.envio && p.status !== 'Entregue')?.envio || null
        const paradas = envio ? (pedidos || []).filter(p => p.envio?.id === envio.id).length : 0
        return { key: sk, titulo: per ? `${per.nome} · ${per.faixa}` : 'Período a combinar', pedidos: sps, envio, paradas }
      })
      const atrasado = k !== 'sem-data' && filtro === 'proximos' && diasAte(k) < 0
      return {
        key: k, titulo: tituloDia(k === 'sem-data' ? null : k, filtro !== 'proximos'), atrasado,
        meta: `${ps.length} ${ps.length === 1 ? 'pedido' : 'pedidos'}${entregas ? ` · ${entregas} ${entregas === 1 ? 'entrega' : 'entregas'}` : ''}`,
        subs, mostrarSubs: subs.length > 1 || subs.some(s => s.key !== 'nenhum'),
      }
    })
  }, [pedidos, confirmados, filtro, busca])

  const esperandoPix = useMemo(() => {
    if (filtro !== 'proximos' && filtro !== 'todos') return []
    const q = busca.trim().toLowerCase()
    return (pedidos || []).filter(aguardandoPix)
      .filter(p => !q || (p.cliente || '').toLowerCase().includes(q) || (p.id || '').toLowerCase().includes(q))
      .sort((a, b) => String(a.aguardaPixAte).localeCompare(String(b.aguardaPixAte)))
  }, [pedidos, filtro, busca])

  const contagem = useMemo(() => ({
    proximos: confirmados.filter(aberto).length,
    receber: confirmados.filter(p => faltaPagar(p) > 0).length,
  }), [confirmados])

  if (loadingPed && !pedidos) return <div className="loading">Carregando...</div>

  if (modo === 'novo') {
    return <NovoView produtos={produtos || []} clientes={clientes || []} pedidos={pedidos || []} onBack={() => setModo('lista')} onSaved={() => { reloadPedidos(); reloadClientes() }} />
  }
  if (modo && modo.id) {
    const p = (pedidos || []).find(x => x.id === modo.id)
    if (p) {
      return (
        <>
          <DetalhePedido key={p.id} p={p} pix={pix} contatos={contatos || []} msgInicial={modo.msg}
            onBack={() => { setModo('lista'); setTimeout(() => rolador().scrollTo(0, rolagem.current), 0) }}
            onAcao={acao} recarregar={recarregar} avisar={setAviso} />
          <Aviso aviso={aviso} fechar={() => setAviso(null)} />
        </>
      )
    }
  }

  const linkCardapio = user?.id ? `${window.location.origin}/pedido/${user.id}` : null

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => navigate(-1)} aria-label="Voltar" style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', padding: '0 4px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <IconeVoltar />
            </button>
            <div className="topbar-title">Pedidos</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {linkCardapio && (
              <button className="pd-btn vazado" onClick={() => navigator.clipboard.writeText(linkCardapio).then(() => setAviso({ msg: 'Link do cardápio copiado' }))}>Link do cardápio</button>
            )}
            <button className="pd-btn verde" onClick={() => setModo('novo')}>+ Novo</button>
          </div>
        </div>
      </div>

      <div className="page-inner pd" style={{ paddingTop: 14 }}>
        <section className="pd-resumo" aria-label="Resumo">
          <div className="pd-tile"><b>{resumo.hoje}</b><span>pra hoje</span></div>
          <div className="pd-tile"><b>{resumo.semana}</b><span>próximos 7 dias</span></div>
          <div className="pd-tile"><b>{fmtR(resumo.receber).replace(/,00$/, '')}</b><span>a receber</span></div>
        </section>

        <label className="pd-busca">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="#8a8a8a" strokeWidth="2" /><path d="M20 20l-3.5-3.5" stroke="#8a8a8a" strokeWidth="2" strokeLinecap="round" /></svg>
          <input type="search" placeholder="Buscar cliente, pedido ou telefone" value={busca} onChange={e => setBusca(e.target.value)} aria-label="Buscar pedidos" />
        </label>

        <nav className="pd-seg" aria-label="Filtro">
          {FILTROS.map(f => (
            <button key={f.key} className={filtro === f.key ? 'on' : ''} onClick={() => setFiltro(f.key)}>
              {f.label}{contagem[f.key] ? ` (${contagem[f.key]})` : ''}
            </button>
          ))}
        </nav>

        {esperandoPix.length > 0 && (
          <section className="pd-dia" aria-label="Aguardando Pix">
            <div className="pd-dia-topo">
              <h2>Aguardando Pix</h2>
              <span>{esperandoPix.length === 1 ? '1 pedido do cardápio · confirma sozinho quando o Pix cai' : `${esperandoPix.length} pedidos do cardápio · confirmam sozinhos quando o Pix cai`}</span>
            </div>
            <div className="pd-grade">
              {esperandoPix.map(p => (
                <CardPedido key={p.id} p={p} onAcao={acao}
                  onAbrir={() => { rolagem.current = rolador().scrollTop; setModo({ id: p.id }) }} />
              ))}
            </div>
          </section>
        )}

        {grupos.length === 0 && !esperandoPix.length && (
          <div className="pd-vazio">
            {busca ? 'Nenhum pedido encontrado.' : filtro === 'proximos' ? 'Nenhum pedido em aberto. ' : 'Nada por aqui.'}
            {filtro === 'proximos' && !busca && <button className="pd-link" onClick={() => setModo('novo')}>Criar pedido</button>}
          </div>
        )}

        {grupos.map(g => (
          <section key={g.key} className="pd-dia" aria-label={g.titulo}>
            <div className="pd-dia-topo">
              <h2 style={{ color: g.atrasado ? AMBAR : undefined }}>{g.titulo}</h2>
              <span>{g.meta}</span>
            </div>
            {g.subs.map(s => (
              <div key={s.key} className="pd-sub">
                {g.mostrarSubs && (
                  <div className="pd-sub-topo">
                    <span>{s.titulo}</span>
                    {s.envio && <button className="pd-link" onClick={() => navigate('/envios')}>Envio {ENVIO_STATUS[s.envio.status] || ''}{s.paradas > 1 ? ` · ${s.paradas} paradas` : ''}</button>}
                  </div>
                )}
                <div className="pd-grade">
                  {s.pedidos.map(p => (
                    <CardPedido key={p.id} p={p} onAcao={acao}
                      onAbrir={() => { rolagem.current = rolador().scrollTop; setModo({ id: p.id }) }} />
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
      <Aviso aviso={aviso} fechar={() => setAviso(null)} />
    </>
  )
}
