import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../hooks/useData'
import { getReceitas, deleteReceitas, saveReceita } from '../services/db'
import ImportarExcel from './ImportarExcel'

const TIPO_COLOR = {
  'Bolo':          'badge-warn',
  'Torta':         'badge-warn',
  'Massa':         'badge-warn',
  'Recheio':       'badge-info',
  'Cobertura':     'badge-teal',
  'Base':          'badge-ok',
  'Produto Final': 'badge-ok',
  'Outro':         '',
}

function fmt(val) {
  return val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function Fichas() {
  const navigate = useNavigate()
  const { data: receitas, loading, reload } = useData(getReceitas)
  const [busca, setBusca] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('todos')
  const [importando, setImportando]   = useState(false)
  const [bulkDelete, setBulkDelete]   = useState(false)
  const [bulkSel, setBulkSel]         = useState([])
  const [bulkConfirm, setBulkConfirm] = useState(false)
  const [duplicando, setDuplicando]   = useState(null)

  const tiposDisponiveis = useMemo(() =>
    [...new Set((receitas || []).map(r => r.tipo).filter(Boolean))].sort(),
    [receitas]
  )

  function norm(s) {
    return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  }

  const filtradas = (receitas || []).filter(r => {
    if (filtroTipo !== 'todos' && r.tipo !== filtroTipo) return false
    return norm(r.nome).includes(norm(busca))
  })

  const handleDuplicar = async (rec, e) => {
    e?.stopPropagation()
    setDuplicando(rec.id)
    try {
      const ingredientes = (rec.ingredientes || []).map(i => ({
        nome: i.nome, quantidade: i.quantidade, unidade: i.unidade,
        insumoId: i.insumoId, subReceitaId: i.subReceitaId,
      }))
      await saveReceita({
        nome: `${rec.nome} (cópia)`,
        tipo: rec.tipo, rendimento: rec.rendimento, unidadeGera: rec.unidadeGera,
        pesoLiquido: rec.pesoLiquido, fatorPerda: rec.fatorPerda,
        instrucoes: rec.instrucoes, custoTotal: rec.custoTotal, custoUnid: rec.custoUnid,
      }, ingredientes)
      reload()
    } catch (err) {
      alert('Erro ao duplicar: ' + err.message)
    } finally {
      setDuplicando(null)
    }
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div className="topbar-title">Receitas</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setImportando(true)}
              style={{ background: 'transparent', color: 'var(--teal)', border: '1px solid var(--teal)', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>↑ Excel</button>
            <button onClick={() => { setBulkSel([]); setBulkDelete(true) }}
              style={{ background: 'transparent', color: 'var(--danger, #ef4444)', border: '1px solid var(--danger, #ef4444)', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Excluir</button>
            <button onClick={() => navigate('/fichas/nova')}
              style={{ background: 'var(--teal)', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>+ Nova</button>
          </div>
        </div>
      </div>

      <div className="page-inner">
        <div style={{ padding: '12px 0 4px' }}>
          <div className="search-wrap" style={{ marginBottom: 8 }}>
            <span className="search-icon">&#9906;</span>
            <input
              className="search-input"
              placeholder="Buscar receita..."
              value={busca}
              onChange={e => setBusca(e.target.value)}
            />
          </div>
          {tiposDisponiveis.length > 1 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 10, overflowX: 'auto' }}>
              {['todos', ...tiposDisponiveis].map(t => (
                <button key={t} onClick={() => setFiltroTipo(t)} style={{
                  padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                  border: '1px solid',
                  borderColor: filtroTipo === t ? 'var(--teal)' : 'var(--border)',
                  background:  filtroTipo === t ? 'var(--teal-light)' : 'transparent',
                  color:       filtroTipo === t ? 'var(--teal)' : 'var(--text-secondary)',
                  cursor: 'pointer', whiteSpace: 'nowrap',
                }}>{t === 'todos' ? 'Todos' : t}</button>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div className="loading">Carregando receitas...</div>
        ) : filtradas.length === 0 ? (
          <div className="empty">
            <span>Nenhuma receita encontrada</span>
            <button className="btn-outline-teal" style={{ marginTop: 8, maxWidth: 220 }} onClick={() => navigate('/fichas/nova')}>
              + Nova receita
            </button>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="desktop-only">
              <div className="card card-flush">
                <table className="dt">
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>Tipo</th>
                      <th>Rendimento</th>
                      <th>Custo lote</th>
                      <th>Custo/un</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtradas.map(r => (
                      <tr key={r.id} onClick={() => navigate(`/fichas/${r.id}`)}>
                        <td style={{ fontWeight: 600 }}>{r.nome}</td>
                        <td>
                          {r.tipo && <span className={`badge ${TIPO_COLOR[r.tipo] || ''}`}>{r.tipo}</span>}
                        </td>
                        <td className="muted">{r.rendimento > 0 ? `${r.rendimento} ${r.unidadeGera || 'un'}` : '—'}</td>
                        <td className="muted">{r.custoTotal > 0 ? `R$ ${fmt(r.custoTotal)}` : '—'}</td>
                        <td className="teal">{r.custoUnid > 0 ? `R$ ${fmt(r.custoUnid)}` : '—'}</td>
                        <td onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <button onClick={e => { e.stopPropagation(); navigate(`/fichas/${r.id}/editar`) }} title="Editar"
                            style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', fontSize: 14, cursor: 'pointer', padding: '2px 6px' }}>
                            ✏️
                          </button>
                          <button onClick={e => handleDuplicar(r, e)} disabled={duplicando === r.id} title="Duplicar"
                            style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', fontSize: 14, cursor: 'pointer' }}>
                            {duplicando === r.id ? '⏳' : '⎘'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile cards */}
            <div className="mobile-only" style={{ padding: '0 16px' }}>
              {filtradas.map(r => (
                <div
                  key={r.id}
                  className="card"
                  style={{ cursor: 'pointer', position: 'relative' }}
                  onClick={() => navigate(`/fichas/${r.id}`)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{r.nome}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {r.custoUnid > 0
                        ? <span style={{ fontWeight: 600, fontSize: 14 }}>R$ {fmt(r.custoUnid)}/un</span>
                        : <span style={{ fontSize: 13, color: '#aaa' }}>—</span>
                      }
                      <button
                        onClick={e => { e.stopPropagation(); navigate(`/fichas/${r.id}/editar`) }}
                        title="Editar"
                        style={{
                          background: 'none', border: 'none', color: 'var(--text-tertiary)',
                          fontSize: 14, cursor: 'pointer', padding: '2px 6px', borderRadius: 4,
                        }}>✏️</button>
                      <button
                        onClick={e => handleDuplicar(r, e)}
                        disabled={duplicando === r.id}
                        title="Duplicar"
                        style={{
                          background: 'none', border: 'none', color: 'var(--text-tertiary)',
                          fontSize: 14, cursor: 'pointer', padding: '2px 6px', borderRadius: 4,
                        }}>
                        {duplicando === r.id ? '⏳' : '⎘'}
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                    <span style={{ fontSize: 12, color: '#aaa' }}>
                      {r.custoTotal > 0 ? `Custo lote: R$ ${fmt(r.custoTotal)}` : 'Custo não calculado'}
                    </span>
                    {r.tipo && <span className={`badge ${TIPO_COLOR[r.tipo] || ''}`}>{r.tipo}</span>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {bulkDelete && (
        <>
          <div className="sheet-overlay" onClick={() => setBulkDelete(false)} />
          <div className="sheet">
            <div className="sheet-title">
              <span>Excluir receitas</span>
              <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer' }} onClick={() => setBulkDelete(false)}>×</button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'var(--text-secondary)' }}>
                <input type="checkbox"
                  checked={bulkSel.length === (receitas || []).length && (receitas || []).length > 0}
                  onChange={e => setBulkSel(e.target.checked ? (receitas || []).map(r => r.id) : [])}
                /> Todas
              </label>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{bulkSel.length} selecionada(s)</span>
            </div>
            <div style={{ maxHeight: '55vh', overflowY: 'auto', marginBottom: 16 }}>
              {(receitas || []).map(rec => (
                <label key={rec.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                  <input type="checkbox"
                    checked={bulkSel.includes(rec.id)}
                    onChange={e => setBulkSel(s => e.target.checked ? [...s, rec.id] : s.filter(id => id !== rec.id))}
                  />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{rec.nome}</div>
                    {rec.tipo && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{rec.tipo}</div>}
                  </div>
                </label>
              ))}
            </div>
            <button disabled={!bulkSel.length} onClick={() => bulkSel.length && setBulkConfirm(true)}
              style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', fontSize: 14, fontWeight: 700,
                cursor: bulkSel.length ? 'pointer' : 'not-allowed',
                background: bulkSel.length ? 'var(--danger, #ef4444)' : 'var(--border)', color: '#fff' }}>
              {bulkSel.length ? `Excluir ${bulkSel.length} receita(s)` : 'Selecione receitas'}
            </button>
          </div>
        </>
      )}

      {bulkConfirm && (
        <>
          <div className="sheet-overlay" onClick={() => setBulkConfirm(false)} />
          <div className="sheet">
            <div style={{ padding: '8px 0 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🗑️</div>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Excluir {bulkSel.length} receita(s)?</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24 }}>Essa ação não pode ser desfeita.</div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn-outline-teal" style={{ flex: 1 }} onClick={() => setBulkConfirm(false)}>Cancelar</button>
                <button style={{ flex: 1, padding: '12px', borderRadius: 10, border: 'none', fontSize: 14, fontWeight: 700, cursor: 'pointer', background: 'var(--danger, #ef4444)', color: '#fff' }}
                  onClick={async () => {
                    try {
                      await deleteReceitas(bulkSel)
                      reload()
                      setBulkConfirm(false)
                      setBulkDelete(false)
                    } catch (e) { alert(e.message) }
                  }}>Excluir</button>
              </div>
            </div>
          </div>
        </>
      )}

      {importando && (
        <ImportarExcel mode="receitas"
          onClose={() => setImportando(false)}
          onImported={() => { reload(); setImportando(false) }}
        />
      )}
    </>
  )
}
