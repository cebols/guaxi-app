import { useState, useMemo, useRef } from 'react'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { useAuth } from '../contexts/AuthContext'
import { SpotlightHint } from '../components/SpotlightHint'
import { getConfig, getCustoSacolaDelivery } from '../hooks/useConfig'
import { getProdutos, getVendas, saveVenda, deleteVenda, getCompras, getEncomendas, getEmbalagens } from '../services/db'

function MockVendasPreview({ dreRef }) {
  return (
    <div style={{ position: 'relative', opacity: 0.8, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, textAlign: 'center',
        fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic', zIndex: 1 }}>
        Preview — seus dados aparecerão aqui
      </div>
      <div className="metric-grid" style={{ marginBottom: 12, marginTop: 18 }}>
        {[
          { label: 'Faturamento líq.', value: 'R$ 3.240' },
          { label: 'Lucro líquido',    value: 'R$ 1.458', color: 'var(--teal)' },
          { label: 'Margem líquida',   value: '45%',      color: 'var(--teal)' },
          { label: 'Unidades',         value: '87' },
        ].map(m => (
          <div key={m.label} className="card" style={{ marginBottom: 0 }}>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700, marginBottom: 4 }}>{m.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: m.color || 'var(--text-primary)' }}>{m.value}</div>
          </div>
        ))}
      </div>
      <div ref={dreRef} className="card" style={{ padding: '12px 16px', marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 }}>DRE · Este mês</div>
        {[
          { label: 'Receita bruta',        value: 'R$ 3.780' },
          { label: '− Taxas plataformas',  value: '− R$ 540' },
          { label: '= Receita líquida',    value: 'R$ 3.240', bold: true },
          { label: '− CMV (custo receitas)', value: '− R$ 1.020' },
          { label: '− Custos fixos',       value: '− R$ 550' },
          { label: '= Lucro líquido',      value: 'R$ 1.458', bold: true, color: 'var(--teal)' },
        ].map(row => (
          <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between',
            padding: '6px 0', borderTop: row.bold ? '1px solid var(--border)' : 'none', marginTop: row.bold ? 4 : 0 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{row.label}</span>
            <span style={{ fontSize: 13, fontWeight: row.bold ? 700 : 400, color: row.color || 'var(--text-primary)' }}>{row.value}</span>
          </div>
        ))}
      </div>
      <div className="card" style={{ padding: '12px 14px', marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>Canal de venda</div>
        {[['Direta', 60, 'var(--teal)'], ['iFood', 28, '#ef4444'], ['99Food', 12, '#f59e0b']].map(([plat, pct, cor]) => (
          <div key={plat} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: cor }}>{plat}</span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{pct}%</span>
            </div>
            <div style={{ height: 4, background: '#252525', borderRadius: 2 }}>
              <div style={{ width: `${pct}%`, height: '100%', background: cor, borderRadius: 2 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function DateInput({ value, onChange, className, style }) {
  function toDisplay(iso) {
    if (!iso) return ''
    const [y, m, d] = iso.split('-')
    return y && m && d ? `${d}/${m}/${y}` : iso
  }
  function toISO(digits) {
    if (digits.length === 8) return `${digits.slice(4)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`
    return ''
  }
  const [display, setDisplay] = useState(toDisplay(value))
  const handleChange = (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 8)
    let fmt = digits
    if (digits.length > 2) fmt = digits.slice(0, 2) + '/' + digits.slice(2)
    if (digits.length > 4) fmt = digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4)
    setDisplay(fmt)
    const iso = toISO(digits)
    if (iso) onChange(iso)
    else if (digits.length === 0) onChange('')
  }
  return (
    <input className={className} style={style} type="text" inputMode="numeric"
      placeholder="dd/mm/aaaa" value={display} onChange={handleChange} maxLength={10} />
  )
}

const PLATAFORMAS = ['Direta', '99Food', 'iFood']
const PLAT_COLOR  = { 'Direta': 'var(--teal)', '99Food': '#f59e0b', 'iFood': '#ef4444' }
const CANAL_TO_PLAT = { 'iFood': 'iFood', '99Food': '99Food' } // others → 'Direta'
const PROD_COLORS = ['#14b8a6','#f59e0b','#6366f1','#ec4899','#10b981','#f97316','#8b5cf6','#06b6d4','#84cc16','#e11d48']

function fmtR(val) {
  if (!val && val !== 0) return '—'
  const r = Math.ceil(Number(val) * 100) / 100
  return `R$ ${r.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtN(v, dec = 1) {
  return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: dec })
}
function isoToday() { return new Date().toISOString().split('T')[0] }

function precoForPlat(prod, plat) {
  if (!prod) return ''
  if (plat === 'Direta') return prod.precoDireta ?? prod.precoPraticado ?? prod.precoSugerido ?? ''
  if (plat === '99Food') return prod.preco99     ?? prod.precoPraticado ?? prod.precoSugerido ?? ''
  if (plat === 'iFood')  return prod.precoIfood  ?? prod.precoPraticado ?? prod.precoSugerido ?? ''
  return prod.precoPraticado ?? prod.precoSugerido ?? ''
}

// ── Horizontal bar chart ─────────────────────────────────────
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

// ── Horizontal bar chart — units ─────────────────────────────
function BarrasQtd({ itens }) {
  const max = Math.max(...itens.map(i => i.valor), 0.01)
  return (
    <div>
      {itens.map((d, i) => (
        <div key={i} style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', width: 90, textAlign: 'right', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.label}>{d.label}</div>
          <div style={{ flex: 1, height: 14, background: 'var(--border)', borderRadius: 3 }}>
            <div style={{ width: `${(d.valor / max) * 100}%`, height: '100%', background: d.cor || 'var(--teal)', borderRadius: 3, transition: 'width 0.4s' }} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', width: 40, flexShrink: 0 }}>{fmtN(d.valor, 0)} un</div>
        </div>
      ))}
    </div>
  )
}

// ── Top/Bottom ranking ───────────────────────────────────────
function RankingProdutos({ stats, mode = 'top', criterio = 'margem' }) {
  const items = Object.entries(stats)
    .filter(([, s]) => s.units > 0)
    .map(([nome, s]) => {
      const profit = s.revNet - s.cost
      const margin = s.revNet > 0 ? (profit / s.revNet) * 100 : 0
      return { nome, units: s.units, revNet: s.revNet, profit, margin }
    })
    .sort((a, b) => criterio === 'margem' ? b.margin - a.margin : b.revNet - a.revNet)

  const list = mode === 'top' ? items.slice(0, 5) : items.slice(-5).reverse()
  if (list.length === 0) return null

  return (
    <div>
      {list.map((it, i) => {
        const cor = it.margin >= 40 ? 'var(--teal)' : it.margin >= 20 ? '#f59e0b' : 'var(--alert-text)'
        return (
          <div key={it.nome} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: i < list.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', width: 16, fontWeight: 700 }}>{i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.nome}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{fmtN(it.units, 0)} un · {fmtR(it.revNet)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: cor }}>{fmtN(it.margin)}%</div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>margem</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Day-of-week heatmap ──────────────────────────────────────
function HeatmapDOW({ vendas }) {
  const DOW_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  const [platFiltro, setPlatFiltro] = useState('Todas')

  const vendasFiltradas = useMemo(() =>
    platFiltro === 'Todas' ? vendas : vendas.filter(v => v.plataforma === platFiltro),
    [vendas, platFiltro]
  )

  const data = useMemo(() => {
    const today = new Date()
    const weeks = 6
    const grid = Array.from({ length: weeks }, () => Array(7).fill(0))
    const weekStarts = []
    for (let w = 0; w < weeks; w++) {
      const d = new Date(today)
      d.setDate(today.getDate() - today.getDay() - w * 7)
      d.setHours(0, 0, 0, 0)
      weekStarts.push(d)
    }
    for (const v of vendasFiltradas) {
      if (!v.data) continue
      const d = new Date(v.data + 'T12:00:00')
      for (let w = 0; w < weeks; w++) {
        const ws = weekStarts[w]
        const we = new Date(ws); we.setDate(ws.getDate() + 7)
        if (d >= ws && d < we) {
          grid[w][d.getDay()] += (v.quantidade || 0) * (v.precoUnit || 0)
          break
        }
      }
    }
    const max = Math.max(...grid.flat(), 0.01)
    const dowTotals = Array(7).fill(0)
    for (const row of grid) row.forEach((v, i) => dowTotals[i] += v)
    return { grid: grid.reverse(), max, dowTotals }
  }, [vendasFiltradas])

  if (data.max < 0.02) return <div style={{ fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center' }}>Sem dados suficientes</div>

  const cell = (v) => {
    const intensity = v / data.max
    const bg = v === 0 ? 'transparent' : `rgba(20, 184, 166, ${0.15 + intensity * 0.7})`
    return (
      <div style={{
        flex: 1, aspectRatio: '1', borderRadius: 4,
        background: bg, border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, color: intensity > 0.5 ? '#000' : 'var(--text-tertiary)',
      }} title={fmtR(v)}>
        {v > 0 ? fmtN(v, 0) : ''}
      </div>
    )
  }

  return (
    <div>
      {/* Filtro plataforma */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {['Todas', ...PLATAFORMAS].map(p => {
          const a = platFiltro === p
          return (
            <button key={p} onClick={() => setPlatFiltro(p)} style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 14, cursor: 'pointer',
              border: `1px solid ${a ? (PLAT_COLOR[p] || 'var(--teal)') : 'var(--border)'}`,
              background: a ? (PLAT_COLOR[p] || 'var(--teal)') : 'transparent',
              color: a ? '#fff' : 'var(--text-secondary)', fontWeight: a ? 700 : 400,
            }}>{p}</button>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        <div style={{ width: 28, flexShrink: 0 }} />
        {DOW_LABELS.map(d => <div key={d} style={{ flex: 1, fontSize: 10, color: 'var(--text-tertiary)', textAlign: 'center' }}>{d}</div>)}
      </div>
      {data.grid.map((row, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
          <div style={{ width: 28, fontSize: 9, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
            -{data.grid.length - 1 - i}s
          </div>
          {row.map((v, j) => <div key={j} style={{ flex: 1 }}>{cell(v)}</div>)}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 4, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
        <div style={{ width: 28, fontSize: 10, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>Σ</div>
        {data.dowTotals.map((v, i) => (
          <div key={i} style={{ flex: 1, fontSize: 10, fontWeight: 600, color: 'var(--teal)', textAlign: 'center' }}>
            {v > 0 ? fmtN(v, 0) : '—'}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Weekly stacked bar chart (per product) ───────────────────
function TendenciaSemanal({ vendas }) {
  const [hovered, setHovered] = useState(null) // { nome, valor }
  const { semanas, prodNomes, colorMap } = useMemo(() => {
    const nomes = [...new Set(vendas.map(v => v.produtoNome))]
    const colorMap = Object.fromEntries(nomes.map((n, i) => [n, PROD_COLORS[i % PROD_COLORS.length]]))

    const result = []
    const hoje = new Date()
    for (let w = 5; w >= 0; w--) {
      const seg = new Date(hoje)
      seg.setDate(hoje.getDate() - ((hoje.getDay() || 7) - 1) - w * 7)
      const dom = new Date(seg); dom.setDate(seg.getDate() + 6)
      const inicio = seg.toISOString().split('T')[0]
      const fim    = dom.toISOString().split('T')[0]
      const weekV  = vendas.filter(v => v.data >= inicio && v.data <= fim)

      const byProd = {}
      weekV.forEach(v => {
        byProd[v.produtoNome] = (byProd[v.produtoNome] || 0) + v.quantidade * v.precoUnit
      })
      const total = Object.values(byProd).reduce((s, x) => s + x, 0)
      result.push({
        label: seg.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
        total, inicio, byProd,
      })
    }

    // add week-over-week change to each entry
    const withChange = result.map((s, i) => ({
      ...s,
      change: i > 0 && result[i - 1].total > 0
        ? ((s.total - result[i - 1].total) / result[i - 1].total) * 100
        : null,
    }))

    return { semanas: withChange, prodNomes: nomes, colorMap }
  }, [vendas])

  const max  = Math.max(...semanas.map(s => s.total), 0.01)
  const maxH = 72
  const WEEK_LABEL_H = 14 // approximate px height of week label

  // média das semanas completas (exceto a corrente) para linha de referência
  const completed = semanas.slice(0, 5).filter(s => s.total > 0)
  const media = completed.length > 0
    ? completed.reduce((s, w) => s + w.total, 0) / completed.length
    : 0
  const mediaY = media > 0 ? WEEK_LABEL_H + (media / max) * maxH : 0

  return (
    <div>
      {/* bar area — position:relative to anchor the média line */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 6, height: maxH + 28 }}>

        {/* ── Linha de média ──────────────────────────────── */}
        {media > 0 && (
          <div style={{
            position: 'absolute', left: 0, right: 0,
            bottom: mediaY,
            borderTop: '1.5px dashed rgba(255,255,255,0.2)',
            pointerEvents: 'none', zIndex: 2,
          }}>
            <span style={{
              position: 'absolute', right: 0, bottom: 3,
              fontSize: 8, color: 'var(--text-tertiary)',
              background: 'var(--bg-card)', padding: '0 3px', borderRadius: 2,
            }}>
              média {fmtR(media).replace('R$ ', '')}
            </span>
          </div>
        )}

        {/* ── Barras ──────────────────────────────────────── */}
        {semanas.map((s, i) => {
          const barH       = s.total > 0 ? Math.max(4, (s.total / max) * maxH) : 0
          const isThisWeek = i === semanas.length - 1
          const segments   = prodNomes
            .filter(p => (s.byProd[p] || 0) > 0)
            .map(p => ({ pct: s.byProd[p] / s.total, color: colorMap[p] }))

          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <div style={{ fontSize: 9, color: 'var(--text-secondary)', height: 12, display: 'flex', alignItems: 'flex-end' }}>
                {s.total > 0 ? fmtR(s.total).replace('R$ ', '') : ''}
              </div>
              <div style={{ width: '100%', height: barH, borderRadius: '3px 3px 0 0', overflow: 'hidden', display: 'flex', flexDirection: 'column', opacity: isThisWeek ? 1 : 0.65 }}>
                {s.total > 0 ? segments.map((seg, si) => {
                  const nome = prodNomes.filter(p => (s.byProd[p] || 0) > 0)[si]
                  return (
                    <div key={si} style={{ flex: seg.pct, background: seg.color, cursor: 'default' }}
                      onMouseEnter={() => setHovered({ nome, valor: s.byProd[nome] })}
                      onMouseLeave={() => setHovered(null)}
                    />
                  )
                }) : (
                  <div style={{ height: 2, background: 'var(--border)', marginTop: 'auto', width: '100%' }} />
                )}
              </div>
              <div style={{ fontSize: 9, color: isThisWeek ? 'var(--text-primary)' : 'var(--text-tertiary)', whiteSpace: 'nowrap', fontWeight: isThisWeek ? 700 : 400 }}>
                {s.label}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Variação semana a semana ─────────────────────── */}
      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
        {semanas.map((s, i) => {
          if (s.change === null) return <div key={i} style={{ flex: 1 }} />
          const up    = s.change > 0
          const color = up ? 'var(--teal)' : s.change < 0 ? 'var(--alert-text)' : 'var(--text-tertiary)'
          return (
            <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 8, color, fontWeight: 700 }}>
              {up ? '↑' : '↓'}{Math.abs(s.change).toFixed(0)}%
            </div>
          )
        })}
      </div>

      {/* ── Tooltip hover ───────────────────────────────── */}
      <div style={{ height: 18, marginBottom: 2 }}>
        {hovered && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: colorMap[hovered.nome], flexShrink: 0 }} />
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{hovered.nome}</span>
            <span style={{ color: 'var(--text-secondary)' }}>{fmtR(hovered.valor)}</span>
          </div>
        )}
      </div>

      {/* ── Legenda produtos ─────────────────────────────── */}
      {prodNomes.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 4 }}>
          {prodNomes.map(p => (
            <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-secondary)' }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: colorMap[p], flexShrink: 0 }} />
              <span>{p}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Sheets ───────────────────────────────────────────────────
function DateChips({ value, onChange }) {
  const today     = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
  const fmt = (iso) => { const [, m, d] = iso.split('-'); return `${d}/${m}` }
  const init = value === yesterday ? 'ontem' : (value && value !== today) ? 'data' : 'hoje'
  const [chip, setChip] = useState(init)
  const cs = (id) => {
    const a = chip === id
    const base = { padding: '6px 11px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none' }
    if (!a) return { ...base, background: 'var(--bg-secondary)', outline: '1.5px solid transparent', color: 'var(--text-secondary)' }
    if (id === 'hoje') return { ...base, background: 'var(--warn-bg)', outline: '1px solid var(--warn-text)', color: 'var(--warn-text)' }
    return { ...base, background: 'var(--teal-light)', outline: '1px solid var(--teal)', color: 'var(--teal)' }
  }
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <button style={cs('hoje')}  onClick={() => { setChip('hoje');  onChange(today)    }}>Hoje · {fmt(today)}</button>
        <button style={cs('ontem')} onClick={() => { setChip('ontem'); onChange(yesterday) }}>Ontem · {fmt(yesterday)}</button>
        <button style={cs('data')}  onClick={() => setChip('data')}>📅 Agendar</button>
      </div>
      {chip === 'data' && <input type="date" className="field-input" defaultValue={value !== today && value !== yesterday ? value : ''} onChange={e => onChange(e.target.value)} style={{ marginTop: 8 }} />}
    </div>
  )
}

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
  const [selectedProd, setSelectedProd] = useState(prefill || null)
  const [form, setForm] = useState({
    data:        isoToday(),
    produtoNome: prefill?.nome || '',
    produtoId:   prefill?.id   || null,
    quantidade:  1,
    plataforma:  'Direta',
    precoUnit:   prefill ? (precoForPlat(prefill, 'Direta') || '') : '',
    custoUnit:   prefill?.custoTotal || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleProdSelect = (nome) => {
    const prod = produtos?.find(p => p.nome === nome) || null
    setSelectedProd(prod)
    set('produtoNome', nome)
    set('produtoId',   prod?.id  || null)
    set('custoUnit',   prod?.custoTotal || '')
    if (prod) set('precoUnit', precoForPlat(prod, form.plataforma) || '')
  }

  const handlePlatChange = (plat) => {
    set('plataforma', plat)
    if (selectedProd) set('precoUnit', precoForPlat(selectedProd, plat) || '')
  }

  const fee     = form.plataforma === '99Food' ? cfg.taxa99 / 100 : form.plataforma === 'iFood' ? cfg.taxaIfood / 100 : 0
  const revenue = (parseFloat(form.precoUnit) || 0) * (parseFloat(form.quantidade) || 1)
  const revNet  = revenue * (1 - fee)
  const cost    = (parseFloat(form.custoUnit) || 0) * (parseFloat(form.quantidade) || 1)
  const profit  = revNet - cost
  const margin  = revNet > 0 ? (profit / revNet) * 100 : null

  const handle = async () => {
    if (!form.produtoNome || !form.precoUnit) return
    setSaving(true)
    try { await onSave(form); onClose() }
    catch (e) { alert(e.message) } finally { setSaving(false) }
  }

  return (
    <Sheet title="Lançar venda" onClose={onClose}>
      <div className="field-label">Data</div>
      <DateChips value={form.data} onChange={v => set('data', v)} />
      <div className="field-label">Produto *</div>
      <input className="field-input" list="prod-venda-list" placeholder="Selecione um produto" value={form.produtoNome} onChange={e => handleProdSelect(e.target.value)} />
      <datalist id="prod-venda-list">{(produtos || []).map(p => <option key={p.id} value={p.nome} />)}</datalist>
      <div className="field-row">
        <div>
          <div className="field-label">Quantidade</div>
          <input className="field-input" type="text" inputMode="decimal" min="0.5" step="0.5" value={form.quantidade} onChange={e => set('quantidade', e.target.value)} />
        </div>
        <div>
          <div className="field-label">Plataforma</div>
          <select className="field-input" value={form.plataforma} onChange={e => handlePlatChange(e.target.value)}>
            {PLATAFORMAS.map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
      </div>
      <div className="field-label">Preço cobrado (R$) *</div>
      <input className="field-input" type="text" inputMode="decimal" min="0" step="0.50" value={form.precoUnit} onChange={e => set('precoUnit', e.target.value)} />
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
  const [data, setData]           = useState(isoToday())
  const [plataforma, setPlataforma] = useState('Direta')
  const [qtds, setQtds]           = useState({})
  const [saving, setSaving]       = useState(false)

  const comVenda = (produtos || []).filter(p => qtds[p.id] && parseFloat(qtds[p.id]) > 0)

  const handle = async () => {
    if (comVenda.length === 0) return
    setSaving(true)
    try {
      for (const prod of comVenda) {
        await onSave({
          data,
          produtoNome: prod.nome,
          produtoId:   prod.id,
          quantidade:  parseFloat(qtds[prod.id]),
          plataforma,
          precoUnit:   precoForPlat(prod, plataforma) || 0,
          custoUnit:   prod.custoTotal || 0,
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
      <div className="field-label">Data</div>
      <DateChips value={data} onChange={setData} />
      <div className="field-label">Plataforma</div>
      <select className="field-input" value={plataforma} onChange={e => setPlataforma(e.target.value)} style={{ marginBottom: 10 }}>
        {PLATAFORMAS.map(p => <option key={p}>{p}</option>)}
      </select>
      <div className="card card-flush" style={{ padding: '0 14px', marginBottom: 8 }}>
        {(produtos || []).map((prod, i) => {
          const preco = precoForPlat(prod, plataforma)
          return (
            <div key={prod.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < produtos.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{prod.nome}</div>
                <div style={{ fontSize: 11, color: PLAT_COLOR[plataforma] || 'var(--teal)' }}>{fmtR(preco)}</div>
              </div>
              <input
                className="item-qty"
                type="text" inputMode="decimal" min="0" step="1" placeholder="0"
                value={qtds[prod.id] || ''}
                onChange={e => setQtds(prev => ({ ...prev, [prod.id]: e.target.value }))}
                style={{ width: 64 }}
              />
            </div>
          )
        })}
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

// ── Daily revenue bar chart ──────────────────────────────────
function GraficoDiario({ vendas, periodo }) {
  const dias = useMemo(() => {
    const today = new Date()
    if (periodo === 'semana') {
      const dow = today.getDay() || 7
      const seg = new Date(today); seg.setDate(today.getDate() - dow + 1); seg.setHours(0,0,0,0)
      return Array.from({ length: 7 }, (_, i) => { const d = new Date(seg); d.setDate(seg.getDate() + i); return d.toISOString().split('T')[0] })
    }
    const y = today.getFullYear(), m = today.getMonth()
    const n = new Date(y, m + 1, 0).getDate()
    return Array.from({ length: n }, (_, i) => `${y}-${String(m+1).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`)
  }, [periodo])

  const dadosDia = useMemo(() => {
    const map = {}
    vendas.forEach(v => { map[v.data] = (map[v.data] || 0) + v.quantidade * v.precoUnit })
    return dias.map(d => ({ data: d, valor: map[d] || 0 }))
  }, [vendas, dias])

  const maxVal = Math.max(...dadosDia.map(d => d.valor), 0.01)
  const pico   = Math.max(...dadosDia.map(d => d.valor))
  const total  = dadosDia.reduce((s, d) => s + d.valor, 0)
  const fmt1   = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })

  return (
    <div className="card" style={{ padding: '12px 14px', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Receita diária</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--teal)' }}>{fmtR(total)}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 60 }}>
        {dadosDia.map((d, i) => {
          const isPeak = pico > 0 && d.valor === pico
          const barH   = d.valor > 0 ? Math.max(4, (d.valor / maxVal) * 54) : 3
          return (
            <div key={i} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
              <div style={{ width: '100%', height: barH, borderRadius: '2px 2px 0 0', background: isPeak ? 'var(--teal)' : d.valor > 0 ? 'rgba(34,184,134,0.4)' : '#252525' }} />
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, color: 'var(--text-tertiary)' }}>
        <span>{fmt1(dias[0])}</span>
        {pico > 0 && <span>pico {fmtR(pico)}</span>}
        <span>{fmt1(dias[dias.length - 1])}</span>
      </div>
    </div>
  )
}

// ── Comparador de produtos ───────────────────────────────────
const CMP_COLORS = ['#14b8a6', '#f59e0b', '#6366f1', '#ec4899', '#10b981']
const N_WEEKS = 5

function norm(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function weekStarts(n) {
  const hoje = new Date()
  return Array.from({ length: n }, (_, i) => {
    const seg = new Date(hoje)
    seg.setDate(hoje.getDate() - ((hoje.getDay() || 7) - 1) - (n - 1 - i) * 7)
    seg.setHours(0, 0, 0, 0)
    const dom = new Date(seg); dom.setDate(seg.getDate() + 6)
    return {
      inicio: seg.toISOString().split('T')[0],
      fim: dom.toISOString().split('T')[0],
      label: seg.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
    }
  })
}

function ComparadorProdutos({ vendas, produtos }) {
  const [metric, setMetric] = useState('receita') // 'receita' | 'unidades'

  const nomesProdutos = useMemo(() => {
    const nomes = new Set([
      ...(produtos || []).map(p => p.nome),
      ...vendas.map(v => v.produtoNome),
    ])
    return [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [produtos, vendas])

  const top3 = useMemo(() => {
    const map = {}
    vendas.forEach(v => { map[v.produtoNome] = (map[v.produtoNome] || 0) + v.quantidade * v.precoUnit })
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n)
  }, [vendas])

  const [selecionados, setSelecionados] = useState([])
  const [initialized, setInitialized] = useState(false)
  if (!initialized && top3.length > 0) { setSelecionados(top3); setInitialized(true) }

  const semanas = useMemo(() => weekStarts(N_WEEKS), [])

  const dadosPorProd = useMemo(() => {
    const map = {}
    selecionados.forEach(nome => {
      map[nome] = semanas.map(({ inicio, fim }) => {
        const vs = vendas.filter(v => v.produtoNome === nome && v.data >= inicio && v.data <= fim)
        return {
          receita: vs.reduce((s, v) => s + v.quantidade * v.precoUnit, 0),
          unidades: vs.reduce((s, v) => s + v.quantidade, 0),
        }
      })
    })
    return map
  }, [selecionados, vendas, semanas])

  const toggle = (nome) => {
    if (selecionados.includes(nome)) {
      setSelecionados(s => s.filter(n => n !== nome))
    } else if (selecionados.length < 3) {
      setSelecionados(s => [...s, nome])
    }
  }

  // SVG line chart
  const W = 560, H = 160, PL = 40, PR = 12, PT = 12, PB = 28
  const chartW = W - PL - PR, chartH = H - PT - PB

  const allVals = selecionados.flatMap(nome =>
    (dadosPorProd[nome] || []).map(d => d[metric])
  )
  const maxVal = Math.max(...allVals, 0.01)

  const xPos = (i) => PL + (i / (N_WEEKS - 1)) * chartW
  const yPos = (v) => PT + chartH - (v / maxVal) * chartH

  const path = (nome) =>
    (dadosPorProd[nome] || [])
      .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i).toFixed(1)} ${yPos(d[metric]).toFixed(1)}`)
      .join(' ')

  return (
    <div>
      {/* Metric toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {[['receita', 'Receita (R$)'], ['unidades', 'Unidades']].map(([val, label]) => (
          <button key={val} onClick={() => setMetric(val)} style={{
            fontSize: 12, padding: '4px 12px', borderRadius: 20, cursor: 'pointer',
            border: '1px solid var(--border)',
            background: metric === val ? 'var(--teal)' : 'transparent',
            color: metric === val ? '#fff' : 'var(--text-secondary)',
          }}>{label}</button>
        ))}
      </div>

      {/* Product picker — chips + dropdown */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {selecionados.map((nome, idx) => (
            <div key={nome} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: CMP_COLORS[idx] + '22', border: `1.5px solid ${CMP_COLORS[idx]}`,
              borderRadius: 20, padding: '4px 10px', fontSize: 12, fontWeight: 600, color: CMP_COLORS[idx],
            }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: CMP_COLORS[idx] }} />
              {nome}
              <button onClick={() => setSelecionados(s => s.filter(n => n !== nome))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: CMP_COLORS[idx], fontSize: 14, lineHeight: 1, padding: 0, marginLeft: 2 }}>×</button>
            </div>
          ))}
          {selecionados.length < 5 && (
            <select
              value=""
              onChange={e => { const n = e.target.value; if (n) setSelecionados(s => [...s, n]) }}
              style={{ fontSize: 12, padding: '4px 8px', borderRadius: 20, border: '1px dashed var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              <option value="">+ Adicionar produto</option>
              {nomesProdutos.filter(n => !selecionados.includes(n)).map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Line chart */}
      {selecionados.length > 0 && (
        <div className="card" style={{ padding: '12px 16px', marginBottom: 12, overflowX: 'auto' }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
            {/* Grid lines */}
            {[0.25, 0.5, 0.75, 1].map(pct => (
              <line key={pct}
                x1={PL} y1={PT + chartH * (1 - pct)}
                x2={PL + chartW} y2={PT + chartH * (1 - pct)}
                stroke="var(--border-color)" strokeWidth="0.5" strokeDasharray="3,3"
              />
            ))}
            {/* Y axis labels */}
            {[0, 0.5, 1].map(pct => {
              const v = maxVal * pct
              return (
                <text key={pct} x={PL - 4} y={PT + chartH * (1 - pct) + 3}
                  fontSize="8" fill="var(--text-tertiary)" textAnchor="end">
                  {metric === 'receita' ? (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)) : v.toFixed(0)}
                </text>
              )
            })}
            {/* X axis labels — every week */}
            {semanas.map((s, i) => (
              <text key={i} x={xPos(i)} y={H - 4}
                fontSize="7.5" fill={i === N_WEEKS - 1 ? 'var(--teal)' : 'var(--text-tertiary)'}
                textAnchor={i === 0 ? 'start' : i === N_WEEKS - 1 ? 'end' : 'middle'}
                fontWeight={i === N_WEEKS - 1 ? '700' : '400'}>
                {s.label}
              </text>
            ))}
            {/* Lines */}
            {selecionados.map((nome, ci) => (
              <g key={nome}>
                <path d={path(nome)} fill="none" stroke={CMP_COLORS[ci]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                {(dadosPorProd[nome] || []).map((d, i) => d[metric] > 0 && (
                  <circle key={i} cx={xPos(i)} cy={yPos(d[metric])} r="3" fill={CMP_COLORS[ci]} />
                ))}
              </g>
            ))}
          </svg>
          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
            {selecionados.map((nome, ci) => (
              <div key={nome} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <span style={{ width: 16, height: 2, background: CMP_COLORS[ci], borderRadius: 1, display: 'inline-block' }} />
                <span style={{ color: 'var(--text-secondary)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nome}</span>
              </div>
            ))}
          </div>

          {/* Tabela: produtos × semanas — sem scroll, responsiva */}
          <div style={{ marginTop: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '22%' }} />
                {semanas.map((_, wi) => <col key={wi} style={{ width: `${78 / semanas.length}%` }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th />
                  {semanas.map((s, wi) => {
                    const isLast = wi === semanas.length - 1
                    return (
                      <th key={wi} style={{
                        padding: '4px 4px', textAlign: 'right', fontSize: 10, fontWeight: 700,
                        color: isLast ? 'var(--teal)' : 'var(--text-tertiary)',
                      }}>
                        {isLast ? 'atual' : s.label}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {selecionados.map((nome, ci) => (
                  <tr key={nome} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 4px 10px 0', verticalAlign: 'middle', overflow: 'hidden' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: CMP_COLORS[ci], flexShrink: 0 }} />
                        <span style={{ fontSize: 11, fontWeight: 600, color: CMP_COLORS[ci], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nome.split(' ')[0]}</span>
                      </div>
                    </td>
                    {(dadosPorProd[nome] || []).map((d, wi) => {
                      const isLast = wi === semanas.length - 1
                      const prev = (dadosPorProd[nome] || [])[wi - 1]
                      const val  = metric === 'receita' ? d.receita : d.unidades
                      const pval = prev ? (metric === 'receita' ? prev.receita : prev.unidades) : 0
                      const pct  = pval > 0 && val > 0 ? ((val - pval) / pval) * 100 : null
                      const up   = pct !== null && pct >= 0
                      const valStr = metric === 'receita'
                        ? (val >= 1000 ? `R$${(Math.ceil(val)/1000).toFixed(1)}k` : `R$${Math.ceil(val)}`)
                        : fmtN(val, 0)
                      return (
                        <td key={wi} style={{
                          padding: '10px 4px', textAlign: 'right', verticalAlign: 'middle',
                          background: isLast ? 'var(--teal-light)' : 'transparent',
                        }}>
                          {val > 0 ? (
                            <>
                              <div style={{ fontSize: 12, fontWeight: 700, color: isLast ? 'var(--teal)' : 'var(--text-primary)' }}>
                                {valStr}
                              </div>
                              {pct !== null && (
                                <div style={{ fontSize: 10, fontWeight: 700, color: up ? '#22c55e' : '#ef4444' }}>
                                  {up ? '↑' : '↓'}{Math.abs(pct).toFixed(0)}%
                                </div>
                              )}
                            </>
                          ) : (
                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>—</div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selecionados.length === 0 && (
        <div className="empty"><span>Selecione produtos acima para comparar</span></div>
      )}
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────
function DreRow({ label, value, sub, bold, border, color, onToggle, open, hasDetail }) {
  return (
    <div>
      <div
        onClick={hasDetail ? onToggle : undefined}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: bold ? 14 : 13, fontWeight: bold ? 700 : 400,
          borderTop: border ? '1px solid var(--border)' : undefined,
          paddingTop: border ? 6 : 0, marginTop: border ? 2 : 0,
          cursor: hasDetail ? 'pointer' : 'default', userSelect: 'none' }}
      >
        <span style={{ color: bold ? 'var(--text-primary)' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 5 }}>
          {label}
          {hasDetail && <span style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>{open ? '▲' : '▼'}</span>}
        </span>
        <span style={{ color: color || (bold ? undefined : undefined), fontWeight: bold ? 700 : 600 }}>{value}{sub && <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 6 }}>{sub}</span>}</span>
      </div>
    </div>
  )
}

function ResultadoCard({ periodo, totalRevBruto, totalTaxas, totalRevNet, totalRevNetAvulsa, totalRevNetPed,
  totalCost, totalCustoSacolas, numPedidosPeriodo, custoSacola, totalComprasPeriodo,
  lucroBruto, margemBruta, custoFixoPeriodo, cfg, lucroLiquido, margemLiquida }) {
  const [openRec, setOpenRec] = useState(false)
  const [openCmv, setOpenCmv] = useState(false)
  const [openFix, setOpenFix] = useState(false)
  const mesLabel = periodo === 'mes' ? new Date().toLocaleDateString('pt-BR', { month: 'long' }) : periodo === 'semana' ? 'esta semana' : 'período'
  const hasRecDetail = totalTaxas > 0 || totalRevNetPed > 0
  const hasCmvDetail = totalCustoSacolas > 0
  const hasFixDetail = custoFixoPeriodo > 0

  const totalSaida = totalCost + totalComprasPeriodo + custoFixoPeriodo
  const pct   = totalSaida > 0 ? Math.min(100, (totalRevNet / totalSaida) * 100) : 0
  const barColor = pct >= 100 ? 'var(--teal)' : pct >= 70 ? '#f59e0b' : 'var(--alert-text)'

  return (
    <div className="card" style={{ padding: '14px 14px', marginBottom: 12 }}>
      {/* Header: título + saldo */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
          Resultado · {mesLabel}
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', color: lucroLiquido >= 0 ? 'var(--teal)' : 'var(--alert-text)' }}>
            {lucroLiquido >= 0 ? '+' : ''}{fmtR(lucroLiquido)}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 5 }}>{fmtN(margemLiquida)}%</span>
        </div>
      </div>

      {/* Barra de cobertura */}
      <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, marginBottom: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 3, transition: 'width 0.5s ease' }} />
      </div>
      <div style={{ fontSize: 11, color: barColor, fontWeight: 600, marginBottom: 12 }}>
        {fmtN(pct, 0)}% dos custos cobertos · {fmtR(totalRevNet)} receita / {fmtR(totalSaida)} custos
      </div>

      {/* Linhas DRE */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <DreRow label="Receita bruta" value={fmtR(totalRevBruto)}
          hasDetail={hasRecDetail} open={openRec} onToggle={() => setOpenRec(o => !o)} />
        {openRec && hasRecDetail && (
          <div style={{ paddingLeft: 10, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {totalTaxas > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span style={{ color: 'var(--text-tertiary)' }}>↳ Taxas plataforma</span><span style={{ color: 'var(--alert-text)' }}>−{fmtR(totalTaxas)}</span></div>}
            {totalRevNetPed > 0 && <>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span style={{ color: 'var(--text-tertiary)' }}>↳ Venda direta</span><span style={{ color: 'var(--text-secondary)' }}>{fmtR(totalRevNetAvulsa)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span style={{ color: 'var(--text-tertiary)' }}>↳ Pedidos / encomendas</span><span style={{ color: 'var(--text-secondary)' }}>{fmtR(totalRevNetPed)}</span></div>
            </>}
          </div>
        )}

        <DreRow label="= Receita líquida" value={fmtR(totalRevNet)} border />

        <DreRow label="− CMV (custo receitas)" value={`−${fmtR(totalCost)}`} color="var(--alert-text)"
          hasDetail={hasCmvDetail} open={openCmv} onToggle={() => setOpenCmv(o => !o)} />
        {openCmv && hasCmvDetail && (
          <div style={{ paddingLeft: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: 'var(--text-tertiary)' }}>↳ Sacolas ({numPedidosPeriodo} pedidos × R$ {fmtR(custoSacola)})</span>
              <span style={{ color: 'var(--alert-text)' }}>−{fmtR(totalCustoSacolas)}</span>
            </div>
          </div>
        )}

        {totalComprasPeriodo > 0 && (
          <DreRow label="− Compras (ingredientes)" value={`−${fmtR(totalComprasPeriodo)}`} color="var(--alert-text)" />
        )}

        <DreRow label="= Lucro bruto" value={fmtR(lucroBruto)} sub={`${fmtN(margemBruta)}%`}
          bold color={lucroBruto >= 0 ? 'var(--teal)' : 'var(--alert-text)'} border />

        {hasFixDetail
          ? <DreRow label="− Custos fixos" value={`−${fmtR(custoFixoPeriodo)}`} color="var(--alert-text)"
              hasDetail open={openFix} onToggle={() => setOpenFix(o => !o)} />
          : <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>Configure custos fixos em Preços</div>
        }
        {openFix && hasFixDetail && (
          <div style={{ paddingLeft: 10, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {(cfg.custoItens || []).filter(i => i.nome && parseFloat(i.valor) > 0).map((item, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ color: 'var(--text-tertiary)' }}>↳ {item.nome}</span>
                <span style={{ color: 'var(--text-tertiary)' }}>{fmtR(periodo === 'mes' ? parseFloat(item.valor) : parseFloat(item.valor) / 4.33)}</span>
              </div>
            ))}
          </div>
        )}

        <DreRow label="= Lucro líquido" value={fmtR(lucroLiquido)} sub={`${fmtN(margemLiquida)}%`}
          bold color={lucroLiquido >= 0 ? 'var(--teal)' : 'var(--alert-text)'} border />
      </div>
    </div>
  )
}

export default function Vendas() {
  const [periodo, setPeriodo]           = useState('mes')
  const [tab, setTab]                   = useState('inicio')
  const [sheet, setSheet]               = useState(null)
  const [expandedDate, setExpandedDate] = useState(null)
  const [filtroHistPeriodo, setFiltroHistPeriodo] = useState('all')
  const [customInicio, setCustomInicio] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0] })
  const [customFim, setCustomFim]       = useState(isoToday)
  const { toast, show }       = useToast()
  const { profile }           = useAuth()
  const mockDreRef            = useRef(null)

  const { data: produtos,   loading: lProd }               = useData(getProdutos)
  const { data: vendas,     loading: lVend, reload: rVend } = useData(getVendas)
  const { data: encomendas, loading: lEnc }                 = useData(getEncomendas)
  const { data: embalagens }                                = useData(getEmbalagens)
  const { data: compras }                                   = useData(getCompras)
  const cfg = getConfig()
  const custoSacola = getCustoSacolaDelivery(cfg, embalagens || [])

  const inicio = useMemo(() => {
    if (periodo === 'custom') return customInicio
    if (periodo === 'semana') {
      const d = new Date(); const day = d.getDay() || 7
      d.setDate(d.getDate() - day + 1)
      return d.toISOString().split('T')[0]
    }
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  }, [periodo, customInicio])

  const fim = useMemo(() => periodo === 'custom' ? (customFim || isoToday()) : isoToday(), [periodo, customFim])

  const feeFor = (plat) => plat === '99Food' ? cfg.taxa99 / 100 : plat === 'iFood' ? cfg.taxaIfood / 100 : 0

  const vendasPeriodo = useMemo(() => (vendas || []).filter(v => v.data >= inicio && v.data <= fim), [vendas, inicio, fim])

  // Expand pedido items into flat events (period-filtered)
  const pedidoEventos = useMemo(() => {
    const prodMap = Object.fromEntries((produtos || []).map(p => [p.nome, p]))
    return (encomendas || [])
      .filter(e => e.status !== 'Cancelado' && e.dataEntrega >= inicio && e.dataEntrega <= fim)
      .flatMap(e => e.itens.map(item => ({
        id: `${e.id}-${item.id || item.produto}`,
        pedidoId: e.id,
        data: e.dataEntrega,
        produtoNome: item.produto,
        quantidade: item.quantidade,
        precoUnit: item.precoUnit,
        plataforma: CANAL_TO_PLAT[e.canal] || 'Direta',
        custoUnit: prodMap[item.produto]?.custoTotal || 0,
        isPedido: true,
        cliente: e.cliente,
        canal: e.canal,
      })))
  }, [encomendas, inicio, produtos])

  // All pedidos without period filter (for TendenciaSemanal)
  const pedidoEventosTodos = useMemo(() => {
    const prodMap = Object.fromEntries((produtos || []).map(p => [p.nome, p]))
    return (encomendas || [])
      .filter(e => e.status !== 'Cancelado')
      .flatMap(e => e.itens.map(item => ({
        id: `${e.id}-${item.id || item.produto}`,
        data: e.dataEntrega,
        produtoNome: item.produto,
        quantidade: item.quantidade,
        precoUnit: item.precoUnit,
        plataforma: CANAL_TO_PLAT[e.canal] || 'Direta',
        custoUnit: prodMap[item.produto]?.custoTotal || 0,
      })))
  }, [encomendas, produtos])

  const todasVendasPeriodo = useMemo(() => [...vendasPeriodo, ...pedidoEventos], [vendasPeriodo, pedidoEventos])
  const todasVendasAll     = useMemo(() => [...(vendas || []), ...pedidoEventosTodos], [vendas, pedidoEventosTodos])

  // Stats per product — combined vendas + pedidos
  const statsPerProd = useMemo(() => {
    const map = {}
    todasVendasPeriodo.forEach(v => {
      const k = v.produtoNome
      if (!map[k]) map[k] = { units: 0, revenue: 0, revNet: 0, cost: 0 }
      const fee = feeFor(v.plataforma)
      map[k].units   += v.quantidade
      map[k].revenue += v.quantidade * v.precoUnit
      map[k].revNet  += v.quantidade * v.precoUnit * (1 - fee)
      map[k].cost    += v.quantidade * (v.custoUnit || 0)
    })
    return map
  }, [todasVendasPeriodo])

  // Stats per product — vendas avulsas only (for product table)
  const statsPerProdAvulsa = useMemo(() => {
    const map = {}
    vendasPeriodo.forEach(v => {
      const k = v.produtoNome
      if (!map[k]) map[k] = { units: 0, revenue: 0, revNet: 0, cost: 0 }
      const fee = feeFor(v.plataforma)
      map[k].units   += v.quantidade
      map[k].revenue += v.quantidade * v.precoUnit
      map[k].revNet  += v.quantidade * v.precoUnit * (1 - fee)
      map[k].cost    += v.quantidade * (v.custoUnit || 0)
    })
    return map
  }, [vendasPeriodo])

  const statsPerPlat = useMemo(() => {
    const map = {}
    todasVendasPeriodo.forEach(v => {
      if (!map[v.plataforma]) map[v.plataforma] = { revenue: 0, units: 0 }
      map[v.plataforma].revenue += v.quantidade * v.precoUnit
      map[v.plataforma].units   += v.quantidade
    })
    return map
  }, [todasVendasPeriodo])

  // Pedidos stats per canal
  const statsPedidos = useMemo(() => {
    const map = {}
    pedidoEventos.forEach(v => {
      const k = v.canal
      if (!map[k]) map[k] = { revenue: 0, revNet: 0, units: 0, cost: 0 }
      const fee = feeFor(v.plataforma)
      map[k].revenue += v.quantidade * v.precoUnit
      map[k].revNet  += v.quantidade * v.precoUnit * (1 - fee)
      map[k].units   += v.quantidade
      map[k].cost    += v.quantidade * (v.custoUnit || 0)
    })
    return map
  }, [pedidoEventos])

  const numPedidosPeriodo = useMemo(() =>
    new Set((encomendas || []).filter(e => e.status !== 'Cancelado' && e.dataEntrega >= inicio && e.dataEntrega <= fim).map(e => e.id)).size,
    [encomendas, inicio]
  )
  const totalCustoSacolas = numPedidosPeriodo * custoSacola

  const totalRevNet      = Object.values(statsPerProd).reduce((s, p) => s + p.revNet, 0)
  const totalCost        = Object.values(statsPerProd).reduce((s, p) => s + p.cost, 0) + totalCustoSacolas
  const totalProfit      = totalRevNet - totalCost
  const totalMargin      = totalRevNet > 0 ? (totalProfit / totalRevNet) * 100 : 0
  const totalUnits       = Object.values(statsPerProd).reduce((s, p) => s + p.units, 0)
  const totalRevNetPed   = Object.values(statsPedidos).reduce((s, p) => s + p.revNet, 0)
  const totalRevNetAvulsa = totalRevNet - totalRevNetPed

  const totalRevBruto      = Object.values(statsPerProd).reduce((s, p) => s + p.revenue, 0)
  const numTransacoes    = vendasPeriodo.length + numPedidosPeriodo
  const ticketMedio      = numTransacoes > 0 ? totalRevBruto / numTransacoes : 0
  const totalTaxas         = totalRevBruto - totalRevNet
  const totalComprasPeriodo = useMemo(() =>
    (compras || []).filter(c => c.data >= inicio && c.data <= fim).reduce((s, c) => s + (c.total || 0), 0),
    [compras, inicio, fim]
  )
  const lucroBruto         = totalRevNet - totalCost - totalComprasPeriodo
  const margemBruta        = totalRevNet > 0 ? (lucroBruto / totalRevNet) * 100 : 0
  const custoFixoPeriodo   = periodo === 'mes' ? (cfg.custoFixoMensal || 0) : (cfg.custoFixoMensal || 0) / 4.33
  const lucroLiquido       = lucroBruto - custoFixoPeriodo
  const margemLiquida      = totalRevNet > 0 ? (lucroLiquido / totalRevNet) * 100 : 0

  const handleSave   = async (v) => { await saveVenda(v); rVend(); show('Venda registrada!') }
  const handleDelete = async (id) => { await deleteVenda(id); rVend(); show('Removido!') }

  const historicoGrupos = useMemo(() => {
    const map = {}
    ;(vendas || []).forEach(v => {
      if (!map[v.data]) map[v.data] = []
      map[v.data].push({ ...v, _tipo: 'venda' })
    })
    ;(encomendas || []).filter(e => e.pgto === 'Pago' && e.dataPago).forEach(e => {
      const d = e.dataPago
      if (!map[d]) map[d] = []
      map[d].push({ ...e, _tipo: 'pedido' })
    })
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]))
  }, [vendas, encomendas])

  const fmtDate = (iso) => {
    if (iso === isoToday()) return 'Hoje'
    return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', weekday: 'short' })
  }

  const loading = lProd || lVend || lEnc

  const barrasProduto = useMemo(() =>
    Object.entries(statsPerProd)
      .map(([nome, s], i) => ({ label: nome, valor: s.revNet, cor: PROD_COLORS[i % PROD_COLORS.length] }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 8),
    [statsPerProd]
  )

  const barrasUnidades = useMemo(() =>
    Object.entries(statsPerProd)
      .map(([nome, s], i) => ({ label: nome, valor: s.units, cor: PROD_COLORS[i % PROD_COLORS.length] }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 8),
    [statsPerProd]
  )

  const barrasPlat = useMemo(() =>
    Object.entries(statsPerPlat).map(([plat, s]) => ({ label: plat, valor: s.revenue, cor: PLAT_COLOR[plat] || 'var(--teal)' })),
    [statsPerPlat]
  )

  // Canal breakdown for pedidos bar chart
  const barrasCanalPed = useMemo(() =>
    Object.entries(statsPedidos).map(([canal, s]) => ({ label: canal, valor: s.revNet, cor: PLAT_COLOR[CANAL_TO_PLAT[canal] || 'Direta'] || 'var(--teal)' })).sort((a, b) => b.valor - a.valor),
    [statsPedidos]
  )

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div className="topbar-title">Vendas</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => setSheet({ type: 'venda' })} style={{ fontSize: 13, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}>+ Avulso</button>
            <button onClick={() => setSheet({ type: 'rapido' })} style={{ fontSize: 13, padding: '6px 14px', borderRadius: 8, border: 'none', background: 'var(--teal)', color: '#000', fontWeight: 700, cursor: 'pointer' }}>⚡ Lançar</button>
          </div>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 16 }}>
        <div className="tab-bar">
          <button className={`tab-btn ${tab === 'inicio'   ? 'active' : ''}`} onClick={() => setTab('inicio')}>Início</button>
          <button className={`tab-btn ${tab === 'analise'  ? 'active' : ''}`} onClick={() => setTab('analise')}>Análise</button>
          <button className={`tab-btn ${tab === 'historico'? 'active' : ''}`} onClick={() => setTab('historico')}>Histórico</button>
        </div>

        {/* ── INÍCIO ──────────────────────────────── */}
        {tab === 'inicio' && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: periodo === 'custom' ? 8 : 12, flexWrap: 'wrap' }}>
              {[['semana', 'Esta semana'], ['mes', 'Este mês']].map(([p, label]) => (
                <button key={p} onClick={() => setPeriodo(p)} style={{
                  fontSize: 13, padding: '5px 14px', borderRadius: 20,
                  border: '1px solid var(--border)',
                  background: periodo === p ? 'var(--teal)' : 'transparent',
                  color: periodo === p ? '#fff' : 'var(--text-secondary)', cursor: 'pointer',
                }}>{label}</button>
              ))}
              <button onClick={() => setPeriodo('custom')} style={{
                fontSize: 13, padding: '5px 14px', borderRadius: 20,
                border: `1px solid ${periodo === 'custom' ? 'var(--teal)' : 'var(--border)'}`,
                background: periodo === 'custom' ? 'var(--teal)' : 'transparent',
                color: periodo === 'custom' ? '#fff' : 'var(--text-secondary)', cursor: 'pointer',
              }}>📅 Período</button>
            </div>
            {periodo === 'custom' && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
                <input type="date" value={customInicio} onChange={e => setCustomInicio(e.target.value)}
                  style={{ flex: 1, padding: '7px 10px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, colorScheme: 'dark' }} />
                <span style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>→</span>
                <input type="date" value={customFim} onChange={e => setCustomFim(e.target.value)}
                  style={{ flex: 1, padding: '7px 10px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, colorScheme: 'dark' }} />
              </div>
            )}

            {/* Mock preview para onboarding */}
            {!loading && todasVendasAll.length === 0 && profile?.onboardingDone && (
              <MockVendasPreview dreRef={mockDreRef} />
            )}

            <div className="metric-grid" style={{ marginBottom: 12, display: !loading && todasVendasAll.length === 0 ? 'none' : undefined }}>
              {[
                { label: 'Faturamento líq.', value: fmtR(totalRevNet) },
                { label: 'Lucro líquido',    value: fmtR(lucroLiquido), color: lucroLiquido >= 0 ? 'var(--teal)' : 'var(--alert-text)' },
                { label: 'Margem líquida',   value: totalRevNet > 0 ? `${fmtN((lucroLiquido/totalRevNet)*100)}%` : '—',
                  color: totalRevNet > 0 && (lucroLiquido/totalRevNet)*100 >= cfg.margem ? 'var(--teal)' : lucroLiquido > 0 ? '#f59e0b' : 'var(--alert-text)' },
                { label: 'Ticket médio',     value: ticketMedio > 0 ? fmtR(ticketMedio) : '—',
                  sub: `${totalUnits} un · ${numTransacoes} pedido${numTransacoes !== 1 ? 's' : ''}` },
              ].map(m => (
                <div key={m.label} className="card" style={{ marginBottom: 0 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700, marginBottom: 4 }}>{m.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: m.color || 'var(--text-primary)' }}>{loading ? '—' : m.value}</div>
                  {m.sub && !loading && <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 3 }}>{m.sub}</div>}
                </div>
              ))}
            </div>

            {/* Resultado consolidado */}
            {!loading && totalRevNet > 0 && (
              <ResultadoCard
                periodo={periodo}
                totalRevBruto={totalRevBruto} totalTaxas={totalTaxas}
                totalRevNet={totalRevNet} totalRevNetAvulsa={totalRevNetAvulsa} totalRevNetPed={totalRevNetPed}
                totalCost={totalCost} totalCustoSacolas={totalCustoSacolas}
                numPedidosPeriodo={numPedidosPeriodo} custoSacola={custoSacola}
                totalComprasPeriodo={totalComprasPeriodo}
                lucroBruto={lucroBruto} margemBruta={margemBruta}
                custoFixoPeriodo={custoFixoPeriodo} cfg={cfg}
                lucroLiquido={lucroLiquido} margemLiquida={margemLiquida}
              />
            )}

            {/* Canal de venda */}
            {!loading && Object.keys(statsPerPlat).some(k => statsPerPlat[k].revenue > 0) && (() => {
              const totalCanal = Object.values(statsPerPlat).reduce((s, p) => s + p.revenue, 0)
              const entries = [['Direta', statsPerPlat['Direta']?.revenue || 0, 'var(--teal)'],
                               ['iFood',  statsPerPlat['iFood']?.revenue  || 0, '#ef4444'],
                               ['99Food', statsPerPlat['99Food']?.revenue || 0, '#f59e0b']]
                .filter(([, v]) => v > 0)
              return (
                <div className="card" style={{ padding: '12px 14px', marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>Canal de venda</div>
                  {entries.map(([plat, val, cor], i) => {
                    const pct = totalCanal > 0 ? (val / totalCanal) * 100 : 0
                    return (
                      <div key={plat} style={{ marginBottom: i < entries.length - 1 ? 10 : 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: cor }}>{plat}</span>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{fmtN(pct, 0)}% · {fmtR(val)}</span>
                        </div>
                        <div style={{ height: 4, background: '#252525', borderRadius: 2 }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: cor, borderRadius: 2 }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}

            {/* Heatmap dia da semana */}
            {!loading && todasVendasAll.length > 0 && (
              <div className="card" style={{ padding: '12px 14px', marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>Receita por dia da semana</div>
                <HeatmapDOW vendas={todasVendasAll} />
              </div>
            )}
          </>
        )}

        {/* ── ANÁLISE ──────────────────────────────── */}
        {tab === 'analise' && (() => {
          const canalData = [
            { label: 'Direta', valor: statsPerPlat['Direta']?.revenue || 0, cor: 'var(--teal)' },
            { label: 'iFood',  valor: statsPerPlat['iFood']?.revenue  || 0, cor: '#ef4444' },
            { label: '99Food', valor: statsPerPlat['99Food']?.revenue || 0, cor: '#f59e0b' },
          ]
          return (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {[['semana', 'Esta semana'], ['mes', 'Este mês']].map(([p, label]) => (
                  <button key={p} onClick={() => setPeriodo(p)} style={{
                    fontSize: 13, padding: '5px 14px', borderRadius: 20, border: '1px solid var(--border)',
                    background: periodo === p ? 'var(--teal)' : 'transparent',
                    color: periodo === p ? '#fff' : 'var(--text-secondary)', cursor: 'pointer',
                  }}>{label}</button>
                ))}
              </div>

              {!lVend && <GraficoDiario vendas={todasVendasPeriodo} periodo={periodo === 'custom' ? 'mes' : periodo} />}

              {/* Tendência semanal */}
              {!lVend && todasVendasAll.length > 0 && (
                <div className="card" style={{ padding: '12px 14px', marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>Tendência semanal</div>
                  <TendenciaSemanal vendas={todasVendasAll} />
                </div>
              )}

              {!lVend && canalData.some(c => c.valor > 0) && (() => {
                const totalCanal = canalData.reduce((s, c) => s + c.valor, 0)
                return (
                  <div className="card" style={{ padding: '12px 14px', marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>Canal de venda</div>
                    {canalData.filter(c => c.valor > 0).map((c, i, arr) => {
                      const pct = totalCanal > 0 ? (c.valor / totalCanal) * 100 : 0
                      return (
                        <div key={c.label} style={{ marginBottom: i < arr.length - 1 ? 10 : 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: c.cor }}>{c.label}</span>
                            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{fmtN(pct, 0)}% · {fmtR(c.valor)}</span>
                          </div>
                          <div style={{ height: 4, background: '#252525', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: c.cor, borderRadius: 2 }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}

              {/* Lista produtos da semana */}
              {!lVend && (() => {
                const hoje = new Date()
                const seg = new Date(hoje); seg.setDate(hoje.getDate() - ((hoje.getDay() || 7) - 1)); seg.setHours(0,0,0,0)
                const iSeg = seg.toISOString().split('T')[0]
                const iDom = new Date(seg); iDom.setDate(seg.getDate() + 6)
                const iFim = iDom.toISOString().split('T')[0]
                const byProd = {}
                todasVendasAll.filter(v => v.data >= iSeg && v.data <= iFim).forEach(v => {
                  if (!byProd[v.produtoNome]) byProd[v.produtoNome] = { receita: 0, un: 0 }
                  byProd[v.produtoNome].receita += v.quantidade * v.precoUnit
                  byProd[v.produtoNome].un += v.quantidade
                })
                const list = Object.entries(byProd).sort((a, b) => b[1].receita - a[1].receita)
                if (list.length === 0) return null
                return (
                  <div className="card" style={{ padding: '12px 14px', marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>Esta semana · produtos</div>
                    {list.map(([nome, d], i, arr) => (
                      <div key={nome} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{nome}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{fmtN(d.un, 0)} un · <span style={{ color: 'var(--teal)', fontWeight: 600 }}>{fmtR(d.receita)}</span></span>
                      </div>
                    ))}
                  </div>
                )
              })()}

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{ flex: 1, height: 1, background: '#252525' }} />
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600 }}>Comparar produtos</div>
                <div style={{ flex: 1, height: 1, background: '#252525' }} />
              </div>

              <ComparadorProdutos vendas={todasVendasAll} produtos={produtos} />
            </>
          )
        })()}

        {/* ── HISTÓRICO ────────────────────────────── */}
        {tab === 'historico' && (() => {
          const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
          const fmtShort = (iso) => { const [, m, d] = iso.split('-'); return `${d}/${m}` }
          const cutoff7d = new Date(); cutoff7d.setDate(cutoff7d.getDate() - 7)
          const cutoff7dIso = cutoff7d.toISOString().split('T')[0]
          const grupos = filtroHistPeriodo === '7d'
            ? historicoGrupos.filter(([data]) => data >= cutoff7dIso)
            : historicoGrupos

          return loading ? <div className="loading">Carregando...</div> : (
            <>
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {[['all', 'Todo período'], ['7d', 'Últimos 7 dias']].map(([val, label]) => {
                  const a = filtroHistPeriodo === val
                  return (
                    <button key={val} onClick={() => setFiltroHistPeriodo(val)} style={{
                      fontSize: 12, padding: '5px 14px', borderRadius: 20, cursor: 'pointer',
                      border: `1px solid ${a ? 'var(--teal)' : 'var(--border)'}`,
                      background: a ? 'var(--teal)' : 'transparent',
                      color: a ? '#000' : 'var(--text-secondary)', fontWeight: a ? 700 : 400,
                    }}>{label}</button>
                  )
                })}
              </div>

              {grupos.length === 0
                ? <div className="empty"><span>Nenhuma venda registrada</span></div>
                : grupos.map(([data, items]) => {
                  const totalDia = items.reduce((s, item) => {
                    if (item._tipo === 'pedido') return s + (item.valor || (item.itens || []).reduce((ss, i) => ss + i.quantidade * (i.precoUnit || 0), 0))
                    return s + item.quantidade * item.precoUnit
                  }, 0)
                  const linhas = items.flatMap(item => {
                    if (item._tipo === 'pedido') {
                      return (item.itens || []).map(it => ({
                        key: `${item.id}-${it.produto}`,
                        nome: it.produto,
                        quantidade: it.quantidade,
                        precoUnit: it.precoUnit || 0,
                        platColor: PLAT_COLOR[CANAL_TO_PLAT[item.canal] || 'Direta'] || 'var(--teal)',
                        canal: item.canal,
                      }))
                    }
                    return [{
                      key: item.id,
                      nome: item.produtoNome,
                      quantidade: item.quantidade,
                      precoUnit: item.precoUnit,
                      platColor: PLAT_COLOR[item.plataforma] || 'var(--teal)',
                      canal: item.plataforma,
                      canDelete: true,
                      id: item.id,
                    }]
                  }).sort((a, b) => a.canal.localeCompare(b.canal) || a.nome.localeCompare(b.nome))
                  const dow = DOW[new Date(data + 'T12:00:00').getDay()]
                  const isOpen = expandedDate === data
                  return (
                    <div key={data} style={{ marginBottom: 8 }}>
                      <button onClick={() => setExpandedDate(isOpen ? null : data)} style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                        background: 'var(--bg-secondary)', border: 'none', cursor: 'pointer',
                        borderRadius: isOpen ? '9px 9px 0 0' : 9,
                        transition: 'border-radius 0.15s',
                      }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', flexShrink: 0 }}>{fmtShort(data)}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flex: 1, textAlign: 'left' }}>{dow} · {items.length} {items.length === 1 ? 'venda' : 'vendas'}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--teal)' }}>{fmtR(totalDia)}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>▾</span>
                      </button>
                      {isOpen && (
                        <div style={{ background: 'var(--bg-tertiary)', border: '1px solid #2a2a2a', borderTop: 'none', borderRadius: '0 0 9px 9px', padding: '0 14px' }}>
                          {linhas.map((linha, li) => (
                            <div key={linha.key} style={{ display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: li < linhas.length - 1 ? '1px solid #1e1e1e' : 'none', gap: 8 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{linha.nome}</span>
                              </div>
                              <span style={{ fontSize: 10, color: linha.platColor, flexShrink: 0 }}>{linha.quantidade} un · {linha.canal}</span>
                              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', flexShrink: 0 }}>{fmtR(linha.quantidade * linha.precoUnit)}</span>
                              {linha.canDelete && (
                                <button onClick={() => handleDelete(linha.id)} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 16, padding: '0 2px', flexShrink: 0 }}>×</button>
                              )}
                            </div>
                          ))}
                          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid #2a2a2a' }}>
                            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Total do dia</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal)' }}>{fmtR(totalDia)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })
              }
            </>
          )
        })()}
      </div>

      {sheet?.type === 'venda'  && <VendaForm    produtos={produtos} prefill={sheet.produto} onSave={handleSave} onClose={() => setSheet(null)} />}
      {sheet?.type === 'rapido' && <LancamentoRapido produtos={produtos} onSave={handleSave} onClose={() => setSheet(null)} />}

      {toast && <div className="toast">{toast}</div>}

      {profile?.onboardingDone && (
        <SpotlightHint
          targetRef={mockDreRef}
          stepKey="vendas_dre"
          show={!lVend && !lEnc && todasVendasAll.length === 0}
          title="DRE — resultado financeiro do mês"
          body="Registre suas vendas e o app monta automaticamente seu DRE: receita, CMV, custos fixos e lucro líquido — tudo em tempo real."
        />
      )}
    </>
  )
}
