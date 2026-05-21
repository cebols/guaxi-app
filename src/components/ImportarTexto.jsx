import { useState } from 'react'

const UNITS = ['g', 'ml', 'kg', 'l', 'un', 'unidade', 'unidades', 'xícara', 'xícaras',
  'colher', 'colheres', 'sopa', 'chá', 'pitada', 'pitadas', 'lata', 'latas', 'cx', 'pct', 'gota', 'gotas']
const UNIT_RX = UNITS.join('|')

function resolveUnit(raw) {
  if (!raw) return 'un'
  const u = raw.toLowerCase().trim()
  if (u === 'kg') return 'kg'
  if (u === 'l' || u === 'litro' || u === 'litros') return 'L'
  if (u.startsWith('g')) return 'g'
  if (u.startsWith('ml')) return 'ml'
  if (u.startsWith('un') || u.startsWith('lata') || u.startsWith('cx') || u.startsWith('pct')) return 'un'
  return 'un'
}

function parseLine(line) {
  const raw = line.trim()
  if (!raw || raw.length < 2) return null

  // Strip bullet/dash prefix: "- item", "• item", "* item", "→ item"
  const stripped = raw.replace(/^[•\-\*→◦▪▸►]+\s*/, '').trim()

  // Tab-separated (Excel copy-paste): "Farinha\t500\tg"
  const tabs = stripped.split('\t')
  if (tabs.length >= 2) {
    const qtdIdx = tabs.findIndex(t => /^\d+[\.,]?\d*$/.test(t.trim()))
    if (qtdIdx > 0) {
      const nome = tabs.slice(0, qtdIdx).join(' ').trim()
      const qtd = parseFloat(tabs[qtdIdx].replace(',', '.'))
      const rawUnit = tabs[qtdIdx + 1]?.trim() || ''
      if (nome.length >= 2 && qtd > 0) return { nome, quantidade: qtd, unidade: resolveUnit(rawUnit) }
    }
  }

  // "302g de cream cheese" or "302 g cream cheese" or "2 kg de farinha"
  const m1 = stripped.match(new RegExp(`^(\\d+[\\.,]?\\d*)\\s*(${UNIT_RX})?s?\\s*(?:de\\s+)?(.+)$`, 'i'))
  if (m1) {
    const qtd = parseFloat(m1[1].replace(',', '.'))
    const rawUnit = m1[2] || ''
    const nome = m1[3].trim()
    if (qtd > 0 && nome.length >= 2 && !/R\$/.test(stripped)) {
      return { nome, quantidade: qtd, unidade: resolveUnit(rawUnit || 'un') }
    }
  }

  // "Chocolate Meio Amargo: 165g" or "Farinha: 2 kg"
  const m2 = stripped.match(new RegExp(`^(.+?):\\s*(\\d+[\\.,]?\\d*)\\s*(${UNIT_RX})?s?\\s*$`, 'i'))
  if (m2) {
    const nome = m2[1].trim()
    const qtd = parseFloat(m2[2].replace(',', '.'))
    const rawUnit = m2[3] || ''
    if (qtd > 0 && nome.length >= 2) return { nome, quantidade: qtd, unidade: resolveUnit(rawUnit) }
  }

  // "Açúcar 500g" or "Farinha de trigo 2kg" (name then qty+unit glued)
  const m3 = stripped.match(new RegExp(`^(.+?)\\s+(\\d+[\\.,]?\\d*)(${UNIT_RX})s?\\s*$`, 'i'))
  if (m3) {
    const nome = m3[1].trim()
    const qtd = parseFloat(m3[2].replace(',', '.'))
    const rawUnit = m3[3] || ''
    if (qtd > 0 && nome.length >= 2) return { nome, quantidade: qtd, unidade: resolveUnit(rawUnit) }
  }

  // "Canela em pó 270" (name then bare number, no unit)
  const m4 = stripped.match(/^(.+\D)\s+(\d+[\.,]?\d*)\s*$/)
  if (m4) {
    const nome = m4[1].trim()
    const qtd = parseFloat(m4[2].replace(',', '.'))
    if (qtd > 0 && nome.length >= 2 && !/R\$/.test(stripped)) {
      return { nome, quantidade: qtd, unidade: 'g' }
    }
  }

  // "Raspas de 2 laranjas" — qty embedded in middle
  const m5 = stripped.match(/^(.+?)\s+(\d+[\.,]?\d*)\s+(.+)$/)
  if (m5) {
    const qtd = parseFloat(m5[2].replace(',', '.'))
    const nome = `${m5[1]} ${m5[3]}`.trim()
    if (qtd > 0 && nome.length >= 3 && !/R\$/.test(stripped)) {
      return { nome, quantidade: qtd, unidade: 'un' }
    }
  }

  // Just a name (no quantity) — for insumo-only import
  if (stripped.length >= 2 && !/\d/.test(stripped) && !/R\$/.test(stripped)) {
    return { nome: stripped, quantidade: null, unidade: null }
  }

  return null
}

export function parseTextoLivre(texto) {
  const lines = texto.split(/[\n;]+/)
  const results = []
  for (const line of lines) {
    const parsed = parseLine(line)
    if (parsed) results.push(parsed)
  }
  return results
}

// ── Component ──────────────────────────────────────────────────────────────

export function ImportarTexto({ mode = 'ingredientes', onImport, onClose }) {
  const [texto, setTexto] = useState('')
  const [preview, setPreview] = useState(null)

  const isInsumos = mode === 'insumos'

  const handlePreview = () => {
    const parsed = parseTextoLivre(texto)
    setPreview(parsed.filter(p => p.nome.length >= 2))
  }

  const handleImport = () => {
    if (!preview) return
    onImport(preview)
    onClose()
  }

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className="sheet-title">
          {isInsumos ? 'Importar insumos — colar lista' : 'Importar ingredientes — colar texto'}
        </div>

        {!preview ? (
          <>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>
              {isInsumos
                ? 'Cole sua lista de insumos. Um por linha. Pode ter quantidade ou só o nome.'
                : 'Cole os ingredientes da receita. Aceita vários formatos — cópia de planilha, caderno, WhatsApp.'
              }
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 10, fontFamily: 'monospace', lineHeight: 1.8 }}>
              {isInsumos ? (
                <>Farinha de Trigo<br />Açúcar 5kg<br />Chocolate\t2\tkg<br />Manteiga: 500g</>
              ) : (
                <>2 xícaras de farinha<br />200g de açúcar<br />Chocolate: 165g<br />- 3 ovos</>
              )}
            </div>
            <textarea
              autoFocus
              value={texto}
              onChange={e => setTexto(e.target.value)}
              placeholder="Cole aqui..."
              style={{
                width: '100%', boxSizing: 'border-box', minHeight: 200,
                background: 'var(--bg-input)', border: '1px solid var(--border)',
                borderRadius: 10, color: '#fff', fontSize: 13, padding: '12px',
                resize: 'vertical', fontFamily: 'monospace', lineHeight: 1.6,
              }}
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button onClick={onClose} className="btn-secondary" style={{ flex: 1 }}>Cancelar</button>
              <button onClick={handlePreview} disabled={!texto.trim()} className="btn-primary" style={{ flex: 2 }}>
                Analisar →
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              {preview.length} {isInsumos ? 'insumo(s)' : 'ingrediente(s)'} encontrado(s). Confirme:
            </div>
            <div style={{ maxHeight: 320, overflowY: 'auto', marginBottom: 14 }}>
              {preview.map((item, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
                  borderBottom: '1px solid var(--border)',
                }}>
                  <div style={{ flex: 1, fontSize: 13, color: '#fff' }}>{item.nome}</div>
                  {item.quantidade != null && (
                    <div style={{ fontSize: 12, color: 'var(--teal)', whiteSpace: 'nowrap' }}>
                      {item.quantidade} {item.unidade}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setPreview(null)} className="btn-secondary" style={{ flex: 1 }}>
                ← Voltar
              </button>
              <button onClick={handleImport} className="btn-primary" style={{ flex: 2 }}>
                Importar {preview.length} {isInsumos ? 'insumos' : 'ingredientes'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
