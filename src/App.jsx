import { Routes, Route, Navigate } from 'react-router-dom';
import './App.css';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ContributionsPage from './pages/ContributionsPage.jsx';
import ContributorsPage from './pages/ContributorsPage.jsx';
import ExpensesPage from './pages/ExpensesPage.jsx';
import AccountsPage from './pages/AccountsPage.jsx';
import FundsPage from './pages/FundsPage.jsx';
import TransfersPage from './pages/TransfersPage.jsx';
import PledgesPage from './pages/PledgesPage.jsx';

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/contributions" element={<ContributionsPage />} />
          <Route path="/contributors" element={<ContributorsPage />} />
          <Route path="/expenses" element={<ExpensesPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/funds" element={<FundsPage />} />
          <Route path="/transfers" element={<TransfersPage />} />
          <Route path="/pledges" element={<PledgesPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
