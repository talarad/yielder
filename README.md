# Yielder

Track your pension, education funds (קרן השתלמות), provident funds (קופת גמל) and savings
month by month: balances, real returns for every period, comparison with other people, and
import from your old Excel files. Hebrew and English, light and dark.

## Run it

Requires Node 22.13+ (uses the built-in `node:sqlite`, no database server).

```bash
npm install
npm run dev
```

Open http://localhost:5173, create a username and password, then either add funds by hand or
go to **Import** and upload an Excel file (the old Yielder export and the Hebrew
"השקעות וקרנות פורמט" spreadsheet both work).

| Command | What it does |
|---|---|
| `npm run dev` | API on :4000 + Vite on :5173 (proxies `/api`) |
| `npm test` | Return-math and Excel import/export tests |
| `npm run typecheck` | TypeScript, client and server |
| `npm run build && npm start` | Production: one server on `PORT` (default 4000) serving API + built UI |
| `npm run benchmarks:sync` | Refreshes market data from data.gov.il now (the server also does it monthly) |
| `npm run benchmarks:load [-- file.json]` | Loads market data from a JSON file (default `server/data/benchmarks.json`) |
| `npm run seed:demo` | Dev only: adds synthetic users to test the anonymous user comparison |
| `npm run seed:demo -- --remove` | Removes them |

## Features

- **Own login**: username + password (scrypt), HttpOnly session cookie, 30-day sessions, lockout after repeated failures. Change password, delete account (removes all data).
- **Funds**: type (comprehensive/supplementary pension, managers' insurance, education fund, provident, investment provident, self-managed, savings, other), provider, investment track, status, notes.
- **Monthly statements**: balance, deposit, withdrawal, comment per month. Months that look like data-entry problems are flagged.
- **Returns** for 1 month, YTD, 1 / 3 / 5 years and since start, with the ₪ gain and the yearly rate for longer periods. Per-year table, balance vs. invested chart, monthly and yearly return charts.
- **Dashboard** for the whole portfolio, allocation by fund type, and a warning when funds haven't been updated.
- **Compare with the market**: each fund against the real funds of the same product type at 11 managing companies, over exactly the same months, plus a providers & tracks table. If other users share (Settings → Privacy) there's also an anonymous comparison with them; the UI never shows how many people share.
- **Fund-type colors**: each product family (pensions, השתלמות, גמל, גמל להשקעה, self-managed, savings) has one color from a validated palette, always shown next to the type's name.
- **Sub-pages**: the dashboard, each fund (overview / returns / monthly statements / vs. the market), Compare and Import are split into tabs kept in the URL. Click a year to see its months; unusual years are explained in words.
- **Excel**: import with a preview (fix names/types, merge into an existing fund or create new, see new vs. changed months; re-importing the same file changes nothing), export everything, download a blank template.

## How returns are calculated

All returns are measured as of each fund's latest recorded month (not today's calendar month).

- **Period returns are money-weighted**: the monthly IRR that turns the start balance plus each
  month's net deposit (assumed mid-month) into the end balance, compounded over the period.
  Deposits and withdrawals are never counted as gains. Because only the start/end balances and
  dated cash flows matter, a deposit recorded a month before it shows up in the balance barely
  moves the result. (Chaining monthly returns would turn that one-month mismatch into a large,
  wrong number, which is what happened with some of the old data.)
- **YTD** runs from December of the previous year. A fund opened mid-year gets a partial YTD.
- **1Y / 3Y / 5Y** need history covering the whole period; otherwise they show "—".
- **Monthly bars** use Modified Dietz for that single month: `(end − start − deposit) / (start + deposit / 2)`.
- **Portfolio**: funds not yet updated this month keep their last balance; closed funds drop out after their last month.

The math lives in `server/lib/yields.ts` and is covered by `server/lib/yields.test.ts`.

## Market data

- Source: the Capital Market Authority's open data on data.gov.il (datasets `gemelnet` and `pensia-net`), field `MONTHLY_YIELD`: nominal monthly returns, gross of management fees. No login needed.
- 163 series from 11 managing companies: Altshuler Shaham, Clal, Harel, Meitav, Migdal, Menora Mivtachim, Phoenix, More, Infinity, Yelin Lapidot and Analyst (Psagot is left out: its funds were emptied in 2021). Pension, education fund, provident and investment provident funds, in the General / Equities / S&P 500 / age-50-and-under tracks, wherever the company offers them. Where a company's "General" provident fund is a legacy fund closed to new members, the series says so in `note`. The fund ids are in `server/data/benchmarks.json`, which also seeds a fresh database.
- **Monthly refresh**: the server fetches the latest months on the 20th of every month (the previous month is published by then), retries hourly if it fails, and catches up after downtime. It re-reads the last 6 months to pick up revisions. Every run is logged in the `benchmark_syncs` table. `YIELDER_SYNC=off` disables it; `YIELDER_SYNC_DAY` changes the day.
- Comparisons step back up to two months when the market (or other users) don't have your latest month yet.

## Data

- SQLite file at `data/yielder.db` (git-ignored). Back up by copying it while the app is stopped. Set `YIELDER_DB` to use another path.
- Behind plain HTTP on a network (not localhost) in production, set `INSECURE_COOKIES=1`, or better, put it behind HTTPS.

## Layout

```
shared/        types and month helpers used by both sides
server/
  index.ts     Express app (also serves dist/ in production)
  db.ts        schema + transactions
  auth.ts      passwords, sessions, lockout
  repo.ts      data access (always scoped by user)
  compare.ts   anonymous peer comparison
  routes/      auth, funds + statements, portfolio/compare/import/export
  lib/         yields.ts (return math), excel.ts (import/export), fundTypes.ts
  scripts/     seed-demo.ts
src/           React client (pages/, components/, i18n + Hebrew/English strings in locales.ts)
```
