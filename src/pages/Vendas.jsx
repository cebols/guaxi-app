import { useState, useMemo } from 'react'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { getConfig } from '../hooks/useConfig'
import { getProdutos, getVendas, saveVenda, deleteVenda } from '../services/db'

const PLATAFORMAS = ['Direta', '99Food', 'iFood']
const PLAT_COLOR = { 'Direta': 'var(--teal)', '99Food': '#f59e0b', 'iFood': '#ef4444' }

function fmtR(val) {
  if (!val && val !== 0) return '—'
  const r = Math.ceil(Number(val) * 100) / 100
  return `R$ ${r.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtN(v, dec = 1) {
  return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: dec })
}
function isoToday() { return new Date().toISOString().split('T')[0] }

// ── Simple horizontal bar chart ──────────────────────────────
function Barras({ itens }) {
  const max = Math.max(...itens.map(i => i.valor), 0.01)
  return (
    <div>
      {itens.map((d, i) => (
        <div key={i} style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', width: 90, textAlign: 'right', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.label}>{d.label}</div>
          <div style={{ flex: 1, height: 14, background: 'var(--border)', borderRadius: 3 }}>
            <div style={{ width: `${(d.valor / max) * 100}%`, height: '100%', background: d.cor || 'var(--teal)', borderRadius: 3, transition: 'width 0.4s' }} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', width: 64, flexShrink: 0 }}>{fmtR(d.valor)}</div>
        </div>
      ))}
    </div>
  )
}

// ── Weekly trend (vertical bars) ────────────────────────────
function TendenciaSemanal({ vendas }) {
  const semanas = useMemo(() => {
    const result = []
    const hoje = new Date()
    for (let w = 5; w >= 0; w--) {
      const seg = new Date(hoje)
      seg.setDate(hoje.getDate() - ((hoje.getDay() || 7) - 1) - w * 7)
      const dom = new Date(seg); dom.setDate(seg.getDate() + 6)
      const inicio = seg.toISOString().split('T')[0]
      const fim    = dom.toISOString().split('T')[0]
      const total  = vendas.filter(v => v.data >= inicio && v.data <= fim)
        .reduce((s, v) => s + v.quantidade * v.precoUnit, 0)
      result.push({ label: seg.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }), total, inicio })
    }
    return result
  }, [vendas])

  const max = Math.max(...semanas.map(s => s.total), 0.01)
  const hoje = isoToday()

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80, paddingBottom: 20 }}>
      {semanas.map((s, i) => {
        const h = Math.max(4, (s.total / max) * 64)
        const isThisWeek = hoje >= s.inicio && i === semanas.length - 1
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <div style={{ fontSize: 9, color: 'var(--teal)' }}>{s.total > 0 ? fmtR(s.total).replace('R$ ', '') : ''}</div>
            <div style={{ width: '100%', height: h, background: isThisWeek ? 'var(--teal)' : 'var(--border)', borderRadius: '3px 3px 0 0' }} />
            <div style={{ fontSize: 9, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{s.label}</div>
          </div>
        )
      })}
    </div>
  )
}

// ── Sheets ───────────────────────────────────────────────────
function Sheet({ title, children, onClose }) {
  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-title">
          <span>{title}</span>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer' }} onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </>
  )
}

function VendaForm({ produtos, prefill, onSave, onClose }) {
  const cfg = getConfig()
  const [form, setForm] = useState({
    data: isoToday(),
    produtoNome: prefill?.nome || '',
    produtoId:   prefill?.id   || null,
    quantidade:  1,
    plataforma:  'Direta',
    precoUnit:   prefill?.precoPraticado || prefill?.precoSugerido || '',
    custoUnit:   prefill?.custoTotal     || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleProdSelect = (nome) => {
    const prod = produtos?.find(p => p.nome === nome)
    set('produtoNome', nome)
    set('produtoId',   prod?.id  || null)
    set('precoUnit',   prod?.precoPraticado || prod?.precoSugerido || '')
    set('custoUnit',   prod?.custoTotal     || '')
  }

  const fee       = form.plataforma === '99Food' ? cfg.taxa99 / 100 : form.plataforma === 'iFood' ? cfg.taxaIfood / 100 : 0
  const revenue   = (parseFloat(form.precoUnit) || 0) * (parseFloat(form.quantidade) || 1)
  const revNet    = revenue * (1 - fee)
  const cost      = (parseFloat(form.custoUnit) || 0) * (parseFloat(form.quantidade) || 1)
  const profit    = revNet - cost
  const margin    = revNet > 0 ? (profit / revNet) * 100 : null

  const handle = async () => {
    if (!form.produtoNome || !form.precoUnit) return
    setSaving(true)
    try { await onSave(form); onClose() }
    catch (e) { alert(e.message) } finally { setSaving(false) }
  }

  return (
    <Sheet title="Lançar venda" onClose={onClose}>
      <div className="field-label">Data</div>
      <input className="field-input" type="date" value={form.data} onChange={e => set('data', e.target.value)} />
      <div className="field-label">Produto *</div>
      <input className="field-input" list="prod-venda-list" placeholder="Selecione um produto" value={form.produtoNome} onChange={e => handleProdSelect(e.target.value)} />
      <datalist id="prod-venda-list">{(produtos || []).map(p => <option key={p.id} value={p.nome} />)}</datalist>
      <div className="field-row">
        <div>
          <div className="field-label">Quantidade</div>
          <input className="field-input" type="number" min="0.5" step="0.5" value={form.quantidade} onChange={e => set('quantidade', e.target.value)} />
        </div>
        <div>
          <div className="field-label">Plataforma</div>
          <select className="field-input" value={form.plataforma} onChange={e => set('plataforma', e.target.value)}>
            {PLATAFORMAS.map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
      </div>
      <div className="field-label">Preço cobrado (R$) *</div>
      <input className="field-input" type="number" min="0" step="0.50" value={form.precoUnit} onChange={e => set('precoUnit', e.target.value)} />
      {margin !== null && (
        <div style={{ padding: '8px 12px', background: 'var(--teal-light)', borderRadius: 8, marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--teal)' }}>
            Faturamento: <strong>{fmtR(revenue)}</strong>
            {fee > 0 && <span style={{ color: 'var(--text-secondary)', marginLeft: 6 }}>→ líquido {fmtR(revNet)} (−{fmtN(fee * 100)}% taxa)</span>}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: margin >= cfg.margem ? 'var(--teal)' : margin >= 0 ? '#f59e0b' : 'var(--alert-text)', marginTop: 2 }}>
            Lucro: {fmtR(profit)} · Margem: {fmtN(margin)}%
            {margin < cfg.margem && <span style={{ marginLeft: 6 }}>⚠ abaixo da meta ({fmtN(cfg.margem)}%)</span>}
          </div>
        </div>
      )}
      <button className="btn-primary" onClick={handle} disabled={saving || !form.produtoNome || !form.precoUnit}>
        {saving ? 'Salvando...' : 'Registrar venda'}
      </button>
    </Sheet>
  )
}

function LancamentoRapido({ produtos, onSave, onClose }) {
  const [data, setData] = useState(isoToday())
  const [plataforma, setPlataforma] = useState('Direta')
  const [qtds, setQtds] = useState({})
  const [saving, setSaving] = useState(false)

  const comVenda = (produtos || []).filter(p => qtds[p.id] && parseFloat(qtds[p.id]) > 0)

  const handle = async () => {
    if (comVenda.length === 0) return
    setSaving(true)
    try {
      for (const prod of comVenda) {
        await onSave({
          data, produtoNome: prod.nome, produtoId: prod.id,
          quantidade: parseFloat(qtds[prod.id]),
          plataforma,
          precoUnit: prod.precoPraticado || prod.precoSugerido || 0,
          custoUnit: prod.custoTotal || 0,
        })
      }
      onClose()
    } catch (e) { alert(e.message) } finally { setSaving(false) }
  }

  return (
    <Sheet title="Lançamento rápido" onClose={onClose}>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
        Preencha as quantidades vendidas e salve tudo de uma vez.
      </div>
      <div className="field-row">
        <div>
          <div className="field-label">Data</div>
          <input className="field-input" type="date" value={data} onChange={e => setData(e.target.value)} />
        </div>
        <div>
          <div className="field-label">Plataforma</div>
          <select className="field-input" value={plataforma} onChange={e => setPlataforma(e.target.value)}>
            {PLATAFORMAS.map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
      </div>
      <div className="card card-flush" style={{ padding: '0 14px', marginBottom: 8 }}>
        {(produtos || []).map((prod, i) => (
          <div key={prod.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < produtos.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{prod.nome}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{fmtR(prod.precoPraticado || prod.precoSugerido)}</div>
            </div>
            <input
              className="item-qty"
              type="number"
              min="0"
              step="1"
              placeholder="0"
              value={qtds[prod.id] || ''}
              onChange={e => setQtds(prev => ({ ...prev, [prod.id]: e.target.value }))}
              style={{ width: 64 }}
            />
          </div>
        ))}
      </div>
      {comVenda.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--teal)', marginBottom: 8 }}>
          {comVenda.length} produto(s) · {comVenda.reduce((s, p) => s + parseFloat(qtds[p.id]), 0)} unidades
        </div>
      )}
      <button className="btn-primary" onClick={handle} disabled={saving || comVenda.length === 0}>
        {saving ? 'Salvando...' : `Salvar ${comVenda.length > 0 ? comVenda.length : ''} venda(s)`}
      </button>
    </Sheet>
  )
}

// ── Main ─────────────────────────────────────────────────────
export default function Vendas() {
  const [periodo, setPeriodo]   = useState('mes')
  const [tab, setTab]           = useState('performance')
  const [sheet, setSheet]       = useState(null)
  const { toast, show }         = useToast()

  const { data: produtos, loading: lProd }               = useData(getProdutos)
  const { data: vendas,   loading: lVend, reload: rVend } = useData(getVendas)
  const cfg = getConfig()

  const inicio = useMemo(() => {
    if (periodo === 'semana') {
      const d = new Date(); const day = d.getDay() || 7
      d.setDate(d.getDate() - day + 1)
      return d.toISOString().split('T')[0]
    }
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  }, [periodo])

  const feeFor = (plat) => plat === '99Food' ? cfg.taxa99 / 100 : plat === 'iFood' ? cfg.taxaIfood / 100 : 0

  const vendasPeriodo = useMemo(() => (vendas || []).filter(v => v.data >= inicio), [vendas, inicio])

  const statsPerProd = useMemo(() => {
    const map = {}
    vendasPeriodo.forEach(v => {
      const k = v.produtoNome
      if (!map[k]) map[k] = { units: 0, revenue: 0, revNet: 0, cost: 0 }
      const fee = feeFor(v.plataforma)
      map[k].units  += v.quantidade
      map[k].revenue += v.quantidade * v.precoUnit
      map[k].revNet  += v.quantidade * v.precoUnit * (1 - fee)
      map[k].cost    += v.quantidade * (v.custoUnit || 0)
    })
    return map
  }, [vendasPeriodo])

  const statsPerPlat = useMemo(() => {
    const map = {}
    vendasPeriodo.forEach(v => {
      if (!map[v.plataforma]) map[v.plataforma] = { revenue: 0, units: 0 }
      map[v.plataforma].revenue += v.quantidade * v.precoUnit
      map[v.plataforma].units   += v.quantidade
    })
    return map
  }, [vendasPeriodo])

  const totalRevNet = Object.values(statsPerProd).reduce((s, p) => s + p.revNet, 0)
  const totalCost   = Object.values(statsPerProd).reduce((s, p) => s + p.cost, 0)
  const totalProfit = totalRevNet - totalCost
  const totalMargin = totalRevNet > 0 ? (totalProfit / totalRevNet) * 100 : 0
  const totalUnits  = Object.values(statsPerProd).reduce((s, p) => s + p.units, 0)

  const unidadesProj = cfg.unidadesProjetadas || 0
  const pctProj      = unidadesProj > 0 ? (totalUnits / unidadesProj) * 100 : null
  const rateioReal   = totalUnits > 0 && periodo === 'mes' ? (cfg.custoFixoMensal || 0) / totalUnits : null

  const handleSave = async (venda) => { await saveVenda(venda); rVend(); show('Venda registrada!') }
  const handleDelete = async (id)   => { await deleteVenda(id);  rVend(); show('Removido!') }

  const historicoGrupos = useMemo(() => {
    const map = {}
    ;(vendas || []).slice(0, 80).forEach(v => {
      if (!map[v.data]) map[v.data] = []
      map[v.data].push(v)
    })
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]))
  }, [vendas])

  const fmtDate = (iso) => {
    const today = isoToday()
    if (iso === today) return 'Hoje'
    return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', weekday: 'short' })
  }

  const loading = lProd || lVend

  const barrasProduto = useMemo(() =>
    Object.entries(statsPerProd)
      .map(([nome, s]) => ({ label: nome, valor: s.revNet, cor: 'var(--teal)' }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 8),
    [statsPerProd]
  )

  const barrasPlat = useMemo(() =>
    Object.entries(statsPerPlat).map(([plat, s]) => ({ label: plat, valor: s.revenue, cor: PLAT_COLOR[plat] || 'var(--teal)' })),
    [statsPerPlat]
  )

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div className="topbar-title">Vendas</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn-ghost desktop-only" onClick={() => setSheet({ type: 'rapido' })}
              style={{ fontSize: 13, padding: '6px 12px', color: 'var(--text-secondary)' }}>
              ⚡ Rápido
            </button>
            <button className="btn-outline-teal desktop-only" onClick={() => setSheet({ type: 'venda' })}
              style={{ fontSize: 13, padding: '6px 14px' }}>
              + Lançar venda
            </button>
            <button className="btn-ghost mobile-only" onClick={() => setSheet({ type: 'rapido' })}
              style={{ fontSize: 18, padding: '4px 10px', border: 'none', color: 'var(--text-secondary)' }}>⚡</button>
            <button className="btn-ghost mobile-only" onClick={() => setSheet({ type: 'venda' })}
              style={{ fontSize: 20, padding: '4px 12px', border: 'none', color: 'var(--teal)' }}>+</button>
          </div>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 16 }}>
        <div className="tab-bar">
          <button className={`tab-btn ${tab === 'performance' ? 'active' : ''}`} onClick={() => setTab('performance')}>Performance</button>
          <button className={`tab-btn ${tab === 'graficos'    ? 'active' : ''}`} onClick={() => setTab('graficos')}>Gráficos</button>
          <button className={`tab-btn ${tab === 'historico'   ? 'active' : ''}`} onClick={() => setTab('historico')}>Histórico</button>
        </div>

        {/* ── PERFORMANCE ─────────────────────────── */}
        {tab === 'performance' && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {['semana', 'mes'].map(p => (
                <button key={p} onClick={() => setPeriodo(p)} style={{
                  fontSize: 13, padding: '5px 14px', borderRadius: 20,
                  border: '1px solid var(--border)',
                  background: periodo === p ? 'var(--teal)' : 'transparent',
                  color: periodo === p ? '#fff' : 'var(--text-secondary)',
                  cursor: 'pointer',
                }}>
                  {p === 'semana' ? 'Esta semana' : 'Este mês'}
                </button>
              ))}
            </div>

            <div className="metric-grid" style={{ marginBottom: 12 }}>
              <div className="metric-card">
                <div className="metric-label">Faturamento líq.</div>
                <div className="metric-value" style={{ fontSize: 14 }}>{loading ? '—' : fmtR(totalRevNet)}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Lucro</div>
                <div className="metric-value" style={{ fontSize: 14, color: totalProfit >= 0 ? 'var(--teal)' : 'var(--alert-text)' }}>
                  {loading ? '—' : fmtR(totalProfit)}
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Margem</div>
                <div className="metric-value" style={{ color: totalMargin >= cfg.margem ? 'var(--teal)' : totalMargin > 0 ? '#f59e0b' : 'var(--text-primary)' }}>
                  {loading ? '—' : totalRevNet > 0 ? `${fmtN(totalMargin)}%` : '—'}
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Unidades</div>
                <div className="metric-value">{loading ? '—' : totalUnits || '0'}</div>
              </div>
            </div>

            {periodo === 'mes' && unidadesProj > 0 && !loading && (
              <div className="card" style={{ padding: '10px 14px', marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Projeção — {new Date().toLocaleDateString('pt-BR', { month: 'long' })}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3 }}>
                    <div style={{ width: `${Math.min(100, pctProj || 0)}%`, height: '100%', background: pctProj >= 100 ? 'var(--teal)' : pctProj >= 60 ? '#f59e0b' : 'var(--alert-text)', borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flexShrink: 0 }}>
                    {totalUnits}/{unidadesProj} un ({pctProj !== null ? `${fmtN(pctProj)}%` : '—'})
                  </span>
                </div>
                {rateioReal !== null && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                    Rateio real: R$ {fmtN(rateioReal, 2)}/un · projetado: R$ {fmtN(unidadesProj > 0 ? (cfg.custoFixoMensal || 0) / unidadesProj : 0, 2)}/un
                  </div>
                )}
              </div>
            )}

            <div className="section-label">Produtos</div>
            {loading ? <div className="loading">Carregando...</div> : (
              <div className="card card-flush" style={{ padding: '0 14px' }}>
                {(produtos || []).map(prod => {
                  const s = statsPerProd[prod.nome]
                  const profit = s ? s.revNet - s.cost : null
                  const margin = s && s.revNet > 0 ? (profit / s.revNet) * 100 : null
                  const marginColor = margin === null ? 'var(--text-tertiary)'
                    : margin >= cfg.margem ? 'var(--teal)'
                    : margin >= 0 ? '#f59e0b' : 'var(--alert-text)'
                  return (
                    <div key={prod.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{prod.nome}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                            Custo: {fmtR(prod.custoTotal)} · Preço: {fmtR(prod.precoPraticado || prod.precoSugerido)}
                          </div>
                          {s ? (
                            <div style={{ fontSize: 12, marginTop: 4 }}>
                              <span style={{ color: 'var(--text-secondary)' }}>{fmtN(s.units)} un · {fmtR(s.revNet)} · </span>
                              <span style={{ color: marginColor, fontWeight: 600 }}>
                                lucro {fmtR(profit)} ({margin !== null ? `${fmtN(margin)}%` : '—'})
                              </span>
                              {margin !== null && margin < cfg.margem && (
                                <span style={{ color: '#f59e0b', marginLeft: 6, fontSize: 11 }}>⚠ abaixo da meta</span>
                              )}
                            </div>
                          ) : (
                            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>sem vendas neste período</div>
                          )}
                        </div>
                        <button onClick={() => setSheet({ type: 'venda', produto: prod })}
                          style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--teal)', color: 'var(--teal)', background: 'transparent', cursor: 'pointer', flexShrink: 0, marginLeft: 8 }}>
                          + Venda
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* ── GRÁFICOS ─────────────────────────────── */}
        {tab === 'graficos' && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {['semana', 'mes'].map(p => (
                <button key={p} onClick={() => setPeriodo(p)} style={{
                  fontSize: 13, padding: '5px 14px', borderRadius: 20, border: '1px solid var(--border)',
                  background: periodo === p ? 'var(--teal)' : 'transparent',
                  color: periodo === p ? '#fff' : 'var(--text-secondary)', cursor: 'pointer',
                }}>
                  {p === 'semana' ? 'Esta semana' : 'Este mês'}
                </button>
              ))}
            </div>

            {lVend ? <div className="loading">Carregando...</div> : (
              <>
                <div className="section-label">Tendência semanal — últimas 6 semanas</div>
                <div className="card" style={{ padding: '12px 16px', marginBottom: 12 }}>
                  {(vendas || []).length === 0
                    ? <div style={{ fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center' }}>Sem dados de vendas</div>
                    : <TendenciaSemanal vendas={vendas || []} />
                  }
                </div>

                {barrasProduto.length > 0 && (
                  <>
                    <div className="section-label">Receita por produto ({periodo === 'semana' ? 'esta semana' : 'este mês'})</div>
                    <div className="card" style={{ padding: '12px 16px', marginBottom: 12 }}>
                      <Barras itens={barrasProduto} />
                    </div>
                  </>
                )}

                {barrasPlat.length > 0 && (
                  <>
                    <div className="section-label">Receita por plataforma</div>
                    <div className="card" style={{ padding: '12px 16px', marginBottom: 12 }}>
                      <Barras itens={barrasPlat} />
                    </div>
                  </>
                )}

                {barrasProduto.length === 0 && (
                  <div className="empty"><span>Registre vendas para ver os gráficos</span></div>
                )}
              </>
            )}
          </>
        )}

        {/* ── HISTÓRICO ────────────────────────────── */}
        {tab === 'historico' && (
          lVend ? <div className="loading">Carregando...</div> :
          historicoGrupos.length === 0 ? <div className="empty"><span>Nenhuma venda registrada</span></div> :
          historicoGrupos.map(([data, items]) => (
            <div key={data}>
              <div className="cat-header">{fmtDate(data)}</div>
              <div className="card card-flush" style={{ padding: '0 14px', marginBottom: 8 }}>
                {items.map(v => {
                  const fee = feeFor(v.plataforma)
                  const profitUnit = v.precoUnit * (1 - fee) - v.custoUnit
                  return (
                    <div key={v.id} style={{ display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)', gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>
                          {v.produtoNome}
                          {v.quantidade > 1 && <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}> ×{v.quantidade}</span>}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>
                          <span style={{ color: PLAT_COLOR[v.plataforma] || 'var(--teal)' }}>{v.plataforma}</span>
                          {' · '}{fmtR(v.precoUnit)}/un
                          {v.custoUnit > 0 && <span> · lucro {fmtR(profitUnit)}/un</span>}
                        </div>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--teal)', flexShrink: 0 }}>
                        {fmtR(v.precoUnit * v.quantidade)}
                      </div>
                      <button onClick={() => handleDelete(v.id)}
                        style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 16, padding: '0 4px', flexShrink: 0 }}>×</button>
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>

      <button className="fab mobile-only" onClick={() => setSheet({ type: 'rapido' })}>⚡</button>

      {sheet?.type === 'venda'  && <VendaForm    produtos={produtos} prefill={sheet.produto} onSave={handleSave} onClose={() => setSheet(null)} />}
      {sheet?.type === 'rapido' && <LancamentoRapido produtos={produtos} onSave={handleSave} onClose={() => setSheet(null)} />}

      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
