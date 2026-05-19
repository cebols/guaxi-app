import { useState, useRef, useEffect } from 'react'
import { createWorker } from 'tesseract.js'
import { saveInsumo } from '../services/db'
import { norm, bestFuzzyMatch } from '../utils/norm'

// ── NormSearch: accent-aware searchable dropdown ──────────────

function NormSearch({ value, onChange, options, placeholder, style }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState(value || '')
  const ref = useRef()

  useEffect(() => { setQ(value || '') }, [value])
  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = q ? options.filter(o => norm(o.label).includes(norm(q))) : options

  function select(opt) {
    setQ(opt.label)
    onChange(opt)
    setOpen(false)
  }

  function handleChange(e) {
    const val = e.target.value
    setQ(val)
    onChange({ label: val, value: null })
    setOpen(true)
  }

  return (
    <div ref={ref} style={{ position: 'relative', flex: 1 }}>
      <input
        className="field-input"
        style={{ marginBottom: 0, width: '100%', ...style }}
        placeholder={placeholder}
        value={q}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
      />
      {open && filtered.length > 0 && (
        <div style={{ position: 'absolute', zIndex: 200, top: '100%', left: 0, right: 0, marginTop: 2,
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.35)', maxHeight: 200, overflowY: 'auto' }}>
          {filtered.map(opt => (
            <div key={opt.id || opt.label} onMouseDown={e => { e.preventDefault(); select(opt) }}
              style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(13,148,136,0.1)'}
              onMouseLeave={e => e.currentTarget.style.background = ''}>
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

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
  const header = lines.find(l => l.length > 3 && !/R\$|\d+[.,]\d{2}/.test(l))
  return header || ''
}

const isOvo = nome => /ovo|ovos/i.test(nome)

// Eggs: qty ≤ 30 without explicit unit → units; qty > 30 without explicit unit → grams;
// explicit 'g' but qty ≤ 30 → nonsense, treat as units
function resolveOvoUnidade(qtd, rawUnit) {
  if (!rawUnit || rawUnit === 'g') return qtd <= 30 ? 'un' : 'g'
  return null // trust explicit unit (ml, kg, L, un…)
}

function parseIngredientList(rawText) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean)
  const result = []
  const UNITS = ['g', 'ml', 'kg', 'l', 'un', 'unidade', 'unidades', 'xícara', 'xícaras', 'colher', 'colheres']
  const unitRx = UNITS.join('|')
  for (const line of lines) {
    // "302g de cream cheese" or "302 g de cream cheese"
    const m = line.match(new RegExp(`^(\\d+[\\.,]?\\d*)\\s*(${unitRx})?s?\\s*(?:de\\s+)?(.+)$`, 'i'))
    if (m) {
      const qtd = parseFloat(m[1].replace(',', '.'))
      const rawUnit = (m[2] || '').toLowerCase()
      const nome = m[3].trim().replace(/\s{2,}/g, ' ')
      if (qtd <= 0 || nome.length < 2) continue
      let unidade = 'g'
      if (rawUnit.startsWith('ml')) unidade = 'ml'
      else if (rawUnit.startsWith('kg')) unidade = 'kg'
      else if (rawUnit === 'l') unidade = 'L'
      else if (!rawUnit || rawUnit.startsWith('un') || rawUnit.startsWith('xíc') || rawUnit.startsWith('col')) unidade = 'un'
      if (isOvo(nome)) unidade = resolveOvoUnidade(qtd, rawUnit) || unidade
      result.push({ nome, quantidade: qtd, unidade })
      continue
    }
    // "Raspas de 2 laranjas" — qty embedded
    const m2 = line.match(/^(.+?)\s+(\d+[\.,]?\d*)\s+(.+)$/)
    if (m2) {
      const qtd = parseFloat(m2[2].replace(',', '.'))
      const nome = `${m2[1]} ${m2[3]}`.trim()
      if (qtd > 0 && nome.length >= 3 && !/R\$/.test(line)) {
        const unidade = isOvo(nome) ? (qtd <= 30 ? 'un' : 'g') : 'un'
        result.push({ nome, quantidade: qtd, unidade })
      }
    }
  }
  return result
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

// ── Image preprocessing ───────────────────────────────────────

async function preprocessForOCR(blob) {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(blob)
    img.onload = () => {
      URL.revokeObjectURL(url)

      // Scale up small images — Tesseract reads better at ~2000px wide
      const TARGET_W = 2000
      const scale = img.width < TARGET_W ? TARGET_W / img.width : 1
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)

      const id = ctx.getImageData(0, 0, w, h)
      const d = id.data

      // 1. Grayscale (luminance-weighted)
      for (let i = 0; i < d.length; i += 4) {
        const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
        d[i] = d[i + 1] = d[i + 2] = g
      }

      // 2. Contrast stretch — map [min,max] → [0,255]
      let lo = 255, hi = 0
      for (let i = 0; i < d.length; i += 4) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i] }
      const range = hi - lo || 1
      for (let i = 0; i < d.length; i += 4) {
        const v = Math.round(((d[i] - lo) / range) * 255)
        d[i] = d[i + 1] = d[i + 2] = v
      }

      // 3. Sharpening via unsharp mask (kernel approximation on a copy)
      const sharp = new Uint8ClampedArray(d)
      const K = [[-1, -1, -1], [-1, 9, -1], [-1, -1, -1]]
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          let s = 0
          for (let ky = -1; ky <= 1; ky++)
            for (let kx = -1; kx <= 1; kx++)
              s += d[((y + ky) * w + (x + kx)) * 4] * K[ky + 1][kx + 1]
          const v = Math.max(0, Math.min(255, s))
          const idx = (y * w + x) * 4
          sharp[idx] = sharp[idx + 1] = sharp[idx + 2] = v
        }
      }

      // 4. Otsu binarization on sharpened image
      const hist = new Array(256).fill(0)
      for (let i = 0; i < sharp.length; i += 4) hist[sharp[i]]++
      const total = sharp.length / 4
      let sum = 0
      for (let t = 0; t < 256; t++) sum += t * hist[t]
      let sumB = 0, wB = 0, maxVar = 0, thr = 128
      for (let t = 0; t < 256; t++) {
        wB += hist[t]; if (!wB) continue
        const wF = total - wB; if (!wF) break
        sumB += t * hist[t]
        const between = wB * wF * ((sumB / wB) - ((sum - sumB) / wF)) ** 2
        if (between > maxVar) { maxVar = between; thr = t }
      }
      // Invert if background is dark (>50% pixels below threshold)
      const darkPct = hist.slice(0, thr).reduce((s, v) => s + v, 0) / total
      for (let i = 0; i < sharp.length; i += 4) {
        const v = (sharp[i] < thr) !== (darkPct > 0.5) ? 0 : 255
        sharp[i] = sharp[i + 1] = sharp[i + 2] = v
        sharp[i + 3] = 255
      }

      ctx.putImageData(new ImageData(sharp, w, h), 0, 0)
      canvas.toBlob(resolve, 'image/png')
    }
    img.src = url
  })
}

// ── Crop tool ─────────────────────────────────────────────────

function CropTool({ src, onConfirm, onSkip }) {
  const containerRef = useRef()
  const imgRef = useRef()
  const [box, setBox] = useState({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 })
  const dragging = useRef(null)
  const startPos = useRef(null)
  const startBox = useRef(null)

  function getPos(e) {
    const rect = containerRef.current.getBoundingClientRect()
    const pt = e.touches ? e.touches[0] : e
    return { x: (pt.clientX - rect.left) / rect.width, y: (pt.clientY - rect.top) / rect.height }
  }

  function startDrag(type, e) {
    e.preventDefault(); e.stopPropagation()
    dragging.current = type
    startPos.current = getPos(e)
    startBox.current = { ...box }
  }

  function onMove(e) {
    if (!dragging.current) return
    e.preventDefault()
    const pos = getPos(e)
    const dx = pos.x - startPos.current.x
    const dy = pos.y - startPos.current.y
    const MIN = 0.1
    setBox(() => {
      let { x, y, w, h } = startBox.current
      const t = dragging.current
      if (t === 'move') {
        x = Math.max(0, Math.min(1 - w, x + dx)); y = Math.max(0, Math.min(1 - h, y + dy))
      } else {
        if (t.includes('l')) { const nx = Math.min(x + w - MIN, x + dx); w -= nx - x; x = nx }
        if (t.includes('r')) { w = Math.max(MIN, Math.min(1 - x, w + dx)) }
        if (t.includes('t')) { const ny = Math.min(y + h - MIN, y + dy); h -= ny - y; y = ny }
        if (t.includes('b')) { h = Math.max(MIN, Math.min(1 - y, h + dy)) }
      }
      return { x, y, w, h }
    })
  }

  function stopDrag() { dragging.current = null }

  function applyCrop() {
    const img = imgRef.current
    const nw = img.naturalWidth, nh = img.naturalHeight
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(box.w * nw); canvas.height = Math.round(box.h * nh)
    canvas.getContext('2d').drawImage(img, box.x * nw, box.y * nh, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(onConfirm, 'image/jpeg', 0.95)
  }

  const H = 26
  const corners = [
    { key: 'tl', style: { top: -H / 2, left: -H / 2, borderTopLeftRadius: 6, borderTopRightRadius: 2, borderBottomLeftRadius: 2 } },
    { key: 'tr', style: { top: -H / 2, right: -H / 2, borderTopRightRadius: 6, borderTopLeftRadius: 2, borderBottomRightRadius: 2 } },
    { key: 'bl', style: { bottom: -H / 2, left: -H / 2, borderBottomLeftRadius: 6, borderTopLeftRadius: 2, borderBottomRightRadius: 2 } },
    { key: 'br', style: { bottom: -H / 2, right: -H / 2, borderBottomRightRadius: 6, borderTopRightRadius: 2, borderBottomLeftRadius: 2 } },
  ]

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, textAlign: 'center' }}>
        Arraste as bordas para recortar a área da receita
      </div>
      <div ref={containerRef}
        style={{ position: 'relative', userSelect: 'none', touchAction: 'none', borderRadius: 8, overflow: 'hidden' }}
        onMouseMove={onMove} onMouseUp={stopDrag} onMouseLeave={stopDrag}
        onTouchMove={onMove} onTouchEnd={stopDrag}
      >
        {/* Full image always visible */}
        <img ref={imgRef} src={src} style={{ width: '100%', display: 'block' }} draggable={false} />

        {/* Dark overlay outside crop — 4 rects */}
        {[
          { left: 0, top: 0, width: '100%', height: `${box.y * 100}%` },
          { left: 0, top: `${(box.y + box.h) * 100}%`, width: '100%', bottom: 0 },
          { left: 0, top: `${box.y * 100}%`, width: `${box.x * 100}%`, height: `${box.h * 100}%` },
          { right: 0, top: `${box.y * 100}%`, width: `${(1 - box.x - box.w) * 100}%`, height: `${box.h * 100}%` },
        ].map((style, i) => (
          <div key={i} style={{ position: 'absolute', background: 'rgba(0,0,0,0.6)', pointerEvents: 'none', ...style }} />
        ))}

        {/* Crop border + handles */}
        <div
          style={{ position: 'absolute', left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`, border: '2px solid var(--teal)', boxSizing: 'border-box', cursor: 'move' }}
          onMouseDown={e => startDrag('move', e)} onTouchStart={e => startDrag('move', e)}
        >
          {corners.map(({ key, style }) => (
            <div key={key}
              style={{ position: 'absolute', width: H, height: H, background: 'var(--teal)', zIndex: 2, ...style }}
              onMouseDown={e => startDrag(key, e)} onTouchStart={e => startDrag(key, e)}
            />
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button type="button" className="btn-outline-teal" onClick={onSkip} style={{ flex: 1 }}>Pular recorte</button>
        <button type="button" className="btn-primary" onClick={applyCrop} style={{ flex: 2 }}>Recortar e analisar</button>
      </div>
    </div>
  )
}

// ── Componente ────────────────────────────────────────────────

const UNID_OPTS = ['g', 'ml', 'un', 'kg', 'L', 'cx']

export default function ImportarImagem({ onClose, onImported, categorias = [], fornecedoresList = [], mode = 'insumos', insumosList = [], onIngredientesImportados }) {
  const inputRef = useRef()
  const sheetRef = useRef()
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
  const [cropSrc, setCropSrc] = useState(null)
  const rawFileRef = useRef(null)
  const isReceita = mode === 'receita'

  function handleFile(f) {
    if (!f) return
    setDone(false); setErro(''); setProgresso(0)
    if (f.type.startsWith('image/')) {
      rawFileRef.current = f
      setCropSrc(URL.createObjectURL(f))
      setFile(null); setPreview(null)
    } else {
      setFile(f); setPreview(null); setCropSrc(null)
    }
  }

  function handleCropConfirm(blob) {
    const url = URL.createObjectURL(blob)
    setFile(blob); setPreview(url); setCropSrc(null)
    analyzeBlob(blob)
  }

  function handleCropSkip() {
    const f = rawFileRef.current
    if (f) { setFile(f); setPreview(URL.createObjectURL(f)) }
    setCropSrc(null)
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

  useEffect(() => {
    sheetRef.current?.focus()
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [])

  async function analyzeBlob(blob) {
    setAnalisando(true); setErro(''); setProgresso(0)
    try {
      const processado = await preprocessForOCR(blob)
      const texto = await ocr(processado, setProgresso)
      if (isReceita) {
        const ings = parseIngredientList(texto)
        if (ings.length === 0) {
          setErro('Nenhum ingrediente encontrado. Tente uma imagem mais nítida.')
          setAnalisando(false)
          return
        }
        const indexados = ings.map((ing, idx) => {
          const match = bestFuzzyMatch(ing.nome, insumosList, i => i.nome)
          return { ...ing, _id: idx, insumoId: match?.id || null, insumoNome: match?.nome || null, unidade: ing.unidade }
        })
        setEditados(indexados)
        setSelecionados(indexados.map(i => i._id))
        setDone(true)
      } else {
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
      }
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
      <div ref={sheetRef} className="sheet" style={{ maxHeight: '92dvh', overflow: 'auto' }} tabIndex={-1} onPaste={handlePaste} outline="none">
        <div className="sheet-title">
          <span>{isReceita ? 'Importar ingredientes' : 'Importar lista de preços'}</span>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer' }} onClick={onClose}>×</button>
        </div>

        {!done && cropSrc && (
          <CropTool src={cropSrc} onConfirm={handleCropConfirm} onSkip={handleCropSkip} />
        )}

        {!done && !cropSrc && (
          <>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
              {isReceita
                ? 'Foto da receita com ingredientes. Formato esperado: "300g de cream cheese".'
                : 'Envie uma imagem ou PDF com lista de produtos e preços do fornecedor.'}
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
              <button className="btn-primary" onClick={() => file && analyzeBlob(file)}>
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

        {done && isReceita && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{editados.length} ingrediente(s) encontrado(s)</div>
              <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={todosSel} onChange={e => setSelecionados(e.target.checked ? editados.map(i => i._id) : [])} />
                Todos
              </label>
            </div>
            {editados.map((ing, idx) => {
              const sel = selecionados.includes(ing._id)
              return (
                <div key={ing._id} style={{
                  border: sel ? '1px solid var(--teal)' : '1px solid var(--border)',
                  borderRadius: 10, padding: '10px 12px', marginBottom: 8,
                  background: sel ? 'rgba(20,184,166,0.04)' : 'var(--card-bg)',
                  opacity: sel ? 1 : 0.5,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <input type="checkbox" checked={sel} onChange={() => toggleSel(ing._id)} />
                    <NormSearch
                      style={{ fontWeight: 600 }}
                      placeholder="Nome"
                      value={ing.nome}
                      options={insumosList.map(i => ({ id: i.id, label: i.nome, unidade: i.unidade }))}
                      onChange={opt => {
                        upd(idx, 'nome', opt.label)
                        if (opt.value !== null && opt.id) {
                          upd(idx, 'insumoId', opt.id)
                          upd(idx, 'insumoNome', opt.label)
                          upd(idx, 'unidade', opt.unidade)
                        } else {
                          upd(idx, 'insumoId', null)
                          upd(idx, 'insumoNome', null)
                        }
                      }}
                    />
                    {ing.insumoId
                      ? <span style={{ fontSize: 10, color: 'var(--teal)', border: '1px solid var(--teal)', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>✓ cadastrado</span>
                      : <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0 }}>novo</span>
                    }
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div className="field-label">Qtd</div>
                      <input className="field-input" style={{ marginBottom: 0 }} type="text" inputMode="decimal" value={ing.quantidade} onChange={e => upd(idx, 'quantidade', e.target.value)} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="field-label">Unidade</div>
                      <select className="field-input" style={{ marginBottom: 0 }} value={ing.unidade || 'g'} onChange={e => upd(idx, 'unidade', e.target.value)}>
                        {UNID_OPTS.map(u => <option key={u}>{u}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              )
            })}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={() => { setDone(false); setFile(null); setPreview(null) }} style={{ flex: 1, padding: 12, borderRadius: 8, border: '1px solid #444', background: 'transparent', color: 'var(--text-primary)', fontSize: 14, cursor: 'pointer' }}>← Nova foto</button>
              <button className="btn-primary" style={{ flex: 2 }} disabled={!selecionados.length}
                onClick={() => {
                  const sel = editados.filter(i => selecionados.includes(i._id))
                  onIngredientesImportados?.(sel.map(i => ({
                    nome: i.insumoNome || i.nome,
                    quantidade: String(i.quantidade),
                    unidade: i.unidade,
                    insumoId: i.insumoId || null,
                    subReceitaId: null,
                  })))
                  onClose?.()
                }}>
                Adicionar {selecionados.length} ingrediente(s)
              </button>
            </div>
          </>
        )}

        {done && !isReceita && (
          <>
            {/* Fornecedor */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Fornecedor</div>
              <div className="field-row">
                <div>
                  <div className="field-label">Nome</div>
                  <input className="field-input" list="forn-img-list" placeholder="Fornecedor" value={fornecedor}
                    onChange={e => { setFornecedor(e.target.value); const match = fornecedoresList.find(f => f.nome === e.target.value); if (match) setTelefone(match.whatsapp || '') }} />
                  <datalist id="forn-img-list">{fornecedoresList.map(f => <option key={f.nome} value={f.nome} />)}</datalist>
                </div>
                <div>
                  <div className="field-label">Telefone</div>
                  <input className="field-input" type="tel" placeholder="11 9 1234-5678" value={telefone} onChange={e => setTelefone(e.target.value)} />
                </div>
              </div>
            </div>
            <datalist id="cats-img-import">{categorias.map(c => <option key={c} value={c} />)}</datalist>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{editados.length} item(s) encontrado(s)</div>
              <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={todosSel} onChange={e => setSelecionados(e.target.checked ? editados.map(i => i._id) : [])} />
                Todos
              </label>
            </div>
            {editados.map((ins, idx) => {
              const sel = selecionados.includes(ins._id)
              const custoUnit = parseFloat(ins.pesoEmb) > 0 && parseFloat(ins.custoEmb) > 0 ? (parseFloat(ins.custoEmb) / parseFloat(ins.pesoEmb)) : null
              return (
                <div key={ins._id} style={{ border: sel ? '1px solid var(--teal)' : '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', marginBottom: 8, background: sel ? 'rgba(20,184,166,0.04)' : 'var(--card-bg)', opacity: sel ? 1 : 0.5 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <input type="checkbox" checked={sel} onChange={() => toggleSel(ins._id)} />
                    <input className="field-input" style={{ flex: 1, marginBottom: 0, fontWeight: 600 }} value={ins.nome} onChange={e => upd(idx, 'nome', e.target.value)} placeholder="Nome" />
                  </div>
                  <div className="field-row" style={{ marginBottom: 6 }}>
                    <div>
                      <div className="field-label">Categoria</div>
                      <input className="field-input" list="cats-img-import" value={ins.categoria || ''} onChange={e => upd(idx, 'categoria', e.target.value)} placeholder="—" />
                    </div>
                    <div>
                      <div className="field-label">Unidade</div>
                      <select className="field-input" value={ins.unidade || 'g'} onChange={e => upd(idx, 'unidade', e.target.value)}>{UNID_OPTS.map(u => <option key={u}>{u}</option>)}</select>
                    </div>
                  </div>
                  <div className="field-row">
                    <div><div className="field-label">Qtd emb.</div><input className="field-input" type="text" inputMode="decimal" value={ins.pesoEmb || ''} onChange={e => upd(idx, 'pesoEmb', e.target.value)} placeholder="ex: 1000" /></div>
                    <div><div className="field-label">Custo (R$)</div><input className="field-input" type="text" inputMode="decimal" value={ins.custoEmb || ''} onChange={e => upd(idx, 'custoEmb', e.target.value)} placeholder="0,00" /></div>
                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                      {custoUnit !== null && <div style={{ fontSize: 11, color: 'var(--teal)', fontWeight: 600, paddingBottom: 8 }}>R$ {custoUnit.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}/{ins.unidade}</div>}
                    </div>
                  </div>
                </div>
              )
            })}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={() => { setDone(false); setFile(null); setPreview(null) }} style={{ flex: 1, padding: 12, borderRadius: 8, border: '1px solid #444', background: 'transparent', color: 'var(--text-primary)', fontSize: 14, cursor: 'pointer' }}>← Nova foto</button>
              <button className="btn-primary" style={{ flex: 2 }} disabled={salvando || !selecionados.length} onClick={handleSalvar}>
                {salvando ? 'Salvando...' : `Cadastrar ${selecionados.length} insumo(s)`}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
