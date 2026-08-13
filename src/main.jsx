import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { LocaleProvider } from './i18n/LocaleContext.jsx'
import { ToastProvider } from './components/Toast.jsx'
import { ConfirmProvider } from './components/ConfirmDialog.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <LocaleProvider>
        <ToastProvider>
          <ConfirmProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </ConfirmProvider>
        </ToastProvider>
      </LocaleProvider>
    </BrowserRouter>
  </StrictMode>,
)
