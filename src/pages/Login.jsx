import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  const handle = async () => {
    if (!email || !password) { setError('Preencha email e senha'); return }
    setLoading(true)
    setError(null)
    try {
      if (mode === 'login') {
        const { error } = await signIn(email, password)
        if (error) throw error
      } else {
        const { error } = await signUp(email, password)
        if (error) throw error
        setDone(true)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="login-screen">
        <div className="login-logo">🍫</div>
        <div style={{ textAlign: 'center' }}>
          <div className="login-title">Conta criada!</div>
          <div className="login-sub" style={{ marginTop: 6 }}>
            Verifique seu email para confirmar, depois faça login.
          </div>
        </div>
        <button className="btn-primary" style={{ width: 280 }} onClick={() => { setDone(false); setMode('login') }}>
          Ir para login
        </button>
      </div>
    )
  }

  return (
    <div className="login-screen">
      <div className="login-logo">🍫</div>
      <div style={{ textAlign: 'center' }}>
        <div className="login-title">Confeitaria</div>
        <div className="login-sub" style={{ marginTop: 6 }}>
          {mode === 'login' ? 'Gestão de pedidos, estoque e receitas' : 'Criar nova conta'}
        </div>
      </div>

      <div style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input
          className="field-input"
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          style={{ marginBottom: 0 }}
          onKeyDown={e => e.key === 'Enter' && handle()}
        />
        <input
          className="field-input"
          type="password"
          placeholder="Senha"
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={{ marginBottom: 0 }}
          onKeyDown={e => e.key === 'Enter' && handle()}
        />
        {error && (
          <div style={{ fontSize: 13, color: 'var(--alert-text)', textAlign: 'center' }}>{error}</div>
        )}
        <button className="btn-primary" onClick={handle} disabled={loading} style={{ marginTop: 4 }}>
          {loading ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
        </button>
        <button
          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer', marginTop: 4 }}
          onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null) }}
        >
          {mode === 'login' ? 'Primeira vez? Criar conta' : 'Já tenho conta'}
        </button>
      </div>
    </div>
  )
}
