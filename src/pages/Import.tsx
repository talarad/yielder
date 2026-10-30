import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';

import { FUND_TYPES, type FundType, type ImportPreview, type ImportResult, type ImportWarning } from '../../shared/types';
import { api } from '../api';
import { ImportGuide } from '../components/ImportGuide';
import { Card, ErrorText, Icon, Tabs, typeKey, useTabParam } from '../components/ui';
import { useI18n } from '../i18n';
import type { MessageKey } from '../locales';

interface RowChoice {
  include: boolean;
  name: string;
  type: FundType;
  targetFundId: number | null;
}

export function Import() {
  const { t, fmt } = useI18n();
  const qc = useQueryClient();
  const funds = useQuery({ queryKey: ['funds'], queryFn: api.funds });
  const [fileName, setFileName] = useState('');
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [choices, setChoices] = useState<Record<string, RowChoice>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [tab, setTab] = useTabParam(['upload', 'guide'] as const, 'upload');

  const read = useMutation({
    mutationFn: (file: File) => api.importPreview(file),
    onSuccess: p => {
      setPreview(p);
      setChoices(Object.fromEntries(p.funds.map(f => [f.key, { include: true, name: f.name, type: f.type, targetFundId: f.existingFundId }])));
    },
  });

  const commit = useMutation({
    mutationFn: () =>
      api.importCommit(
        preview!.funds
          .filter(f => choices[f.key].include)
          .map(f => {
            const c = choices[f.key];

            return { name: c.name.trim() || f.name, type: c.type, provider: f.provider, track: f.track, status: f.status, notes: f.notes, targetFundId: c.targetFundId, entries: f.entries };
          }),
      ),
    onSuccess: res => {
      setResult(res);
      qc.invalidateQueries();
    },
  });

  const pick = (file: File | undefined) => {
    if (!file) {
      return;
    }

    setFileName(file.name);
    setResult(null);
    read.mutate(file);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    pick(e.dataTransfer.files[0]);
  };

  const reset = () => {
    setPreview(null);
    setResult(null);
    setFileName('');
    read.reset();
    commit.reset();
  };

  const update = (key: string, patch: Partial<RowChoice>) => setChoices(c => ({ ...c, [key]: { ...c[key], ...patch } }));
  const selected = preview?.funds.filter(f => choices[f.key]?.include).length ?? 0;
  const warningText = ({ code, ...vars }: ImportWarning) =>
    t(`importWarn.${code}` as MessageKey, 'month' in vars ? { ...vars, month: fmt.month(vars.month) } : vars);
  const warnings = [
    ...(preview?.warnings ?? []).map(w => ({ fund: null, text: warningText(w) })),
    ...(preview?.funds ?? []).flatMap(f => f.warnings.map(w => ({ fund: f.name, text: warningText(w) }))),
  ];

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{t('import.title')}</h1>
          <div className="sub" style={{ maxWidth: 720 }}>
            {t('import.intro')}
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => void api.downloadTemplate()}>
            <Icon name="download" /> {t('import.template')}
          </button>
          <button className="btn" onClick={() => void api.downloadExport()}>
            <Icon name="download" /> {t('import.export')}
          </button>
        </div>
      </div>

      <Tabs
        label={t('import.title')}
        value={tab}
        onChange={id => setTab(id)}
        tabs={[
          { id: 'upload', label: t('import.tab.upload') },
          { id: 'guide', label: t('import.tab.guide') },
        ]}
      />

      {tab === 'guide' ? (
        <ImportGuide onUpload={() => setTab('upload')} />
      ) : result ? (
        <Card>
          <div className="stack">
            <div className="notice info">
              {t('import.done', {
                created: result.createdFunds,
                updated: result.updatedFunds,
                inserted: result.insertedMonths,
                changed: result.updatedMonths,
              })}
            </div>
            <div className="row">
              <Link className="btn primary" to="/">
                {t('import.goDashboard')}
              </Link>
              <button className="btn" onClick={reset}>
                {t('import.again')}
              </button>
            </div>
          </div>
        </Card>
      ) : !preview ? (
        <>
          <div className="notice info" role="note">
            <span className="info-i" aria-hidden="true">i</span>
            <span>
              {t('import.formatHint')}{' '}
              <button className="btn small" onClick={() => setTab('guide')}>
                {t('import.tab.guide')}
              </button>
            </span>
          </div>
          <label
            className={`dropzone${over ? ' over' : ''}`}
            onDragOver={e => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
          >
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={e => pick(e.target.files?.[0])} />
            <div className="stack" style={{ gap: 8, justifyItems: 'center' }}>
              <Icon name="upload" size={28} />
              {read.isPending ? (
                <span>{t('import.reading')}</span>
              ) : (
                <>
                  <span className="btn primary">{t('import.choose')}</span>
                  <span className="muted small">{t('import.drop')}</span>
              </>
            )}
          </div>
          {read.error && (
            <div style={{ marginTop: 16 }}>
              <ErrorText error={read.error} />
            </div>
          )}
        </label>
        </>
      ) : (
        <Card
          title={t('import.found', { count: preview.funds.length })}
          hint={<bdi>{fileName}</bdi>}
          actions={
            <button className="btn small" onClick={reset}>
              {t('common.cancel')}
            </button>
          }
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('import.include')}</th>
                  <th>{t('fund.name')}</th>
                  <th>{t('fund.type')}</th>
                  <th>{t('import.target')}</th>
                  <th className="num">{t('import.months')}</th>
                  <th>{t('import.changes')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.funds.map(f => {
                  const c = choices[f.key];
                  const changes =
                    c.targetFundId === null
                      ? t('import.newMonths', { count: f.entries.length })
                      : c.targetFundId === f.existingFundId
                        ? f.newMonths || f.changedMonths
                          ? [f.newMonths && t('import.newMonths', { count: f.newMonths }), f.changedMonths && t('import.changedMonths', { count: f.changedMonths })]
                              .filter(Boolean)
                              .join(', ')
                          : t('import.unchanged')
                        : '';

                  return (
                    <tr key={f.key} className={c.include ? '' : 'dim'}>
                      <td>
                        <input type="checkbox" checked={c.include} onChange={e => update(f.key, { include: e.target.checked })} aria-label={t('import.include')} />
                      </td>
                      <td style={{ minWidth: 180 }}>
                        <input
                          value={c.name}
                          onChange={e => update(f.key, { name: e.target.value })}
                          disabled={!c.include || c.targetFundId !== null}
                          aria-label={t('fund.name')}
                          dir="auto"
                        />
                      </td>
                      <td style={{ minWidth: 200 }}>
                        <select value={c.type} onChange={e => update(f.key, { type: e.target.value as FundType })} disabled={!c.include || c.targetFundId !== null}>
                          {FUND_TYPES.map(ty => (
                            <option key={ty} value={ty}>
                              {t(typeKey(ty))}
                            </option>
                          ))}
                        </select>
                        {f.typeGuessed && c.targetFundId === null && <div className="muted small">{t('import.guessed')}</div>}
                      </td>
                      <td style={{ minWidth: 180 }}>
                        <select
                          value={c.targetFundId ?? ''}
                          onChange={e => update(f.key, { targetFundId: e.target.value ? Number(e.target.value) : null })}
                          disabled={!c.include}
                        >
                          <option value="">{t('import.newFund')}</option>
                          {funds.data?.map(x => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="num">
                        {f.entries.length}
                        <div className="muted small">
                          {fmt.month(f.firstMonth)} – {fmt.month(f.lastMonth)}
                        </div>
                      </td>
                      <td>{changes}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {warnings.length > 0 && (
            <div className="notice" style={{ marginTop: 16 }}>
              <b>{t('import.warnings')}</b>
              <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
                {warnings.slice(0, 20).map((w, i) => (
                  <li key={i}>
                    {w.fund && (
                      <>
                        <bdi>{w.fund}</bdi>:{' '}
                      </>
                    )}
                    {w.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {commit.error && (
            <div style={{ marginTop: 16 }}>
              <ErrorText error={commit.error} />
            </div>
          )}
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn primary" disabled={!selected || commit.isPending} onClick={() => commit.mutate()}>
              {commit.isPending ? t('common.saving') : t('import.submit', { count: selected })}
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}
