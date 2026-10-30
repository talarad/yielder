import { PERIODS, type Yields } from '../../shared/types';
import { useI18n } from '../i18n';
import { balanceChange, Pct, periodKey, toneOf, TwoLineHeader } from './ui';

/**
 * Returns by period, with the money behind each one: start balance + deposits − withdrawals +
 * gain = end balance. Two percentages side by side: how much the balance changed (deposits
 * included) and the real return (deposits and withdrawals taken out).
 */
export function ReturnsTable({ yields }: { yields: Yields }) {
  const { t, fmt } = useI18n();
  const rows = PERIODS.map(p => yields[p]);
  const anyWithdrawals = rows.some(y => (y.withdrawals ?? 0) > 0);

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t('returns.period')}</th>
            <th className="num">
              <TwoLineHeader label={t('returns.realReturn')} sub={t('returns.realReturnSub')} />
            </th>
            <th className="num">
              <TwoLineHeader label={t('returns.balanceChange')} sub={t('returns.balanceChangeSub')} />
            </th>
            <th className="num">{t('table.gain')}</th>
            <th className="num">{t('table.start')}</th>
            <th className="num">{t('table.deposits')}</th>
            {anyWithdrawals && <th className="num">{t('table.withdrawals')}</th>}
            <th className="num">{t('table.end')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(y =>
            y.return === null ? (
              <tr key={y.period} className="dim">
                <td>{t(periodKey(y.period))}</td>
                <td colSpan={anyWithdrawals ? 7 : 6} className="small">
                  {t('yield.noData')}
                </td>
              </tr>
            ) : (
              <tr key={y.period} title={t('yield.window', { from: fmt.month(y.startMonth), to: fmt.month(y.endMonth) })}>
                <td style={{ fontWeight: 600 }}>
                  {t(periodKey(y.period))}
                  {y.partial && <div className="small muted">{t('yield.partial', { month: fmt.month(y.startMonth) })}</div>}
                </td>
                <td className="num" style={{ fontWeight: 700 }}>
                  <Pct value={y.return} />
                  {y.annualized !== null && <div className="small muted">{t('yield.perYear', { value: fmt.pct(y.annualized, 1) })}</div>}
                </td>
                <td className="num" style={{ color: 'var(--ink-3)' }}>
                  {fmt.pct(balanceChange(y), 1)}
                </td>
                <td className={`num ${toneOf(y.gain)}`} style={{ fontWeight: 600 }}>
                  {fmt.signedMoney(y.gain)}
                </td>
                <td className="num">{fmt.money(y.startBalance)}</td>
                <td className="num">{y.deposits ? fmt.money(y.deposits) : '—'}</td>
                {anyWithdrawals && <td className="num">{y.withdrawals ? fmt.money(y.withdrawals) : '—'}</td>}
                <td className="num">{fmt.money(y.endBalance)}</td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
