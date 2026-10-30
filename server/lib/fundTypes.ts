import { FUND_STATUSES, FUND_TYPES, type FundStatus, type FundType } from '../../shared/types';

// Order matters: more specific patterns first ("השתלמות עצמאיים" is an education fund, not self-managed).
const NAME_RULES: Array<[RegExp, FundType]> = [
  [/פנסי\S*\s*מקיפה|comprehensive/i, 'pension_comprehensive'],
  [/פנסי\S*\s*משלימה|supplementary/i, 'pension_supplementary'],
  [/ביטוח\s*מנהלים|manager'?s?\s*insurance/i, 'managers_insurance'],
  [/השתלמות|hishtalmut|education/i, 'education_fund'],
  [/גמל\s*להשקעה|investment\s*provident|gemel\s*l'?hashkaa/i, 'investment_provident_fund'],
  [/גמל|provident|gemel/i, 'provident_fund'],
  [/פנסי|pension|retirement/i, 'pension_comprehensive'],
  [/עצמאי|מנוהל|תיק\s*השקעות|self.?managed|brokerage|portfolio/i, 'self_managed'],
  [/חיסכון|פיקדון|פקדון|savings|deposit/i, 'savings'],
];

// Types used by the first version of Yielder.
const LEGACY_TYPES: Record<string, FundType> = {
  retirement: 'pension_comprehensive',
  comprehensive_pension: 'pension_comprehensive',
  supplementary_pension: 'pension_supplementary',
  self_managed_account: 'self_managed',
  savings: 'savings',
  investment: 'other',
};

export function isFundType(value: unknown): value is FundType {
  return typeof value === 'string' && (FUND_TYPES as readonly string[]).includes(value);
}

/**
 * Picks a fund type. A declared type is trusted only when it comes from this version's own
 * export (`trustDeclared`); the first Yielder labelled almost everything "savings", so for
 * other sources the fund's name (reliable for Israeli products) wins. `guessed` is true
 * whenever the result wasn't an explicit, trusted type.
 */
export function inferFundType(
  name: string,
  declared = '',
  trustDeclared = false,
): { type: FundType; guessed: boolean } {
  const clean = declared.trim().toLowerCase();

  if (trustDeclared && isFundType(clean)) {
    return { type: clean, guessed: false };
  }

  // In our own layout the Type column may hold a plain name ("קרן השתלמות", "Provident fund").
  if (trustDeclared && clean) {
    for (const [re, type] of NAME_RULES) {
      if (re.test(declared)) {
        return { type, guessed: false };
      }
    }
  }

  for (const [re, type] of NAME_RULES) {
    if (re.test(name)) {
      return { type, guessed: true };
    }
  }

  if (isFundType(clean)) {
    return { type: clean, guessed: true };
  }

  return { type: LEGACY_TYPES[clean] ?? 'other', guessed: true };
}

export function normalizeStatus(value: unknown): FundStatus {
  const clean = String(value ?? '').trim().toLowerCase();

  return (FUND_STATUSES as readonly string[]).includes(clean) ? (clean as FundStatus) : 'active';
}

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}
