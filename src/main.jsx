import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
// Nunito, the --font-primary UI face — self-hosted (SIL Open Font License,
// no runtime dependency on a font CDN), in every weight of the
// --font-weight-* scale. variables.css sets `font-synthesis: none`, so a
// weight with no loaded face would silently render at the nearest one.
// (JetBrains Mono, --font-mono, is imported in index.css.)
import '@fontsource/nunito/400.css'
import '@fontsource/nunito/500.css'
import '@fontsource/nunito/600.css'
import '@fontsource/nunito/700.css'
import '@fontsource/nunito/800.css'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { MemberAuthProvider } from './context/MemberAuthContext.jsx'
import { LocaleProvider } from './i18n/LocaleContext.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { ToastProvider } from './components/Toast.jsx'
import { ConfirmProvider } from './components/ConfirmDialog.jsx'
import { ActivityProvider } from './context/ActivityContext.jsx'

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
                  {/* In-session activity feed behind the navbar bell.
                      Inside the auth providers so a logout unmounts and
                      clears it — one user's activity must not survive into
                      the next session on a shared office machine. */}
                  <ActivityProvider>
                    <App />
                  </ActivityProvider>
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
