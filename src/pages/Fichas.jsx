import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../hooks/useData'
import { getReceitas } from '../services/db'
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
  const [importando, setImportando] = useState(false)

  const filtradas = (receitas || []).filter(r =>
    r.nome.toLowerCase().includes(busca.toLowerCase())
  )

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div className="topbar-title">Receitas</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setImportando(true)}
              style={{ background: 'transparent', color: 'var(--teal)', border: '1px solid var(--teal)', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >↑ Excel</button>
            <button
              onClick={() => navigate('/fichas/nova')}
              style={{ background: 'var(--teal)', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >+ Nova</button>
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
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/fichas/${r.id}`)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{r.nome}</span>
                    {r.custoUnid > 0
                      ? <span style={{ fontWeight: 600, fontSize: 14 }}>R$ {fmt(r.custoUnid)}/un</span>
                      : <span style={{ fontSize: 13, color: '#aaa' }}>—</span>
                    }
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

      {importando && (
        <ImportarExcel mode="receitas"
          onClose={() => setImportando(false)}
          onImported={() => { reload(); setImportando(false) }}
        />
      )}
    </>
  )
}
