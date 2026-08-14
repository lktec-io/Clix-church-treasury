import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { MemberAuthProvider } from './context/MemberAuthContext.jsx'
import { LocaleProvider } from './i18n/LocaleContext.jsx'
import { ToastProvider } from './components/Toast.jsx'
import { ConfirmProvider } from './components/ConfirmDialog.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <LocaleProvider>
        <ToastProvider>
          <ConfirmProvider>
            {/* Both providers are always mounted, not swapped based on route
                — each manages its own independent token/cookie/session, so
                a staff session and a member session can coexist without
                interfering (see api/memberClient.js for why they're
                separate clients in the first place). */}
            <AuthProvider>
              <MemberAuthProvider>
                <App />
              </MemberAuthProvider>
            </AuthProvider>
          </ConfirmProvider>
        </ToastProvider>
      </LocaleProvider>
    </BrowserRouter>
  </StrictMode>,
)
