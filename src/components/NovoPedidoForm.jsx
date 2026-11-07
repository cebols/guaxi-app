import { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { saveCliente, savePedido } from '../services/db'

// ── Novo pedido / venda já feita ─────────────────────────────────────────────
// Usado no Início (sheet) e em Pedidos (página). Combos ("Cookie + Cookie")
// guardam quais unidades foram usadas como linhas "↳ Produto" a R$ 0 — assim o
// estoque de cada sabor reserva e baixa certo, sem mudar o banco.

const CANAIS = ['WhatsApp', 'Instagram', 'iFood', 'Presencial']
const PERIODOS_NP = [{ v: 'manha', l: 'Manhã', h: '9–12h' }, { v: 'tarde', l: 'Tarde', h: '12–18h' }, { v: 'noite', l: 'Noite', h: '18–22h' }, { v: '', l: 'A combinar', h: 'depois' }]
const fmtR = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = v => parseFloat(String(v ?? '').replace(',', '.')) || 0
const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const diaMais = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d }
const proximo = dow => { const d = diaMais(0); while (d.getDay() !== dow) d.setDate(d.getDate() + 1); return d }
const ddmm = d => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const novaChave = () => Math.random().toString(36).slice(2)

export function precoDe(prod, canal) {
  const direta = prod?.precoDireta ?? prod?.precoPraticado ?? prod?.precoSugerido ?? 0
  return canal === 'iFood' ? (prod?.precoIfood ?? direta) : direta
}

function Segmento({ opcoes, valor, onChange }) {
  return (
    <div className="np-seg">
      {opcoes.map(o => (
        <button key={o.v} type="button" className={valor === o.v ? 'on' : ''} onClick={() => onChange(o.v)}>{o.l}</button>
      ))}
    </div>
  )
}

function Datas({ modo, valor, onChange }) {
  const [outra, setOutra] = useState(false)
  const base = modo === 'feita'
    ? [{ l: 'Hoje', d: diaMais(0) }, { l: 'Ontem', d: diaMais(-1) }, { l: 'Anteontem', d: diaMais(-2) }]
    : [{ l: 'Hoje', d: diaMais(0) }, { l: 'Amanhã', d: diaMais(1) }, { l: 'Sáb', d: proximo(6) }, { l: 'Dom', d: proximo(0) }]
  const vistos = new Set()
  const chips = base.filter(c => { const k = isoLocal(c.d); if (vistos.has(k)) return false; vistos.add(k); return true })
  const isos = chips.map(c => isoLocal(c.d))
  const foraDosChips = !!valor && !isos.includes(valor)
  const mostrarCampo = outra || foraDosChips
  return (
    <>
      <div className="np-chips">
        {chips.map(c => {
          const iso = isoLocal(c.d)
          return (
            <button key={c.l} type="button" className={`np-chip${valor === iso && !outra ? ' on' : ''}`} onClick={() => { setOutra(false); onChange(iso) }}>
              <b>{c.l}</b><span>{ddmm(c.d)}</span>
            </button>
          )
        })}
        <button type="button" className={`np-chip${mostrarCampo ? ' on' : ''}`} onClick={() => setOutra(true)}>
          <b>📅</b><span>{foraDosChips ? ddmm(new Date(valor + 'T00:00:00')) : 'outra data'}</span>
        </button>
      </div>
      {mostrarCampo && (
        <input type="date" className="field-input" style={{ marginTop: 8, marginBottom: 0, colorScheme: 'dark' }}
          value={valor || ''} max={modo === 'feita' ? isoLocal(diaMais(0)) : undefined}
          onChange={e => onChange(e.target.value)} />
      )}
    </>
  )
}

function Passo({ n, onMenos, onMais }) {
  return (
    <div className="np-step">
      <button type="button" aria-label="Menos" onClick={onMenos}>−</button>
      <span>{n}</span>
      <button type="button" aria-label="Mais" onClick={onMais}>+</button>
    </div>
  )
}

function Thumb({ p }) {
  return p?.imagemUrl
    ? <img className="np-thumb" src={p.imagemUrl} alt="" loading="lazy" />
    : <div className="np-thumb">{(p?.nome || '?').charAt(0)}</div>
}

// ── Escolher produtos (tela cheia, fica aberta pra adicionar vários) ─────────
function Seletor({ produtos, itens, canal, onMais, onMenos, onCombo, onAvulso, onFechar, total, nItens }) {
  const [busca, setBusca] = useState('')
  const [avulso, setAvulso] = useState(null) // { nome, preco }
  const qtdDe = id => itens.filter(it => it.produtoId === id && !it.combo).reduce((s, it) => s + (parseFloat(it.quantidade) || 0), 0)
  const combosDe = id => itens.filter(it => it.produtoId === id && it.combo).reduce((s, it) => s + (parseFloat(it.quantidade) || 0), 0)

  const grupos = useMemo(() => {
    const lista = (produtos || []).filter(p => !busca || norm(p.nome).includes(norm(busca)))
    const porSecao = {}
    for (const p of lista.filter(p => p.ativo !== false)) (porSecao[p.tipo === 'combo' ? 'Combos' : (p.secao || 'Outros')] ||= []).push(p)
    const peso = s => (s === 'Combos' ? 1 : 0) + (s === 'Outros' ? 2 : 0)
    const out = Object.keys(porSecao)
      .sort((a, b) => peso(a) - peso(b) || a.localeCompare(b, 'pt-BR'))
      .map(s => ({ s, ps: porSecao[s].sort((a, b) => ((a.ordem ?? 1e9) - (b.ordem ?? 1e9)) || a.nome.localeCompare(b.nome, 'pt-BR')) }))
    const fora = lista.filter(p => p.ativo === false).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    if (fora.length) out.push({ s: 'Fora do cardápio', ps: fora, fora: true })
    return out
  }, [produtos, busca])

  return createPortal(
    <div className="np-tela">
      <div className="np-tela-topo">
        <button type="button" className="np-voltar" onClick={onFechar}>← Voltar</button>
        <b style={{ flex: 1, fontSize: 15 }}>Adicionar produtos</b>
      </div>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-light-color)' }}>
        <input className="field-input" style={{ margin: 0, background: 'var(--bg-input)' }} placeholder="Buscar produto…"
          value={busca} onChange={e => setBusca(e.target.value)} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 14px 16px' }}>
        {grupos.map(g => (
          <div key={g.s} style={{ opacity: g.fora ? 0.6 : 1 }}>
            <div className="np-titulo" style={{ margin: '16px 0 2px' }}>{g.s}</div>
            <div className="np-lista">
              {g.ps.map(p => {
                const ehCombo = p.tipo === 'combo'
                const q = ehCombo ? combosDe(p.id) : qtdDe(p.id)
                const resumo = ehCombo ? (p.componentes || []).map(c => `${c.quantidade}× ${(produtos.find(x => x.id === c.produtoId)?.nome || c.produtoNome || '').split(' ')[0]}`).join(' + ') : ''
                return (
                  <div key={p.id} className="np-item">
                    <Thumb p={p} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{p.nome}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                        R$ {fmtR(precoDe(p, canal))}{resumo ? ` · ${resumo}` : ''}{ehCombo && q > 0 ? ` · ${q} no pedido` : ''}
                      </div>
                    </div>
                    {!ehCombo && q > 0
                      ? <Passo n={q} onMenos={() => onMenos(p)} onMais={() => onMais(p)} />
                      : <button type="button" className="np-add" aria-label={`Adicionar ${p.nome}`} onClick={() => (ehCombo ? onCombo(p) : onMais(p))}>+</button>}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        <div style={{ marginTop: 16 }}>
          {!avulso ? (
            <button type="button" className="np-tracejado" onClick={() => setAvulso({ nome: busca, preco: '' })}>
              ✏️ {busca ? `"${busca}" não está no cadastro — adicionar assim mesmo` : 'Item fora do cadastro (nome e preço livres)'}
            </button>
          ) : (
            <div style={{ background: 'var(--bg-input)', borderRadius: 12, padding: 12 }}>
              <input className="field-input" placeholder="Nome do item" value={avulso.nome} autoFocus
                onChange={e => setAvulso(a => ({ ...a, nome: e.target.value }))} />
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="field-input" style={{ flex: 1, marginBottom: 0 }} placeholder="Preço (R$)" inputMode="decimal"
                  value={avulso.preco} onChange={e => setAvulso(a => ({ ...a, preco: e.target.value }))} />
                <button type="button" className="np-btn-verde" disabled={!avulso.nome.trim()}
                  onClick={() => { onAvulso(avulso.nome.trim(), num(avulso.preco)); setAvulso(null); setBusca('') }}>Adicionar</button>
              </div>
            </div>
          )}
        </div>
      </div>
      <div style={{ padding: '10px 14px 14px', borderTop: '1px solid var(--border-light-color)', background: 'var(--bg-primary)' }}>
        <button type="button" className="btn-primary" onClick={onFechar}>
          {nItens > 0 ? `Pronto · ${nItens} ${nItens === 1 ? 'item' : 'itens'} · R$ ${fmtR(total)}` : 'Voltar'}
        </button>
      </div>
    </div>,
    document.body,
  )
}

// ── Combo: escolher quais unidades (sabores) foram usadas ─────────────────────
function MontarCombo({ combo, produtos, inicial, onConfirmar, onFechar }) {
  const comps = (combo.componentes || []).filter(c => c.produtoId)
  const precisa = comps.reduce((s, c) => s + (parseFloat(c.quantidade) || 1), 0)
  const candidatos = useMemo(() => {
    const vistos = new Set(), out = []
    for (const c of comps) {
      const base = produtos.find(p => p.id === c.produtoId)
      if (!base) continue
      const palavra = norm(base.nome).split(' ')[0]
      const parecidos = produtos.filter(p => p.tipo !== 'combo' && p.ativo !== false &&
        ((base.secao && p.secao === base.secao) || norm(p.nome).split(' ')[0] === palavra))
      for (const p of [base, ...parecidos]) if (!vistos.has(p.id)) { vistos.add(p.id); out.push(p) }
    }
    return out
  }, [combo, produtos]) // eslint-disable-line react-hooks/exhaustive-deps
  const [qtd, setQtd] = useState(() => {
    const m = {}
    if (inicial?.length) for (const c of inicial) m[c.produtoId] = c.qtd
    else for (const c of comps) m[c.produtoId] = (m[c.produtoId] || 0) + (parseFloat(c.quantidade) || 1)
    return m
  })
  const soma = Object.values(qtd).reduce((s, v) => s + v, 0)
  const mudar = (id, d) => setQtd(m => {
    const v = Math.max(0, (m[id] || 0) + d)
    if (d > 0 && soma >= precisa) return m
    return { ...m, [id]: v }
  })
  return createPortal(
    <>
      <div className="sheet-overlay" style={{ zIndex: 210 }} onClick={onFechar} />
      <div className="np-painel">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
          <b style={{ flex: 1, fontSize: 16 }}>{combo.nome}</b>
          <span style={{ fontSize: 13, fontWeight: 700, color: soma === precisa ? 'var(--teal)' : '#f5b544' }}>{soma} de {precisa}</span>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 10 }}>Quais foram? O estoque de cada um sai certinho.</div>
        <div className="np-lista">
          {candidatos.map(p => (
            <div key={p.id} className="np-item">
              <Thumb p={p} />
              <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600 }}>{p.nome}</div>
              <Passo n={qtd[p.id] || 0} onMenos={() => mudar(p.id, -1)} onMais={() => mudar(p.id, 1)} />
            </div>
          ))}
        </div>
        <button type="button" className="btn-primary" style={{ marginTop: 14 }} disabled={soma !== precisa}
          onClick={() => onConfirmar(candidatos.filter(p => qtd[p.id] > 0).map(p => ({ produtoId: p.id, nome: p.nome, qtd: qtd[p.id] })))}>
          {soma === precisa ? 'Confirmar' : `Escolha mais ${precisa - soma}`}
        </button>
      </div>
    </>,
    document.body,
  )
}

// ── Formulário ────────────────────────────────────────────────────────────────
export default function NovoPedidoForm({ produtos, clientes, encomendas, onSaved, onClose, show, variante = 'sheet', modoInicial = 'encomenda' }) {
  const [modo, setModo] = useState(modoInicial) // encomenda | feita
  const [form, setForm] = useState(() => {
    const f = {
      cliente: '', contato: '', canal: 'WhatsApp', dataEntrega: '', tipoEntrega: 'Entrega', frete: '10',
      endereco: '', obs: '', pgto: 'Aguardando', sinal: '', periodo: '',
    }
    // Venda de balcão (tela Vendas): já vendida, presencial, retirada, paga hoje
    return modoInicial === 'feita'
      ? { ...f, canal: 'Presencial', tipoEntrega: 'Retirada', frete: '0', dataEntrega: isoLocal(diaMais(0)), pgto: 'Pago' }
      : f
  })
  const [itens, setItens] = useState([])
  const [seletor, setSeletor] = useState(false)
  const [montando, setMontando] = useState(null) // { prod, key? }
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const lista = produtos || []
  const prodPorId = useMemo(() => Object.fromEntries(lista.map(p => [p.id, p])), [lista])

  function trocarModo(m) {
    setModo(m)
    setForm(f => ({ ...f, dataEntrega: m === 'feita' ? isoLocal(diaMais(0)) : '', pgto: m === 'feita' ? 'Pago' : 'Aguardando' }))
  }

  // Cliente conhecido: telefone do cadastro e endereço do último pedido
  function mudarCliente(nome) {
    const n = norm(nome)
    const c = (clientes || []).find(x => norm(x.nome) === n)
    const ultimo = n ? [...(encomendas || [])].filter(e => norm(e.cliente) === n)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0] : null
    setForm(f => ({
      ...f, cliente: nome,
      contato: f.contato || c?.telefone || ultimo?.contato || '',
      endereco: f.endereco || ultimo?.endereco || '',
    }))
  }

  function mudarCanal(c) {
    set('canal', c)
    setItens(prev => prev.map(it => (it.precoAuto && prodPorId[it.produtoId] ? { ...it, precoUnit: precoDe(prodPorId[it.produtoId], c) } : it)))
  }

  function somar(prod, delta) {
    setItens(prev => {
      const i = prev.findIndex(it => it.produtoId === prod.id && !it.combo)
      if (i >= 0) {
        const q = (parseFloat(prev[i].quantidade) || 0) + delta
        return q <= 0 ? prev.filter((_, k) => k !== i) : prev.map((it, k) => (k === i ? { ...it, quantidade: q } : it))
      }
      if (delta <= 0) return prev
      return [...prev, { key: novaChave(), produto: prod.nome, produtoId: prod.id, quantidade: delta, precoUnit: precoDe(prod, form.canal), precoAuto: true }]
    })
  }
  function abrirCombo(prod) {
    if (!(prod.componentes || []).some(c => c.produtoId)) {
      setItens(prev => [...prev, { key: novaChave(), produto: prod.nome, produtoId: prod.id, quantidade: 1, precoUnit: precoDe(prod, form.canal), precoAuto: true }])
      return
    }
    setMontando({ prod })
  }
  function confirmarCombo(escolha) {
    const { prod, key } = montando
    if (key) setItens(prev => prev.map(it => (it.key === key ? { ...it, combo: escolha } : it)))
    else setItens(prev => [...prev, { key: novaChave(), produto: prod.nome, produtoId: prod.id, quantidade: 1, precoUnit: precoDe(prod, form.canal), precoAuto: true, combo: escolha }])
    setMontando(null)
  }
  const mudarQtd = (key, d) => setItens(prev => prev.flatMap(it => {
    if (it.key !== key) return [it]
    const q = (parseFloat(it.quantidade) || 0) + d
    return q <= 0 ? [] : [{ ...it, quantidade: q }]
  }))
  const mudarPreco = (key, v) => setItens(prev => prev.map(it => (it.key === key ? { ...it, precoUnit: v, precoAuto: false } : it)))
  const addAvulso = (nome, preco) => setItens(prev => [...prev, { key: novaChave(), produto: nome, produtoId: null, quantidade: 1, precoUnit: preco, avulso: true }])

  const freteNum = form.tipoEntrega === 'Entrega' ? num(form.frete) : 0
  const subtotal = itens.reduce((s, it) => s + num(it.precoUnit) * (parseFloat(it.quantidade) || 0), 0)
  const total = subtotal + freteNum
  const nItens = itens.reduce((s, it) => s + (parseFloat(it.quantidade) || 0), 0)
  const feita = modo === 'feita'
  const pronto = itens.length > 0 && !!form.dataEntrega && (feita || !!form.cliente.trim())

  async function salvar() {
    if (!feita && !form.cliente.trim()) { show('Preencha o nome do cliente'); return }
    if (!form.dataEntrega) { show(feita ? 'Escolha quando foi a venda' : 'Escolha a data de entrega'); return }
    if (!itens.length) { show('Adicione ao menos um item'); return }
    setSaving(true)
    try {
      const cliente = form.cliente.trim() || 'Venda balcão'
      const novo = form.cliente.trim().length > 1 && !(clientes || []).some(c => norm(c.nome) === norm(cliente))
      if (novo) await saveCliente({ nome: cliente, telefone: form.contato })
      const linhas = itens.flatMap(it => {
        const q = parseFloat(it.quantidade) || 1
        const base = { produto: it.produto, produtoId: it.produtoId, quantidade: q, precoUnit: num(it.precoUnit) }
        if (!it.combo) return [base]
        return [base, ...it.combo.filter(c => c.qtd > 0).map(c => ({ produto: `↳ ${c.nome}`, produtoId: c.produtoId, quantidade: c.qtd * q, precoUnit: 0 }))]
      })
      const entrega = form.tipoEntrega === 'Entrega'
      const id = await savePedido({
        ...form, cliente,
        frete: entrega ? num(form.frete) : 0,
        endereco: entrega ? form.endereco.trim() : '',
        sinal: form.pgto === 'Pago' ? 0 : num(form.sinal),
        status: feita ? 'Entregue' : 'Pendente',
        periodo: feita ? null : (form.periodo || null),
      }, linhas)
      show(feita ? `Venda ${id} registrada!` : `Pedido ${id} salvo!`)
      setTimeout(() => { onSaved?.(); onClose?.() }, 700)
    } catch (e) {
      show('Erro: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`np np-${variante}`}>
      <div className="np-corpo">
      <div className="np-bloco">
        <Segmento valor={modo} onChange={trocarModo} opcoes={[{ v: 'encomenda', l: '📦 Encomenda' }, { v: 'feita', l: '✓ Venda já feita' }]} />
        {feita && <div className="np-dica">Fica como entregue e sai do estoque. Use pra registrar o que já vendeu.</div>}
      </div>

      <div className="np-bloco">
        <div className="np-titulo">Cliente</div>
        <input className="field-input" list="np-clientes" placeholder={feita ? 'Nome (opcional)' : 'Nome do cliente'} autoComplete="off"
          value={form.cliente} onChange={e => mudarCliente(e.target.value)} />
        <datalist id="np-clientes">{(clientes || []).map(c => <option key={c.id} value={c.nome} />)}</datalist>
        <input className="field-input" style={{ marginBottom: 8 }} type="tel" inputMode="tel" placeholder="WhatsApp (opcional)"
          value={form.contato} onChange={e => set('contato', e.target.value)} />
        <div className="np-chips">
          {CANAIS.map(c => (
            <button key={c} type="button" className={`np-chip mini${form.canal === c ? ' on' : ''}`} onClick={() => mudarCanal(c)}><b>{c}</b></button>
          ))}
        </div>
      </div>

      <div className="np-bloco">
        <div className="np-titulo">{feita ? 'Quando foi' : 'Data de entrega'}</div>
        <Datas key={modo} modo={modo} valor={form.dataEntrega} onChange={v => set('dataEntrega', v)} />
      </div>

      <div className="np-bloco">
        <div className="np-titulo">Itens</div>
        {itens.length > 0 && (
          <div className="np-lista" style={{ marginBottom: 8 }}>
            {itens.map(it => (
              <div key={it.key} style={{ padding: '10px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Thumb p={prodPorId[it.produtoId] || { nome: it.produto }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{it.produto}</div>
                    {it.combo && (
                      <button type="button" className="np-link" onClick={() => setMontando({ prod: prodPorId[it.produtoId], key: it.key })}>
                        {it.combo.map(c => `${c.qtd} ${c.nome}`).join(' · ')} · trocar
                      </button>
                    )}
                    {it.avulso && <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>fora do cadastro</div>}
                  </div>
                  <Passo n={it.quantidade} onMenos={() => mudarQtd(it.key, -1)} onMais={() => mudarQtd(it.key, 1)} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, paddingLeft: 54, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  <span>R$</span>
                  <input className="np-preco" inputMode="decimal" aria-label={`Preço de ${it.produto}`}
                    value={typeof it.precoUnit === 'number' ? fmtR(it.precoUnit) : it.precoUnit}
                    onChange={e => mudarPreco(it.key, e.target.value)} />
                  <span style={{ flex: 1 }}>cada</span>
                  <b style={{ color: 'var(--text-primary)', fontSize: 13.5 }}>R$ {fmtR(num(it.precoUnit) * (parseFloat(it.quantidade) || 0))}</b>
                </div>
              </div>
            ))}
          </div>
        )}
        <button type="button" className="np-tracejado verde" onClick={() => setSeletor(true)}>+ {itens.length ? 'Adicionar mais produtos' : 'Adicionar produtos'}</button>
      </div>

      <div className="np-bloco">
        <div className="np-titulo">Entrega</div>
        <Segmento valor={form.tipoEntrega} onChange={v => set('tipoEntrega', v)} opcoes={[{ v: 'Entrega', l: '🛵 Entrega' }, { v: 'Retirada', l: '🏠 Retirada' }]} />
        {!feita && (
          <div className="np-chips" style={{ marginTop: 10 }}>
            {PERIODOS_NP.map(p => (
              <button key={p.v} type="button" className={`np-chip${form.periodo === p.v ? ' on' : ''}`} onClick={() => set('periodo', p.v)}>
                <b>{p.l}</b><span>{p.h}</span>
              </button>
            ))}
          </div>
        )}
        {form.tipoEntrega === 'Entrega' && (
          <div style={{ marginTop: 10 }}>
            <input className="field-input" placeholder="Endereço: rua, número, complemento, bairro" autoComplete="street-address"
              value={form.endereco} onChange={e => set('endereco', e.target.value)} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, fontSize: 13, color: 'var(--text-secondary)' }}>Frete cobrado</span>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>R$</span>
              <input className="field-input" style={{ width: 96, marginBottom: 0, textAlign: 'right' }} inputMode="decimal" placeholder="0,00"
                value={form.frete} onChange={e => set('frete', e.target.value)} />
            </div>
          </div>
        )}
      </div>

      <div className="np-bloco">
        <div className="np-titulo">Pagamento</div>
        <Segmento valor={form.pgto === 'Pago' ? 'Pago' : 'Aguardando'} onChange={v => set('pgto', v)} opcoes={[{ v: 'Aguardando', l: 'A receber' }, { v: 'Pago', l: '✓ Pago' }]} />
        {form.pgto !== 'Pago' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <span style={{ flex: 1, fontSize: 13, color: 'var(--text-secondary)' }}>Sinal já recebido (opcional)</span>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>R$</span>
            <input className="field-input" style={{ width: 96, marginBottom: 0, textAlign: 'right' }} inputMode="decimal" placeholder="0,00"
              value={form.sinal} onChange={e => set('sinal', e.target.value)} />
          </div>
        )}
      </div>

      <div className="np-bloco">
        <div className="np-titulo">Observações</div>
        <textarea className="field-input" rows={2} style={{ resize: 'none', marginBottom: 0 }}
          placeholder="Horário combinado, recado do cartão, alergia…" value={form.obs} onChange={e => set('obs', e.target.value)} />
      </div>
      </div>

      <div className="np-rodape">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <span style={{ flex: 1, fontSize: 12, color: 'var(--text-tertiary)' }}>
            {nItens > 0 ? `${nItens} ${nItens === 1 ? 'item' : 'itens'}${freteNum ? ` + frete R$ ${fmtR(freteNum)}` : ''}` : 'Total'}
          </span>
          <b style={{ fontSize: 21 }}>R$ {fmtR(total)}</b>
        </div>
        <button type="button" className="btn-primary" onClick={salvar} disabled={saving} style={{ opacity: pronto ? 1 : 0.45 }}>
          {saving ? 'Salvando…' : feita ? 'Registrar venda' : 'Salvar pedido'}
        </button>
      </div>

      {seletor && (
        <Seletor produtos={lista} itens={itens} canal={form.canal} total={subtotal} nItens={nItens}
          onMais={p => somar(p, 1)} onMenos={p => somar(p, -1)} onCombo={abrirCombo} onAvulso={addAvulso}
          onFechar={() => setSeletor(false)} />
      )}
      {montando?.prod && (
        <MontarCombo combo={montando.prod} produtos={lista}
          inicial={montando.key ? itens.find(it => it.key === montando.key)?.combo : null}
          onConfirmar={confirmarCombo} onFechar={() => setMontando(null)} />
      )}
    </div>
  )
}
