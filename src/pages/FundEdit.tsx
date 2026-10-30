import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { FUND_STATUSES, FUND_TYPES, type FundInput } from '../../shared/types';
import { api } from '../api';
import { Card, ErrorBox, ErrorText, Loading, typeKey } from '../components/ui';
import { useI18n } from '../i18n';
import type { MessageKey } from '../locales';

const PROVIDERS = ['Altshuler Shaham', 'Meitav', 'Harel', 'Migdal', 'Menora', 'Clal', 'Phoenix', 'More', 'Analyst', 'Infinity', 'Yelin Lapidot', 'IBI'];
const TRACKS = ['General', 'Equities', 'S&P 500', 'Bonds', 'Age 50 and under', 'Age 50-60', 'Age 60 and over', 'Halacha', 'Money market'];

const EMPTY: Required<FundInput> = { name: '', type: 'pension_comprehensive', provider: '', track: '', status: 'active', notes: '' };

export function FundEdit() {
  const { t } = useI18n();
  const params = useParams();
  const id = params.id ? Number(params.id) : null;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const existing = useQuery({ queryKey: ['fund', id], queryFn: () => api.fund(id!), enabled: id !== null });
  const [form, setForm] = useState<Required<FundInput>>(EMPTY);

  useEffect(() => {
    if (existing.data) {
      const { name, type, provider, track, status, notes } = existing.data;

      setForm({ name, type, provider, track, status, notes });
    }
  }, [existing.data]);

  const save = useMutation({
    mutationFn: async () => (id === null ? (await api.createFund(form)).id : (await api.updateFund(id, form)).id),
    onSuccess: savedId => {
      qc.invalidateQueries();
      navigate(`/funds/${savedId}`);
    },
  });

  if (id !== null && existing.isPending) {
    return <Loading />;
  }

  if (existing.isError) {
    return <ErrorBox error={existing.error} />;
  }

  const set = <K extends keyof FundInput>(key: K, value: Required<FundInput>[K]) => setForm(f => ({ ...f, [key]: value }));
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <h1>{id === null ? t('fund.new') : t('fund.editTitle')}</h1>
      </div>
      <Card>
        <form onSubmit={onSubmit} className="stack">
          <div className="form-grid">
            <label className="field">
              {t('fund.name')}
              <input
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder={t('fund.namePlaceholder')}
                required
                autoFocus
                maxLength={80}
                dir="auto"
              />
            </label>
            <label className="field">
              {t('fund.type')}
              <select value={form.type} onChange={e => set('type', e.target.value as FundInput['type'])}>
                {FUND_TYPES.map(type => (
                  <option key={type} value={type}>
                    {t(typeKey(type))}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {t('fund.provider')}
              <input value={form.provider} onChange={e => set('provider', e.target.value)} list="providers" maxLength={60} dir="auto" />
            </label>
            <label className="field">
              {t('fund.track')}
              <input value={form.track} onChange={e => set('track', e.target.value)} list="tracks" maxLength={60} dir="auto" />
            </label>
            <label className="field">
              {t('fund.status')}
              <select value={form.status} onChange={e => set('status', e.target.value as Required<FundInput>['status'])}>
                {FUND_STATUSES.map(s => (
                  <option key={s} value={s}>
                    {t(`status.${s}` as MessageKey)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            {t('fund.notes')}
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} maxLength={500} dir="auto" />
          </label>
          <datalist id="providers">
            {PROVIDERS.map(p => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <datalist id="tracks">
            {TRACKS.map(p => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <ErrorText error={save.error} />
          <div className="row">
            <button className="btn primary" type="submit" disabled={save.isPending}>
              {save.isPending ? t('common.saving') : id === null ? t('fund.create') : t('common.save')}
            </button>
            <button className="btn" type="button" onClick={() => navigate(-1)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
