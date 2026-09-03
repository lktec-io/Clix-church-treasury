import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
// Self-hosted Nunito (SIL Open Font License — freely bundleable, no
// network dependency on Google Fonts at runtime). Only the weights the
// design system actually uses (variables.css's --font-weight-* scale).
import '@fontsource/nunito/400.css'
import '@fontsource/nunito/500.css'
import '@fontsource/nunito/600.css'
import '@fontsource/nunito/700.css'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { MemberAuthProvider } from './context/MemberAuthContext.jsx'
import { LocaleProvider } from './i18n/LocaleContext.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { ToastProvider } from './components/Toast.jsx'
import { ConfirmProvider } from './components/ConfirmDialog.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      {/* reducedMotion="user" is the one thing a global CSS
          prefers-reduced-motion rule cannot do: every Framer Motion
          animation in this app (sidebar drawer, toast, modal, page
          transitions, dashboard card stagger) is driven by JS directly
          setting transform/opacity, not CSS transition/animation
          properties — so the "animation-duration: 0.001ms !important"
          override in animations.css never touched any of it. This makes
          Framer itself skip transform/layout animation whenever the OS
          reduced-motion setting is on, app-wide, from one place. */}
      <MotionConfig reducedMotion="user">
        {/* Outermost app-level provider: it writes data-theme onto <html>,
            which every stylesheet below reads. */}
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
      </MotionConfig>
    </BrowserRouter>
  </StrictMode>,
)
