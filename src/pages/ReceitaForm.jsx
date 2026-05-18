import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { getReceitas, saveReceita, deleteReceita, getInsumos } from '../services/db'

const TIPO_OPTS = ['Bolo', 'Torta', 'Massa', 'Recheio', 'Cobertura', 'Base', 'Produto Final', 'Outro']
const WEIGHT_UNITS = ['g', 'ml', 'kg', 'L']

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
  const valid = steps.filter(s => s.descricao?.trim())
  return valid.length > 0 ? JSON.stringify(valid) : null
}

function StepBuilder({ steps, onChange }) {
  const [openPicker, setOpenPicker] = useState(null) // index | null

  const update = (i, patch) => onChange(steps.map((s, idx) => idx === i ? { ...s, ...patch } : s))
  const remove  = (i) => onChange(steps.filter((_, idx) => idx !== i))
  const add     = () => onChange([...steps, { tipo: 'misturar', descricao: '' }])

  return (
    <div>
      {steps.map((step, i) => {
        const acao = ACAO_MAP[step.tipo] || ACAO_MAP.misturar
        return (
          <div key={i} style={{ marginBottom: 8, border: '1px solid var(--border-color)', borderRadius: 10, overflow: 'hidden' }}>
            {/* Tipo selector row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--bg-secondary)', borderBottom: openPicker === i ? '1px solid var(--border-color)' : 'none' }}>
              <button
                onClick={() => setOpenPicker(openPicker === i ? null : i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px',
                  borderRadius: 6, border: '1px solid var(--teal)', background: 'var(--teal-light)',
                  color: 'var(--teal)', fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5,
                }}>
                {acao.icon} {acao.label.toUpperCase()}
              </button>
              <span style={{ flex: 1, fontSize: 11, color: 'var(--text-tertiary)' }}>Etapa {i + 1}</span>
              <button onClick={() => remove(i)} style={{ background: 'none', border: 'none', color: '#555', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
            </div>
            {/* Tipo picker grid */}
            {openPicker === i && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
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
            {/* Description */}
            <textarea
              className="field-input"
              rows={4}
              placeholder="Descreva esta etapa..."
              value={step.descricao}
              onChange={e => update(i, { descricao: e.target.value })}
              style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6, border: 'none', borderRadius: 0, margin: 0, minHeight: 96 }}
            />
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
  const { toast, show } = useToast()
  const isEdit = !!id && id !== 'nova'

  const { data: receitas, loading: loadRec } = useData(getReceitas)
  const { data: insumos, loading: loadIns } = useData(getInsumos)

  const [form, setForm] = useState({
    nome: '', tipo: 'Outro', rendimento: '', unidadeGera: 'un', fatorPerda: '',
    tempoForno: '', tempForno: '', tempoResfriamento: '', tipoResfriamento: '',
  })
  const [steps, setSteps] = useState([])
  const [ingredientes, setIngredientes] = useState([
    { insumoId: null, subReceitaId: null, nome: '', quantidade: '', unidade: 'g' },
    { insumoId: null, subReceitaId: null, nome: '', quantidade: '', unidade: 'g' },
    { insumoId: null, subReceitaId: null, nome: '', quantidade: '', unidade: 'g' },
  ])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!isEdit || !receitas) return
    const rec = receitas.find(r => String(r.id) === String(id))
    if (!rec) return
    setForm({
      nome: rec.nome,
      tipo: rec.tipo || 'Outro',
      rendimento: rec.rendimento || '',
      unidadeGera: rec.unidadeGera || 'un',
      fatorPerda: rec.fatorPerda != null ? String(rec.fatorPerda) : '',
      tempoForno: rec.tempoForno != null ? String(rec.tempoForno) : '',
      tempForno: rec.tempForno != null ? String(rec.tempForno) : '',
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

  const handleIngNome = (i, nome) => {
    // Check sub-receita first (priority), then insumo
    const recMatch = receitas?.find(r => r.nome === nome && String(r.id) !== String(id))
    if (recMatch) {
      setIngredientes(prev => prev.map((it, idx) =>
        idx === i ? { ...it, nome, subReceitaId: recMatch.id, insumoId: null, unidade: recMatch.unidadeGera || 'un' } : it
      ))
      return
    }
    const found = insumos?.find(ins => ins.nome === nome)
    setIngredientes(prev => prev.map((it, idx) =>
      idx === i ? { ...it, nome, insumoId: found?.id ?? null, subReceitaId: null, unidade: found ? found.unidade : it.unidade } : it
    ))
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

  // Bruto = soma dos pesos dos ingredientes
  const rendimentoBruto = useMemo(() =>
    ingredientes.reduce((s, ing) => {
      const qty = parseFloat(ing.quantidade) || 0
      switch (ing.unidade) {
        case 'g':  return s + qty
        case 'ml': return s + qty
        case 'kg': return s + qty * 1000
        case 'L':  return s + qty * 1000
        default:   return s
      }
    }, 0),
    [ingredientes]
  )

  const fatorPerdaNum  = Math.min(99, Math.max(0, parseFloat(form.fatorPerda) || 0))
  const isWeightUnit   = WEIGHT_UNITS.includes(form.unidadeGera)
  // Líquido estimado (g/ml)
  const rendLiquidoG   = fatorPerdaNum > 0 ? rendimentoBruto * (1 - fatorPerdaNum / 100) : rendimentoBruto
  // Auto-rendimento para unidades de peso (já na unidade certa)
  const rendAutoNum    = isWeightUnit
    ? (['kg', 'L'].includes(form.unidadeGera) ? rendLiquidoG / 1000 : rendLiquidoG)
    : 0

  // Rendimento efetivo p/ cálculo de custo
  const rendimentoNum  = isWeightUnit ? rendAutoNum : (parseFloat(form.rendimento) || 0)
  const custoUnid      = rendimentoNum > 0 ? custoTotal / rendimentoNum : 0

  const unidadesGera = useMemo(() =>
    [...new Set((receitas || []).map(r => r.unidadeGera).filter(Boolean))].sort(),
    [receitas]
  )

  const handleSave = async () => {
    if (!form.nome) { show('Preencha o nome da receita'); return }
    setSaving(true)
    try {
      const ings = ingredientes.filter(i => i.nome && i.quantidade)
      const recId = await saveReceita(
        {
          ...form,
          id: isEdit ? parseInt(id) : undefined,
          rendimento: isWeightUnit ? rendAutoNum : parseFloat(form.rendimento),
          fatorPerda: fatorPerdaNum || null,
          pesoLiquido: fatorPerdaNum > 0 ? rendLiquidoG : null,
          instrucoes: serializeInstrucoes(steps),
          custoTotal,
          custoUnid,
        },
        ings
      )
      show(isEdit ? 'Receita atualizada!' : 'Receita criada!')
      navigate(`/fichas/${recId}`)
    } catch (e) {
      show('Erro: ' + e.message)
    } finally {
      setSaving(false)
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
        <div className="topbar-inner">
          <div className="topbar-title">{isEdit ? 'Editar receita' : 'Nova receita'}</div>
          <button className="btn-ghost" onClick={() => navigate(isEdit ? `/fichas/${id}` : '/fichas')}>
            ← Voltar
          </button>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 16 }}>
        <div className="field-label">Nome da receita</div>
        <input className="field-input" placeholder="ex: Bolo de chocolate" value={form.nome} onChange={e => setField('nome', e.target.value)} />

        <div className="field-row">
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
            <div className="field-label">Unidade gerada</div>
            <input
              className="field-input"
              list="unidades-gera-list"
              placeholder="ex: discos, fatias"
              value={form.unidadeGera}
              onChange={e => setField('unidadeGera', e.target.value)}
            />
            <datalist id="unidades-gera-list">
              {unidadesGera.map(u => <option key={u} value={u} />)}
            </datalist>
          </div>
        </div>

        <div className="field-row">
          {/* Rendimento manual só para unidades não-peso */}
          {!isWeightUnit && (
            <div>
              <div className="field-label">Rendimento — qtd de {form.unidadeGera || 'unidades'}</div>
              <input
                className="field-input"
                type="text" inputMode="decimal" min="0"
                placeholder="ex: 12"
                value={form.rendimento}
                onChange={e => setField('rendimento', e.target.value)}
              />
            </div>
          )}
          <div>
            <div className="field-label">
              Fator de perda (%)
              <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 6 }}>1–99</span>
            </div>
            <input
              className="field-input"
              type="text" inputMode="decimal"
              min="1" max="99"
              placeholder={isWeightUnit ? 'ex: 18 → aplica no bruto' : 'opcional'}
              value={form.fatorPerda}
              onChange={e => {
                const v = e.target.value
                if (v === '' || (parseFloat(v) >= 0 && parseFloat(v) < 100)) setField('fatorPerda', v)
              }}
            />
          </div>
        </div>

        {/* Resumo peso/rendimento */}
        {rendimentoBruto > 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12, padding: '6px 10px', background: 'var(--bg-card)', borderRadius: 6, border: '1px solid var(--border)' }}>
            Bruto: <strong style={{ color: 'var(--text-secondary)' }}>{fmtPeso(rendimentoBruto)}</strong>
            {fatorPerdaNum > 0 && (
              <>
                <span style={{ margin: '0 6px' }}>→</span>
                <strong style={{ color: 'var(--teal)' }}>líquido estimado {fmtPeso(rendLiquidoG)}</strong>
                <span style={{ color: 'var(--text-tertiary)', marginLeft: 4 }}>(−{fatorPerdaNum}%)</span>
              </>
            )}
            {isWeightUnit && rendAutoNum > 0 && (
              <span style={{ color: 'var(--text-tertiary)', marginLeft: 8 }}>
                = rendimento <strong style={{ color: 'var(--text-secondary)' }}>{rendAutoNum.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} {form.unidadeGera}</strong> (auto)
              </span>
            )}
          </div>
        )}

        <div className="section-label" style={{ marginTop: 4 }}>Ingredientes</div>
        <div className="card card-flush" style={{ padding: '0 14px' }}>
          {ingredientes.map((ing, i) => {
            const custo = ingCusto(ing)
            return (
              <div key={i} className="ing-form-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                <div style={{ display: 'flex', gap: 6, flex: '1 1 100%', alignItems: 'center' }}>
                  {ing.subReceitaId && (
                    <span style={{ fontSize: 10, background: 'var(--teal)', color: '#fff', borderRadius: 4, padding: '2px 5px', flexShrink: 0, fontWeight: 700 }}>R</span>
                  )}
                  <input
                    className="field-input"
                    style={{ flex: 2, marginBottom: 0, fontSize: 13 }}
                    list="ingredientes-list"
                    placeholder="Ingrediente"
                    value={ing.nome}
                    onChange={e => handleIngNome(i, e.target.value)}
                  />
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
        <datalist id="ingredientes-list">
          {(receitas || []).filter(r => String(r.id) !== String(id)).map(r => (
            <option key={`r-${r.id}`} value={r.nome} />
          ))}
          {(insumos || []).map(ins => <option key={`i-${ins.id}`} value={ins.nome} />)}
        </datalist>
        <button className="btn-add-item" onClick={addIng}>+ adicionar ingrediente</button>

        {custoTotal > 0 && (
          <div style={{ margin: '12px 0 4px', padding: '10px 14px', background: 'var(--teal-light)', borderRadius: 8 }}>
            <div style={{ fontSize: 13, color: 'var(--teal)', fontWeight: 600 }}>
              Custo do lote: R$ {custoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            {rendimentoNum > 0 && (
              <div style={{ fontSize: 12, color: 'var(--teal)', marginTop: 4 }}>
                {isWeightUnit ? `Rendimento: ${rendAutoNum.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${form.unidadeGera} (bruto${fatorPerdaNum > 0 ? ` −${fatorPerdaNum}%` : ''})` : `Rendimento: ${rendimentoNum} ${form.unidadeGera || 'un'}`}
                {custoUnid > 0 && (
                  <span style={{ marginLeft: 10, fontWeight: 600 }}>
                    → R$ {custoUnid.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}/{form.unidadeGera || 'un'}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        <div className="section-label" style={{ marginTop: 16 }}>Forno <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', fontSize: 11 }}>(opcional)</span></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div className="field-label">Temperatura (°C)</div>
            <input className="field-input" type="text" inputMode="numeric" placeholder="ex: 180" value={form.tempForno} onChange={e => setField('tempForno', e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="field-label">Tempo (min)</div>
            <input className="field-input" type="text" inputMode="numeric" placeholder="ex: 35" value={form.tempoForno} onChange={e => setField('tempoForno', e.target.value)} />
          </div>
        </div>

        <div className="section-label" style={{ marginTop: 16 }}>Resfriamento / Congelamento <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', fontSize: 11 }}>(opcional)</span></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div className="field-label">Tipo</div>
            <select className="field-input" value={form.tipoResfriamento} onChange={e => setField('tipoResfriamento', e.target.value)}>
              <option value="">Nenhum</option>
              <option value="geladeira">Geladeira</option>
              <option value="congelador">Congelador</option>
              <option value="ambiente">Temperatura ambiente</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <div className="field-label">Tempo mínimo (horas)</div>
            <input className="field-input" type="text" inputMode="decimal" placeholder="ex: 2" value={form.tempoResfriamento} onChange={e => setField('tempoResfriamento', e.target.value)} disabled={!form.tipoResfriamento} />
          </div>
        </div>

        <div className="section-label" style={{ marginTop: 16 }}>Modo de preparo</div>
        <StepBuilder steps={steps} onChange={setSteps} />

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
    </>
  )
}
