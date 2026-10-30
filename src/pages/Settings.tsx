import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '../api';
import { ME_KEY, useMe, useSignOut } from '../auth';
import { Card, ErrorText, Icon } from '../components/ui';
import { workspace } from '../data/workspace';
import { useI18n, type Lang } from '../i18n';

export function Settings() {
  const { t, lang, setLang } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const signOut = useSignOut();
  const [displayName, setDisplayName] = useState(me?.displayName ?? '');
  const fileInput = useRef<HTMLInputElement>(null);

  const updateMe = useMutation({
    mutationFn: api.updateMe,
    onSuccess: user => qc.setQueryData(ME_KEY, user),
  });
  const download = useMutation({ mutationFn: api.downloadData });
  const open = useMutation({
    mutationFn: api.openDataFile,
    onSuccess: async () => {
      await qc.invalidateQueries();
    },
  });

  if (!me) {
    return null;
  }

  const { backend } = workspace();
  const fileUrl = backend.fileUrl();

  const onProfile = (e: FormEvent) => {
    e.preventDefault();
    updateMe.mutate({ displayName });
  };

  const onPick = (file: File | undefined) => {
    if (file && window.confirm(t('settings.replaceConfirm', { file: file.name }))) {
      open.mutate(file);
    }

    if (fileInput.current) {
      fileInput.current.value = '';
    }
  };

  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <div className="page-head">
        <div>
          <h1>{t('settings.title')}</h1>
          {me.email && <div className="sub">{t('settings.signedInAs', { email: me.email })}</div>}
        </div>
      </div>

      <Card title={t('settings.profile')}>
        <form className="stack" onSubmit={onProfile}>
          <div className="form-grid">
            <label className="field">
              {t('settings.displayName')}
              <input value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={60} dir="auto" />
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

      <Card title={t('settings.data')}>
        <div className="stack">
          <p>
            {backend.kind === 'drive' ? t('settings.whereDrive', { file: backend.fileName }) : t('settings.whereBrowser')}{' '}
            {fileUrl && (
              <a href={fileUrl} target="_blank" rel="noreferrer">
                {t('settings.openInDrive')}
              </a>
            )}
          </p>

          <div className="row">
            <button className="btn" onClick={() => download.mutate()} disabled={download.isPending}>
              <Icon name="download" /> {t('settings.download')}
            </button>
            <span className="muted small">{t('settings.downloadHint')}</span>
          </div>
          <ErrorText error={download.error} />

          <div className="row">
            <button className="btn" onClick={() => fileInput.current?.click()} disabled={open.isPending}>
              <Icon name="upload" /> {t('settings.replace')}
            </button>
            <span className="muted small">{t('settings.replaceHint')}</span>
            <input ref={fileInput} type="file" accept=".db,.sqlite,application/x-sqlite3" hidden onChange={e => onPick(e.target.files?.[0])} />
          </div>
          {open.isSuccess && <div className="notice info">{t('settings.replaced')}</div>}
          <ErrorText error={open.error} />
        </div>
      </Card>

      <Card title={t('nav.signOut')} hint={backend.kind === 'drive' ? t('settings.signOutDrive') : t('settings.signOutBrowser')}>
        <button className="btn" onClick={() => signOut.mutate(undefined, { onSuccess: () => navigate('/') })} disabled={signOut.isPending}>
          <span className="flip">
            <Icon name="logout" />
          </span>{' '}
          {t('nav.signOut')}
        </button>
        <ErrorText error={signOut.error} />
      </Card>
    </div>
  );
}
