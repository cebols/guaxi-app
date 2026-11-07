import { useState, useMemo, useEffect } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { useAuth } from '../contexts/AuthContext'
import { getConfig, getCustoSacolaDelivery } from '../hooks/useConfig'
import { usePedidoMudou } from '../hooks/useRealtimePedidos'
import {
  getProdutos, getVendas, deleteVenda, getEncomendas, getEmbalagens,
  getContatosAtendimento, acharContato, janelaAberta, enviarWhatsApp,
} from '../services/db'
import { criarTransacoes, resumoFinanceiro, ymd } from '../lib/financeiro'
import {
  janela, somar, variacao, porDia, porCanal, momentos, horarios, HORAS, clientes as calcClientes, sumidos as calcSumidos,
  produtosStats, matriz, previsao, csvHistorico, corCanal, CANAIS, DIAS_SEMANA, DIAS_CURTO, diaCurto,
} from '../lib/vendas'
import { NovoPedidoSheet } from './Pedidos'

// ── Vendas ───────────────────────────────────────────────────────────────────
// Resumo (período × anterior, por dia, canais, quando mais vende, avisos) ·
// Produtos (o que cada doce faz pelo caixa + previsão de produção) · Clientes
// (novos, sumidos, quem mais compra) · Histórico (busca, filtro, planilha).
// Os números vêm de lib/financeiro: os mesmos de Configurações › Financeiro.

const ABAS = [
  { key: 'resumo', nome: 'Resumo' }, { key: 'produtos', nome: 'Produtos' },
  { key: 'clientes', nome: 'Clientes' }, { key: 'historico', nome: 'Histórico' },
]
const fmtR = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtR0 = (v) => `R$ ${Math.round(Number(v) || 0).toLocaleString('pt-BR')}`
const pct = (x) => `${Math.round((x || 0) * 100)}%`
const primeiroNome = (n) => String(n || '').trim().split(/\s+/)[0]
const soDig = (s) => String(s || '').replace(/\D/g, '')
const waLink = (tel, texto) => { const d = soDig(tel); return d.length >= 10 ? `https://wa.me/${d.startsWith('55') && d.length > 11 ? d : `55${d}`}?text=${encodeURIComponent(texto)}` : null }
const mais = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }

function Delta({ v, nome }) {
  if (v == null) return <span className="vd-delta igual">novo vs {nome}</span>
  if (Math.abs(v) < 0.005) return <span className="vd-delta igual">= {nome}</span>
  return <span className={`vd-delta ${v > 0 ? 'sobe' : 'desce'}`}>{v > 0 ? '▲' : '▼'} {Math.round(Math.abs(v) * 100)}% vs {nome}</span>
}

export default function Vendas() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const aba = ABAS.some(a => a.key === params.get('aba')) ? params.get('aba') : 'resumo'
  const irPara = (key) => setParams(key === 'resumo' ? {} : { aba: key }, { replace: true })
  const { toast, show } = useToast()
  const [balcao, setBalcao] = useState(() => !!location.state?.openLancamento)

  const { data: produtos } = useData(getProdutos)
  const { data: vendas, reload: rVend } = useData(getVendas)
  const { data: encomendas, reload: rEnc } = useData(getEncomendas)
  const { data: embalagens } = useData(getEmbalagens)
  const { data: contatos } = useData(getContatosAtendimento)
  usePedidoMudou(() => rEnc())
  useEffect(() => { if (location.state?.openLancamento) navigate(location.pathname + location.search, { replace: true, state: null }) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const cfg = getConfig()
  const custoSacola = getCustoSacolaDelivery(cfg, embalagens || [])
  const pronto = encomendas && vendas && produtos
  const trans = useMemo(() => pronto ? criarTransacoes({ encomendas, vendas, produtos, cfg, custoSacola }) : [], [pronto, encomendas, vendas, produtos, custoSacola]) // eslint-disable-line react-hooks/exhaustive-deps
  const fin = useMemo(() => pronto ? resumoFinanceiro({ cfg, transacoes: trans, metaLucro: cfg.metaLucro }) : null, [pronto, trans]) // eslint-disable-line react-hooks/exhaustive-deps
  const listaClientes = useMemo(() => calcClientes(trans), [trans])
  const sumidos = useMemo(() => calcSumidos(listaClientes), [listaClientes])
  const linkCardapio = user?.id ? `${window.location.origin}/pedido/${user.id}` : ''

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div className="topbar-title">Vendas</div>
          <button className="pd-btn verde" onClick={() => setBalcao(true)}>+ Venda de balcão</button>
        </div>
      </div>

      <div className="page-inner vd" style={{ paddingTop: 14 }}>
        <nav className="pd-seg cf-abas" aria-label="Seções">
          {ABAS.map(a => <button key={a.key} className={aba === a.key ? 'on' : ''} aria-current={aba === a.key ? 'page' : undefined} onClick={() => irPara(a.key)}>{a.nome}</button>)}
        </nav>

        {!pronto ? <div className="pd-vazio">Carregando…</div> : (
          <>
            {aba === 'resumo' && <AbaResumo trans={trans} fin={fin} cfg={cfg} sumidos={sumidos} irPara={irPara} navigate={navigate} />}
            {aba === 'produtos' && <AbaProdutos trans={trans} encomendas={encomendas} produtos={produtos} cfg={cfg} navigate={navigate} />}
            {aba === 'clientes' && <AbaClientes lista={listaClientes} sumidos={sumidos} contatos={contatos || []} linkCardapio={linkCardapio} navigate={navigate} show={show} />}
            {aba === 'historico' && <AbaHistorico trans={trans} navigate={navigate} show={show} aoApagar={rVend} />}
          </>
        )}
      </div>

      {balcao && <NovoPedidoSheet modoInicial="feita" titulo="Venda de balcão" onClose={() => setBalcao(false)} onSaved={() => { rEnc(); show('Venda registrada') }} />}
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}

// ── Resumo ───────────────────────────────────────────────────────────────────
const PERIODOS = [{ key: 'hoje', nome: 'Hoje' }, { key: 'semana', nome: 'Semana' }, { key: 'mes', nome: 'Mês' }, { key: 'custom', nome: 'Período…' }]

function AbaResumo({ trans, fin, cfg, sumidos, irPara, navigate }) {
  const [periodo, setPeriodo] = useState(() => { try { return localStorage.getItem('vendas_periodo') || 'mes' } catch { return 'mes' } })
  const hojeS = ymd(new Date())
  const [custom, setCustom] = useState({ de: mais(hojeS, -29), ate: hojeS })
  const [sel, setSel] = useState(null)       // dia tocado no gráfico
  const [celSel, setCelSel] = useState(null) // célula tocada no mapa
  const [modoMapa, setModoMapa] = useState(() => { try { return localStorage.getItem('vendas_mapa') || 'periodos' } catch { return 'periodos' } })
  useEffect(() => { try { localStorage.setItem('vendas_mapa', modoMapa) } catch { /* sem storage */ } setCelSel(null) }, [modoMapa])
  useEffect(() => { try { localStorage.setItem('vendas_periodo', periodo) } catch { /* sem storage */ } }, [periodo])
  useEffect(() => setSel(null), [periodo, custom.de, custom.ate])

  const j = janela(periodo, new Date(), custom)
  const tot = somar(trans, j.de, j.ate)
  const ateHoje = somar(trans, j.de, j.ateComparar < j.ate ? j.ateComparar : j.ate)
  const ant = somar(trans, j.ant.de, j.ant.ate)
  const marcados = tot.receita - ateHoje.receita
  const desloc = periodo === 'mes'
    ? (d) => { const x = new Date(d + 'T12:00:00'); const m = x.getMonth(); x.setMonth(m - 1); if (x.getMonth() === m) x.setDate(0); return ymd(x) }
    : periodo === 'custom' ? (d) => mais(d, -(Math.round((new Date(j.ate) - new Date(j.de)) / 864e5) + 1)) : (d) => mais(d, -7)
  const dias = j.grafico ? porDia(trans, j.grafico, desloc) : null
  const maxDia = dias ? Math.max(1, ...dias.map(d => Math.max(d.receita, d.data <= hojeS ? d.ref : 0))) : 1
  const canais = porCanal(trans, j.de, j.ate)
  const mom = momentos(trans, mais(hojeS, -89), hojeS)
  const hrs = horarios(trans, mais(hojeS, -89), hojeS)
  const lucroMes = fin.mes.contribuicao - fin.fixos

  // Avisos automáticos
  const avisos = []
  const vVar = variacao(ateHoje.receita, ant.receita)
  if (vVar != null && ant.receita > 0 && Math.abs(vVar) >= 0.15) {
    avisos.push(vVar < 0
      ? { tipo: 'atencao', icone: '↓', texto: `As vendas estão ${Math.round(-vVar * 100)}% abaixo de ${j.nomeAnt}.`, acao: 'Ver clientes sumidos', fazer: () => irPara('clientes') }
      : { tipo: 'bom', icone: '↑', texto: `As vendas estão ${Math.round(vVar * 100)}% acima de ${j.nomeAnt}.` })
  }
  if (sumidos.length) avisos.push({ tipo: 'atencao', icone: '!', texto: `${sumidos.length} ${sumidos.length === 1 ? 'cliente que pedia com frequência não pede' : 'clientes que pediam com frequência não pedem'} há mais de 30 dias.`, acao: 'Chamar', fazer: () => irPara('clientes') })
  if (mom.melhor && mom.total > 0) {
    const [k, v] = mom.melhor
    const [per, wd] = k.split('|')
    const share = v / mom.total
    if (share >= 0.12) {
      const quando = per === 'sem' ? DIAS_SEMANA[wd].toLowerCase() : `${DIAS_SEMANA[wd].toLowerCase()} de ${per === 'manha' ? 'manhã' : per}`
      avisos.push({ tipo: 'info', icone: '★', texto: `O seu melhor momento é ${quando}: ${pct(share)} das vendas dos últimos 90 dias. Vale caprichar na produção da véspera.`, acao: 'Planejar', fazer: () => navigate('/mise-en-place') })
    }
  }
  if (hrs.melhor && hrs.total >= 10 && hrs.melhor.pct >= 0.3) {
    avisos.push({ tipo: 'info', icone: '◷', texto: `${pct(hrs.melhor.pct)} dos pedidos chegam entre ${hrs.melhor.de}h e ${hrs.melhor.ate === 24 ? 'meia-noite' : `${hrs.melhor.ate}h`}. Bom horário pra estar de olho no celular e com entrega disponível.`, acao: 'Ver horários', fazer: () => setModoMapa('horas') })
  }
  const prod30 = produtosStats(trans, mais(hojeS, -29), hojeS, null).filter(p => p.receita > 0).sort((a, b) => b.receita - a.receita)
  const rec30 = prod30.reduce((s, p) => s + p.receita, 0)
  if (prod30[0] && rec30 > 0 && prod30[0].receita / rec30 >= 0.2) {
    const p = prod30[0]
    avisos.push({ tipo: 'info', icone: '★', texto: `${p.nome} é ${pct(p.receita / rec30)} do que você vendeu nos últimos 30 dias${p.margem != null ? `, com ${pct(p.margem)} de margem` : ''}.`, acao: 'Ver produtos', fazer: () => irPara('produtos') })
  }
  const can90 = porCanal(trans, mais(hojeS, -89), hojeS)
  const ifood = can90.find(c => c.canal === 'iFood'), card = can90.find(c => c.canal === 'Cardápio')
  if (ifood?.pedidos >= 3 && card?.pedidos >= 3 && ifood.ticket < card.ticket * 0.9) {
    avisos.push({ tipo: 'atencao', icone: '↓', texto: `O ticket do iFood (${fmtR0(ifood.ticket)}) é ${pct(1 - ifood.ticket / card.ticket)} menor que o do Cardápio (${fmtR0(card.ticket)}), e ainda paga ${cfg.taxaIfood || 0}% de taxa.` })
  }
  if (fin.semCusto.length) avisos.push({ tipo: 'atencao', icone: '!', texto: `${fin.semCusto.length === 1 ? '1 doce vendido está' : `${fin.semCusto.length} doces vendidos estão`} sem custo cadastrado: a margem aparece maior do que é.`, acao: 'Ver produtos', fazer: () => navigate('/produtos') })

  const diaSel = dias && sel ? dias.find(d => d.data === sel) : null
  const rotulosEixo = dias ? [dias[0].data, dias[Math.floor(dias.length / 2)].data, dias[dias.length - 1].data] : []

  return (
    <>
      <div className="vd-chips" role="group" aria-label="Período">
        {PERIODOS.map(p => <button key={p.key} className={`vd-chip${periodo === p.key ? ' on' : ''}`} aria-pressed={periodo === p.key} onClick={() => setPeriodo(p.key)}>{p.nome}</button>)}
        <span className="vd-comp">comparando com <b>{j.nomeAnt}</b></span>
      </div>
      {periodo === 'custom' && (
        <div className="vd-chips">
          <input type="date" className="pd-input" style={{ width: 'auto', colorScheme: 'dark' }} value={custom.de} max={custom.ate} onChange={e => setCustom(c => ({ ...c, de: e.target.value }))} aria-label="De" />
          <span className="cf-dim">até</span>
          <input type="date" className="pd-input" style={{ width: 'auto', colorScheme: 'dark' }} value={custom.ate} min={custom.de} onChange={e => setCustom(c => ({ ...c, ate: e.target.value }))} aria-label="Até" />
        </div>
      )}

      <section className="cf-kpis" aria-label="Números do período">
        <div className="cf-kpi"><span>Vendido</span><b>{fmtR0(tot.receita)}</b><Delta v={variacao(ateHoje.receita, ant.receita)} nome={j.curto} />
          {marcados > 0.5 && <small>inclui {fmtR0(marcados)} já marcados</small>}</div>
        <div className="cf-kpi"><span>Pedidos</span><b>{tot.pedidos}</b><Delta v={variacao(ateHoje.pedidos, ant.pedidos)} nome={j.curto} /></div>
        <div className="cf-kpi"><span>Ticket médio</span><b>{tot.ticket ? fmtR(tot.ticket) : '—'}</b>{ateHoje.ticket && ant.ticket ? <Delta v={variacao(ateHoje.ticket, ant.ticket)} nome={j.curto} /> : <small>por pedido</small>}</div>
        {periodo === 'mes' ? (
          <div className="cf-kpi"><span>Lucro do mês</span>
            {fin.fixos > 0
              ? <><b className={lucroMes >= 0 ? 'cf-pos' : ''}>{lucroMes >= 0 ? '' : '− '}{fmtR0(Math.abs(lucroMes))}</b>
                  <small>{lucroMes >= 0 ? 'custos fixos cobertos ✓' : fin.falta != null ? `faltam ${fmtR0(fin.falta)} pra empatar` : 'abaixo dos custos fixos'}</small></>
              : <><b>—</b><small>cadastre os custos fixos</small></>}
          </div>
        ) : (
          <div className="cf-kpi"><span>Sobra das vendas</span><b>{fmtR0(tot.contribuicao)}</b><small>depois de ingredientes, embalagem e taxas</small></div>
        )}
      </section>

      {dias ? (
        <section className="cf-card" aria-label="Vendas por dia">
          <div className="cf-topo" style={{ flexWrap: 'wrap' }}>
            <h2>Vendas por dia</h2>
            <span className="vd-legenda"><i className="vd-sw" style={{ background: '#3987e5' }} />{j.titulo.toLowerCase()}<i className="vd-tick" />{j.nomeAnt}</span>
          </div>
          <div className="vd-dica" aria-live="polite">
            {diaSel
              ? <><b>{diaCurto(diaSel.data)}</b> · {fmtR0(diaSel.receita)} · {diaSel.pedidos} {diaSel.pedidos === 1 ? 'pedido' : 'pedidos'}{diaSel.data > hojeS ? ' marcados' : ''} <span className="cf-dim">· antes: {fmtR0(diaSel.ref)}</span></>
              : <span className="cf-dim">Toque numa barra pra ver o dia.{dias.some(d => d.data > hojeS && d.receita > 0) ? ' As claras são pedidos já marcados.' : ''}</span>}
          </div>
          <div className="vd-grafico" style={{ gridTemplateColumns: `repeat(${dias.length}, minmax(0, 1fr))` }}>
            {dias.map(d => (
              <button key={d.data} type="button" className={`vd-barra${d.data > hojeS ? ' futuro' : ''}${sel === d.data ? ' sel' : ''}${d.data === hojeS ? ' hoje' : ''}`}
                aria-label={`${diaCurto(d.data)}: ${fmtR0(d.receita)}, ${d.pedidos} pedidos; antes ${fmtR0(d.ref)}`} aria-pressed={sel === d.data}
                onClick={() => setSel(s => s === d.data ? null : d.data)}>
                <i style={{ height: `${(d.receita / maxDia) * 100}%` }} />
                {d.ref > 0 && d.data <= hojeS && <b style={{ bottom: `${(d.ref / maxDia) * 100}%` }} />}
              </button>
            ))}
          </div>
          <div className="vd-eixo">{rotulosEixo.map((d, i) => <span key={i}>{d === hojeS ? 'hoje' : diaCurto(d)}</span>)}</div>
        </section>
      ) : <div className="cf-card cf-hint">Período longo demais pro gráfico por dia: veja os números acima.</div>}

      <div className="cf-grade duas">
        <section className="cf-card" aria-label="De onde vêm as vendas">
          <h2>De onde vêm as vendas</h2>
          {canais.length ? (
            <>
              <div className="vd-seg" role="img" aria-label={canais.map(c => `${c.canal} ${pct(c.pct)}`).join(', ')}>
                {canais.map(c => <i key={c.canal} style={{ flex: Math.max(0.001, c.pct), background: c.cor }} />)}
              </div>
              {canais.map(c => (
                <div key={c.canal} className="vd-linha-canal">
                  <i className="vd-sw" style={{ background: c.cor }} />
                  <span style={{ flex: 1 }}>{c.canal}</span>
                  <span className="cf-dim" style={{ width: 40, textAlign: 'right' }}>{pct(c.pct)}</span>
                  <b style={{ width: 82, textAlign: 'right' }}>{fmtR0(c.receita)}</b>
                </div>
              ))}
              <div className="cf-dim">Ticket médio: {canais.filter(c => c.pedidos).slice(0, 3).map(c => `${c.canal} ${fmtR0(c.ticket)}`).join(' · ')}</div>
            </>
          ) : <div className="cf-hint">Sem vendas no período.</div>}
        </section>

        <section className="cf-card" aria-label="Quando você mais vende">
          <div className="cf-topo" style={{ flexWrap: 'wrap' }}>
            <h2>Quando você mais vende <span className="cf-dim" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>· 90 dias</span></h2>
            <div className="pd-seg vd-toggle" role="group" aria-label="Ver por">
              <button className={modoMapa === 'periodos' ? 'on' : ''} aria-pressed={modoMapa === 'periodos'} onClick={() => setModoMapa('periodos')}>Períodos</button>
              <button className={modoMapa === 'horas' ? 'on' : ''} aria-pressed={modoMapa === 'horas'} onClick={() => setModoMapa('horas')}>Horas</button>
            </div>
          </div>
          {modoMapa === 'horas' ? (hrs.total > 0 ? (
            <>
              <div className="vd-mapa-h">
                <span />
                {HORAS.map(h => <span key={h}>{h % 2 === 0 ? `${h}h` : ''}</span>)}
                {hrs.linhas.map(l => [
                  <span key={l.dia} className="vd-mapa-nome">{DIAS_CURTO[l.dia]}</span>,
                  ...l.celulas.map(c => {
                    const k = `h|${l.dia}|${c.h}`
                    return <button key={k} type="button" className={`vd-cel vd-n${c.nivel}${celSel === k ? ' sel' : ''}`}
                      aria-label={`${DIAS_SEMANA[l.dia]}, ${c.h}h às ${c.h + 1}h: ${c.n} ${c.n === 1 ? 'pedido' : 'pedidos'}`} title={`${DIAS_SEMANA[l.dia]} · ${c.h}h–${c.h + 1}h: ${c.n} pedidos · ${fmtR0(c.v)}`}
                      onClick={() => setCelSel(s => s === k ? null : k)} />
                  }),
                ])}
              </div>
              <div className="vd-dica">
                {celSel?.startsWith('h|') ? (() => {
                  const [, wd, h] = celSel.split('|'); const c = hrs.linhas.find(x => String(x.dia) === wd)?.celulas.find(x => String(x.h) === h)
                  return c ? <><b>{DIAS_SEMANA[wd]} · {h}h às {Number(h) + 1}h</b>: {c.n} {c.n === 1 ? 'pedido' : 'pedidos'} · {fmtR0(c.v)}</> : null
                })() : (
                  <span className="vd-legenda">menos <i className="vd-cel-mini vd-n1" /><i className="vd-cel-mini vd-n2" /><i className="vd-cel-mini vd-n3" /><i className="vd-cel-mini vd-n4" /> mais pedidos · pela hora em que o pedido foi feito{hrs.melhor ? ` · pico: ${hrs.melhor.de}h às ${hrs.melhor.ate === 24 ? '0h' : `${hrs.melhor.ate}h`}` : ''}</span>
                )}
              </div>
              {hrs.fora > 0 && <div className="cf-dim">{hrs.fora} {hrs.fora === 1 ? 'pedido feito' : 'pedidos feitos'} entre meia-noite e 8h não {hrs.fora === 1 ? 'aparece' : 'aparecem'} aqui.</div>}
            </>
          ) : <div className="cf-hint">Sem pedidos com horário nos últimos 90 dias.</div>) : mom.total > 0 ? (
            <>
              <div className="vd-mapa">
                <span />
                {mom.ordem.map(d => <span key={d}>{DIAS_CURTO[d]}</span>)}
                {mom.linhas.map(l => [
                  <span key={l.key} className="vd-mapa-nome">{l.nome}</span>,
                  ...l.celulas.map(c => {
                    const k = `${l.key}|${c.dia}`
                    return <button key={k} type="button" className={`vd-cel vd-n${c.nivel}${celSel === k ? ' sel' : ''}`}
                      aria-label={`${DIAS_SEMANA[c.dia]}, ${l.nome.toLowerCase()}: ${fmtR0(c.v)} (${pct(c.pct)})`} title={`${DIAS_SEMANA[c.dia]} · ${l.nome}: ${fmtR0(c.v)} (${pct(c.pct)})`}
                      onClick={() => setCelSel(s => s === k ? null : k)} />
                  }),
                ])}
              </div>
              <div className="vd-dica">
                {celSel ? (() => {
                  const [lk, wd] = celSel.split('|'); const l = mom.linhas.find(x => x.key === lk); const c = l?.celulas.find(x => String(x.dia) === wd)
                  return c ? <><b>{DIAS_SEMANA[c.dia]} · {l.nome.toLowerCase()}</b>: {fmtR0(c.v)} · {pct(c.pct)} das vendas</> : null
                })() : (
                  <span className="vd-legenda">menos <i className="vd-cel-mini vd-n1" /><i className="vd-cel-mini vd-n2" /><i className="vd-cel-mini vd-n3" /><i className="vd-cel-mini vd-n4" /> mais · pelo período de entrega</span>
                )}
              </div>
            </>
          ) : <div className="cf-hint">Sem vendas nos últimos 90 dias.</div>}
        </section>
      </div>

      {avisos.length > 0 && (
        <section className="cf-card" aria-label="Pra ficar de olho" style={{ gap: 0 }}>
          <h2 style={{ marginBottom: 6 }}>Pra ficar de olho</h2>
          {avisos.slice(0, 4).map((a, i) => (
            <div key={i} className="vd-aviso">
              <span className={`vd-ic ${a.tipo}`} aria-hidden="true">{a.icone}</span>
              <span style={{ flex: 1 }}>{a.texto}</span>
              {a.acao && <button className="pd-btn" onClick={a.fazer}>{a.acao}</button>}
            </div>
          ))}
        </section>
      )}
      <div className="cf-dim">Vendido = valor dos doces, sem frete, sem cancelados e sem pedidos que ainda esperam o Pix. Mesma conta de Configurações › Financeiro.</div>
    </>
  )
}

// ── Produtos ─────────────────────────────────────────────────────────────────
const JANELAS_PROD = [{ key: 7, nome: 'Semana' }, { key: 30, nome: '30 dias' }, { key: 90, nome: '90 dias' }]
const ORDENS = [{ key: 'un', nome: 'Mais vendidos' }, { key: 'lucro', nome: 'Mais lucro' }, { key: 'delta', nome: 'Crescendo' }]
const QUADS = [
  { key: 'joias', titulo: 'Joias escondidas', sub: 'margem alta, vende pouco', acao: 'divulgar e pôr em destaque', classe: '' },
  { key: 'estrelas', titulo: 'Estrelas', sub: 'vende muito e dá lucro', acao: 'nunca deixar faltar', classe: 'bom' },
  { key: 'repensar', titulo: 'Repensar', sub: 'vende pouco, margem baixa', acao: 'mudar a receita ou tirar', classe: 'ruim' },
  { key: 'populares', titulo: 'Populares, margem baixa', sub: 'vende muito, sobra pouco', acao: 'subir o preço ou baixar o custo', classe: 'atencao' },
]

function AbaProdutos({ trans, encomendas, produtos, cfg, navigate }) {
  const [dias, setDias] = useState(30)
  const [ordem, setOrdem] = useState('un')
  const hojeS = ymd(new Date())
  const de = mais(hojeS, -(dias - 1))
  const stats = useMemo(() => produtosStats(trans, de, hojeS, { de: mais(de, -dias), ate: mais(de, -1) }), [trans, de, hojeS, dias])
  const meta = (Number(cfg.margem) || 30) / 100
  const quad = matriz(stats, meta)
  const ativos = new Set((produtos || []).filter(p => p.ativo !== false && p.tipo !== 'combo').map(p => String(p.nome).trim().toLowerCase()))
  const lista = [...stats].filter(p => p.un > 0).sort((a, b) =>
    ordem === 'lucro' ? b.lucro - a.lucro : ordem === 'delta' ? ((b.delta ?? 9) - (a.delta ?? 9)) : b.un - a.un)
  const prev = useMemo(() => previsao(trans, encomendas), [trans, encomendas])

  // Atenção: parados, sem custo, preço abaixo da meta
  const todos90 = useMemo(() => produtosStats(trans, mais(hojeS, -89), hojeS, null), [trans, hojeS])
  const alertas = []
  for (const p of todos90) {
    if (!ativos.has(p.nome.trim().toLowerCase()) || !p.ultimaVenda) continue
    const parado = Math.round((new Date(hojeS) - new Date(p.ultimaVenda)) / 864e5)
    if (parado >= 21) alertas.push({ texto: `${p.nome} não vende há ${parado} dias. Ainda vale estar no cardápio?`, acao: 'Ver produtos', fazer: () => navigate('/produtos') })
  }
  for (const p of stats.filter(x => x.semCusto && x.un > 0).slice(0, 3)) alertas.push({ texto: `${p.nome} está sem custo cadastrado: a margem aparece maior do que é.`, acao: 'Cadastrar custo', fazer: () => navigate('/produtos') })
  for (const p of (quad?.populares || []).slice(0, 2)) {
    const precoMedio = p.receita / p.un, custoUn = p.custo / p.un
    const precoMeta = custoUn / (1 - meta)
    if (precoMeta > precoMedio + 0.25) alertas.push({ texto: `${p.nome}: subir ${fmtR(Math.ceil((precoMeta - precoMedio) * 2) / 2)} (pra ~${fmtR(Math.ceil(precoMeta * 2) / 2)}) leva a margem de ${pct(p.margem)} pra sua meta de ${pct(meta)}.`, acao: 'Ajustar preço', fazer: () => navigate('/produtos') })
  }

  const mandarPlanejamento = () => {
    const adicionar = prev.linhas.filter(l => l.produtoId && l.sugestao > 0).map(l => ({ produtoId: Number(l.produtoId), n: l.sugestao }))
    navigate('/mise-en-place', { state: { adicionar } })
  }

  return (
    <>
      <div className="vd-chips" role="group" aria-label="Período">
        {JANELAS_PROD.map(p => <button key={p.key} className={`vd-chip${dias === p.key ? ' on' : ''}`} aria-pressed={dias === p.key} onClick={() => setDias(p.key)}>{p.nome}</button>)}
      </div>

      <section className="cf-card" aria-label="O que cada doce faz pelo caixa">
        <h2>O que cada doce faz pelo seu caixa</h2>
        {quad ? (
          <>
            <div className="vd-quads">
              {QUADS.map(q => (
                <div key={q.key} className={`vd-quad ${q.classe}`}>
                  <b>{q.titulo}</b>
                  <span className="cf-dim">{q.sub}</span>
                  <div className="vd-tags">{quad[q.key].length ? quad[q.key].map(p => <span key={p.nome}>{p.nome}</span>) : <span className="vazio">nenhum</span>}</div>
                  <small>→ {q.acao}</small>
                </div>
              ))}
            </div>
            <div className="cf-dim">Margem alta = acima da sua meta de {pct(meta)} (Configurações › Custos). Vende muito = pelo menos 70% da média de unidades. Doces sem custo cadastrado ficam de fora.</div>
          </>
        ) : <div className="cf-hint">Sem vendas com custo cadastrado no período.</div>}
      </section>

      <section className="cf-card" aria-label="Produtos">
        <div className="cf-topo" style={{ flexWrap: 'wrap' }}>
          <h2>Produtos</h2>
          <div className="vd-chips">{ORDENS.map(o => <button key={o.key} className={`vd-chip peq${ordem === o.key ? ' on' : ''}`} aria-pressed={ordem === o.key} onClick={() => setOrdem(o.key)}>{o.nome}</button>)}</div>
        </div>
        <div className="vd-tab">
          <div className="vd-tab-cab"><span>Produto</span><span>Un</span><span>Vendido</span><span>Margem</span><span>8 semanas</span><span>vs antes</span></div>
          {lista.map(p => {
            const corM = p.margem == null ? 'atencao' : p.margem < 0 ? 'ruim' : p.margem >= meta ? 'bom' : 'atencao'
            const maxS = Math.max(1, ...p.semanas)
            return (
              <div key={p.nome} className="vd-tab-lin">
                <span className="nome">{p.nome}</span>
                <span>{Math.round(p.un * 10) / 10}</span>
                <b>{fmtR0(p.receita)}</b>
                <span className={`m ${corM}`}>{p.margem == null ? 'sem custo' : pct(p.margem)}</span>
                <span className="vd-spark" role="img" aria-label={`${p.nome}, unidades por semana: ${p.semanas.join(', ')}`}>
                  {p.semanas.map((s, i) => <i key={i} className={i === 7 ? 'ult' : ''} style={{ height: `${Math.max(8, (s / maxS) * 100)}%`, opacity: s ? 1 : 0.35 }} />)}
                </span>
                <span className={`d ${p.delta == null ? 'novo' : p.delta > 0.005 ? 'sobe' : p.delta < -0.005 ? 'desce' : ''}`}>{p.delta == null ? 'novo' : Math.abs(p.delta) < 0.005 ? '=' : `${p.delta > 0 ? '▲' : '▼'} ${Math.round(Math.abs(p.delta) * 100)}%`}</span>
              </div>
            )
          })}
          {!lista.length && <div className="cf-hint" style={{ padding: '10px 0' }}>Nenhuma venda no período.</div>}
        </div>
        <div className="cf-dim">Margem: verde na meta ({pct(meta)}) ou acima, âmbar abaixo. Doce de combo entra com a parte dele do valor do combo.</div>
      </section>

      <section className="cf-card" aria-label="Previsão dos próximos 7 dias">
        <div className="cf-topo" style={{ flexWrap: 'wrap' }}>
          <h2>Pra produzir · próximos 7 dias</h2>
          {prev.linhas.some(l => l.produtoId) && <button className="pd-btn verde" onClick={mandarPlanejamento}>Mandar pro planejamento</button>}
        </div>
        {prev.linhas.length ? (
          <>
            <div className="vd-prev">
              <div className="vd-prev-cab"><span>Doce</span><span>Encomendado</span><span>Costuma sair</span><span>Sugestão</span></div>
              {prev.linhas.slice(0, 12).map(l => (
                <div key={l.nome} className="vd-prev-lin">
                  <span className="nome">{l.nome}</span>
                  <span>{l.encomendado || '—'}</span>
                  <span>{l.costuma ? `~${Math.round(l.costuma * 10) / 10}` : '—'}</span>
                  <b>{l.sugestao}</b>
                </div>
              ))}
            </div>
            <div className="cf-dim">Costuma sair = média do mesmo dia da semana nas últimas 4 semanas. Sugestão = em cada dia, o maior entre o encomendado e o que costuma sair. Confira com o que já tem pronto na Prontidão.</div>
          </>
        ) : <div className="cf-hint">Sem histórico nem encomendas pros próximos 7 dias.</div>}
      </section>

      {alertas.length > 0 && (
        <section className="cf-card cf-aviso" aria-label="Atenção" style={{ gap: 0 }}>
          <h2 style={{ marginBottom: 6, color: '#f5b544' }}>Atenção</h2>
          {alertas.slice(0, 6).map((a, i) => (
            <div key={i} className="vd-aviso">
              <span style={{ flex: 1 }}>{a.texto}</span>
              <button className="pd-btn" onClick={a.fazer}>{a.acao}</button>
            </div>
          ))}
        </section>
      )}
    </>
  )
}

// ── Clientes ─────────────────────────────────────────────────────────────────
const CHAVE_CHAMADOS = 'guaxi_sumidos_chamados'
const lerChamados = () => { try { return JSON.parse(localStorage.getItem(CHAVE_CHAMADOS) || '{}') } catch { return {} } }

function AbaClientes({ lista, sumidos, contatos, linkCardapio, navigate, show }) {
  const [chamados, setChamados] = useState(lerChamados)
  const [fila, setFila] = useState(null)       // chaves pra chamar uma a uma
  const [ficha, setFicha] = useState(null)     // cliente aberto
  const [enviando, setEnviando] = useState(null)
  const hoje = new Date(), hojeS = ymd(hoje)
  const iniMes = ymd(new Date(hoje.getFullYear(), hoje.getMonth(), 1))
  const doMes = lista.filter(c => c.pedidos.some(p => p.data >= iniMes && p.data <= hojeS))
  const novos = doMes.filter(c => c.primeiro >= iniMes)
  const voltaram = doMes.length - novos.length
  const recorrentes = lista.filter(c => c.intervalo != null && c.ultimo >= mais(hojeS, -180))
  const intervalo = recorrentes.length ? recorrentes.reduce((s, c) => s + c.intervalo, 0) / recorrentes.length : null
  const ini90 = mais(hojeS, -89)
  const top = lista.map(c => ({ ...c, total90: c.pedidos.filter(p => p.data >= ini90).reduce((s, p) => s + p.receita, 0), n90: c.pedidos.filter(p => p.data >= ini90).length }))
    .filter(c => c.n90 > 0).sort((a, b) => b.total90 - a.total90).slice(0, 10)
  const ordenados = [...sumidos].sort((a, b) => (chamados[a.chave] ? 1 : 0) - (chamados[b.chave] ? 1 : 0))
  const pendentes = ordenados.filter(c => !chamados[c.chave] && soDig(c.contato).length >= 10)

  const texto = (c) => `Oi${primeiroNome(c.nome) ? `, ${primeiroNome(c.nome)}` : ''}! Saudade 💛 ${c.favorito ? `Tem ${c.favorito} fresquinho por aqui, ` : 'Tem fornada nova por aqui, '}quer que eu separe pra você?${linkCardapio ? ` Dá pra pedir por aqui: ${linkCardapio}` : ''}`
  const marcar = (c) => { const n = { ...lerChamados(), [c.chave]: hojeS }; try { localStorage.setItem(CHAVE_CHAMADOS, JSON.stringify(n)) } catch { /* sem storage */ } setChamados(n) }
  async function chamar(c) {
    const contato = acharContato(contatos, c.contato)
    const t = texto(c)
    if (janelaAberta(contato)) {
      setEnviando(c.chave)
      try { await enviarWhatsApp(contato.telefone, t, { pausar: false }); marcar(c); show(`Mandado pelo WhatsApp da Guaxí pra ${primeiroNome(c.nome)}`) }
      catch (e) { show('Não foi: ' + e.message) }
      finally { setEnviando(null) }
      return
    }
    const link = waLink(c.contato, t)
    if (!link) { show('Esse cliente não tem telefone'); return }
    window.open(link, '_blank')
    marcar(c)
  }
  const proximoDaFila = () => {
    const c = sumidos.find(x => x.chave === fila[0])
    const resto = fila.slice(1)
    setFila(resto.length ? resto : null)
    if (c) chamar(c)
    if (!resto.length) show('Todos chamados ✓')
  }
  const haQuanto = (iso) => { const d = Math.round((new Date(hojeS) - new Date(iso)) / 864e5); return d === 0 ? 'hoje' : d === 1 ? 'ontem' : `há ${d} dias` }

  return (
    <>
      <section className="cf-kpis" aria-label="Clientes no mês">
        <div className="cf-kpi"><span>Clientes no mês</span><b>{doMes.length}</b><small>que compraram até hoje</small></div>
        <div className="cf-kpi"><span>Primeira vez</span><b>{novos.length}</b><small>{doMes.length ? `${pct(novos.length / doMes.length)} dos clientes` : '—'}</small></div>
        <div className="cf-kpi"><span>Voltaram</span><b>{voltaram}</b><small>{doMes.length ? `${pct(voltaram / doMes.length)} dos clientes` : '—'}</small></div>
        <div className="cf-kpi"><span>A cada quanto</span><b>{intervalo ? `${Math.round(intervalo)} dias` : '—'}</b><small>entre um pedido e outro</small></div>
      </section>

      {doMes.length > 0 && (
        <section className="cf-card" aria-label="Novos e de volta">
          <h2>Novos e de volta · este mês</h2>
          <div className="vd-seg alto" role="img" aria-label={`${voltaram} voltaram, ${novos.length} primeira vez`}>
            {voltaram > 0 && <i style={{ flex: voltaram, background: '#3987e5' }}>{pct(voltaram / doMes.length)}</i>}
            {novos.length > 0 && <i style={{ flex: novos.length, background: '#d95926' }}>{pct(novos.length / doMes.length)}</i>}
          </div>
          <div className="vd-legenda"><i className="vd-sw" style={{ background: '#3987e5' }} />voltaram (já tinham pedido antes) <i className="vd-sw" style={{ background: '#d95926', marginLeft: 12 }} />primeira vez</div>
        </section>
      )}

      <section className={`cf-card${pendentes.length ? ' cf-aviso' : ''}`} aria-label="Sumidos" style={{ gap: 0 }}>
        <div className="cf-topo" style={{ marginBottom: 6, flexWrap: 'wrap' }}>
          <h2 style={{ color: pendentes.length ? '#f5b544' : undefined }}>Sumidos · pediam com frequência e pararam</h2>
          {fila ? <button className="pd-btn verde" onClick={proximoDaFila}>Chamar {primeiroNome(sumidos.find(x => x.chave === fila[0])?.nome)} · {fila.length} {fila.length > 1 ? 'faltam' : 'falta'} ›</button>
            : pendentes.length > 1 && <button className="pd-btn verde" onClick={() => setFila(pendentes.map(c => c.chave))}>Chamar todos ({pendentes.length})</button>}
        </div>
        {ordenados.length === 0 && <div className="cf-hint" style={{ paddingTop: 4 }}>Ninguém sumido por enquanto. Aparece aqui quem pedia todo mês (ou mais) e está há mais de 30 dias sem pedir.</div>}
        {ordenados.map(c => (
          <div key={c.chave} className="vd-cli" style={{ opacity: chamados[c.chave] ? 0.55 : 1 }}>
            <span className="vd-av" aria-hidden="true">{(c.nome || '?').charAt(0).toUpperCase()}</span>
            <button type="button" className="vd-cli-txt" onClick={() => setFicha(c)}>
              <b>{c.nome}</b>
              <span>último pedido {haQuanto(c.ultimo)} · costumava pedir a cada {Math.round(c.intervalo)} dias{c.favorito ? ` · gosta de ${c.favorito}` : ''}</span>
              {chamados[c.chave] && <span className="cf-pos">chamado {haQuanto(chamados[c.chave])}</span>}
            </button>
            <button className="pd-btn verde" disabled={enviando === c.chave} onClick={() => chamar(c)}>{enviando === c.chave ? 'Enviando…' : 'Chamar'}</button>
          </div>
        ))}
        {ordenados.length > 0 && <div className="cf-dim" style={{ paddingTop: 8 }}>Vai pelo WhatsApp da Guaxí se a conversa estiver aberta; senão abre o seu com a mensagem pronta, com o doce preferido do cliente.</div>}
      </section>

      <section className="cf-card" aria-label="Quem mais compra">
        <h2>Quem mais compra · últimos 90 dias</h2>
        {top.length ? (
          <div className="vd-top">
            <div className="vd-top-cab"><span>#</span><span>Cliente</span><span>Pedidos</span><span>Total</span><span>Preferido</span></div>
            {top.map((c, i) => (
              <button key={c.chave} type="button" className="vd-top-lin" onClick={() => setFicha(c)}>
                <span className="cf-dim">{i + 1}</span><span className="nome">{c.nome}</span><span>{c.n90}</span><b>{fmtR0(c.total90)}</b><span className="fav">{c.favorito}</span>
              </button>
            ))}
          </div>
        ) : <div className="cf-hint">Sem pedidos com cliente nos últimos 90 dias.</div>}
      </section>

      {ficha && (
        <>
          <div className="sheet-overlay" onClick={() => setFicha(null)} />
          <div className="sheet">
            <div className="sheet-title"><span>{ficha.nome}</span>
              <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 24, cursor: 'pointer' }} onClick={() => setFicha(null)} aria-label="Fechar">×</button></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="cf-kv" style={{ borderTop: 'none', paddingTop: 0 }}><span>WhatsApp</span><b>{ficha.contato || '—'}</b></div>
              <div className="cf-kv"><span>Cliente desde</span><b>{diaCurto(ficha.primeiro)}</b></div>
              <div className="cf-kv"><span>Pedidos</span><b>{ficha.vezes}{ficha.intervalo ? ` · a cada ${Math.round(ficha.intervalo)} dias` : ''}</b></div>
              <div className="cf-kv"><span>Total</span><b>{fmtR(ficha.total)}</b></div>
              {ficha.favorito && <div className="cf-kv"><span>Preferido</span><b>{ficha.favorito}</b></div>}
              <div className="cf-linhas" style={{ marginTop: 4 }}>
                {[...ficha.pedidos].sort((a, b) => b.data.localeCompare(a.data)).slice(0, 12).map(p => (
                  <button key={p.id} type="button" className="vd-venda" onClick={() => navigate('/pedidos', { state: { openPedidoId: p.id } })}>
                    <i className="vd-sw" style={{ background: corCanal(p.canal) }} />
                    <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}><b>{diaCurto(p.data)}</b> <span className="cf-dim">{p.id} · {p.itens.filter(x => !x.sub).map(x => `${x.qtd}× ${x.nome}`).join(', ')}</span></span>
                    <b>{fmtR(p.valor)}</b>
                  </button>
                ))}
              </div>
              {soDig(ficha.contato).length >= 10 && <button className="pd-grande" onClick={() => chamar(ficha)}>Chamar no WhatsApp</button>}
            </div>
          </div>
        </>
      )}
    </>
  )
}

// ── Histórico ────────────────────────────────────────────────────────────────
function AbaHistorico({ trans, navigate, show, aoApagar }) {
  const [busca, setBusca] = useState('')
  const [canal, setCanal] = useState('Tudo')
  const [ateDias, setAteDias] = useState(30)
  const [apagar, setApagar] = useState(null)
  const hojeS = ymd(new Date())
  const ontem = mais(hojeS, -1)
  const passadas = trans.filter(x => x.data <= hojeS)
  const canaisPresentes = CANAIS.filter(c => passadas.some(x => x.canal === c.key)).map(c => c.key)
  const q = busca.trim().toLowerCase()
  const filtradas = passadas.filter(x => (canal === 'Tudo' || x.canal === canal) && (!q
    || x.cliente.toLowerCase().includes(q) || String(x.id).toLowerCase().includes(q)
    || x.itens.some(i => i.nome.toLowerCase().includes(q))
    || (soDig(q).length >= 3 && soDig(x.contato).includes(soDig(q)))))
  const limite = mais(hojeS, -(ateDias - 1))
  const visiveis = filtradas.filter(x => q || x.data >= limite)
  const grupos = []
  for (const x of [...visiveis].sort((a, b) => b.data.localeCompare(a.data) || String(b.id).localeCompare(String(a.id)))) {
    const g = grupos[grupos.length - 1]
    if (g && g.data === x.data) g.itens.push(x); else grupos.push({ data: x.data, itens: [x] })
  }
  const exportar = () => {
    const blob = new Blob([csvHistorico(filtradas)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = `vendas-guaxi-${hojeS}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    show(`Planilha com ${filtradas.length} vendas baixada`)
  }
  const tituloDia = (d) => d === hojeS ? `Hoje · ${diaCurto(d)}` : d === ontem ? `Ontem · ${diaCurto(d)}` : diaCurto(d)
  const pagamento = (x) => x.pago ? (x.pixPago ? 'pago no Pix ✓' : 'pago') : 'a receber'

  return (
    <>
      <div className="vd-busca">
        <label className="pd-busca" style={{ flex: 1 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="#8a8a8a" strokeWidth="2" /><path d="M20 20l-3.5-3.5" stroke="#8a8a8a" strokeWidth="2" strokeLinecap="round" /></svg>
          <input type="search" placeholder="Buscar cliente, pedido ou doce" value={busca} onChange={e => setBusca(e.target.value)} aria-label="Buscar vendas" />
        </label>
        <button className="pd-btn" style={{ height: 44 }} onClick={exportar} disabled={!filtradas.length}>Exportar planilha</button>
      </div>
      <div className="vd-chips" role="group" aria-label="Canal">
        {['Tudo', ...canaisPresentes].map(c => (
          <button key={c} className={`vd-chip peq${canal === c ? ' on' : ''}`} aria-pressed={canal === c} onClick={() => setCanal(c)}>
            {c !== 'Tudo' && <i className="vd-sw" style={{ background: corCanal(c), marginRight: 6 }} />}{c === 'Presencial' ? 'Balcão / presencial' : c}
          </button>
        ))}
      </div>

      {grupos.length === 0 && <div className="pd-vazio">{q ? 'Nada encontrado.' : 'Nenhuma venda nesse período.'}</div>}
      {grupos.map(g => (
        <section key={g.data} className="pd-dia" aria-label={tituloDia(g.data)}>
          <div className="pd-dia-topo">
            <h2>{tituloDia(g.data)}</h2>
            <span style={{ flex: 1 }}>{g.itens.length} {g.itens.length === 1 ? 'venda' : 'vendas'}</span>
            <b style={{ fontSize: 14 }}>{fmtR0(g.itens.reduce((s, x) => s + x.valor, 0))}</b>
          </div>
          <div className="vd-lista">
            {g.itens.map(x => (
              <button key={x.id} type="button" className="vd-venda" onClick={() => x.tipo === 'pedido' ? navigate('/pedidos', { state: { openPedidoId: x.id } }) : setApagar(x)}>
                <i className="vd-sw" style={{ background: corCanal(x.canal) }} aria-hidden="true" />
                <span className="vd-venda-txt">
                  <b>{x.cliente || 'Sem nome'} {x.tipo === 'pedido' && <span className="cf-dim">{x.id}</span>}</b>
                  <span>{x.canal === 'Presencial' ? 'Balcão' : x.canal} · {x.itens.filter(i => !i.sub).map(i => `${Math.round(i.qtd * 10) / 10}× ${i.nome}`).join(', ')}</span>
                </span>
                <span className={`vd-pg ${x.pago ? 'ok' : 'falta'}`}>{pagamento(x)}</span>
                <b className="vd-valor">{fmtR(x.valor)}</b>
              </button>
            ))}
          </div>
        </section>
      ))}
      {!q && filtradas.some(x => x.data < limite) && (
        <button className="pd-btn vazado" style={{ alignSelf: 'center' }} onClick={() => setAteDias(d => d + 60)}>Ver vendas mais antigas</button>
      )}

      {apagar && (
        <>
          <div className="sheet-overlay" onClick={() => setApagar(null)} />
          <div className="sheet">
            <div className="sheet-title"><span>Venda de balcão</span>
              <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 24, cursor: 'pointer' }} onClick={() => setApagar(null)} aria-label="Fechar">×</button></div>
            <div className="cf-hint" style={{ marginBottom: 12 }}>{diaCurto(apagar.data)} · {apagar.itens.map(i => `${i.qtd}× ${i.nome}`).join(', ')} · <b>{fmtR(apagar.valor)}</b></div>
            <div className="cf-dim" style={{ marginBottom: 14 }}>Venda lançada no jeito antigo. As novas vendas de balcão viram pedido (botão "+ Venda de balcão") e baixam o estoque.</div>
            <button className="pd-btn perigo-cheio" style={{ width: '100%', height: 48 }}
              onClick={async () => { await deleteVenda(apagar.vendaId); setApagar(null); aoApagar(); show('Venda apagada') }}>Apagar venda</button>
          </div>
        </>
      )}
    </>
  )
}
