import { Link, Route, Routes } from 'react-router-dom';

import { useMe } from './auth';
import { Layout } from './components/Layout';
import { ErrorBox, Loading } from './components/ui';
import { useI18n } from './i18n';
import { Compare } from './pages/Compare';
import { Dashboard } from './pages/Dashboard';
import { FundEdit } from './pages/FundEdit';
import { FundPage } from './pages/FundPage';
import { Funds } from './pages/Funds';
import { Import } from './pages/Import';
import { Login } from './pages/Login';
import { Settings } from './pages/Settings';

function NotFound() {
  const { t } = useI18n();

  return (
    <div className="card empty">
      <h2>{t('notFound.title')}</h2>
      <Link to="/">{t('nav.dashboard')}</Link>
    </div>
  );
}

export function App() {
  const me = useMe();

  if (me.isPending) {
    return <Loading />;
  }

  if (me.isError) {
    return (
      <main>
        <ErrorBox error={me.error} onRetry={() => me.refetch()} />
      </main>
    );
  }

  if (!me.data) {
    return <Login />;
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="funds" element={<Funds />} />
        <Route path="funds/new" element={<FundEdit />} />
        <Route path="funds/:id" element={<FundPage />} />
        <Route path="funds/:id/edit" element={<FundEdit />} />
        <Route path="compare" element={<Compare />} />
        <Route path="import" element={<Import />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
