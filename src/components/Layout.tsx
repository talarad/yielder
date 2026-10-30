import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';

import { useMe, useSignOut } from '../auth';
import { useI18n } from '../i18n';
import type { MessageKey } from '../locales';
import { useTheme } from '../theme';
import { SaveLine, SaveProblem } from './SaveStatus';
import { Icon, initialOf, Logo } from './ui';

const NAV: Array<{ to: string; label: MessageKey; icon: 'overview' | 'plus' | 'funds' | 'compare' | 'upload' }> = [
  { to: '/', label: 'nav.dashboard', icon: 'overview' },
  { to: '/add-month', label: 'nav.addMonth', icon: 'plus' },
  { to: '/funds', label: 'nav.funds', icon: 'funds' },
  { to: '/compare', label: 'nav.compare', icon: 'compare' },
  { to: '/import', label: 'nav.import', icon: 'upload' },
];

export function LangToggle({ className = 'btn small' }: { className?: string }) {
  const { t, lang, setLang } = useI18n();
  const other = lang === 'he' ? 'en' : 'he';

  // The label is written in the other language, so screen readers need to know which.
  return (
    <button className={className} lang={other} onClick={() => setLang(other)}>
      {t('nav.otherLang')}
    </button>
  );
}

export function ThemeToggle({ className = 'btn icon-btn' }: { className?: string }) {
  const { t } = useI18n();
  const { theme, toggle } = useTheme();

  return (
    <button className={className} onClick={toggle} title={t('nav.theme')} aria-label={t('nav.theme')}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}

function Brand() {
  return (
    <Link to="/" className="brand">
      <Logo />
      <span>Yielder</span>
    </Link>
  );
}

export function Layout() {
  const { t } = useI18n();
  const { data: me } = useMe();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const name = me?.displayName || me?.email || t('auth.thisBrowser');
  const onSignOut = () => signOut.mutate(undefined, { onSettled: () => navigate('/') });

  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand />
        <nav className="side-nav" aria-label={t('nav.main')}>
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className="side-link">
              <Icon name={n.icon} size={20} strokeWidth={1.9} />
              {t(n.label)}
            </NavLink>
          ))}
        </nav>
        <div className="side-bottom">
          <NavLink to="/settings" className="side-link">
            <Icon name="gear" size={20} strokeWidth={1.9} />
            {t('nav.settings')}
          </NavLink>
          <div className="side-controls">
            <LangToggle className="btn" />
            <ThemeToggle />
          </div>
          <SaveLine />
          <div className="user-chip">
            <span className="avatar">{initialOf(name)}</span>
            <span className="who">
              <b dir="auto">{name}</b>
              <span dir="ltr">{me?.email || t('auth.thisBrowser')}</span>
            </span>
            <button className="btn ghost icon-btn" title={t('nav.signOut')} aria-label={t('nav.signOut')} onClick={onSignOut}>
              <span className="flip">
                <Icon name="logout" />
              </span>
            </button>
          </div>
        </div>
      </aside>

      <div className="content">
        <header className="topbar">
          <Brand />
          <div className="topbar-actions">
            <LangToggle className="btn small" />
            <ThemeToggle className="btn ghost icon-btn" />
            <Link to="/settings" className="avatar" aria-label={t('nav.settings')} title={t('nav.settings')}>
              {initialOf(name)}
            </Link>
          </div>
        </header>
        <main>
          <SaveProblem />
          <Outlet />
        </main>
        <nav className="tabbar" aria-label={t('nav.main')}>
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className="tab-link">
              <Icon name={n.icon} size={22} strokeWidth={1.9} />
              {t(n.label)}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
