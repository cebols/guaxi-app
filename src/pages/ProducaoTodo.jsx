import { useState, useMemo, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useData } from '../hooks/useData'
import {
  getProducao, getReceitas, getInsumos,
  updateProducaoChecks, deleteProducao, deleteProducaoItem,
} from '../services/db'

function norm(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function fmtQtd(v) {
  const n = Number(v || 0)
  if (n === 0) return '0'
  if (n < 1) return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  return n % 1 === 0 ? String(n) : n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
}

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function ProducaoTodo() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: receitas } = useData(getReceitas)
  const { data: insumos }  = useData(getInsumos)

  const [prod, setProd]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [showDebit, setShowDebit] = useState(false)
  const [showCompras, setShowCompras] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [confirmDelItem, setConfirmDelItem] = useState(null)
  const [expandReceita, setExpandReceita] = useState({})

  async function reload() {
    setLoading(true)
    const p = await getProducao(id)
    setProd(p)
    setLoading(false)
  }

  useEffect(() => { reload() }, [id])

  const checks = useMemo(() => new Set(prod?.checks || []), [prod])

  // Doses por receita
  const dosesPerReceita = useMemo(() => {
    if (!prod) return {}
    const map = {}
    for (const item of prod.itens) {
      if (item.snapshot?.dosesContrib) {
        for (const [rid, d] of Object.entries(item.snapshot.dosesContrib)) {
          map[rid] = (map[rid] || 0) + d
        }
      }
    }
    return map
  }, [prod])

  // Debitos totais (snapshots somados)
  const debitosTotais = useMemo(() => {
    if (!prod) return []
    const map = {}
    for (const item of prod.itens) {
      const dbs = item.snapshot?.debitos || {}
      for (const [insumoId, q] of Object.entries(dbs)) {
        if (!map[insumoId]) {
          const ins = (insumos || []).find(i => String(i.id) === String(insumoId))
          map[insumoId] = { insumoId: Number(insumoId), nome: ins?.nome || `insumo#${insumoId}`, unidade: ins?.unidade || 'g', necessario: 0, estoque: ins?.estoqueAtual ?? null, linkCompra: ins?.linkCompra || '', whatsapp: ins?.whatsapp || '', fornecedor: ins?.fornecedor || '' }
        }
        map[insumoId].necessario += q
      }
    }
    return Object.values(map).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [prod, insumos])

  const faltas = debitosTotais.filter(d => d.estoque != null && d.estoque < d.necessario)

  async function toggleCheck(receitaId) {
    const key = String(receitaId)
    const novoSet = new Set(prod.checks || [])
    if (novoSet.has(key)) novoSet.delete(key)
    else novoSet.add(key)
    const arr = Array.from(novoSet)
    setProd({ ...prod, checks: arr })
    try {
      await updateProducaoChecks(prod.id, arr)
    } catch (e) {
      alert('Erro ao salvar: ' + e.message)
      reload()
    }
  }

  async function handleDelProd() {
    setConfirmDel(false)
    await deleteProducao(prod.id)
    navigate('/mise-en-place')
  }

  async function handleDelItem() {
    const itemId = confirmDelItem
    setConfirmDelItem(null)
    await deleteProducaoItem(itemId)
    await reload()
  }

  if (loading) return (
    <>
      <div className="topbar"><div className="topbar-inner"><div className="topbar-title">Carregando...</div></div></div>
    </>
  )
  if (!prod) return (
    <>
      <div className="topbar"><div className="topbar-inner"><div className="topbar-title">Produção não encontrada</div><button onClick={() => navigate('/mise-en-place')} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>← Voltar</button></div></div>
    </>
  )

  const totalReceitas = Object.keys(dosesPerReceita).length
  const doneReceitas = Object.keys(dosesPerReceita).filter(rid => checks.has(rid)).length
  const pct = totalReceitas > 0 ? Math.round((doneReceitas / totalReceitas) * 100) : 0

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div>
            <div className="topbar-title">Produção</div>
            <div className="topbar-sub">{fmtDate(prod.createdAt)}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setConfirmDel(true)} style={{ background: 'none', border: '1px solid #7f1d1d', color: '#ef4444', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
              🗑️ Apagar
            </button>
            <button onClick={() => navigate('/mise-en-place')} className="btn-ghost" style={{ fontSize: 16, padding: '5px 10px' }}>←</button>
          </div>
        </div>
      </div>

      <div className="page-content">
        {/* Progress (sticky no topo) */}
        <div className="card" style={{
          padding: '12px 14px', marginBottom: 12,
          position: 'sticky', top: 0, zIndex: 10,
          backdropFilter: 'blur(8px)',
          background: 'color-mix(in srgb, var(--bg-card) 92%, transparent)',
          transition: 'box-shadow 0.2s, padding 0.2s',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{doneReceitas} de {totalReceitas} receita(s) feitas</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: pct === 100 ? 'var(--teal)' : 'var(--text-primary)' }}>{pct}%</div>
          </div>
          <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? 'var(--teal)' : '#60a5fa', transition: 'width 0.3s' }} />
          </div>
        </div>

        {/* Itens (produtos/receitas pedidos) */}
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>O que foi pedido</div>
        <div className="card" style={{ padding: '10px 14px', marginBottom: 12 }}>
          {prod.itens.map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0', borderBottom: i < prod.itens.length - 1 ? '0.5px solid var(--border)' : 'none', fontSize: 13 }}>
              <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: item.tipo === 'produto' ? '#1e3a5f' : '#334155', color: item.tipo === 'produto' ? '#60a5fa' : '#94a3b8', fontWeight: 600 }}>
                {item.tipo === 'produto' ? 'P' : 'R'}
              </span>
              <span style={{ flex: 1, fontWeight: 600 }}>{item.nome}</span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                {item.tipo === 'produto'
                  ? `${fmtQtd(item.quantidade)} un`
                  : item.modo === 'peso_liquido' ? `${fmtQtd(item.valorAlvo)} ${item.unidadeGera || 'g'} líq`
                    : item.modo === 'unidades' ? `${fmtQtd(item.valorAlvo)} ${item.unidadeGera || 'un'}`
                    : `${fmtQtd(item.quantidade)} dose(s)`}
              </span>
              <button onClick={() => setConfirmDelItem(item.id)} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', fontSize: 14, cursor: 'pointer', padding: '0 4px' }}>×</button>
            </div>
          ))}
        </div>

        {/* Receitas a produzir (checklist) */}
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Receitas a produzir</div>
        {Object.entries(dosesPerReceita).map(([recIdStr, doses]) => {
          const rec = (receitas || []).find(r => r.id === Number(recIdStr))
          if (!rec || doses <= 0) return null
          const isChecked = checks.has(recIdStr)
          const isExpanded = !!expandReceita[recIdStr]
          const fp = rec.fatorPerda || 0
          const renderTotal = (rec.rendimento || 0) * doses
          const liq = renderTotal * (1 - fp / 100)
          return (
            <div key={recIdStr} className="card" style={{
              marginBottom: 8, padding: 0, overflow: 'hidden',
              opacity: isChecked ? 0.55 : 1,
              borderLeft: isChecked ? '3px solid var(--teal)' : '3px solid transparent',
            }}>
              <div
                onClick={() => toggleCheck(recIdStr)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', cursor: 'pointer' }}
              >
                <div style={{
                  width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                  border: `2px solid ${isChecked ? 'var(--teal)' : 'var(--border)'}`,
                  background: isChecked ? 'var(--teal)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 14, fontWeight: 700,
                }}>{isChecked ? '✓' : ''}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, textDecoration: isChecked ? 'line-through' : 'none' }}>{rec.nome}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {fmtQtd(doses)} dose(s) → {fmtQtd(renderTotal)} {rec.unidadeGera}{fp > 0 ? ` (${fmtQtd(liq)} líq)` : ''}
                  </div>
                </div>
                <button onClick={e => { e.stopPropagation(); navigate(`/fichas/${recIdStr}?doses=${doses}`) }}
                  title="Abrir modo cozinha"
                  style={{ background: 'rgba(20,184,166,0.1)', border: '1px solid var(--teal)', color: 'var(--teal)', fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: '5px 9px', borderRadius: 6 }}>
                  👨‍🍳 Cozinha
                </button>
                <button onClick={e => { e.stopPropagation(); setExpandReceita(s => ({ ...s, [recIdStr]: !s[recIdStr] })) }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 14, cursor: 'pointer', padding: '4px 8px', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</button>
              </div>
              {isExpanded && (
                <div style={{ padding: '0 14px 12px 50px', background: 'var(--bg-secondary, #1f2937)' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, padding: '8px 0 4px' }}>Mise en place</div>
                  {(rec.ingredientes || []).map((ing, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12 }}>
                      <span>{ing.nome}</span>
                      <span style={{ fontWeight: 600 }}>{fmtQtd(ing.quantidade * doses)}{ing.unidade}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {totalReceitas === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13, padding: 20 }}>Nenhuma receita nesta produção</div>
        )}

        {/* Total a debitar (toggle) */}
        {debitosTotais.length > 0 && (
          <div className="card" style={{ padding: 0, marginTop: 14, overflow: 'hidden' }}>
            <button onClick={() => setShowDebit(s => !s)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 }}>
                Total debitado do estoque {faltas.length > 0 && <span title="Itens faltando" style={{ color: '#f59e0b', marginLeft: 4 }}>⚠</span>}
              </span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 14, transform: showDebit ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
            </button>
            {showDebit && (
              <div style={{ padding: '0 14px 12px' }}>
                {debitosTotais.map((it, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                    <span style={{ color: it.estoque != null && it.estoque < it.necessario ? 'var(--alert-text, #ef4444)' : 'var(--text-primary)' }}>{it.nome}</span>
                    <span style={{ fontWeight: 600 }}>{fmtQtd(it.necessario)}{it.unidade}{it.estoque != null && it.estoque < it.necessario ? ' ⚠' : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Lista de compras sugerida */}
        {faltas.length > 0 && (
          <div className="card" style={{ padding: 0, marginTop: 10, overflow: 'hidden', borderLeft: '3px solid #f59e0b' }}>
            <button onClick={() => setShowCompras(s => !s)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 }}>
                📋 Lista de compras sugerida ({faltas.length})
              </span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 14, transform: showCompras ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
            </button>
            {showCompras && (
              <div style={{ padding: '0 14px 12px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>Insumos com estoque abaixo do necessário:</div>
                {faltas.map((it, i) => {
                  const falta = it.necessario - (it.estoque || 0)
                  const waLink = it.whatsapp ? `https://wa.me/55${it.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`Olá! Preciso de ${it.nome}: ${fmtQtd(falta)}${it.unidade}`)}` : null
                  return (
                    <div key={i} style={{ padding: '7px 0', fontSize: 12, borderBottom: '0.5px solid var(--border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}>{it.nome}</div>
                          {it.fornecedor && <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{it.fornecedor}</div>}
                          <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                            tem {fmtQtd(it.estoque || 0)}{it.unidade} · precisa {fmtQtd(it.necessario)}{it.unidade}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                          <span style={{ fontWeight: 700, color: '#f59e0b' }}>+{fmtQtd(falta)}{it.unidade}</span>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {it.linkCompra && <a href={it.linkCompra} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: 'var(--teal)', textDecoration: 'none', padding: '2px 6px', border: '1px solid var(--teal)', borderRadius: 4 }}>Loja</a>}
                            {waLink && <a href={waLink} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: '#fff', background: '#25d366', padding: '2px 6px', borderRadius: 4, textDecoration: 'none' }}>WA</a>}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
                <button onClick={() => {
                  const txt = faltas.map(it => `${it.nome}: ${fmtQtd(it.necessario - (it.estoque || 0))}${it.unidade}`).join('\n')
                  if (navigator.clipboard) navigator.clipboard.writeText('Lista de compras:\n' + txt)
                }} style={{ width: '100%', marginTop: 10, padding: '10px', borderRadius: 8, border: '1px solid #f59e0b', background: 'transparent', color: '#f59e0b', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  📋 Copiar lista
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {confirmDel && (
        <ConfirmModal
          icon="🗑️" title="Apagar esta produção?"
          msg="Estoque será revertido (insumos somados de volta, produtos/receitas debitados)."
          onCancel={() => setConfirmDel(false)}
          onConfirm={handleDelProd}
        />
      )}
      {confirmDelItem && (
        <ConfirmModal
          icon="🗑️" title="Apagar este item?"
          msg="Estoque será revertido apenas para esse item."
          onCancel={() => setConfirmDelItem(null)}
          onConfirm={handleDelItem}
        />
      )}
    </>
  )
}

function ConfirmModal({ icon, title, msg, onCancel, onConfirm }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)' }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 14, padding: 24, maxWidth: 320, width: '90%', textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 18 }}>{msg}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}>Cancelar</button>
          <button onClick={onConfirm} style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: 'var(--alert-text, #ef4444)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>Apagar</button>
        </div>
      </div>
    </div>
  )
}
