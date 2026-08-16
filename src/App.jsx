import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import PublicOnlyRoute from './components/PublicOnlyRoute.jsx';
import Layout from './components/Layout.jsx';
import MemberProtectedRoute from './components/member/MemberProtectedRoute.jsx';
import MemberPublicOnlyRoute from './components/member/MemberPublicOnlyRoute.jsx';
import MemberLayout from './components/member/MemberLayout.jsx';
import MemberLoginPage from './pages/member/MemberLoginPage.jsx';
import MemberDashboardPage from './pages/member/MemberDashboardPage.jsx';
import MemberHistoryPage from './pages/member/MemberHistoryPage.jsx';
import MemberStatementPage from './pages/member/MemberStatementPage.jsx';
import MemberChangePinPage from './pages/member/MemberChangePinPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ContributionsPage from './pages/ContributionsPage.jsx';
import ContributorsPage from './pages/ContributorsPage.jsx';
import ExpensesPage from './pages/ExpensesPage.jsx';
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
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
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

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/contributions" element={<ContributionsPage />} />
          <Route path="/contributors" element={<ContributorsPage />} />
          <Route path="/expenses" element={<ExpensesPage />} />
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
  );
}

export default App;
