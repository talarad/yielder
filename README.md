# Yielder

Track your pension, education funds (קרן השתלמות), provident funds (קופת גמל) and savings
month by month: balances, real returns for every period, comparison with the real funds of the
managing companies, and import from your old Excel files. Hebrew and English, light and dark.

It runs entirely in the browser. There is no server and no database service: your data is one
SQLite file in **your own Google Drive** (or, if you prefer, only in this browser). Hosting is a
free static site.

## Run it locally

Requires Node 22+.

```bash
npm install
npm run dev
```

Open http://localhost:5173 and choose **Use in this browser only**, or set up Google sign-in
(below) and choose **Continue with Google**. Then add funds by hand, import an Excel file
(**Import**), or open an existing Yielder file (on the empty dashboard, or **Settings → Your
data → Open a file**). The old Yielder server database (`data/yielder.db`) opens too: it is
converted on the fly.

| Command | What it does |
|---|---|
| `npm run dev` | The app on :5173 |
| `npm test` | Return math, Excel, data file and Google Drive storage tests |
| `npm run typecheck` | TypeScript |
| `npm run build` | Production build in `dist/` |
| `npm run preview` | Serves `dist/` on :4173 with the same security headers as the real site |
| `npm run benchmarks:sync` | Refreshes `public/benchmarks.json` from data.gov.il now |

## Where your data lives

- **Google Drive**: one file, `Yielder data.db`, in your Drive. Yielder asks only for the
  `drive.file` permission, so it can open the file it created and nothing else in your Drive.
  The browser talks to Google directly; no one else (not the hosting, not the developer) holds
  your data. Drive keeps earlier versions of the file, and **Settings → Download a copy** gives
  you the whole file any time.
- **This browser only**: the same file, kept in the browser's storage on this device. Good for
  trying it out; download a copy now and then.
- Every change is saved a moment later; the sidebar shows "Saved to Google Drive" / "Saving…".
  If a save fails, a banner says why and offers the fix (Try again, Reconnect when the Google
  sign-in expired after an hour, or Load the latest / Keep this version when the file was
  changed on another device in the meantime). Leaving the page with unsaved changes asks first.

## Deploy for free

The site is static: GitHub Pages hosts it for free (the **Deploy** workflow publishes every push
to `main`), and GitHub runs the monthly market-data refresh for free. See **[SETUP.md](SETUP.md)**
for the step-by-step (about 10 minutes).

## Features

- **Funds**: type (comprehensive/supplementary pension, managers' insurance, education fund, provident, investment provident, self-managed, savings, other), provider, investment track, status, notes.
- **Monthly statements**: balance, deposit, withdrawal, comment per month. Months that look like data-entry problems are flagged.
- **Add a month**: one screen for the new month across all funds: deposits copied from the month before, and each fund's return for the month shown as you type, so a typo stands out before it's saved.
- **Returns** for 1 month, YTD, 1 / 3 / 5 years and since start, with the ₪ gain and the yearly rate for longer periods, always next to the plain balance change. Per-year table, monthly and yearly return charts.
- **Dashboard**: total balance, a chart of balance or return (% since the start of the period) for every fund or the total, your funds, returns and allocation (donuts by product type and by fund) in tabs.
- **Compare with the market**: each fund against the real funds of the same product type at 11 managing companies, over exactly the same months, plus a providers & tracks table.
- **Excel**: import with a preview (fix names/types, merge into an existing fund or create new, see new vs. changed months; re-importing the same file changes nothing), export everything, download a blank template.

## How returns are calculated

All returns are measured as of each fund's latest recorded month (not today's calendar month).

- **Period returns are money-weighted**: the monthly IRR that turns the start balance plus each
  month's net deposit (assumed mid-month) into the end balance, compounded over the period.
  Deposits and withdrawals are never counted as gains.
- **YTD** runs from December of the previous year. A fund opened mid-year gets a partial YTD.
- **1Y / 3Y / 5Y** need history covering the whole period; otherwise they show "—".
- **Monthly bars** use Modified Dietz for that single month: `(end − start − deposit) / (start + deposit / 2)`.
- **Portfolio**: funds not yet updated this month keep their last balance; closed funds drop out after their last month.

The math lives in `shared/yields.ts` and is covered by `shared/yields.test.ts`.

## Market data

- Source: the Capital Market Authority's open data on data.gov.il (datasets `gemelnet` and `pensia-net`), field `MONTHLY_YIELD`: nominal monthly returns, gross of management fees.
- 163 series from 11 managing companies: Altshuler Shaham, Clal, Harel, Meitav, Migdal, Menora Mivtachim, Phoenix, More, Infinity, Yelin Lapidot and Analyst (Psagot is left out: its funds were emptied in 2021). Pension, education fund, provident and investment provident funds, in the General / Equities / S&P 500 / age-50-and-under tracks, wherever the company offers them. Where a company's "General" provident fund is a legacy fund closed to new members, the series says so in `note`.
- The data is a static file, `public/benchmarks.json`. **Monthly refresh**: a GitHub Actions job (`.github/workflows/market-data.yml`) runs on the 20th–25th of each month (the previous month is published by about the 20th), re-reads the last 6 months to pick up revisions, and commits the file when it changed; the Deploy workflow then republishes the site. It can also be run by hand from the repository's Actions tab.
- Comparisons step back up to two months when the market data doesn't have your latest month yet.

## Layout

```
shared/         types, month helpers, return math, Excel import/export, validation (all run in the browser; tested in Node)
src/
  api.ts        what the pages ask for, computed from the open data file
  data/         sqlite.ts (the data file, sql.js), repo.ts, workspace.ts (open file + saving), compare.ts, benchmarks.ts
  storage/      drive.ts (Google sign-in + Drive), browser.ts (IndexedDB)
  pages/, components/, i18n + Hebrew/English strings in locales.ts
scripts/        sync-benchmarks.ts (market data refresh)
public/         benchmarks.json, _headers (security policy; the build also puts it in index.html) and _redirects for other hosts
```
