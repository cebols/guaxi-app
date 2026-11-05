import { useMemo, useState } from 'react'
import { ItemThumb } from './ItemThumb'

// ── Lista de produtos espelhando o cardápio online ───────────────────────────
// Seções na ordem do cardápio, produtos na ordem escolhida, liga/desliga na linha,
// pendências (sem foto/descrição/preço) e modo "Organizar" com ▲▼ e seções.

const fmtR = v => (v == null || isNaN(v)) ? '—' : `R$ ${Number(v).toFixed(2).replace('.', ',')}`
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function pendenciasDe(p) {
  const out = []
  if (!(p.precoDireta > 0)) out.push('sem preço')
  if (!p.imagemUrl && !(p.midias || []).length) out.push('sem foto')
  if (!(p.descricao || '').trim()) out.push('sem descrição')
  return out
}

const porOrdem = (a, b) => ((a.ordem ?? 1e9) - (b.ordem ?? 1e9)) || a.nome.localeCompare(b.nome, 'pt-BR')

export function agruparPorSecao(lista, secoesOrdem = []) {
  const secs = [...new Set(lista.map(p => p.secao).filter(Boolean))]
  const ordem = [...secoesOrdem.filter(s => secs.includes(s)), ...secs.filter(s => !secoesOrdem.includes(s))]
  const grupos = ordem.map(s => ({ secao: s, itens: lista.filter(p => p.secao === s).sort(porOrdem) }))
  const sem = lista.filter(p => !p.secao).sort(porOrdem)
  if (sem.length) grupos.push({ secao: '', itens: sem })
  return grupos
}

function Switch({ on, onClick, disabled }) {
  return (
    <button onClick={e => { e.stopPropagation(); if (!disabled) onClick() }} aria-label={on ? 'Tirar do cardápio' : 'Pôr no cardápio'}
      style={{ width: 44, height: 26, borderRadius: 13, border: 'none', padding: 0, flexShrink: 0, cursor: 'pointer', position: 'relative', background: on ? 'var(--teal)' : '#444', opacity: disabled ? 0.5 : 1, transition: 'background .15s' }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
    </button>
  )
}

function Chip({ children, cor = 'var(--text-secondary)', bg = 'rgba(255,255,255,.06)' }) {
  return <span style={{ fontSize: 11, fontWeight: 700, color: cor, background: bg, borderRadius: 20, padding: '2px 8px', whiteSpace: 'nowrap' }}>{children}</span>
}

function Thumb({ prod, size = 56 }) {
  const m = prod.midias || []
  const temVideo = m.some(x => x.tipo === 'video')
  const capa = m.find(x => x.tipo !== 'video')?.url || m[0]?.poster || prod.imagemUrl
  return (
    <div style={{ position: 'relative', flexShrink: 0, width: size, height: size, borderRadius: 10, background: '#2a2a2a' }}>
      <ItemThumb url={capa} nome={prod.nome} size={size} radius={10} />
      {(temVideo || m.length > 1) && (
        <span style={{ position: 'absolute', right: -4, bottom: -4, fontSize: 9.5, fontWeight: 800, background: '#111', color: '#fff', border: '1px solid #333', borderRadius: 8, padding: '1px 5px' }}>
          {temVideo ? '▶' : ''}{m.length > 1 ? `${temVideo ? ' ' : ''}${m.length}` : ''}
        </span>
      )}
    </div>
  )
}

function Status({ prod, disp }) {
  if (prod.tipo === 'combo') return null
  const info = disp?.[prod.id]
  if (disp && info) {
    if (info.d > 0) return <Chip cor="#4ade80" bg="rgba(74,222,128,.1)">{info.d} disponíve{info.d === 1 ? 'l' : 'is'}</Chip>
    if (info.c > 0) return <Chip cor="#f5b544" bg="rgba(245,181,68,.1)">esgotado · volta em breve</Chip>
    return <Chip cor="#f87171" bg="rgba(248,113,113,.1)">esgotado</Chip>
  }
  const q = Math.max(0, Math.floor(prod.estoqueAtual || 0))
  return q > 0 ? <Chip cor="#4ade80" bg="rgba(74,222,128,.1)">{q} em estoque</Chip> : <Chip cor="#f87171" bg="rgba(248,113,113,.1)">sem estoque</Chip>
}

function Linha({ prod, disp, querem, renderPrecos, onAbrir, onToggle, salvando }) {
  const pend = prod.ativo !== false && prod.tipo !== 'combo' ? pendenciasDe(prod) : []
  const margem = prod.precoDireta > 0 && prod.custoTotal > 0 ? Math.round((1 - prod.custoTotal / prod.precoDireta) * 100) : null
  return (
    <div onClick={() => onAbrir(prod)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', cursor: 'pointer', opacity: prod.ativo === false ? 0.6 : 1 }}>
      <Thumb prod={prod} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 14.5, lineHeight: 1.25, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{prod.nome}</span>
          <b style={{ fontSize: 14, flexShrink: 0 }}>{prod.precoDireta > 0 ? fmtR(prod.precoDireta) : ''}</b>
        </div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4 }}>
          {prod.ativo !== false && <Status prod={prod} disp={disp} />}
          {querem > 0 && <Chip cor="#60a5fa" bg="rgba(96,165,250,.12)">🔔 {querem} querem</Chip>}
          {pend.map(p => <Chip key={p} cor="#f5b544" bg="rgba(245,181,68,.12)">{p}</Chip>)}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline' }}>
          {prod.custoTotal > 0 && <span>custo {fmtR(prod.custoTotal)}{margem != null ? ` · margem ${margem}%` : ''}</span>}
          {renderPrecos && <span style={{ opacity: 0.9 }}>{renderPrecos(prod)}</span>}
        </div>
      </div>
      {onToggle && <Switch on={prod.ativo !== false} disabled={salvando} onClick={() => onToggle(prod)} />}
    </div>
  )
}

// ── Modo organizar ────────────────────────────────────────────────────────────
function estadoInicial(grupos) {
  const secoes = grupos.filter(g => g.secao).map(g => g.secao)
  const ids = Object.fromEntries(grupos.map(g => [g.secao, g.itens.map(p => p.id)]))
  for (const s of secoes) ids[s] ||= []
  ids[''] ||= []
  return { secoes, ids }
}

function Organizar({ grupos, porId, onCancelar, onSalvar }) {
  const [st, setSt] = useState(() => estadoInicial(grupos))
  const [editando, setEditando] = useState(null) // índice da seção sendo renomeada
  const [nova, setNova] = useState('')
  const [salvando, setSalvando] = useState(false)
  const ordemSecs = [...st.secoes, '']

  const moverProd = (id, dir) => setSt(prev => {
    const ids = Object.fromEntries(Object.entries(prev.ids).map(([k, v]) => [k, [...v]]))
    const secs = [...prev.secoes, '']
    const s = secs.find(k => ids[k].includes(id))
    const arr = ids[s], i = arr.indexOf(id), j = i + dir
    if (j >= 0 && j < arr.length) { [arr[i], arr[j]] = [arr[j], arr[i]]; return { ...prev, ids } }
    // passou da borda: vai pra seção vizinha
    const k = secs.indexOf(s) + dir
    if (k < 0 || k >= secs.length) return prev
    arr.splice(i, 1)
    if (dir < 0) ids[secs[k]].push(id); else ids[secs[k]].unshift(id)
    return { ...prev, ids }
  })
  const mudarSecao = (id, nova) => setSt(prev => {
    const ids = Object.fromEntries(Object.entries(prev.ids).map(([k, v]) => [k, v.filter(x => x !== id)]))
    ids[nova] = [...(ids[nova] || []), id]
    return { ...prev, ids }
  })
  const moverSecao = (i, dir) => setSt(prev => {
    const secoes = [...prev.secoes], j = i + dir
    if (j < 0 || j >= secoes.length) return prev
    ;[secoes[i], secoes[j]] = [secoes[j], secoes[i]]
    return { ...prev, secoes }
  })
  const renomear = (i, nome) => setSt(prev => {
    const velho = prev.secoes[i], n = nome.trim()
    if (!n || n === velho || prev.secoes.includes(n)) return prev
    const secoes = prev.secoes.map((s, k) => k === i ? n : s)
    const ids = { ...prev.ids, [n]: prev.ids[velho] }
    delete ids[velho]
    return { secoes, ids }
  })
  const removerSecao = (i) => setSt(prev => {
    const velho = prev.secoes[i]
    const ids = { ...prev.ids, '': [...prev.ids[''], ...prev.ids[velho]] }
    delete ids[velho]
    return { secoes: prev.secoes.filter((_, k) => k !== i), ids }
  })
  const addSecao = () => {
    const n = nova.trim()
    if (!n) return
    setSt(prev => prev.secoes.includes(n) ? prev : { secoes: [...prev.secoes, n], ids: { ...prev.ids, [n]: [] } })
    setNova('')
  }
  async function salvar() {
    setSalvando(true)
    try {
      const itens = []
      for (const s of ordemSecs) (st.ids[s] || []).forEach((id, i) => {
        const p = porId[id]
        if (!p) return
        if ((p.secao || '') !== s || p.ordem !== i + 1) itens.push({ id, secao: s, ordem: i + 1 })
      })
      await onSalvar(st.secoes, itens)
    } catch (e) {
      alert('Erro ao salvar: ' + e.message)
      setSalvando(false)
    }
  }

  const btn = { width: 32, height: 32, borderRadius: 8, border: '1px solid #333', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer', flexShrink: 0 }
  const barra = (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 12px', borderRadius: 12, background: 'rgba(34,184,134,.08)', border: '1px solid rgba(34,184,134,.35)' }}>
      <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text-secondary)' }}>▲▼ muda a ordem (passa de seção na borda). É a ordem do cardápio online.</span>
      <button onClick={onCancelar} disabled={salvando} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #333', background: 'transparent', color: 'var(--text-secondary)', fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
      <button onClick={salvar} disabled={salvando} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--teal)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>{salvando ? 'Salvando…' : 'Salvar'}</button>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {barra}
      {ordemSecs.map((s, si) => {
        const ids = st.ids[s] || []
        if (s === '' && !ids.length) return null
        return (
          <div key={s || '__sem'} className="card card-flush lista-prod" style={{ overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px', background: 'rgba(255,255,255,.03)' }}>
              {s === '' ? (
                <span style={{ flex: 1, fontWeight: 700, color: 'var(--text-secondary)' }}>Sem seção <span style={{ fontWeight: 400, fontSize: 12 }}>· aparece no fim, sem título</span></span>
              ) : editando === si ? (
                <input autoFocus defaultValue={s} onBlur={e => { renomear(si, e.target.value); setEditando(null) }} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
                  style={{ flex: 1, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--teal)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 700 }} />
              ) : (
                <span onClick={() => setEditando(si)} style={{ flex: 1, fontWeight: 800, fontSize: 15, cursor: 'text' }}>{s} <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-tertiary)' }}>✎ · {ids.length}</span></span>
              )}
              {s !== '' && <>
                <button style={btn} onClick={() => moverSecao(si, -1)} disabled={si === 0}>▲</button>
                <button style={btn} onClick={() => moverSecao(si, 1)} disabled={si === st.secoes.length - 1}>▼</button>
                <button style={{ ...btn, color: '#f87171' }} title="Remover seção (produtos vão pra Sem seção)" onClick={() => removerSecao(si)}>×</button>
              </>}
            </div>
            {!ids.length && <div style={{ padding: '10px 14px', fontSize: 12.5, color: 'var(--text-tertiary)', borderTop: '1px solid #2a2a2a' }}>Vazia — use ▲▼ ou o seletor pra trazer produtos.</div>}
            {ids.map(id => {
              const p = porId[id]
              if (!p) return null
              return (
                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderTop: '1px solid #2a2a2a' }}>
                  <Thumb prod={p} size={36} />
                  <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nome}</span>
                  <select value={s} onChange={e => mudarSecao(id, e.target.value)}
                    style={{ maxWidth: 110, padding: '6px 6px', borderRadius: 8, border: '1px solid #333', background: 'var(--bg-input)', color: 'var(--text-secondary)', fontSize: 12 }}>
                    {st.secoes.map(x => <option key={x} value={x}>{x}</option>)}
                    <option value="">Sem seção</option>
                  </select>
                  <button style={btn} onClick={() => moverProd(id, -1)}>▲</button>
                  <button style={btn} onClick={() => moverProd(id, 1)}>▼</button>
                </div>
              )
            })}
          </div>
        )
      })}
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={nova} onChange={e => setNova(e.target.value)} onKeyDown={e => e.key === 'Enter' && addSecao()} placeholder="Nova seção…"
          style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: '1px solid #333', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14 }} />
        <button onClick={addSecao} style={{ padding: '0 16px', borderRadius: 10, border: 'none', background: 'var(--teal)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>+ Seção</button>
      </div>
      {barra}
    </div>
  )
}

// ── Página ────────────────────────────────────────────────────────────────────
export default function ProdutosCardapio({ produtos, secoesOrdem, disp, querem = {}, lojaUrl, renderPrecos, onAbrir, onToggleAtivo, onSalvarOrganizacao, onCompartilhar }) {
  const [aba, setAba] = useState('menu')
  const [busca, setBusca] = useState('')
  const [organizando, setOrganizando] = useState(false)
  const [salvandoId, setSalvandoId] = useState(null)

  const naoCombo = produtos.filter(p => p.tipo !== 'combo')
  const noMenu = naoCombo.filter(p => p.ativo !== false)
  const fora = naoCombo.filter(p => p.ativo === false).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  const combos = produtos.filter(p => p.tipo === 'combo').sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  const pendentes = noMenu.filter(p => pendenciasDe(p).length)
  const grupos = useMemo(() => agruparPorSecao(noMenu, secoesOrdem), [produtos, secoesOrdem]) // eslint-disable-line react-hooks/exhaustive-deps
  const porId = useMemo(() => Object.fromEntries(produtos.map(p => [p.id, p])), [produtos])

  const noAr = noMenu.filter(p => p.precoDireta > 0)
  const esgotados = disp ? noAr.filter(p => !(disp[p.id]?.d > 0)).length : null

  async function toggle(prod) {
    setSalvandoId(prod.id)
    try { await onToggleAtivo(prod, prod.ativo === false) } finally { setSalvandoId(null) }
  }
  const linha = (p, comSwitch = true) => (
    <Linha key={p.id} prod={p} disp={disp} querem={querem[p.id] || 0} renderPrecos={renderPrecos} onAbrir={onAbrir}
      onToggle={comSwitch ? toggle : null} salvando={salvandoId === p.id} />
  )

  const q = norm(busca.trim())
  const achados = q ? produtos.filter(p => norm(p.nome).includes(q) || norm(p.secao).includes(q)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')) : null

  const abas = [
    { key: 'menu', label: 'No cardápio', n: noMenu.length },
    { key: 'pend', label: 'Pendências', n: pendentes.length, alerta: pendentes.length > 0 },
    { key: 'fora', label: 'Fora', n: fora.length },
    ...(combos.length ? [{ key: 'combos', label: 'Combos', n: combos.length }] : []),
  ]

  if (organizando) {
    return <Organizar grupos={grupos} porId={porId} onCancelar={() => setOrganizando(false)}
      onSalvar={async (secoes, itens) => { await onSalvarOrganizacao(secoes, itens); setOrganizando(false) }} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Resumo do cardápio online */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Cardápio online</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginTop: 3 }}>
            {noAr.length} no ar
            {esgotados != null && <span style={{ color: esgotados ? '#f87171' : 'var(--text-tertiary)', fontWeight: 600 }}> · {esgotados} esgotado{esgotados === 1 ? '' : 's'}</span>}
            {pendentes.length > 0 && <span onClick={() => setAba('pend')} style={{ color: '#f5b544', fontWeight: 600, cursor: 'pointer' }}> · {pendentes.length} com pendência</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href={lojaUrl} target="_blank" rel="noreferrer" style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #333', color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>Ver como cliente ↗</a>
          <button onClick={onCompartilhar} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--teal)', background: 'transparent', color: 'var(--teal)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>🔗 Link</button>
        </div>
      </div>

      {/* Busca + abas */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar produto…"
          style={{ flex: 1, minWidth: 0, padding: '9px 12px', borderRadius: 10, border: '1px solid #333', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14 }} />
        {!q && aba === 'menu' && noMenu.length > 0 && (
          <button onClick={() => setOrganizando(true)} style={{ padding: '9px 12px', borderRadius: 10, border: '1px solid #333', background: 'transparent', color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>⇅ Organizar</button>
        )}
      </div>
      {!q && (
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none' }}>
          {abas.map(a => (
            <button key={a.key} onClick={() => setAba(a.key)} style={{
              flexShrink: 0, fontSize: 12.5, padding: '6px 12px', borderRadius: 20, cursor: 'pointer', fontWeight: 600,
              border: `1px solid ${aba === a.key ? 'var(--teal)' : '#333'}`, background: aba === a.key ? 'var(--teal)' : 'transparent',
              color: aba === a.key ? '#fff' : a.alerta ? '#f5b544' : 'var(--text-secondary)',
            }}>{a.label} <span style={{ opacity: 0.75 }}>{a.n}</span></button>
          ))}
        </div>
      )}

      {/* Conteúdo */}
      {achados ? (
        <div className="card card-flush lista-prod" style={{ overflow: 'hidden' }}>
          {achados.length ? achados.map(p => linha(p, p.tipo !== 'combo')) : <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Nada encontrado</div>}
        </div>
      ) : aba === 'menu' ? (
        noMenu.length === 0
          ? <div className="card" style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Nenhum produto no cardápio. Ligue em “Fora”.</div>
          : grupos.map(g => (
            <div key={g.secao || '__sem'}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.6, margin: '4px 4px 6px' }}>
                {g.secao || 'Sem seção'} <span style={{ fontWeight: 500, color: 'var(--text-tertiary)' }}>· {g.itens.length}</span>
              </div>
              <div className="card card-flush lista-prod" style={{ overflow: 'hidden' }}>{g.itens.map(p => linha(p))}</div>
            </div>
          ))
      ) : aba === 'pend' ? (
        <>
          <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', margin: '0 4px' }}>Sem preço direto o produto não aparece no cardápio online. Foto e descrição ajudam a vender.</div>
          <div className="card card-flush lista-prod" style={{ overflow: 'hidden' }}>
            {pendentes.length ? pendentes.map(p => linha(p)) : <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Tudo certo ✓</div>}
          </div>
        </>
      ) : aba === 'fora' ? (
        <>
          <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', margin: '0 4px' }}>Fora do cardápio: não aparecem pro cliente nem no planejamento/contagem. Ligue pra voltar.</div>
          <div className="card card-flush lista-prod" style={{ overflow: 'hidden' }}>
            {fora.length ? fora.map(p => linha(p)) : <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Nenhum</div>}
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', margin: '0 4px' }}>Combos são usados nas plataformas (iFood/99) — não aparecem no cardápio online.</div>
          <div className="card card-flush lista-prod" style={{ overflow: 'hidden' }}>{combos.map(p => linha(p, false))}</div>
        </>
      )}
    </div>
  )
}
