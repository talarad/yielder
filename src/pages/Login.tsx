import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { api } from '../api';
import { ME_KEY } from '../auth';
import { LangToggle, ThemeToggle } from '../components/Layout';
import { ErrorText, Logo } from '../components/ui';
import { useI18n } from '../i18n';

export function Login() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [share, setShare] = useState(true);

  const submit = useMutation({
    mutationFn: () =>
      mode === 'signin'
        ? api.login(username, password)
        : api.register({ username, password, displayName: displayName || undefined, shareAnonymously: share }),
    onSuccess: user => qc.setQueryData(ME_KEY, user),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit.mutate();
  };

  const switchMode = () => {
    setMode(m => (m === 'signin' ? 'register' : 'signin'));
    submit.reset();
  };

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="brand">
            <Logo />
            Yielder
          </div>
          <div className="row" style={{ gap: 6 }}>
            <LangToggle />
            <ThemeToggle className="btn ghost icon-btn" />
          </div>
        </div>
        <p className="muted" style={{ marginTop: 14 }}>
          {t('app.tagline')}
        </p>

        <form onSubmit={onSubmit}>
          <h2 style={{ fontSize: '1.35rem' }}>{mode === 'signin' ? t('auth.signIn') : t('auth.register')}</h2>
          <label className="field">
            {t('auth.username')}
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              autoFocus
              dir="ltr"
            />
            {mode === 'register' && <span className="hint">{t('auth.usernameHint')}</span>}
          </label>
          <label className="field">
            {t('auth.password')}
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              minLength={mode === 'register' ? 8 : undefined}
              required
              dir="ltr"
            />
            {mode === 'register' && <span className="hint">{t('auth.passwordHint')}</span>}
          </label>
          {mode === 'register' && (
            <>
              <label className="field">
                {t('auth.displayName')}
                <input value={displayName} onChange={e => setDisplayName(e.target.value)} autoComplete="nickname" dir="auto" />
              </label>
              <label className="check">
                <input type="checkbox" checked={share} onChange={e => setShare(e.target.checked)} />
                <span>
                  {t('auth.share')}
                  <br />
                  <span className="muted small">{t('auth.shareHint')}</span>
                </span>
              </label>
            </>
          )}
          <ErrorText error={submit.error} />
          <button className="btn primary" type="submit" disabled={submit.isPending}>
            {mode === 'signin' ? t('auth.signIn') : t('auth.register')}
          </button>
          <div className="small muted" style={{ textAlign: 'center' }}>
            {mode === 'signin' ? t('auth.noAccount') : t('auth.haveAccount')}{' '}
            <button type="button" className="btn ghost small" onClick={switchMode}>
              {mode === 'signin' ? t('auth.register') : t('auth.signIn')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
