import { Routes, Route, Navigate } from 'react-router-dom';
import ScrollToTop from './components/ScrollToTop.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import PublicOnlyRoute from './components/PublicOnlyRoute.jsx';
import PlatformProtectedRoute from './components/PlatformProtectedRoute.jsx';
import Layout from './components/Layout.jsx';
import PlatformLayout from './components/PlatformLayout.jsx';
import PlatformLoginPage from './pages/platform/PlatformLoginPage.jsx';
import PlatformDashboardPage from './pages/platform/PlatformDashboardPage.jsx';
import PlatformTenantsPage from './pages/platform/PlatformTenantsPage.jsx';
import MemberProtectedRoute from './components/member/MemberProtectedRoute.jsx';
import MemberPublicOnlyRoute from './components/member/MemberPublicOnlyRoute.jsx';
import MemberLayout from './components/member/MemberLayout.jsx';
import MemberLoginPage from './pages/member/MemberLoginPage.jsx';
import MemberDashboardPage from './pages/member/MemberDashboardPage.jsx';
import MemberHistoryPage from './pages/member/MemberHistoryPage.jsx';
import MemberStatementPage from './pages/member/MemberStatementPage.jsx';
import MemberChangePinPage from './pages/member/MemberChangePinPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ContributionsPage from './pages/ContributionsPage.jsx';
import ContributorsPage from './pages/ContributorsPage.jsx';
import ExpensesPage from './pages/ExpensesPage.jsx';
import RemittancePage from './pages/RemittancePage.jsx';
import TrialBalancePage from './pages/TrialBalancePage.jsx';
import AccountsPage from './pages/AccountsPage.jsx';
import FundsPage from './pages/FundsPage.jsx';
import CategoriesPage from './pages/CategoriesPage.jsx';
import TransfersPage from './pages/TransfersPage.jsx';
import PledgesPage from './pages/PledgesPage.jsx';
import BudgetsPage from './pages/BudgetsPage.jsx';
import FinancialPeriodsPage from './pages/FinancialPeriodsPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import MemberStatementsPage from './pages/MemberStatementsPage.jsx';
import UsersPage from './pages/UsersPage.jsx';

function App() {
  return (
    <>
      {/* Inside the router so it can read useLocation(), outside <Routes>
          so it survives every route change rather than remounting. */}
      <ScrollToTop />
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
    </>
  );
}

export default App;
