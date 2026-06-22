import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState, lazy, Suspense, useRef } from 'react'
import { useAuth } from './contexts/AuthContext'
import { initConfig, syncConfigFromSupabase } from './hooks/useConfig'
import { fixSubreceitasRetroativas, loadUserConfig, saveUserConfig } from './services/db'
import { useRealtimePedidos } from './hooks/useRealtimePedidos'
import Login from './pages/Login'

const Onboarding   = lazy(() => import('./pages/Onboarding'))
const Home         = lazy(() => import('./pages/Home'))
const Pedidos      = lazy(() => import('./pages/Pedidos'))
const Envios       = lazy(() => import('./pages/Envios'))
const Contagem     = lazy(() => import('./pages/Contagem'))
const Fichas       = lazy(() => import('./pages/Fichas'))
const Cozinha      = lazy(() => import('./pages/Cozinha'))
const ReceitaForm  = lazy(() => import('./pages/ReceitaForm'))
const Cadastros    = lazy(() => import('./pages/Cadastros'))
const Configuracoes = lazy(() => import('./pages/Configuracoes'))
const Perfil        = lazy(() => import('./pages/Perfil'))
const Produtos     = lazy(() => import('./pages/Produtos'))
const Vendas       = lazy(() => import('./pages/Vendas'))
const MiseEnPlace       = lazy(() => import('./pages/MiseEnPlace'))
const ProducaoTodo      = lazy(() => import('./pages/ProducaoTodo'))
const ProducaoHistorico = lazy(() => import('./pages/ProducaoHistorico'))
const CardapioPublico = lazy(() => import('./pages/CardapioPublico'))
const PedidoExterno   = lazy(() => import('./pages/PedidoExterno'))
const Menu            = lazy(() => import('./pages/Menu'))

function PageFallback() {
  return <div className="loading" style={{ minHeight: '60dvh' }}>Carregando...</div>
}

// Used by sidebar only
const NAV_BOTTOM = [
  { path: '/',        label: 'Início',   icon: HomeIcon },
  { path: '/pedidos', label: 'Pedidos',  icon: PedidosIcon },
  { path: '/envios',  label: 'Envios',   icon: EnviosIcon },
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
      { path: '/perfil',        label: 'Perfil',          sub: 'Dados da loja e conta',     icon: PerfilIcon },
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

function Sidebar({ collapsed, onToggle }) {
  const { user, signOut, profile } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const primeiroNome = user?.email?.split('@')[0] || ''

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-logo">
        {!collapsed && <div className="sidebar-logo-icon">🍫</div>}
        {!collapsed && <div className="sidebar-logo-name">Guaxi</div>}
        <button
          className="sidebar-toggle"
          onClick={onToggle}
          title={collapsed ? 'Expandir menu' : 'Recolher menu'}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>
      <nav className="sidebar-nav">
        {SIDEBAR_GROUPS.map(({ label, items }) => (
          <div key={label} style={{ marginBottom: 8 }}>
            {!collapsed && (
              <div style={{
                fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase',
                letterSpacing: '0.08em', fontWeight: 700, padding: '14px 12px 6px',
              }}>
                {label}
              </div>
            )}
            {collapsed && <div style={{ height: 10 }} />}
            {items.map(({ path, label: itemLabel, icon: Icon }) => {
              const active = isActive(path, location.pathname)
              return (
                <button
                  key={path}
                  className={`sidebar-item ${active ? 'active' : ''}`}
                  onClick={() => navigate(path)}
                  title={collapsed ? itemLabel : undefined}
                >
                  <Icon />
                  {!collapsed && <span>{itemLabel}</span>}
                </button>
              )
            })}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        {!collapsed ? (
          <>
            <div className="sidebar-user">
              <div className="avatar" style={{ width: 28, height: 28, fontSize: 12, flexShrink: 0 }}>
                {profile?.avatarUrl
                  ? <img src={profile.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : primeiroNome.charAt(0).toUpperCase()}
              </div>
              <span className="sidebar-user-email">{user?.email}</span>
            </div>
            <button className="btn-ghost" style={{ width: '100%', fontSize: 13, textAlign: 'center' }} onClick={signOut}>
              Sair
            </button>
          </>
        ) : (
          <button
            onClick={signOut}
            title="Sair"
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '8px', display: 'flex', justifyContent: 'center', width: '100%' }}
          >
            <SairIcon />
          </button>
        )}
      </div>
    </aside>
  )
}

function CreateSheet({ onClose, navigate }) {
  const items = [
    { icon: '📋', label: 'Pedido',   desc: 'Nova encomenda',          path: '/pedidos',    state: { openNew: true } },
    { icon: '💰', label: 'Venda',    desc: 'Registrar venda avulsa',  path: '/vendas',     state: { openLancamento: true } },
    { icon: '📄', label: 'Receita',  desc: 'Nova receita ou subreceita', path: '/fichas/nova' },
    { icon: '📦', label: 'Produto',  desc: 'Receita + embalagem → preço', path: '/produtos', state: { openNew: true } },
    { icon: '🧂', label: 'Insumo',   desc: 'Ingrediente ou embalagem', path: '/cadastros', state: { openNew: true } },
    { icon: '📊', label: 'Contagem', desc: 'Contagem de estoque',     path: '/contagem',   state: { startCount: true } },
  ]
  return (
    <>
      <div className="sheet-overlay" onClick={onClose} style={{ zIndex: 45 }} />
      <div className="sheet" style={{ zIndex: 55, paddingBottom: 24, paddingLeft: 16, paddingRight: 16 }}>
        <div style={{ width: 36, height: 4, background: 'var(--bg-secondary)', borderRadius: 2, margin: '4px auto 16px' }} />
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>Criar novo</div>
        {items.map((item, i) => (
          <button
            key={i}
            onClick={() => { onClose(); navigate(item.path, item.state ? { state: item.state } : undefined) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 0', cursor: 'pointer',
              background: 'none', border: 'none',
              borderBottom: i < items.length - 1 ? '0.5px solid var(--border-light-color)' : 'none',
              width: '100%',
            }}
          >
            <div style={{
              width: 36, height: 36, borderRadius: 10, background: 'var(--teal-light)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, flexShrink: 0,
            }}>{item.icon}</div>
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{item.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>{item.desc}</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6 4l4 4-4 4" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        ))}
      </div>
    </>
  )
}

export default function App() {
  const { isAuthenticated, loading, session, signOut, profile } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  useEffect(() => {
    initConfig(session?.user?.id ?? null)
    if (session?.user?.id) syncConfigFromSupabase()
  }, [session?.user?.id])

  useEffect(() => {
    if (!session?.user?.id) return
    loadUserConfig().then(cfg => {
      if (cfg?.subreceitasFixApplied) return
      fixSubreceitasRetroativas().then(n => {
        saveUserConfig({ ...(cfg || {}), subreceitasFixApplied: true })
      }).catch(() => {})
    }).catch(() => {})
  }, [session?.user?.id])

  useEffect(() => {
    setCreateOpen(false)
    window.scrollTo(0, 0)
  }, [location.pathname])

  useRealtimePedidos(session?.user?.id, null)

  // Swipe right from left edge → go back
  const touchStartX = useRef(0)
  useEffect(() => {
    const onStart = (e) => { touchStartX.current = e.touches[0].clientX }
    const onEnd   = (e) => {
      if (touchStartX.current < 30 && e.changedTouches[0].clientX - touchStartX.current > 60) {
        navigate(-1)
      }
    }
    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchend',   onEnd,   { passive: true })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchend',   onEnd)
    }
  }, [navigate])

  // Páginas públicas — acessíveis sem login.
  if (location.pathname.startsWith('/cardapio/')) {
    return (
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/cardapio/:id" element={<CardapioPublico />} />
        </Routes>
      </Suspense>
    )
  }
  if (location.pathname.startsWith('/pedido/')) {
    return (
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/pedido/:userId" element={<PedidoExterno />} />
        </Routes>
      </Suspense>
    )
  }

  if (loading) return <div className="loading" style={{ minHeight: '100dvh' }}>Carregando...</div>
  if (!isAuthenticated) return <Login />
  if (!profile?.onboardingDone) return (
    <Suspense fallback={<div className="loading" style={{ minHeight: '100dvh' }}>Carregando...</div>}>
      <Onboarding onComplete={() => {}} />
    </Suspense>
  )

  const isReceitaForm = location.pathname.match(/^\/fichas\/(nova|\d+\/editar)/)

  return (
    <div className="app-shell">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(s => !s)} />

      <div className="main-content">
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/"                    element={<Home />} />
            <Route path="/pedidos"             element={<Pedidos />} />
            <Route path="/envios"              element={<Envios />} />
            <Route path="/contagem"            element={<Contagem />} />
            <Route path="/fichas"              element={<Fichas />} />
            <Route path="/fichas/nova"         element={<ReceitaForm />} />
            <Route path="/fichas/:id"          element={<Cozinha />} />
            <Route path="/fichas/:id/editar"   element={<ReceitaForm />} />
            <Route path="/cadastros"           element={<Cadastros />} />
            <Route path="/produtos"            element={<Produtos />} />
            <Route path="/vendas"              element={<Vendas />} />
            <Route path="/mise-en-place"           element={<MiseEnPlace />} />
            <Route path="/mise-en-place/historico" element={<ProducaoHistorico />} />
            <Route path="/producao/:id"            element={<ProducaoTodo />} />
            <Route path="/configuracoes"       element={<Configuracoes />} />
            <Route path="/perfil"              element={<Perfil />} />
            <Route path="/menu"                element={<Menu />} />
            <Route path="*"                    element={<Navigate to="/" />} />
          </Routes>
        </Suspense>
      </div>

      {!isReceitaForm && (
        <nav className="bottom-nav">
          {/* Hoje */}
          {[
            { path: '/', label: 'Hoje', Icon: NavHojeIcon, exact: true },
            { path: '/vendas', label: 'Vendas', Icon: NavVendasIcon },
          ].map(({ path, label, Icon, exact }) => {
            const active = exact ? location.pathname === path : location.pathname.startsWith(path)
            return (
              <button key={path} className={`nav-item ${active ? 'active' : ''}`} onClick={() => navigate(path)}>
                <Icon />
                <span>{label}</span>
                <div className="nav-indicator" />
              </button>
            )
          })}

          {/* Plus button */}
          <button
            onClick={() => setCreateOpen(o => !o)}
            style={{
              width: 42, height: 42, borderRadius: 14,
              background: 'linear-gradient(135deg, var(--teal), #1a9e72)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', cursor: 'pointer', marginTop: -8,
              boxShadow: '0 4px 16px rgba(34,184,134,0.3)',
              flexShrink: 0,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M10 4v12M4 10h12" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
            </svg>
          </button>

          {[
            { path: '/fichas', label: 'Receitas', Icon: NavReceitasIcon },
            { path: '/menu', label: 'Menu', Icon: NavMenuIcon, exact: true },
          ].map(({ path, label, Icon, exact }) => {
            const active = exact ? location.pathname === path : location.pathname.startsWith(path)
            return (
              <button key={path} className={`nav-item ${active ? 'active' : ''}`} onClick={() => navigate(path)}>
                <Icon />
                <span>{label}</span>
                <div className="nav-indicator" />
              </button>
            )
          })}
        </nav>
      )}

      {createOpen && <CreateSheet onClose={() => setCreateOpen(false)} navigate={navigate} />}
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
function EnviosIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 14V6h11v8M14 9h4l3 3v2h-7"/>
    <circle cx="7" cy="16" r="2"/>
    <circle cx="17" cy="16" r="2"/>
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
function PerfilIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
}
function SairIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </svg>
}

// Mobile bottom nav icons
function NavHojeIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <rect x="3" y="4" width="18" height="17" rx="3"/>
    <path d="M3 9h18"/>
    <circle cx="12" cy="15" r="1.5" fill="currentColor" stroke="none"/>
  </svg>
}
function NavVendasIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>
    <circle cx="12" cy="12" r="4"/>
  </svg>
}
function NavReceitasIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M4 5h16M4 9h12M4 13h16M4 17h8"/>
  </svg>
}
function NavMenuIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor">
    <circle cx="5" cy="6" r="1.8"/>
    <circle cx="12" cy="6" r="1.8"/>
    <circle cx="19" cy="6" r="1.8"/>
    <circle cx="5" cy="12" r="1.8"/>
    <circle cx="12" cy="12" r="1.8"/>
    <circle cx="19" cy="12" r="1.8"/>
    <circle cx="5" cy="18" r="1.8"/>
    <circle cx="12" cy="18" r="1.8"/>
    <circle cx="19" cy="18" r="1.8"/>
  </svg>
}
