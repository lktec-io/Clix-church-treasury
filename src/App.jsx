import { Routes, Route, Navigate } from 'react-router-dom';
import './App.css';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import PublicOnlyRoute from './components/PublicOnlyRoute.jsx';
import Layout from './components/Layout.jsx';
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
import UsersPage from './pages/UsersPage.jsx';

function App() {
  return (
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
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
          <Route path="/users" element={<UsersPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
