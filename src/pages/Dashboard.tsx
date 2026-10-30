import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import type { FundSummary, Period, Portfolio } from '../../shared/types';
import { api } from '../api';
import { useMe } from '../auth';
import { BalanceChart, Donut, fundStyles, ReturnsChart, seriesIn, type Slice } from '../components/charts';
import { FundsTable } from '../components/FundsTable';
import { ReturnsTable } from '../components/ReturnsTable';
import { balanceChange, Card, ErrorBox, Icon, Loading, Pct, periodKey, PeriodPicker, Stat, StaleNotice, Tabs, toneOf, typeClass, typeKey, useTabParam } from '../components/ui';
import { useI18n } from '../i18n';
import { useTheme } from '../theme';
import type { MessageKey } from '../locales';

const TABS = ['overview', 'funds', 'returns', 'allocation'] as const;

function greetingKey(now = new Date()): MessageKey {
  const h = now.getHours();

  return h < 12 ? 'dash.greetMorning' : h < 18 ? 'dash.greetAfternoon' : 'dash.greetEvening';
}

export function Dashboard() {
  const { t, fmt, arrow } = useI18n();
  const { data: me } = useMe();
  const { chart } = useTheme();
  const [period, setPeriod] = useState<Period>('1Y');
  const [tab, setTab] = useTabParam(TABS, 'overview');
  const q = useQuery({ queryKey: ['portfolio'], queryFn: api.portfolio });

  if (q.isPending) {
    return <Loading />;
  }

  if (q.isError) {
    return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  }

  const p = q.data;

  if (p.funds.length === 0) {
    return (
      <div className="card empty">
        <div className="empty-mark">
          <Icon name="wallet" size={26} />
        </div>
        <h2>{t('dash.emptyTitle')}</h2>
        <p>{t('dash.emptyBody')}</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Link className="btn primary large" to="/funds/new">
            <Icon name="plus" /> {t('funds.add')}
          </Link>
          <Link className="btn large" to="/import">
            <Icon name="upload" /> {t('funds.import')}
          </Link>
        </div>
      </div>
    );
  }

  const openFunds = p.funds.filter(f => f.status !== 'closed');
  const fundLines = p.funds.map(f => {
    const s = p.fundSeries.find(x => x.fundId === f.id);

    return { ...f, points: s?.points ?? [], path: s?.paths[period] ?? [] };
  });
  // Types of one family (comprehensive and supplementary pension) share a color: the second is striped.
  const familiesSeen = new Set<string>();
  const typeSlices: Slice[] = p.allocation.map(a => {
    const family = typeClass(a.type);
    const hatched = familiesSeen.has(family);

    familiesSeen.add(family);

    return { key: a.type, label: t(typeKey(a.type)), value: a.balance, color: chart.types[family], hatched };
  });
  const selected = p.yields[period];
  const gainShare = p.netDeposits > 0 ? p.totalGain / p.netDeposits : null;
  const month = p.yields['1M'];

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="eyebrow">{t(greetingKey(), { name: me?.displayName || me?.username || '' })}</div>
          <h1 style={{ marginTop: 4 }}>{t('nav.dashboard')}</h1>
          <div className="sub">{t('dash.subtitle', { month: fmt.month(p.asOf), count: openFunds.length })}</div>
        </div>
        <div className="row">
          <Link className="btn large" to="/import">
            <Icon name="upload" /> {t('funds.import')}
          </Link>
          <Link className="btn primary large" to="/funds/new">
            <Icon name="plus" /> {t('funds.add')}
          </Link>
        </div>
      </div>

      <StaleNotice funds={p.funds.filter(f => f.stale)} />

      <Tabs
        label={t('dash.tabsLabel')}
        value={tab}
        onChange={id => setTab(id)}
        tabs={[
          { id: 'overview', label: t('dash.tab.overview') },
          { id: 'funds', label: t('dash.tab.funds') },
          { id: 'returns', label: t('dash.tab.returns') },
          { id: 'allocation', label: t('dash.tab.allocation') },
        ]}
      />

      {tab === 'overview' && (
        <>
          <section className="card hero" aria-label={t('dash.totalBalance')}>
            <div className="hero-top">
              <div className="hero-total">
                <span className="eyebrow">{t('dash.totalBalance')}</span>
                <span className="hero-value">{fmt.money(p.totalBalance)}</span>
                <div className="row">
                  <span className={`chip ${toneOf(p.totalGain)}`}>
                    <Icon name={p.totalGain >= 0 ? 'trendUp' : 'trendDown'} size={14} strokeWidth={2.6} />
                    {t('dash.gainChip', { amount: fmt.signedMoney(p.totalGain) })}
                  </span>
                  {gainShare !== null && (
                    <span className="muted small">{t('dash.onInvested', { pct: fmt.pct(gainShare, 1), amount: fmt.money(p.netDeposits) })}</span>
                  )}
                </div>
              </div>
              <div className="hero-period">
                <PeriodPicker value={period} onChange={setPeriod} />
                <div className="hero-return">
                  <span className="eyebrow">{t(`periodTitle.${period}` as MessageKey)}</span>
                  <span className="value">
                    <Pct value={selected.return} />
                  </span>
                  <span className="muted small">
                    {selected.return === null ? (
                      t('yield.noData')
                    ) : (
                      <>
                        <span className={toneOf(selected.gain)}>{fmt.signedMoney(selected.gain)}</span> ·{' '}
                        {selected.annualized !== null
                          ? t('yield.perYear', { value: fmt.pct(selected.annualized) })
                          : t('yield.window', { from: fmt.month(selected.startMonth), to: fmt.month(selected.endMonth) })}
                        <br />
                        {t('returns.heroLine', { change: fmt.pct(balanceChange(selected), 1), deposits: fmt.money(selected.deposits ?? 0) })}
                      </>
                    )}
                  </span>
                </div>
              </div>
            </div>

            <BalanceChart series={seriesIn(p.series, selected)} path={p.paths[period]} funds={fundLines} height={260} />

            <div className="stat-row">
              <Stat label={t('dash.netInvested')} value={fmt.money(p.netDeposits)} foot={t('dash.netInvestedHint')} />
              <Stat
                label={t('dash.totalGain')}
                value={<span className={toneOf(p.totalGain)}>{fmt.signedMoney(p.totalGain)}</span>}
                foot={gainShare !== null ? <Pct value={gainShare} digits={1} /> : undefined}
              />
              <Stat
                label={t('fund.yearlyReturn')}
                value={<Pct value={p.yields.ALL.annualized ?? p.yields.ALL.return} digits={1} />}
                foot={t('dash.sinceMonth', { month: fmt.month(p.firstMonth) })}
              />
              <Stat
                label={t('dash.thisMonth')}
                value={<Pct value={month.return} />}
                foot={month.return === null ? undefined : <span className={toneOf(month.gain)}>{fmt.signedMoney(month.gain)}</span>}
              />
            </div>
          </section>

          <Card
            title={t('dash.whereMoney')}
            actions={
              <Link to="?tab=allocation" className="small" style={{ fontWeight: 600 }}>
                {t('dash.allocDetails')} {arrow}
              </Link>
            }
          >
            <Donut slices={typeSlices} label={t('chart.total')} size={150} />
          </Card>
        </>
      )}

      {tab === 'funds' && (
        <>
          <section className="card flush">
            <div className="card-head">
              <div>
                <h2>{t('dash.funds')}</h2>
                <div className="hint">{t('funds.periodHint', { period: t(periodKey(period)) })}</div>
              </div>
              {/* Same period as the summary above, so the two never disagree. */}
              <div className="row" style={{ gap: 16 }}>
                <PeriodPicker value={period} onChange={setPeriod} />
                <Link to="/funds" className="small" style={{ fontWeight: 600 }}>
                  {t('dash.viewAll')} {arrow}
                </Link>
              </div>
            </div>
            <FundsTable funds={openFunds} period={period} />
          </section>
        </>
      )}

      {tab === 'returns' && <ReturnsTab p={p} />}

      {tab === 'allocation' && (
        <div className="grid-2-even">
          <Card title={t('alloc.byType')} hint={t('dash.allocationHint')}>
            <Donut slices={typeSlices} label={t('chart.total')} />
          </Card>
          <Card title={t('alloc.byFund')} hint={t('alloc.byFundHint')}>
            <Donut slices={fundSlices(openFunds, chart.types, t)} label={t('chart.total')} />
          </Card>
        </div>
      )}
    </div>
  );
}

/** Returns for all funds together, or for one fund picked from the list. */
function ReturnsTab({ p }: { p: Portfolio }) {
  const { t, fmt, arrow } = useI18n();
  const [fundId, setFundId] = useState<number | null>(null);
  const fq = useQuery({ queryKey: ['fund', fundId], queryFn: () => api.fund(fundId!), enabled: fundId !== null });
  const src = fundId === null ? p : fq.data;
  const monthly = (src?.series ?? [])
    .filter(s => s.return !== null)
    .slice(-24)
    .map(s => ({ label: fmt.monthShort(s.month), value: s.return, title: fmt.month(s.month), gain: s.gain }));
  const yearly = (src?.yearly ?? []).map(y => ({
    label: y.partial ? `${y.year}*` : String(y.year),
    value: y.return,
    title: y.partial ? `${y.year} (${t('chart.partialYear')})` : String(y.year),
    gain: y.gain,
  }));

  return (
    <>
      <div className="row" style={{ gap: 12 }}>
        <label htmlFor="returns-fund" className="small muted">
          {t('dash.returnsFund')}
        </label>
        <select id="returns-fund" value={fundId ?? ''} onChange={e => setFundId(e.target.value ? Number(e.target.value) : null)} style={{ width: 'auto' }}>
          <option value="">{t('dash.allFunds')}</option>
          {p.funds.map(f => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        {fundId !== null && (
          <Link to={`/funds/${fundId}`} className="small" style={{ fontWeight: 600 }}>
            {t('dash.openFund')} {arrow}
          </Link>
        )}
      </div>

      {fundId !== null && fq.isPending ? (
        <Loading />
      ) : fundId !== null && fq.isError ? (
        <ErrorBox error={fq.error} onRetry={() => fq.refetch()} />
      ) : (
        src && (
          <>
            <Card title={t('dash.returnsByPeriod')} hint={t('dash.returnsHint')}>
              <ReturnsTable yields={src.yields} />
            </Card>
            <div className="grid-2-even">
              <Card title={t('dash.monthly')} hint={t('dash.monthlyHint')}>
                <ReturnsChart data={monthly} />
              </Card>
              <Card title={t('dash.yearly')} hint={t('dash.yearlyHint')}>
                <ReturnsChart data={yearly} />
              </Card>
            </div>
          </>
        )
      )}
    </>
  );
}

/**
 * Balance by fund for a donut: the biggest five, the rest as one slice (a donut stops being
 * readable past six). Each fund in its type's color, a second fund of a type striped.
 */
function fundSlices(funds: FundSummary[], colors: Record<string, string>, t: ReturnType<typeof useI18n>['t']): Slice[] {
  const styles = fundStyles(funds, colors);
  const held = funds.filter(f => (f.balance ?? 0) > 0).sort((a, b) => b.balance! - a.balance!);
  const top = held.length > 6 ? held.slice(0, 5) : held;
  const rest = held.slice(top.length);
  const slices: Slice[] = top.map(f => ({ key: String(f.id), label: f.name, value: f.balance!, color: styles.get(f.id)!.color, hatched: styles.get(f.id)!.nth > 0 }));

  if (rest.length) {
    slices.push({ key: 'other', label: t('alloc.other', { count: rest.length }), value: rest.reduce((s, f) => s + f.balance!, 0), color: colors['tc-other'] });
  }

  return slices;
}
