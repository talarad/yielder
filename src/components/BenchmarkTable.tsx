import { useState } from 'react';

import type { BenchmarkReturn, FundComparison, FundType } from '../../shared/types';
import { useI18n } from '../i18n';
import { balanceChange, Pct } from './ui';

/** Product types the market data has no equivalent for. */
const NO_BENCHMARK: FundType[] = ['self_managed', 'savings', 'other', 'managers_insurance'];

export function useBenchmarkNames() {
  const { lang } = useI18n();

  return {
    provider: (b: BenchmarkReturn) => (lang === 'he' ? b.providerHe || b.provider : b.provider),
    track: (b: BenchmarkReturn) => (lang === 'he' ? b.trackHe || b.track : b.track),
  };
}

/** Where you stand among the market funds, in a few words. */
export function Standing({ percentile }: { percentile: number | null }) {
  const { t } = useI18n();

  if (percentile === null) {
    return <span className="muted">—</span>;
  }

  return percentile >= 99.5 ? (
    <span className="chip accent small">{t('compare.standingBest')}</span>
  ) : (
    <span className="chip small">{t('compare.standingTop', { pct: `${Math.max(1, Math.round(100 - percentile))}%` })}</span>
  );
}

export function MarketSource({ through }: { through: string | null }) {
  const { t, fmt } = useI18n();

  return <p className="small muted">{t('market.source', { month: fmt.month(through) })}</p>;
}

/** The tracks among these market funds (in data order) and the one picked, for narrowing long lists. */
export function useTrackFilter(list: BenchmarkReturn[]) {
  const names = useBenchmarkNames();
  const [picked, setPicked] = useState('all');
  const tracks = [...new Map(list.map(b => [b.track, names.track(b)]))];
  const track = tracks.some(([id]) => id === picked) ? picked : 'all';

  return { track, setTrack: setPicked, tracks, keep: (b: BenchmarkReturn) => track === 'all' || b.track === track };
}

export function TrackFilter({ tracks, value, onChange }: { tracks: Array<[string, string]>; value: string; onChange: (track: string) => void }) {
  const { t } = useI18n();

  if (tracks.length < 2) {
    return null;
  }

  return (
    <div className="segmented" role="group" aria-label={t('market.track')}>
      {[['all', t('market.allTracks')], ...tracks].map(([id, label]) => (
        <button key={id} type="button" aria-pressed={id === value} className={id === value ? 'on' : ''} onClick={() => onChange(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export type Folded<T> = { row: T } | { gap: number };

/**
 * A long ranked list folded to the top few rows plus the rows around each of yours; the rest
 * becomes "N more" gaps. Short lists, and lone hidden rows, are shown as they are.
 */
export function foldRows<T>(rows: T[], isYou: (row: T) => boolean, expanded: boolean, top = 5, around = 2): Array<Folded<T>> {
  if (expanded || rows.length <= 12) {
    return rows.map(row => ({ row }));
  }

  const keep = rows.map((_, i) => i < top || rows.slice(Math.max(0, i - around), i + around + 1).some(isYou));
  const out: Array<Folded<T>> = [];

  rows.forEach((row, i) => {
    const last = out[out.length - 1];

    if (keep[i] || (keep[i - 1] && keep[i + 1])) {
      out.push({ row });
    } else if (last && 'gap' in last) {
      last.gap++;
    } else {
      out.push({ gap: 1 });
    }
  });

  return out;
}

/** "N more" row inside a folded table; clicking it unfolds the list. */
export function GapRow({ count, colSpan, onExpand }: { count: number; colSpan: number; onExpand: () => void }) {
  const { t } = useI18n();

  return (
    <tr className="gap-row">
      <td colSpan={colSpan}>
        <button type="button" className="gap-btn" onClick={onExpand}>
          ⋯ {t('market.more', { count })}
        </button>
      </td>
    </tr>
  );
}

export function FoldToggle({ total, expanded, onToggle }: { total: number; expanded: boolean; onToggle: () => void }) {
  const { t } = useI18n();

  if (total <= 12) {
    return null;
  }

  return (
    <button type="button" className="btn small ghost" onClick={onToggle}>
      {expanded ? t('market.showLess') : t('market.showAll', { count: total })}
    </button>
  );
}

/** One fund against the real funds of the same product type, over the same months. */
export function BenchmarkTable({ comparison: c, marketThrough }: { comparison: FundComparison; marketThrough: string | null }) {
  const { t, fmt } = useI18n();
  const names = useBenchmarkNames();
  const filter = useTrackFilter(c.benchmarks);
  const [expanded, setExpanded] = useState(false);

  if (c.benchmarks.length === 0) {
    return <p className="muted">{NO_BENCHMARK.includes(c.type) ? t('market.noneForType') : t('market.none')}</p>;
  }

  const covered = c.benchmarks.filter(b => b.return !== null);

  if (c.mine === null || covered.length === 0) {
    return (
      <div className="stack" style={{ gap: 12 }}>
        <p className="muted">{c.mine === null ? t('yield.noData') : t('market.notCovered')}</p>
        <MarketSource through={marketThrough} />
      </div>
    );
  }

  // Your fund slotted in at its rank among the market funds of the picked track; funds too new
  // for the period go last.
  const rows: Array<{ kind: 'you' } | { kind: 'bench'; b: BenchmarkReturn }> = covered.filter(filter.keep).map(b => ({ kind: 'bench', b }));
  const at = rows.findIndex(r => r.kind === 'bench' && (r.b.return ?? -Infinity) < c.mine!);

  rows.splice(at === -1 ? rows.length : at, 0, { kind: 'you' });
  rows.push(...c.benchmarks.filter(b => b.return === null && filter.keep(b)).map(b => ({ kind: 'bench' as const, b })));

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 32, alignItems: 'flex-end' }}>
        <div className="duel">
          <div>
            <div className="eyebrow">{t('market.you')}</div>
            <div className="value">
              <Pct value={c.mine} />
            </div>
          </div>
          <div>
            <div className="eyebrow">{t('market.median')}</div>
            <div className="value" style={{ color: 'var(--ink-2)' }}>
              <Pct value={c.market.median} />
            </div>
          </div>
        </div>
        <div style={{ marginBottom: 8 }}>
          <Standing percentile={c.market.percentile} />
        </div>
      </div>
      <div className="small muted">
        {t('compare.moneyLine', { gain: fmt.signedMoney(c.gain), deposits: fmt.money(c.deposits ?? 0), change: fmt.pct(c.mine === null ? null : balanceChange(c), 1) })}
        {c.withdrawals ? <> · {t('compare.withdrawnLine', { amount: fmt.money(c.withdrawals) })}</> : null} ·{' '}
        {t('market.window', { from: fmt.month(c.from), to: fmt.month(c.to) })}
      </div>

      <TrackFilter tracks={filter.tracks} value={filter.track} onChange={filter.setTrack} />
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
            {foldRows(rows, r => r.kind === 'you', expanded).map((f, i) =>
              'gap' in f ? (
                <GapRow key={`gap-${i}`} count={f.gap} colSpan={3} onExpand={() => setExpanded(true)} />
              ) : f.row.kind === 'you' ? (
                <tr key="you" className="you">
                  <td colSpan={2}>
                    <bdi>{c.name}</bdi> · {t('market.you')}
                  </td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    <Pct value={c.mine} />
                  </td>
                </tr>
              ) : f.row.b.return === null ? (
                <tr key={f.row.b.id} className="dim">
                  <td>{names.provider(f.row.b)}</td>
                  <td>{names.track(f.row.b)}</td>
                  <td className="num small">{t('market.tooNew')}</td>
                </tr>
              ) : (
                <tr key={f.row.b.id} className="bench-row">
                  <td>{names.provider(f.row.b)}</td>
                  <td>{names.track(f.row.b)}</td>
                  <td className="num">
                    <Pct value={f.row.b.return} />
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
        <MarketSource through={marketThrough} />
        <FoldToggle total={rows.length - 1} expanded={expanded} onToggle={() => setExpanded(e => !e)} />
      </div>
    </div>
  );
}
