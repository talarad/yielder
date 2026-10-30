import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { currentMonth, isMonth } from '../../shared/months';
import type { Entry, FundSummary } from '../../shared/types';
import { fundTrack, nextMonthToFill } from '../../shared/yields';
import { api } from '../api';
import { Card, ErrorBox, ErrorText, Icon, Loading, Monogram, MonthInput, Pct, UNUSUAL_MONTH } from '../components/ui';
import { useI18n } from '../i18n';

interface Sheet {
  fund: FundSummary;
  entries: Entry[];
}

interface Row {
  balance: string;
  deposit: string;
  withdrawal: string;
}

const text = (n: number) => (n ? String(n) : '');

/** What a fund's row starts with: the month's statement if it has one, else last month's deposit. */
function startingRow({ entries }: Sheet, month: string): Row {
  const existing = entries.find(e => e.month === month);

  if (existing) {
    return { balance: String(existing.balance), deposit: text(existing.deposit), withdrawal: text(existing.withdrawal) };
  }

  const before = entries.filter(e => e.month < month).at(-1);

  return { balance: '', deposit: text(before?.deposit ?? 0), withdrawal: '' };
}

const sameRow = (a: Row, b: Row) => a.balance === b.balance && (Number(a.deposit) || 0) === (Number(b.deposit) || 0) && (Number(a.withdrawal) || 0) === (Number(b.withdrawal) || 0);

/** The month's return if the row were saved, for spotting typos before they land. */
function previewReturn({ entries }: Sheet, month: string, row: Row): number | null {
  if (row.balance === '' || !Number.isFinite(Number(row.balance))) {
    return null;
  }

  const entry = { month, balance: Number(row.balance), deposit: Number(row.deposit) || 0, withdrawal: Number(row.withdrawal) || 0, comment: '' };

  return fundTrack([...entries.filter(e => e.month !== month), entry]).steps.get(month)?.ret ?? null;
}

/** One month's statements for every open fund, on one screen. */
export function AddMonth() {
  const { t, fmt } = useI18n();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ['month-sheet'], queryFn: api.monthSheet });
  // Edits per month and fund, so switching months back and forth keeps what was typed.
  const [drafts, setDrafts] = useState<Record<string, Row>>({});
  const [saved, setSaved] = useState<{ month: string; count: number } | null>(null);

  const sheets = (q.data ?? []).filter(s => s.fund.status !== 'closed');
  const param = params.get('month');
  const month = param && isMonth(param) ? param : nextMonthToFill(sheets.map(s => s.fund), currentMonth());
  const rows = sheets.map(s => {
    const start = startingRow(s, month);
    const row = drafts[`${month}:${s.fund.id}`] ?? start;
    const exists = s.entries.some(e => e.month === month);

    return { s, row, exists, changed: row.balance !== '' && !(exists && sameRow(row, start)), ret: previewReturn(s, month, row) };
  });
  const changed = rows.filter(r => r.changed);

  const save = useMutation({
    mutationFn: () =>
      api.saveMonth(
        month,
        changed.map(({ s, row }) => ({
          fundId: s.fund.id,
          balance: Number(row.balance),
          deposit: Number(row.deposit) || 0,
          withdrawal: Number(row.withdrawal) || 0,
        })),
      ),
    onSuccess: () => {
      setSaved({ month, count: changed.length });
      setDrafts(d => Object.fromEntries(Object.entries(d).filter(([key]) => !key.startsWith(`${month}:`))));
      qc.invalidateQueries();
    },
  });

  if (q.isPending) {
    return <Loading />;
  }

  if (q.error) {
    return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  }

  const edit = (id: number, row: Row, key: keyof Row) => (e: { target: { value: string } }) => {
    setSaved(null);
    setDrafts(d => ({ ...d, [`${month}:${id}`]: { ...row, [key]: e.target.value } }));
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();

    if (changed.length > 0) {
      save.mutate();
    }
  };

  const years = sheets.flatMap(s => (s.fund.firstMonth ? [Number(s.fund.firstMonth.slice(0, 4))] : []));
  const thisYear = Number(currentMonth().slice(0, 4));

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>{t('update.title')}</h1>
          <div className="sub">{t('update.lead')}</div>
        </div>
      </div>

      {sheets.length === 0 ? (
        <div className="card empty">
          <p>{t('update.empty')}</p>
          <Link className="btn primary" to="/funds/new">
            <Icon name="plus" /> {t('funds.add')}
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit}>
          <Card
            flush
            title={t('update.for', { month: fmt.month(month) })}
            actions={
              <MonthInput
                value={month}
                onChange={m => {
                  setSaved(null);
                  setParams({ month: m }, { replace: true });
                }}
                fromYear={Math.min(thisYear, ...years)}
                toYear={thisYear + 1}
                label={t('fund.month')}
              />
            }
          >
            <div className="month-sheet">
              <div className="month-row head" aria-hidden="true">
                <span>{t('update.fund')}</span>
                <span>{t('table.balance')}</span>
                <span>{t('fund.deposit')}</span>
                <span>{t('fund.withdrawal')}</span>
                <span className="preview">{t('update.return')}</span>
              </div>
              {rows.map(({ s, row, exists, ret }) => {
                const unusual = ret !== null && Math.abs(ret) > UNUSUAL_MONTH;

                return (
                  <div key={s.fund.id} className={`month-row${unusual ? ' unusual' : ''}`}>
                    <div className="fund">
                      <Monogram name={s.fund.name} type={s.fund.type} />
                      <div style={{ minWidth: 0 }}>
                        <Link className="name" to={`/funds/${s.fund.id}?tab=statements`}>
                          <bdi>{s.fund.name}</bdi>
                        </Link>
                        <div className="small muted">
                          {exists ? (
                            <span className="chip small accent">{t('update.recorded')}</span>
                          ) : s.fund.asOf ? (
                            t('update.last', { month: fmt.month(s.fund.asOf), balance: fmt.money(s.fund.balance ?? 0) })
                          ) : (
                            t('update.noMonths')
                          )}
                        </div>
                      </div>
                    </div>
                    <label>
                      <span className="cell-label">{t('table.balance')}</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="0"
                        value={row.balance}
                        onChange={edit(s.fund.id, row, 'balance')}
                        aria-label={`${s.fund.name} – ${t('table.balance')}`}
                        dir="ltr"
                      />
                    </label>
                    <label>
                      <span className="cell-label">{t('fund.deposit')}</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="0"
                        value={row.deposit}
                        onChange={edit(s.fund.id, row, 'deposit')}
                        placeholder="0"
                        aria-label={`${s.fund.name} – ${t('fund.deposit')}`}
                        dir="ltr"
                      />
                    </label>
                    <label>
                      <span className="cell-label">{t('fund.withdrawal')}</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="0"
                        value={row.withdrawal}
                        onChange={edit(s.fund.id, row, 'withdrawal')}
                        placeholder="0"
                        aria-label={`${s.fund.name} – ${t('fund.withdrawal')}`}
                        dir="ltr"
                      />
                    </label>
                    <div className="preview">
                      <span className="cell-label">{t('update.return')}</span>
                      {ret === null ? <span className="muted">—</span> : <Pct value={ret} />}
                      {unusual && (
                        <div>
                          <span className="chip warn small" title={t('update.checkHint')}>
                            {t('update.check')}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="month-sheet-foot">
              <span className="small muted" role="status">
                {saved ? (
                  <span className="saved-line">
                    <Icon name="check" size={16} /> {t('update.saved', { month: fmt.month(saved.month), count: saved.count })}{' '}
                    <Link to="/">{t('update.toOverview')}</Link>
                  </span>
                ) : changed.length === 0 ? (
                  t('update.nothing')
                ) : null}
              </span>
              <button className="btn primary" type="submit" disabled={changed.length === 0 || save.isPending}>
                {t('update.save', { count: changed.length })}
              </button>
            </div>
            {save.error && (
              <div className="flush-pad" style={{ paddingBottom: 16 }}>
                <ErrorText error={save.error} />
              </div>
            )}
          </Card>
        </form>
      )}
    </div>
  );
}
