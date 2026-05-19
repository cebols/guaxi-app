import { useState, useRef } from 'react'
import { saveInsumo } from '../services/db'

const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_KEY

function norm(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader()
    reader.onload = () => res(reader.result.split(',')[1])
    reader.onerror = rej
    reader.readAsDataURL(file)
  })
}

async function analisarImagem(file) {
  const mediaType = file.type === 'application/pdf' ? 'application/pdf' : file.type
  const b64 = await fileToBase64(file)

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: b64 },
          },
          {
            type: 'text',
            text: `Esta é uma nota fiscal, cupom ou lista de compras de insumos para confeitaria.
Identifique todos os insumos/produtos listados e retorne um JSON assim (sem markdown):
{
  "fornecedor": "Nome do fornecedor se visível, senão vazio",
  "telefone": "Telefone do fornecedor se visível, senão vazio",
  "insumos": [
    {
      "nome": "Nome do insumo",
      "marca": "Marca se visível, senão vazio",
      "categoria": "Categoria sugerida (ex: Farinhas, Gorduras, Açúcares, Chocolates, Laticínios, Embalagens, etc)",
      "unidade": "g ou ml ou un ou kg ou L",
      "pesoEmb": "Peso/quantidade da embalagem como número, ex: 1000",
      "custoEmb": "Preço pago como número com ponto decimal, ex: 12.50"
    }
  ]
}
Retorne APENAS o JSON, sem explicações.`,
          },
        ],
      }],
    }),
  })

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err?.error?.message || `Erro ${resp.status}`)
  }

  const data = await resp.json()
  const text = data.content?.[0]?.text || ''
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    throw new Error('Resposta inválida da IA')
  }
}

const UNID_OPTS = ['g', 'ml', 'un', 'kg', 'L', 'cx']

export default function ImportarImagem({ onClose, onImported }) {
  const inputRef = useRef()
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [analisando, setAnalisando] = useState(false)
  const [resultado, setResultado] = useState(null) // { fornecedor, telefone, insumos }
  const [editados, setEditados] = useState([])     // cópia editável dos insumos
  const [fornecedor, setFornecedor] = useState('')
  const [telefone, setTelefone] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [selecionados, setSelecionados] = useState([])
  const [erro, setErro] = useState('')

  function handleFile(f) {
    if (!f) return
    setFile(f)
    setResultado(null)
    setErro('')
    if (f.type.startsWith('image/')) {
      const url = URL.createObjectURL(f)
      setPreview(url)
    } else {
      setPreview(null)
    }
  }

  async function handleAnalisar() {
    if (!file) return
    if (!ANTHROPIC_KEY) {
      setErro('Configure VITE_ANTHROPIC_KEY no .env.local para usar esta funcionalidade.')
      return
    }
    setAnalisando(true)
    setErro('')
    try {
      const res = await analisarImagem(file)
      setResultado(res)
      const ins = (res.insumos || []).map((i, idx) => ({ ...i, _id: idx }))
      setEditados(ins)
      setSelecionados(ins.map(i => i._id))
      setFornecedor(res.fornecedor || '')
      setTelefone(res.telefone || '')
    } catch (e) {
      setErro('Erro ao analisar: ' + e.message)
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
        fornecedor: fornecedor,
        whatsapp: telefone,
      })))
      onImported?.()
      onClose?.()
    } catch (e) {
      setErro('Erro ao salvar: ' + e.message)
    } finally {
      setSalvando(false)
    }
  }

  const todosSel = editados.length > 0 && editados.every(i => selecionados.includes(i._id))

  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div className="sheet" style={{ maxHeight: '92dvh', overflow: 'auto' }}>
        <div className="sheet-title">
          <span>Importar por imagem</span>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer' }} onClick={onClose}>×</button>
        </div>

        {!resultado && (
          <>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
              Tire foto ou envie uma nota fiscal, cupom ou lista de compras. A IA identifica os insumos automaticamente.
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
              onClick={() => inputRef.current?.click()}
              style={{
                border: '2px dashed var(--border-color)', borderRadius: 12,
                padding: '32px 16px', textAlign: 'center', cursor: 'pointer',
                background: 'var(--bg-secondary)', marginBottom: 12,
              }}
            >
              {preview
                ? <img src={preview} alt="preview" style={{ maxHeight: 200, maxWidth: '100%', borderRadius: 8, objectFit: 'contain' }} />
                : <div>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>📷</div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{file ? file.name : 'Toque para selecionar'}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>JPG, PNG ou PDF</div>
                  </div>
              }
            </div>

            {file && (
              <button
                className="btn-primary"
                onClick={handleAnalisar}
                disabled={analisando}
              >
                {analisando ? '🔍 Analisando...' : '🔍 Analisar nota'}
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

        {resultado && (
          <>
            {/* Fornecedor único */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Fornecedor desta compra</div>
              <div className="field-row">
                <div>
                  <div className="field-label">Nome</div>
                  <input className="field-input" placeholder="Fornecedor" value={fornecedor} onChange={e => setFornecedor(e.target.value)} />
                </div>
                <div>
                  <div className="field-label">Telefone</div>
                  <input className="field-input" type="tel" placeholder="11 9 1234-5678" value={telefone} onChange={e => setTelefone(e.target.value)} />
                </div>
              </div>
            </div>

            {/* Lista de insumos */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                {editados.length} insumo(s) identificado(s)
              </div>
              <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={todosSel} onChange={e => setSelecionados(e.target.checked ? editados.map(i => i._id) : [])} />
                Todos
              </label>
            </div>

            {editados.map((ins, idx) => {
              const sel = selecionados.includes(ins._id)
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
                      <div className="field-label">Marca</div>
                      <input className="field-input" value={ins.marca || ''} onChange={e => upd(idx, 'marca', e.target.value)} placeholder="—" />
                    </div>
                    <div>
                      <div className="field-label">Categoria</div>
                      <input className="field-input" value={ins.categoria || ''} onChange={e => upd(idx, 'categoria', e.target.value)} placeholder="—" />
                    </div>
                  </div>
                  <div className="field-row">
                    <div>
                      <div className="field-label">Unidade</div>
                      <select className="field-input" value={ins.unidade || 'g'} onChange={e => upd(idx, 'unidade', e.target.value)}>
                        {UNID_OPTS.map(u => <option key={u}>{u}</option>)}
                      </select>
                    </div>
                    <div>
                      <div className="field-label">Peso emb.</div>
                      <input className="field-input" type="text" inputMode="decimal" value={ins.pesoEmb || ''} onChange={e => upd(idx, 'pesoEmb', e.target.value)} placeholder="ex: 1000" />
                    </div>
                    <div>
                      <div className="field-label">Custo (R$)</div>
                      <input className="field-input" type="text" inputMode="decimal" value={ins.custoEmb || ''} onChange={e => upd(idx, 'custoEmb', e.target.value)} placeholder="0,00" />
                    </div>
                  </div>
                </div>
              )
            })}

            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                onClick={() => { setResultado(null); setFile(null); setPreview(null) }}
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
