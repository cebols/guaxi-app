import { useState, useMemo, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { getConfig, getCustoSacolaDelivery, salvarConfigParcial, DEFAULT_ITENS } from '../hooks/useConfig'
import { getVendas, getEncomendas, getEmbalagens, getProdutos, loadUserConfig, configurarAvisosLalamove } from '../services/db'
import { resumoFinanceiro } from '../lib/financeiro'
import { ContaLoja } from './Perfil'

// ── Configurações ────────────────────────────────────────────────────────────
// Uma tela só, em abas: Financeiro (o mês de verdade: ponto de equilíbrio, meta,
// pra onde vai o dinheiro), Custos (o que entra no preço sugerido), Entrega
// (loja, Lalamove, Pix, frete) e Conta (loja e login).

const ABAS = [
  { key: 'financeiro', nome: 'Financeiro' },
  { key: 'custos', nome: 'Custos' },
  { key: 'entrega', nome: 'Entrega' },
  { key: 'conta', nome: 'Conta' },
]
const MIN_UNIDADES_AUTO = 30   // abaixo disso a média de vendas não serve pra ratear o custo fixo

const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0 }
const fmtR = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtR0 = (v) => `R$ ${Math.round(Number(v) || 0).toLocaleString('pt-BR')}`
const fmtSinal = (v) => `${v >= 0 ? '+' : '−'} ${fmtR0(Math.abs(v))}`
const pct = (x) => `${Math.round((x || 0) * 100)}%`
const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
const iguais = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const somaItens = (itens) => (itens || []).reduce((s, i) => s + num(i.valor), 0)

export default function Configuracoes() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const aba = ABAS.some(a => a.key === params.get('aba')) ? params.get('aba') : 'financeiro'
  const irPara = (key) => setParams(key === 'financeiro' ? {} : { aba: key }, { replace: true })
  const { toast, show } = useToast()
  const [cfg, setCfg] = useState(getConfig)
  const { data: vendas } = useData(getVendas)
  const { data: encomendas } = useData(getEncomendas)
  const { data: embalagens } = useData(getEmbalagens)
  const { data: produtos } = useData(getProdutos)

  // o banco é a fonte (o cache do aparelho pode estar velho)
  useEffect(() => { loadUserConfig().then(r => { if (r) setCfg(c => ({ ...c, ...r, custoFixoMensal: somaItens(r.custoItens || c.custoItens) })) }).catch(() => {}) }, [])

  const custoSacola = getCustoSacolaDelivery(cfg, embalagens || [])
  const fin = useMemo(() => (encomendas && vendas && produtos)
    ? resumoFinanceiro({ encomendas, vendas, produtos, cfg: { ...cfg, custoFixoMensal: somaItens(cfg.custoItens) }, custoSacola, metaLucro: cfg.metaLucro })
    : null, [encomendas, vendas, produtos, cfg, custoSacola])

  // Unidades por mês no automático: segue as vendas dos últimos 30 dias (é o que rateia o custo fixo no preço)
  const sincronizou = useRef(false)
  useEffect(() => {
    if (!fin || sincronizou.current || cfg.unidadesAuto === false) return
    if (fin.unidades30d < MIN_UNIDADES_AUTO || num(cfg.unidadesProjetadas) === fin.unidades30d) return
    sincronizou.current = true
    salvarConfigParcial({ unidadesProjetadas: fin.unidades30d }).then(setCfg).catch(() => {})
  }, [fin, cfg.unidadesAuto, cfg.unidadesProjetadas])

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => navigate(-1)} aria-label="Voltar" style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', padding: '0 4px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <div className="topbar-title">Configurações</div>
          </div>
        </div>
      </div>

      <div className="page-inner cf" style={{ paddingTop: 14 }}>
        <nav className="pd-seg cf-abas" aria-label="Seções">
          {ABAS.map(a => <button key={a.key} className={aba === a.key ? 'on' : ''} aria-current={aba === a.key ? 'page' : undefined} onClick={() => irPara(a.key)}>{a.nome}</button>)}
        </nav>

        {aba === 'financeiro' && <AbaFinanceiro fin={fin} cfg={cfg} setCfg={setCfg} irPara={irPara} navigate={navigate} show={show} />}
        {aba === 'custos' && <AbaCustos cfg={cfg} setCfg={setCfg} embalagens={embalagens || []} fin={fin} show={show} />}
        {aba === 'entrega' && <AbaEntrega show={show} />}
        {aba === 'conta' && <ContaLoja show={show} />}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}

// ── Financeiro ───────────────────────────────────────────────────────────────
function AbaFinanceiro({ fin, cfg, setCfg, irPara, navigate, show }) {
  const [meta, setMeta] = useState(cfg.metaLucro != null ? String(cfg.metaLucro) : '')
  useEffect(() => { setMeta(cfg.metaLucro != null ? String(cfg.metaLucro) : '') }, [cfg.metaLucro])
  const salvarMeta = async () => {
    const v = num(meta)
    if (v === num(cfg.metaLucro)) return
    setCfg(await salvarConfigParcial({ metaLucro: v }))
    show('Meta salva')
  }
  if (!fin) return <div className="pd-vazio">Carregando o mês…</div>

  const { mes, ult30 } = fin
  const semFixos = !(fin.fixos > 0)
  const cobriu = !semFixos && fin.cobertura >= 1
  const lucroAteAgora = mes.contribuicao - fin.fixos
  const metaNum = num(cfg.metaLucro)

  // De cada R$ 100 vendidos nos últimos 30 dias (os custos fixos de um mês inteiro)
  const r = ult30.receita
  const partes = r > 0 ? [
    { nome: 'Ingredientes', dica: 'com o desperdício', v: ult30.cmv / r * 100 },
    { nome: 'Embalagem', dica: 'sacola por pedido', v: ult30.embalagem / r * 100 },
    ...(ult30.taxas > 0 ? [{ nome: 'Taxa do iFood', v: ult30.taxas / r * 100 }] : []),
    { nome: 'Custos fixos', dica: 'aluguel, luz, gás…', v: fin.fixos / r * 100 },
  ] : []
  const sobra = r > 0 ? 100 - partes.reduce((s, p) => s + p.v, 0) : 0

  return (
    <>
      {/* Ponto de equilíbrio do mês */}
      <section className="cf-card cf-hero" aria-label="Ponto de equilíbrio do mês">
        <div className="cf-topo">
          <h2>Ponto de equilíbrio · {fin.nomeMes}</h2>
          <span className="cf-dim">dia {fin.dia} de {fin.diasNoMes}</span>
        </div>
        {semFixos ? (
          <div className="cf-hint">
            Cadastre seus custos fixos (aluguel, luz, gás, internet…) pra ver quanto precisa vender pra empatar no mês.
            <div><button className="pd-btn verde" style={{ marginTop: 10 }} onClick={() => irPara('custos')}>Cadastrar custos fixos</button></div>
          </div>
        ) : (
          <>
            <div className="cf-meter-txt">
              <span>Já cobriu <b>{fmtR0(Math.max(0, mes.contribuicao))}</b> de <b>{fmtR0(fin.fixos)}</b> de custos fixos</span>
              <b>{pct(Math.min(fin.cobertura, 9.99))}</b>
            </div>
            <div className={`cf-meter${cobriu ? ' ok' : ''}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, fin.cobertura) * 100)}
              aria-label="Custos fixos cobertos no mês">
              <i style={{ width: `${Math.min(100, fin.cobertura * 100)}%` }} />
            </div>
            {cobriu ? (
              <div className="cf-status ok">✓ Custos fixos do mês cobertos. Lucro até agora: <b>{fmtR0(lucroAteAgora)}</b></div>
            ) : fin.falta != null ? (
              <div className="cf-status atencao">
                Faltam <b>{fmtR0(fin.falta)}</b> em vendas pra empatar
                {fin.pedidosFaltam ? <> · ~{fin.pedidosFaltam} {fin.pedidosFaltam === 1 ? 'pedido' : 'pedidos'}</> : null}
                {' · '}<b>{fmtR0(fin.porDia)}</b> por dia até o fim do mês
              </div>
            ) : (
              <div className="cf-hint">Ainda sem vendas suficientes pra calcular a sua margem.</div>
            )}
            <div className="cf-dim">Contribuição = o que sobra das vendas depois de ingredientes, embalagem e taxas. É ela que paga os custos fixos.</div>
          </>
        )}
      </section>

      {/* Números do mês */}
      <section className="cf-kpis" aria-label="Números do mês">
        <div className="cf-kpi"><span>Vendido em {fin.nomeMes}</span><b>{fmtR0(mes.receita)}</b><small>{mes.pedidos} {mes.pedidos === 1 ? 'pedido' : 'pedidos'} · sem frete</small></div>
        <div className="cf-kpi"><span>Ticket médio</span><b>{fin.ticket ? fmtR(fin.ticket) : '—'}</b><small>por pedido</small></div>
        <div className="cf-kpi"><span>Margem de contribuição</span><b>{fin.mc != null ? pct(fin.mc) : '—'}</b><small>de cada R$ 1 vendido</small></div>
        <div className="cf-kpi">
          <span>Projeção do mês</span>
          {fin.projResultado != null && !semFixos
            ? <><b className={fin.projResultado >= 0 ? 'cf-pos' : 'cf-neg'}>{fmtSinal(fin.projResultado)}</b><small>{fin.projResultado >= 0 ? 'de lucro' : 'de prejuízo'} no ritmo atual</small></>
            : <><b>—</b><small>falta histórico</small></>}
        </div>
      </section>

      <div className="cf-grade duas">
        {/* Meta de lucro */}
        <section className="cf-card" aria-label="Meta de lucro">
          <h2>Meta de lucro</h2>
          <label className="cf-num">
            <span>Quero lucrar</span>
            <span className="cf-campo-num"><i>R$</i><input inputMode="decimal" value={meta} placeholder="0" onChange={e => setMeta(e.target.value)}
              onBlur={salvarMeta} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} /></span>
            <span>por mês</span>
          </label>
          {metaNum > 0 && fin.metaReceita != null ? (
            fin.faltaMeta > 0 ? (
              <div className="cf-hint">
                Pra isso, venda <b>{fmtR0(fin.metaReceita)}</b> em {fin.nomeMes}.<br />
                Faltam <b>{fmtR0(fin.faltaMeta)}</b>{fin.pedidosMeta ? <> · ~{fin.pedidosMeta} pedidos</> : null} · <b>{fmtR0(fin.faltaMeta / fin.diasRestantes)}</b> por dia.
              </div>
            ) : <div className="cf-status ok">✓ Meta do mês batida ({fmtR0(fin.metaReceita)} vendidos)</div>
          ) : <div className="cf-hint">Diga quanto quer tirar de lucro no mês e o app mostra quanto vender por dia.</div>}
        </section>

        {/* Pra onde vai o dinheiro */}
        <section className="cf-card" aria-label="De cada 100 reais vendidos">
          <h2>De cada R$ 100 vendidos</h2>
          {r > 0 ? (
            <>
              <div className="cf-dim" style={{ marginTop: -6 }}>últimos 30 dias · {fmtR0(r)} vendidos</div>
              <div className="cf-barras">
                {partes.map(p => (
                  <div key={p.nome} className="cf-barra" title={`${p.nome}: ${fmtR(p.v)} de cada R$ 100`}>
                    <span>{p.nome}{p.dica ? <small> · {p.dica}</small> : null}</span>
                    <i><em style={{ width: `${Math.min(100, Math.max(0, p.v))}%` }} /></i>
                    <b>{fmtR(p.v)}</b>
                  </div>
                ))}
                <div className={`cf-barra ${sobra >= 0 ? 'lucro' : 'prejuizo'}`} title={`${sobra >= 0 ? 'Lucro' : 'Prejuízo'}: ${fmtR(Math.abs(sobra))} de cada R$ 100`}>
                  <span>{sobra >= 0 ? 'Sobra (lucro)' : 'Falta (prejuízo)'}</span>
                  <i><em style={{ width: `${Math.min(100, Math.abs(sobra))}%` }} /></i>
                  <b>{sobra >= 0 ? '' : '− '}{fmtR(Math.abs(sobra))}</b>
                </div>
              </div>
            </>
          ) : <div className="cf-hint">Sem vendas nos últimos 30 dias.</div>}
        </section>
      </div>

      {/* Últimos meses */}
      <section className="cf-card" aria-label="Últimos meses">
        <h2>Últimos meses</h2>
        <table className="cf-tabela">
          <thead><tr><th>Mês</th><th>Vendido</th><th>Pedidos</th><th>Resultado</th></tr></thead>
          <tbody>
            {fin.meses.filter((m, i, l) => m.atual || m.pedidos > 0 || l.slice(0, i).some(x => x.pedidos > 0)).map(m => (
              <tr key={m.nome}>
                <td>{m.nome}{m.atual ? <small>até agora</small> : null}</td>
                <td>{fmtR0(m.receita)}</td>
                <td>{m.pedidos}</td>
                <td className={semFixos ? '' : m.resultado >= 0 ? 'cf-pos' : 'cf-neg'}>{semFixos ? '—' : <>{fmtSinal(m.resultado)}<small>{m.resultado >= 0 ? 'lucro' : 'prejuízo'}</small></>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="cf-dim">Resultado = contribuição das vendas − custos fixos de hoje ({fmtR0(fin.fixos)}/mês).</div>
      </section>

      {fin.semCusto.length > 0 && (
        <section className="cf-card cf-aviso" aria-label="Produtos sem custo">
          <b>{fin.semCusto.length === 1 ? '1 doce vendido sem custo cadastrado' : `${fin.semCusto.length} doces vendidos sem custo cadastrado`}</b>
          <div className="cf-hint">{fin.semCusto.slice(0, 6).join(', ')}{fin.semCusto.length > 6 ? '…' : ''}. Eles entram com custo zero, então a margem e o lucro aparecem maiores do que são.</div>
          <div><button className="pd-btn" onClick={() => navigate('/produtos')}>Ver produtos</button></div>
        </section>
      )}
    </>
  )
}

// ── Custos ───────────────────────────────────────────────────────────────────
function formDeCusto(cfg) {
  return {
    custoItens: (cfg.custoItens || DEFAULT_ITENS).map(i => ({ ...i, valor: i.valor ? String(i.valor) : '' })),
    unidadesAuto: cfg.unidadesAuto !== false,
    unidadesProjetadas: String(cfg.unidadesProjetadas ?? 100),
    margem: String(cfg.margem ?? 30),
    fatorDesperdicio: String(cfg.fatorDesperdicio ?? 0),
    taxaIfood: String(cfg.taxaIfood ?? 27),
    embalagemDeliveryIds: cfg.embalagemDeliveryIds || [],
    embalagemEncomendaIds: cfg.embalagemEncomendaIds || [],
  }
}

function AbaCustos({ cfg, setCfg, embalagens, fin, show }) {
  const [inicial, setInicial] = useState(() => formDeCusto(cfg))
  const [f, setF] = useState(inicial)
  const [novo, setNovo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const sujo = !iguais(f, inicial)
  const total = somaItens(f.custoItens)
  const auto30 = fin?.unidades30d || 0
  const autoValido = auto30 >= MIN_UNIDADES_AUTO
  const unidades = f.unidadesAuto && autoValido ? auto30 : num(f.unidadesProjetadas)
  const rateio = unidades > 0 ? total / unidades : 0

  const addItem = () => {
    const nome = novo.trim()
    if (!nome) return
    set('custoItens', [...f.custoItens, { id: novoId(), nome, valor: '' }])
    setNovo('')
  }
  const toggleEmb = (k, id) => set(k, f[k].includes(id) ? f[k].filter(x => x !== id) : [...f[k], id])

  async function salvar() {
    setSalvando(true)
    try {
      const novoCfg = await salvarConfigParcial({
        custoItens: f.custoItens.filter(i => i.nome.trim()).map(i => ({ id: i.id, nome: i.nome.trim(), valor: num(i.valor) })),
        unidadesAuto: f.unidadesAuto,
        unidadesProjetadas: Math.max(1, Math.round(unidades)) || 100,
        margem: num(f.margem), fatorDesperdicio: num(f.fatorDesperdicio), taxaIfood: num(f.taxaIfood),
        embalagemDeliveryIds: f.embalagemDeliveryIds, embalagemEncomendaIds: f.embalagemEncomendaIds,
      })
      setCfg(novoCfg)
      const nf = formDeCusto(novoCfg); setInicial(nf); setF(nf)
      show('Custos salvos — os preços sugeridos já usam os valores novos')
    } catch (e) { show('Erro ao salvar: ' + e.message) }
    finally { setSalvando(false) }
  }

  return (
    <>
      <div className="cf-grade duas">
        <section className="cf-card" aria-label="Custos fixos mensais">
          <div className="cf-topo"><h2>Custos fixos do mês</h2><b className="cf-total">{fmtR(total)}</b></div>
          <div className="cf-linhas">
            {f.custoItens.map(item => (
              <div key={item.id} className="cf-linha">
                <span style={{ flex: 1, minWidth: 0 }}>{item.nome}</span>
                <span className="cf-campo-num"><i>R$</i><input inputMode="decimal" value={item.valor} placeholder="0"
                  onChange={e => set('custoItens', f.custoItens.map(i => i.id === item.id ? { ...i, valor: e.target.value } : i))} /></span>
                <button className="cf-x" aria-label={`Tirar ${item.nome}`} onClick={() => set('custoItens', f.custoItens.filter(i => i.id !== item.id))}>×</button>
              </div>
            ))}
            <div className="cf-linha">
              <input className="pd-input" placeholder="Adicionar custo (ex.: internet, MEI, contador)" value={novo}
                onChange={e => setNovo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addItem() }} />
              <button className="pd-btn verde" disabled={!novo.trim()} onClick={addItem}>Adicionar</button>
            </div>
          </div>
        </section>

        <section className="cf-card" aria-label="Unidades por mês">
          <h2>Unidades vendidas por mês</h2>
          <div className="cf-hint" style={{ marginTop: -4 }}>Divide os custos fixos entre os doces: entra no preço sugerido de cada um.</div>
          <div className="pd-seg" role="group" aria-label="Como contar">
            <button className={f.unidadesAuto ? 'on' : ''} onClick={() => set('unidadesAuto', true)}>Pelas vendas</button>
            <button className={!f.unidadesAuto ? 'on' : ''} onClick={() => set('unidadesAuto', false)}>Eu informo</button>
          </div>
          {f.unidadesAuto ? (
            autoValido
              ? <div className="cf-grande"><b>{auto30}</b><span>un vendidas nos últimos 30 dias</span></div>
              : <div className="cf-status atencao">Só {auto30} un vendidas nos últimos 30 dias, pouco pra calcular. Enquanto isso vale a sua estimativa:
                  <span className="cf-campo-num" style={{ marginLeft: 8 }}><input inputMode="numeric" value={f.unidadesProjetadas} onChange={e => set('unidadesProjetadas', e.target.value)} /><i>un</i></span>
                </div>
          ) : (
            <label className="cf-num"><span>Vendo cerca de</span><span className="cf-campo-num"><input inputMode="numeric" value={f.unidadesProjetadas} onChange={e => set('unidadesProjetadas', e.target.value)} /><i>un</i></span><span>por mês</span></label>
          )}
          <div className="cf-kv"><span>Custo fixo por unidade</span><b>{fmtR(rateio)}</b></div>
        </section>

        <section className="cf-card" aria-label="Preço sugerido">
          <h2>Preço sugerido dos produtos</h2>
          <div className="cf-tres">
            <label className="cf-campo"><span>Margem desejada</span><span className="cf-campo-num"><input inputMode="decimal" value={f.margem} onChange={e => set('margem', e.target.value)} /><i>%</i></span><small>quanto do preço fica de lucro</small></label>
            <label className="cf-campo"><span>Desperdício</span><span className="cf-campo-num"><input inputMode="decimal" value={f.fatorDesperdicio} onChange={e => set('fatorDesperdicio', e.target.value)} /><i>%</i></span><small>sobra, perda, prova</small></label>
            <label className="cf-campo"><span>Taxa do iFood</span><span className="cf-campo-num"><input inputMode="decimal" value={f.taxaIfood} onChange={e => set('taxaIfood', e.target.value)} /><i>%</i></span><small>preço do iFood já cobre</small></label>
          </div>
          <div className="cf-dim">Preço sugerido = (custo do doce + desperdício + {fmtR(rateio)} de custo fixo) com {num(f.margem)}% de margem.</div>
        </section>

        <section className="cf-card" aria-label="Embalagens">
          <h2>Embalagens</h2>
          <div className="cf-campo"><span>Sai em todo pedido (sacola, caixa)</span>
            <MultiSelect embalagens={embalagens} selecionadas={f.embalagemDeliveryIds} onToggle={id => toggleEmb('embalagemDeliveryIds', id)} placeholder="Escolher a embalagem de saída…" />
          </div>
          <div className="cf-campo"><span>Padrão da encomenda</span>
            <MultiSelect embalagens={embalagens} selecionadas={f.embalagemEncomendaIds} onToggle={id => toggleEmb('embalagemEncomendaIds', id)} placeholder="Escolher a embalagem padrão…" />
          </div>
        </section>
      </div>
      <BarraSalvar sujo={sujo} salvando={salvando} onSalvar={salvar} onDescartar={() => setF(inicial)} />
    </>
  )
}

function MultiSelect({ embalagens, selecionadas, onToggle, placeholder }) {
  const [aberto, setAberto] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const fora = e => { if (ref.current && !ref.current.contains(e.target)) setAberto(false) }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [])
  const sel = embalagens.filter(e => selecionadas.includes(e.id))
  const media = sel.length ? sel.reduce((s, e) => s + (e.custoUnit || 0), 0) / sel.length : null
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="cf-select" onClick={() => setAberto(a => !a)} aria-expanded={aberto}>
        {sel.length ? sel.map(e => e.nome).join(', ') : <span style={{ color: 'var(--text-tertiary)' }}>{placeholder}</span>}
        <i aria-hidden="true">{aberto ? '▲' : '▼'}</i>
      </button>
      {aberto && (
        <div className="cf-opcoes">
          {embalagens.length === 0 && <div className="cf-hint" style={{ padding: 12 }}>Nenhuma embalagem cadastrada em Insumos.</div>}
          {embalagens.map(e => {
            const on = selecionadas.includes(e.id)
            return (
              <button type="button" key={e.id} className={on ? 'on' : ''} onClick={() => onToggle(e.id)}>
                <span>{on ? '✓ ' : ''}{e.nome}</span><small>{fmtR(e.custoUnit)}</small>
              </button>
            )
          })}
        </div>
      )}
      {media != null && <div className="cf-dim" style={{ marginTop: 6 }}>{fmtR(media)} por pedido{sel.length > 1 ? ` (média de ${sel.length})` : ''}</div>}
    </div>
  )
}

function BarraSalvar({ sujo, salvando, onSalvar, onDescartar }) {
  return (
    <div className={`cf-salvar${sujo ? ' sujo' : ''}`}>
      <span>{sujo ? 'Alterações não salvas' : 'Tudo salvo'}</span>
      {sujo && <button className="pd-btn vazado" disabled={salvando} onClick={onDescartar}>Desfazer</button>}
      <button className="pd-btn verde" disabled={!sujo || salvando} onClick={onSalvar}>{salvando ? 'Salvando…' : 'Salvar'}</button>
    </div>
  )
}

// ── Entrega e Pix ────────────────────────────────────────────────────────────
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
function formDeEntrega(d = {}) {
  return {
    lojaCEP: d.lojaCEP || '', lojaEndereco: String(d.lojaEndereco || '').trim(), lojaPhone: d.lojaPhone || '',
    lalamoveProducao: d.lalamoveProducao === true, pix: d.pix || '',
    raioKm: String(typeof d.raioKm === 'number' ? d.raioKm : 20), freteGratis: String(d.freteGratis ?? 0), freteMargemPct: String(d.freteMargemPct ?? 10), freteMargemMin: String(d.freteMargemMin ?? 1),
    diasEntrega: d.diasEntrega || [], freteTiers: (d.freteTiers || []).map(t => ({ ate: String(t.ate), valor: String(t.valor) })),
  }
}

async function geocodeCep(cep) {
  const clean = (cep || '').replace(/\D/g, '')
  if (clean.length !== 8) return null
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cep/v2/${clean}`)
    if (!r.ok) return null
    const d = await r.json()
    const c = d.location?.coordinates
    if (c?.latitude && c?.longitude) return { lat: parseFloat(c.latitude), lng: parseFloat(c.longitude) }
    const query = [d.neighborhood, d.city, d.state, 'Brazil'].filter(Boolean).join(', ')
    const nr = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`)
    const nd = await nr.json()
    if (nd?.[0]) return { lat: parseFloat(nd[0].lat), lng: parseFloat(nd[0].lon) }
  } catch { /* sem rede */ }
  return null
}

function AbaEntrega({ show }) {
  const [inicial, setInicial] = useState(null)
  const [f, setF] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [remoto, setRemoto] = useState({})
  useEffect(() => {
    loadUserConfig().then(c => { const d = c?.delivery || {}; setRemoto(d); const x = formDeEntrega(d); setInicial(x); setF(x) }).catch(() => { const x = formDeEntrega(); setInicial(x); setF(x) })
  }, [])
  if (!f) return <div className="pd-vazio">Carregando…</div>
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const sujo = !iguais(f, inicial)
  const pctM = num(f.freteMargemPct), minM = num(f.freteMargemMin)
  const exemplo = c => Math.ceil((c + Math.max(minM, c * pctM / 100)) * 2) / 2

  async function salvar() {
    setSalvando(true)
    try {
      const cepMudou = f.lojaCEP.replace(/\D/g, '') !== String(remoto.lojaCEP || '').replace(/\D/g, '')
      const coords = cepMudou || !remoto.lojaLat ? await geocodeCep(f.lojaCEP) : null
      const atual = (await loadUserConfig().catch(() => null))?.delivery || remoto
      const delivery = {
        ...atual,
        lojaCEP: f.lojaCEP.trim(), lojaEndereco: f.lojaEndereco.trim(), lojaPhone: f.lojaPhone.trim(),
        lalamoveProducao: f.lalamoveProducao, pix: f.pix.trim(),
        raioKm: f.raioKm === '' ? 20 : Math.max(0, num(f.raioKm)), freteGratis: num(f.freteGratis), freteMargemPct: f.freteMargemPct === '' ? 10 : num(f.freteMargemPct), freteMargemMin: f.freteMargemMin === '' ? 1 : num(f.freteMargemMin),
        diasEntrega: [...f.diasEntrega].sort(),
        freteTiers: f.freteTiers.filter(t => t.ate !== '' && t.valor !== '').map(t => ({ ate: num(t.ate), valor: num(t.valor) })).sort((a, b) => a.ate - b.ate),
        lojaLat: coords?.lat ?? atual.lojaLat ?? null, lojaLng: coords?.lng ?? atual.lojaLng ?? null,
      }
      await salvarConfigParcial({ delivery })
      setRemoto(delivery)
      const x = formDeEntrega(delivery); setInicial(x); setF(x)
      // Acabou de ligar o Lalamove valendo: cadastra lá o endereço dos avisos (motorista saiu, entregou)
      if (delivery.lalamoveProducao && !atual.lalamoveProducao) {
        try { await configurarAvisosLalamove(false); show('Salvo! Lalamove valendo, com avisos ligados.') }
        catch (e) { show(`Salvo, mas os avisos da Lalamove falharam: ${e.message}`) }
      } else show(cepMudou && !coords ? 'Salvo (não achei a localização desse CEP)' : 'Entrega salva')
    } catch (e) { show('Erro ao salvar: ' + e.message) }
    finally { setSalvando(false) }
  }

  return (
    <>
      <div className="cf-grade duas">
        <section className="cf-card" aria-label="Loja">
          <h2>Loja</h2>
          <label className="cf-campo"><span>CEP</span><input className="pd-input" inputMode="numeric" value={f.lojaCEP} onChange={e => set('lojaCEP', e.target.value)} placeholder="00000-000" maxLength={9} /></label>
          <label className="cf-campo"><span>Endereço completo</span><input className="pd-input" value={f.lojaEndereco} onChange={e => set('lojaEndereco', e.target.value)} placeholder="Rua, número, apto" /><small>Aparece no cardápio, pra retirada, e é de onde o motorista sai.</small></label>
          <label className="cf-campo"><span>Telefone da loja</span><input className="pd-input" type="tel" inputMode="tel" value={f.lojaPhone} onChange={e => set('lojaPhone', e.target.value)} placeholder="(21) 99999-9999" /><small>O motorista do Lalamove liga aqui na hora da coleta.</small></label>
        </section>

        <section className={`cf-card${f.lalamoveProducao ? ' cf-valendo' : ''}`} aria-label="Lalamove">
          <div className="cf-topo">
            <h2>Lalamove</h2>
            <button type="button" role="switch" aria-checked={f.lalamoveProducao} aria-label="Lalamove valendo" className={`pd-switch${f.lalamoveProducao ? ' on cf-switch-ambar' : ''}`}
              onClick={() => {
                if (!f.lalamoveProducao && !window.confirm('Ligar o Lalamove de verdade?\n\nA partir daí, "Chamar motorista" chama motorista e cobra da sua carteira Lalamove.')) return
                set('lalamoveProducao', !f.lalamoveProducao)
              }}><span /></button>
          </div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{f.lalamoveProducao ? 'Valendo' : 'Modo teste'}</div>
          <div className="cf-hint">{f.lalamoveProducao
            ? 'O despacho chama motorista de verdade e cobra da sua carteira Lalamove.'
            : 'O despacho é de mentira (sandbox): nenhum motorista vem e nada é cobrado. O frete do cardápio sempre usa o preço real.'}</div>
          {f.lalamoveProducao && !f.lojaPhone.trim() && <div className="cf-status atencao">Preencha o telefone da loja: sem ele o app não chama motorista.</div>}
        </section>

        <section className="cf-card" aria-label="Pix">
          <h2>Pix</h2>
          <label className="cf-campo"><span>Chave Pix</span><input className="pd-input" value={f.pix} onChange={e => set('pix', e.target.value)} placeholder="CNPJ, e-mail, telefone ou chave aleatória" />
            <small>Reserva pro Pix copia e cola quando o Mercado Pago não responder. O normal é o Pix automático (confirma sozinho).</small></label>
        </section>

        <section className="cf-card" aria-label="Frete">
          <h2>Frete</h2>
          <label className="cf-num"><span>Entrega só até</span><span className="cf-campo-num"><input inputMode="decimal" value={f.raioKm} onChange={e => set('raioKm', e.target.value)} /><i>km</i></span><span>da loja</span></label>
          <div className="cf-dim" style={{ marginTop: -6 }}>Em linha reta. Mais longe que isso o cardápio e a GuaxiMina não aceitam entrega (só retirada). 0 = sem limite.</div>
          <label className="cf-num"><span>Frete grátis acima de</span><span className="cf-campo-num"><i>R$</i><input inputMode="decimal" value={f.freteGratis} onChange={e => set('freteGratis', e.target.value)} /></span></label>
          <div className="cf-dim" style={{ marginTop: -6 }}>0 = nunca grátis</div>
          <label className="cf-num"><span>Margem sobre o Lalamove</span>
            <span className="cf-campo-num"><input inputMode="decimal" value={f.freteMargemPct} onChange={e => set('freteMargemPct', e.target.value)} /><i>%</i></span>
            <span>mínimo</span><span className="cf-campo-num"><i>R$</i><input inputMode="decimal" value={f.freteMargemMin} onChange={e => set('freteMargemMin', e.target.value)} /></span></label>
          <div className="cf-dim">Ex.: Lalamove cobra R$ 9 → cliente paga {fmtR(exemplo(9))} · R$ 12 → {fmtR(exemplo(12))} · R$ 20 → {fmtR(exemplo(20))}.</div>
        </section>

        <section className="cf-card" aria-label="Dias de entrega">
          <h2>Dias de entrega</h2>
          <div className="cf-dias" role="group" aria-label="Dias da semana">
            {DIAS.map((d, n) => {
              const on = f.diasEntrega.includes(n)
              return <button key={d} type="button" aria-pressed={on} className={on ? 'on' : ''} onClick={() => set('diasEntrega', on ? f.diasEntrega.filter(x => x !== n) : [...f.diasEntrega, n])}>{d}</button>
            })}
          </div>
          <div className="cf-dim">O cardápio mostra os próximos 6 desses dias, a partir de amanhã.</div>
        </section>

        <section className="cf-card" aria-label="Faixas de frete">
          <div className="cf-topo"><h2>Faixas de frete (reserva)</h2><button className="pd-btn vazado" onClick={() => set('freteTiers', [...f.freteTiers, { ate: '', valor: '' }])}>+ Faixa</button></div>
          <div className="cf-dim" style={{ marginTop: -4 }}>Só usadas se o cálculo do Lalamove falhar.</div>
          {f.freteTiers.length === 0 && <div className="cf-hint">Nenhuma faixa.</div>}
          {f.freteTiers.map((t, i) => (
            <div key={i} className="cf-num">
              <span>até</span><span className="cf-campo-num"><input inputMode="decimal" value={t.ate} onChange={e => set('freteTiers', f.freteTiers.map((x, j) => j === i ? { ...x, ate: e.target.value } : x))} /><i>km</i></span>
              <span>→</span><span className="cf-campo-num"><i>R$</i><input inputMode="decimal" value={t.valor} onChange={e => set('freteTiers', f.freteTiers.map((x, j) => j === i ? { ...x, valor: e.target.value } : x))} /></span>
              <button className="cf-x" aria-label="Tirar faixa" onClick={() => set('freteTiers', f.freteTiers.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
        </section>
      </div>
      <BarraSalvar sujo={sujo} salvando={salvando} onSalvar={salvar} onDescartar={() => setF(inicial)} />
    </>
  )
}
