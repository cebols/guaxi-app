import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { getInsumos, saveInsumo, saveReceita } from '../services/db'

const UNIDADES = ['g', 'ml', 'un', 'kg', 'L', 'cx']

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
  const n = parseFloat(String(v).replace(',', '.'))
  return isNaN(n) ? null : n
}

function Sheet({ title, children, onClose }) {
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

const STEP_UPLOAD   = 'upload'
const STEP_SHEETS   = 'sheets'
const STEP_MAP      = 'map'
const STEP_PREVIEW  = 'preview'
const STEP_DONE     = 'done'

export default function ImportarExcel({ onClose, onImported }) {
  const [step, setStep]           = useState(STEP_UPLOAD)
  const [workbook, setWorkbook]   = useState(null)
  const [allSheets, setAllSheets] = useState([])   // [{ name, rows2d }]
  const [selected, setSelected]   = useState([])   // sheet names selecionadas
  const [previewSheet, setPreviewSheet] = useState(null) // { name, rows2d }

  // mapeamento (aplicado a todas as abas)
  const [map, setMap] = useState({
    nomeMode:   'cell',  // 'cell' | 'tabname'
    nomeRow:    1,       // 0-based row index para célula do nome
    nomeCol:    3,       // 0-based col index para célula do nome
    headerRow:  4,       // 0-based row da linha de cabeçalho (pula essa)
    dataRow:    5,       // 0-based row onde começam os ingredientes
    colIng:     0,       // col do ingrediente
    colQtd:     5,       // col da quantidade
    colUnid:    6,       // col da unidade (opcional)
    colCusto:   8,       // col do custo (opcional)
  })

  const [parsed, setParsed]     = useState([])  // receitas parseadas para preview
  const [importing, setImporting] = useState(false)
  const [result, setResult]     = useState(null)
  const fileRef = useRef()

  const setM = (k, v) => setMap(m => ({ ...m, [k]: v }))

  // ── Step 1: parse arquivo ────────────────────────────────
  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const wb = XLSX.read(ev.target.result, { type: 'array' })
      const sheets = wb.SheetNames.map(name => ({
        name,
        rows2d: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }),
      }))
      setWorkbook(wb)
      setAllSheets(sheets)
      setSelected(sheets.map(s => s.name))
      setPreviewSheet(sheets[0] || null)
      setStep(STEP_SHEETS)
    }
    reader.readAsArrayBuffer(file)
  }

  // ── Step 2: seleção de abas ──────────────────────────────
  function toggleSheet(name) {
    setSelected(s => s.includes(name) ? s.filter(n => n !== name) : [...s, name])
  }

  // ── Parsing de uma aba com o mapeamento atual ────────────
  function parseSheet(sheet) {
    const { rows2d, name } = sheet
    const nomeFinal = map.nomeMode === 'tabname'
      ? name
      : String((rows2d[map.nomeRow] || [])[map.nomeCol] || '').trim() || name

    const ingredientes = []
    for (let r = map.dataRow; r < rows2d.length; r++) {
      const row = rows2d[r]
      const ingNome = String(row[map.colIng] || '').trim()
      const qtd = parseNum(row[map.colQtd])
      if (!ingNome || qtd === null || qtd === 0) continue
      // linha de total/custo — para
      if (norm(ingNome).startsWith('custo') || norm(ingNome).startsWith('total')) break

      const unidade = map.colUnid != null
        ? (UNIDADES.includes(String(row[map.colUnid]).trim()) ? String(row[map.colUnid]).trim() : 'g')
        : 'g'
      const custo = map.colCusto != null ? parseNum(row[map.colCusto]) : null
      ingredientes.push({ nome: ingNome, quantidade: qtd, unidade, custo })
    }

    return { nome: nomeFinal, ingredientes }
  }

  // ── Step 3: mapeamento → preview ─────────────────────────
  function buildPreview() {
    const receitas = allSheets
      .filter(s => selected.includes(s.name))
      .map(s => parseSheet(s))
      .filter(r => r.ingredientes.length > 0)
    setParsed(receitas)
    setStep(STEP_PREVIEW)
  }

  // ── Step 4: importar ─────────────────────────────────────
  async function doImport() {
    setImporting(true)
    try {
      const insumos = await getInsumos()
      let criados = 0, casados = 0, receitasCriadas = 0

      for (const rec of parsed) {
        const ingredientesFinais = []
        for (const ing of rec.ingredientes) {
          let insumo = matchInsumo(ing.nome, insumos)
          if (!insumo) {
            const novo = await saveInsumo({
              nome: ing.nome, unidade: ing.unidade || 'g',
              marca: '', categoria: '', pesoEmb: '', custoEmb: ing.custo || '',
              linkCompra: '', estoqueAtual: '', estoqueMin: '', fornecedor: '', whatsapp: '',
            })
            insumos.push({ ...novo, nome: ing.nome })
            insumo = novo
            criados++
          } else { casados++ }

          ingredientesFinais.push({
            insumoId: insumo.id, nome: ing.nome,
            quantidade: ing.quantidade,
            unidade: ing.unidade || insumo.unidade || 'g',
          })
        }

        await saveReceita(
          { nome: rec.nome, tipo: 'Outro', rendimento: 1, unidadeGera: 'un', custoTotal: 0, custoUnid: 0 },
          ingredientesFinais
        )
        receitasCriadas++
      }

      setResult({ receitasCriadas, criados, casados })
      setStep(STEP_DONE)
      onImported?.()
    } catch (e) {
      alert('Erro ao importar: ' + e.message)
    } finally {
      setImporting(false)
    }
  }

  // ── UI helpers ───────────────────────────────────────────
  const previewRows = previewSheet?.rows2d?.slice(0, 12) || []
  const maxCols = previewRows.reduce((m, r) => Math.max(m, r.length), 0)

  return (
    <Sheet title="Importar Excel" onClose={onClose}>

      {/* STEP 1: upload */}
      {step === STEP_UPLOAD && (
        <>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
            Selecione um .xlsx — cada aba será tratada como uma receita.
          </p>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleFile} />
          <button className="btn-primary" onClick={() => fileRef.current.click()}>Escolher arquivo</button>
        </>
      )}

      {/* STEP 2: selecionar abas + mapear */}
      {step === STEP_SHEETS && (
        <>
          {/* Seleção de abas */}
          <div className="field-label" style={{ marginBottom: 6 }}>Selecione as abas para importar</div>
          <div style={{ maxHeight: 140, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', marginBottom: 14 }}>
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, cursor: 'pointer', color: 'var(--text-secondary)' }}>
              <input type="checkbox"
                checked={selected.length === allSheets.length}
                onChange={e => setSelected(e.target.checked ? allSheets.map(s => s.name) : [])}
              /> Todas
            </label>
            {allSheets.map(s => (
              <label key={s.name} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, cursor: 'pointer' }}>
                <input type="checkbox" checked={selected.includes(s.name)} onChange={() => toggleSheet(s.name)} />
                {s.name}
              </label>
            ))}
          </div>

          {/* Preview visual da aba */}
          <div className="field-label" style={{ marginBottom: 4 }}>
            Preview da aba:
            <select style={{ marginLeft: 8, fontSize: 12, background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '2px 6px' }}
              value={previewSheet?.name || ''}
              onChange={e => setPreviewSheet(allSheets.find(s => s.name === e.target.value))}
            >
              {allSheets.filter(s => selected.includes(s.name)).map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          </div>
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
                {previewRows.map((row, ri) => (
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

          {/* Mapeamento */}
          <div className="field-label" style={{ marginBottom: 8 }}>Mapeamento (aplicado a todas as abas selecionadas)</div>

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
                  <input className="field-input" type="number" min="0" value={map.nomeRow}
                    onChange={e => setM('nomeRow', parseInt(e.target.value) || 0)} />
                </div>
                <div>
                  <div className="field-label">Coluna do nome</div>
                  <input className="field-input" placeholder="ex: D" value={colLetter(map.nomeCol)}
                    onChange={e => { const v = letterToCol(e.target.value); if (v >= 0) setM('nomeCol', v) }} />
                </div>
              </>
            )}
            <div>
              <div className="field-label">Ingredientes começam na linha</div>
              <input className="field-input" type="number" min="0" value={map.dataRow}
                onChange={e => setM('dataRow', parseInt(e.target.value) || 0)} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
            {[
              { k: 'colIng',   label: 'Col ingrediente', none: false },
              { k: 'colQtd',   label: 'Col quantidade',  none: false },
              { k: 'colUnid',  label: 'Col unidade',      none: true  },
              { k: 'colCusto', label: 'Col custo',        none: true  },
            ].map(({ k, label, none }) => (
              <div key={k}>
                <div className="field-label">{label}{none ? ' (opcional)' : ''}</div>
                <input className="field-input" placeholder={none ? '— vazio p/ ignorar' : 'ex: A'}
                  value={map[k] < 0 ? '' : colLetter(map[k])}
                  onChange={e => {
                    const raw = e.target.value.trim()
                    if (raw === '' && none) { setM(k, -1); return }
                    const v = letterToCol(raw)
                    if (v >= 0) setM(k, v)
                  }}
                />
              </div>
            ))}
          </div>

          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
            {selected.length} aba(s) selecionada(s)
          </div>
          <button className="btn-primary" disabled={!selected.length} onClick={buildPreview}>
            Ver preview →
          </button>
        </>
      )}

      {/* STEP 3: preview das receitas parseadas */}
      {step === STEP_PREVIEW && (
        <>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
            {parsed.length} receita(s) detectada(s). Confira antes de importar.
          </div>
          <div style={{ maxHeight: '52vh', overflowY: 'auto', marginBottom: 16 }}>
            {parsed.map((rec, ri) => (
              <div key={ri} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', marginBottom: 10 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{rec.nome}</div>
                {rec.ingredientes.map((ing, ii) => (
                  <div key={ii} style={{ fontSize: 12, padding: '2px 0' }}>
                    • {ing.quantidade} {ing.unidade} — {ing.nome}
                    {ing.custo != null ? <span style={{ color: 'var(--teal)' }}> (R$ {ing.custo})</span> : ''}
                  </div>
                ))}
                {rec.ingredientes.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>nenhum ingrediente detectado</div>
                )}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-outline-teal" onClick={() => setStep(STEP_SHEETS)}>← Ajustar</button>
            <button className="btn-primary" disabled={importing || !parsed.length} onClick={doImport}>
              {importing ? 'Importando...' : `Importar ${parsed.length} receita(s)`}
            </button>
          </div>
        </>
      )}

      {/* STEP 4: done */}
      {step === STEP_DONE && result && (
        <>
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12 }}>Importação concluída!</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.9 }}>
              {result.receitasCriadas} receita(s) criada(s)<br />
              {result.casados} ingrediente(s) casado(s) com insumos existentes<br />
              {result.criados} insumo(s) novo(s) criado(s)
            </div>
          </div>
          <button className="btn-primary" onClick={onClose}>Fechar</button>
        </>
      )}
    </Sheet>
  )
}

const thStyle = { padding: '4px 8px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }
const tdStyle = { padding: '3px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }
