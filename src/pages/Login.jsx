import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  )
}

export default function Login() {
  const { signInWithGoogle } = useAuth()
  const [loading, setLoading] = useState(false)

  const handleGoogle = async () => {
    setLoading(true)
    await signInWithGoogle()
  }

  return (
    <div style={{
      minHeight: '100dvh', background: '#0a0a0a',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', padding: '0 24px',
    }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
        <div style={{
          width: 80, height: 80, background: '#0d3326', borderRadius: 20,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40,
        }}>
          🍫
        </div>
        <div style={{ fontWeight: 800, fontSize: 30, color: '#fff', letterSpacing: -0.5 }}>Guaxí</div>
        <div style={{ fontSize: 15, color: '#888', textAlign: 'center', maxWidth: 280, lineHeight: 1.6 }}>
          Gestão de confeitaria — receitas, estoque, vendas e pedidos num só lugar.
        </div>
      </div>

      <div style={{ width: '100%', maxWidth: 400, paddingBottom: 36 }}>
        <button
          onClick={handleGoogle}
          disabled={loading}
          style={{
            width: '100%', padding: '15px 20px', borderRadius: 14,
            background: '#fff', border: 'none', cursor: loading ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            fontSize: 16, fontWeight: 600, color: '#1a1a1a',
            opacity: loading ? 0.7 : 1,
          }}
        >
          <GoogleIcon />
          {loading ? 'Aguarde...' : 'Continuar com Google'}
        </button>
        <div style={{ textAlign: 'center', fontSize: 12, color: '#555', marginTop: 14, lineHeight: 1.5 }}>
          Ao continuar, você concorda com os<br />termos de uso e privacidade.
        </div>
      </div>
    </div>
  )
}
