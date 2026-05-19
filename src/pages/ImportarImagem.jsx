import { useState, useRef } from 'react'
import { createWorker } from 'tesseract.js'
import { saveInsumo } from '../services/db'

// ── Parser ────────────────────────────────────────────────────

function parsePreco(str) {
  // "R$22,90" | "22,90" | "22.90"
  const m = str.replace(/\s/g, '').match(/[\d]+[.,][\d]{2}/)
  if (!m) return null
  return parseFloat(m[0].replace(',', '.'))
}

function parsePesoHeader(text) {
  // "1kg" → { pesoEmb: 1000, unidade: 'g' }
  // "500g" → { pesoEmb: 500, unidade: 'g' }
  // "1L"  → { pesoEmb: 1000, unidade: 'ml' }
  const m = text.match(/(\d+[\.,]?\d*)\s*(kg|g|ml|l|un|cx|L)\b/i)
  if (!m) return null
  const num = parseFloat(m[1].replace(',', '.'))
  const unit = m[2].toLowerCase()
  if (unit === 'kg') return { pesoEmb: String(num * 1000), unidade: 'g' }
  if (unit === 'l')  return { pesoEmb: String(num * 1000), unidade: 'ml' }
  if (unit === 'g')  return { pesoEmb: String(num), unidade: 'g' }
  if (unit === 'ml') return { pesoEmb: String(num), unidade: 'ml' }
  if (unit === 'un') return { pesoEmb: String(num), unidade: 'un' }
  return null
}

function inferCategoria(nome) {
  const n = nome.toLowerCase()
  if (/polpa|fruta|açaí|acai/.test(n))          return 'Polpas'
  if (/chocolate|cacau|granulado|cobertura/.test(n)) return 'Chocolates'
  if (/farinha|amido|fécula|fecul/.test(n))      return 'Farinhas'
  if (/manteiga|margarina|gordura|óleo|oleo/.test(n)) return 'Gorduras'
  if (/açúcar|acucar|glucose|glicose/.test(n))   return 'Açúcares'
  if (/leite|creme|nata|queijo|iogurte/.test(n)) return 'Laticínios'
  if (/ovo|ovos/.test(n))                         return 'Ovos'
  if (/embalagem|caixa|saco|pote|bandeja/.test(n)) return 'Embalagens'
  return ''
}

function parsePriceList(rawText, headerPeso) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean)
  const insumos = []

  // Linhas de cabeçalho/rodapé para ignorar
  const skipPatterns = /^(r\$|rs\$|total|subtotal|obs|telefone|whatsapp|endere|cnpj|cpf|fone|tel:|pix)/i

  for (const line of lines) {
    // Precisa ter algo que parece preço
    if (!/R\$|r\$|\d+[.,]\d{2}/.test(line)) continue
    if (skipPatterns.test(line.trim())) continue

    // Extrai preço (último número com vírgula/ponto no final da linha)
    const precoMatch = line.match(/R?\$?\s*([\d]+[.,][\d]{2})\s*$/) ||
                       line.match(/([\d]+[.,][\d]{2})\s*$/)
    if (!precoMatch) continue

    const custoEmb = parseFloat(precoMatch[1].replace(',', '.'))
    if (!custoEmb || custoEmb <= 0) continue

    // Nome = tudo antes do preço, limpo
    let nome = line.slice(0, line.lastIndexOf(precoMatch[0])).trim()
    nome = nome.replace(/^[-•·*]\s*/, '').replace(/\s{2,}/g, ' ').trim()
    nome = nome.replace(/R\$\s*$/, '').trim()

    if (!nome || nome.length < 2) continue
    if (/^\d+$/.test(nome)) continue // só número

    // Peso embutido no nome? ex: "Morango 500g"
    let pesoInfo = parsePesoHeader(nome)
    if (pesoInfo) {
      nome = nome.replace(/\s*\d+[\.,]?\d*\s*(kg|g|ml|l|un|cx|L)\b/gi, '').trim()
    } else {
      pesoInfo = headerPeso
    }

    // Capitaliza nome
    nome = nome.replace(/\b\w/g, c => c.toUpperCase())

    insumos.push({
      nome,
      marca: '',
      categoria: inferCategoria(nome),
      unidade: pesoInfo?.unidade || 'g',
      pesoEmb: pesoInfo?.pesoEmb || '',
      custoEmb: String(custoEmb),
    })
  }

  return insumos
}

function extrairFornecedor(rawText) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean)
  // Primeira linha não-vazia que não parece preço costuma ser o nome do fornecedor
  const header = lines.find(l => l.length > 3 && !/R\$|\d+[.,]\d{2}/.test(l))
  return header || ''
}

// ── OCR ──────────────────────────────────────────────────────

async function ocr(file, onProgress) {
  const worker = await createWorker('por', 1, {
    logger: m => {
      if (m.status === 'recognizing text') {
        onProgress(Math.round(m.progress * 100))
      }
    },
  })
  const url = URL.createObjectURL(file)
  const { data: { text } } = await worker.recognize(url)
  await worker.terminate()
  URL.revokeObjectURL(url)
  return text
}

// ── Componente ────────────────────────────────────────────────

const UNID_OPTS = ['g', 'ml', 'un', 'kg', 'L', 'cx']

export default function ImportarImagem({ onClose, onImported, categorias = [], fornecedoresList = [] }) {
  const inputRef = useRef()
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [progresso, setProgresso] = useState(0)
  const [analisando, setAnalisando] = useState(false)
  const [editados, setEditados] = useState([])
  const [fornecedor, setFornecedor] = useState('')
  const [telefone, setTelefone] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [selecionados, setSelecionados] = useState([])
  const [erro, setErro] = useState('')
  const [done, setDone] = useState(false)

  function handleFile(f) {
    if (!f) return
    setFile(f)
    setDone(false)
    setErro('')
    setProgresso(0)
    if (f.type.startsWith('image/')) {
      const url = URL.createObjectURL(f)
      setPreview(url)
    } else {
      setPreview(null)
    }
  }

  function handlePaste(e) {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const f = item.getAsFile()
        if (f) handleFile(f)
        break
      }
    }
  }

  async function handleAnalisar() {
    if (!file) return
    setAnalisando(true)
    setErro('')
    setProgresso(0)
    try {
      const texto = await ocr(file, setProgresso)

      // Detecta unidade/peso do cabeçalho geral
      const headerPeso = parsePesoHeader(texto.split('\n').slice(0, 5).join(' '))

      const insumos = parsePriceList(texto, headerPeso)
      const fornNome = extrairFornecedor(texto)

      if (insumos.length === 0) {
        setErro('Nenhum item com preço encontrado. Tente uma imagem mais nítida ou com melhor iluminação.')
        setAnalisando(false)
        return
      }

      const indexados = insumos.map((i, idx) => ({ ...i, _id: idx }))
      setEditados(indexados)
      setSelecionados(indexados.map(i => i._id))
      setFornecedor(fornNome)
      setDone(true)
    } catch (e) {
      setErro('Erro no OCR: ' + e.message)
    } finally {
      setAnalisando(false)
    }
  }

  function upd(idx, k, v) {
    setEditados(prev => prev.map((i, n) => n === idx ? { ...i, [k]: v } : i))
  }

  function toggleSel(id) {
    setSelecionados(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  }

  async function handleSalvar() {
    const para_salvar = editados.filter(i => selecionados.includes(i._id) && i.nome.trim())
    if (!para_salvar.length) return
    setSalvando(true)
    try {
      await Promise.all(para_salvar.map(i => saveInsumo({
        nome: i.nome,
        marca: i.marca || '',
        categoria: i.categoria || '',
        unidade: i.unidade || 'g',
        pesoEmb: i.pesoEmb || '',
        custoEmb: i.custoEmb || '',
        linkCompra: '',
        estoqueAtual: '',
        estoqueMin: '',
        fornecedor,
        whatsapp: telefone,
      })))
      onImported?.()
      onClose?.()
    } catch (e) {
      setErro('Erro ao salvar: ' + e.message)
      setSalvando(false)
    }
  }

  const todosSel = editados.length > 0 && editados.every(i => selecionados.includes(i._id))

  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div className="sheet" style={{ maxHeight: '92dvh', overflow: 'auto' }} onPaste={handlePaste}>
        <div className="sheet-title">
          <span>Importar lista de preços</span>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer' }} onClick={onClose}>×</button>
        </div>

        {!done && (
          <>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
              Envie uma imagem ou PDF com lista de produtos e preços do fornecedor.
            </div>

            <input
              ref={inputRef}
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              style={{ display: 'none' }}
              onChange={e => handleFile(e.target.files?.[0])}
            />

            <div
              onClick={() => !analisando && inputRef.current?.click()}
              style={{
                border: '2px dashed var(--border-color)', borderRadius: 12,
                padding: '28px 16px', textAlign: 'center',
                cursor: analisando ? 'default' : 'pointer',
                background: 'var(--bg-secondary)', marginBottom: 12,
              }}
            >
              {preview
                ? <img src={preview} alt="preview" style={{ maxHeight: 200, maxWidth: '100%', borderRadius: 8, objectFit: 'contain' }} />
                : <div>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{file ? file.name : 'Toque para selecionar'}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>JPG, PNG ou PDF · ou Cole com Ctrl+V</div>
                  </div>
              }
            </div>

            {analisando && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  Lendo imagem... {progresso}%
                </div>
                <div style={{ height: 6, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${progresso}%`, background: 'var(--teal)', borderRadius: 4, transition: 'width 0.2s' }} />
                </div>
              </div>
            )}

            {file && !analisando && (
              <button className="btn-primary" onClick={handleAnalisar}>
                🔍 Ler lista
              </button>
            )}
            {!file && (
              <button className="btn-outline-teal" onClick={() => inputRef.current?.click()}>
                Selecionar arquivo
              </button>
            )}
          </>
        )}

        {erro && (
          <div style={{ color: 'var(--alert-text, #ef4444)', fontSize: 13, marginBottom: 12, padding: '8px 12px', background: 'rgba(239,68,68,0.1)', borderRadius: 8 }}>
            {erro}
          </div>
        )}

        {done && (
          <>
            {/* Fornecedor */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Fornecedor</div>
              <div className="field-row">
                <div>
                  <div className="field-label">Nome</div>
                  <input
                    className="field-input"
                    list="forn-img-list"
                    placeholder="Fornecedor"
                    value={fornecedor}
                    onChange={e => {
                      setFornecedor(e.target.value)
                      const match = fornecedoresList.find(f => f.nome === e.target.value)
                      if (match) setTelefone(match.whatsapp || '')
                    }}
                  />
                  <datalist id="forn-img-list">
                    {fornecedoresList.map(f => <option key={f.nome} value={f.nome} />)}
                  </datalist>
                </div>
                <div>
                  <div className="field-label">Telefone</div>
                  <input className="field-input" type="tel" placeholder="11 9 1234-5678" value={telefone} onChange={e => setTelefone(e.target.value)} />
                </div>
              </div>
            </div>

            <datalist id="cats-img-import">
              {categorias.map(c => <option key={c} value={c} />)}
            </datalist>

            {/* Cabeçalho da lista */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                {editados.length} item(s) encontrado(s)
              </div>
              <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={todosSel} onChange={e => setSelecionados(e.target.checked ? editados.map(i => i._id) : [])} />
                Todos
              </label>
            </div>

            {editados.map((ins, idx) => {
              const sel = selecionados.includes(ins._id)
              const custoUnit = parseFloat(ins.pesoEmb) > 0 && parseFloat(ins.custoEmb) > 0
                ? (parseFloat(ins.custoEmb) / parseFloat(ins.pesoEmb))
                : null
              return (
                <div key={ins._id} style={{
                  border: sel ? '1px solid var(--teal)' : '1px solid var(--border)',
                  borderRadius: 10, padding: '10px 12px', marginBottom: 8,
                  background: sel ? 'rgba(20,184,166,0.04)' : 'var(--card-bg)',
                  opacity: sel ? 1 : 0.5,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <input type="checkbox" checked={sel} onChange={() => toggleSel(ins._id)} />
                    <input
                      className="field-input"
                      style={{ flex: 1, marginBottom: 0, fontWeight: 600 }}
                      value={ins.nome}
                      onChange={e => upd(idx, 'nome', e.target.value)}
                      placeholder="Nome"
                    />
                  </div>
                  <div className="field-row" style={{ marginBottom: 6 }}>
                    <div>
                      <div className="field-label">Categoria</div>
                      <input className="field-input" list="cats-img-import" value={ins.categoria || ''} onChange={e => upd(idx, 'categoria', e.target.value)} placeholder="—" />
                    </div>
                    <div>
                      <div className="field-label">Unidade</div>
                      <select className="field-input" value={ins.unidade || 'g'} onChange={e => upd(idx, 'unidade', e.target.value)}>
                        {UNID_OPTS.map(u => <option key={u}>{u}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="field-row">
                    <div>
                      <div className="field-label">Qtd emb.</div>
                      <input className="field-input" type="text" inputMode="decimal" value={ins.pesoEmb || ''} onChange={e => upd(idx, 'pesoEmb', e.target.value)} placeholder="ex: 1000" />
                    </div>
                    <div>
                      <div className="field-label">Custo (R$)</div>
                      <input className="field-input" type="text" inputMode="decimal" value={ins.custoEmb || ''} onChange={e => upd(idx, 'custoEmb', e.target.value)} placeholder="0,00" />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                      {custoUnit !== null && (
                        <div style={{ fontSize: 11, color: 'var(--teal)', fontWeight: 600, paddingBottom: 8 }}>
                          R$ {custoUnit.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}/{ins.unidade}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}

            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                onClick={() => { setDone(false); setFile(null); setPreview(null) }}
                style={{ flex: 1, padding: 12, borderRadius: 8, border: '1px solid #444', background: 'transparent', color: 'var(--text-primary)', fontSize: 14, cursor: 'pointer' }}
              >
                ← Nova foto
              </button>
              <button
                className="btn-primary"
                style={{ flex: 2 }}
                disabled={salvando || !selecionados.length}
                onClick={handleSalvar}
              >
                {salvando ? 'Salvando...' : `Cadastrar ${selecionados.length} insumo(s)`}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
