import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
// Self-hosted Poppins (SIL Open Font License — freely bundleable, unlike
// the licensed CircularTtf this design system specified previously and
// could never actually load in this environment). Only the weights the
// design system uses (index.css's --font-weight-* scale).
import '@fontsource/poppins/400.css'
import '@fontsource/poppins/500.css'
import '@fontsource/poppins/600.css'
import '@fontsource/poppins/700.css'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { MemberAuthProvider } from './context/MemberAuthContext.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { LocaleProvider } from './i18n/LocaleContext.jsx'
import { ToastProvider } from './components/Toast.jsx'
import { ConfirmProvider } from './components/ConfirmDialog.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <LocaleProvider>
          <ToastProvider>
            <ConfirmProvider>
              {/* Both auth providers are always mounted, not swapped based on
                  route — each manages its own independent token/cookie/session,
                  so a staff session and a member session can coexist without
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
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
