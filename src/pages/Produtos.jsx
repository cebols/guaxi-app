import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import ReactCrop, { centerCrop, makeAspectCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { useAuth } from '../contexts/AuthContext'
import { ItemThumb } from '../components/ItemThumb'
import { getConfig, calcPrecos, getCustoSacolaDelivery } from '../hooks/useConfig'
import {
  getProdutos, saveProduto, deleteProduto,
  getReceitas, getEmbalagens, getInsumos, updateProdutosAtivo,
  saveUserConfig, loadUserConfig, salvarOrganizacaoCardapio, getDisponibilidade, getInteresses,
} from '../services/db'
import ProdutosCardapio, { agruparPorSecao } from '../components/ProdutosCardapio'

function recPesoBruto(rec, insumos) {
  if (!rec?.ingredientes) return 0
  return rec.ingredientes.reduce((s, i) => {
    if (i.unidade === 'g' || i.unidade === 'ml') return s + (i.quantidade || 0)
    if (i.unidade === 'kg' || i.unidade === 'L') return s + (i.quantidade || 0) * 1000
    if (i.unidade === 'un') {
      const insumo = (insumos || []).find(ins => ins.id === i.insumoId || ins.nome === i.nome)
      if (insumo?.pesoUn > 0) return s + i.quantidade * insumo.pesoUn
    }
    return s
  }, 0)
}

function recCustoForUnit(rec, unit, insumos) {
  if (!rec) return 0
  if (unit === 'g') {
    if (rec.qtdPorUnidade > 0 && rec.unidadeGera === 'un') return (rec.custoUnid || 0) / rec.qtdPorUnidade
    if (rec.pesoLiquido > 0) return (rec.custoTotal || 0) / rec.pesoLiquido
    const pesoBruto = recPesoBruto(rec, insumos)
    if (pesoBruto > 0) return (rec.custoTotal || 0) / pesoBruto
    if (rec.unidadeGera === 'g' && rec.rendimento > 0) return (rec.custoTotal || 0) / rec.rendimento
    return 0
  }
  if (unit === 'un') {
    if (rec.unidadeGera === 'un') return rec.custoUnid || 0
    return rec.custoTotal || 0
  }
  return rec.custoUnid || 0
}
import { uploadImage } from '../services/storage'
import { comprimirVideo } from '../lib/comprimirVideo'

const PLAT_COLOR  = { Direta: 'var(--teal)', '99Food': '#f59e0b', iFood: '#ef4444' }
const TIPO_LABELS = { produto: 'Produzido', avulso: 'Avulso', combo: 'Combo' }

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

function fmtR(val) {
  if (!val && val !== 0) return '—'
  const rounded = Math.ceil(Number(val) * 100) / 100
  return `R$ ${rounded.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}


// Lê duração e tira a capa (1º quadro) de um vídeo local, sem enviar nada
function lerVideo(src) {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = src
    const fim = (poster) => resolve({ duracao: Number.isFinite(v.duration) ? v.duration : 0, poster })
    const t = setTimeout(() => fim(null), 8000)
    v.onloadeddata = () => { try { v.currentTime = Math.min(0.5, (v.duration || 1) / 2) } catch { clearTimeout(t); fim(null) } }
    v.onseeked = () => {
      try {
        const esc = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight, 1))
        const c = document.createElement('canvas')
        c.width = Math.round(v.videoWidth * esc); c.height = Math.round(v.videoHeight * esc)
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
        c.toBlob(b => { clearTimeout(t); fim(b) }, 'image/jpeg', 0.85)
      } catch { clearTimeout(t); fim(null) }
    }
    v.onerror = () => { clearTimeout(t); fim(null) }
  })
}

const CROP_ASPECT = 4 / 5   // foto vertical, igual ao cartão do cardápio online

async function cropToBlob(imgEl, pixelCrop) {
  const scaleX = imgEl.naturalWidth / imgEl.width
  const scaleY = imgEl.naturalHeight / imgEl.height
  const canvas = document.createElement('canvas')
  canvas.width  = Math.round(pixelCrop.width  * scaleX)
  canvas.height = Math.round(pixelCrop.height * scaleY)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(
    imgEl,
    pixelCrop.x * scaleX, pixelCrop.y * scaleY,
    pixelCrop.width * scaleX, pixelCrop.height * scaleY,
    0, 0, canvas.width, canvas.height,
  )
  return new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92))
}

function Switch({ on }) {
  return (
    <div style={{ width: 38, height: 22, borderRadius: 11, flexShrink: 0, position: 'relative', background: on ? 'var(--teal)' : 'var(--border-color, #444)', transition: 'background .15s' }}>
      <div style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: 9, background: '#fff', transition: 'left .15s' }} />
    </div>
  )
}

const FORM_EMPTY = { nome: '', tipo: 'produto', fragilidade: 'robusto', secao: '', descricao: '', custoDireto: '', fornecedor: '', whatsapp: '', linkCompra: '', precoDireta: '', preco99: '', precoIfood: '', estoqueAtual: '', estoqueMin: '', fornada: '', margemAlvo: null, imagemUrl: '', midias: [], ativo: false }

function ProdutoForm({ item, receitas, embalagens, produtos, insumos, fornecedoresList, onSave, onDelete, onDuplicar, onClose, hasPrev, hasNext, onPrev, onNext, navLabel }) {
  const [form, setForm] = useState(item
    ? {
        nome:        item.nome,
        tipo:        item.tipo        || 'produto',
        fragilidade: item.fragilidade || 'robusto',
        secao:       item.secao       || '',
        descricao:   item.descricao   || '',
        custoDireto: item.custoDireto ?? '',
        fornecedor:  item.fornecedor  || '',
        whatsapp:    item.whatsapp    || '',
        linkCompra:  item.linkCompra  || '',
        precoDireta: item.precoDireta ?? '',
        preco99:     item.preco99     ?? '',
        precoIfood:  item.precoIfood  ?? '',
        estoqueAtual: item.estoqueAtual ?? '',
        estoqueMin:  item.estoqueMin  ?? '',
        fornada:     item.fornada     ?? '',
        margemAlvo:  item.margemAlvo ?? null,
        imagemUrl:   item.imagemUrl   || '',
        midias:      Array.isArray(item.midias) ? item.midias : (item.imagemUrl ? [{ tipo: 'imagem', url: item.imagemUrl }] : []),
        ativo:       item.ativo ?? true,
      }
    : { ...FORM_EMPTY }
  )
  const [uploadingImg, setUploadingImg] = useState(false)
  const [videoProg, setVideoProg] = useState(null) // { fase: 'comprimindo'|'enviando', pct }

  const [recRows, setRecRows] = useState(
    item?.receitas?.length > 0
      ? item.receitas.map(r => ({ receitaId: r.receitaId, nome: r.nome, quantidade: r.quantidade, unidade: r.unidade || r.unidadeGera || 'un', custoUnid: r.custoUnid }))
      : [{ receitaId: null, nome: '', quantidade: 1, unidade: 'un', custoUnid: 0 }]
  )
  const [embRows, setEmbRows] = useState(
    item?.embalagens?.length > 0
      ? item.embalagens.map(e => ({ embalagemId: e.embalagemId, nome: e.nome, quantidade: e.quantidade, custoUnit: e.custoUnit }))
      : [{ embalagemId: null, nome: '', quantidade: 1, custoUnit: 0 }]
  )
  const [comboRows, setComboRows] = useState(
    item?.componentes?.length > 0
      ? item.componentes.map(c => ({ produtoId: c.produtoId, nome: c.produtoNome, quantidade: c.quantidade, custoUnit: c.custoUnit }))
      : [{ produtoId: null, nome: '', quantidade: 1, custoUnit: 0 }]
  )
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // ── Image crop ───────────────────────────────────────────────
  const [cropSrc, setCropSrc]             = useState(null)
  const [crop, setCrop]                   = useState(null)
  const [completedCrop, setCompletedCrop] = useState(null)
  const cropImgRef = useRef(null)

  const onCropImageLoad = useCallback((e) => {
    const { width, height } = e.currentTarget
    const c = centerCrop(makeAspectCrop({ unit: '%', width: 90 }, CROP_ASPECT, width, height), width, height)
    setCrop(c)
  }, [])

  const openCrop = (file) => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setCropSrc(url)
    setCompletedCrop(null)
  }

  const confirmCrop = async () => {
    if (!cropImgRef.current || !completedCrop) return
    setUploadingImg(true)
    try {
      const blob = await cropToBlob(cropImgRef.current, completedCrop)
      const path = `produtos/${Date.now()}.jpg`
      const url = await uploadImage(path, new File([blob], 'crop.jpg', { type: 'image/jpeg' }))
      // nova foto entra na galeria do cardápio (a primeira é a capa)
      setForm(f => ({ ...f, midias: [...(f.midias || []), { tipo: 'imagem', url }] }))
      URL.revokeObjectURL(cropSrc)
      setCropSrc(null)
    } catch (e) {
      alert('Erro ao enviar imagem: ' + e.message)
    } finally {
      setUploadingImg(false)
    }
  }

  const handleImgUpload = (file) => { if (file) openCrop(file) }

  // Vídeo curto (sem som, em loop no cardápio). Gera a capa a partir do 1º quadro.
  // Qualquer vídeo do celular: comprime aqui mesmo (~540×960, sem som, até 30 s) e sobe
  const handleVideoUpload = async (file) => {
    if (!file) return
    setUploadingImg(true)
    setVideoProg({ fase: 'comprimindo', pct: 0 })
    try {
      const local = URL.createObjectURL(file)
      const { poster } = await lerVideo(local)
      URL.revokeObjectURL(local)
      const r = await comprimirVideo(file, { maxSeg: 30, onProgresso: pct => setVideoProg({ fase: 'comprimindo', pct }) })
      setVideoProg({ fase: 'enviando', pct: 1, mb: r.blob.size / 1048576, antes: file.size / 1048576 })
      const tipo = r.blob.type || file.type || 'video/mp4'
      const url = await uploadImage(`produtos/videos/${Date.now()}.${r.ext}`, new File([r.blob], `video.${r.ext}`, { type: tipo }))
      const posterUrl = poster ? await uploadImage(`produtos/${Date.now()}-poster.jpg`, new File([poster], 'poster.jpg', { type: 'image/jpeg' })) : null
      setForm(f => ({ ...f, midias: [...(f.midias || []), { tipo: 'video', url, poster: posterUrl }] }))
      if (r.cortou) alert('O vídeo passou de 30 s — ficaram só os primeiros 30 s.')
    } catch (e) {
      alert('Erro no vídeo: ' + e.message)
    } finally {
      setUploadingImg(false)
      setVideoProg(null)
    }
  }
  const moverMidia = (i, d) => setForm(f => {
    const m = [...(f.midias || [])]; const j = i + d
    if (j < 0 || j >= m.length) return f
    ;[m[i], m[j]] = [m[j], m[i]]
    return { ...f, midias: m }
  })
  const removerMidia = (i) => setForm(f => ({ ...f, midias: (f.midias || []).filter((_, k) => k !== i) }))
  const capaDe = (m) => { const c = (m || [])[0]; return c ? (c.tipo === 'video' ? (c.poster || '') : c.url) : '' }
  const temFluxo = !!item?.prontidao?.fluxo && item.prontidao.fluxo !== 'nenhum'

  const isAvulso = form.tipo === 'avulso'
  const isCombo  = form.tipo === 'combo'

  // ── Receita rows ────────────────────────────────────────────
  const handleRecSelect = (i, nome) => {
    const rec = receitas?.find(r => r.nome === nome)
    const unit = rec?.unidadeGera || 'un'
    setRecRows(prev => prev.map((row, idx) => idx === i ? { ...row, nome, receitaId: rec?.id ?? null, custoUnid: recCustoForUnit(rec, unit, insumos), unidade: unit } : row))
  }
  const setRecUnit = (i, unit) => {
    setRecRows(prev => prev.map((row, idx) => {
      if (idx !== i) return row
      const rec = receitas?.find(r => r.id === row.receitaId)
      return { ...row, unidade: unit, custoUnid: recCustoForUnit(rec, unit, insumos) }
    }))
  }
  const setRecField = (i, k, v) => setRecRows(prev => prev.map((row, idx) => idx === i ? { ...row, [k]: v } : row))

  // Custo recalculado sempre que receitas/insumos mudam (mantem o produto atualizado)
  const recRowsLive = useMemo(() => recRows.map(row => {
    const rec = receitas?.find(r => r.id === row.receitaId)
    if (!rec) return row
    return { ...row, custoUnid: recCustoForUnit(rec, row.unidade, insumos) }
  }), [recRows, receitas, insumos])
  const addRec    = () => setRecRows(prev => [...prev, { receitaId: null, nome: '', quantidade: 1, unidade: 'un', custoUnid: 0 }])
  const removeRec = i  => setRecRows(prev => prev.filter((_, idx) => idx !== i))

  // ── Embalagem rows ──────────────────────────────────────────
  const handleEmbSelect = (i, nome) => {
    const emb = embalagens?.find(e => e.nome === nome)
    setEmbRows(prev => prev.map((row, idx) => idx === i ? { ...row, nome, embalagemId: emb?.id ?? null, custoUnit: emb?.custoUnit || 0 } : row))
  }
  const setEmbField = (i, k, v) => setEmbRows(prev => prev.map((row, idx) => idx === i ? { ...row, [k]: v } : row))
  const addEmb    = () => setEmbRows(prev => [...prev, { embalagemId: null, nome: '', quantidade: 1, custoUnit: 0 }])
  const removeEmb = i  => setEmbRows(prev => prev.filter((_, idx) => idx !== i))

  // ── Combo rows ──────────────────────────────────────────────
  const handleComboSelect = (i, nome) => {
    const prod = produtos?.find(p => p.nome === nome && p.id !== item?.id)
    setComboRows(prev => prev.map((row, idx) => idx === i ? { ...row, nome, produtoId: prod?.id ?? null, custoUnit: prod?.custoTotal || 0 } : row))
  }
  const setComboField = (i, k, v) => setComboRows(prev => prev.map((row, idx) => idx === i ? { ...row, [k]: v } : row))
  const addCombo    = () => setComboRows(prev => [...prev, { produtoId: null, nome: '', quantidade: 1, custoUnit: 0 }])
  const removeCombo = i  => setComboRows(prev => prev.filter((_, idx) => idx !== i))

  // ── Custo total ─────────────────────────────────────────────
  const custoTotal = useMemo(() => {
    if (isAvulso) return parseFloat(form.custoDireto) || 0
    if (isCombo)  return comboRows.reduce((s, r) => s + (r.custoUnit || 0) * (parseFloat(r.quantidade) || 1), 0)
    const rec = recRowsLive.reduce((s, r) => s + (r.custoUnid || 0) * (parseFloat(r.quantidade) || 1), 0)
    const emb = embRows.reduce((s, e) => s + (e.custoUnit || 0) * (parseFloat(e.quantidade) || 1), 0)
    return rec + emb
  }, [form.custoDireto, recRowsLive, embRows, comboRows, isAvulso, isCombo])

  const cfg         = getConfig()
  const sacolaDelivery = getCustoSacolaDelivery(cfg, embalagens || [])
  const precos      = calcPrecos(custoTotal, cfg, sacolaDelivery, form.margemAlvo)
  const margemGlobal = cfg.margem || 0
  const margemEfetiva = form.margemAlvo != null && form.margemAlvo !== '' ? parseFloat(form.margemAlvo) : margemGlobal
  // custo total ajustado p/ cálculo de lucro real por canal (inclui rateio + fator desperdício)
  const custoComRateio = (precos.custoAjustado || custoTotal) + (precos.rateio || 0)

  const platFields = [
    { key: 'precoDireta', label: 'Direta',  sub: 'Venda própria', sugerido: precos.base,   taxa: 0,                      sacola: 0,              color: PLAT_COLOR.Direta    },
    { key: 'preco99',     label: '99Food',  sub: `taxa ${cfg.taxa99 || 0}%`,  sugerido: precos.p99,    taxa: (cfg.taxa99 || 0) / 100,    sacola: sacolaDelivery, color: PLAT_COLOR['99Food'] },
    { key: 'precoIfood',  label: 'iFood',   sub: `taxa ${cfg.taxaIfood || 0}%`, sugerido: precos.pIfood, taxa: (cfg.taxaIfood || 0) / 100, sacola: sacolaDelivery, color: PLAT_COLOR.iFood     },
  ]

  // Lucro líquido + margem por canal a partir do preço praticado (ou sugerido)
  const calcPlat = (p) => {
    const preco = parseFloat(String(form[p.key]).replace(',', '.')) || p.sugerido
    const lucro = preco * (1 - p.taxa) - custoComRateio - p.sacola
    const margem = preco ? (lucro / preco) * 100 : 0
    const tone = margem >= 50 ? '#22b886' : margem >= 30 ? '#f0b429' : '#f07070'
    return { preco, lucro, margem, tone, usandoSug: !String(form[p.key]).trim() }
  }

  const autoSaveTimer = useRef(null)
  const [autoSaved, setAutoSaved] = useState(false)

  const buildSavePayload = () => {
    const recItems    = isAvulso || isCombo ? [] : recRowsLive.filter(r => r.receitaId)
    const embItems    = isAvulso || isCombo ? [] : embRows.filter(e => e.embalagemId)
    const componentes = isCombo ? comboRows.filter(r => r.produtoId) : []
    const midias = form.midias || []
    return [{
      ...form, id: item?.id, precoSugerido: precos.base, componentes, midias,
      imagemUrl: capaDe(midias),                                   // capa = 1ª mídia
      ...(temFluxo ? { estoqueAtual: undefined } : {}),            // estoque vem do Prontidão
    }, recItems, embItems]
  }

  const doSilentSave = async () => {
    if (!form.nome || !item?.id) return
    try { await onSave(...buildSavePayload()); setAutoSaved(true); setTimeout(() => setAutoSaved(false), 1500) }
    catch (_) {}
  }

  const schedulePriceAutoSave = () => {
    if (!item?.id) return
    clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(doSilentSave, 700)
  }

  const handle = async () => {
    if (!form.nome) return
    clearTimeout(autoSaveTimer.current)
    setSaving(true)
    try {
      await onSave(...buildSavePayload())
      onClose()
    } catch (e) { alert(e.message) } finally { setSaving(false) }
  }

  const handleNav = (navFn) => {
    clearTimeout(autoSaveTimer.current)
    if (item?.id && form.nome) doSilentSave()
    navFn()
  }

  const blockStyle = {
    background: 'var(--bg-card)', borderRadius: 12,
    border: '0.5px solid var(--border-light-color)',
    padding: 14, marginBottom: 8,
  }
  const blockTitle = {
    fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)',
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10,
  }
  const fieldLabel = {
    fontSize: 10, color: 'var(--text-secondary)', fontWeight: 600,
    marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em',
  }

  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div style={{
        position: 'fixed', inset: 0, zIndex: 120,
        background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 16px 12px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '0.5px solid var(--border-light-color)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M12 4l-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>
              {item ? 'Editar produto' : 'Novo produto'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {(hasPrev || hasNext) && (
              <>
                <button onClick={() => handleNav(onPrev)} disabled={!hasPrev} style={{ background: 'none', border: 'none', cursor: hasPrev ? 'pointer' : 'default', padding: '4px 6px', display: 'flex', alignItems: 'center', color: hasPrev ? 'var(--text-secondary)' : 'var(--border)', borderRadius: 6 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
                {navLabel && <span style={{ fontSize: 11, color: 'var(--text-tertiary)', minWidth: 36, textAlign: 'center' }}>{navLabel}</span>}
                <button onClick={() => handleNav(onNext)} disabled={!hasNext} style={{ background: 'none', border: 'none', cursor: hasNext ? 'pointer' : 'default', padding: '4px 6px', display: 'flex', alignItems: 'center', color: hasNext ? 'var(--text-secondary)' : 'var(--border)', borderRadius: 6 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              </>
            )}
            <button onClick={handle} disabled={saving || !form.nome} style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              fontSize: 14, fontWeight: 600, color: saving || !form.nome ? 'var(--text-tertiary)' : autoSaved ? '#4ade80' : 'var(--teal)',
              transition: 'color 0.3s',
            }}>
              {saving ? 'Salvando…' : autoSaved ? '✓ Salvo' : 'Salvar'}
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 100px', WebkitOverflowScrolling: 'touch' }}>
         <div className="form-grid">
          <div className="form-grid-main">

          {/* Block 1: Identidade */}
          <div style={blockStyle}>
            <div style={blockTitle}>Identidade</div>

            {/* Foto + Nome */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <ItemThumb url={capaDe(form.midias) || form.imagemUrl} nome={form.nome || '?'} size={56} radius={10} />
                <label style={{
                  position: 'absolute', inset: 0, borderRadius: 10, cursor: 'pointer',
                  background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16,
                }}>
                  {uploadingImg ? '⏳' : '📷'}
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handleImgUpload(e.target.files[0])} />
                </label>
              </div>
              <div style={{ flex: 1 }}>
                <div style={fieldLabel}>Nome *</div>
                <input className="field-input" style={{ marginBottom: 0 }} placeholder="ex: Choux Craquelin" value={form.nome} onChange={e => set('nome', e.target.value)} />
              </div>
            </div>

            {/* Fotos e vídeos do cardápio online */}
            <div style={{ marginBottom: 12 }}>
              <div style={fieldLabel}>Fotos e vídeos do cardápio <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· a 1ª é a capa</span></div>
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
                {(form.midias || []).map((m, i) => (
                  <div key={m.url + i} style={{ width: 72, flexShrink: 0 }}>
                    <div style={{ position: 'relative', width: 72, height: 90, borderRadius: 9, overflow: 'hidden', background: 'var(--bg-input)', border: i === 0 ? '2px solid var(--teal)' : '1px solid var(--border-light-color)' }}>
                      {m.tipo === 'video'
                        ? (m.poster ? <img src={m.poster} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <video src={m.url} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />)
                        : <img src={m.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                      {m.tipo === 'video' && <span style={{ position: 'absolute', top: 4, left: 4, fontSize: 9, fontWeight: 800, background: 'rgba(0,0,0,.6)', color: '#fff', borderRadius: 5, padding: '1px 5px' }}>▶</span>}
                      {i === 0 && <span style={{ position: 'absolute', bottom: 4, left: 4, fontSize: 9, fontWeight: 800, background: 'var(--teal)', color: '#fff', borderRadius: 5, padding: '1px 5px' }}>capa</span>}
                      <button onClick={() => removerMidia(i)} aria-label="Remover" style={{ position: 'absolute', top: 3, right: 3, width: 20, height: 20, borderRadius: 10, border: 'none', background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 12, cursor: 'pointer', lineHeight: 1 }}>×</button>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                      <button onClick={() => moverMidia(i, -1)} disabled={i === 0} style={{ background: 'none', border: 'none', color: i === 0 ? 'var(--text-tertiary)' : 'var(--text-secondary)', cursor: 'pointer', fontSize: 14, padding: '0 6px' }}>‹</button>
                      <button onClick={() => moverMidia(i, 1)} disabled={i === form.midias.length - 1} style={{ background: 'none', border: 'none', color: i === form.midias.length - 1 ? 'var(--text-tertiary)' : 'var(--text-secondary)', cursor: 'pointer', fontSize: 14, padding: '0 6px' }}>›</button>
                    </div>
                  </div>
                ))}
                <label style={{ width: 72, height: 90, flexShrink: 0, borderRadius: 9, border: '1px dashed var(--teal)', color: 'var(--teal)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  <span style={{ fontSize: 18 }}>📷</span>+ Foto
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { handleImgUpload(e.target.files[0]); e.target.value = '' }} />
                </label>
                <label style={{ width: 72, height: 90, flexShrink: 0, borderRadius: 9, border: '1px dashed var(--teal)', color: 'var(--teal)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  <span style={{ fontSize: 18 }}>{uploadingImg ? '⏳' : '🎬'}</span>+ Vídeo
                  <input type="file" accept="video/*" disabled={uploadingImg} style={{ display: 'none' }} onChange={e => { handleVideoUpload(e.target.files[0]); e.target.value = '' }} />
                </label>
              </div>
              {videoProg ? (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    <span>{videoProg.fase === 'comprimindo' ? '🎬 Comprimindo vídeo… deixe esta tela aberta' : `⬆ Enviando (${videoProg.mb.toFixed(1).replace('.', ',')} MB${videoProg.antes > videoProg.mb * 1.2 ? `, era ${videoProg.antes.toFixed(0)} MB` : ''})…`}</span>
                    {videoProg.fase === 'comprimindo' && <b>{Math.round(videoProg.pct * 100)}%</b>}
                  </div>
                  <div style={{ height: 5, borderRadius: 3, background: 'var(--bg-input)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.round(videoProg.pct * 100)}%`, background: 'var(--teal)', transition: 'width .3s' }} />
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>Pode mandar o vídeo direto do celular — o app comprime e corta em 30 s. Toca sem som e em loop no cardápio. Salve o produto pra publicar.</div>
              )}
            </div>

            {/* No cardápio */}
            <div onClick={() => set('ativo', !form.ativo)} style={{
              display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, padding: '10px 12px',
              borderRadius: 8, cursor: 'pointer', background: 'var(--bg-input)',
              border: `0.5px solid ${form.ativo ? 'var(--teal)' : 'var(--border-light-color)'}`,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: form.ativo ? 'var(--teal)' : 'var(--text-primary)' }}>No cardápio</div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>
                  {form.ativo ? 'Aparece na contagem, no planejamento e no link de pedido' : 'Pontual: só pedido manual, fora da contagem e do planejamento'}
                </div>
              </div>
              <Switch on={form.ativo} />
            </div>

            {/* Seção */}
            <div style={{ marginBottom: 10 }}>
              <div style={fieldLabel}>Seção do cardápio</div>
              <input
                className="field-input"
                style={{ marginBottom: 0 }}
                list="secoes-list"
                placeholder="ex: Bolos, Tortas, Doces…"
                value={form.secao}
                onChange={e => set('secao', e.target.value)}
              />
              <datalist id="secoes-list">
                {[...new Set((produtos || []).map(p => p.secao).filter(Boolean))].map(s => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>

            {/* Tipo segmented */}
            <div style={{ marginBottom: 10 }}>
              <div style={fieldLabel}>Tipo</div>
              <div style={{ display: 'flex', background: 'var(--bg-input)', borderRadius: 8, padding: 2, border: '0.5px solid var(--border-light-color)' }}>
                {Object.entries(TIPO_LABELS).map(([val, label]) => (
                  <div key={val} onClick={() => set('tipo', val)} style={{
                    flex: 1, padding: '7px 0', borderRadius: 6, textAlign: 'center',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    background: form.tipo === val ? 'var(--teal)' : 'transparent',
                    color: form.tipo === val ? '#fff' : 'var(--text-tertiary)',
                    transition: 'all .15s ease',
                  }}>{label}</div>
                ))}
              </div>
            </div>

            {/* Fragilidade segmented — define o veículo na entrega */}
            <div style={{ marginBottom: 10 }}>
              <div style={fieldLabel}>Fragilidade (entrega)</div>
              <div style={{ display: 'flex', background: 'var(--bg-input)', borderRadius: 8, padding: 2, border: '0.5px solid var(--border-light-color)' }}>
                {[['robusto', '📦 Robusto · moto'], ['fragil', '🍰 Frágil · carro']].map(([val, label]) => (
                  <div key={val} onClick={() => set('fragilidade', val)} style={{
                    flex: 1, padding: '7px 0', borderRadius: 6, textAlign: 'center',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    background: form.fragilidade === val ? 'var(--teal)' : 'transparent',
                    color: form.fragilidade === val ? '#fff' : 'var(--text-tertiary)',
                    transition: 'all .15s ease',
                  }}>{label}</div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                Frágil força carro na viagem (estabilidade/refrigeração); robusto pode ir de moto.
              </div>
            </div>

            {/* Descrição */}
            <div>
              <div style={fieldLabel}>Descrição</div>
              <textarea
                className="field-input"
                rows={2}
                style={{ resize: 'vertical', lineHeight: 1.5, marginBottom: 0 }}
                placeholder="ex: Recheado com creme de baunilha…"
                value={form.descricao}
                onChange={e => set('descricao', e.target.value)}
              />
            </div>
          </div>

          {/* Block 2: Composição */}
          <div style={blockStyle}>
            <div style={blockTitle}>Composição</div>

            {/* Avulso */}
            {isAvulso && (
              <>
                <div style={{ marginBottom: 10 }}>
                  <div style={fieldLabel}>Custo de aquisição (R$/un)</div>
                  <input className="field-input" style={{ marginBottom: 0 }} type="text" inputMode="decimal" placeholder="ex: 3.50"
                    value={form.custoDireto} onChange={e => set('custoDireto', e.target.value)} />
                </div>
                <div style={{ marginBottom: 10 }}>
                  <div style={fieldLabel}>Fornecedor</div>
                  <input className="field-input" style={{ marginBottom: 0 }} list="forn-prod-list" placeholder="Nome do fornecedor" value={form.fornecedor}
                    onChange={e => {
                      const v = e.target.value
                      set('fornecedor', v)
                      const match = (fornecedoresList || []).find(f => f.nome === v)
                      if (match) set('whatsapp', match.whatsapp || '')
                    }} />
                  <datalist id="forn-prod-list">{(fornecedoresList || []).map(f => <option key={f.nome} value={f.nome} />)}</datalist>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={fieldLabel}>WhatsApp</div>
                    <input className="field-input" style={{ marginBottom: 0 }} placeholder="11 99999-9999" value={form.whatsapp} onChange={e => set('whatsapp', e.target.value)} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={fieldLabel}>Link de compra</div>
                    <input className="field-input" style={{ marginBottom: 0 }} placeholder="https://..." value={form.linkCompra} onChange={e => set('linkCompra', e.target.value)} />
                  </div>
                </div>
              </>
            )}

            {/* Combo */}
            {isCombo && (
              <>
                <div style={fieldLabel}>Componentes do combo</div>
                {comboRows.map((row, i) => {
                  const lineCost = (row.custoUnit || 0) * (parseFloat(row.quantidade) || 1)
                  return (
                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '7px 0', borderBottom: i < comboRows.length - 1 ? '0.5px solid var(--border-light-color)' : 'none' }}>
                      <input className="field-input" style={{ flex: 1, marginBottom: 0, fontSize: 13 }}
                        list="combo-prod-list" placeholder="Produto" value={row.nome}
                        onChange={e => handleComboSelect(i, e.target.value)} />
                      <span style={{ width: 56, textAlign: 'right', fontSize: 12, fontWeight: 700, color: lineCost > 0 ? 'var(--teal)' : 'var(--text-tertiary)', flexShrink: 0 }}>{lineCost > 0 ? fmtR(lineCost) : '—'}</span>
                      <input className="item-qty" type="text" inputMode="decimal" placeholder="Qtd"
                        value={row.quantidade} onChange={e => setComboField(i, 'quantidade', e.target.value)} />
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)', width: 28, flexShrink: 0 }}>un</span>
                      {comboRows.length > 1 && <button className="item-rm" onClick={() => removeCombo(i)}>&#215;</button>}
                    </div>
                  )
                })}
                <datalist id="combo-prod-list">{(produtos || []).filter(p => p.id !== item?.id).map(p => <option key={p.id} value={p.nome} />)}</datalist>
                <button className="btn-add-item" style={{ marginTop: 6 }} onClick={addCombo}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 3v8M3 7h8" stroke="var(--teal)" strokeWidth="1.4" strokeLinecap="round"/></svg>
                  Adicionar produto
                </button>
              </>
            )}

            {/* Produzido: receitas + embalagens */}
            {!isAvulso && !isCombo && (
              <>
                <div style={fieldLabel}>Receitas</div>
                {recRowsLive.map((row, i) => {
                  const lineCost = (row.custoUnid || 0) * (parseFloat(row.quantidade) || 1)
                  return (
                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '7px 0', borderBottom: i < recRows.length - 1 ? '0.5px solid var(--border-light-color)' : 'none' }}>
                      <input className="field-input" style={{ flex: 1, marginBottom: 0, fontSize: 13 }}
                        list="receitas-list" placeholder="Receita" value={row.nome} onChange={e => handleRecSelect(i, e.target.value)} />
                      <span style={{ width: 56, textAlign: 'right', fontSize: 12, fontWeight: 700, color: lineCost > 0 ? 'var(--teal)' : 'var(--text-tertiary)', flexShrink: 0 }}>{lineCost > 0 ? fmtR(lineCost) : '—'}</span>
                      <input className="item-qty" type="text" inputMode="decimal" placeholder="Qtd"
                        value={row.quantidade} onChange={e => setRecField(i, 'quantidade', e.target.value)} />
                      <select className="item-qty" style={{ width: 48, fontSize: 12, padding: '0 2px' }}
                        value={row.unidade} onChange={e => setRecUnit(i, e.target.value)}>
                        <option value="un">un</option>
                        <option value="g">g</option>
                      </select>
                      {recRows.length > 1 && <button className="item-rm" onClick={() => removeRec(i)}>&#215;</button>}
                    </div>
                  )
                })}
                <datalist id="receitas-list">{(receitas || []).map(r => <option key={r.id} value={r.nome} />)}</datalist>
                <button className="btn-add-item" style={{ marginTop: 6 }} onClick={addRec}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 3v8M3 7h8" stroke="var(--teal)" strokeWidth="1.4" strokeLinecap="round"/></svg>
                  Adicionar receita
                </button>
                {recRowsLive.some(r => r.receitaId) && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 8, borderTop: '0.5px solid var(--border-light-color)' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>Subtotal receitas</span>
                    <span style={{ fontSize: 14, color: 'var(--teal)', fontWeight: 700 }}>{fmtR(recRowsLive.reduce((s, r) => s + (r.custoUnid || 0) * (parseFloat(r.quantidade) || 1), 0))}</span>
                  </div>
                )}

                <div style={{ ...fieldLabel, marginTop: 14 }}>Embalagens</div>
                {embRows.map((row, i) => {
                  const lineCost = (row.custoUnit || 0) * (parseFloat(row.quantidade) || 1)
                  return (
                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '7px 0', borderBottom: i < embRows.length - 1 ? '0.5px solid var(--border-light-color)' : 'none' }}>
                      <input className="field-input" style={{ flex: 1, marginBottom: 0, fontSize: 13 }}
                        list="embalagens-list" placeholder="Embalagem" value={row.nome} onChange={e => handleEmbSelect(i, e.target.value)} />
                      <span style={{ width: 56, textAlign: 'right', fontSize: 12, fontWeight: 700, color: lineCost > 0 ? 'var(--teal)' : 'var(--text-tertiary)', flexShrink: 0 }}>{lineCost > 0 ? fmtR(lineCost) : '—'}</span>
                      <input className="item-qty" type="text" inputMode="decimal" placeholder="Qtd"
                        value={row.quantidade} onChange={e => setEmbField(i, 'quantidade', e.target.value)} />
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)', width: 28, flexShrink: 0 }}>un</span>
                      {embRows.length > 1 && <button className="item-rm" onClick={() => removeEmb(i)}>&#215;</button>}
                    </div>
                  )
                })}
                <datalist id="embalagens-list">{(embalagens || []).map(e => <option key={e.id} value={e.nome} />)}</datalist>
                <button className="btn-add-item" style={{ marginTop: 6 }} onClick={addEmb}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 3v8M3 7h8" stroke="var(--teal)" strokeWidth="1.4" strokeLinecap="round"/></svg>
                  Adicionar embalagem
                </button>
                {embRows.some(e => e.embalagemId) && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 8, borderTop: '0.5px solid var(--border-light-color)' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>Subtotal embalagens</span>
                    <span style={{ fontSize: 14, color: 'var(--teal)', fontWeight: 700 }}>{fmtR(embRows.reduce((s, e) => s + (e.custoUnit || 0) * (parseFloat(e.quantidade) || 1), 0))}</span>
                  </div>
                )}
              </>
            )}
          </div>
          </div>{/* /form-grid-main */}

          <div className="form-grid-rail">
          {/* Block 3: Preços e Estoque */}
          <div style={blockStyle}>
            <div style={blockTitle}>Preços e Estoque</div>

            {/* Custo total + breakdown */}
            <div style={{
              padding: '10px 12px', borderRadius: 10, background: 'var(--teal-light)',
              border: '0.5px solid rgba(34,184,134,0.13)', marginBottom: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Custo total</span>
                <span style={{ fontSize: 18, color: 'var(--teal)', fontWeight: 700 }}>
                  {custoComRateio > 0 ? fmtR(custoComRateio) : '—'}
                </span>
              </div>
              {custoTotal > 0 && (
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>
                  {isAvulso
                    ? `Item ${fmtR(custoTotal)} · rateio ${fmtR(precos.rateio || 0)}`
                    : `Insumos ${fmtR(custoTotal)} · rateio ${fmtR(precos.rateio || 0)}`}
                  {(precos.custoAjustado > custoTotal) ? ` · desperdício +${fmtR(precos.custoAjustado - custoTotal)}` : ''}
                </div>
              )}

              {/* Margem-alvo segmented */}
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Margem-alvo</span>
                  <span style={{ fontSize: 11, color: 'var(--teal)', fontWeight: 700 }}>
                    {margemEfetiva}%{form.margemAlvo == null ? ' (global)' : ''}
                  </span>
                </div>
                <div style={{ display: 'flex', background: 'var(--bg-secondary)', borderRadius: 9, padding: 3, gap: 2 }}>
                  {[{ v: null, lab: 'Global' }, { v: 50 }, { v: 55 }, { v: 60 }, { v: 65 }, { v: 70 }].map(({ v, lab }) => {
                    const active = form.margemAlvo == null ? v == null : parseFloat(form.margemAlvo) === v
                    return (
                      <div key={lab || v} onClick={() => { set('margemAlvo', v); schedulePriceAutoSave() }} style={{
                        flex: 1, padding: '7px 0', borderRadius: 6, textAlign: 'center',
                        fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        background: active ? 'var(--teal)' : 'transparent',
                        color: active ? '#06140e' : 'var(--text-secondary)', transition: 'all .15s',
                      }}>{lab || v}</div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Preço por canal — lucro + margem */}
            <div style={{ ...fieldLabel, marginBottom: 4 }}>Preço por canal</div>
            {platFields.map((p) => {
              const c = calcPlat(p)
              return (
                <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: '0.5px solid var(--border-light-color)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{p.label}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{p.sub}</span>
                    </div>
                    {custoTotal > 0 && (
                      <div style={{ fontSize: 11, color: c.tone, fontWeight: 600, marginTop: 3 }}>
                        Lucro {fmtR(c.lucro)} <span style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>· {c.margem.toFixed(0)}% margem</span>
                      </div>
                    )}
                  </div>
                  <div style={{ width: 96, flexShrink: 0 }}>
                    <input className="field-input" type="text" inputMode="decimal"
                      placeholder={custoTotal > 0 ? p.sugerido.toFixed(2).replace('.', ',') : '—'}
                      value={form[p.key]} onChange={e => { set(p.key, e.target.value); schedulePriceAutoSave() }}
                      style={{ fontSize: 14, fontWeight: 600, textAlign: 'center', marginBottom: 0 }} />
                    {custoTotal > 0 && (
                      <div style={{ fontSize: 9, color: c.usandoSug ? p.color : 'var(--text-tertiary)', textAlign: 'center', marginTop: 2 }}>
                        {c.usandoSug ? 'usando sugerido' : `sug. ${p.sugerido.toFixed(2).replace('.', ',')}`}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Estoque atual e mínimo */}
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Estoque atual{temFluxo ? ' · conte no Prontidão' : ''}</span>
              <input type="text" inputMode="decimal"
                placeholder="—"
                value={form.estoqueAtual}
                disabled={temFluxo}
                onChange={e => set('estoqueAtual', e.target.value)}
                style={{
                  padding: '6px 14px', borderRadius: 6, background: 'var(--bg-input)',
                  border: '0.5px solid var(--border-light-color)', fontSize: 14, color: 'var(--text-primary)',
                  fontWeight: 600, width: 64, textAlign: 'center',
                }} />
            </div>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Estoque mínimo</span>
              <input type="text" inputMode="decimal"
                placeholder="—"
                value={form.estoqueMin}
                onChange={e => set('estoqueMin', e.target.value)}
                style={{
                  padding: '6px 14px', borderRadius: 6, background: 'var(--bg-input)',
                  border: '0.5px solid var(--border-light-color)', fontSize: 14, color: 'var(--text-primary)',
                  fontWeight: 600, width: 64, textAlign: 'center',
                }} />
            </div>
            {form.tipo !== 'combo' && (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Fornada (un)</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Quanto sai numa produção — já vem assim no planejamento</div>
                </div>
                <input type="text" inputMode="numeric"
                  placeholder="—"
                  value={form.fornada}
                  onChange={e => set('fornada', e.target.value.replace(/\D/g, ''))}
                  style={{
                    padding: '6px 14px', borderRadius: 6, background: 'var(--bg-input)',
                    border: '0.5px solid var(--border-light-color)', fontSize: 14, color: 'var(--text-primary)',
                    fontWeight: 600, width: 64, textAlign: 'center', flexShrink: 0,
                  }} />
              </div>
            )}
          </div>
          </div>{/* /form-grid-rail */}
         </div>{/* /form-grid */}

          {/* Delete */}
          {item && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 28, padding: '16px 0' }}>
              {onDuplicar && (
                <button onClick={() => onDuplicar(item).then(onClose)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
                  ⎘ Duplicar
                </button>
              )}
              <button
                onClick={() => { if (confirm('Excluir produto?')) onDelete(item.id).then(onClose).catch(e => alert(e.message)) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--alert-text)', opacity: 0.75 }}
              >
                Excluir produto
              </button>
            </div>
          )}
        </div>

        {/* Crop modal */}
        {cropSrc && (
          <>
            <div onClick={() => setCropSrc(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', zIndex: 200 }} />
            <div style={{
              position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
              zIndex: 201, background: 'var(--bg-card)', borderRadius: 16, padding: 20,
              width: 'min(480px, 95vw)', maxHeight: '90dvh', overflow: 'auto',
            }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Recortar imagem (4:3)</div>
              <ReactCrop crop={crop} onChange={c => setCrop(c)} onComplete={(px) => setCompletedCrop(px)} aspect={CROP_ASPECT} style={{ maxWidth: '100%' }}>
                <img ref={cropImgRef} src={cropSrc} onLoad={onCropImageLoad} style={{ maxWidth: '100%', maxHeight: '60dvh', display: 'block' }} alt="crop" />
              </ReactCrop>
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button onClick={() => setCropSrc(null)} style={{ flex: 1, padding: 11, borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>Cancelar</button>
                <button onClick={confirmCrop} disabled={!completedCrop || uploadingImg} style={{ flex: 2, padding: 11, borderRadius: 10, border: 'none', background: 'var(--teal)', color: '#000', cursor: 'pointer', fontWeight: 700, fontSize: 14, opacity: (!completedCrop || uploadingImg) ? 0.5 : 1 }}>
                  {uploadingImg ? 'Salvando…' : 'Cortar e salvar'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}


function PlatPrecos({ prod, cfg, custoSacola }) {
  const precos = calcPrecos(prod.custoTotal, cfg, custoSacola)
  return (
    <span>
      <span style={{ color: PLAT_COLOR['99Food'] }}>99 {fmtR(prod.preco99 ?? precos.p99)}</span>
      {' · '}
      <span style={{ color: PLAT_COLOR.iFood }}>iF {fmtR(prod.precoIfood ?? precos.pIfood)}</span>
    </span>
  )
}

export default function Produtos() {
  const navigate              = useNavigate()
  const [sheet, setSheet]     = useState(null)
  const location              = useLocation()

  useEffect(() => {
    if (location.state?.openNew) {
      setSheet({ type: 'produto' })
    }
  }, [])
  const { toast, show }       = useToast()
  const { user }              = useAuth()
  const cfg                   = getConfig()

  const { data: produtos,   loading: lProd, reload: rProd } = useData(getProdutos)
  const { data: receitas,   loading: lRec  } = useData(getReceitas)
  const { data: embalagens, loading: lEmb  } = useData(getEmbalagens)
  const { data: insumos } = useData(getInsumos)
  const loading = lProd || lRec || lEmb
  const custoSacola = getCustoSacolaDelivery(cfg, embalagens || [])

  const fornecedoresList = useMemo(() => {
    const map = {}
    const addForn = (nome, whatsapp) => {
      if (nome && !map[nome]) map[nome] = { nome, whatsapp: whatsapp || '' }
    }
    ;(insumos    || []).forEach(i => addForn(i.fornecedor, i.whatsapp))
    ;(embalagens || []).forEach(e => addForn(e.fornecedor, e.whatsapp))
    ;(produtos   || []).filter(p => p.tipo === 'avulso').forEach(p => addForn(p.fornecedor, p.whatsapp))
    return Object.values(map).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [insumos, embalagens, produtos])

  const { data: interesses } = useData(getInteresses)
  const querem = useMemo(() => {
    const m = {}
    for (const i of (interesses || [])) m[i.produtoId] = (m[i.produtoId] || 0) + 1
    return m
  }, [interesses])
  const [disp, setDisp] = useState(null)
  useEffect(() => { if (user?.id) getDisponibilidade(user.id).then(setDisp).catch(() => {}) }, [user?.id, produtos])
  const lojaUrl = `${window.location.origin}/pedido/${user?.id}`
  const compartilhar = () => {
    if (navigator.share) { navigator.share({ title: 'Guaxí Pâtisserie', url: lojaUrl }).catch(() => {}); return }
    navigator.clipboard.writeText(lojaUrl).then(() => show('Link do cardápio copiado!')).catch(() => show(lojaUrl))
  }


  const [secoesOrdem, setSecoesOrdem] = useState([])
  // ordem de navegação do formulário (‹ ›) = ordem da lista
  const produtosFiltrados = useMemo(() => {
    const ps = produtos || []
    const nome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR')
    return [
      ...agruparPorSecao(ps.filter(p => p.tipo !== 'combo' && p.ativo !== false), secoesOrdem).flatMap(g => g.itens),
      ...ps.filter(p => p.tipo !== 'combo' && p.ativo === false).sort(nome),
      ...ps.filter(p => p.tipo === 'combo').sort(nome),
    ]
  }, [produtos, secoesOrdem])

  useEffect(() => {
    loadUserConfig().then(cfg => { if (cfg?.secoesOrdem) setSecoesOrdem(cfg.secoesOrdem) }).catch(() => {})
  }, [])

  const handleSave = async (prod, recItems, embItems) => {
    await saveProduto(prod, recItems, embItems)
    rProd()
    show('Salvo!')
  }
  const handleDelete = async (id) => {
    await deleteProduto(id)
    rProd()
    show('Excluído!')
  }

  const handleToggleAtivo = async (prod, ativo) => {
    try {
      await updateProdutosAtivo([{ id: prod.id, ativo }])
      await rProd()
      show(ativo ? `${prod.nome} no cardápio` : `${prod.nome} saiu do cardápio`)
    } catch (e) { alert('Erro: ' + e.message) }
  }

  const handleSalvarOrganizacao = async (ordem, itens) => {
    const cfg = await loadUserConfig()
    await saveUserConfig({ ...(cfg || {}), secoesOrdem: ordem })
    setSecoesOrdem(ordem)
    try {
      await salvarOrganizacaoCardapio(itens)
    } finally { rProd() }
    show('Cardápio organizado!')
  }
  const handleDuplicar = async (prod) => {
    try {
      const recItems = (prod.receitas || []).map(r => ({
        receitaId: r.receitaId, nome: r.nome, quantidade: r.quantidade,
        unidade: r.unidadeGera || 'un', custoUnid: r.custoUnid,
      }))
      const embItems = (prod.embalagens || []).map(em => ({
        embalagemId: em.embalagemId, nome: em.nome, quantidade: em.quantidade, custoUnit: em.custoUnit,
      }))
      const componentes = (prod.componentes || []).map(c => ({
        produtoId: c.produtoId, produtoNome: c.produtoNome, quantidade: c.quantidade, custoUnit: c.custoUnit,
      }))
      await saveProduto({
        nome: `${prod.nome} (cópia)`,
        tipo: prod.tipo,
        fragilidade: prod.fragilidade,
        custoDireto: prod.custoDireto,
        fornecedor: prod.fornecedor, whatsapp: prod.whatsapp, linkCompra: prod.linkCompra,
        precoDireta: prod.precoDireta, preco99: prod.preco99, precoIfood: prod.precoIfood,
        estoqueMin: prod.estoqueMin, fornada: prod.fornada, componentes,
      }, recItems, embItems)
      rProd()
      show('Duplicado!')
    } catch (err) {
      alert('Erro ao duplicar: ' + err.message)
    }
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', padding: '0 4px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <div className="topbar-title">Produtos</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => setSheet({ type: 'produto' })} style={{ background: 'var(--teal)', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              + Novo
            </button>
          </div>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 12, paddingBottom: 90, maxWidth: 860 }}>
        {loading ? <div className="loading">Carregando...</div> : (produtos || []).length === 0 ? (
          <div className="empty">
            <span>Nenhum produto cadastrado</span>
            <button className="btn-outline-teal" style={{ marginTop: 8, maxWidth: 220 }} onClick={() => setSheet({ type: 'produto' })}>+ Novo produto</button>
          </div>
        ) : (
          <ProdutosCardapio
            produtos={produtos || []}
            secoesOrdem={secoesOrdem}
            disp={disp}
            querem={querem}
            lojaUrl={lojaUrl}
            renderPrecos={prod => <PlatPrecos prod={prod} cfg={cfg} custoSacola={custoSacola} />}
            onAbrir={prod => setSheet({ type: 'produto', item: prod })}
            onToggleAtivo={handleToggleAtivo}
            onSalvarOrganizacao={handleSalvarOrganizacao}
            onCompartilhar={compartilhar}
          />
        )}
      </div>

      {sheet?.type === 'produto' && (() => {
        const lista = produtosFiltrados
        const idx   = sheet.item ? lista.findIndex(p => p.id === sheet.item.id) : -1
        const goTo  = (prod) => setSheet({ type: 'produto', item: prod })
        return (
          <ProdutoForm
            key={sheet.item?.id ?? 'new'}
            item={sheet.item}
            receitas={receitas}
            embalagens={embalagens}
            produtos={produtos}
            insumos={insumos}
            fornecedoresList={fornecedoresList}
            onSave={handleSave}
            onDelete={handleDelete}
            onDuplicar={handleDuplicar}
            onClose={() => setSheet(null)}
            hasPrev={idx > 0}
            hasNext={idx >= 0 && idx < lista.length - 1}
            onPrev={() => idx > 0 && goTo(lista[idx - 1])}
            onNext={() => idx >= 0 && idx < lista.length - 1 && goTo(lista[idx + 1])}
            navLabel={idx >= 0 ? `${idx + 1} / ${lista.length}` : ''}
          />
        )
      })()}

      {toast && <div className="toast">{toast}</div>}

    </>
  )
}
