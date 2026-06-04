import { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { getReceitas, saveReceita, deleteReceita, getInsumos, saveInsumo } from '../services/db'
import { ImportarTexto } from '../components/ImportarTexto'

const ImportarImagem = lazy(() => import('./ImportarImagem'))

function norm(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const TIPO_OPTS = ['Bolo', 'Torta', 'Massa', 'Recheio', 'Cobertura', 'Base', 'Produto Final', 'Outro']

// Sugestão de forma redonda baseada no volume (ml ≈ g para massas)
const DIAMS = [15, 18, 20, 21, 22, 24, 26, 28, 30]
const HEIGHTS = [4, 5, 6, 7, 8, 10]
function sugerirForma(volumeMl) {
  if (!volumeMl || volumeMl <= 0) return []
  const candidatos = []
  for (const d of DIAMS) {
    for (const h of HEIGHTS) {
      const vol = Math.PI * (d / 2) ** 2 * h
      const fill = volumeMl / vol
      if (fill >= 0.45 && fill <= 0.82) candidatos.push({ d, h, fill })
    }
  }
  candidatos.sort((a, b) => Math.abs(a.fill - 0.65) - Math.abs(b.fill - 0.65))
  // deduplica por diâmetro: melhor altura por diâmetro
  const seen = new Set()
  return candidatos.filter(c => { if (seen.has(c.d)) return false; seen.add(c.d); return true }).slice(0, 4)
}

const ACOES = [
  { tipo: 'misturar',     icon: '🥣', label: 'Misturar' },
  { tipo: 'bater',        icon: '⚡', label: 'Bater' },
  { tipo: 'mixar',        icon: '🌀', label: 'Mixar' },
  { tipo: 'liquidificar', icon: '🫧', label: 'Liquidificar' },
  { tipo: 'processar',    icon: '⚙️', label: 'Processar' },
  { tipo: 'incorporar',   icon: '🫙', label: 'Incorporar' },
  { tipo: 'ferver',       icon: '🔥', label: 'Ferver' },
  { tipo: 'aquecer',      icon: '🌡️', label: 'Aquecer' },
  { tipo: 'assar',        icon: '🍳', label: 'Assar' },
  { tipo: 'resfriar',     icon: '❄️', label: 'Resfriar' },
  { tipo: 'congelar',     icon: '🧊', label: 'Congelar' },
  { tipo: 'descansar',    icon: '⏱️', label: 'Descansar' },
  { tipo: 'cortar',       icon: '🔪', label: 'Cortar' },
  { tipo: 'esticar',     icon: '🫓', label: 'Esticar' },
]
const ACAO_MAP = Object.fromEntries(ACOES.map(a => [a.tipo, a]))

function parseInstrucoes(raw) {
  if (!raw) return []
  try {
    const p = JSON.parse(raw)
    if (Array.isArray(p)) return p
  } catch {}
  return [{ tipo: 'nota', descricao: raw }]
}

function serializeInstrucoes(steps) {
  return steps.length > 0 ? JSON.stringify(steps) : null
}

// picker: 'tipo' | 'ings' | null
function StepBuilder({ steps, onChange, ingredientes = [] }) {
  const [openPicker, setOpenPicker] = useState(null) // { idx, mode: 'tipo'|'ings' }

  const update = (i, patch) => onChange(steps.map((s, idx) => idx === i ? { ...s, ...patch } : s))
  const remove  = (i) => { onChange(steps.filter((_, idx) => idx !== i)); setOpenPicker(null) }
  const add     = () => onChange([...steps, { tipo: 'misturar', descricao: '', insumos: [] }])

  // set of ingredient indices claimed by steps before i
  const claimedBefore = (i) => new Set(
    steps.slice(0, i).flatMap(s => s.insumos || [])
  )

  const toggleIng = (stepIdx, ingIdx) => {
    const cur = steps[stepIdx].insumos || []
    const next = cur.includes(ingIdx) ? cur.filter(x => x !== ingIdx) : [...cur, ingIdx]
    update(stepIdx, { insumos: next })
  }

  const validIngs = ingredientes.filter(ing => ing.nome?.trim())

  const isOpen = (i, mode) => openPicker?.idx === i && openPicker?.mode === mode
  const toggle = (i, mode) => setOpenPicker(isOpen(i, mode) ? null : { idx: i, mode })

  return (
    <div className="card card-flush">
      {steps.map((step, i) => {
        const acao = ACAO_MAP[step.tipo] || ACAO_MAP.misturar
        const stepIngs = step.insumos || []
        const claimed = claimedBefore(i)
        const available = validIngs.filter((_, idx) => !claimed.has(idx) || stepIngs.includes(idx))

        return (
          <div key={i}>
            {/* Main row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border-color)' }}>
              <button onClick={() => toggle(i, 'tipo')} style={{
                flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 8px', borderRadius: 6,
                border: '1px solid var(--teal)', background: 'var(--teal-light)',
                color: 'var(--teal)', fontSize: 11, fontWeight: 700,
                cursor: 'pointer', letterSpacing: 0.5, whiteSpace: 'nowrap',
              }}>
                {acao.icon} {acao.label.toUpperCase()}
              </button>
              <input
                type="text"
                value={step.descricao}
                onChange={e => update(i, { descricao: e.target.value })}
                placeholder="Descreva esta etapa..."
                style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 15, fontFamily: 'inherit', minWidth: 0 }}
              />
              {validIngs.length > 0 && (
                <button onClick={() => toggle(i, 'ings')} style={{
                  flexShrink: 0, background: 'none', border: 'none',
                  color: stepIngs.length > 0 ? 'var(--teal)' : '#555',
                  fontSize: 14, cursor: 'pointer', padding: '0 2px', lineHeight: 1,
                  fontWeight: stepIngs.length > 0 ? 700 : 400,
                }}>
                  🥄{stepIngs.length > 0 ? stepIngs.length : ''}
                </button>
              )}
              <button onClick={() => remove(i)} style={{ flexShrink: 0, background: 'none', border: 'none', color: '#555', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: '0 2px' }}>×</button>
            </div>

            {/* Tipo picker */}
            {isOpen(i, 'tipo') && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 14px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
                {ACOES.map(a => (
                  <button key={a.tipo} onClick={() => { update(i, { tipo: a.tipo }); setOpenPicker(null) }} style={{
                    padding: '5px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                    border: '1px solid var(--border-color)',
                    background: a.tipo === step.tipo ? 'var(--teal)' : 'transparent',
                    color: a.tipo === step.tipo ? '#fff' : 'var(--text-secondary)',
                    fontWeight: a.tipo === step.tipo ? 700 : 400,
                  }}>{a.icon} {a.label}</button>
                ))}
              </div>
            )}

            {/* Ingredient picker */}
            {isOpen(i, 'ings') && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 14px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
                {available.length === 0
                  ? <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Todos os insumos já foram usados</span>
                  : available.map((ing, _) => {
                      const idx = validIngs.indexOf(ing)
                      const sel = stepIngs.includes(idx)
                      return (
                        <button key={idx} onClick={() => toggleIng(i, idx)} style={{
                          padding: '5px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                          border: '1px solid var(--border-color)',
                          background: sel ? 'var(--teal)' : 'transparent',
                          color: sel ? '#fff' : 'var(--text-secondary)',
                          fontWeight: sel ? 700 : 400,
                        }}>
                          {ing.nome} <span style={{ opacity: 0.7 }}>{ing.quantidade} {ing.unidade}</span>
                        </button>
                      )
                    })
                }
              </div>
            )}
          </div>
        )
      })}
      <button className="btn-add-item" onClick={add}>+ adicionar etapa</button>
    </div>
  )
}

export default function ReceitaForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { toast, show } = useToast()
  const isEdit = !!id && id !== 'nova'

  const { data: receitas, loading: loadRec } = useData(getReceitas)
  const { data: insumos, loading: loadIns, reload: rIns } = useData(getInsumos)

  const [form, setForm] = useState({
    nome: '', tipo: 'Outro', porcoes: '',
    fatorPerda: '',
    rendimentoUnidades: false,           // checkbox "Rendimento em unidades"
    qtdUnidades: '',                     // qtd de unidades (modo un)
    qtdPorUnidade: '',                   // g por unidade (modo un)
    temposForno: [],                     // [{tempo, temperatura}]
    tempoResfriamento: '', tipoResfriamento: '',
  })
  const [steps, setSteps] = useState([])
  const [ingredientes, setIngredientes] = useState([
    { insumoId: null, subReceitaId: null, nome: '', quantidade: '', unidade: 'g' },
    { insumoId: null, subReceitaId: null, nome: '', quantidade: '', unidade: 'g' },
    { insumoId: null, subReceitaId: null, nome: '', quantidade: '', unidade: 'g' },
  ])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [ingDrop, setIngDrop] = useState(null) // { idx, matches[] }
  const ingDropRef = useRef(null)
  const [importandoImg, setImportandoImg] = useState(false)

  // Pre-fill ingredients from photo import (navigated from Fichas)
  useEffect(() => {
    if (isEdit || !location.state?.ingredientes?.length) return
    setIngredientes([
      ...location.state.ingredientes,
      { insumoId: null, subReceitaId: null, nome: '', quantidade: '', unidade: 'g' },
    ])
    window.history.replaceState({}, '') // clear state so refresh doesn't re-fill
  }, [])
  const [insumoRapido, setInsumoRapido] = useState(null) // [{nome,unidade,custoEmb,pesoEmb}] | null
  const [salvandoInsumos, setSalvandoInsumos] = useState(false)
  const [savedRecId, setSavedRecId] = useState(null)
  const [importandoTexto, setImportandoTexto] = useState(false)

  useEffect(() => {
    if (!isEdit || !receitas) return
    const rec = receitas.find(r => String(r.id) === String(id))
    if (!rec) return
    const isUnit = rec.qtdPorUnidade != null || rec.unidadeGera === 'un'
    const tempos = Array.isArray(rec.temposForno) && rec.temposForno.length > 0
      ? rec.temposForno.map(t => ({ tempo: t.tempo != null ? String(t.tempo) : '', temperatura: t.temperatura != null ? String(t.temperatura) : '' }))
      : (rec.tempoForno != null || rec.tempForno != null
          ? [{ tempo: rec.tempoForno != null ? String(rec.tempoForno) : '', temperatura: rec.tempForno != null ? String(rec.tempForno) : '' }]
          : [])
    setForm({
      nome: rec.nome,
      tipo: rec.tipo || 'Outro',
      fatorPerda: rec.fatorPerda != null ? String(rec.fatorPerda) : '',
      porcoes: rec.porcoes ? String(rec.porcoes) : '',
      rendimentoUnidades: isUnit,
      qtdUnidades: isUnit && rec.rendimento ? String(rec.rendimento) : '',
      qtdPorUnidade: rec.qtdPorUnidade != null ? String(rec.qtdPorUnidade) : '',
      temposForno: tempos,
      tempoResfriamento: rec.tempoResfriamento != null ? String(rec.tempoResfriamento) : '',
      tipoResfriamento: rec.tipoResfriamento || '',
    })
    setSteps(parseInstrucoes(rec.instrucoes))
    if (rec.ingredientes?.length > 0) {
      setIngredientes(rec.ingredientes.map(i => ({
        insumoId: i.insumoId || null,
        subReceitaId: i.subReceitaId || null,
        nome: i.nome,
        quantidade: i.quantidade,
        unidade: i.unidade,
      })))
    }
  }, [receitas, id, isEdit])

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleIngNome = (i, nome, rect) => {
    // Check sub-receita first (priority), then insumo
    const recMatch = receitas?.find(r => r.nome === nome && String(r.id) !== String(id))
    if (recMatch) {
      setIngredientes(prev => prev.map((it, idx) =>
        idx === i ? { ...it, nome, subReceitaId: recMatch.id, insumoId: null, unidade: recMatch.unidadeGera || 'un' } : it
      ))
      setIngDrop(null)
      return
    }
    const found = insumos?.find(ins => norm(ins.nome) === norm(nome))
    setIngredientes(prev => prev.map((it, idx) =>
      idx === i ? { ...it, nome, insumoId: found?.id ?? null, subReceitaId: null, unidade: found ? found.unidade : it.unidade } : it
    ))
    if (nome.length >= 1) {
      const q = norm(nome)
      const recOpts = (receitas || []).filter(r => String(r.id) !== String(id) && norm(r.nome).includes(q)).map(r => ({ label: r.nome, tag: 'R' }))
      const insOpts = (insumos || []).filter(ins => norm(ins.nome).includes(q)).map(ins => ({ label: ins.nome, tag: null }))
      const matches = [...recOpts, ...insOpts].slice(0, 8)
      setIngDrop(matches.length ? { idx: i, matches, rect, selectedIdx: -1 } : null)
    } else {
      setIngDrop(null)
    }
  }

  const selectIngSuggestion = (i, nome) => {
    handleIngNome(i, nome, null)
    setIngDrop(null)
  }

  const setIng = (i, k, v) => setIngredientes(prev => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it))
  const addIng = () => setIngredientes(prev => [...prev, { insumoId: null, subReceitaId: null, nome: '', quantidade: '', unidade: 'g' }])
  const removeIng = i => setIngredientes(prev => prev.filter((_, idx) => idx !== i))

  const ingCusto = (ing) => {
    if (ing.subReceitaId) {
      const rec = receitas?.find(r => r.id === ing.subReceitaId)
      if (!rec?.custoUnid || !ing.quantidade) return 0
      return (parseFloat(ing.quantidade) || 0) * rec.custoUnid
    }
    const insumo = insumos?.find(ins => ins.id === ing.insumoId || ins.nome === ing.nome)
    if (!insumo?.custoUnit || !ing.quantidade) return 0
    const qty = parseFloat(ing.quantidade) || 0
    // insumo "un" with pesoUn: custoUnit is R$/g, so multiply by pesoUn to get R$/un
    if (insumo.unidade === 'un' && ing.unidade === 'un' && insumo.pesoUn > 0) {
      return qty * insumo.custoUnit * insumo.pesoUn
    }
    return qty * insumo.custoUnit
  }

  const custoTotal = useMemo(() =>
    ingredientes.reduce((s, ing) => s + ingCusto(ing), 0),
    [ingredientes, insumos]
  )

  const catsInsumo = useMemo(() =>
    [...new Set((insumos || []).map(i => i.categoria).filter(Boolean))].sort(),
    [insumos]
  )

  // Bruto = soma dos pesos dos ingredientes
  const rendimentoBruto = useMemo(() =>
    ingredientes.reduce((s, ing) => {
      const qty = parseFloat(ing.quantidade) || 0
      switch (ing.unidade) {
        case 'g':  return s + qty
        case 'ml': return s + qty
        case 'kg': return s + qty * 1000
        case 'L':  return s + qty * 1000
        case 'un': {
          const insumo = insumos?.find(ins => ins.id === ing.insumoId || ins.nome === ing.nome)
          return insumo?.pesoUn > 0 ? s + qty * insumo.pesoUn : s
        }
        default:   return s
      }
    }, 0),
    [ingredientes, insumos]
  )

  const fatorPerdaNum  = Math.min(99, Math.max(0, parseFloat(form.fatorPerda) || 0))
  // Líquido estimado em g
  const rendLiquidoG   = fatorPerdaNum > 0 ? rendimentoBruto * (1 - fatorPerdaNum / 100) : rendimentoBruto

  // Modo unidades: bidirecional qtdUnidades ↔ qtdPorUnidade
  const onQtdUnidadesChange = (val) => {
    setForm(f => {
      const u = parseFloat(val)
      if (!isNaN(u) && u > 0 && rendLiquidoG > 0) {
        const gpu = Math.round((rendLiquidoG / u) * 10) / 10
        return { ...f, qtdUnidades: val, qtdPorUnidade: String(gpu) }
      }
      return { ...f, qtdUnidades: val }
    })
  }
  const onQtdPorUnidadeChange = (val) => {
    setForm(f => {
      const gpu = parseFloat(val)
      if (!isNaN(gpu) && gpu > 0 && rendLiquidoG > 0) {
        const u = Math.round((rendLiquidoG / gpu) * 10) / 10
        return { ...f, qtdPorUnidade: val, qtdUnidades: String(u) }
      }
      return { ...f, qtdPorUnidade: val }
    })
  }

  // Rendimento efetivo p/ cálculo de custo
  const isUnitMode = !!form.rendimentoUnidades
  const qtdUnidadesNum = parseFloat(form.qtdUnidades) || 0
  const rendimentoNum  = isUnitMode ? qtdUnidadesNum : rendLiquidoG
  const custoUnid      = rendimentoNum > 0 ? custoTotal / rendimentoNum : 0
  const unidadeLabel   = isUnitMode ? 'un' : 'g'

  const handleSave = async () => {
    if (!form.nome) { show('Preencha o nome da receita'); return }
    setSaving(true)
    try {
      const ings = ingredientes.filter(i => i.nome && i.quantidade)
      const temposClean = (form.temposForno || [])
        .filter(t => (t.tempo !== '' && t.tempo != null) || (t.temperatura !== '' && t.temperatura != null))
        .map(t => ({
          tempo: t.tempo !== '' && t.tempo != null ? parseInt(t.tempo) : null,
          temperatura: t.temperatura !== '' && t.temperatura != null ? parseInt(t.temperatura) : null,
        }))
      const first = temposClean[0] || { tempo: null, temperatura: null }
      const recId = await saveReceita(
        {
          ...form,
          id: isEdit ? parseInt(id) : undefined,
          rendimento: rendimentoNum,
          unidadeGera: isUnitMode ? 'un' : 'g',
          qtdPorUnidade: isUnitMode ? (parseFloat(form.qtdPorUnidade) || null) : null,
          temposForno: temposClean,
          tempoForno: first.tempo,
          tempForno: first.temperatura,
          fatorPerda: fatorPerdaNum || null,
          pesoLiquido: fatorPerdaNum > 0 ? rendLiquidoG : null,
          instrucoes: serializeInstrucoes(steps),
          custoTotal,
          custoUnid,
          porcoes: isUnitMode ? null : (form.porcoes ? parseInt(form.porcoes) : null),
        },
        ings
      )
      show(isEdit ? 'Receita atualizada!' : 'Receita criada!')
      const faltantes = ings.filter(ing => {
        if (ing.insumoId || ing.subReceitaId) return false
        return !(insumos || []).some(ins => norm(ins.nome) === norm(ing.nome))
      })
      if (faltantes.length > 0) {
        setSavedRecId(recId)
        setInsumoRapido(faltantes.map(ing => ({ nome: ing.nome, unidade: ing.unidade || 'g', custoEmb: '', pesoEmb: '' })))
        return
      }
      navigate(`/fichas/${recId}`, { replace: true })
    } catch (e) {
      show('Erro: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleSalvarInsumos = async () => {
    setSalvandoInsumos(true)
    try {
      const para_salvar = (insumoRapido || []).filter(i => i.nome.trim())
      await Promise.all(para_salvar.map(i => saveInsumo({
        nome: i.nome, marca: '', categoria: '', unidade: i.unidade || 'g',
        pesoEmb: i.pesoEmb || '', custoEmb: i.custoEmb || '',
        linkCompra: '', estoqueAtual: '', estoqueMin: '', fornecedor: '', whatsapp: '',
      })))
    } catch (e) {
      show('Erro ao salvar insumos: ' + e.message)
    } finally {
      setSalvandoInsumos(false)
      navigate(`/fichas/${savedRecId}`, { replace: true })
    }
  }

  const handleDelete = async () => {
    if (!confirm('Excluir esta receita?')) return
    setDeleting(true)
    try {
      await deleteReceita(parseInt(id))
      navigate('/fichas')
    } catch (e) {
      show('Erro: ' + e.message)
      setDeleting(false)
    }
  }

  const fmtPeso = g => g >= 1000
    ? `${(g / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg`
    : `${g.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} g`

  const loading = (loadRec && isEdit) || loadIns
  if (loading) return <div className="loading">Carregando...</div>

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
            <button
              onClick={() => navigate(-1)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}
              title="Voltar"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M12 4l-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <div className="topbar-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
              {isEdit ? (form.nome || 'Editar receita') : 'Nova receita'}
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              background: 'none', border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
              padding: '6px 4px', fontSize: 14, fontWeight: 600,
              color: 'var(--teal)', opacity: saving ? 0.5 : 1,
            }}
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 16 }}>
        <div className="field-label">Nome da receita</div>
        <input className="field-input" placeholder="ex: Bolo de chocolate" value={form.nome} onChange={e => setField('nome', e.target.value)} />

        <div>
          <div className="field-label">Tipo</div>
          <input
            className="field-input"
            list="tipo-opts"
            placeholder="ex: Bolo"
            value={form.tipo}
            onChange={e => setField('tipo', e.target.value)}
          />
          <datalist id="tipo-opts">
            {[...new Set([...TIPO_OPTS, ...(receitas || []).map(r => r.tipo).filter(Boolean)])].map(t => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
        <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={!!form.rendimentoUnidades}
                onChange={e => setField('rendimentoUnidades', e.target.checked)}
                style={{ accentColor: 'var(--teal)', width: 16, height: 16 }}
              />
              <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>Esta receita é dividida em unidades</span>
            </label>
            {isUnitMode && (
              <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: '12px 14px', marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div className="field-label">Qtd</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        className="field-input"
                        type="text" inputMode="decimal"
                        placeholder="ex: 10"
                        value={form.qtdUnidades}
                        onChange={e => onQtdUnidadesChange(e.target.value)}
                        style={{ marginBottom: 0 }}
                      />
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>un</span>
                    </div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="field-label">por unidade</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        className="field-input"
                        type="text" inputMode="decimal"
                        placeholder="ex: 100"
                        value={form.qtdPorUnidade}
                        onChange={e => onQtdPorUnidadeChange(e.target.value)}
                        style={{ marginBottom: 0 }}
                      />
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>g/un</span>
                    </div>
                  </div>
                </div>
                {rendLiquidoG > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--teal)', marginTop: 8 }}>
                    {Math.round(rendLiquidoG)}g {fatorPerdaNum > 0 ? 'líquido' : ''} ÷ {form.qtdUnidades || '?'} un = {form.qtdPorUnidade ? `${form.qtdPorUnidade} g/un` : '?'}
                  </div>
                )}
              </div>
            )}
        </div>

        {/* Resumo peso/rendimento */}
        {rendimentoBruto > 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 8, padding: '6px 10px', background: 'var(--bg-card)', borderRadius: 6, border: '1px solid var(--border)' }}>
            Bruto: <strong style={{ color: 'var(--text-secondary)' }}>{fmtPeso(rendimentoBruto)}</strong>
            {fatorPerdaNum > 0 && (
              <>
                <span style={{ margin: '0 6px' }}>→</span>
                <strong style={{ color: 'var(--teal)' }}>líquido estimado {fmtPeso(rendLiquidoG)}</strong>
                <span style={{ color: 'var(--text-tertiary)', marginLeft: 4 }}>(−{fatorPerdaNum}%)</span>
              </>
            )}
          </div>
        )}
        {/* Sugestão de forma redonda */}
        {rendimentoBruto > 0 && (() => {
          const formas = sugerirForma(rendimentoBruto)
          if (!formas.length) return null
          return (
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Forma redonda:</span>
              {formas.map(({ d, h, fill }) => (
                <span key={`${d}-${h}`} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 20, padding: '2px 10px', whiteSpace: 'nowrap' }}>
                  ø{d}cm × {h}cm <span style={{ color: 'var(--teal)' }}>{Math.round(fill * 100)}%</span>
                </span>
              ))}
            </div>
          )
        })()}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, marginBottom: 4 }}>
          <div className="section-label" style={{ margin: 0 }}>Ingredientes</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={() => setImportandoTexto(true)} style={{ fontSize: 12, color: 'var(--teal)', background: 'none', border: '1px solid var(--teal)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>
              📋 Colar
            </button>
            <button type="button" onClick={() => setImportandoImg(true)} style={{ fontSize: 12, color: 'var(--teal)', background: 'none', border: '1px solid var(--teal)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>
              📷 Foto
            </button>
          </div>
        </div>
        <div className="card card-flush" style={{ padding: '0 14px' }}>
          {ingredientes.map((ing, i) => {
            const custo = ingCusto(ing)
            return (
              <div key={i} className="ing-form-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                <div style={{ display: 'flex', gap: 6, flex: '1 1 100%', alignItems: 'center' }}>
                  {ing.subReceitaId && (
                    <span style={{ fontSize: 10, background: 'var(--teal)', color: '#fff', borderRadius: 4, padding: '2px 5px', flexShrink: 0, fontWeight: 700 }}>R</span>
                  )}
                  <div style={{ flex: 2, position: 'relative' }}>
                    <input
                      className="field-input"
                      style={{ width: '100%', marginBottom: 0, fontSize: 13 }}
                      placeholder="Ingrediente"
                      value={ing.nome}
                      onChange={e => handleIngNome(i, e.target.value, e.target.getBoundingClientRect())}
                      onBlur={() => setTimeout(() => setIngDrop(null), 120)}
                      onKeyDown={e => {
                        if (!ingDrop || ingDrop.idx !== i) return
                        if (e.key === 'ArrowDown') { e.preventDefault(); setIngDrop(d => ({ ...d, selectedIdx: Math.min((d.selectedIdx ?? -1) + 1, d.matches.length - 1) })) }
                        else if (e.key === 'ArrowUp') { e.preventDefault(); setIngDrop(d => ({ ...d, selectedIdx: Math.max((d.selectedIdx ?? 0) - 1, 0) })) }
                        else if (e.key === 'Enter' && ingDrop.selectedIdx >= 0) { e.preventDefault(); selectIngSuggestion(i, ingDrop.matches[ingDrop.selectedIdx].label) }
                        else if (e.key === 'Escape') setIngDrop(null)
                      }}
                      autoComplete="off"
                    />
                  </div>
                  <input
                    className="item-qty"
                    type="text" inputMode="decimal"
                    min="0" step="0.1"
                    placeholder="Qtd"
                    value={ing.quantidade}
                    onChange={e => setIng(i, 'quantidade', e.target.value)}
                  />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 24 }}>{ing.unidade}</span>
                  {ingredientes.length > 1 && (
                    <button className="item-rm" onClick={() => removeIng(i)}>&#215;</button>
                  )}
                </div>
                {custo > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--teal)', paddingLeft: 2, paddingBottom: 4 }}>
                    R$ {custo.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <button className="btn-add-item" onClick={addIng}>+ adicionar ingrediente</button>

        {/* Ingredient dropdown — rendered outside card to avoid overflow:hidden clip */}
        {ingDrop?.rect && (
          <div style={{
            position: 'fixed',
            top: ingDrop.rect.bottom + 2,
            left: ingDrop.rect.left,
            width: ingDrop.rect.width,
            zIndex: 200,
            background: '#1e1e1e',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
            overflow: 'hidden',
          }}>
            {ingDrop.matches.map((m, mi) => (
              <div key={mi}
                onPointerDown={e => { e.preventDefault(); selectIngSuggestion(ingDrop.idx, m.label) }}
                style={{
                  padding: '9px 12px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
                  borderBottom: '1px solid var(--border)',
                  background: mi === ingDrop.selectedIdx ? 'var(--teal-light)' : '#1e1e1e',
                  color: mi === ingDrop.selectedIdx ? 'var(--teal)' : 'var(--text-primary)',
                }}>
                {m.tag && <span style={{ fontSize: 9, background: 'var(--teal)', color: '#fff', borderRadius: 3, padding: '1px 4px', fontWeight: 700 }}>{m.tag}</span>}
                {m.label}
              </div>
            ))}
          </div>
        )}

        {custoTotal > 0 && (
          <div style={{ margin: '12px 0 4px', padding: '10px 14px', background: 'var(--teal-light)', borderRadius: 8 }}>
            <div style={{ fontSize: 13, color: 'var(--teal)', fontWeight: 600 }}>
              Custo do lote: R$ {custoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            {rendimentoNum > 0 && (
              <div style={{ fontSize: 12, color: 'var(--teal)', marginTop: 4 }}>
                Rendimento: {isUnitMode
                  ? `${qtdUnidadesNum} un${form.qtdPorUnidade ? ` × ${form.qtdPorUnidade}g/un` : ''}`
                  : `${rendLiquidoG.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} g${fatorPerdaNum > 0 ? ' (líq.)' : ''}`}
                {custoUnid > 0 && (
                  <span style={{ marginLeft: 10, fontWeight: 600 }}>
                    → R$ {custoUnid.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}/{unidadeLabel}
                  </span>
                )}
                {!isUnitMode && form.porcoes && parseInt(form.porcoes) > 0 && custoTotal > 0 && (
                  <span> · R$ {(custoTotal / parseInt(form.porcoes)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/porção</span>
                )}
              </div>
            )}
          </div>
        )}

        <div className="section-label" style={{ marginTop: 16 }}>Modo de preparo</div>
        <StepBuilder steps={steps} onChange={setSteps} ingredientes={ingredientes} />

        {/* Configurações avançadas (sempre abertas, opcionais) */}
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', color: 'var(--text-tertiary)' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--bg-secondary)' }} />
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', whiteSpace: 'nowrap' }}>
              Configurações avançadas
            </span>
            <div style={{ flex: 1, height: 1, background: 'var(--bg-secondary)' }} />
          </div>
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: '14px 14px 8px', marginTop: 8 }}>
            <div className="field-label">Fator de perda (%)</div>
            <input
              className="field-input"
              type="text" inputMode="decimal"
              placeholder="ex: 18"
              value={form.fatorPerda}
              onChange={e => {
                const v = e.target.value
                if (v === '' || (parseFloat(v) >= 0 && parseFloat(v) < 100)) setField('fatorPerda', v)
              }}
            />

            {/* Etapas de forno (múltiplas) */}
            <div className="field-label" style={{ marginTop: 6 }}>Forno (etapas)</div>
            {(form.temposForno || []).map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                <input
                  className="field-input" type="text" inputMode="numeric"
                  placeholder="min"
                  value={t.tempo}
                  onChange={e => setForm(f => ({ ...f, temposForno: f.temposForno.map((x, idx) => idx === i ? { ...x, tempo: e.target.value } : x) }))}
                  style={{ marginBottom: 0, flex: 1 }}
                />
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>min</span>
                <input
                  className="field-input" type="text" inputMode="numeric"
                  placeholder="°C"
                  value={t.temperatura}
                  onChange={e => setForm(f => ({ ...f, temposForno: f.temposForno.map((x, idx) => idx === i ? { ...x, temperatura: e.target.value } : x) }))}
                  style={{ marginBottom: 0, flex: 1 }}
                />
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>°C</span>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, temposForno: f.temposForno.filter((_, idx) => idx !== i) }))}
                  style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', fontSize: 18, cursor: 'pointer', padding: '0 4px' }}
                >×</button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, temposForno: [...(f.temposForno || []), { tempo: '', temperatura: '' }] }))}
              style={{ background: 'none', border: '1px dashed var(--border)', borderRadius: 8, padding: '6px 12px', fontSize: 12, color: 'var(--teal)', cursor: 'pointer', marginBottom: 12 }}
            >+ adicionar etapa de forno</button>

            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <div className="field-label">Tipo resfriamento</div>
                <select className="field-input" value={form.tipoResfriamento} onChange={e => setField('tipoResfriamento', e.target.value)}>
                  <option value="">Nenhum</option>
                  <option value="geladeira">Geladeira</option>
                  <option value="congelador">Congelador</option>
                  <option value="ambiente">Temp. ambiente</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <div className="field-label">Tempo mínimo (horas)</div>
                <input className="field-input" type="text" inputMode="decimal" placeholder="ex: 2" value={form.tempoResfriamento} onChange={e => setField('tempoResfriamento', e.target.value)} disabled={!form.tipoResfriamento} />
              </div>
            </div>
          </div>
        </div>

        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Salvando...' : isEdit ? 'Atualizar receita' : 'Criar receita'}
        </button>

        {isEdit && (
          <button className="btn-danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Excluindo...' : 'Excluir receita'}
          </button>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}

      {importandoImg && (
        <Suspense fallback={null}>
          <ImportarImagem
            mode="receita"
            insumosList={insumos || []}
            onClose={() => setImportandoImg(false)}
            onIngredientesImportados={ings => {
              setIngredientes(prev => {
                const base = prev.filter(i => i.nome?.trim())
                return [...base, ...ings, { insumoId: null, subReceitaId: null, nome: '', quantidade: '', unidade: 'g' }]
              })
              setImportandoImg(false)
            }}
          />
        </Suspense>
      )}

      {insumoRapido && (
        <>
          <div className="sheet-overlay" />
          <div className="sheet">
            <div className="sheet-title">
              <span>Cadastrar insumos novos</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              {insumoRapido.length} ingrediente{insumoRapido.length > 1 ? 's' : ''} da receita ainda não estão cadastrados. Preencha o que quiser e clique em salvar.
            </div>
            {insumoRapido.map((item, i) => (
              <div key={i} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{item.nome}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 3 }}>Unidade</div>
                    <select
                      value={item.unidade}
                      onChange={e => setInsumoRapido(r => r.map((x, n) => n === i ? { ...x, unidade: e.target.value } : x))}
                      className="field-input" style={{ marginBottom: 0 }}>
                      {['g', 'ml', 'un', 'kg', 'L', 'cx'].map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 3 }}>Peso emb. ({item.unidade})</div>
                    <input
                      type="text" inputMode="decimal" className="field-input" style={{ marginBottom: 0 }}
                      placeholder="ex: 1000"
                      value={item.pesoEmb}
                      onChange={e => setInsumoRapido(r => r.map((x, n) => n === i ? { ...x, pesoEmb: e.target.value } : x))}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 3 }}>Custo emb. (R$)</div>
                    <input
                      type="text" inputMode="decimal" className="field-input" style={{ marginBottom: 0 }}
                      placeholder="ex: 12,50"
                      value={item.custoEmb}
                      onChange={e => setInsumoRapido(r => r.map((x, n) => n === i ? { ...x, custoEmb: e.target.value } : x))}
                    />
                  </div>
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button
                onClick={handleSalvarInsumos}
                disabled={salvandoInsumos}
                style={{ flex: 1, padding: '12px', borderRadius: 10, border: 'none', background: 'var(--teal)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: salvandoInsumos ? 'wait' : 'pointer' }}>
                {salvandoInsumos ? 'Salvando...' : `Salvar ${insumoRapido.length} insumo${insumoRapido.length > 1 ? 's' : ''}`}
              </button>
              <button
                onClick={() => navigate(`/fichas/${savedRecId}`, { replace: true })}
                style={{ padding: '12px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'none', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer' }}>
                Pular
              </button>
            </div>
          </div>
        </>
      )}

      {importandoTexto && (
        <ImportarTexto
          mode="ingredientes"
          onClose={() => setImportandoTexto(false)}
          onImport={ings => {
            const novos = ings.map(i => ({
              insumoId: null, subReceitaId: null,
              nome: i.nome,
              quantidade: i.quantidade != null ? String(i.quantidade) : '',
              unidade: i.unidade || 'g',
            }))
            setIngredientes(prev => {
              const base = prev.filter(i => i.nome?.trim())
              return [...base, ...novos, { insumoId: null, subReceitaId: null, nome: '', quantidade: '', unidade: 'g' }]
            })
          }}
        />
      )}
    </>
  )
}
