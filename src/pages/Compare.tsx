import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { BenchmarkReturn, CompareResult, FundType, Period } from '../../shared/types';
import { api } from '../api';
import { FoldToggle, foldRows, GapRow, MarketSource, Standing, TrackFilter, useBenchmarkNames, useTrackFilter } from '../components/BenchmarkTable';
import { PeerRange, RangeScale } from '../components/PeerRange';
import { balanceChange, Card, ErrorBox, Loading, Monogram, Pct, PeriodPicker, Tabs, TypeLabel, typeKey, useTabParam } from '../components/ui';
import { useI18n } from '../i18n';

const TABS = ['funds', 'market'] as const;

export function Compare() {
  const { t, fmt } = useI18n();
  const [period, setPeriod] = useState<Period>('1Y');
  const [tab, setTab] = useTabParam(TABS, 'funds');
  const q = useQuery({ queryKey: ['compare', period], queryFn: () => api.compare(period), placeholderData: keepPreviousData });

  if (q.isPending) {
    return <Loading />;
  }

  if (q.isError) {
    return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  }

  const r = q.data;
  const tabs = [
    { id: 'funds' as const, label: t('compare.tab.funds') },
    { id: 'market' as const, label: t('compare.tab.market') },
  ];
  // Sits in each tab's card, next to the table it changes; one period for all tabs.
  const picker = <PeriodPicker value={period} onChange={setPeriod} />;

  return (
    <div className="stack" style={{ opacity: q.isPlaceholderData ? 0.6 : 1 }}>
      <div className="page-head">
        <div>
          <h1>{t('compare.title')}</h1>
          <div className="sub">{t('compare.intro', { month: fmt.month(r.asOf) })}</div>
        </div>
      </div>

      <Tabs label={t('compare.title')} value={tab} onChange={id => setTab(id)} tabs={tabs} />

      {tab === 'funds' && <FundsVsMarket r={r} picker={picker} />}
      {tab === 'market' && <MarketTable r={r} picker={picker} />}
    </div>
  );
}

function FundsVsMarket({ r, picker }: { r: CompareResult; picker: ReactNode }) {
  const { t, fmt } = useI18n();
  const compared = r.funds.filter(f => f.market.count > 0 && f.mine !== null);
  // One scale for every row, so the bars can be compared with each other.
  const values = compared.flatMap(f => [f.mine!, f.market.min!, f.market.max!]);
  const scale: [number, number] = [Math.min(0, ...values), Math.max(0.01, ...values)];
  // The window everyone shares; a fund measured over different months says so on its own row.
  const windows = compared.map(f => `${f.from}|${f.to}`);
  const common = windows.sort((a, b) => windows.filter(w => w === b).length - windows.filter(w => w === a).length)[0];
  const [commonFrom, commonTo] = common?.split('|') ?? [null, null];

  return (
    <Card
      flush
      actions={picker}
      hint={
        <>
          {t('compare.fundsHint')}
          {commonFrom && <> {t('market.window', { from: fmt.month(commonFrom), to: fmt.month(commonTo) })}</>}
        </>
      }
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('table.fund')}</th>
              <th className="num">{t('compare.colYours')}</th>
              <th>
                {t('compare.colRange')}
                {compared.length > 0 && <RangeScale scale={scale} />}
              </th>
              <th className="num">{t('market.median')}</th>
              <th>{t('compare.colStanding')}</th>
            </tr>
          </thead>
          <tbody>
            {r.funds.map(f => {
              const has = f.market.count > 0 && f.mine !== null;

              return (
                <tr key={f.fundId}>
                  <td>
                    <div className="fund-cell">
                      <Monogram name={f.name} type={f.type} />
                      <span className="names">
                        <Link to={`/funds/${f.fundId}?tab=compare`} dir="auto">
                          {f.name}
                        </Link>
                        <span className="meta">
                          <TypeLabel type={f.type} />
                        </span>
                      </span>
                    </div>
                  </td>
                  <td className="num">
                    <b style={{ fontSize: '1.05rem' }}>
                      <Pct value={f.mine} />
                    </b>
                    {f.mine !== null && (
                      <div className="small muted">
                        {t('compare.moneyLine', { gain: fmt.signedMoney(f.gain), deposits: fmt.money(f.deposits ?? 0), change: fmt.pct(f.mine === null ? null : balanceChange(f), 1) })}
                      </div>
                    )}
                    {has && `${f.from}|${f.to}` !== common && (
                      <div className="small muted">{t('yield.window', { from: fmt.month(f.from), to: fmt.month(f.to) })}</div>
                    )}
                  </td>
                  <td className="range-cell">
                    {has ? (
                      <PeerRange stats={f.market} scale={scale} labels={false} />
                    ) : (
                      <span className="small muted">{f.benchmarks.length === 0 ? t('compare.noBenchmarkShort') : t('market.notCovered')}</span>
                    )}
                  </td>
                  <td className="num">{has ? <Pct value={f.market.median} /> : '—'}</td>
                  <td>{has ? <Standing percentile={f.market.percentile} /> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flush-pad" style={{ paddingTop: 12 }}>
        <MarketSource through={r.marketThrough} />
      </div>
    </Card>
  );
}

function MarketTable({ r, picker }: { r: CompareResult; picker: ReactNode }) {
  const { t, fmt } = useI18n();
  const names = useBenchmarkNames();
  const types = [...new Set(r.market.map(b => b.type))];
  const myTypes = r.yours.map(y => y.type).filter(ty => types.includes(ty));
  const [picked, setPicked] = useState<FundType | null>(null);
  const type = picked ?? myTypes[0] ?? types[0] ?? null;
  const filter = useTrackFilter(r.market.filter(b => b.type === type));
  const [expanded, setExpanded] = useState(false);

  if (!type) {
    return <p className="muted">{t('market.none')}</p>;
  }

  const rows: Array<{ you?: { name: string; return: number | null }; b?: BenchmarkReturn; value: number | null }> = [
    ...r.market.filter(b => b.type === type && filter.keep(b)).map(b => ({ b, value: b.return })),
    ...r.yours.filter(y => y.type === type).map(y => ({ you: { name: y.name, return: y.return }, value: y.return })),
  ].sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));

  return (
    <Card
      flush
      title={<TypeLabel type={type} />}
      hint={t('compare.marketHint', { month: fmt.month(r.marketWindows.find(w => w.type === type)?.to ?? r.asOf) })}
      actions={
        <div className="row" style={{ gap: 12 }}>
          <select value={type} onChange={e => setPicked(e.target.value as FundType)} style={{ width: 'auto' }} aria-label={t('compare.typeFilter')}>
            {types.map(ty => (
              <option key={ty} value={ty}>
                {t(typeKey(ty))}
              </option>
            ))}
          </select>
          {picker}
        </div>
      }
    >
      {filter.tracks.length > 1 && (
        <div className="flush-pad" style={{ paddingBottom: 12 }}>
          <TrackFilter tracks={filter.tracks} value={filter.track} onChange={filter.setTrack} />
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('market.provider')}</th>
              <th>{t('market.track')}</th>
              <th className="num">{t('market.return')}</th>
            </tr>
          </thead>
          <tbody>
            {foldRows(rows, row => !!row.you, expanded).map((f, i) => {
              if ('gap' in f) {
                return <GapRow key={`gap-${i}`} count={f.gap} colSpan={3} onExpand={() => setExpanded(true)} />;
              }

              const row = f.row;

              return row.you ? (
                <tr key={`you-${i}`} className="you">
                  <td colSpan={2}>
                    <bdi>{row.you.name}</bdi> · {t('market.you')}
                  </td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    <Pct value={row.you.return} />
                  </td>
                </tr>
              ) : (
                <tr key={row.b!.id} className={row.value === null ? 'dim' : 'bench-row'}>
                  <td>{names.provider(row.b!)}</td>
                  <td>{names.track(row.b!)}</td>
                  <td className="num">{row.value === null ? <span className="small">{t('market.tooNew')}</span> : <Pct value={row.value} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flush-pad row" style={{ paddingTop: 12, justifyContent: 'space-between', gap: 12 }}>
        <MarketSource through={r.marketThrough} />
        <FoldToggle total={rows.filter(row => !row.you).length} expanded={expanded} onToggle={() => setExpanded(e => !e)} />
      </div>
    </Card>
  );
}
