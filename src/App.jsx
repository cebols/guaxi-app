import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuth } from './contexts/AuthContext'
import { initConfig, syncConfigFromSupabase } from './hooks/useConfig'
import Login from './pages/Login'
import Home from './pages/Home'
import Pedidos from './pages/Pedidos'
import Contagem from './pages/Contagem'
import Fichas from './pages/Fichas'
import Cozinha from './pages/Cozinha'
import ReceitaForm from './pages/ReceitaForm'
import Cadastros from './pages/Cadastros'
import Configuracoes from './pages/Configuracoes'
import Produtos from './pages/Produtos'
import Vendas from './pages/Vendas'
import MiseEnPlace from './pages/MiseEnPlace'

const NAV = [
  { path: '/',               label: 'Home',          icon: HomeIcon },
  { path: '/pedidos',        label: 'Pedidos',        icon: PedidosIcon },
  { path: '/vendas',         label: 'Vendas',         icon: VendasIcon },
  { path: '/fichas',         label: 'Receitas',       icon: FichasIcon },
  { path: '/contagem',       label: 'Contagem',       icon: ContagemIcon },
  { path: '/produtos',       label: 'Produtos',       icon: ProdutosIcon },
  { path: '/mise-en-place',  label: 'Mise en place',  icon: MiseIcon },
  { path: '/cadastros',      label: 'Insumos',        icon: CadastrosIcon },
  { path: '/configuracoes',  label: 'Preços',         icon: ConfigIcon },
]

const NAV_BOTTOM_FIXED = NAV.slice(0, 4)   // Home Pedidos Vendas Receitas
const NAV_MAIS         = NAV.slice(4)       // Contagem Produtos Mise Insumos Preços

function Sidebar() {
  const { user, signOut } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const primeiroNome = user?.email?.split('@')[0] || ''

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">🍫</div>
        <div className="sidebar-logo-name">Guaxi</div>
      </div>
      <nav className="sidebar-nav">
        {NAV.map(({ path, label, icon: Icon }) => {
          const active = path === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(path)
          return (
            <button
              key={path}
              className={`sidebar-item ${active ? 'active' : ''}`}
              onClick={() => navigate(path)}
            >
              <Icon />
              <span>{label}</span>
            </button>
          )
        })}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="avatar" style={{ width: 28, height: 28, fontSize: 12, flexShrink: 0 }}>
            {primeiroNome.charAt(0).toUpperCase()}
          </div>
          <span className="sidebar-user-email">{user?.email}</span>
        </div>
        <button className="btn-ghost" style={{ width: '100%', fontSize: 13, textAlign: 'center' }} onClick={signOut}>
          Sair
        </button>
      </div>
    </aside>
  )
}

export default function App() {
  const { isAuthenticated, loading, session } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [maisOpen, setMaisOpen] = useState(false)

  useEffect(() => {
    initConfig(session?.user?.id ?? null)
    if (session?.user?.id) syncConfigFromSupabase()
  }, [session?.user?.id])

  useEffect(() => {
    setMaisOpen(false)
  }, [location.pathname])

  if (loading) return <div className="loading" style={{ minHeight: '100dvh' }}>Carregando...</div>
  if (!isAuthenticated) return <Login />

  const isReceitaForm = location.pathname.match(/^\/fichas\/(nova|\d+\/editar)/)
  const maisActive = NAV_MAIS.some(n => location.pathname.startsWith(n.path))

  return (
    <div className="app-shell">
      <Sidebar />

      <div className="main-content">
        <Routes>
          <Route path="/"                    element={<Home />} />
          <Route path="/pedidos"             element={<Pedidos />} />
          <Route path="/contagem"            element={<Contagem />} />
          <Route path="/fichas"              element={<Fichas />} />
          <Route path="/fichas/nova"         element={<ReceitaForm />} />
          <Route path="/fichas/:id"          element={<Cozinha />} />
          <Route path="/fichas/:id/editar"   element={<ReceitaForm />} />
          <Route path="/cadastros"           element={<Cadastros />} />
          <Route path="/produtos"            element={<Produtos />} />
          <Route path="/vendas"              element={<Vendas />} />
          <Route path="/mise-en-place"       element={<MiseEnPlace />} />
          <Route path="/configuracoes"       element={<Configuracoes />} />
          <Route path="*"                    element={<Navigate to="/" />} />
        </Routes>
      </div>

      {!isReceitaForm && (
        <nav className="bottom-nav">
          {NAV_BOTTOM_FIXED.map(({ path, label, icon: Icon }) => {
            const active = path === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(path)
            return (
              <button
                key={path}
                className={`nav-item ${active ? 'active' : ''}`}
                onClick={() => navigate(path)}
              >
                <Icon />
                <span>{label}</span>
                <div className="nav-indicator" />
              </button>
            )
          })}
          <button
            className={`nav-item ${maisActive || maisOpen ? 'active' : ''}`}
            onClick={() => setMaisOpen(o => !o)}
          >
            <MaisIcon />
            <span>Mais</span>
            <div className="nav-indicator" />
          </button>
        </nav>
      )}

      {maisOpen && (
        <>
          <div className="sheet-overlay" style={{ zIndex: 45 }} onClick={() => setMaisOpen(false)} />
          <div className="sheet" style={{ zIndex: 55, paddingBottom: 80 }}>
            <div className="sheet-title">
              <span>Menu</span>
              <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer' }} onClick={() => setMaisOpen(false)}>×</button>
            </div>
            {NAV_MAIS.map(({ path, label, icon: Icon }) => {
              const active = location.pathname.startsWith(path)
              return (
                <button
                  key={path}
                  onClick={() => navigate(path)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    width: '100%', padding: '14px 8px',
                    background: active ? 'var(--teal-subtle, rgba(20,184,166,.1))' : 'none',
                    border: 'none', borderBottom: '1px solid var(--border)',
                    borderRadius: active ? 10 : 0,
                    color: active ? 'var(--teal)' : 'var(--text-primary)',
                    fontSize: 15, fontWeight: active ? 600 : 400,
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', color: active ? 'var(--teal)' : 'var(--text-secondary)' }}>
                    <Icon />
                  </span>
                  {label}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function HomeIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
}
function PedidosIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
    <rect x="9" y="3" width="6" height="4" rx="1"/>
    <line x1="9" y1="12" x2="15" y2="12"/>
    <line x1="9" y1="16" x2="13" y2="16"/>
  </svg>
}
function ContagemIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="9 11 12 14 22 4"/>
    <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
  </svg>
}
function FichasIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
    <polyline points="10 9 9 9 8 9"/>
  </svg>
}
function VendasIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
    <polyline points="17 6 23 6 23 12"/>
  </svg>
}
function ProdutosIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
    <line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>
}
function CadastrosIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14"/>
  </svg>
}
function ConfigIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="1" x2="12" y2="23"/>
    <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
  </svg>
}
function MiseIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 11l3 3L22 4"/>
    <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
  </svg>
}
function MaisIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>
    <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/>
  </svg>
}
