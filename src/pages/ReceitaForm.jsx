import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { getReceitas, saveReceita, deleteReceita, getInsumos } from '../services/db'

const TIPO_OPTS = ['Bolo', 'Torta', 'Massa', 'Recheio', 'Cobertura', 'Base', 'Produto Final', 'Outro']

export default function ReceitaForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { toast, show } = useToast()
  const isEdit = !!id && id !== 'nova'

  const { data: receitas, loading: loadRec } = useData(getReceitas)
  const { data: insumos, loading: loadIns } = useData(getInsumos)

  const [form, setForm] = useState({
    nome: '', tipo: 'Outro', rendimento: '', unidadeGera: 'un', pesoLiquido: '',
  })
  const [ingredientes, setIngredientes] = useState([
    { insumoId: null, nome: '', quantidade: '', unidade: 'g' },
    { insumoId: null, nome: '', quantidade: '', unidade: 'g' },
    { insumoId: null, nome: '', quantidade: '', unidade: 'g' },
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
      pesoLiquido: rec.pesoLiquido || '',
    })
    if (rec.ingredientes?.length > 0) {
      setIngredientes(rec.ingredientes.map(i => ({
        insumoId: i.insumoId || null,
        nome: i.nome,
        quantidade: i.quantidade,
        unidade: i.unidade,
      })))
    }
  }, [receitas, id, isEdit])

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleIngNome = (i, nome) => {
    const found = insumos?.find(ins => ins.nome === nome)
    setIngredientes(prev => prev.map((it, idx) =>
      idx === i ? {
        ...it,
        nome,
        insumoId: found?.id ?? null,
        unidade: found ? found.unidade : it.unidade,
      } : it
    ))
  }

  const setIng = (i, k, v) => setIngredientes(prev => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it))
  const addIng = () => setIngredientes(prev => [...prev, { insumoId: null, nome: '', quantidade: '', unidade: 'g' }])
  const removeIng = i => setIngredientes(prev => prev.filter((_, idx) => idx !== i))

  const ingCusto = (ing) => {
    const insumo = insumos?.find(ins => ins.id === ing.insumoId || ins.nome === ing.nome)
    if (!insumo?.custoUnit || !ing.quantidade) return 0
    return (parseFloat(ing.quantidade) || 0) * insumo.custoUnit
  }

  const custoTotal = useMemo(() =>
    ingredientes.reduce((s, ing) => s + ingCusto(ing), 0),
    [ingredientes, insumos]
  )

  const rendimentoNum = parseFloat(form.rendimento) || 0
  const custoUnid = rendimentoNum > 0 ? custoTotal / rendimentoNum : 0

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
        { ...form, id: isEdit ? parseInt(id) : undefined, custoTotal, custoUnid },
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
            <select className="field-input" value={form.tipo} onChange={e => setField('tipo', e.target.value)}>
              {TIPO_OPTS.map(t => <option key={t}>{t}</option>)}
            </select>
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
          <div>
            <div className="field-label">Rendimento — qtd de {form.unidadeGera || 'unidades'}</div>
            <input className="field-input" type="number" min="0" placeholder="ex: 12" value={form.rendimento} onChange={e => setField('rendimento', e.target.value)} />
          </div>
        </div>

        <div className="field-row">
          <div style={{ flex: 1 }}>
            <div className="field-label">
              Peso líquido após assar (g)
              <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 6 }}>— opcional, para calcular perda</span>
            </div>
            <input
              className="field-input"
              type="number"
              min="0"
              placeholder={rendimentoBruto > 0 ? `Bruto: ${rendimentoBruto >= 1000 ? `${(rendimentoBruto/1000).toFixed(2)} kg` : `${rendimentoBruto.toFixed(0)} g`}` : 'ex: 450'}
              value={form.pesoLiquido}
              onChange={e => setField('pesoLiquido', e.target.value)}
            />
          </div>
        </div>

        <div className="section-label" style={{ marginTop: 4 }}>Ingredientes</div>
        <div className="card card-flush" style={{ padding: '0 14px' }}>
          {ingredientes.map((ing, i) => {
            const custo = ingCusto(ing)
            return (
              <div key={i} className="ing-form-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                <div style={{ display: 'flex', gap: 6, flex: '1 1 100%', alignItems: 'center' }}>
                  <input
                    className="field-input"
                    style={{ flex: 2, marginBottom: 0, fontSize: 13 }}
                    list="insumos-list"
                    placeholder="Ingrediente"
                    value={ing.nome}
                    onChange={e => handleIngNome(i, e.target.value)}
                  />
                  <input
                    className="item-qty"
                    type="number"
                    min="0"
                    step="0.1"
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
        <datalist id="insumos-list">
          {(insumos || []).map(ins => <option key={ins.id} value={ins.nome} />)}
        </datalist>
        <button className="btn-add-item" onClick={addIng}>+ adicionar ingrediente</button>

        {(custoTotal > 0 || rendimentoBruto > 0) && (() => {
          const pesoLiq = parseFloat(form.pesoLiquido) || 0
          const fatorPerda = pesoLiq > 0 && rendimentoBruto > 0
            ? Math.max(0, ((rendimentoBruto - pesoLiq) / rendimentoBruto) * 100)
            : null
          const fmtPeso = g => g >= 1000
            ? `${(g / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg`
            : `${g.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} g`
          return (
            <div style={{ margin: '12px 0 4px', padding: '10px 14px', background: 'var(--teal-light)', borderRadius: 8 }}>
              {rendimentoBruto > 0 && (
                <div style={{ fontSize: 12, color: 'var(--teal)', marginBottom: 2 }}>
                  Peso bruto dos ingredientes: <strong>{fmtPeso(rendimentoBruto)}</strong>
                </div>
              )}
              {pesoLiq > 0 && (
                <div style={{ fontSize: 12, color: 'var(--teal)', marginBottom: 4 }}>
                  Peso líquido (pós-forno): <strong>{fmtPeso(pesoLiq)}</strong>
                  {fatorPerda !== null && (
                    <span style={{ color: 'var(--text-secondary)', marginLeft: 6 }}>
                      — perda {fatorPerda.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                    </span>
                  )}
                </div>
              )}
              {custoTotal > 0 && (
                <div style={{ fontSize: 13, color: 'var(--teal)', fontWeight: 600, marginTop: 4 }}>
                  Custo do lote: R$ {custoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              )}
              {rendimentoNum > 0 && (
                <div style={{ fontSize: 12, color: 'var(--teal)', marginTop: 2 }}>
                  Rendimento: {rendimentoNum} {form.unidadeGera || 'un'}
                  {custoUnid > 0 && (
                    <span style={{ marginLeft: 10, fontWeight: 600 }}>
                      → R$ {custoUnid.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}/{form.unidadeGera || 'un'}
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })()}

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
