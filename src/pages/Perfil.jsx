import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactCrop, { centerCrop, makeAspectCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../hooks/useToast'
import { loadUserConfig, saveUserConfig } from '../services/db'
import { uploadImage } from '../services/storage'
import { supabase } from '../lib/supabase'

const ESTADOS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']
const CANAIS_OPTS = [
  { value: 'direto',  label: 'Venda Direta' },
  { value: 'ifood',   label: 'iFood' },
  { value: '99food',  label: '99Food' },
]
const AVATAR_RADIUS = 12 // border-radius in px for the mask preview

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

function AvatarDisplay({ url, letter, size = 56 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: AVATAR_RADIUS,
      background: url ? 'transparent' : 'var(--teal)',
      color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 800, overflow: 'hidden', flexShrink: 0,
    }}>
      {url
        ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : letter}
    </div>
  )
}

function getCroppedBlob(image, crop, fileName) {
  const canvas = document.createElement('canvas')
  const scaleX = image.naturalWidth / image.width
  const scaleY = image.naturalHeight / image.height
  const size = 400
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.drawImage(
    image,
    crop.x * scaleX, crop.y * scaleY,
    crop.width * scaleX, crop.height * scaleY,
    0, 0, size, size
  )
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.88))
}

export default function Perfil() {
  const navigate = useNavigate()
  const { user, profile, updateProfile } = useAuth()
  const { toast, show } = useToast()

  const [nomeLoja, setNomeLoja]   = useState('')
  const [estado, setEstado]       = useState('SP')
  const [canais, setCanais]       = useState(['direto'])
  const [endereco, setEndereco]   = useState('')
  const [saving, setSaving]       = useState(false)
  const [sendingReset, setSendingReset] = useState(false)

  // Avatar crop
  const [srcImg, setSrcImg]         = useState(null)
  const [crop, setCrop]             = useState()
  const [completedCrop, setCompleted] = useState(null)
  const [uploadingAvatar, setUploading] = useState(false)
  const imgRef = useRef(null)
  const fileInputRef = useRef(null)

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

  const onFileChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setSrcImg(reader.result)
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const onImageLoad = useCallback((e) => {
    imgRef.current = e.currentTarget
    const { width, height } = e.currentTarget
    const side = Math.min(width, height)
    const c = centerCrop(makeAspectCrop({ unit: 'px', width: side }, 1, width, height), width, height)
    setCrop(c)
    setCompleted(c)
  }, [])

  const handleAvatarSave = async () => {
    if (!completedCrop || !imgRef.current) return
    setUploading(true)
    try {
      const blob = await getCroppedBlob(imgRef.current, completedCrop, 'avatar.jpg')
      const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' })
      const url = await uploadImage(`avatars/${user.id}/avatar.jpg`, file)
      await updateProfile({ avatarUrl: url })
      setSrcImg(null)
      show('Avatar atualizado!')
    } catch (e) {
      show('Erro ao salvar avatar: ' + e.message)
    } finally {
      setUploading(false)
    }
  }

  const toggleCanal = (val) => {
    setCanais(prev => prev.includes(val) ? prev.filter(c => c !== val) : [...prev, val])
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateProfile({ nomeLoja, estado, canais })
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
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, { redirectTo: window.location.origin })
      if (error) throw error
      show('Email de redefinição enviado!')
    } catch (e) {
      show('Erro: ' + e.message)
    } finally {
      setSendingReset(false)
    }
  }

  const avatarLetter = (nomeLoja || user?.email || '?')[0].toUpperCase()

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', padding: '0 4px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <div className="topbar-title">Perfil</div>
          </div>
        </div>
      </div>

      <div className="page-inner" style={{ maxWidth: 560 }}>
        {/* Avatar section */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '18px 0 24px' }}>
          <div style={{ position: 'relative' }}>
            <AvatarDisplay url={profile?.avatarUrl} letter={avatarLetter} size={64} />
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                position: 'absolute', bottom: -6, right: -6,
                width: 24, height: 24, borderRadius: 8,
                background: 'var(--teal)', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, color: '#000',
              }}
              title="Trocar foto"
            >✎</button>
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{nomeLoja || '—'}</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>{user?.email}</div>
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{ fontSize: 12, color: 'var(--teal)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 4 }}
            >Trocar foto de perfil</button>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFileChange} />
        </div>

        {/* Crop modal */}
        {srcImg && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(0,0,0,.85)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 20, padding: 24,
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>Ajustar foto de perfil</div>

            {/* Crop area */}
            <ReactCrop
              crop={crop}
              onChange={c => setCrop(c)}
              onComplete={c => setCompleted(c)}
              aspect={1}
              minWidth={60}
              style={{ maxHeight: '55dvh', borderRadius: 12, overflow: 'hidden' }}
            >
              <img
                src={srcImg}
                onLoad={onImageLoad}
                style={{ maxHeight: '55dvh', maxWidth: '80vw', display: 'block' }}
                alt="crop"
              />
            </ReactCrop>

            {/* Preview with mask */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#888', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.05em' }}>Preview</div>
                <AvatarPreview imgRef={imgRef} crop={completedCrop} size={56} />
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#888', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.05em' }}>Sidebar</div>
                <AvatarPreview imgRef={imgRef} crop={completedCrop} size={28} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setSrcImg(null)}
                style={{ padding: '11px 24px', borderRadius: 10, border: '1px solid #444', background: 'transparent', color: '#ccc', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}
              >Cancelar</button>
              <button
                onClick={handleAvatarSave}
                disabled={uploadingAvatar}
                style={{ padding: '11px 28px', borderRadius: 10, background: 'var(--teal)', color: '#000', border: 'none', fontWeight: 700, cursor: 'pointer', fontSize: 14, opacity: uploadingAvatar ? 0.6 : 1 }}
              >{uploadingAvatar ? 'Salvando...' : 'Salvar foto'}</button>
            </div>
          </div>
        )}

        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 16 }}>Dados da loja</div>

          <Field label="Nome da loja">
            <Input value={nomeLoja} onChange={e => setNomeLoja(e.target.value)} placeholder="Ex: Guaxi Pâtisserie" />
          </Field>

          <Field label="Estado">
            <select value={estado} onChange={e => setEstado(e.target.value)} style={{
              width: '100%', padding: '11px 14px', borderRadius: 10,
              background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              color: 'var(--text-primary)', fontSize: 15, fontFamily: 'inherit', outline: 'none',
            }}>
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
          <button onClick={handleResetPassword} disabled={sendingReset} style={{
            padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)',
            opacity: sendingReset ? 0.6 : 1,
          }}>
            {sendingReset ? 'Enviando...' : '🔑 Redefinir senha por email'}
          </button>
        </div>

        <button onClick={handleSave} disabled={saving} style={{
          width: '100%', padding: 14, borderRadius: 12,
          background: 'var(--teal)', color: '#000', border: 'none',
          fontWeight: 700, fontSize: 15, cursor: 'pointer',
          opacity: saving ? 0.6 : 1, marginBottom: 32,
        }}>
          {saving ? 'Salvando...' : 'Salvar perfil'}
        </button>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </>
  )
}

// Live canvas preview of the cropped area
function AvatarPreview({ imgRef, crop, size }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!crop || !imgRef.current || !canvasRef.current) return
    const img = imgRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const scaleX = img.naturalWidth / img.width
    const scaleY = img.naturalHeight / img.height
    canvas.width = size
    canvas.height = size
    ctx.clearRect(0, 0, size, size)
    ctx.drawImage(img, crop.x * scaleX, crop.y * scaleY, crop.width * scaleX, crop.height * scaleY, 0, 0, size, size)
  }, [crop, size])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, borderRadius: AVATAR_RADIUS, display: 'block' }}
    />
  )
}
