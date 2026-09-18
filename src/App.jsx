import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ScrollToTop from './components/ScrollToTop.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import PublicOnlyRoute from './components/PublicOnlyRoute.jsx';
import PlatformProtectedRoute from './components/PlatformProtectedRoute.jsx';
import Layout from './components/Layout.jsx';
import PlatformLayout from './components/PlatformLayout.jsx';
import MemberProtectedRoute from './components/member/MemberProtectedRoute.jsx';
import MemberPublicOnlyRoute from './components/member/MemberPublicOnlyRoute.jsx';
import MemberLayout from './components/member/MemberLayout.jsx';

// Pages are loaded on demand: a treasurer who only records collections never
// downloads the reports or platform screens, and no single bundle grows past
// the size where the browser stalls on first paint. The shell (layouts, route
// guards) stays eager — it is needed for the very first render.
const PlatformLoginPage = lazy(() => import('./pages/platform/PlatformLoginPage.jsx'));
const PlatformDashboardPage = lazy(() => import('./pages/platform/PlatformDashboardPage.jsx'));
const PlatformTenantsPage = lazy(() => import('./pages/platform/PlatformTenantsPage.jsx'));
const MemberLoginPage = lazy(() => import('./pages/member/MemberLoginPage.jsx'));
const MemberDashboardPage = lazy(() => import('./pages/member/MemberDashboardPage.jsx'));
const MemberHistoryPage = lazy(() => import('./pages/member/MemberHistoryPage.jsx'));
const MemberStatementPage = lazy(() => import('./pages/member/MemberStatementPage.jsx'));
const MemberChangePinPage = lazy(() => import('./pages/member/MemberChangePinPage.jsx'));
const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const ContributionsPage = lazy(() => import('./pages/ContributionsPage.jsx'));
const ContributorsPage = lazy(() => import('./pages/ContributorsPage.jsx'));
const ExpensesPage = lazy(() => import('./pages/ExpensesPage.jsx'));
const RemittancePage = lazy(() => import('./pages/RemittancePage.jsx'));
const TrialBalancePage = lazy(() => import('./pages/TrialBalancePage.jsx'));
const AccountsPage = lazy(() => import('./pages/AccountsPage.jsx'));
const FundsPage = lazy(() => import('./pages/FundsPage.jsx'));
const CategoriesPage = lazy(() => import('./pages/CategoriesPage.jsx'));
const TransfersPage = lazy(() => import('./pages/TransfersPage.jsx'));
const PledgesPage = lazy(() => import('./pages/PledgesPage.jsx'));
const BudgetsPage = lazy(() => import('./pages/BudgetsPage.jsx'));
const FinancialPeriodsPage = lazy(() => import('./pages/FinancialPeriodsPage.jsx'));
const ReportsPage = lazy(() => import('./pages/ReportsPage.jsx'));
const MemberStatementsPage = lazy(() => import('./pages/MemberStatementsPage.jsx'));
const UsersPage = lazy(() => import('./pages/UsersPage.jsx'));

function App() {
  return (
    <>
      {/* Inside the router so it can read useLocation(), outside <Routes>
          so it survives every route change rather than remounting. */}
      <ScrollToTop />
      {/* One fallback for every lazy route: a quiet placeholder rather than a
          full-page spinner, since most chunks arrive in a few milliseconds. */}
      <Suspense fallback={<div className="route-fallback" role="status" aria-live="polite" />}>
      <Routes>
      {/* /login is the ONLY public entry point for staff/platform accounts —
          there is deliberately no /register: every tenant and its first
          admin user is created exclusively by a Platform Administrator via
          /platform/tenants. See auth.routes.js's own comment for the
          backend side of this. */}
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>

      {/* Member self-service portal — a fully separate route tree from the
          staff app above (separate auth context, separate layout). Reached
          either via the bare /member URL or a personalized
          /member/:tenantSlug link (what registration/PIN-reset SMS point
          a member at). */}
      <Route element={<MemberPublicOnlyRoute />}>
        <Route path="/member" element={<MemberLoginPage />} />
        <Route path="/member/:tenantSlug" element={<MemberLoginPage />} />
      </Route>
      <Route element={<MemberProtectedRoute />}>
        <Route element={<MemberLayout />}>
          <Route path="/member/dashboard" element={<MemberDashboardPage />} />
          <Route path="/member/history" element={<MemberHistoryPage />} />
          <Route path="/member/statement" element={<MemberStatementPage />} />
          <Route path="/member/change-pin" element={<MemberChangePinPage />} />
        </Route>
      </Route>

      {/* Platform administration — a fully separate route tree, gated by
          the platform.manage permission (PlatformProtectedRoute.jsx),
          never accessible to an ordinary tenant user regardless of their
          own tenant role/permissions. /platform/login is a dedicated
          entry point for platform admins (PlatformLoginPage.jsx) — it
          calls the exact same auth API /login already uses, not a second
          auth system; /login itself still also redirects a
          platform.manage session to /platform, so either door works. */}
      <Route element={<PublicOnlyRoute />}>
        <Route path="/platform/login" element={<PlatformLoginPage />} />
      </Route>
      <Route element={<PlatformProtectedRoute />}>
        <Route element={<PlatformLayout />}>
          <Route path="/platform" element={<PlatformDashboardPage />} />
          <Route path="/platform/tenants" element={<PlatformTenantsPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/contributions" element={<ContributionsPage />} />
          <Route path="/contributors" element={<ContributorsPage />} />
          <Route path="/expenses" element={<ExpensesPage />} />
          <Route path="/treasury/remittance" element={<RemittancePage />} />
          <Route path="/reports/trial-balance" element={<TrialBalancePage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/funds" element={<FundsPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/transfers" element={<TransfersPage />} />
          <Route path="/pledges" element={<PledgesPage />} />
          <Route path="/budgets" element={<BudgetsPage />} />
          <Route path="/financial-periods" element={<FinancialPeriodsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/member-statements" element={<MemberStatementsPage />} />
          <Route path="/users" element={<UsersPage />} />
        </Route>
      </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </>
  );
}

export default App;
