import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { addMonths, currentMonth, isMonth } from '../../shared/months';
import type { FundDetail, Period, YearlyYield } from '../../shared/types';
import { api } from '../api';
import { BenchmarkTable } from '../components/BenchmarkTable';
import { BalanceChart, ReturnsChart, seriesIn } from '../components/charts';
import { ReturnsTable } from '../components/ReturnsTable';
import {
  Card,
  ErrorBox,
  ErrorText,
  Icon,
  Joined,
  Kpi,
  Loading,
  Monogram,
  MonthInput,
  Pct,
  PeriodPicker,
  Tabs,
  toneOf,
  TypeLabel,
  useTabParam,
  balanceChange,
  TwoLineHeader,
} from '../components/ui';
import { useI18n } from '../i18n';
import type { MessageKey } from '../locales';

/** A single month moving more than this is flagged as a likely data-entry timing issue. */
const UNUSUAL_MONTH = 0.15;
/** A calendar year this far off usually means deposits recorded that never reached the balance (or vice versa). */
const UNUSUAL_YEAR = 0.3;

const TABS = ['overview', 'returns', 'statements', 'compare'] as const;

const isUnusualYear = (y: YearlyYield) => y.return !== null && Math.abs(y.return) > UNUSUAL_YEAR;

export function FundPage() {
  const { t, fmt, dir } = useI18n();
  const id = Number(useParams().id);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['fund', id], queryFn: () => api.fund(id) });
  const [tab, setTab] = useTabParam(TABS, 'overview');

  const onChanged = (detail: FundDetail) => {
    qc.setQueryData(['fund', id], detail);
    qc.invalidateQueries({ queryKey: ['funds'] });
    qc.invalidateQueries({ queryKey: ['portfolio'] });
    qc.invalidateQueries({ queryKey: ['compare'] });
  };

  const remove = useMutation({
    mutationFn: () => api.deleteFund(id),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['fund', id] });
      qc.invalidateQueries();
      navigate('/funds');
    },
  });

  if (q.isPending) {
    return <Loading />;
  }

  if (q.isError) {
    return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  }

  const f = q.data;
  const openYear = (year: number) => setTab('statements', { from: `${year}-01`, to: `${year}-12` });

  return (
    <div className="stack">
      <div>
        <nav className="crumbs" aria-label={t('nav.funds')}>
          <Link to="/funds">{t('nav.funds')}</Link>
          <span aria-hidden="true">{dir === 'rtl' ? '‹' : '›'}</span>
          <span aria-current="page" dir="auto">
            {f.name}
          </span>
        </nav>
        <div className="page-head" style={{ marginBottom: 0, alignItems: 'center' }}>
          <div className="row" style={{ gap: 16, flexWrap: 'nowrap', minWidth: 0 }}>
            <Monogram name={f.name} type={f.type} large />
            <div style={{ minWidth: 0 }}>
              <h1 dir="auto">{f.name}</h1>
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <TypeLabel type={f.type} chip />
                {(f.provider || f.track) && (
                  <span className="chip">
                    <Joined parts={[f.provider, f.track]} />
                  </span>
                )}
                <span className={`chip${f.status === 'active' ? ' gain' : ''}`}>
                  {f.status === 'active' && <span className="dot" aria-hidden="true" />}
                  {t(`status.${f.status}` as MessageKey)}
                </span>
              </div>
            </div>
          </div>
          <div className="row">
            <Link className="btn large" to={`/funds/${id}/edit`}>
              {t('common.edit')}
            </Link>
            <button
              className="btn danger large"
              disabled={remove.isPending}
              onClick={() => window.confirm(t('fund.deleteConfirm', { name: f.name })) && remove.mutate()}
            >
              {t('common.delete')}
            </button>
          </div>
        </div>
        {f.notes && (
          <p className="muted small" style={{ marginTop: 12 }} dir="auto">
            {f.notes}
          </p>
        )}
      </div>

      <ErrorText error={remove.error} />

      {f.stale && (
        <div className="notice" role="status">
          <Icon name="alert" size={20} />
          <span>{t('fund.stale', { month: fmt.month(f.asOf) })}</span>
        </div>
      )}

      <Tabs
        label={t('fund.tabsLabel')}
        value={tab}
        onChange={id => setTab(id)}
        tabs={[
          { id: 'overview', label: t('fund.tab.overview') },
          { id: 'returns', label: t('fund.tab.returns') },
          { id: 'statements', label: t('fund.tab.statements') },
          { id: 'compare', label: t('fund.tab.compare') },
        ]}
      />

      {f.entryCount === 0 && tab !== 'statements' ? (
        <div className="card empty">
          <p>{t('fund.noEntries')}</p>
          <button className="btn primary" onClick={() => setTab('statements')}>
            {t('fund.addMonth')}
          </button>
        </div>
      ) : (
        <>
          {tab === 'overview' && <Overview fund={f} />}
          {tab === 'returns' && <Returns fund={f} onOpenYear={openYear} />}
          {/* Keyed by fund: the draft month must not carry over when navigating between funds. */}
          {tab === 'statements' && <Statements key={f.id} fund={f} onChanged={onChanged} />}
          {tab === 'compare' && <CompareTab fund={f} />}
        </>
      )}
    </div>
  );
}

function Overview({ fund: f }: { fund: FundDetail }) {
  const { t, fmt } = useI18n();
  const [period, setPeriod] = useState<Period>('ALL');

  return (
    <>
      <div className="kpis kpis-4">
        <Kpi label={t('table.balance')} value={fmt.money(f.balance)} foot={fmt.month(f.asOf)} />
        <Kpi label={t('kpi.moneyIn')} value={fmt.money(f.totalDeposits)} foot={t('kpi.moneyInHint', { month: fmt.month(f.firstMonth) })} />
        <Kpi label={t('kpi.moneyOut')} value={f.totalWithdrawals ? fmt.money(f.totalWithdrawals) : '—'} foot={t('kpi.moneyOutHint')} />
        <Kpi
          label={t('dash.totalGain')}
          value={<span className={toneOf(f.totalGain)}>{fmt.signedMoney(f.totalGain)}</span>}
          foot={t('yield.perYear', { value: fmt.pct(f.yields.ALL.annualized ?? f.yields.ALL.return, 1) })}
        />
      </div>

      <Card title={t('dash.returnsByPeriod')} hint={t('returns.hint')} flush>
        <ReturnsTable yields={f.yields} />
      </Card>

      <Card title={t('dash.balanceChart')} actions={<PeriodPicker value={period} onChange={setPeriod} />}>
        <BalanceChart series={seriesIn(f.series, f.yields[period])} path={f.paths[period]} />
      </Card>
    </>
  );
}

function Returns({ fund: f, onOpenYear }: { fund: FundDetail; onOpenYear: (year: number) => void }) {
  const { t, fmt } = useI18n();
  const monthly = f.series
    .filter(s => s.return !== null)
    .slice(-36)
    .map(s => ({ label: fmt.monthShort(s.month), value: s.return, title: fmt.month(s.month), gain: s.gain, key: s.month }));
  const yearly = f.yearly.map(y => ({
    label: y.partial ? `${y.year}*` : String(y.year),
    value: y.return,
    title: y.partial ? `${y.year} (${t('chart.partialYear')})` : String(y.year),
    gain: y.gain,
    key: String(y.year),
  }));

  return (
    <>
      <div className="grid-2-even">
        <Card title={t('dash.monthly')} hint={t('fund.clickBar')}>
          <ReturnsChart data={monthly} onBarClick={bar => onOpenYear(Number(bar.key!.slice(0, 4)))} />
        </Card>
        <Card title={t('dash.yearly')} hint={t('fund.clickBar')}>
          <ReturnsChart data={yearly} onBarClick={bar => onOpenYear(Number(bar.key))} />
        </Card>
      </div>

      <Card title={t('fund.yearly')} hint={t('fund.clickYear')} flush>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('table.year')}</th>
                <th className="num">
                  <TwoLineHeader label={t('returns.realReturn')} sub={t('returns.realReturnSub')} />
                </th>
                <th className="num">
                  <TwoLineHeader label={t('returns.balanceChange')} sub={t('returns.balanceChangeSub')} />
                </th>
                <th className="num">{t('table.gain')}</th>
                <th className="num">{t('table.start')}</th>
                <th className="num">{t('table.deposits')}</th>
                <th className="num">{t('table.withdrawals')}</th>
                <th className="num">{t('table.end')}</th>
                <th>
                  <span className="sr-only">{t('fund.viewMonths')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {[...f.yearly].reverse().map(y => {
                const unusual = isUnusualYear(y);

                return (
                  <tr
                    key={y.year}
                    className={`clickable${unusual ? ' unusual' : ''}`}
                    tabIndex={0}
                    onClick={() => onOpenYear(y.year)}
                    onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpenYear(y.year))}
                    aria-label={`${y.year} – ${t('fund.viewMonths')}`}
                  >
                    <td style={{ fontWeight: 600 }}>
                      {y.year}
                      {y.partial && <span className="muted"> *</span>}
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      <Pct value={y.return} />
                    </td>
                    <td className="num" style={{ color: 'var(--ink-3)' }}>
                      {fmt.pct(balanceChange(y), 1)}
                    </td>
                    <td className={`num ${toneOf(y.gain)}`}>{fmt.signedMoney(y.gain)}</td>
                    <td className="num">{fmt.money(y.startBalance)}</td>
                    <td className="num">{y.deposits ? fmt.money(y.deposits) : '—'}</td>
                    <td className="num">{y.withdrawals ? fmt.money(y.withdrawals) : '—'}</td>
                    <td className="num">{fmt.money(y.endBalance)}</td>
                    <td>
                      {unusual ? (
                        <span className="chip warn small">
                          <Icon name="alert" size={13} />
                          {t('fund.checkYear')}
                        </span>
                      ) : (
                        <span className="small muted">{t('fund.viewMonths')}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

interface Draft {
  month: string;
  balance: string;
  deposit: string;
  withdrawal: string;
  comment: string;
}

function blankDraft(fund: FundDetail): Draft {
  return { month: fund.asOf ? addMonths(fund.asOf, 1) : currentMonth(), balance: '', deposit: '', withdrawal: '', comment: '' };
}

function Statements({ fund, onChanged }: { fund: FundDetail; onChanged: (d: FundDetail) => void }) {
  const { t, fmt } = useI18n();
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState<Draft>(() => blankDraft(fund));
  const returns = new Map(fund.series.map(s => [s.month, s.return]));
  const exists = fund.entries.some(e => e.month === draft.month);

  // Range: from the URL (a clicked year), otherwise the last 12 months of data.
  const latest = fund.asOf ?? currentMonth();
  const earliest = fund.firstMonth ?? latest;
  const fromParam = params.get('from');
  const toParam = params.get('to');
  const from = fromParam && isMonth(fromParam) ? fromParam : addMonths(latest, -11);
  const to = toParam && isMonth(toParam) ? toParam : latest;
  const setRange = (nextFrom: string, nextTo: string) =>
    setParams({ tab: 'statements', from: nextFrom <= nextTo ? nextFrom : nextTo, to: nextFrom <= nextTo ? nextTo : nextFrom });
  const shown = fund.entries.filter(e => e.month >= from && e.month <= to);
  const year = from.endsWith('-01') && to.endsWith('-12') && from.slice(0, 4) === to.slice(0, 4) ? Number(from.slice(0, 4)) : null;
  const yearInfo = year !== null ? fund.yearly.find(y => y.year === year) : undefined;

  const save = useMutation({
    mutationFn: () =>
      api.saveEntry(fund.id, {
        month: draft.month,
        balance: Number(draft.balance),
        deposit: Number(draft.deposit) || 0,
        withdrawal: Number(draft.withdrawal) || 0,
        comment: draft.comment.trim(),
      }),
    onSuccess: detail => {
      onChanged(detail);
      setDraft(blankDraft(detail));
    },
  });

  const remove = useMutation({ mutationFn: (month: string) => api.deleteEntry(fund.id, month), onSuccess: onChanged });

  const set = (key: keyof Draft) => (e: { target: { value: string } }) => setDraft(d => ({ ...d, [key]: e.target.value }));
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();

    if (isMonth(draft.month) && draft.balance !== '') {
      save.mutate();
    }
  };

  const firstYear = Number(earliest.slice(0, 4));
  const lastYear = Number(latest.slice(0, 4)) + 1;

  return (
    <>
      <Card title={t('fund.addOrEdit')} hint={t('fund.entriesHint')}>
        <form className="entry-form" onSubmit={onSubmit}>
          <div className="field">
            {t('fund.month')}
            <MonthInput value={draft.month} onChange={month => setDraft(d => ({ ...d, month }))} fromYear={firstYear - 1} toYear={lastYear} label={t('fund.month')} />
          </div>
          <label className="field">
            {t('table.balance')}
            <input type="number" inputMode="decimal" step="any" min="0" value={draft.balance} onChange={set('balance')} required dir="ltr" />
          </label>
          <label className="field">
            {t('fund.deposit')}
            <input type="number" inputMode="decimal" step="any" min="0" value={draft.deposit} onChange={set('deposit')} placeholder="0" dir="ltr" />
          </label>
          <label className="field">
            {t('fund.withdrawal')}
            <input type="number" inputMode="decimal" step="any" min="0" value={draft.withdrawal} onChange={set('withdrawal')} placeholder="0" dir="ltr" />
          </label>
          <label className="field">
            {t('fund.comment')}
            <input value={draft.comment} onChange={set('comment')} maxLength={300} dir="auto" />
          </label>
          <button className="btn primary" type="submit" disabled={save.isPending}>
            {exists ? t('common.save') : t('fund.addMonth')}
          </button>
        </form>
        {exists && <p className="small muted" style={{ marginTop: 8 }}>{t('fund.monthExists')}</p>}
        {(save.error || remove.error) && (
          <div style={{ marginTop: 8 }}>
            <ErrorText error={save.error ?? remove.error} />
          </div>
        )}
        <BulkFlows fund={fund} onChanged={onChanged} firstYear={firstYear} lastYear={lastYear} />
      </Card>

      <Card
        flush
        title={t('fund.entries')}
        hint={t('range.showing', { count: shown.length })}
        actions={
          <div className="range-filter">
            <div className="field">
              {t('range.from')}
              <MonthInput value={from} onChange={m => setRange(m, to)} fromYear={firstYear} toYear={lastYear} label={t('range.from')} />
            </div>
            <div className="field">
              {t('range.to')}
              <MonthInput value={to} onChange={m => setRange(from, m)} fromYear={firstYear} toYear={lastYear} label={t('range.to')} />
            </div>
            <div className="presets">
              <button className="btn small" onClick={() => setRange(addMonths(latest, -11), latest)}>
                {t('range.last12')}
              </button>
              <button className="btn small" onClick={() => setRange(`${latest.slice(0, 4)}-01`, latest)}>
                {t('range.thisYear')}
              </button>
              <button className="btn small" onClick={() => setRange(earliest, latest)}>
                {t('range.all')}
              </button>
            </div>
          </div>
        }
      >
        {yearInfo && isUnusualYear(yearInfo) && (
          <div className="flush-pad" style={{ marginBottom: 12 }}>
            <div className="notice" role="status">
              <Icon name="alert" size={20} />
              <span>
                <b>{t('fund.yearCheckTitle', { year: yearInfo.year, ret: fmt.pct(yearInfo.return, 1) })}</b>{' '}
                {t('fund.yearCheckBody', {
                  flow: fmt.signedMoney(yearInfo.netFlow),
                  change: fmt.signedMoney(yearInfo.endBalance - yearInfo.startBalance),
                })}
              </span>
            </div>
          </div>
        )}

        {shown.length === 0 ? (
          <p className="muted flush-pad" style={{ paddingBottom: 16 }}>
            {fund.entries.length === 0 ? t('fund.noEntries') : t('range.none')}
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('fund.month')}</th>
                  <th className="num">{t('table.balance')}</th>
                  <th className="num">{t('fund.deposit')}</th>
                  <th className="num">{t('fund.withdrawal')}</th>
                  <th className="num">{t('table.return')}</th>
                  <th>{t('fund.comment')}</th>
                  <th>
                    <span className="sr-only">{t('common.edit')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map(e => {
                  const r = returns.get(e.month) ?? null;
                  const unusual = r !== null && Math.abs(r) > UNUSUAL_MONTH;

                  return (
                    <tr key={e.month} className={unusual ? 'unusual' : ''}>
                      <td style={{ fontWeight: 500 }}>{fmt.month(e.month)}</td>
                      <td className="num" style={{ fontWeight: 600 }}>
                        {fmt.money(e.balance)}
                      </td>
                      <td className="num" style={{ color: 'var(--ink-3)' }}>
                        {e.deposit ? fmt.money(e.deposit) : '—'}
                      </td>
                      <td className="num" style={{ color: 'var(--ink-3)' }}>
                        {e.withdrawal ? fmt.money(e.withdrawal) : '—'}
                      </td>
                      <td className="num">
                        <Pct value={r} />
                        {unusual && (
                          <div>
                            <span className="chip warn small" title={t('fund.unusual')}>
                              {t('fund.unusualChip')}
                            </span>
                          </div>
                        )}
                      </td>
                      <td style={{ whiteSpace: 'normal', minWidth: 160 }} dir="auto">
                        {e.comment}
                        {unusual && <div className="small" style={{ color: 'var(--warn-ink)' }}>{t('fund.unusual')}</div>}
                      </td>
                      <td className="num">
                        <button
                          className="btn ghost small"
                          onClick={() => {
                            setDraft({
                              month: e.month,
                              balance: String(e.balance),
                              deposit: e.deposit ? String(e.deposit) : '',
                              withdrawal: e.withdrawal ? String(e.withdrawal) : '',
                              comment: e.comment,
                            });
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                        >
                          {t('common.edit')}
                        </button>
                        <button
                          className="btn ghost small danger"
                          disabled={remove.isPending}
                          onClick={() => window.confirm(t('fund.deleteEntryConfirm', { month: fmt.month(e.month) })) && remove.mutate(e.month)}
                        >
                          {t('common.delete')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/** Same deposit (or withdrawal) on every recorded month in a range, e.g. a fixed monthly deposit. */
function BulkFlows({
  fund,
  onChanged,
  firstYear,
  lastYear,
}: {
  fund: FundDetail;
  onChanged: (d: FundDetail) => void;
  firstYear: number;
  lastYear: number;
}) {
  const { t } = useI18n();
  const latest = fund.asOf ?? currentMonth();
  const [kind, setKind] = useState<'deposit' | 'withdrawal'>('deposit');
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState(addMonths(latest, -11));
  const [to, setTo] = useState(latest);
  const [done, setDone] = useState<number | null>(null);
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  const count = fund.entries.filter(e => e.month >= lo && e.month <= hi).length;

  const apply = useMutation({
    mutationFn: () => api.setRangeFlows(fund.id, { from: lo, to: hi, [kind]: Number(amount) }),
    onSuccess: detail => {
      onChanged(detail);
      setDone(count);
    },
  });

  return (
    <details className="bulk" style={{ marginTop: 16 }}>
      <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>
        {t('range.bulkTitle')}
      </summary>
      <p className="small muted" style={{ margin: '8px 0 12px' }}>
        {t('range.bulkHint')}
      </p>
      <form
        className="range-filter"
        onSubmit={e => {
          e.preventDefault();

          if (amount !== '' && count > 0 && window.confirm(t('range.bulkConfirm', { count }))) {
            apply.mutate();
          }
        }}
      >
        <label className="field">
          {t('range.bulkKind')}
          <select value={kind} onChange={e => setKind(e.target.value as 'deposit' | 'withdrawal')} style={{ width: 'auto' }}>
            <option value="deposit">{t('fund.deposit')}</option>
            <option value="withdrawal">{t('fund.withdrawal')}</option>
          </select>
        </label>
        <label className="field">
          {t('range.bulkAmount')}
          <input type="number" inputMode="decimal" step="any" min="0" value={amount} onChange={e => setAmount(e.target.value)} required dir="ltr" style={{ width: 140 }} />
        </label>
        <div className="field">
          {t('range.from')}
          <MonthInput value={from} onChange={setFrom} fromYear={firstYear} toYear={lastYear} label={t('range.from')} />
        </div>
        <div className="field">
          {t('range.to')}
          <MonthInput value={to} onChange={setTo} fromYear={firstYear} toYear={lastYear} label={t('range.to')} />
        </div>
        <button className="btn" type="submit" disabled={apply.isPending || amount === '' || count === 0}>
          {t('range.bulkApply', { count })}
        </button>
      </form>
      {done !== null && <p className="small" style={{ marginTop: 8, color: 'var(--gain-text)' }}>{t('range.bulkDone', { count: done })}</p>}
      <ErrorText error={apply.error} />
    </details>
  );
}

function CompareTab({ fund }: { fund: FundDetail }) {
  const { t } = useI18n();
  const [period, setPeriod] = useState<Period>('1Y');
  const q = useQuery({ queryKey: ['compare', period], queryFn: () => api.compare(period), placeholderData: keepPreviousData });
  const c = q.data?.funds.find(x => x.fundId === fund.id);

  return (
    <Card title={t('market.title')} actions={<PeriodPicker value={period} onChange={setPeriod} />}>
      {q.isPending ? (
        <p className="muted">{t('common.loading')}</p>
      ) : q.isError ? (
        <ErrorText error={q.error} />
      ) : c ? (
        <div style={{ opacity: q.isPlaceholderData ? 0.6 : 1 }}>
          <BenchmarkTable comparison={c} marketThrough={q.data.marketThrough} />
        </div>
      ) : null}
    </Card>
  );
}
