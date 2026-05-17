import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { getInsumos, saveInsumo, saveReceita } from '../services/db'

const UNIDADES = ['g', 'ml', 'un', 'kg', 'L', 'cx']

function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

// Tenta casar nome do ingrediente com insumo existente
function matchInsumo(nome, insumos) {
  const n = norm(nome)
  return insumos.find(i => norm(i.nome) === n) ||
    insumos.find(i => norm(i.nome).includes(n) || n.includes(norm(i.nome)))
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

const STEP_UPLOAD  = 'upload'
const STEP_SHEET   = 'sheet'
const STEP_MAP     = 'map'
const STEP_PREVIEW = 'preview'
const STEP_DONE    = 'done'

export default function ImportarExcel({ onClose, onImported }) {
  const [step, setStep]         = useState(STEP_UPLOAD)
  const [workbook, setWorkbook] = useState(null)
  const [sheetName, setSheetName] = useState('')
  const [rows, setRows]         = useState([])   // array of objects
  const [headers, setHeaders]   = useState([])
  const [map, setMap]           = useState({
    // column names chosen by user
    receita:     '',   // nome da receita (pode ser vazio se 1 receita = arquivo inteiro)
    ingrediente: '',
    quantidade:  '',
    unidade:     '',
    custo:       '',   // opcional
    rendimento:  '',   // opcional
  })
  const [modoUmaReceita, setModoUmaReceita] = useState(false)
  const [nomeUnico, setNomeUnico] = useState('')
  const [rendimentoUnico, setRendimentoUnico] = useState('')
  const [preview, setPreview]   = useState([])   // [{ nome, rendimento, ingredientes[] }]
  const [importing, setImporting] = useState(false)
  const [result, setResult]     = useState(null)
  const fileRef = useRef()

  // ── Step 1: parse arquivo ────────────────────────────────
  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const wb = XLSX.read(ev.target.result, { type: 'array' })
      setWorkbook(wb)
      setSheetName(wb.SheetNames[0])
      setStep(STEP_SHEET)
    }
    reader.readAsArrayBuffer(file)
  }

  // ── Step 2: escolher aba ─────────────────────────────────
  function confirmSheet() {
    const ws = workbook.Sheets[sheetName]
    const data = XLSX.utils.sheet_to_json(ws, { defval: '' })
    if (!data.length) return alert('Aba vazia ou sem dados.')
    setRows(data)
    setHeaders(Object.keys(data[0]))
    setStep(STEP_MAP)
  }

  // ── Step 3: mapear colunas → preview ────────────────────
  function buildPreview() {
    if (!map.ingrediente) return alert('Selecione a coluna de ingrediente.')

    let receitas = []

    if (modoUmaReceita) {
      // Arquivo inteiro = 1 receita
      receitas = [{
        nome: nomeUnico || 'Receita importada',
        rendimento: parseFloat(rendimentoUnico) || 1,
        ingredientes: rows.map(r => ({
          nome:       String(r[map.ingrediente] || '').trim(),
          quantidade: parseFloat(String(r[map.quantidade] || '').replace(',', '.')) || 0,
          unidade:    map.unidade ? String(r[map.unidade] || 'g').trim() : 'g',
          custo:      map.custo ? parseFloat(String(r[map.custo] || '').replace(',', '.')) || 0 : null,
        })).filter(i => i.nome),
      }]
    } else {
      if (!map.receita) return alert('Selecione a coluna com o nome da receita.')
      // Agrupa por nome da receita
      const grouped = {}
      for (const r of rows) {
        const nome = String(r[map.receita] || '').trim()
        if (!nome) continue
        if (!grouped[nome]) grouped[nome] = { rendimento: null, ingredientes: [] }
        if (map.rendimento && r[map.rendimento] && !grouped[nome].rendimento) {
          grouped[nome].rendimento = parseFloat(String(r[map.rendimento]).replace(',', '.')) || 1
        }
        const ing = String(r[map.ingrediente] || '').trim()
        if (ing) {
          grouped[nome].ingredientes.push({
            nome:       ing,
            quantidade: parseFloat(String(r[map.quantidade] || '').replace(',', '.')) || 0,
            unidade:    map.unidade ? String(r[map.unidade] || 'g').trim() : 'g',
            custo:      map.custo ? parseFloat(String(r[map.custo] || '').replace(',', '.')) || 0 : null,
          })
        }
      }
      receitas = Object.entries(grouped).map(([nome, v]) => ({
        nome,
        rendimento: v.rendimento || 1,
        ingredientes: v.ingredientes,
      }))
    }

    setPreview(receitas)
    setStep(STEP_PREVIEW)
  }

  // ── Step 4: importar ─────────────────────────────────────
  async function doImport() {
    setImporting(true)
    try {
      const insumos = await getInsumos()
      let criados = 0, casados = 0, receitasCriadas = 0

      for (const rec of preview) {
        const ingredientesFinais = []

        for (const ing of rec.ingredientes) {
          let insumo = matchInsumo(ing.nome, insumos)

          if (!insumo) {
            // detecta unidade pelo nome se não tiver coluna
            const unidade = UNIDADES.find(u => ing.unidade === u) || 'g'
            const novo = await saveInsumo({
              nome: ing.nome,
              unidade,
              marca: '', categoria: '', pesoEmb: '', custoEmb: ing.custo || '',
              linkCompra: '', estoqueAtual: '', estoqueMin: '', fornecedor: '', whatsapp: '',
            })
            insumos.push({ ...novo, nome: ing.nome })
            insumo = novo
            criados++
          } else {
            casados++
          }

          ingredientesFinais.push({
            insumoId:   insumo.id,
            nome:       ing.nome,
            quantidade: ing.quantidade,
            unidade:    ing.unidade || insumo.unidade || 'g',
          })
        }

        await saveReceita(
          { nome: rec.nome, tipo: 'Outro', rendimento: rec.rendimento, unidadeGera: 'un', custoTotal: 0, custoUnid: 0 },
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

  // ── UI ───────────────────────────────────────────────────
  const sel = (field, val) => setMap(m => ({ ...m, [field]: val }))
  const ColSelect = ({ field, label, required }) => (
    <div style={{ marginBottom: 10 }}>
      <div className="field-label">{label}{required ? ' *' : ' (opcional)'}</div>
      <select className="field-input" value={map[field]} onChange={e => sel(field, e.target.value)}>
        <option value="">— não usar —</option>
        {headers.map(h => <option key={h} value={h}>{h}</option>)}
      </select>
    </div>
  )

  return (
    <Sheet title="Importar Excel" onClose={onClose}>
      {step === STEP_UPLOAD && (
        <>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
            Selecione um arquivo .xlsx ou .csv com suas receitas.
          </p>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleFile} />
          <button className="btn-primary" onClick={() => fileRef.current.click()}>
            Escolher arquivo
          </button>
        </>
      )}

      {step === STEP_SHEET && workbook && (
        <>
          <div className="field-label">Qual aba contém as receitas?</div>
          <select className="field-input" value={sheetName} onChange={e => setSheetName(e.target.value)}>
            {workbook.SheetNames.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="btn-primary" style={{ marginTop: 12 }} onClick={confirmSheet}>Continuar</button>
        </>
      )}

      {step === STEP_MAP && (
        <>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={modoUmaReceita} onChange={e => setModoUmaReceita(e.target.checked)} />
              Arquivo inteiro = uma única receita
            </label>
          </div>

          {modoUmaReceita && (
            <>
              <div className="field-label">Nome da receita *</div>
              <input className="field-input" value={nomeUnico} onChange={e => setNomeUnico(e.target.value)} placeholder="Ex: Bolo de chocolate" />
              <div className="field-label">Rendimento (unidades)</div>
              <input className="field-input" type="number" value={rendimentoUnico} onChange={e => setRendimentoUnico(e.target.value)} placeholder="1" />
            </>
          )}

          {!modoUmaReceita && (
            <>
              <ColSelect field="receita" label="Coluna: nome da receita" required />
              <ColSelect field="rendimento" label="Coluna: rendimento" />
            </>
          )}

          <ColSelect field="ingrediente" label="Coluna: ingrediente" required />
          <ColSelect field="quantidade" label="Coluna: quantidade" />
          <ColSelect field="unidade" label="Coluna: unidade (g, ml...)" />
          <ColSelect field="custo" label="Coluna: custo unitário (R$)" />

          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
            {rows.length} linhas encontradas na aba "{sheetName}"
          </div>

          <button className="btn-primary" onClick={buildPreview}>Ver preview</button>
        </>
      )}

      {step === STEP_PREVIEW && (
        <>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
            {preview.length} receita(s) para importar. Revise antes de confirmar.
          </div>
          <div style={{ maxHeight: '50vh', overflowY: 'auto', marginBottom: 16 }}>
            {preview.map((rec, ri) => (
              <div key={ri} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', marginBottom: 10 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{rec.nome}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>rendimento: {rec.rendimento}</div>
                {rec.ingredientes.map((ing, ii) => (
                  <div key={ii} style={{ fontSize: 12, color: 'var(--text)', padding: '2px 0' }}>
                    • {ing.quantidade} {ing.unidade} — {ing.nome}
                    {ing.custo ? <span style={{ color: 'var(--teal)' }}> (R$ {ing.custo})</span> : ''}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-outline-teal" onClick={() => setStep(STEP_MAP)}>Voltar</button>
            <button className="btn-primary" disabled={importing} onClick={doImport}>
              {importing ? 'Importando...' : 'Importar'}
            </button>
          </div>
        </>
      )}

      {step === STEP_DONE && result && (
        <>
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12 }}>Importação concluída!</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
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
