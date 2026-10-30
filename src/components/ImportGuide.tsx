import { api } from '../api';
import { useI18n } from '../i18n';
import type { MessageKey } from '../locales';
import { Card, Icon } from './ui';

type Cell = string | { v: string; num?: boolean; opt?: boolean };

/** A small spreadsheet drawing: column letters, row numbers, a header row and a sheet tab. */
function Sheet({ rows, sheetName, otherSheet }: { rows: Cell[][]; sheetName: string; otherSheet?: string }) {
  const { dir } = useI18n();
  const cols = rows[0].length;

  return (
    <div className="sheet" dir={dir}>
      <table>
        <thead>
          <tr>
            <th aria-hidden="true" />
            {Array.from({ length: cols }, (_, i) => (
              <th key={i}>{String.fromCharCode(65 + i)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className={r === 0 ? 'hdr' : ''}>
              <td className="rownum">{r + 1}</td>
              {row.map((cell, c) => {
                const v = typeof cell === 'string' ? { v: cell } : cell;

                return (
                  <td key={c} className={[v.num ? 'num' : '', v.opt ? 'opt' : ''].join(' ').trim() || undefined} dir={v.num ? 'ltr' : 'auto'}>
                    {v.v}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sheet-tabs" aria-hidden="true">
        <span className="on">{sheetName}</span>
        {otherSheet && <span>{otherSheet}</span>}
      </div>
    </div>
  );
}

const n = (v: string): Cell => ({ v, num: true });

export function ImportGuide({ onUpload }: { onUpload: () => void }) {
  const { t, lang } = useI18n();
  const he = lang === 'he';

  const monthly: Cell[][] = he
    ? [
        ['קרן', 'חודש', 'יתרה', 'הפקדה', 'משיכה', 'הערה'],
        ['פנסיה מקיפה', n('2026-07'), n('457,936'), n('5,645'), '', ''],
        ['פנסיה מקיפה', n('2026-08'), n('469,944'), n('5,645'), '', ''],
        ['קרן השתלמות', n('2026-07'), n('161,765'), n('1,571'), '', ''],
        ['קרן השתלמות', n('2026-08'), n('163,274'), n('21,571'), '', 'הפקדה חד-פעמית 20,000'],
        ['תיק השקעות', n('2026-08'), n('363,589'), '', n('15,000'), 'משיכה'],
      ]
    : [
        ['Fund', 'Month', 'Balance', 'Deposit', 'Withdrawal', 'Comment'],
        ['Comprehensive pension', n('2026-07'), n('457,936'), n('5,645'), '', ''],
        ['Comprehensive pension', n('2026-08'), n('469,944'), n('5,645'), '', ''],
        ['Education fund', n('2026-07'), n('161,765'), n('1,571'), '', ''],
        ['Education fund', n('2026-08'), n('163,274'), n('21,571'), '', 'One-off 20,000 deposit'],
        ['Brokerage account', n('2026-08'), n('363,589'), '', n('15,000'), 'Withdrawal'],
      ];

  const fundsSheet: Cell[][] = he
    ? [
        ['שם', 'סוג', 'גוף מנהל', 'מסלול'],
        ['פנסיה מקיפה', 'פנסיה מקיפה', 'אלטשולר שחם', 'מסלול לבני 50 ומטה'],
        ['קרן השתלמות', 'קרן השתלמות', 'ילין לפידות', 'מניות'],
        ['תיק השקעות', 'תיק עצמאי', { v: '', opt: true }, { v: '', opt: true }],
      ]
    : [
        ['Name', 'Type', 'Provider', 'Track'],
        ['Comprehensive pension', 'Comprehensive pension', 'Altshuler Shaham', 'Age 50 and under'],
        ['Education fund', 'Education fund', 'Yelin Lapidot', 'Equities'],
        ['Brokerage account', 'Self-managed', { v: '', opt: true }, { v: '', opt: true }],
      ];

  const columns: Array<[MessageKey, MessageKey, boolean]> = [
    ['guide.col.fund', 'guide.col.fundHelp', true],
    ['guide.col.month', 'guide.col.monthHelp', true],
    ['guide.col.balance', 'guide.col.balanceHelp', true],
    ['guide.col.deposit', 'guide.col.depositHelp', false],
    ['guide.col.withdrawal', 'guide.col.withdrawalHelp', false],
    ['guide.col.comment', 'guide.col.commentHelp', false],
  ];

  return (
    <div className="stack">
      <Card title={t('guide.title')} hint={t('guide.intro')}>
        <div className="guide-grid">
          <Sheet rows={monthly} sheetName={t('guide.sheetMonthly')} otherSheet={t('guide.sheetFunds')} />
          <dl className="col-list">
            {columns.map(([name, help, required]) => (
              <div key={name}>
                <dt>
                  {t(name)} {!required && <span className="chip small">{t('guide.optional')}</span>}
                </dt>
                <dd>{t(help)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Card>

      <Card title={t('guide.fundsTitle')} hint={t('guide.fundsIntro')}>
        <Sheet rows={fundsSheet} sheetName={t('guide.sheetFunds')} />
      </Card>

      <Card title={t('guide.rulesTitle')}>
        <ul style={{ margin: 0, paddingInlineStart: 20, display: 'grid', gap: 8 }}>
          <li>{t('guide.rule.headers')}</li>
          <li>{t('guide.rule.months')}</li>
          <li>{t('guide.rule.deposits')}</li>
          <li>{t('guide.rule.reimport')}</li>
          <li>{t('guide.rule.oldExport')}</li>
          <li>{t('guide.rule.notSupported')}</li>
        </ul>
        <div className="row" style={{ marginTop: 18 }}>
          <a className="btn" href={api.templateUrl} download>
            <Icon name="download" /> {t('import.template')}
          </a>
          <button className="btn primary" onClick={onUpload}>
            <Icon name="upload" /> {t('guide.startUpload')}
          </button>
        </div>
      </Card>
    </div>
  );
}
