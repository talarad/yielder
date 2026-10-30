import { useSignIn } from '../auth';
import { LangToggle, ThemeToggle } from '../components/Layout';
import { ErrorText, Icon, Logo } from '../components/ui';
import { lastStorage } from '../data/workspace';
import { useI18n } from '../i18n';
import { GOOGLE_CLIENT_ID } from '../storage/drive';

/** Google's "G", as Google asks sign-in buttons to show it. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** Sign-in: open your data from your Google Drive, or keep it in this browser only. */
export function Login() {
  const { t } = useI18n();
  const signIn = useSignIn();
  const last = lastStorage();

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

        <div className="stack" style={{ gap: 12 }}>
          {GOOGLE_CLIENT_ID ? (
            <button className="btn primary large google-btn" onClick={() => signIn.mutate('drive')} disabled={signIn.isPending}>
              <span className="google-mark">
                <GoogleMark />
              </span>
              {t('auth.google')}
            </button>
          ) : (
            <div className="notice">{t('auth.googleMissing')}</div>
          )}
          <p className="small muted">{t('auth.googleHint')}</p>

          <div className="or-line">
            <span>{t('auth.or')}</span>
          </div>

          <button className={last === 'browser' ? 'btn primary large' : 'btn large'} onClick={() => signIn.mutate('browser')} disabled={signIn.isPending}>
            <Icon name="wallet" /> {t('auth.browser')}
          </button>
          <p className="small muted">{t('auth.browserHint')}</p>

          <ErrorText error={signIn.error} />
        </div>
      </div>
    </div>
  );
}
