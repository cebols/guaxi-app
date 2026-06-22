import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const SECTIONS = [
  {
    title: 'Vendas',
    items: [
      {
        label: 'Pedidos', path: '/pedidos',
        icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="3" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.4"/><path d="M5 7h8M5 10h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
      },
      {
        label: 'Envios', path: '/envios',
        icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M1 12V5h10v7M11 8h3.5L17 11v1h-6" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><circle cx="5" cy="13" r="1.6" stroke="currentColor" strokeWidth="1.4"/><circle cx="13" cy="13" r="1.6" stroke="currentColor" strokeWidth="1.4"/></svg>,
      },
      {
        label: 'Vendas', path: '/vendas',
        icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><polyline points="17 5 10 12 6.5 8.5 1 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><polyline points="13 5 17 5 17 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
      },
    ],
  },
  {
    title: 'Produção',
    items: [
      {
        label: 'Mise en Place', path: '/mise-en-place',
        icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 9h10M9 4v10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><rect x="2" y="2" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.4"/></svg>,
      },
      {
        label: 'Produtos', path: '/produtos',
        icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="3" y="5" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.4"/><path d="M6 5V4a3 3 0 016 0v1" stroke="currentColor" strokeWidth="1.4"/></svg>,
      },
    ],
  },
  {
    title: 'Estoque',
    items: [
      {
        label: 'Insumos', path: '/cadastros',
        icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="10" r="5" stroke="currentColor" strokeWidth="1.4"/><path d="M7 3h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
      },
      {
        label: 'Contagem', path: '/contagem',
        icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 9l3 3 7-7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
      },
    ],
  },
  {
    title: 'Financeiro',
    items: [
      {
        label: 'Preços e Custos', path: '/configuracoes',
        icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2v14M5 5h6a2 2 0 010 4H6a2 2 0 000 4h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
      },
      {
        label: 'Painel financeiro', path: '/vendas',
        icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="8" width="3" height="7" rx="1" fill="currentColor"/><rect x="7.5" y="5" width="3" height="10" rx="1" fill="currentColor"/><rect x="13" y="2" width="3" height="13" rx="1" fill="currentColor"/></svg>,
      },
    ],
  },
]

export default function Menu() {
  const navigate = useNavigate()
  const { signOut, profile, user } = useAuth()
  const primeiroNome = user?.user_metadata?.given_name || user?.user_metadata?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'você'

  return (
    <>
      <div className="topbar desktop-only">
        <div className="topbar-inner">
          <div className="topbar-title">Menu</div>
        </div>
      </div>

      <div className="page-inner" style={{ paddingTop: 16 }}>
        {/* Mobile header */}
        <div className="mobile-only" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="avatar" style={{ width: 40, height: 40, fontSize: 16, flexShrink: 0 }}>
              {profile?.avatarUrl
                ? <img src={profile.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : primeiroNome.charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{profile?.nomeLoja || primeiroNome}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{user?.email}</div>
            </div>
          </div>
        </div>

        {SECTIONS.map((section) => (
          <div key={section.title} style={{ marginBottom: 16 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)',
              textTransform: 'uppercase', letterSpacing: '0.06em',
              marginBottom: 6, paddingLeft: 2,
            }}>
              {section.title}
            </div>
            <div style={{
              background: 'var(--bg-card)',
              borderRadius: 12,
              border: '0.5px solid var(--border-light-color)',
              overflow: 'hidden',
            }}>
              {section.items.map((item, i) => (
                <button
                  key={item.path + item.label}
                  onClick={() => navigate(item.path)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '13px 14px', cursor: 'pointer', width: '100%',
                    background: 'none', border: 'none',
                    borderBottom: i < section.items.length - 1 ? '0.5px solid var(--border-light-color)' : 'none',
                    color: 'var(--text-primary)', textAlign: 'left',
                  }}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: 'var(--bg-input)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--text-secondary)', flexShrink: 0,
                  }}>
                    {item.icon}
                  </div>
                  <span style={{ fontSize: 15, flex: 1, fontWeight: 500 }}>{item.label}</span>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M6 4l4 4-4 4" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              ))}
            </div>
          </div>
        ))}

        {/* Divider */}
        <div style={{ height: 0.5, background: 'var(--border-light-color)', margin: '8px 0 16px' }} />

        {/* Account section */}
        <div style={{
          background: 'var(--bg-card)',
          borderRadius: 12,
          border: '0.5px solid var(--border-light-color)',
          overflow: 'hidden',
          marginBottom: 24,
        }}>
          {[
            {
              label: 'Perfil',
              path: '/perfil',
              icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="6" r="3" stroke="currentColor" strokeWidth="1.4"/><path d="M3 16c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
            },
            {
              label: 'Configurações',
              path: '/configuracoes',
              icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.4"/><path d="M9 2v2m0 10v2M2 9h2m10 0h2M4.2 4.2l1.4 1.4m7 7l1.4 1.4M13.8 4.2l-1.4 1.4m-7 7l-1.4 1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
            },
          ].map((item, i) => (
            <button
              key={item.label}
              onClick={() => navigate(item.path)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '13px 14px', cursor: 'pointer', width: '100%',
                background: 'none', border: 'none',
                borderBottom: i === 0 ? '0.5px solid var(--border-light-color)' : 'none',
                color: 'var(--text-primary)', textAlign: 'left',
              }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: 'var(--bg-input)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-secondary)', flexShrink: 0,
              }}>
                {item.icon}
              </div>
              <span style={{ fontSize: 15, flex: 1, fontWeight: 500 }}>{item.label}</span>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M6 4l4 4-4 4" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          ))}
        </div>

        {/* Sign out */}
        <button
          onClick={signOut}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 8, width: '100%', padding: '12px',
            background: 'none', border: '0.5px solid var(--border-light-color)',
            borderRadius: 12, cursor: 'pointer',
            color: 'var(--text-secondary)', fontSize: 14, fontWeight: 500,
            marginBottom: 32,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          Sair
        </button>
      </div>
    </>
  )
}
