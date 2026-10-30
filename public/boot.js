// Runs before the app: applies the saved language direction and theme so the page doesn't render
// left-to-right/light first and then flip. Kept as a file (not inline) for the production CSP.
// Keep the storage keys in sync with src/i18n.tsx and src/theme.tsx.
(function () {
  try {
    var root = document.documentElement;
    var lang = localStorage.getItem('yielder-lang');
    var theme = localStorage.getItem('yielder-theme');

    if (lang !== 'en' && lang !== 'he') {
      lang = (navigator.language || '').indexOf('he') === 0 ? 'he' : 'en';
    }

    root.lang = lang;
    root.dir = lang === 'he' ? 'rtl' : 'ltr';

    if (theme === 'light' || theme === 'dark') {
      root.setAttribute('data-theme', theme);
    }
  } catch (e) {
    // Storage blocked: the app falls back to its defaults.
  }
})();
