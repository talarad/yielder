import type { PeerStats } from '../../shared/types';
import { useI18n } from '../i18n';

/**
 * Number line: the others' full range as a thin line, their middle 50% as a gray band, the
 * median as a tick, you as the blue dot. Pass `scale` to put several rows on one shared axis
 * (then labels are usually shown once, in a header, with `labels={false}`).
 */
export function PeerRange({ stats, scale, labels = true }: { stats: PeerStats; scale?: [number, number]; labels?: boolean }) {
  const { t, fmt, dir } = useI18n();

  if (stats.count === 0 || stats.min === null || stats.max === null) {
    return null;
  }

  const lo = scale?.[0] ?? Math.min(stats.min, stats.mine ?? stats.min);
  const hi = scale?.[1] ?? Math.max(stats.max, stats.mine ?? stats.max);
  const pad = scale ? 0 : (hi - lo) * 0.06 || 0.01;
  const pos = (v: number) => `${((v - (lo - pad)) / (hi - lo + 2 * pad || 1)) * 100}%`;
  const title = `${t('compare.range')}: ${fmt.pct(stats.p25)} – ${fmt.pct(stats.p75)} · ${t('compare.median')} ${fmt.pct(stats.median)}`;

  return (
    <div dir="ltr">
      <div className="range" title={title}>
        <div className="axis" />
        <div className="span" style={{ left: pos(stats.min), width: `calc(${pos(stats.max)} - ${pos(stats.min)})` }} />
        <div className="iqr" style={{ left: pos(stats.p25!), width: `calc(${pos(stats.p75!)} - ${pos(stats.p25!)})` }} />
        <div className="median" style={{ left: pos(stats.median!) }} />
        {stats.mine !== null && <div className="mine" style={{ left: pos(stats.mine) }} title={`${t('compare.you')}: ${fmt.pct(stats.mine)}`} />}
      </div>
      {labels && (
        // Ends label the axis itself, which stretches to include you when you're outside the range.
        <div className="range-labels">
          <span>{fmt.pct(lo, 1)}</span>
          {/* The number line is left-to-right; the label inside it follows the UI language. */}
          <bdi dir={dir}>
            {t('compare.median')} {fmt.pct(stats.median, 1)}
          </bdi>
          <span>{fmt.pct(hi, 1)}</span>
        </div>
      )}
    </div>
  );
}

/** Axis labels for a column of PeerRange rows that share one scale. */
export function RangeScale({ scale }: { scale: [number, number] }) {
  const { fmt } = useI18n();
  const mid = (scale[0] + scale[1]) / 2;

  return (
    <div dir="ltr" className="range-labels" style={{ marginTop: 0 }}>
      <span>{fmt.pct(scale[0], 0)}</span>
      <span>{fmt.pct(mid, 0)}</span>
      <span>{fmt.pct(scale[1], 0)}</span>
    </div>
  );
}
