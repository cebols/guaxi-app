import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../hooks/useToast'
import { loadUserConfig, saveUserConfig } from '../services/db'
import { supabase } from '../lib/supabase'

const ESTADOS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']
const CANAIS_OPTS = [
  { value: 'direto',  label: 'Venda Direta' },
  { value: 'ifood',   label: 'iFood' },
  { value: '99food',  label: '99Food' },
]

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  )
}

function Input({ ...props }) {
  return (
    <input style={{
      width: '100%', padding: '11px 14px', borderRadius: 10,
      background: 'var(--bg-secondary)', border: '1px solid var(--border)',
      color: 'var(--text-primary)', fontSize: 15, fontFamily: 'inherit', outline: 'none',
      boxSizing: 'border-box',
    }} {...props} />
  )
}

export default function Perfil() {
  const { user, profile, updateProfile } = useAuth()
  const { toast, show } = useToast()

  const [nomeLoja, setNomeLoja]   = useState('')
  const [estado, setEstado]       = useState('SP')
  const [canais, setCanais]       = useState(['direto'])
  const [endereco, setEndereco]   = useState('')
  const [saving, setSaving]       = useState(false)
  const [sendingReset, setSendingReset] = useState(false)

  useEffect(() => {
    if (profile) {
      setNomeLoja(profile.nomeLoja || '')
      setEstado(profile.estado || 'SP')
      setCanais(profile.canais || ['direto'])
    }
    loadUserConfig().then(cfg => {
      if (cfg?.delivery?.lojaEndereco) setEndereco(cfg.delivery.lojaEndereco)
    }).catch(() => {})
  }, [profile?.nomeLoja])

  const toggleCanal = (val) => {
    setCanais(prev =>
      prev.includes(val) ? prev.filter(c => c !== val) : [...prev, val]
    )
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateProfile({ nomeLoja, estado, canais })
      // Update lojaEndereco in delivery config
      const cfg = await loadUserConfig()
      await saveUserConfig({ ...(cfg || {}), delivery: { ...(cfg?.delivery || {}), lojaEndereco: endereco } })
      show('Perfil salvo!')
    } catch (e) {
      show('Erro ao salvar: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleResetPassword = async () => {
    if (!user?.email) return
    setSendingReset(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: window.location.origin,
      })
      if (error) throw error
      show('Email de redefinição enviado!')
    } catch (e) {
      show('Erro: ' + e.message)
    } finally {
      setSendingReset(false)
    }
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div className="topbar-title">Perfil</div>
        </div>
      </div>

      <div className="page-inner" style={{ maxWidth: 560 }}>
        {/* Avatar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28, padding: '18px 0 10px' }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'var(--teal)', color: '#000',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, fontWeight: 800, flexShrink: 0,
          }}>
            {(nomeLoja || user?.email || '?')[0].toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.2 }}>{nomeLoja || '—'}</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>{user?.email}</div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 16 }}>Dados da loja</div>

          <Field label="Nome da loja">
            <Input value={nomeLoja} onChange={e => setNomeLoja(e.target.value)} placeholder="Ex: Guaxi Pâtisserie" />
          </Field>

          <Field label="Estado">
            <select
              value={estado}
              onChange={e => setEstado(e.target.value)}
              style={{
                width: '100%', padding: '11px 14px', borderRadius: 10,
                background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                color: 'var(--text-primary)', fontSize: 15, fontFamily: 'inherit', outline: 'none',
              }}
            >
              {ESTADOS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
            </select>
          </Field>

          <Field label="Endereço da loja (opcional)">
            <Input value={endereco} onChange={e => setEndereco(e.target.value)} placeholder="Rua, número, bairro..." />
          </Field>

          <Field label="Canais de venda">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {CANAIS_OPTS.map(c => {
                const on = canais.includes(c.value)
                return (
                  <button key={c.value} onClick={() => toggleCanal(c.value)} style={{
                    padding: '8px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    border: `1.5px solid ${on ? 'var(--teal)' : 'var(--border)'}`,
                    background: on ? 'rgba(34,184,134,.12)' : 'transparent',
                    color: on ? 'var(--teal)' : 'var(--text-secondary)',
                  }}>{c.label}</button>
                )
              })}
            </div>
          </Field>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 16 }}>Conta</div>

          <Field label="Email">
            <Input value={user?.email || ''} readOnly style={{ color: 'var(--text-secondary)', background: 'var(--bg-card)' }} />
          </Field>

          <button
            onClick={handleResetPassword}
            disabled={sendingReset}
            style={{
              padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)',
              opacity: sendingReset ? 0.6 : 1,
            }}
          >
            {sendingReset ? 'Enviando...' : '🔑 Redefinir senha por email'}
          </button>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            width: '100%', padding: 14, borderRadius: 12,
            background: 'var(--teal)', color: '#000', border: 'none',
            fontWeight: 700, fontSize: 15, cursor: 'pointer',
            opacity: saving ? 0.6 : 1, marginBottom: 32,
          }}
        >
          {saving ? 'Salvando...' : 'Salvar perfil'}
        </button>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
