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
  getReceitas, getEmbalagens, getInsumos, bulkUpdateSecoes,
  saveUserConfig, loadUserConfig,
} from '../services/db'

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
import { MontarCardapio } from '../components/MontarCardapio'

const PLAT_COLOR  = { Direta: 'var(--teal)', '99Food': '#f59e0b', iFood: '#ef4444' }
const TIPO_LABELS = { produto: 'Produzido', avulso: 'Avulso', combo: 'Combo' }
const TIPO_BADGE  = { produto: null, avulso: { bg: '#334155', color: '#94a3b8', label: 'Avulso' }, combo: { bg: '#1e3a5f', color: '#60a5fa', label: 'Combo' } }

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

function TipoBadge({ tipo }) {
  const b = TIPO_BADGE[tipo]
  if (!b) return null
  return <span style={{ marginLeft: 6, fontSize: 10, background: b.bg, color: b.color, borderRadius: 4, padding: '1px 5px', verticalAlign: 'middle' }}>{b.label}</span>
}

const CROP_ASPECT = 4 / 3

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

const FORM_EMPTY = { nome: '', tipo: 'produto', secao: '', descricao: '', custoDireto: '', fornecedor: '', whatsapp: '', linkCompra: '', precoDireta: '', preco99: '', precoIfood: '', estoqueMin: '', margemAlvo: null, imagemUrl: '' }

function ProdutoForm({ item, receitas, embalagens, produtos, insumos, fornecedoresList, onSave, onDelete, onClose, hasPrev, hasNext, onPrev, onNext, navLabel }) {
  const [form, setForm] = useState(item
    ? {
        nome:        item.nome,
        tipo:        item.tipo        || 'produto',
        secao:       item.secao       || '',
        descricao:   item.descricao   || '',
        custoDireto: item.custoDireto ?? '',
        fornecedor:  item.fornecedor  || '',
        whatsapp:    item.whatsapp    || '',
        linkCompra:  item.linkCompra  || '',
        precoDireta: item.precoDireta ?? '',
        preco99:     item.preco99     ?? '',
        precoIfood:  item.precoIfood  ?? '',
        estoqueMin:  item.estoqueMin  ?? '',
        margemAlvo:  item.margemAlvo ?? null,
        imagemUrl:   item.imagemUrl   || '',
      }
    : { ...FORM_EMPTY }
  )
  const [uploadingImg, setUploadingImg] = useState(false)

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
      set('imagemUrl', url)
      URL.revokeObjectURL(cropSrc)
      setCropSrc(null)
    } catch (e) {
      alert('Erro ao enviar imagem: ' + e.message)
    } finally {
      setUploadingImg(false)
    }
  }

  const handleImgUpload = (file) => { if (file) openCrop(file) }

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
    return [{ ...form, id: item?.id, precoSugerido: precos.base, componentes }, recItems, embItems]
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
                <ItemThumb url={form.imagemUrl} nome={form.nome || '?'} size={56} radius={10} />
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

            {/* Estoque mínimo */}
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
          </div>
          </div>{/* /form-grid-rail */}
         </div>{/* /form-grid */}

          {/* Delete */}
          {item && (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
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
    <div style={{ fontSize: 11, marginTop: 2 }}>
      <span style={{ color: PLAT_COLOR.Direta }}>D {fmtR(prod.precoDireta ?? precos.base)}</span>
      {' · '}
      <span style={{ color: PLAT_COLOR['99Food'] }}>99 {fmtR(prod.preco99 ?? precos.p99)}</span>
      {' · '}
      <span style={{ color: PLAT_COLOR.iFood }}>iF {fmtR(prod.precoIfood ?? precos.pIfood)}</span>
    </div>
  )
}

function estoqueInfo(prod) {
  if (prod.tipo === 'combo') return null
  const atual = prod.estoqueAtual
  const min = prod.estoqueMin || 0
  if (atual == null && !min) return null
  const qtd = Math.max(0, Math.ceil(atual ?? 0))
  let color, label
  if (qtd <= 0) { color = '#ef4444'; label = 'sem estoque' }
  else if (min > 0 && qtd < min) { color = '#f59e0b'; label = `abaixo do mín. (${min})` }
  else { color = 'var(--teal)'; label = min > 0 ? `mín. ${min}` : 'em estoque' }
  return { qtd, color, label, min }
}

function subtext(prod) {
  if (prod.tipo === 'avulso') return [prod.fornecedor, 'Item avulso'].filter(Boolean).join(' · ')
  if (prod.tipo === 'combo')  return (prod.componentes || []).map(c => `${c.quantidade}× ${c.produtoNome}`).join(' + ') || 'Combo'
  return [
    ...(prod.receitas   || []).map(r => `${r.quantidade} ${r.unidadeGera} ${r.nome}`),
    ...(prod.embalagens || []).map(e => `${e.quantidade}× ${e.nome}`),
  ].join(' · ') || 'Sem composição'
}

function OrganizarSecoesSheet({ produtos, onSave, onClose }) {
  // Build initial state: {produtoId -> secao}
  const [secaoMap, setSecaoMap] = useState(() => {
    const m = {}
    for (const p of produtos) m[p.id] = p.secao || ''
    return m
  })

  const secoes = useMemo(() => {
    const set = new Set(Object.values(secaoMap).filter(Boolean))
    return [...set].sort()
  }, [secaoMap])

  const [ordenacao, setOrdenacao] = useState(() => {
    const set = new Set((produtos || []).map(p => p.secao || '').filter(Boolean))
    return [...set].sort()
  })

  const [novaSecao, setNovaSecao] = useState('')
  const [saving, setSaving] = useState(false)

  // All known sections: ordenacao first (preserves order + new ones), then extras from products
  const secoesSorted = useMemo(() => {
    const extras = secoes.filter(s => !ordenacao.includes(s))
    return [...ordenacao, ...extras]
  }, [ordenacao, secoes])

  const moveSecao = (idx, dir) => {
    const arr = [...secoesSorted]
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= arr.length) return
    ;[arr[idx], arr[swapIdx]] = [arr[swapIdx], arr[idx]]
    setOrdenacao(arr)
  }

  const addSecao = () => {
    const s = novaSecao.trim()
    if (!s || secoesSorted.includes(s)) { setNovaSecao(''); return }
    setOrdenacao(o => [...o, s])
    setNovaSecao('')
  }

  const removeSecao = (sec) => {
    setOrdenacao(o => o.filter(s => s !== sec))
    setSecaoMap(m => {
      const n = { ...m }
      for (const id of Object.keys(n)) if (n[id] === sec) n[id] = ''
      return n
    })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const items = Object.entries(secaoMap).map(([id, secao]) => ({ id: Number(id), secao }))
      await onSave(items, secoesSorted)
      onClose()
    } catch (e) {
      alert('Erro: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const semSecao = produtos.filter(p => !secaoMap[p.id])
  const [secaoFiltro, setSecaoFiltro] = useState(null)

  const prodsFiltrados = secaoFiltro === null
    ? produtos
    : secaoFiltro === ''
      ? semSecao
      : produtos.filter(p => secaoMap[p.id] === secaoFiltro)

  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div className="sheet" style={{ maxHeight: '90dvh', display: 'flex', flexDirection: 'column' }}>
        <div className="sheet-title">
          <span>Organizar Seções</span>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer' }} onClick={onClose}>×</button>
        </div>

        {/* Seções ordenadas */}
        <div style={{ padding: '0 16px 8px', flexShrink: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Ordem das seções</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {secoesSorted.map((sec, idx) => (
              <div key={sec} style={{ display: 'flex', alignItems: 'center', gap: 4, background: secaoFiltro === sec ? 'var(--teal)' : 'var(--bg-secondary)', borderRadius: 8, padding: '4px 8px', border: '1px solid var(--border)' }}>
                <button onClick={() => moveSecao(idx, -1)} disabled={idx === 0} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0 2px', fontSize: 12 }}>‹</button>
                <button onClick={() => setSecaoFiltro(f => f === sec ? null : sec)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: secaoFiltro === sec ? '#fff' : 'var(--text-primary)', padding: 0 }}>{sec}</button>
                <button onClick={() => moveSecao(idx, +1)} disabled={idx === secoesSorted.length - 1} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0 2px', fontSize: 12 }}>›</button>
                <button onClick={() => removeSecao(sec)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0 2px', fontSize: 13, lineHeight: 1 }}>×</button>
              </div>
            ))}
            {semSecao.length > 0 && (
              <button onClick={() => setSecaoFiltro(f => f === '' ? null : '')} style={{ background: secaoFiltro === '' ? '#334155' : 'transparent', border: '1px dashed var(--border)', borderRadius: 8, padding: '4px 10px', fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                Sem seção ({semSecao.length})
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={novaSecao}
              onChange={e => setNovaSecao(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addSecao()}
              placeholder="Nova seção…"
              style={{ flex: 1, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 }}
            />
            <button onClick={addSecao} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: 'var(--teal)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>+</button>
          </div>
        </div>

        {/* Produtos */}
        <div style={{ overflow: 'auto', flex: 1, padding: '0 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            Produtos {secaoFiltro !== null ? `· ${secaoFiltro || 'sem seção'}` : ''}
          </div>
          {prodsFiltrados.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '0.5px solid var(--border)', fontSize: 13 }}>
              <span style={{ flex: 1, fontWeight: 600 }}>{p.nome}</span>
              <select
                value={secaoMap[p.id] || ''}
                onChange={e => setSecaoMap(m => ({ ...m, [p.id]: e.target.value }))}
                style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 12, maxWidth: 140 }}
              >
                <option value="">Sem seção</option>
                {secoesSorted.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          ))}
        </div>

        <div style={{ padding: 16, flexShrink: 0 }}>
          <button onClick={handleSave} disabled={saving} style={{ width: '100%', padding: 12, borderRadius: 10, border: 'none', background: 'var(--teal)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </>
  )
}

export default function Produtos() {
  const navigate              = useNavigate()
  const [sheet, setSheet]     = useState(null)
  const location              = useLocation()
  const [filtroTipo, setFiltroTipo] = useState('Todos')

  useEffect(() => {
    if (location.state?.openNew) {
      setSheet({ type: 'produto' })
    }
  }, [])
  const { toast, show }       = useToast()
  const { profile, user }     = useAuth()
  const cfg                   = getConfig()
  const precosRef             = useRef(null)

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

  const TIPO_MAP = { Todos: null, Produzido: 'produto', Avulso: 'avulso', Combo: 'combo' }
  const produtosFiltrados = (produtos || []).filter(p => !TIPO_MAP[filtroTipo] || p.tipo === TIPO_MAP[filtroTipo])


  const [duplicando, setDuplicando] = useState(null)
  const [secoesOrdem, setSecoesOrdem] = useState([])

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

  const handleSaveSecoes = async (items, ordem) => {
    await bulkUpdateSecoes(items)
    const cfg = await loadUserConfig()
    await saveUserConfig({ ...(cfg || {}), secoesOrdem: ordem })
    setSecoesOrdem(ordem)
    rProd()
    show('Seções salvas!')
  }
  const handleDuplicar = async (prod, e) => {
    e?.stopPropagation()
    setDuplicando(prod.id)
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
        custoDireto: prod.custoDireto,
        fornecedor: prod.fornecedor, whatsapp: prod.whatsapp, linkCompra: prod.linkCompra,
        precoDireta: prod.precoDireta, preco99: prod.preco99, precoIfood: prod.precoIfood,
        estoqueMin: prod.estoqueMin, componentes,
      }, recItems, embItems)
      rProd()
      show('Duplicado!')
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', padding: '0 4px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <div className="topbar-title">Produtos</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => setSheet({ type: 'secoes' })} style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              ≡ Seções
            </button>
            <button
              onClick={() => {
                const url = `${window.location.origin}/pedido/${user?.id}`
                navigator.clipboard.writeText(url).then(() => show('Link copiado!')).catch(() => show(url))
              }}
              style={{ background: 'transparent', color: 'var(--teal)', border: '1px solid var(--teal)', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              🔗 LinkForm
            </button>
            <button onClick={() => setSheet({ type: 'produto' })} style={{ background: 'var(--teal)', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              + Novo
            </button>
          </div>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 12 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {Object.keys(TIPO_MAP).map(t => (
            <button key={t} onClick={() => setFiltroTipo(t)} style={{
              fontSize: 12, padding: '4px 12px', borderRadius: 20,
              border: '1px solid var(--border-color)',
              background: filtroTipo === t ? 'var(--teal)' : 'transparent',
              color: filtroTipo === t ? '#fff' : 'var(--text-secondary)', cursor: 'pointer',
            }}>{t}</button>
          ))}
        </div>
        {loading ? <div className="loading">Carregando...</div> : (
          <div ref={precosRef}>
            {/* Desktop */}
            <div className="desktop-only">
              <div className="card card-flush">
                {(produtos || []).length === 0
                  ? <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Nenhum produto cadastrado</div>
                  : <div className="dt-wrap"><table className="dt">
                      <thead><tr>
                        <th>Nome</th>
                        <th>Composição</th>
                        <th>Estoque</th>
                        <th>Custo</th>
                        <th style={{ color: PLAT_COLOR.Direta }}>Direta</th>
                        <th style={{ color: PLAT_COLOR['99Food'] }}>99Food</th>
                        <th style={{ color: PLAT_COLOR.iFood }}>iFood</th>
                        <th></th>
                      </tr></thead>
                      <tbody>
                        {produtosFiltrados.map(prod => {
                          const p = calcPrecos(prod.custoTotal, cfg, custoSacola)
                          return (
                            <tr key={prod.id} onClick={() => setSheet({ type: 'produto', item: prod })}>
                              <td style={{ fontWeight: 600 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <ItemThumb url={prod.imagemUrl} nome={prod.nome} size={32} radius={6} />
                                  {prod.nome}<TipoBadge tipo={prod.tipo} />
                                </div>
                              </td>
                              <td className="muted" style={{ fontSize: 12 }}>{subtext(prod)}</td>
                              <td>{(() => {
                                const info = estoqueInfo(prod)
                                if (!info) return <span className="muted">—</span>
                                return <span style={{ color: info.color, fontWeight: 600 }}>{info.qtd} un<span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 400, marginLeft: 4 }}>{info.min > 0 ? `/ ${info.min}` : ''}</span></span>
                              })()}</td>
                              <td className="muted">{prod.custoTotal > 0 ? fmtR(prod.custoTotal) : '—'}</td>
                              <td style={{ color: PLAT_COLOR.Direta }}>{fmtR(prod.precoDireta ?? p.base)}</td>
                              <td style={{ color: PLAT_COLOR['99Food'] }}>{fmtR(prod.preco99 ?? p.p99)}</td>
                              <td style={{ color: PLAT_COLOR.iFood }}>{fmtR(prod.precoIfood ?? p.pIfood)}</td>
                              <td onClick={e => e.stopPropagation()} style={{ textAlign: 'right' }}>
                                <button onClick={e => handleDuplicar(prod, e)} disabled={duplicando === prod.id} title="Duplicar"
                                  style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 14, padding: 4 }}>
                                  {duplicando === prod.id ? '⏳' : '⎘'}
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table></div>
                }
              </div>
            </div>

            {/* Mobile */}
            <div className="mobile-only">
              {(produtos || []).length === 0 ? (
                <>
                  <div className="empty">
                    <span>Nenhum produto cadastrado</span>
                    <button className="btn-outline-teal" style={{ marginTop: 8, maxWidth: 220 }} onClick={() => setSheet({ type: 'produto' })}>
                      + Novo produto
                    </button>
                  </div>
                </>
              ) : (
                <div className="card card-flush" style={{ padding: '0 14px' }}>
                  {produtosFiltrados.map(prod => {
                    return (
                      <div key={prod.id} className="list-item" onClick={() => setSheet({ type: 'produto', item: prod })}>
                        <ItemThumb url={prod.imagemUrl} nome={prod.nome} size={48} radius={8} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="list-item-name" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                            <span>{prod.nome}</span>
                            <TipoBadge tipo={prod.tipo} />
                          </div>
                          <div className="list-item-sub">{subtext(prod)}</div>
                          <PlatPrecos prod={prod} cfg={cfg} custoSacola={custoSacola} />
                          {(() => {
                            const info = estoqueInfo(prod)
                            if (!info) return null
                            return (
                              <div style={{ fontSize: 11, marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: info.color }} />
                                <span style={{ color: info.color, fontWeight: 600 }}>{info.qtd} un</span>
                                <span style={{ color: 'var(--text-tertiary)' }}>· {info.label}</span>
                              </div>
                            )
                          })()}
                        </div>
                        {prod.custoTotal > 0 && (
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0, textAlign: 'right' }}>
                            custo<br />{fmtR(prod.custoTotal)}
                          </div>
                        )}
                        <button onClick={e => handleDuplicar(prod, e)} disabled={duplicando === prod.id} title="Duplicar"
                          style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 16, padding: '4px 6px', marginLeft: 4 }}>
                          {duplicando === prod.id ? '⏳' : '⎘'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
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
            onClose={() => setSheet(null)}
            hasPrev={idx > 0}
            hasNext={idx >= 0 && idx < lista.length - 1}
            onPrev={() => idx > 0 && goTo(lista[idx - 1])}
            onNext={() => idx >= 0 && idx < lista.length - 1 && goTo(lista[idx + 1])}
            navLabel={idx >= 0 ? `${idx + 1} / ${lista.length}` : ''}
          />
        )
      })()}

      {sheet?.type === 'secoes' && (
        <OrganizarSecoesSheet
          produtos={produtos || []}
          onSave={handleSaveSecoes}
          onClose={() => setSheet(null)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}

    </>
  )
}
