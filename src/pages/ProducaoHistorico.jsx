import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../hooks/useData'
import { getProducoes, deleteProducao, deleteProducaoItem } from '../services/db'

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

export default function ProducaoHistorico() {
  const navigate = useNavigate()
  const { data: historico, reload, loading } = useData(getProducoes)
  const [confirmDel, setConfirmDel] = useState(null)
  const [confirmDelItem, setConfirmDelItem] = useState(null)
  const [expandedId, setExpandedId] = useState(null)

  async function handleDeleteProd() {
    const id = confirmDel
    setConfirmDel(null)
    await deleteProducao(id)
    await reload()
    if (expandedId === id) setExpandedId(null)
  }

  async function handleDeleteItem() {
    const { itemId } = confirmDelItem
    setConfirmDelItem(null)
    await deleteProducaoItem(itemId)
    await reload()
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => navigate('/mise-en-place')} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 22, cursor: 'pointer', padding: '0 4px 0 0', lineHeight: 1 }}>‹</button>
            <div className="topbar-title">Histórico de produções</div>
          </div>
        </div>
      </div>

      {/* Tabs de navegação */}
      <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
        <div style={{ display: 'flex', maxWidth: 640, margin: '0 auto', padding: '0 12px' }}>
          <button onClick={() => navigate('/mise-en-place')} style={{ padding: '12px 16px', background: 'none', border: 'none', fontSize: 13, cursor: 'pointer', color: 'var(--text-secondary)', fontWeight: 500 }}>
            Planejar
          </button>
          <button style={{ padding: '12px 16px', background: 'none', border: 'none', borderBottom: '2px solid var(--teal)', fontSize: 13, cursor: 'pointer', color: 'var(--teal)', fontWeight: 700 }}>
            Histórico
          </button>
        </div>
      </div>

      <div className="page-content">
        {loading && <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13, paddingTop: 24 }}>Carregando...</div>}

        {!loading && (!historico || historico.length === 0) && (
          <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13, paddingTop: 40 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
            Nenhuma produção registrada
          </div>
        )}

        {(historico || []).map(prod => {
          const isExpanded = expandedId === prod.id
          const totalReceitas = new Set(
            prod.itens.flatMap(i => i.snapshot?.dosesContrib ? Object.keys(i.snapshot.dosesContrib) : (i.receitaId ? [String(i.receitaId)] : []))
          ).size
          return (
            <div key={prod.id} className="card" style={{ marginBottom: 10, padding: 0, overflow: 'hidden' }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', cursor: 'pointer' }}
                onClick={() => setExpandedId(isExpanded ? null : prod.id)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{fmtDate(prod.createdAt)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>
                    {prod.itens.length} item(s) · {totalReceitas} receita(s)
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button onClick={e => { e.stopPropagation(); navigate(`/producao/${prod.id}`) }}
                    style={{ fontSize: 11, color: 'var(--teal)', background: 'rgba(20,184,166,0.1)', border: '1px solid var(--teal)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}>
                    Abrir
                  </button>
                  <button onClick={e => { e.stopPropagation(); setConfirmDel(prod.id) }}
                    style={{ fontSize: 11, color: '#ef4444', background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
                    Apagar
                  </button>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 13, transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
                </div>
              </div>

              {/* Itens expandidos */}
              {isExpanded && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '10px 14px', background: 'var(--bg-secondary, #1f2937)' }}>
                  {prod.itens.map((item, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0', borderBottom: i < prod.itens.length - 1 ? '0.5px solid var(--border)' : 'none', fontSize: 13 }}>
                      <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: item.tipo === 'produto' ? '#1e3a5f' : '#334155', color: item.tipo === 'produto' ? '#60a5fa' : '#94a3b8', fontWeight: 600 }}>
                        {item.tipo === 'produto' ? 'P' : 'R'}
                      </span>
                      <span style={{ flex: 1, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.nome}</span>
                      <span style={{ color: 'var(--text-secondary)', fontSize: 11, flexShrink: 0 }}>
                        {item.tipo === 'produto'
                          ? `${fmtQtd(item.quantidade)} un`
                          : item.modo === 'peso_liquido' ? `${fmtQtd(item.valorAlvo)} g líq`
                            : item.modo === 'unidades' ? `${fmtQtd(item.valorAlvo)} un`
                            : `${fmtQtd(item.quantidade)} Receita original`}
                      </span>
                      <button onClick={() => setConfirmDelItem({ itemId: item.id, prodId: prod.id })}
                        style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', fontSize: 14, cursor: 'pointer', padding: '0 4px' }}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {confirmDel != null && (
        <ConfirmModal
          icon="🗑️" title="Apagar esta produção?"
          msg="Estoque será revertido (insumos somados de volta, produtos/receitas debitados)."
          onCancel={() => setConfirmDel(null)}
          onConfirm={handleDeleteProd}
        />
      )}
      {confirmDelItem && (
        <ConfirmModal
          icon="🗑️" title="Apagar este item?"
          msg="Estoque será revertido apenas para esse item."
          onCancel={() => setConfirmDelItem(null)}
          onConfirm={handleDeleteItem}
        />
      )}
    </>
  )
}
