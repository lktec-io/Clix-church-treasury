import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { expensesApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';
import PermissionGate from '../components/PermissionGate.jsx';

// A full metrics dashboard (account/fund balances, income-vs-expense
// charts) is Phase 10 scope, built on dedicated reporting-aggregation
// endpoints — deliberately not invented here just to fill this page.
// "Pending approvals" is real data from an endpoint this phase already
// built (GET /expenses?status=submitted), so it's shown; nothing else here
// is a stand-in number.
export default function DashboardPage() {
  const { session } = useAuth();
  const { t } = useLocale();
  const [pendingCount, setPendingCount] = useState(null);

  useEffect(() => {
    if (!session?.permissions?.includes('expense.approve')) return;
    expensesApi
      .list({ status: 'submitted' })
      .then((expenses) => setPendingCount(expenses.length))
      .catch(() => setPendingCount(null));
  }, [session]);

  const quickLinks = [
    { to: '/contributions', labelKey: 'contributions.title', permission: 'income.view' },
    { to: '/expenses', labelKey: 'expenses.title', permission: 'expense.view' },
    { to: '/accounts', labelKey: 'accounts.title', permission: 'accounts.view' },
    { to: '/transfers', labelKey: 'transfers.title', permission: 'transfers.create' },
  ];

  return (
    <div>
      <h1>{t('dashboard.title')}</h1>

      <PermissionGate permission="expense.approve">
        <div className="stat-grid">
          <div className="stat-tile">
            <div className="stat-tile__label">{t('dashboard.pendingApprovals')}</div>
            <div className="stat-tile__value">{pendingCount ?? '—'}</div>
          </div>
        </div>
      </PermissionGate>

      <div className="card">
        <h2>{session?.user?.full_name}</h2>
        <p style={{ color: 'var(--text-muted)' }}>{session?.roles?.join(', ')}</p>
      </div>

      <div className="stat-grid" style={{ marginTop: 16 }}>
        {quickLinks.map(({ to, labelKey, permission }) => (
          <PermissionGate key={to} permission={permission}>
            <Link to={to} className="stat-tile" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="stat-tile__label">{t(labelKey)}</div>
            </Link>
          </PermissionGate>
        ))}
      </div>
    </div>
  );
}
