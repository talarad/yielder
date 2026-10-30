import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import type { FundSummary, Period } from '../../shared/types';
import { useI18n } from '../i18n';
import { balanceChange, Joined, Monogram, Pct, toneOf, TwoLineHeader, typeKey } from './ui';

type SortKey = 'name' | 'balance' | 'deposits' | 'withdrawals' | 'gain' | 'change' | 'return' | 'asOf';

function sortValue(f: FundSummary, key: SortKey, period: Period): string | number | null {
  const y = f.yields[period];

  switch (key) {
    case 'name':
      return f.name;
    case 'balance':
      return f.balance;
    case 'asOf':
      return f.asOf;
    case 'deposits':
      return y.deposits;
    case 'withdrawals':
      return y.withdrawals;
    case 'gain':
      return y.gain;
    case 'change':
      return y.return === null ? null : balanceChange(y);
    case 'return':
      return y.return;
  }
}

/**
 * Funds with the money behind the selected period: balance now, what went in and out during the
 * period, the gain and the return (which never counts deposits as gains).
 */
export function FundsTable({ funds, period }: { funds: FundSummary[]; period: Period }) {
  const { t, fmt } = useI18n();
  const navigate = useNavigate();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'balance', desc: true });
  const anyWithdrawals = funds.some(f => (f.yields[period].withdrawals ?? 0) > 0);

  const sorted = [...funds].sort((a, b) => {
    const va = sortValue(a, sort.key, period);
    const vb = sortValue(b, sort.key, period);

    // Missing values always last
    if (va === null || vb === null) {
      return va === null ? (vb === null ? 0 : 1) : -1;
    }

    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));

    return sort.desc ? -cmp : cmp;
  });

  const th = (key: SortKey, label: string | ReactNode, num = false) => (
    <th
      key={key}
      className={`sortable${num ? ' num' : ''}`}
      onClick={() => setSort(s => ({ key, desc: s.key === key ? !s.desc : num }))}
      aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}
    >
      {label}
      {sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
    </th>
  );

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {th('name', t('table.fund'))}
            {th('balance', t('table.balance'), true)}
            {th('return', <TwoLineHeader label={t('returns.realReturn')} sub={t('returns.realReturnSub')} />, true)}
            {th('change', <TwoLineHeader label={t('returns.balanceChange')} sub={t('returns.balanceChangeSub')} />, true)}
            {th('gain', t('table.gain'), true)}
            {th('deposits', t('table.deposits'), true)}
            {anyWithdrawals && th('withdrawals', t('table.withdrawals'), true)}
            {th('asOf', t('table.updated'))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(f => {
            const y = f.yields[period];

            return (
              <tr key={f.id} className={f.status === 'closed' ? 'dim' : ''} style={{ cursor: 'pointer' }} onClick={() => navigate(`/funds/${f.id}`)}>
                <td>
                  <div className="fund-cell">
                    <Monogram name={f.name} type={f.type} />
                    <span className="names">
                      {/* A real link so keyboard users can open the fund; the row click is a mouse shortcut. */}
                      <Link to={`/funds/${f.id}`} onClick={e => e.stopPropagation()} dir="auto">
                        {f.name}
                      </Link>
                      <span className="meta">
                        <Joined parts={[t(typeKey(f.type)), f.provider, f.track]} />
                      </span>
                    </span>
                  </div>
                </td>
                <td className="num" style={{ fontWeight: 600 }}>
                  {fmt.money(f.balance)}
                </td>
                <td className="num" style={{ fontWeight: 700 }}>
                  <Pct value={y.return} />
                </td>
                <td className="num" style={{ color: 'var(--ink-3)' }}>
                  {y.return === null ? '—' : fmt.pct(balanceChange(y), 1)}
                </td>
                <td className={`num ${toneOf(y.gain)}`}>{y.return === null ? '—' : fmt.signedMoney(y.gain)}</td>
                <td className="num">{y.return === null ? '—' : y.deposits ? fmt.money(y.deposits) : '—'}</td>
                {anyWithdrawals && <td className="num">{y.return === null ? '—' : y.withdrawals ? fmt.money(y.withdrawals) : '—'}</td>}
                <td>
                  <span className={`updated${f.stale ? ' stale' : ''}`} title={f.stale ? t('fund.stale', { month: fmt.month(f.asOf) }) : undefined}>
                    <span className="dot" aria-hidden="true" />
                    {fmt.month(f.asOf)}
                    {f.stale && <span className="sr-only">{t('fund.stale', { month: fmt.month(f.asOf) })}</span>}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
