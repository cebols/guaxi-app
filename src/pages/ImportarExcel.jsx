import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { getInsumos, saveInsumo, saveReceita } from '../services/db'

const UNIDADES = ['g', 'ml', 'un', 'kg', 'L', 'cx', 'lt', 'und']

function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

function matchInsumo(nome, insumos) {
  const n = norm(nome)
  return insumos.find(i => norm(i.nome) === n) ||
    insumos.find(i => norm(i.nome).includes(n) || n.includes(norm(i.nome)))
}

function parseNum(v) {
  if (v === '' || v == null) return null
  // remove separador de milhar BR (ponto), normaliza vírgula decimal
  const s = String(v).trim().replace(/\.(?=\d{3})/g, '').replace(',', '.')
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

const KG_VARIANTS = /^(kg|kilo|quilo|quilograma|kilograma|kgs|kilos|quilos)s?$/i
const L_VARIANTS  = /^(l|lt|lts|litro|litros|litre|litres)s?$/i

function normalizeUnidade(raw) {
  const s = (raw || '').trim()
  if (KG_VARIANTS.test(s)) return { unidade: 'g',  pesoEmb: 1000 }
  if (L_VARIANTS.test(s))  return { unidade: 'ml', pesoEmb: 1000 }
  const known = UNIDADES.find(u => u.toLowerCase() === s.toLowerCase())
  return { unidade: known || 'un', pesoEmb: '' }
}

function colLetter(i) {
  let s = '', n = i + 1
  while (n > 0) { s = String.fromCharCode(65 + (n - 1) % 26) + s; n = Math.floor((n - 1) / 26) }
  return s
}

function letterToCol(s) {
  const upper = (s || '').toUpperCase().trim()
  let n = 0
  for (const c of upper) n = n * 26 + (c.charCodeAt(0) - 64)
  return n - 1
}

function SheetModal({ title, children, onClose }) {
  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div className="sheet" style={{ maxWidth: 680, width: '95vw' }}>
        <div className="sheet-title">
          <span>{title}</span>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer' }} onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </>
  )
}

function PreviewTable({ rows2d }) {
  const rows = rows2d.slice(0, 12)
  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0)
  return (
    <div style={{ overflowX: 'auto', marginBottom: 14, border: '1px solid var(--border)', borderRadius: 8 }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 11, minWidth: '100%' }}>
        <thead>
          <tr style={{ background: 'var(--card-bg)' }}>
            <th style={thStyle}>linha</th>
            {Array.from({ length: maxCols }, (_, i) => (
              <th key={i} style={{ ...thStyle, color: 'var(--teal)' }}>{colLetter(i)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              <td style={{ ...tdStyle, color: 'var(--text-secondary)', fontWeight: 600 }}>{ri}</td>
              {Array.from({ length: maxCols }, (_, ci) => (
                <td key={ci} style={tdStyle}>{String(row[ci] ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ColInput({ label, value, onChange, optional }) {
  return (
    <div>
      <div className="field-label">{label}{optional ? ' (opcional)' : ''}</div>
      <input className="field-input" placeholder={optional ? '— vazio p/ ignorar' : 'ex: A'}
        value={value < 0 ? '' : colLetter(value)}
        onChange={e => {
          const raw = e.target.value.trim()
          if (raw === '' && optional) { onChange(-1); return }
          const v = letterToCol(raw)
          if (v >= 0) onChange(v)
        }}
      />
    </div>
  )
}

// ── MODO RECEITAS ─────────────────────────────────────────────

function ImportReceitas({ allSheets, onDone }) {
  const [selected, setSelected]   = useState(allSheets.map(s => s.name))
  const [previewSheet, setPreviewSheet] = useState(allSheets[0] || null)
  const [map, setMap] = useState({
    nomeMode: 'cell', nomeRow: 1, nomeCol: 3,
    rendMode: 'cell', rendRow: 3, rendCol: 3,  // célula do rendimento
    dataRow: 5, colIng: 0, colQtd: 5, colUnid: 6, colCusto: 8,
  })
  const [parsed, setParsed]       = useState([])
  const [step, setStep]           = useState('map')
  const [importing, setImporting] = useState(false)
  const setM = (k, v) => setMap(m => ({ ...m, [k]: v }))

  function toggleSheet(name) {
    setSelected(s => s.includes(name) ? s.filter(n => n !== name) : [...s, name])
  }

  function parseSheet(sheet) {
    const { rows2d, name } = sheet
    const nomeFinal = map.nomeMode === 'tabname'
      ? name
      : String((rows2d[map.nomeRow] || [])[map.nomeCol] || '').trim() || name
    const rendRaw = String((rows2d[map.rendRow] || [])[map.rendCol] || '')
    const rendimento = parseNum(rendRaw.match(/[\d,.']+/)?.[0] || '') || 1
    const ingredientes = []
    for (let r = map.dataRow; r < rows2d.length; r++) {
      const row = rows2d[r]
      const ingNome = String(row[map.colIng] || '').trim()
      const qtd = parseNum(row[map.colQtd])
      if (!ingNome || qtd === null || qtd === 0) continue
      if (norm(ingNome).startsWith('custo') || norm(ingNome).startsWith('total')) break
      const unidade = map.colUnid >= 0
        ? (UNIDADES.includes(norm(String(row[map.colUnid] || ''))) ? String(row[map.colUnid]).trim() : 'g')
        : 'g'
      const custo = map.colCusto >= 0 ? parseNum(row[map.colCusto]) : null
      ingredientes.push({ nome: ingNome, quantidade: qtd, unidade, custo })
    }
    return { nome: nomeFinal, rendimento, ingredientes }
  }

  function buildPreview() {
    setParsed(allSheets.filter(s => selected.includes(s.name)).map(parseSheet).filter(r => r.ingredientes.length > 0))
    setStep('preview')
  }

  async function doImport() {
    setImporting(true)
    try {
      const insumos = await getInsumos()
      let criados = 0, casados = 0, receitasCriadas = 0
      for (const rec of parsed) {
        const ings = []
        for (const ing of rec.ingredientes) {
          let insumo = matchInsumo(ing.nome, insumos)
          if (!insumo) {
            const novo = await saveInsumo({ nome: ing.nome, unidade: ing.unidade || 'g', marca: '', categoria: '', pesoEmb: '', custoEmb: ing.custo || '', linkCompra: '', estoqueAtual: '', estoqueMin: '', fornecedor: '', whatsapp: '' })
            insumos.push({ ...novo, nome: ing.nome }); insumo = novo; criados++
          } else { casados++ }
          ings.push({ insumoId: insumo.id, nome: ing.nome, quantidade: ing.quantidade, unidade: ing.unidade || insumo.unidade || 'g' })
        }
        const custoTotal = ingredientesFinais.reduce((sum, ing) => {
          const ins = insumos.find(i => i.id === ing.insumoId)
          return sum + ing.quantidade * (ins?.custoUnit || 0)
        }, 0)
        const rendimento = rec.rendimento || 1
        await saveReceita(
          { nome: rec.nome, tipo: 'Outro', rendimento, unidadeGera: 'un', custoTotal, custoUnid: custoTotal / rendimento },
          ings
        )
        receitasCriadas++
      }
      onDone({ receitasCriadas, criados, casados })
    } catch (e) { alert('Erro: ' + e.message) } finally { setImporting(false) }
  }

  const visibleSheets = allSheets.filter(s => selected.includes(s.name))

  if (step === 'preview') return (
    <>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>{parsed.length} receita(s) detectada(s).</div>
      <div style={{ maxHeight: '52vh', overflowY: 'auto', marginBottom: 16 }}>
        {parsed.map((rec, ri) => (
          <div key={ri} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', marginBottom: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>{rec.nome}</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>rendimento: {rec.rendimento}</div>
            {rec.ingredientes.map((ing, ii) => (
              <div key={ii} style={{ fontSize: 12, padding: '2px 0' }}>
                • {ing.quantidade} {ing.unidade} — {ing.nome}
                {ing.custo != null ? <span style={{ color: 'var(--teal)' }}> (R$ {ing.custo})</span> : ''}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-outline-teal" onClick={() => setStep('map')}>← Ajustar</button>
        <button className="btn-primary" disabled={importing || !parsed.length} onClick={doImport}>
          {importing ? 'Importando...' : `Importar ${parsed.length} receita(s)`}
        </button>
      </div>
    </>
  )

  return (
    <>
      <div className="field-label" style={{ marginBottom: 6 }}>Abas para importar</div>
      <div style={{ maxHeight: 120, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', marginBottom: 14 }}>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, cursor: 'pointer', color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={selected.length === allSheets.length} onChange={e => setSelected(e.target.checked ? allSheets.map(s => s.name) : [])} /> Todas
        </label>
        {allSheets.map(s => (
          <label key={s.name} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, cursor: 'pointer' }}>
            <input type="checkbox" checked={selected.includes(s.name)} onChange={() => toggleSheet(s.name)} />
            {s.name}
          </label>
        ))}
      </div>

      <div className="field-label" style={{ marginBottom: 4 }}>
        Preview:
        <select style={{ marginLeft: 8, fontSize: 12, background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '2px 6px' }}
          value={previewSheet?.name || ''} onChange={e => setPreviewSheet(allSheets.find(s => s.name === e.target.value))}>
          {visibleSheets.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>
      </div>
      {previewSheet && <PreviewTable rows2d={previewSheet.rows2d} />}

      <div className="field-label" style={{ marginBottom: 8 }}>Mapeamento</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
        <div>
          <div className="field-label">Nome da receita vem de</div>
          <select className="field-input" value={map.nomeMode} onChange={e => setM('nomeMode', e.target.value)}>
            <option value="cell">Célula específica</option>
            <option value="tabname">Nome da aba</option>
          </select>
        </div>
        {map.nomeMode === 'cell' && (
          <>
            <div>
              <div className="field-label">Linha do nome</div>
              <input className="field-input" type="number" min="0" value={map.nomeRow} onChange={e => setM('nomeRow', parseInt(e.target.value) || 0)} />
            </div>
            <ColInput label="Coluna do nome" value={map.nomeCol} onChange={v => setM('nomeCol', v)} />
          </>
        )}
        <div>
          <div className="field-label">Ingredientes começam na linha</div>
          <input className="field-input" type="number" min="0" value={map.dataRow} onChange={e => setM('dataRow', parseInt(e.target.value) || 0)} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
        <div>
          <div className="field-label">Linha do rendimento</div>
          <input className="field-input" type="number" min="0" value={map.rendRow} onChange={e => setM('rendRow', parseInt(e.target.value) || 0)} />
        </div>
        <ColInput label="Coluna do rendimento" value={map.rendCol} onChange={v => setM('rendCol', v)} />
        <ColInput label="Col ingrediente"  value={map.colIng}   onChange={v => setM('colIng', v)} />
        <ColInput label="Col quantidade"   value={map.colQtd}   onChange={v => setM('colQtd', v)} />
        <ColInput label="Col unidade"      value={map.colUnid}  onChange={v => setM('colUnid', v)}  optional />
        <ColInput label="Col custo"        value={map.colCusto} onChange={v => setM('colCusto', v)} optional />
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>{selected.length} aba(s) selecionada(s)</div>
      <button className="btn-primary" disabled={!selected.length} onClick={buildPreview}>Ver preview →</button>
    </>
  )
}

// ── MODO INSUMOS ──────────────────────────────────────────────

function ImportInsumos({ allSheets, onDone }) {
  const [sheetName, setSheetName] = useState(allSheets[0]?.name || '')
  const [map, setMap] = useState({ dataRow: 1, colNome: 0, colUnid: 1, colCusto: 2 })
  const [parsed, setParsed]       = useState([])
  const [step, setStep]           = useState('map')
  const [importing, setImporting] = useState(false)
  const setM = (k, v) => setMap(m => ({ ...m, [k]: v }))

  const sheet = allSheets.find(s => s.name === sheetName)

  function buildPreview() {
    const rows2d = sheet?.rows2d || []
    let categoria = ''
    const insumos = []
    for (let r = map.dataRow; r < rows2d.length; r++) {
      const row = rows2d[r]
      const nome = String(row[map.colNome] || '').trim()
      if (!nome) continue
      const custo = parseNum(row[map.colCusto])
      // linha sem custo e sem unidade = header de categoria
      if (custo === null && !String(row[map.colUnid] || '').trim()) {
        categoria = nome; continue
      }
      const unid = String(row[map.colUnid] || '').trim() || 'un'
      insumos.push({ nome, unidade: unid, custo, categoria })
    }
    setParsed(insumos)
    setStep('preview')
  }

  async function doImport() {
    setImporting(true)
    try {
      const existentes = await getInsumos()
      let criados = 0, pulados = 0
      for (const ins of parsed) {
        if (matchInsumo(ins.nome, existentes)) { pulados++; continue }
        const { unidade, pesoEmb } = normalizeUnidade(ins.unidade)
        await saveInsumo({ nome: ins.nome, unidade, categoria: ins.categoria || '', marca: '', pesoEmb, custoEmb: ins.custo || '', linkCompra: '', estoqueAtual: '', estoqueMin: '', fornecedor: '', whatsapp: '' })
        criados++
      }
      onDone({ insumosCriados: criados, pulados })
    } catch (e) { alert('Erro: ' + e.message) } finally { setImporting(false) }
  }

  if (step === 'preview') return (
    <>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>{parsed.length} insumo(s) detectado(s).</div>
      <div style={{ maxHeight: '52vh', overflowY: 'auto', marginBottom: 16 }}>
        {(() => {
          let lastCat = null
          return parsed.map((ins, i) => (
            <div key={i}>
              {ins.categoria !== lastCat && (lastCat = ins.categoria, (
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--teal)', padding: '6px 0 2px', textTransform: 'uppercase' }}>{ins.categoria || 'Sem categoria'}</div>
              ))}
              <div style={{ fontSize: 12, padding: '2px 0' }}>
                • {ins.nome} <span style={{ color: 'var(--text-secondary)' }}>({ins.unidade})</span>
                {ins.custo != null ? <span style={{ color: 'var(--teal)' }}> R$ {ins.custo}</span> : ''}
              </div>
            </div>
          ))
        })()}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-outline-teal" onClick={() => setStep('map')}>← Ajustar</button>
        <button className="btn-primary" disabled={importing || !parsed.length} onClick={doImport}>
          {importing ? 'Importando...' : `Importar ${parsed.length} insumo(s)`}
        </button>
      </div>
    </>
  )

  return (
    <>
      <div className="field-label" style={{ marginBottom: 4 }}>
        Aba:
        <select style={{ marginLeft: 8, fontSize: 12, background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '2px 6px' }}
          value={sheetName} onChange={e => setSheetName(e.target.value)}>
          {allSheets.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>
      </div>
      {sheet && <PreviewTable rows2d={sheet.rows2d} />}

      <div className="field-label" style={{ marginBottom: 8 }}>Mapeamento</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
        <div>
          <div className="field-label">Dados começam na linha</div>
          <input className="field-input" type="number" min="0" value={map.dataRow} onChange={e => setM('dataRow', parseInt(e.target.value) || 0)} />
        </div>
        <ColInput label="Col nome"    value={map.colNome}  onChange={v => setM('colNome', v)} />
        <ColInput label="Col unidade" value={map.colUnid}  onChange={v => setM('colUnid', v)}  optional />
        <ColInput label="Col custo"   value={map.colCusto} onChange={v => setM('colCusto', v)} optional />
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
        Linhas sem custo e sem unidade são tratadas como categoria.
      </div>
      <button className="btn-primary" onClick={buildPreview}>Ver preview →</button>
    </>
  )
}

// ── COMPONENTE PRINCIPAL ──────────────────────────────────────

export default function ImportarExcel({ onClose, onImported, mode: modeProp = null }) {
  const [mode, setMode]         = useState(modeProp)   // 'receitas' | 'insumos'
  const [allSheets, setAllSheets] = useState([])
  const [result, setResult]     = useState(null)
  const fileRef = useRef()

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const wb = XLSX.read(ev.target.result, { type: 'array' })
      setAllSheets(wb.SheetNames.map(name => ({
        name,
        rows2d: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }),
      })))
    }
    reader.readAsArrayBuffer(file)
  }

  function handleDone(res) {
    setResult(res)
    onImported?.()
  }

  return (
    <SheetModal title="Importar Excel" onClose={onClose}>

      {/* Seleção de modo — só mostra se não veio fixado por prop */}
      {!result && !modeProp && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {['receitas', 'insumos'].map(m => (
            <button key={m} onClick={() => setMode(m)}
              style={{ flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: mode === m ? 'var(--teal)' : 'transparent',
                color: mode === m ? '#fff' : 'var(--text-secondary)',
                border: mode === m ? 'none' : '1px solid var(--border)' }}>
              {m === 'receitas' ? 'Receitas' : 'Insumos'}
            </button>
          ))}
        </div>
      )}

      {!result && !allSheets.length && (
        <>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleFile} />
          <button className="btn-primary" disabled={!mode} onClick={() => fileRef.current.click()}>
            {mode ? 'Escolher arquivo' : 'Selecione um modo acima'}
          </button>
        </>
      )}

      {!result && allSheets.length > 0 && mode === 'receitas' && (
        <ImportReceitas allSheets={allSheets} onDone={handleDone} />
      )}

      {!result && allSheets.length > 0 && mode === 'insumos' && (
        <ImportInsumos allSheets={allSheets} onDone={handleDone} />
      )}

      {result && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12 }}>Importação concluída!</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.9 }}>
            {'receitasCriadas' in result && <>{result.receitasCriadas} receita(s) criada(s)<br />{result.casados} ingrediente(s) casado(s)<br />{result.criados} insumo(s) novo(s) criado(s)</>}
            {'insumosCriados' in result && <>{result.insumosCriados} insumo(s) criado(s)<br />{result.pulados} já existiam (pulados)</>}
          </div>
          <button className="btn-primary" style={{ marginTop: 16 }} onClick={onClose}>Fechar</button>
        </div>
      )}
    </SheetModal>
  )
}

const thStyle = { padding: '4px 8px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }
const tdStyle = { padding: '3px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }
