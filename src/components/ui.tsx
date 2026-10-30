import { Fragment, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

import { PERIODS, type FundType, type Period } from '../../shared/types';
import { useI18n } from '../i18n';
import type { MessageKey } from '../locales';

/** A single month moving more than this is flagged as a likely typo or data-entry timing issue. */
export const UNUSUAL_MONTH = 0.15;

export function toneOf(v: number | null | undefined): string {
  if (v === null || v === undefined) {
    return 'na';
  }

  return v > 0 ? 'gain' : v < 0 ? 'loss' : '';
}

export function Pct({ value, digits }: { value: number | null | undefined; digits?: number }) {
  const { fmt } = useI18n();

  return <span className={toneOf(value)}>{fmt.pct(value, digits)}</span>;
}

/**
 * How much the balance itself changed, deposits included: (end − start) / start. Shown next to
 * the real return so the effect of your own deposits is visible.
 */
export function balanceChange(y: { startBalance: number | null; endBalance: number | null }): number | null {
  return y.startBalance && y.endBalance !== null ? (y.endBalance - y.startBalance) / y.startBalance : null;
}

/** Column header with a second, quieter line (e.g. "Real return / excl. deposits"). */
export function TwoLineHeader({ label, sub }: { label: string; sub: string }) {
  return (
    <>
      {label}
      <div style={{ fontWeight: 400, fontSize: '0.72rem', opacity: 0.85 }}>{sub}</div>
    </>
  );
}

export function typeKey(type: FundType): MessageKey {
  return `type.${type}` as MessageKey;
}

export function periodKey(period: Period): MessageKey {
  return `period.${period}` as MessageKey;
}

export function Kpi({ label, value, foot, title }: { label: string; value: ReactNode; foot?: ReactNode; title?: string }) {
  return (
    <div className="card kpi" title={title}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {foot && <div className="foot">{foot}</div>}
    </div>
  );
}

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const { t } = useI18n();

  return (
    <div className="segmented" role="tablist">
      {PERIODS.map(p => (
        <button key={p} role="tab" aria-selected={p === value} className={p === value ? 'on' : ''} onClick={() => onChange(p)}>
          {t(periodKey(p))}
        </button>
      ))}
    </div>
  );
}

export function Loading() {
  const { t } = useI18n();

  return <div className="splash">{t('common.loading')}</div>;
}

/** Short values (provider, track, type) joined by a separator, each isolated so mixed Hebrew/English keeps its order. */
export function Joined({ parts, sep = ' · ' }: { parts: Array<string | null | undefined>; sep?: string }) {
  return (
    <>
      {parts
        .filter((p): p is string => !!p)
        .map((p, i) => (
          <Fragment key={i}>
            {i > 0 && sep}
            <bdi>{p}</bdi>
          </Fragment>
        ))}
    </>
  );
}

export function Stat({ label, value, foot }: { label: string; value: ReactNode; foot?: ReactNode }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {foot && <span className="foot">{foot}</span>}
    </div>
  );
}

export function StaleNotice({ funds }: { funds: Array<{ id: number; name: string }> }) {
  const { t } = useI18n();

  if (funds.length === 0) {
    return null;
  }

  return (
    <div className="notice" role="status">
      <Icon name="alert" size={20} />
      <span>
        <b>{t('dash.staleLabel')}</b>{' '}
        {funds.map((f, i) => (
          <Fragment key={f.id}>
            {i > 0 && ', '}
            <bdi>{f.name}</bdi>
          </Fragment>
        ))}
        . {t('dash.staleHint')}
      </span>
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  const { errorText } = useI18n();

  return error ? <div className="notice error">{errorText(error)}</div> : null;
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t, errorText } = useI18n();

  return (
    <div className="notice error row">
      <span>{errorText(error)}</span>
      {onRetry && (
        <button className="btn small" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

/** `flush` drops the side padding so a table can run edge to edge. */
export function Card({
  title,
  hint,
  actions,
  flush,
  children,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={flush ? 'card flush' : 'card'}>
      {(title || actions || hint) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {hint && <div className="hint">{hint}</div>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

const ICONS = {
  sun: 'M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.41-1.41M4.93 19.07l1.41-1.41m0-11.32L4.93 4.93m14.14 14.14-1.41-1.41M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  upload: 'M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  download: 'M12 4v12m0 0-4-4m4 4 4-4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  plus: 'M12 5v14M5 12h14',
  check: 'M20 6 9 17l-5-5',
  logo: 'M4 17l5-6 4 3 7-8',
  overview: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  funds: 'M12 3 3 8l9 5 9-5-9-5ZM3 13l9 5 9-5M3 17.5l9 5 9-5',
  compare: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  trendUp: 'M7 17 17 7M9 7h8v8',
  trendDown: 'M7 7l10 10M17 9v8H9',
  alert: 'M12 8v5m0 3.5v.5M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v10a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2Zm13 7h.01',
};

export function Icon({ name, size = 18, strokeWidth = 2 }: { name: keyof typeof ICONS; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden="true">
      <rect width="34" height="34" rx="10" fill="var(--accent)" />
      <path d="M9 22.5l5.5-6.5 4.5 3.5 6.5-8" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** First letter of a name, for avatar/fund monograms. */
export function initialOf(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? '?';
}

/** Product family that decides a fund's color: all pension products share one, and so on. */
export function typeClass(type: FundType): string {
  switch (type) {
    case 'pension_comprehensive':
    case 'pension_supplementary':
    case 'managers_insurance':
      return 'tc-pension';
    case 'education_fund':
      return 'tc-education';
    case 'provident_fund':
      return 'tc-provident';
    case 'investment_provident_fund':
      return 'tc-invest';
    case 'self_managed':
      return 'tc-self';
    case 'savings':
      return 'tc-savings';
    default:
      return 'tc-other';
  }
}

export function Monogram({ name, type, large }: { name: string; type: FundType; large?: boolean }) {
  return (
    <span className={`monogram typed ${typeClass(type)}${large ? ' large' : ''}`} aria-hidden="true">
      {initialOf(name)}
    </span>
  );
}

/** Fund type label with its color swatch (the swatch never appears without the name). */
export function TypeLabel({ type, chip }: { type: FundType; chip?: boolean }) {
  const { t } = useI18n();

  return (
    <span className={`${chip ? 'chip ' : ''}${typeClass(type)}`} style={chip ? undefined : { display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span className="type-dot" aria-hidden="true" />
      {t(typeKey(type))}
    </span>
  );
}

/** The selected tab, kept in the URL (?tab=) so Back, reload and shared links land on it. */
export function useTabParam<T extends string>(ids: readonly T[], fallback: T): [T, (tab: T, extra?: Record<string, string>) => void] {
  const [params, setParams] = useSearchParams();
  const current = params.get('tab') as T | null;
  const tab = current && ids.includes(current) ? current : fallback;

  return [tab, (next, extra) => setParams({ tab: next, ...extra })];
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: Array<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map(tab => (
        <button key={tab.id} role="tab" aria-selected={tab.id === value} onClick={() => onChange(tab.id)}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** Month + year selects. Value and onChange use 'YYYY-MM'. */
export function MonthInput({
  value,
  onChange,
  fromYear = 2000,
  toYear = new Date().getFullYear() + 1,
  label,
}: {
  value: string;
  onChange: (month: string) => void;
  fromYear?: number;
  toYear?: number;
  label: string;
}) {
  const { lang } = useI18n();
  const names = new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-IL', { month: 'long' });
  const [y, m] = value.split('-').map(Number);
  const years = [];

  for (let year = Math.max(toYear, y || 0); year >= Math.min(fromYear, y || fromYear); year--) {
    years.push(year);
  }

  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <span className="month-input" role="group" aria-label={label}>
      <select value={m} onChange={e => onChange(`${y}-${pad(Number(e.target.value))}`)} aria-label={`${label} – month`}>
        {Array.from({ length: 12 }, (_, i) => (
          <option key={i + 1} value={i + 1}>
            {names.format(new Date(2000, i, 1))}
          </option>
        ))}
      </select>
      <select value={y} onChange={e => onChange(`${e.target.value}-${pad(m)}`)} aria-label={`${label} – year`}>
        {years.map(year => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>
    </span>
  );
}
