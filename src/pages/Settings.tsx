import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { api } from '../api';
import { forgetUser, ME_KEY, useMe } from '../auth';
import { Card, ErrorText } from '../components/ui';
import { useI18n, type Lang } from '../i18n';

export function Settings() {
  const { t, lang, setLang } = useI18n();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [displayName, setDisplayName] = useState(me?.displayName ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [deletePassword, setDeletePassword] = useState('');

  const updateMe = useMutation({
    mutationFn: api.updateMe,
    onSuccess: user => {
      qc.setQueryData(ME_KEY, user);
      qc.invalidateQueries({ queryKey: ['compare'] });
    },
  });
  const changePassword = useMutation({
    mutationFn: () => api.changePassword(currentPassword, newPassword),
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
    },
  });
  const deleteAccount = useMutation({
    mutationFn: () => api.deleteAccount(deletePassword),
    onSuccess: () => forgetUser(qc),
  });

  if (!me) {
    return null;
  }

  const onProfile = (e: FormEvent) => {
    e.preventDefault();
    updateMe.mutate({ displayName });
  };

  const onPassword = (e: FormEvent) => {
    e.preventDefault();
    changePassword.mutate();
  };

  const onDelete = (e: FormEvent) => {
    e.preventDefault();
    deleteAccount.mutate();
  };

  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <div className="page-head">
        <div>
          <h1>{t('settings.title')}</h1>
          <div className="sub">{t('settings.signedInAs', { username: me.username })}</div>
        </div>
      </div>

      <Card title={t('settings.profile')}>
        <form className="stack" onSubmit={onProfile}>
          <div className="form-grid">
            <label className="field">
              {t('settings.displayName')}
              <input value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={60} required dir="auto" />
            </label>
            <label className="field">
              {t('settings.language')}
              <select value={lang} onChange={e => setLang(e.target.value as Lang)}>
                <option value="he">עברית</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>
          <div className="row">
            <button className="btn primary" type="submit" disabled={updateMe.isPending}>
              {t('common.save')}
            </button>
            {updateMe.isSuccess && <span className="muted small">{t('settings.saved')}</span>}
          </div>
          <ErrorText error={updateMe.error} />
        </form>
      </Card>

      <Card title={t('settings.privacy')}>
        <label className="check">
          <input type="checkbox" checked={me.shareAnonymously} onChange={e => updateMe.mutate({ shareAnonymously: e.target.checked })} />
          <span>
            {t('auth.share')}
            <br />
            <span className="muted small">{t('auth.shareHint')}</span>
          </span>
        </label>
      </Card>

      <Card title={t('settings.password')}>
        <form className="stack" onSubmit={onPassword}>
          <div className="form-grid">
            <label className="field">
              {t('settings.currentPassword')}
              <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} autoComplete="current-password" required dir="ltr" />
            </label>
            <label className="field">
              {t('settings.newPassword')}
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} autoComplete="new-password" minLength={8} required dir="ltr" />
              <span className="hint">{t('auth.passwordHint')}</span>
            </label>
          </div>
          <ErrorText error={changePassword.error} />
          {changePassword.isSuccess && <div className="notice info">{t('settings.passwordChanged')}</div>}
          <div>
            <button className="btn primary" type="submit" disabled={changePassword.isPending}>
              {t('settings.password')}
            </button>
          </div>
        </form>
      </Card>

      <Card title={t('settings.danger')} hint={t('settings.dangerHint')}>
        <form className="row" onSubmit={onDelete}>
          <input
            type="password"
            value={deletePassword}
            onChange={e => setDeletePassword(e.target.value)}
            placeholder={t('settings.deleteConfirm')}
            autoComplete="current-password"
            required
            style={{ maxWidth: 280 }}
            dir="ltr"
          />
          <button className="btn danger" type="submit" disabled={deleteAccount.isPending}>
            {t('settings.danger')}
          </button>
        </form>
        {deleteAccount.error && (
          <div style={{ marginTop: 8 }}>
            <ErrorText error={deleteAccount.error} />
          </div>
        )}
      </Card>
    </div>
  );
}
