import { useState, useMemo, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../hooks/useData'
import { getReceitas, deleteReceitas, saveReceita, getInsumos, getProdutos } from '../services/db'
import { ItemThumb } from '../components/ItemThumb'

const ImportarExcel = lazy(() => import('./ImportarExcel'))
const ImportarImagem = lazy(() => import('./ImportarImagem'))

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
  const { data: insumos } = useData(getInsumos)
  const [busca, setBusca] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('todos')
  const [importando, setImportando]   = useState(false)
  const [bulkDelete, setBulkDelete]   = useState(false)
  const [bulkSel, setBulkSel]         = useState([])
  const [bulkConfirm, setBulkConfirm] = useState(false)
  const [duplicando, setDuplicando]   = useState(null)
  const [exportMode, setExportMode]   = useState(false)
  const [exportSel, setExportSel]     = useState([])
  const [exportSize, setExportSize]   = useState('a4')
  const [gerando, setGerando]         = useState(false)
  const [importandoImg, setImportandoImg] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [createSheet, setCreateSheet] = useState(false)
  const [catOpen, setCatOpen] = useState(false)

  const { data: produtos } = useData(getProdutos)

  // receitaId → [product names that use it]
  const usadoEmMap = useMemo(() => {
    const map = {}
    for (const p of (produtos || [])) {
      for (const r of (p.receitas || [])) {
        if (!map[r.receitaId]) map[r.receitaId] = []
        if (!map[r.receitaId].includes(p.nome)) map[r.receitaId].push(p.nome)
      }
    }
    return map
  }, [produtos])

  async function handleGerarPDF() {
    const selecionadas = (receitas || []).filter(r => exportSel.includes(r.id))
    if (!selecionadas.length) return
    setGerando(true)
    try {
      const [{ pdf }, { FichaTecnicaDocument }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('../components/FichaTecnicaPDF'),
      ])
      const blob = await pdf(<FichaTecnicaDocument receitas={selecionadas} size={exportSize} />).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `fichas-${new Date().toISOString().slice(0, 10)}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setExportMode(false)
      setExportSel([])
    } catch (e) {
      alert('Erro ao gerar PDF: ' + e.message)
    } finally {
      setGerando(false)
    }
  }

  const tiposDisponiveis = useMemo(() =>
    [...new Set((receitas || []).map(r => r.tipo).filter(Boolean))].sort(),
    [receitas]
  )

  function parseSteps(raw) {
  if (!raw) return []
  try { const p = JSON.parse(raw); if (Array.isArray(p)) return p } catch {}
  return []
}

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
      const novoId = await saveReceita({
        nome: `${rec.nome} (cópia)`,
        tipo: rec.tipo, rendimento: rec.rendimento, unidadeGera: rec.unidadeGera,
        pesoLiquido: rec.pesoLiquido, fatorPerda: rec.fatorPerda,
        instrucoes: rec.instrucoes, custoTotal: rec.custoTotal, custoUnid: rec.custoUnid,
      }, ingredientes)
      reload()
      navigate(`/fichas/${novoId}/editar`)
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', position: 'relative' }}>
            <div style={{ position: 'relative' }}>
              <button onClick={() => setMenuOpen(o => !o)} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px', fontSize: 16, cursor: 'pointer', color: 'var(--text-secondary)', lineHeight: 1 }}>···</button>
              {menuOpen && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 98 }} onClick={() => setMenuOpen(false)} />
                  <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 99, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, minWidth: 160, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden' }}>
                    {[
                      { label: '⬆️ Exportar PDF', action: () => { setExportSel([]); setExportMode(true); setMenuOpen(false) } },
                      { label: '🗑️ Excluir receitas', action: () => { setBulkSel([]); setBulkDelete(true); setMenuOpen(false) }, danger: true },
                    ].map(item => (
                      <button key={item.label} onClick={item.action} style={{
                        width: '100%', padding: '11px 14px', background: 'none', border: 'none', cursor: 'pointer',
                        textAlign: 'left', fontSize: 13, color: item.danger ? 'var(--alert-text)' : 'var(--text-primary)',
                        borderBottom: '1px solid var(--border)',
                      }}>{item.label}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button onClick={() => { setExportSel([]); setExportMode(true) }} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--text-secondary)', lineHeight: 1 }}>📄 Criar ficha</button>
            <button onClick={() => setCreateSheet(true)} style={{ background: 'var(--teal)', color: '#000', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>+ Nova receita</button>
          </div>
        </div>
      </div>

      <div className="page-inner">
        <div style={{ padding: '12px 0 4px' }}>
          {/* Search */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 12px', borderRadius: 12,
            background: 'var(--bg-card)', border: '0.5px solid var(--border-light-color)',
            marginBottom: 8,
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
              <circle cx="7" cy="7" r="5" stroke="var(--text-tertiary)" strokeWidth="1.5"/>
              <path d="M11 11l3 3" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar receita..."
              style={{
                background: 'none', border: 'none', outline: 'none',
                fontSize: 14, color: 'var(--text-primary)', flex: 1,
              }}
            />
            {busca && (
              <button onClick={() => setBusca('')} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 12, padding: 0 }}>✕</button>
            )}
          </div>

          {/* Category dropdown */}
          {tiposDisponiveis.length > 1 && (
            <div style={{ position: 'relative', marginBottom: 10 }}>
              <button
                onClick={() => setCatOpen(o => !o)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '10px 12px', borderRadius: 12,
                  background: 'var(--bg-card)',
                  border: `0.5px solid ${filtroTipo !== 'todos' ? 'var(--teal)' : 'var(--border-light-color)'}`,
                  cursor: 'pointer', color: filtroTipo !== 'todos' ? 'var(--teal)' : 'var(--text-secondary)',
                  fontSize: 13, fontWeight: filtroTipo !== 'todos' ? 600 : 400,
                }}
              >
                <span>{filtroTipo === 'todos' ? 'Filtrar por categoria' : filtroTipo}</span>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ transform: catOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}>
                  <path d="M3 5l4 4 4-4" stroke="var(--text-tertiary)" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              </button>
              {catOpen && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 8 }} onClick={() => setCatOpen(false)} />
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 9,
                    marginTop: 4, background: 'var(--bg-card)', borderRadius: 12,
                    border: '0.5px solid var(--border-light-color)',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.4)', maxHeight: 240, overflowY: 'auto',
                  }}>
                    {['todos', ...tiposDisponiveis].map((t, i) => (
                      <button key={t} onClick={() => { setFiltroTipo(t); setCatOpen(false) }} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        width: '100%', padding: '11px 14px', background: 'none', border: 'none',
                        borderBottom: i < tiposDisponiveis.length ? '0.5px solid var(--border-light-color)' : 'none',
                        cursor: 'pointer', fontSize: 13,
                        color: filtroTipo === t ? 'var(--teal)' : 'var(--text-primary)',
                        fontWeight: filtroTipo === t ? 600 : 400,
                      }}>
                        <span>{t === 'todos' ? 'Todas' : t}</span>
                        {filtroTipo === t && (
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M3 7l3 3 5-5" stroke="var(--teal)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
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
                <div className="dt-wrap"><table className="dt">
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
                        <td style={{ fontWeight: 600 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <ItemThumb url={r.imagemUrl} nome={r.nome} size={32} radius={6} />
                            {r.nome}
                          </div>
                        </td>
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
                </table></div>
              </div>
            </div>

            {/* Mobile cards */}
            <div className="mobile-only">
              {filtradas.map(r => {
                const usadoEm = usadoEmMap[r.id] || []
                return (
                  <div
                    key={r.id}
                    onClick={() => navigate(`/fichas/${r.id}`)}
                    style={{
                      background: 'var(--bg-card)',
                      border: '0.5px solid var(--border-light-color)',
                      borderRadius: 12,
                      padding: '12px 14px',
                      marginBottom: 6,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{r.nome}</span>
                      {r.rendimento > 0 && (
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)', flexShrink: 0 }}>{r.rendimento} {r.unidadeGera || 'un'}</span>
                      )}
                    </div>
                    {usadoEm.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginTop: 7 }}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
                          <path d="M4 6h4M6 4l2 2-2 2" stroke="var(--text-tertiary)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        {usadoEm.slice(0, 3).map((p, pi) => (
                          <span key={pi} style={{
                            fontSize: 10, padding: '2px 7px', borderRadius: 5,
                            background: 'var(--bg-secondary)', color: 'var(--text-secondary)',
                          }}>{p}</span>
                        ))}
                        {usadoEm.length > 3 && (
                          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>+{usadoEm.length - 3}</span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {exportMode && (
        <>
          <div className="sheet-overlay" onClick={() => setExportMode(false)} />
          <div className="sheet">
            <div className="sheet-title">
              <span>Exportar fichas técnicas</span>
              <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer' }} onClick={() => setExportMode(false)}>×</button>
            </div>

            {/* Tamanho */}
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Tamanho</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {[
                { id: 'a5', label: 'A5', desc: 'Meia folha · + instruções' },
                { id: 'a4', label: 'A4', desc: 'Folha inteira · completo' },
              ].map(s => (
                <button key={s.id} onClick={() => setExportSize(s.id)} style={{
                  flex: 1, padding: '10px 8px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
                  border: exportSize === s.id ? '2px solid var(--teal)' : '1px solid var(--border)',
                  background: exportSize === s.id ? 'rgba(20,184,166,0.08)' : 'var(--card-bg)',
                }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: exportSize === s.id ? 'var(--teal)' : 'var(--text-primary)' }}>{s.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>{s.desc}</div>
                </button>
              ))}
            </div>

            {/* Preview */}
            {exportSel.length > 0 && (() => {
              const prev = (receitas || []).find(r => r.id === exportSel[0])
              if (!prev) return null
              const steps = parseSteps(prev.instrucoes)
              const ACAO = { misturar:'Misturar',bater:'Bater',assar:'Assar',cozinhar:'Cozinhar',resfriar:'Resfriar',congelar:'Congelar',decorar:'Decorar',derreter:'Derreter',temperar:'Temperar',montar:'Montar',mixar:'Mixar',liquidificar:'Liquidificar',processar:'Processar',incorporar:'Incorporar',ferver:'Ferver',aquecer:'Aquecer',descansar:'Descansar',cortar:'Cortar',esticar:'Esticar' }
              return (
                <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 16, fontSize: 12 }}>
                  <div style={{ fontSize: 9, color: 'var(--teal)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                    Preview · {exportSize === 'a4' ? 'A4 (ingredientes + modo de preparo + rodapé)' : 'A5 (ingredientes + modo de preparo)'}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid var(--teal)', paddingBottom: 8, marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: exportSize === 'a4' ? 15 : 13, color: '#111' }}>{prev.nome}</div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: 11, marginTop: 2 }}>
                        Rendimento: {prev.rendimento} {prev.unidadeGera}
                        {prev.pesoLiquido ? ` · ${prev.pesoLiquido}g líquido` : ''}
                      </div>
                    </div>
                    {prev.tipo && prev.tipo !== 'Outro' && (
                      <span style={{ fontSize: 10, color: 'var(--teal)', border: '1px solid var(--teal)', borderRadius: 4, padding: '2px 6px', flexShrink: 0, marginLeft: 8 }}>{prev.tipo}</span>
                    )}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 9, color: 'var(--teal)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>Ingredientes</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        <th style={{ textAlign: 'left', fontWeight: 600, color: 'var(--text-secondary)', padding: '2px 0', fontSize: 9 }}>Ingrediente</th>
                        <th style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-secondary)', padding: '2px 0', fontSize: 9 }}>Qtd</th>
                        <th style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-secondary)', padding: '2px 0', fontSize: 9 }}>x2</th>
                        <th style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-secondary)', padding: '2px 0', fontSize: 9 }}>x3</th>
                        <th style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-secondary)', padding: '2px 0', fontSize: 9 }}>x4</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(prev.ingredientes || []).slice(0, 5).map((ing, i) => {
                        const q = Number(ing.quantidade || 0)
                        const u = ing.unidade || ''
                        return (
                          <tr key={i} style={{ background: i % 2 === 1 ? '#f9fafb' : '#fff', borderBottom: '0.5px solid var(--border)' }}>
                            <td style={{ padding: '3px 0' }}>{ing.nome}</td>
                            <td style={{ textAlign: 'right', padding: '3px 0', fontWeight: 700 }}>{q}{u}</td>
                            <td style={{ textAlign: 'right', padding: '3px 0', color: 'var(--text-secondary)' }}>{q * 2}{u}</td>
                            <td style={{ textAlign: 'right', padding: '3px 0', color: 'var(--text-secondary)' }}>{q * 3}{u}</td>
                            <td style={{ textAlign: 'right', padding: '3px 0', color: 'var(--text-secondary)' }}>{q * 4}{u}</td>
                          </tr>
                        )
                      })}
                      {(prev.ingredientes || []).length > 5 && (
                        <tr><td colSpan={5} style={{ color: 'var(--text-secondary)', fontSize: 10, paddingTop: 3 }}>+ {prev.ingredientes.length - 5} ingredientes</td></tr>
                      )}
                      <tr style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '3px 0', fontWeight: 700, color: 'var(--teal)', fontSize: 10 }}>Rendimento</td>
                        <td style={{ textAlign: 'right', padding: '3px 0', fontWeight: 700 }}>{prev.rendimento}{prev.unidadeGera}</td>
                        <td style={{ textAlign: 'right', padding: '3px 0', color: 'var(--text-secondary)' }}>{prev.rendimento * 2}{prev.unidadeGera}</td>
                        <td style={{ textAlign: 'right', padding: '3px 0', color: 'var(--text-secondary)' }}>{prev.rendimento * 3}{prev.unidadeGera}</td>
                        <td style={{ textAlign: 'right', padding: '3px 0', color: 'var(--text-secondary)' }}>{prev.rendimento * 4}{prev.unidadeGera}</td>
                      </tr>
                    </tbody>
                  </table>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 6 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>Custo total</div>
                      <div style={{ fontWeight: 700, color: 'var(--teal)', fontSize: 13 }}>R$ {fmt(prev.custoTotal || 0)}</div>
                    </div>
                    {prev.custoUnid > 0 && (
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>Por {prev.unidadeGera}</div>
                        <div style={{ fontWeight: 700, color: 'var(--teal)', fontSize: 13 }}>R$ {fmt(prev.custoUnid)}</div>
                      </div>
                    )}
                  </div>
                  {steps.length > 0 && (
                    <>
                      <div style={{ fontWeight: 700, fontSize: 9, color: 'var(--teal)', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 10, marginBottom: 6 }}>Modo de preparo</div>
                      {steps.slice(0, 3).map((s, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 5 }}>
                          <div style={{ minWidth: 18, height: 18, background: 'var(--teal)', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 8, marginTop: 1 }}>
                            <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>{i + 1}</span>
                          </div>
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--teal)' }}>{ACAO[s.tipo] || s.tipo}</div>
                            {s.descricao && <div style={{ fontSize: 11, color: '#374151', lineHeight: 1.4 }}>{s.descricao}</div>}
                          </div>
                        </div>
                      ))}
                      {steps.length > 3 && <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>+ {steps.length - 3} etapas</div>}
                    </>
                  )}
                  {exportSize === 'a4' && (
                    <div style={{ borderTop: '0.5px solid var(--border)', marginTop: 8, paddingTop: 4, textAlign: 'center', fontSize: 9, color: 'var(--text-secondary)' }}>Guaxi · Ficha Técnica</div>
                  )}
                  {exportSel.length > 1 && (
                    <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-secondary)', marginTop: 6 }}>+ {exportSel.length - 1} ficha(s) adicional</div>
                  )}
                </div>
              )
            })()}

            {/* Seleção */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'var(--text-secondary)' }}>
                <input type="checkbox"
                  checked={exportSel.length === filtradas.length && filtradas.length > 0}
                  onChange={e => setExportSel(e.target.checked ? filtradas.map(r => r.id) : [])}
                /> Todas visíveis
              </label>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{exportSel.length} selecionada(s)</span>
            </div>

            <div style={{ maxHeight: '45vh', overflowY: 'auto', marginBottom: 16 }}>
              {filtradas.map(rec => (
                <label key={rec.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                  <input type="checkbox"
                    checked={exportSel.includes(rec.id)}
                    onChange={e => setExportSel(s => e.target.checked ? [...s, rec.id] : s.filter(id => id !== rec.id))}
                  />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{rec.nome}</div>
                    {rec.tipo && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{rec.tipo}</div>}
                  </div>
                </label>
              ))}
            </div>

            <button
              disabled={!exportSel.length || gerando}
              onClick={handleGerarPDF}
              style={{
                width: '100%', padding: '13px', borderRadius: 10, border: 'none', fontSize: 14,
                fontWeight: 700, cursor: exportSel.length && !gerando ? 'pointer' : 'not-allowed',
                background: exportSel.length ? 'var(--teal)' : 'var(--border)', color: '#fff',
              }}>
              {gerando ? 'Gerando PDF...' : exportSel.length ? `Baixar PDF · ${exportSel.length} ficha(s)` : 'Selecione receitas'}
            </button>
          </div>
        </>
      )}

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

      {createSheet && (
        <>
          <div className="sheet-overlay" onClick={() => setCreateSheet(false)} />
          <div className="sheet">
            <div className="sheet-title">
              <span>Como quer criar a receita?</span>
              <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer' }} onClick={() => setCreateSheet(false)}>×</button>
            </div>
            {[
              { icon: '📊', ttl: 'Importar de planilha', sub: 'Excel ou Google Sheets — ingredientes vêm junto', action: () => { setImportando(true); setCreateSheet(false) } },
              { icon: '📷', ttl: 'Importar de foto ou imagem', sub: 'Foto de caderno, screenshot, imagem digital', action: () => { setImportandoImg(true); setCreateSheet(false) } },
              { icon: '✏️', ttl: 'Registrar manualmente', sub: 'Digitar nome, ingredientes e etapas', action: () => { navigate('/fichas/nova'); setCreateSheet(false) } },
            ].map(o => (
              <button
                key={o.ttl}
                onClick={o.action}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  width: '100%', padding: '13px 4px', background: 'none', border: 'none',
                  borderBottom: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left',
                }}
              >
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>{o.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>{o.ttl}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{o.sub}</div>
                </div>
                <span style={{ color: 'var(--text-tertiary)', fontSize: 18, flexShrink: 0 }}>›</span>
              </button>
            ))}
          </div>
        </>
      )}

      {importando && (
        <Suspense fallback={null}>
          <ImportarExcel mode="receitas"
            onClose={() => setImportando(false)}
            onImported={() => { reload(); setImportando(false) }}
          />
        </Suspense>
      )}

      {importandoImg && (
        <Suspense fallback={null}>
          <ImportarImagem
            mode="receita"
            insumosList={insumos || []}
            onClose={() => setImportandoImg(false)}
            onIngredientesImportados={ings => {
              setImportandoImg(false)
              navigate('/fichas/nova', { state: { ingredientes: ings } })
            }}
          />
        </Suspense>
      )}
    </>
  )
}
