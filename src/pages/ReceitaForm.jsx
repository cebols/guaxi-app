import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useData } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { getReceitas, saveReceita, deleteReceita } from '../services/db'

const TIPO_OPTS = ['Massa', 'Recheio', 'Cobertura', 'Base', 'Outro']
const UNID_OPTS = ['g', 'ml', 'un', 'kg', 'L']

export default function ReceitaForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { toast, show } = useToast()
  const isEdit = !!id && id !== 'nova'

  const { data: receitas, loading } = useData(getReceitas)

  const [form, setForm] = useState({
    nome: '', tipo: 'Outro', rendimento: '', custoTotal: '', custoUnid: '',
  })
  const [ingredientes, setIngredientes] = useState([{ nome: '', quantidade: '', unidade: 'g' }])
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
      custoTotal: rec.custoTotal || '',
      custoUnid: rec.custoUnid || '',
    })
    if (rec.ingredientes?.length > 0) {
      setIngredientes(rec.ingredientes.map(i => ({ nome: i.nome, quantidade: i.quantidade, unidade: i.unidade })))
    }
  }, [receitas, id, isEdit])

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setIng = (i, k, v) => setIngredientes(prev => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it))
  const addIng = () => setIngredientes(prev => [...prev, { nome: '', quantidade: '', unidade: 'g' }])
  const removeIng = (i) => setIngredientes(prev => prev.filter((_, idx) => idx !== i))

  const handleSave = async () => {
    if (!form.nome) { show('Preencha o nome da receita'); return }
    setSaving(true)
    try {
      const ings = ingredientes.filter(i => i.nome && i.quantidade)
      const recId = await saveReceita(
        { ...form, id: isEdit ? parseInt(id) : undefined },
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

  if (loading && isEdit) return <div className="loading">Carregando...</div>

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
            <div className="field-label">Rendimento (un)</div>
            <input className="field-input" type="number" min="0" placeholder="0" value={form.rendimento} onChange={e => setField('rendimento', e.target.value)} />
          </div>
        </div>

        <div className="field-row">
          <div>
            <div className="field-label">Custo lote (R$)</div>
            <input className="field-input" type="number" min="0" step="0.01" placeholder="0,00" value={form.custoTotal} onChange={e => setField('custoTotal', e.target.value)} />
          </div>
          <div>
            <div className="field-label">Custo/unidade (R$)</div>
            <input className="field-input" type="number" min="0" step="0.01" placeholder="0,00" value={form.custoUnid} onChange={e => setField('custoUnid', e.target.value)} />
          </div>
        </div>

        <div className="section-label" style={{ marginTop: 4 }}>Ingredientes</div>
        <div className="card card-flush" style={{ padding: '0 14px' }}>
          {ingredientes.map((ing, i) => (
            <div key={i} className="ing-form-row">
              <input
                className="field-input"
                style={{ flex: 2, marginBottom: 0, fontSize: 13 }}
                placeholder="Ingrediente"
                value={ing.nome}
                onChange={e => setIng(i, 'nome', e.target.value)}
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
              <select
                style={{ width: 54, padding: '6px 4px', border: '1px solid #333', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                value={ing.unidade}
                onChange={e => setIng(i, 'unidade', e.target.value)}
              >
                {UNID_OPTS.map(u => <option key={u}>{u}</option>)}
              </select>
              {ingredientes.length > 1 && (
                <button className="item-rm" onClick={() => removeIng(i)}>&#215;</button>
              )}
            </div>
          ))}
        </div>
        <button className="btn-add-item" onClick={addIng}>+ adicionar ingrediente</button>

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
