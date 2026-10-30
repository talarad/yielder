import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { ApiError } from './api';
import { en, he, type MessageKey } from './locales';

export type Lang = 'en' | 'he';

const STORAGE_KEY = 'yielder-lang';
const dictionaries = { en, he };

// Unicode bidi isolates. Text inside an isolate keeps its own direction and can't reorder the
// text around it, so "Meitav" inside a Hebrew sentence or "+9.68%" next to a Hebrew word stay put.
const LRI = '⁦'; // left-to-right isolate
const FSI = '⁨'; // first-strong isolate (direction from the content)
const PDI = '⁩'; // pop directional isolate
const BIDI_MARKS = /[‎‏]/g;

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved === 'en' || saved === 'he') {
      return saved;
    }
  } catch {
    // storage unavailable
  }

  return navigator.language.startsWith('he') ? 'he' : 'en';
}

function makeFormatters(lang: Lang) {
  const locale = lang === 'he' ? 'he-IL' : 'en-IL';
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });
  const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
  const monthFmt = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' });
  const monthShortFmt = new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit' });
  const toDate = (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1);
  // Numbers always read left to right, so "+9.68%" doesn't become "9.68%+" in Hebrew. The he-IL
  // currency format carries its own bidi marks, which would split the sign from the number.
  const ltr = (s: string) => `${LRI}${s.replace(BIDI_MARKS, '')}${PDI}`;

  return {
    money: (v: number | null | undefined) => (v === null || v === undefined ? '—' : ltr(money.format(v))),
    signedMoney: (v: number | null | undefined) =>
      v === null || v === undefined ? '—' : ltr((v > 0 ? '+' : '') + money.format(v)),
    compact: (v: number) => compact.format(v),
    pct: (v: number | null | undefined, digits = 2) =>
      v === null || v === undefined || !Number.isFinite(v) ? '—' : ltr(`${v > 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`),
    /** Unsigned share of a whole, e.g. "31.2%". */
    share: (v: number) => ltr(`${(v * 100).toFixed(1)}%`),
    month: (m: string | null | undefined) => (m ? `${FSI}${monthFmt.format(toDate(m))}${PDI}` : '—'),
    monthShort: (m: string) => monthShortFmt.format(toDate(m)),
  };
}

export type Formatters = ReturnType<typeof makeFormatters>;

interface I18n {
  lang: Lang;
  dir: 'ltr' | 'rtl';
  /** "Forward" arrow for the reading direction (→ in English, ← in Hebrew). */
  arrow: string;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  /** A user-facing message for an error, localized when the server sent a known code. */
  errorText: (err: unknown) => string;
  fmt: Formatters;
}

const I18nContext = createContext<I18n | null>(null);

const hasKey = (key: string): key is MessageKey => key in en;

// Validation errors on these fields have their own message.
const FIELD_ERRORS: Record<string, MessageKey> = {
  username: 'error.invalid_username',
  password: 'error.invalid_password',
  newPassword: 'error.invalid_password',
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const dir = lang === 'he' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const value = useMemo<I18n>(() => {
    const dict = dictionaries[lang];
    const t: I18n['t'] = (key, vars) => {
      let text: string = dict[key] ?? en[key] ?? key;

      for (const [k, v] of Object.entries(vars ?? {})) {
        text = text.replaceAll(`{${k}}`, `${FSI}${v}${PDI}`);
      }

      return text;
    };

    return {
      lang,
      dir,
      arrow: dir === 'rtl' ? '←' : '→',
      setLang: next => {
        setLangState(next);

        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {
          // storage unavailable
        }
      },
      t,
      errorText: err => {
        if (!(err instanceof ApiError)) {
          return t('common.error');
        }

        if (err.code === 'validation') {
          const fieldKey = err.field ? FIELD_ERRORS[err.field] : undefined;

          // The server's English message is specific; in Hebrew a generic line beats English text.
          return fieldKey ? t(fieldKey) : lang === 'en' ? err.message : t('error.validation');
        }

        const key = `error.${err.code}`;

        if (err.code && hasKey(key)) {
          return t(key);
        }

        return lang === 'en' && err.message ? err.message : t('common.error');
      },
      fmt: makeFormatters(lang),
    };
  }, [lang, dir]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);

  if (!ctx) {
    throw new Error('useI18n must be used inside I18nProvider');
  }

  return ctx;
}
