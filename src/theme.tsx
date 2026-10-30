import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'yielder-theme';

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
  } catch {
    // storage unavailable
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Colors for SVG charts (Recharts sets them as attributes, where CSS variables aren't reliable).
 * Balance is the emphasized series, money invested is the gray context line; returns use the
 * validated blue (gain) ↔ red (loss) diverging pair. Keep in sync with styles.css.
 */
const CHART = {
  light: {
    accent: '#2a78d6',
    context: '#98a2b3',
    grid: '#eaecf0',
    axis: '#d0d5dd',
    text: '#667085',
    surface: '#ffffff',
    gain: '#2a78d6',
    loss: '#e34948',
    /** Fund-type colors, by `typeClass` (same as the .tc-* classes in styles.css). */
    types: {
      'tc-pension': '#2a78d6',
      'tc-education': '#1baf7a',
      'tc-provident': '#eb6834',
      'tc-invest': '#6250d6',
      'tc-self': '#e87ba4',
      'tc-savings': '#eda100',
      'tc-other': '#98a2b3',
    } as Record<string, string>,
  },
  dark: {
    accent: '#3987e5',
    context: '#667085',
    grid: '#1c2636',
    axis: '#2e3b52',
    text: '#8e9aae',
    surface: '#131a26',
    gain: '#3987e5',
    loss: '#e66767',
    types: {
      'tc-pension': '#3987e5',
      'tc-education': '#199e70',
      'tc-provident': '#d95926',
      'tc-invest': '#9085e9',
      'tc-self': '#d55181',
      'tc-savings': '#c98500',
      'tc-other': '#667085',
    } as Record<string, string>,
  },
};

interface ThemeCtx {
  theme: Theme;
  toggle: () => void;
  chart: (typeof CHART)['light'];
}

const ThemeContext = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const value = useMemo<ThemeCtx>(
    () => ({
      theme,
      chart: CHART[theme],
      toggle: () =>
        setTheme(prev => {
          const next = prev === 'dark' ? 'light' : 'dark';

          try {
            localStorage.setItem(STORAGE_KEY, next);
          } catch {
            // storage unavailable
          }

          return next;
        }),
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(ThemeContext);

  if (!ctx) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }

  return ctx;
}
