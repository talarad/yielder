import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api';
import { FundsTable } from '../components/FundsTable';
import type { Period } from '../../shared/types';
import { Card, ErrorBox, Icon, Loading, periodKey, PeriodPicker } from '../components/ui';
import { useI18n } from '../i18n';

export function Funds() {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['funds'], queryFn: api.funds });
  const [showClosed, setShowClosed] = useState(false);
  const [period, setPeriod] = useState<Period>('1Y');

  if (q.isPending) {
    return <Loading />;
  }

  if (q.isError) {
    return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  }

  const hasClosed = q.data.some(f => f.status === 'closed');
  const funds = q.data.filter(f => showClosed || f.status !== 'closed');

  return (
    <div className="stack">
      <div className="page-head">
        <h1>{t('funds.title')}</h1>
        <div className="row">
          <Link className="btn large" to="/import">
            <Icon name="upload" /> {t('funds.import')}
          </Link>
          <Link className="btn primary large" to="/funds/new">
            <Icon name="plus" /> {t('funds.add')}
          </Link>
        </div>
      </div>
      <Card
        flush
        hint={t('funds.periodHint', { period: t(periodKey(period)) })}
        actions={
          <div className="row" style={{ gap: 16 }}>
            {hasClosed && (
              <label className="check small">
                <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} />
                {t('funds.showClosed')}
              </label>
            )}
            <PeriodPicker value={period} onChange={setPeriod} />
          </div>
        }
      >
        {funds.length ? (
          <FundsTable funds={funds} period={period} />
        ) : (
          <p className="muted" style={{ padding: '0 24px 16px' }}>
            {t('funds.empty')}
          </p>
        )}
      </Card>
    </div>
  );
}
