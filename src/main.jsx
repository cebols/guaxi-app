import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import App from './App'
import './index.css'

// Converte vírgula em ponto para todos os inputs decimais
document.addEventListener('keydown', e => {
  if (e.key !== ',') return
  const el = e.target
  if (el.tagName !== 'INPUT' || el.inputMode !== 'decimal') return
  e.preventDefault()
  document.execCommand('insertText', false, '.')
}, true)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
)
