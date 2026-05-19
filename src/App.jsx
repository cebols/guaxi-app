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

const NAV_BOTTOM = [
  { path: '/',        label: 'Início',   icon: HomeIcon },
  { path: '/pedidos', label: 'Pedidos',  icon: PedidosIcon },
  { path: '/fichas',  label: 'Receitas', icon: FichasIcon },
  { path: '/vendas',  label: 'Vendas',   icon: VendasIcon },
]

const MENU_GROUPS = [
  {
    label: 'Produção do dia',
    items: [
      { path: '/mise-en-place', label: 'Planejar produção', sub: 'Organize o que fazer hoje', icon: MiseIcon },
      { path: '/contagem',      label: 'Estoque',           sub: 'Contagem de ingredientes',  icon: ContagemIcon },
    ],
  },
  {
    label: 'Cadastros',
    items: [
      { path: '/produtos',      label: 'Produtos',        sub: 'Cardápio e preços',         icon: ProdutosIcon },
      { path: '/cadastros',     label: 'Insumos',         sub: 'Ingredientes e embalagens', icon: CadastrosIcon },
      { path: '/configuracoes', label: 'Preços e custos', sub: 'Precificação e margens',    icon: ConfigIcon },
    ],
  },
]

const SIDEBAR_GROUPS = [
  { label: 'Dia a dia',  items: NAV_BOTTOM },
  { label: 'Produção',   items: MENU_GROUPS[0].items },
  { label: 'Cadastros',  items: MENU_GROUPS[1].items },
]

function isActive(path, pathname) {
  return path === '/' ? pathname === '/' : pathname.startsWith(path)
}

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
        {SIDEBAR_GROUPS.map(({ label, items }) => (
          <div key={label} style={{ marginBottom: 8 }}>
            <div style={{
              fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase',
              letterSpacing: '0.08em', fontWeight: 700, padding: '14px 12px 6px',
            }}>
              {label}
            </div>
            {items.map(({ path, label: itemLabel, icon: Icon }) => {
              const active = isActive(path, location.pathname)
              return (
                <button
                  key={path}
                  className={`sidebar-item ${active ? 'active' : ''}`}
                  onClick={() => navigate(path)}
                >
                  <Icon />
                  <span>{itemLabel}</span>
                </button>
              )
            })}
          </div>
        ))}
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
  const { isAuthenticated, loading, session, signOut } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    initConfig(session?.user?.id ?? null)
    if (session?.user?.id) syncConfigFromSupabase()
  }, [session?.user?.id])

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  if (loading) return <div className="loading" style={{ minHeight: '100dvh' }}>Carregando...</div>
  if (!isAuthenticated) return <Login />

  const isReceitaForm = location.pathname.match(/^\/fichas\/(nova|\d+\/editar)/)
  const menuActive = MENU_GROUPS.flatMap(g => g.items).some(n => location.pathname.startsWith(n.path))

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
          {NAV_BOTTOM.map(({ path, label, icon: Icon }) => {
            const active = isActive(path, location.pathname)
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
            className={`nav-item ${menuActive || menuOpen ? 'active' : ''}`}
            onClick={() => setMenuOpen(o => !o)}
          >
            <MenuIcon />
            <span>Menu</span>
            <div className="nav-indicator" />
          </button>
        </nav>
      )}

      {menuOpen && (
        <>
          <div className="sheet-overlay" style={{ zIndex: 45 }} onClick={() => setMenuOpen(false)} />
          <div className="sheet" style={{ zIndex: 55, paddingBottom: 80, paddingLeft: 0, paddingRight: 0 }}>
            <div style={{ width: 36, height: 4, background: 'var(--bg-secondary)', borderRadius: 2, margin: '4px auto 12px' }} />
            {MENU_GROUPS.map(({ label, items }) => (
              <div key={label} style={{ marginBottom: 18 }}>
                <div style={{
                  fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase',
                  letterSpacing: '0.06em', fontWeight: 700,
                  padding: '0 16px 8px',
                }}>
                  {label}
                </div>
                {items.map(({ path, label: itemLabel, sub, icon: Icon }) => {
                  const active = location.pathname.startsWith(path)
                  return (
                    <button
                      key={path}
                      onClick={() => navigate(path)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 14,
                        width: '100%', padding: '13px 16px',
                        background: active ? 'var(--teal-light)' : 'none',
                        border: 'none',
                        color: active ? 'var(--teal)' : 'var(--text-primary)',
                        cursor: 'pointer', textAlign: 'left',
                      }}
                    >
                      <span style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', flexShrink: 0, color: active ? 'var(--teal)' : 'var(--text-secondary)' }}>
                        <Icon />
                      </span>
                      <span style={{ flex: 1 }}>
                        <span style={{ display: 'block', fontSize: 15, fontWeight: 500, color: active ? 'var(--teal)' : 'var(--text-primary)' }}>
                          {itemLabel}
                        </span>
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--text-tertiary)', marginTop: 1 }}>
                          {sub}
                        </span>
                      </span>
                      <span style={{ fontSize: 16, color: 'var(--text-tertiary)', flexShrink: 0 }}>›</span>
                    </button>
                  )
                })}
              </div>
            ))}
            <div style={{ marginBottom: 18 }}>
              <div style={{
                fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase',
                letterSpacing: '0.06em', fontWeight: 700,
                padding: '0 16px 8px',
              }}>
                Conta
              </div>
              <button
                onClick={signOut}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  width: '100%', padding: '13px 16px',
                  background: 'none', border: 'none',
                  color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', flexShrink: 0, color: 'var(--text-secondary)' }}>
                  <SairIcon />
                </span>
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 500 }}>Sair</span>
                </span>
              </button>
            </div>
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
function MenuIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="3" y1="6"  x2="21" y2="6"/>
    <line x1="3" y1="12" x2="21" y2="12"/>
    <line x1="3" y1="18" x2="21" y2="18"/>
  </svg>
}
function SairIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </svg>
}
