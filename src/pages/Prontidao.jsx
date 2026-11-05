import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../hooks/useData'
import {
  getProdutos, getEncomendas, reconciliarBaixasPedidos, reservasPorProduto,
  getProntidaoLotes, moverProntidao, desfazerMovimento, embalarProduto, desfazerEmbalar,
  corrigirEtapaProntidao, baixaProntidao, descartarVencidosProntidao, setProdutoProntidao,
} from '../services/db'
import {
  FLUXOS, LOCAL, fluxoAtivo, analisarProduto, sugerirConfig, etapasDoProduto, metaPadrao, hhmm, fmtDuracao, usaEmbalagem,
} from '../lib/prontidao'
import { suportaPush, ativarLembrete, lerLembrete, desativarLembrete, testarLembrete } from '../lib/push'

const STATUS = {
  pausar:  { cor: '#f87171', bg: 'rgba(248,113,113,.14)', ordem: 0 },
  atencao: { cor: '#f5b544', bg: 'rgba(245,181,68,.14)',  ordem: 1 },
  pronto:  { cor: '#4ade80', bg: 'rgba(74,222,128,.13)',  ordem: 2 },
}

const SQL_SETUP = `ALTER TABLE produtos ADD COLUMN IF NOT EXISTS prontidao jsonb;
CREATE TABLE IF NOT EXISTS prontidao_lotes (
  id          bigserial primary key,
  produto_id  bigint not null references produtos(id) on delete cascade,
  etapa       text not null,
  qtd         numeric not null default 0,
  entrou_em   timestamptz not null default now(),
  user_id     uuid default auth.uid() references auth.users(id) on delete cascade
);
CREATE INDEX IF NOT EXISTS prontidao_lotes_produto ON prontidao_lotes(produto_id, etapa);
ALTER TABLE prontidao_lotes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own_data" ON prontidao_lotes;
CREATE POLICY "own_data" ON prontidao_lotes FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
NOTIFY pgrst, 'reload schema';`

const fmtN = (n) => String(Math.round((n || 0) * 10) / 10).replace('.', ',')

function textoSugestao(s, prod) {
  if (s.tipo === 'produzir') return `Produzir ${fmtN(s.n)}`
  if (s.tipo === 'vencidos') {
    const e = etapasDoProduto(prod).find(x => x.key === s.etapa)
    return `Descartar ${fmtN(s.n)} vencido(s) · ${e?.nome?.toLowerCase() || s.etapa}`
  }
  if (s.verbo === 'Tirar pro degelo') return `Tirar ${fmtN(s.n)} pro degelo`
  return `${s.verbo} ${fmtN(s.n)}`
}

export default function Prontidao() {
  const navigate = useNavigate()
  const { data: produtos, loading: loadProd, reload: reloadProd } = useData(getProdutos)
  const { data: encomendas, reload: reloadEnc } = useData(getEncomendas)
  const [lotes, setLotes]           = useState(null)
  const [erroTabela, setErroTabela] = useState(null)
  const [agora, setAgora]           = useState(Date.now())
  const [filtro, setFiltro]         = useState('tudo')
  const [grupoSel, setGrupoSel]     = useState(undefined) // undefined = automático (1º com tarefa)
  const [verCards, setVerCards]     = useState(() => { try { return localStorage.getItem('prontidao_cards') !== '0' } catch { return true } })
  const [mover, setMover]           = useState(null) // { prod, de, para, n }
  const [etapaAberta, setEtapaAberta] = useState(null) // { prod, etapaKey }
  const [config, setConfig]         = useState(null) // prod
  const [aviso, setAviso]           = useState(null) // { msg, undo? }
  const [aplicando, setAplicando]   = useState(false)
  const [verLembrete, setVerLembrete] = useState(false)
  const [verNaoAcomp, setVerNaoAcomp] = useState(false)

  async function carregarLotes() {
    try { setLotes(await getProntidaoLotes()); setErroTabela(null) }
    catch (e) { setErroTabela(e?.message || 'erro'); setLotes([]) }
  }
  // Pedidos entregues (inclusive pelo Lalamove) baixam antes de mostrar o board
  useEffect(() => { reconciliarBaixasPedidos().catch(() => {}).finally(() => { carregarLotes(); reloadProd() }) }, [])
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 60000); return () => clearInterval(t) }, [])
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 6000); return () => clearTimeout(t) }, [aviso])
  const recarregar = () => Promise.all([carregarLotes(), reloadProd(), reloadEnc()])
  const reservas = useMemo(() => reservasPorProduto(encomendas, produtos), [encomendas, produtos])

  const cardapio = useMemo(() => (produtos || []).filter(p => p.ativo !== false && p.tipo !== 'combo'), [produtos])
  const semFluxo = cardapio.filter(p => !p.prontidao?.fluxo)
  const naoAcompanhados = cardapio.filter(p => p.prontidao?.fluxo === 'nenhum')

  const analises = useMemo(() => cardapio
    .filter(p => fluxoAtivo(p))
    .map(p => ({ prod: p, a: analisarProduto(p, lotes || [], agora, reservas[p.id] || 0) })), [cardapio, lotes, agora, reservas])

  const contagem = { pronto: 0, atencao: 0, pausar: 0 }
  analises.forEach(x => { contagem[x.a.status]++ })

  const secoes = [...new Set(analises.map(x => x.prod.secao).filter(Boolean))]
  const visiveis = analises.filter(x =>
    filtro === 'tudo' ? true
      : filtro === 'mim' ? x.a.status !== 'pronto'
      : x.prod.secao === filtro)

  const tarefas = analises
    .flatMap(x => x.a.sugestoes.map(s => ({ ...s, prod: x.prod, status: x.a.status })))
    .sort((a, b) => STATUS[a.status].ordem - STATUS[b.status].ordem)

  function abrirTarefa(t) {
    if (t.tipo === 'mover') setMover({ prod: t.prod, de: t.de, para: t.para, n: t.n })
    else if (t.tipo === 'vencidos') setEtapaAberta({ prod: t.prod, etapaKey: t.etapa })
    else navigate('/mise-en-place', { state: { adicionar: [{ produtoId: t.prod.id, n: t.n }] } })
  }

  // Quadro de ações: executa com um toque (com Desfazer)
  async function executar(t, qtd, destinos) {
    try {
      if (t.tipo === 'produzir') { navigate('/mise-en-place', { state: { adicionar: [{ produtoId: t.prod.id, n: qtd }] } }); return }
      if (t.tipo === 'vencidos') {
        const e = etapasDoProduto(t.prod).find(x => x.key === t.etapa)
        await descartarVencidosProntidao(t.prod.id, t.etapa, e?.validadeH || 0)
        await recarregar(); setAviso({ msg: `${fmtN(t.n)} descartado(s)` }); return
      }
      if (t.de === 'embalar') {
        const info = await embalarProduto(t.prod, destinos || [{ etapa: t.para, qtd }])
        await recarregar()
        setAviso({ msg: `${fmtN(info.n)} embalado(s)${info.embalagens.length ? ' · embalagens baixadas' : ''}`, undo: async () => { await desfazerEmbalar(info); await recarregar(); setAviso({ msg: 'Desfeito' }) } })
        return
      }
      const mov = await moverProntidao(t.prod.id, t.de, t.para, qtd)
      await recarregar()
      setAviso({ msg: `${t.verbo}: ${fmtN(mov.n)} · ${t.prod.nome}`, undo: async () => { await desfazerMovimento(mov); await recarregar(); setAviso({ msg: 'Desfeito' }) } })
    } catch (e) { setAviso({ msg: 'Erro: ' + e.message }) }
  }

  // Produtos já configurados que ainda não decidiram sobre a etapa de embalagem
  const pedemEmbalagem = analises.map(x => x.prod).filter(p => p.prontidao?.embalar === undefined && sugerirConfig(p).embalar && fluxoAtivo(p) !== 'choux')
  async function decidirEmbalagem(ligar) {
    setAplicando(true)
    try {
      for (const p of pedemEmbalagem) await setProdutoProntidao(p, { ...p.prontidao, embalar: ligar })
      await recarregar()
      setAviso({ msg: ligar ? `Etapa de embalagem ligada em ${pedemEmbalagem.length} produto(s)` : 'Ok, sem etapa de embalagem' })
    } catch (e) { setAviso({ msg: 'Erro: ' + e.message }) }
    finally { setAplicando(false) }
  }

  async function aceitarSugestoesTodos() {
    setAplicando(true)
    try {
      for (const p of semFluxo) await setProdutoProntidao(p, sugerirConfig(p))
      await recarregar()
      setAviso({ msg: `${semFluxo.length} produto(s) configurados — ajuste o que precisar na ⚙` })
    } catch (e) { setAviso({ msg: 'Erro: ' + e.message }) }
    finally { setAplicando(false) }
  }

  const loading = loadProd || lotes === null

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', padding: '0 4px', display: 'flex', alignItems: 'center' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <div>
              <div className="topbar-title">Prontidão</div>
              <div className="topbar-sub">{new Date(agora).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })} · {hhmm(agora)}</div>
            </div>
          </div>
          <button onClick={() => setVerLembrete(true)} title="Lembrete de fim do dia" style={{ background: 'none', border: '1px solid #333', borderRadius: 8, padding: '6px 10px', fontSize: 16, cursor: 'pointer', color: 'var(--text-primary)' }}>🔔</button>
        </div>
      </div>
      {verLembrete && <LembreteSheet onClose={() => setVerLembrete(false)} />}

      <div className="page-content" style={{ maxWidth: 760, margin: '0 auto' }}>
        {loading ? <div className="loading">Carregando...</div> : erroTabela ? (
          <SetupSql erro={erroTabela} onRetry={carregarLotes} />
        ) : (
          <>
            {/* Resumo */}
            {analises.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                {[['pronto', 'prontos'], ['atencao', 'atenção'], ['pausar', 'pausar']].map(([k, l]) => (
                  <div key={k} style={{ flex: 1, minWidth: 90, padding: '10px 12px', borderRadius: 10, background: STATUS[k].bg, border: `1px solid ${STATUS[k].cor}33` }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: STATUS[k].cor, lineHeight: 1.1 }}>{contagem[k]}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>{l}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Etapa de embalagem — decisão única pros já configurados */}
            {pedemEmbalagem.length > 0 && (
              <div className="card" style={{ padding: '12px 14px', marginBottom: 12, borderLeft: '3px solid #c084fc' }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 3 }}>📦 Acompanhar o que falta embalar?</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
                  Liga a etapa "Sem embalagem" em: {pedemEmbalagem.map(p => p.nome).join(', ')}. O que sai do Montado cai nela e só conta como pronto depois de embalado.
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-primary" style={{ flex: 2 }} disabled={aplicando} onClick={() => decidirEmbalagem(true)}>Ligar nos {pedemEmbalagem.length}</button>
                  <button disabled={aplicando} onClick={() => decidirEmbalagem(false)} style={{ flex: 1, borderRadius: 10, border: '1px solid #333', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>Agora não</button>
                </div>
              </div>
            )}

            {/* Quadro de ações */}
            {tarefas.length > 0 && (
              <QuadroAcoes tarefas={tarefas} analises={analises} agora={agora} grupoSel={grupoSel} setGrupoSel={setGrupoSel}
                onExecutar={executar}
                onPlanejarTudo={(lista) => navigate('/mise-en-place', { state: { adicionar: lista.map(t => ({ produtoId: t.prod.id, n: t.n })) } })} />
            )}

            {/* Produtos (cartões) */}
            {analises.length > 0 && (
              <button onClick={() => setVerCards(v => { try { localStorage.setItem('prontidao_cards', v ? '0' : '1') } catch {} return !v })}
                style={{ width: '100%', display: 'flex', alignItems: 'center', padding: '8px 2px', marginBottom: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                <span style={{ flex: 1, textAlign: 'left', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Produtos ({analises.length})</span>
                <span style={{ fontSize: 13 }}>{verCards ? 'recolher ▲' : 'mostrar ▼'}</span>
              </button>
            )}

            {/* Filtros */}
            {analises.length > 0 && verCards && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto', paddingBottom: 2 }}>
                {[['tudo', 'Tudo'], ['mim', 'Precisa de mim'], ...secoes.map(s => [s, s])].map(([k, l]) => (
                  <button key={k} onClick={() => setFiltro(k)} style={{
                    padding: '6px 13px', borderRadius: 20, fontSize: 13, whiteSpace: 'nowrap', cursor: 'pointer', flexShrink: 0,
                    border: `1px solid ${filtro === k ? 'var(--teal)' : '#333'}`,
                    background: filtro === k ? 'var(--teal)' : 'transparent',
                    color: filtro === k ? '#fff' : 'var(--text-secondary)', fontWeight: filtro === k ? 700 : 400,
                  }}>{l}</button>
                ))}
              </div>
            )}

            {verCards && visiveis.map(({ prod, a }) => (
              <CardProduto key={prod.id} prod={prod} a={a}
                onMover={(de, para, n) => setMover({ prod, de, para, n })}
                onEtapa={(etapaKey) => setEtapaAberta({ prod, etapaKey })}
                onConfig={() => setConfig(prod)}
                onTarefa={abrirTarefa} />
            ))}
            {verCards && analises.length > 0 && visiveis.length === 0 && (
              <div className="empty"><span>{filtro === 'mim' ? 'Tudo pronto por aqui ✓' : 'Nada nesse filtro'}</span></div>
            )}

            {/* Sem fluxo definido */}
            {semFluxo.length > 0 && (
              <div className="card" style={{ padding: '12px 14px', marginTop: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                  Falta definir o fluxo ({semFluxo.length})
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 10 }}>
                  Já deixei um palpite pra cada produto pelo nome. O estoque atual entra todo na primeira etapa (freezer).
                </div>
                <button onClick={aceitarSugestoesTodos} disabled={aplicando} className="btn-primary" style={{ marginBottom: 10 }}>
                  {aplicando ? 'Configurando...' : `Usar os palpites pros ${semFluxo.length}`}
                </button>
                {semFluxo.map(p => {
                  const s = sugerirConfig(p)
                  return (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: '1px solid #333' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{p.nome}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>palpite: {FLUXOS[s.fluxo].nome}</div>
                      </div>
                      <button onClick={() => setConfig(p)} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--teal)', background: 'transparent', color: 'var(--teal)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Definir</button>
                    </div>
                  )
                })}
              </div>
            )}

            {naoAcompanhados.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <button onClick={() => setVerNaoAcomp(v => !v)} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', fontSize: 12, cursor: 'pointer', padding: 0 }}>
                  {naoAcompanhados.length} não acompanhado(s) {verNaoAcomp ? '▲' : '▼'}
                </button>
                {verNaoAcomp && naoAcompanhados.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', padding: '6px 0', fontSize: 13, color: 'var(--text-secondary)' }}>
                    <span style={{ flex: 1 }}>{p.nome}</span>
                    <button onClick={() => setConfig(p)} style={{ background: 'none', border: 'none', color: 'var(--teal)', fontSize: 12, cursor: 'pointer' }}>acompanhar</button>
                  </div>
                ))}
              </div>
            )}

            {cardapio.length === 0 && (
              <div className="empty"><span>Nenhum produto no cardápio. Ligue em Produtos → Organizar cardápio.</span></div>
            )}
          </>
        )}
      </div>

      {mover && (
        <MoverSheet {...mover} lotes={lotes || []} agora={agora} onClose={() => setMover(null)}
          onDone={async (mov) => {
            setMover(null)
            await recarregar()
            const ehEmb = Array.isArray(mov.movs)
            setAviso({ msg: `${fmtN(mov.n)} ${ehEmb ? 'embalado(s)' : 'movido(s)'}`, undo: async () => { await (ehEmb ? desfazerEmbalar(mov) : desfazerMovimento(mov)); await recarregar(); setAviso({ msg: 'Desfeito' }) } })
          }} />
      )}
      {etapaAberta && (
        <EtapaSheet {...etapaAberta} lotes={lotes || []} agora={agora} onClose={() => setEtapaAberta(null)}
          onDone={async (msg) => { setEtapaAberta(null); await recarregar(); setAviso({ msg }) }} />
      )}
      {config && (
        <ConfigSheet prod={config} onClose={() => setConfig(null)}
          onDone={async () => { setConfig(null); await recarregar(); setAviso({ msg: 'Fluxo salvo' }) }} />
      )}

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

// ── Quadro de ações: agrupado pelo tipo de trabalho ──────────────────────────
const GRUPOS = [
  { key: 'embalar',   icon: '📦', nome: 'Embalar',   cor: '#c084fc', match: t => t.tipo === 'mover' && t.verbo === 'Embalar' },
  { key: 'forno',     icon: '🔥', nome: 'Forno',     cor: '#fb923c', match: t => t.tipo === 'mover' && (t.verbo === 'Assar' || t.verbo === 'Reassar') },
  { key: 'degelo',    icon: '💧', nome: 'Degelo',    cor: '#2dd4bf', match: t => t.tipo === 'mover' && t.verbo === 'Tirar pro degelo' },
  { key: 'rechear',   icon: '🧁', nome: 'Rechear',   cor: '#4ade80', match: t => t.tipo === 'mover' && t.verbo === 'Rechear' },
  { key: 'mover',     icon: '➡️', nome: 'Mover',     cor: '#94a3b8', match: t => t.tipo === 'mover' },
  { key: 'produzir',  icon: '🧾', nome: 'Produzir',  cor: '#14b8a6', match: t => t.tipo === 'produzir' },
  { key: 'descartar', icon: '🗑', nome: 'Descartar', cor: '#f87171', match: t => t.tipo === 'vencidos' },
]
const FEITO = { Embalar: 'Embalei', Assar: 'Assei', Reassar: 'Reassei', 'Tirar pro degelo': 'Tirei', Rechear: 'Recheei', Mover: 'Movi' }
const grupoDe = (t) => (GRUPOS.find(g => g.key !== 'mover' && g.key !== 'descartar' && g.match(t)) || GRUPOS.find(g => g.match(t)))?.key

function QuadroAcoes({ tarefas, analises, agora, grupoSel, setGrupoSel, onExecutar, onPlanejarTudo }) {
  const porGrupo = {}
  for (const t of tarefas) (porGrupo[grupoDe(t)] ||= []).push(t)
  const visiveis = GRUPOS.filter(g => porGrupo[g.key]?.length || ['embalar', 'forno', 'degelo', 'produzir'].includes(g.key))
  const auto = visiveis.find(g => porGrupo[g.key]?.length)?.key || null
  const sel = grupoSel === undefined ? auto : grupoSel
  const g = GRUPOS.find(x => x.key === sel)
  const lista = sel ? (porGrupo[sel] || []) : []

  const resumo = (k) => {
    const ts = porGrupo[k] || []
    if (!ts.length) return 'nada agora'
    const un = ts.reduce((s, t) => s + (t.n || 0), 0)
    return ts.length === 1 ? `${ts[0].prod.nome.split(' ').slice(0, 3).join(' ')} · ${fmtN(un)}` : `${ts.length} produtos · ${fmtN(un)} un`
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.8, margin: '0 2px 8px' }}>O que fazer agora</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, marginBottom: 10 }}>
        {visiveis.map(gr => {
          const n = porGrupo[gr.key]?.length || 0
          const on = sel === gr.key
          return (
            <button key={gr.key} onClick={() => setGrupoSel(on ? null : gr.key)} disabled={!n} style={{
              textAlign: 'left', padding: '11px 12px', borderRadius: 14, cursor: n ? 'pointer' : 'default', minHeight: 76,
              background: on ? `${gr.cor}1a` : 'var(--bg-card)', border: `${on ? 2 : 1}px solid ${on ? gr.cor : '#333'}`,
              opacity: n ? 1 : 0.38, color: 'var(--text-primary)', display: 'flex', flexDirection: 'column', gap: 2,
            }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>{gr.icon}</span>
              <span style={{ fontSize: 15, fontWeight: 800, color: n ? gr.cor : 'var(--text-secondary)' }}>{gr.nome}{n > 1 ? ` (${n})` : ''}</span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{resumo(gr.key)}</span>
            </button>
          )
        })}
      </div>

      {g && lista.length > 0 && (
        <div style={{ borderRadius: 14, border: `2px solid ${g.cor}`, background: 'var(--bg-card)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid #2a2a2a' }}>
            <span style={{ fontSize: 16 }}>{g.icon}</span>
            <b style={{ flex: 1, fontSize: 14 }}>{g.nome}</b>
            {g.key === 'produzir' && lista.length > 1 && (
              <button onClick={() => onPlanejarTudo(lista)} style={{ padding: '6px 10px', borderRadius: 8, border: `1px solid ${g.cor}`, background: 'transparent', color: g.cor, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Planejar todos →</button>
            )}
          </div>
          {lista.map((t, i) => (
            <LinhaAcao key={`${t.prod.id}-${t.tipo}-${t.de || t.etapa || ''}-${t.para || ''}`} t={t} cor={g.cor} primeira={i === 0}
              a={analises.find(x => x.prod.id === t.prod.id)?.a} agora={agora} onExecutar={onExecutar} />
          ))}
        </div>
      )}
    </div>
  )
}

function LinhaAcao({ t, cor, primeira, a, agora, onExecutar }) {
  const etapas = a?.etapas || []
  const src = etapas.find(e => e.key === (t.de || t.etapa))
  const max = t.tipo === 'mover' ? Math.max(0, (src?.prontos || 0) + (src?.pendentes || 0)) : t.n
  const [qtd, setQtd] = useState(t.n || 1)
  const [ocupado, setOcupado] = useState(false)
  // Embalar com dois destinos (ex: freezer e degelo): parte já vai pro engatilho
  const iEmb = etapas.findIndex(e => e.key === 'embalar')
  const prox = iEmb >= 0 ? etapas[iEmb + 1] : null
  const eng = etapas[etapas.length - 1]
  const divide = t.de === 'embalar' && prox && eng && prox.key !== eng.key
  const faltaEng = eng ? Math.max(0, (eng.meta || 0) + (a?.reservado || 0) - (eng.prontos + eng.pendentes)) : 0
  const [proEng, setProEng] = useState(() => Math.min(t.n || 0, faltaEng))
  const nEng = Math.min(proEng, qtd)

  let sub = ''
  if (t.tipo === 'vencidos') sub = `${fmtN(t.n)} vencido(s) em ${src?.nome?.toLowerCase() || t.etapa}`
  else if (t.tipo === 'produzir') sub = `faltam ${fmtN(t.n)} — abre o planejamento com a fornada`
  else if (t.de === 'embalar') {
    const embs = (t.prod.embalagens || []).map(e => e.nome).filter(Boolean)
    sub = `${fmtN(max)} sem embalagem${embs.length ? ` · ${embs.join(', ')}` : ''}`
  } else {
    const dst = etapas.find(e => e.key === t.para)
    sub = `${fmtN(max)} em ${src?.nome?.toLowerCase() || t.de}`
    if (dst?.tempoH > 0) sub += ` · pronto às ${hhmm(agora + dst.tempoH * 3600e3)}`
  }

  async function feito() {
    setOcupado(true)
    const destinos = divide ? [{ etapa: prox.key, qtd: qtd - nEng }, { etapa: eng.key, qtd: nEng }] : null
    await onExecutar(t, qtd, destinos)
    setOcupado(false)
  }

  const passo = (d) => setQtd(v => Math.max(1, Math.min(max || Infinity, v + d)))
  const mini = { width: 30, height: 30, borderRadius: 8, border: '1px solid #333', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 16, cursor: 'pointer' }
  const rotulo = t.tipo === 'produzir' ? `Planejar ${fmtN(qtd)} →` : t.tipo === 'vencidos' ? `Descartar ${fmtN(t.n)}` : `✓ ${FEITO[t.verbo] || 'Feito'} ${fmtN(qtd)}`

  return (
    <div style={{ padding: '12px 14px', borderTop: primeira ? 'none' : '1px solid #2a2a2a' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.25 }}>{t.prod.nome}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{sub}</div>
        </div>
        <button onClick={feito} disabled={ocupado || !(qtd > 0)} style={{
          border: 'none', borderRadius: 11, padding: '12px 14px', fontWeight: 800, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap',
          background: cor, color: '#0b0b0b', opacity: ocupado ? 0.6 : 1, flexShrink: 0,
        }}>{ocupado ? '…' : rotulo}</button>
      </div>
      {t.tipo === 'mover' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>quantidade</span>
          <button style={mini} onClick={() => passo(-1)}>−</button>
          <span style={{ minWidth: 26, textAlign: 'center', fontWeight: 800 }}>{fmtN(qtd)}</span>
          <button style={mini} onClick={() => passo(1)}>+</button>
          {max > qtd && <button onClick={() => setQtd(max)} style={{ ...mini, width: 'auto', padding: '0 10px', fontSize: 12 }}>tudo ({fmtN(max)})</button>}
        </div>
      )}
      {divide && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-secondary)' }}>
          <span>depois:</span>
          <span style={{ color: (LOCAL[eng.local] || LOCAL.freezer).cor, fontWeight: 700 }}>{eng.nome}</span>
          <button style={mini} onClick={() => setProEng(v => Math.max(0, Math.min(qtd, v) - 1))}>−</button>
          <span style={{ minWidth: 20, textAlign: 'center', fontWeight: 800, color: 'var(--text-primary)' }}>{fmtN(nEng)}</span>
          <button style={mini} onClick={() => setProEng(v => Math.min(qtd, v + 1))}>+</button>
          <span>· {fmtN(qtd - nEng)} pro <b style={{ color: (LOCAL[prox.local] || LOCAL.freezer).cor }}>{prox.local === 'freezer' ? '❄ ' : ''}{prox.nome.toLowerCase()}</b></span>
        </div>
      )}
    </div>
  )
}

// ── Cartão de um produto ──────────────────────────────────────────────────────
function CardProduto({ prod, a, onMover, onEtapa, onConfig, onTarefa }) {
  const st = STATUS[a.status]
  return (
    <div className="card" style={{ padding: '12px 14px', marginBottom: 10, borderLeft: `3px solid ${st.cor}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.25 }}>{prod.nome}</div>
          {prod.secao && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>{prod.secao}</div>}
        </div>
        {a.reservado > 0 && <span style={{ fontSize: 12, fontWeight: 600, color: '#60a5fa', whiteSpace: 'nowrap' }}>{fmtN(a.reservado)} reservado(s)</span>}
        <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: st.bg, color: st.cor, whiteSpace: 'nowrap' }}>{a.rotulo}</span>
        <button onClick={onConfig} title="Configurar fluxo" style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', fontSize: 17, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>⚙</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'stretch', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
        {a.etapas.map((e, i) => {
          const sug = i > 0 && a.sugestoes.find(s => s.tipo === 'mover' && s.de === a.etapas[i - 1].key && s.para === e.key)
          return (
            <div key={e.key} style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {i > 0 && (
                <button onClick={() => onMover(a.etapas[i - 1].key, e.key, sug?.n || 1)} aria-label={`Mover para ${e.nome}`} style={{
                  width: 40, height: 40, borderRadius: 20, flexShrink: 0, cursor: 'pointer', fontSize: 19, lineHeight: 1,
                  border: `1.5px solid ${sug ? 'var(--teal)' : '#333'}`,
                  background: sug ? 'rgba(20,184,166,.12)' : 'var(--bg-input)',
                  color: sug ? 'var(--teal)' : 'var(--text-primary)',
                }}>›</button>
              )}
              <EtapaBox e={e} primeira={i === 0} prod={prod} onClick={() => onEtapa(e.key)} />
            </div>
          )
        })}
        {prod.prontidao?.noPedido && (
          <div style={{ alignSelf: 'center', fontSize: 12, color: 'var(--text-secondary)', border: '1px dashed #333', borderRadius: 10, padding: '8px 10px', flexShrink: 0, maxWidth: 220 }}>
            no pedido: {prod.prontidao.noPedido}
          </div>
        )}
      </div>

      {a.sugestoes.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {a.sugestoes.map((s, i) => (
            <button key={i} onClick={() => onTarefa({ ...s, prod })} style={{
              fontSize: 13, fontWeight: 600, padding: '7px 12px', borderRadius: 8, cursor: 'pointer',
              border: `1px solid ${s.tipo === 'produzir' ? '#333' : s.tipo === 'vencidos' ? '#f87171' : 'var(--teal)'}`,
              background: 'transparent',
              color: s.tipo === 'produzir' ? 'var(--text-secondary)' : s.tipo === 'vencidos' ? '#f87171' : 'var(--teal)',
            }}>{textoSugestao(s, prod)}{s.tipo === 'produzir' ? ' ›' : ''}</button>
          ))}
        </div>
      )}
    </div>
  )
}

function EtapaBox({ e, primeira, prod, onClick }) {
  const loc = LOCAL[e.local] || LOCAL.freezer
  let linha
  if (e.pendentes > 0 && e.proxPronto) linha = `${fmtN(e.prontos)} prontos · ${fmtN(e.pendentes)} às ${hhmm(e.proxPronto)}`
  else if (e.meta > 0) linha = `meta ${fmtN(e.meta)}`
  else if (primeira) linha = prod.estoqueMin > 0 ? `mín. ${fmtN(prod.estoqueMin)} no total` : ''
  const vazio = (e.qtd - e.vencidos) <= 0
  return (
    <button onClick={onClick} style={{
      minWidth: 104, textAlign: 'left', borderRadius: 12, padding: '8px 11px', cursor: 'pointer',
      background: 'var(--bg-input)', color: 'var(--text-primary)',
      border: e.engatilho ? `2px solid ${loc.cor}` : '1px solid #3a3a3a',
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: loc.cor, whiteSpace: 'nowrap' }}>
        {loc.icon ? `${loc.icon} ` : ''}{e.nome}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.15, color: vazio ? 'var(--text-tertiary)' : 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
        {fmtN(e.qtd - e.vencidos)}
      </div>
      {linha && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{linha}</div>}
      {e.vencidos > 0 && <div style={{ fontSize: 11, color: '#f87171', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtN(e.vencidos)} vencido(s)</div>}
      {e.venceLogo > 0 && e.proxVence && <div style={{ fontSize: 11, color: '#f5b544', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtN(e.venceLogo)} vence(m) {hhmm(e.proxVence)}</div>}
    </button>
  )
}

// ── Folhas ────────────────────────────────────────────────────────────────────
function Sheet({ title, onClose, children }) {
  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div className="sheet" style={{ maxHeight: '88vh', overflowY: 'auto' }}>
        <div className="sheet-title">
          <span>{title}</span>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 22, cursor: 'pointer' }} onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </>
  )
}

const stepBtn = { width: 54, height: 54, borderRadius: 14, border: '1px solid #333', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 26, cursor: 'pointer' }

function Stepper({ n, setN, max }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, margin: '8px 0 12px' }}>
      <button style={stepBtn} onClick={() => setN(v => Math.max(1, (parseFloat(v) || 0) - 1))}>−</button>
      <input type="text" inputMode="numeric" value={n} onChange={e => setN(e.target.value.replace(/[^\d.]/g, ''))} onFocus={e => e.target.select()}
        style={{ width: 90, textAlign: 'center', fontSize: 40, fontWeight: 800, background: 'transparent', border: 'none', color: 'var(--text-primary)', outline: 'none' }} />
      <button style={stepBtn} onClick={() => setN(v => Math.min(max ?? Infinity, (parseFloat(v) || 0) + 1))}>+</button>
    </div>
  )
}

function MoverSheet({ prod, de, para, n: nSug, lotes, agora, onClose, onDone }) {
  const a = analisarProduto(prod, lotes, agora)
  const src = a.etapas.find(e => e.key === de)
  const dst = a.etapas.find(e => e.key === para)
  const max = Math.max(0, (src?.qtd || 0) - (src?.vencidos || 0))
  const [n, setN] = useState(String(Math.min(nSug || 1, max || 1)))
  const [salvando, setSalvando] = useState(false)
  const num = parseFloat(n) || 0
  const verbo = FLUXOS[fluxoAtivo(prod)]?.verbos?.[`${de}>${para}`] || 'Mover'

  async function confirmar() {
    if (!(num > 0) || num > max) return
    setSalvando(true)
    // embalar pela folha também baixa as embalagens (mesmo caminho do quadro)
    try { onDone(de === 'embalar' ? await embalarProduto(prod, [{ etapa: para, qtd: num }]) : await moverProntidao(prod.id, de, para, num)) }
    catch (e) { alert('Erro: ' + e.message); setSalvando(false) }
  }

  const chip = (label, val) => (
    <button key={label} onClick={() => setN(String(val))} style={{
      fontSize: 13, padding: '6px 12px', borderRadius: 20, cursor: 'pointer',
      border: `1px solid ${num === val ? 'var(--teal)' : '#333'}`, background: 'transparent',
      color: num === val ? 'var(--teal)' : 'var(--text-secondary)',
    }}>{label}</button>
  )

  return (
    <Sheet title={`${verbo} · ${prod.nome}`} onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 4 }}>
        <b style={{ color: LOCAL[src.local].cor }}>{src.nome} · {fmtN(max)}</b>
        <span style={{ color: 'var(--text-tertiary)' }}>→</span>
        <b style={{ color: LOCAL[dst.local].cor }}>{dst.nome} · {fmtN(dst.qtd - dst.vencidos)}</b>
      </div>
      {max <= 0 ? (
        <div className="empty" style={{ margin: '20px 0' }}><span>Não tem nada em {src.nome.toLowerCase()} pra mover.</span></div>
      ) : (
        <>
          <Stepper n={n} setN={setN} max={max} />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 12 }}>
            {nSug > 0 && nSug <= max && nSug !== 1 && chip(`sugerido · ${fmtN(nSug)}`, nSug)}
            {chip('1', 1)}
            {max > 1 && chip(`tudo · ${fmtN(max)}`, max)}
          </div>
          {(dst.tempoH > 0 || dst.validadeH) && (
            <div style={{ fontSize: 13, background: 'var(--bg-secondary)', borderRadius: 10, padding: '10px 12px', marginBottom: 12, color: 'var(--text-secondary)' }}>
              {dst.tempoH > 0 && <>Fica pronto às <b style={{ color: 'var(--text-primary)' }}>{hhmm(agora + dst.tempoH * 3600e3)}</b></>}
              {dst.tempoH > 0 && dst.validadeH ? ' · ' : ''}
              {dst.validadeH && <>vale até <b style={{ color: 'var(--text-primary)' }}>{hhmm(agora + dst.validadeH * 3600e3)}</b></>}
            </div>
          )}
          {num > max && <div style={{ fontSize: 12, color: '#f87171', textAlign: 'center', marginBottom: 8 }}>Só tem {fmtN(max)} em {src.nome.toLowerCase()}</div>}
          <button className="btn-primary" disabled={salvando || !(num > 0) || num > max} onClick={confirmar}>
            {salvando ? 'Movendo...' : `${verbo === 'Mover' ? 'Mover' : verbo} ${fmtN(num)}`}
          </button>
        </>
      )}
    </Sheet>
  )
}

function EtapaSheet({ prod, etapaKey, lotes, agora, onClose, onDone }) {
  const a = analisarProduto(prod, lotes, agora)
  const e = a.etapas.find(x => x.key === etapaKey) || a.etapas[0]
  const atual = e.qtd
  const [contei, setContei] = useState('')
  const [baixa, setBaixa] = useState('1')
  const [salvando, setSalvando] = useState(false)

  async function rodar(fn, msg) {
    setSalvando(true)
    try { await fn(); onDone(msg) }
    catch (err) { alert('Erro: ' + err.message); setSalvando(false) }
  }

  return (
    <Sheet title={`${prod.nome} · ${e.nome}`} onClose={onClose}>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
        {fmtN(atual)} unidade(s) em {e.nome.toLowerCase()}
        {e.tempoH > 0 && ` · fica pronto em ${fmtDuracao(e.tempoH)}`}
        {e.validadeH && ` · vale ${fmtDuracao(e.validadeH)}`}
      </div>

      {e.lotes.length > 0 && (e.tempoH > 0 || e.validadeH) && (
        <div style={{ marginBottom: 14 }}>
          {e.lotes.map(l => {
            const t = new Date(l.entrou_em).getTime()
            const pronto = t + (e.tempoH || 0) * 3600e3
            const vence = e.validadeH ? t + e.validadeH * 3600e3 : null
            const venc = vence != null && vence <= agora
            return (
              <div key={l.id} style={{ display: 'flex', gap: 10, fontSize: 13, padding: '6px 0', borderTop: '1px solid #333' }}>
                <b style={{ minWidth: 34 }}>{fmtN(l.qtd)}</b>
                <span style={{ flex: 1, color: 'var(--text-secondary)' }}>entrou {hhmm(t)}</span>
                <span style={{ color: venc ? '#f87171' : pronto > agora ? '#f5b544' : '#4ade80', fontWeight: 600 }}>
                  {venc ? 'vencido' : pronto > agora ? `pronto ${hhmm(pronto)}` : vence ? `até ${hhmm(vence)}` : 'pronto'}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {e.vencidos > 0 && (
        <button className="btn-primary" disabled={salvando} style={{ background: '#b91c1c', marginBottom: 14 }}
          onClick={() => rodar(() => descartarVencidosProntidao(prod.id, e.key, e.validadeH), `${fmtN(e.vencidos)} descartado(s)`)}>
          Descartar {fmtN(e.vencidos)} vencido(s)
        </button>
      )}

      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Contei agora</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input className="field-input" type="text" inputMode="decimal" placeholder={fmtN(atual)} value={contei}
          onChange={ev => setContei(ev.target.value.replace(',', '.'))} style={{ marginBottom: 0, flex: 1, fontSize: 18, fontWeight: 700 }} />
        <button disabled={salvando || contei === '' || isNaN(parseFloat(contei))}
          onClick={() => rodar(() => corrigirEtapaProntidao(prod.id, e.key, parseFloat(contei), e.tempoH), 'Contagem salva')}
          style={{ padding: '0 18px', borderRadius: 10, border: 'none', background: 'var(--teal)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Salvar</button>
      </div>

      {atual > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>Dar baixa</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Venda fora do app, perda, consumo. Vendas registradas no app já baixam sozinhas.</div>
          <Stepper n={baixa} setN={setBaixa} max={atual} />
          <button className="btn-primary" disabled={salvando || !(parseFloat(baixa) > 0) || parseFloat(baixa) > atual}
            style={{ background: 'transparent', border: '1px solid #333', color: 'var(--text-primary)' }}
            onClick={() => rodar(() => baixaProntidao(prod.id, e.key, parseFloat(baixa)), `Baixa de ${fmtN(parseFloat(baixa))}`)}>
            Dar baixa de {fmtN(parseFloat(baixa) || 0)}
          </button>
        </>
      )}
    </Sheet>
  )
}

function ConfigSheet({ prod, onClose, onDone }) {
  const inicial = prod.prontidao?.fluxo ? prod.prontidao : sugerirConfig(prod)
  const [fluxo, setFluxo] = useState(inicial.fluxo)
  const [noPedido, setNoPedido] = useState(inicial.noPedido || '')
  const [embalar, setEmbalar] = useState(() => inicial.embalar ?? sugerirConfig(prod).embalar ?? false)
  const [over, setOver] = useState(() => {
    const o = {}
    for (const [k, v] of Object.entries(inicial.etapas || {})) {
      o[k] = { meta: v.meta ?? '', tempoH: v.tempoH ?? '', validadeH: v.validadeH ?? '' }
    }
    return o
  })
  const [salvando, setSalvando] = useState(false)

  const etapas = FLUXOS[fluxo] ? etapasDoProduto({ ...prod, prontidao: { fluxo, embalar } }) : []
  const setCampo = (k, campo, val) => setOver(o => ({ ...o, [k]: { ...(o[k] || {}), [campo]: val.replace(',', '.') } }))

  async function salvar() {
    setSalvando(true)
    try {
      const cfg = { fluxo }
      if (FLUXOS[fluxo]) {
        cfg.embalar = fluxo !== 'choux' && embalar
        cfg.etapas = {}
        etapas.forEach((e, i) => {
          if (i === 0) return
          const o = over[e.key] || {}
          const num = v => (v === '' || v == null || isNaN(parseFloat(v))) ? undefined : parseFloat(v)
          cfg.etapas[e.key] = { meta: num(o.meta), tempoH: num(o.tempoH), validadeH: num(o.validadeH) }
        })
        if (noPedido.trim()) cfg.noPedido = noPedido.trim()
      }
      await setProdutoProntidao(prod, cfg)
      onDone()
    } catch (e) { alert('Erro: ' + e.message); setSalvando(false) }
  }

  const campo = { width: '100%', padding: '8px 6px', borderRadius: 8, border: '1px solid #333', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 15, fontWeight: 700, textAlign: 'center' }
  const prev = { ...prod, prontidao: { fluxo, embalar, etapas: {} } }

  return (
    <Sheet title={`Fluxo · ${prod.nome}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
        {[...Object.entries(FLUXOS), ['nenhum', { nome: 'Não acompanhar', exemplo: 'some do board' }]].map(([k, f]) => (
          <button key={k} onClick={() => setFluxo(k)} style={{
            textAlign: 'left', padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
            border: `1.5px solid ${fluxo === k ? 'var(--teal)' : '#333'}`,
            background: fluxo === k ? 'rgba(20,184,166,.10)' : 'transparent', color: 'var(--text-primary)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: fluxo === k ? 'var(--teal)' : 'var(--text-primary)' }}>{f.nome}</div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
              {f.etapas ? f.etapas.map(e => e.nome).join(' → ') + ' · ' : ''}{f.exemplo}
            </div>
          </button>
        ))}
      </div>

      {FLUXOS[fluxo] && fluxo !== 'choux' && (
        <div onClick={() => setEmbalar(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, marginBottom: 14, cursor: 'pointer', border: `1.5px solid ${embalar ? '#c084fc' : '#333'}` }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: embalar ? '#c084fc' : 'var(--text-primary)' }}>📦 Embala antes de guardar</div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{embalar ? 'O que sai do Montado cai em "Sem embalagem" e só conta como pronto depois de embalado.' : 'Já sai pronto (pote) ou embala na hora do pedido.'}</div>
          </div>
          <div style={{ width: 38, height: 22, borderRadius: 11, position: 'relative', background: embalar ? '#c084fc' : '#444', flexShrink: 0 }}>
            <div style={{ position: 'absolute', top: 2, left: embalar ? 18 : 2, width: 18, height: 18, borderRadius: 9, background: '#fff' }} />
          </div>
        </div>
      )}

      {etapas.length > 1 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Etapas</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 8 }}>
            Meta = quantos manter nessa etapa. Vazio usa o padrão ({fmtN(metaPadrao(prod))} ≈ 20% da fornada). Tempos em horas (0,25 = 15 min).
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr 1fr', gap: 6, fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>
            <span /><span style={{ textAlign: 'center' }}>meta</span><span style={{ textAlign: 'center' }}>pronto em (h)</span><span style={{ textAlign: 'center' }}>dura (h)</span>
          </div>
          {etapasDoProduto(prev).slice(1).filter(e => e.key !== 'embalar').map(e => {
            const o = over[e.key] || {}
            return (
              <div key={e.key} style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr 1fr', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: LOCAL[e.local].cor }}>{e.nome}</span>
                <input style={campo} inputMode="decimal" placeholder={fmtN(e.meta)} value={o.meta ?? ''} onChange={ev => setCampo(e.key, 'meta', ev.target.value)} />
                <input style={campo} inputMode="decimal" placeholder={fmtN(e.tempoH)} value={o.tempoH ?? ''} onChange={ev => setCampo(e.key, 'tempoH', ev.target.value)} />
                <input style={campo} inputMode="decimal" placeholder={e.validadeH ? fmtN(e.validadeH) : '—'} value={o.validadeH ?? ''} onChange={ev => setCampo(e.key, 'validadeH', ev.target.value)} />
              </div>
            )
          })}
        </>
      )}

      {FLUXOS[fluxo] && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, margin: '12px 0 6px' }}>No pedido (opcional)</div>
          <input className="field-input" placeholder="ex: micro-ondas 1 min + geleia" value={noPedido} onChange={e => setNoPedido(e.target.value)} />
        </>
      )}

      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '4px 0 12px' }}>
        A primeira etapa ({etapas[0]?.nome?.toLowerCase() || '—'}) usa o estoque mínimo do produto como alerta.
        {!prod.prontidao?.fluxo && prod.estoqueAtual > 0 ? ` Os ${fmtN(prod.estoqueAtual)} em estoque entram nela.` : ''}
      </div>
      <button className="btn-primary" disabled={salvando} onClick={salvar}>{salvando ? 'Salvando...' : 'Salvar fluxo'}</button>
    </Sheet>
  )
}

function SetupSql({ erro, onRetry }) {
  const [copiado, setCopiado] = useState(false)
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Falta preparar o banco</div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
        Roda este SQL no Supabase (SQL Editor) uma vez e depois toca em "Tentar de novo". Ele só cria coisas novas, não apaga nada.
      </div>
      <pre style={{ fontSize: 11, background: 'var(--bg-secondary)', borderRadius: 8, padding: 10, overflowX: 'auto', whiteSpace: 'pre', margin: '0 0 10px' }}>{SQL_SETUP}</pre>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-primary" style={{ flex: 1 }} onClick={() => { navigator.clipboard?.writeText(SQL_SETUP).then(() => setCopiado(true)) }}>{copiado ? 'Copiado ✓' : 'Copiar SQL'}</button>
        <button onClick={onRetry} style={{ flex: 1, borderRadius: 10, border: '1px solid #333', background: 'transparent', color: 'var(--text-primary)', fontWeight: 600, cursor: 'pointer' }}>Tentar de novo</button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 10 }}>{erro}</div>
    </div>
  )
}

// ── Lembrete de fim do dia (push) ─────────────────────────────────────────────
function LembreteSheet({ onClose }) {
  const [estado, setEstado] = useState(undefined) // undefined=carregando, null=desligado, obj=ligado
  const [hora, setHora] = useState('21:00')
  const [ocupado, setOcupado] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    if (!suportaPush()) { setEstado(null); return }
    lerLembrete().then(d => { setEstado(d); if (d?.hora_lembrete) setHora(d.hora_lembrete) })
      .catch(e => { setEstado(null); setMsg({ erro: true, t: e.message }) })
  }, [])

  async function rodar(fn, ok) {
    setOcupado(true); setMsg(null)
    try { await fn(); setMsg({ t: ok }) }
    catch (e) { setMsg({ erro: true, t: e.message }) }
    finally { setOcupado(false) }
  }

  const ligado = !!estado
  return (
    <Sheet title="Lembrete de fim do dia" onClose={onClose}>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
        Uma notificação por dia, na hora que você escolher, pra fechar o Prontidão: o que saiu, o que foi pro degelo, o que fica pra amanhã. Vale só para <b>este aparelho</b> — ative no celular e no tablet.
      </div>
      {!suportaPush() ? (
        <div className="empty"><span>Este navegador não aceita notificações. No iPhone/iPad, adicione o app à tela de início primeiro.</span></div>
      ) : estado === undefined ? (
        <div className="loading">Verificando...</div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 14, flex: 1 }}>Horário</span>
            <input type="time" value={hora} onChange={e => setHora(e.target.value)}
              style={{ fontSize: 20, fontWeight: 700, padding: '6px 10px', borderRadius: 10, border: '1px solid #333', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
          </div>
          <div style={{ fontSize: 13, marginBottom: 12, color: ligado ? '#4ade80' : 'var(--text-tertiary)', fontWeight: 600 }}>
            {ligado ? `✓ Ativo neste aparelho às ${estado.hora_lembrete}` : 'Desligado neste aparelho'}
          </div>
          <button className="btn-primary" disabled={ocupado || !hora} onClick={() => rodar(async () => { await ativarLembrete(hora); setEstado(await lerLembrete()) }, ligado ? 'Horário salvo' : 'Lembrete ativado')}>
            {ocupado ? 'Salvando...' : ligado ? 'Salvar horário' : 'Ativar neste aparelho'}
          </button>
          {ligado && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button disabled={ocupado} onClick={() => rodar(testarLembrete, 'Enviado — deve chegar em segundos')} style={{ flex: 1, padding: 11, borderRadius: 10, border: '1px solid #333', background: 'transparent', color: 'var(--text-primary)', fontWeight: 600, cursor: 'pointer' }}>Mandar teste</button>
              <button disabled={ocupado} onClick={() => rodar(async () => { await desativarLembrete(); setEstado(null) }, 'Lembrete desligado')} style={{ flex: 1, padding: 11, borderRadius: 10, border: '1px solid #7f1d1d', background: 'transparent', color: '#f87171', fontWeight: 600, cursor: 'pointer' }}>Desligar</button>
            </div>
          )}
          {msg && <div style={{ fontSize: 13, marginTop: 12, color: msg.erro ? '#f87171' : '#4ade80' }}>{msg.t}</div>}
        </>
      )}
    </Sheet>
  )
}
