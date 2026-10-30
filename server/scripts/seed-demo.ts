// Creates anonymous demo users with synthetic fund histories so the comparison page has peers.
//   npm run seed:demo            (re)create demo users
//   npm run seed:demo -- --remove  delete them
// Demo users have random passwords and can't sign in. Usernames start with "demo_".

import { randomBytes } from 'node:crypto';

import type { FundType } from '../../shared/types';
import { hashPassword } from '../auth';
import { db, transaction } from '../db';
import { addMonths, currentMonth, monthsBetween } from '../../shared/months';
import { createFund, createUser, upsertEntry } from '../repo';

const USERS = 14;
const FIRST = '2018-01';

function removeDemoUsers(): number {
  return Number(db.prepare("DELETE FROM users WHERE username LIKE 'demo\\_%' ESCAPE '\\'").run().changes);
}

if (process.argv.includes('--remove')) {
  console.log(`Removed ${removeDemoUsers()} demo users.`);
  process.exit(0);
}

// Deterministic PRNG (mulberry32) so every run produces the same peers.
let seed = 20261030;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);

  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const normal = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);

const PROVIDERS = ['Altshuler Shaham', 'Meitav', 'Harel', 'Migdal', 'Menora', 'Clal', 'Phoenix', 'More', 'Analyst', 'Infinity'];
const TRACKS = [
  { name: 'S&P 500', beta: 1 },
  { name: 'Equities', beta: 0.9 },
  { name: 'General', beta: 0.55 },
  { name: 'Age 50 and under', beta: 0.6 },
  { name: 'Bonds', beta: 0.15 },
];
const ALPHA = new Map(PROVIDERS.map(p => [p, normal() * 0.0012]));

const end = addMonths(currentMonth(), -1);
const months = monthsBetween(FIRST, end) + 1;

// Rough calendar-year shape of the market (ILS terms); monthly noise is re-centred so each
// year lands near its target. Synthetic, only meant to make the demo comparison plausible.
const YEARLY: Record<number, { equity: number; bonds: number }> = {
  2018: { equity: -0.03, bonds: 0 },
  2019: { equity: 0.25, bonds: 0.07 },
  2020: { equity: 0.1, bonds: 0.03 },
  2021: { equity: 0.24, bonds: 0.03 },
  2022: { equity: -0.14, bonds: -0.06 },
  2023: { equity: 0.18, bonds: 0.05 },
  2024: { equity: 0.25, bonds: 0.05 },
  2025: { equity: 0.15, bonds: 0.05 },
};
const DEFAULT_YEAR = { equity: 0.08, bonds: 0.03 };

function yearPath(annual: number, vol: number): number[] {
  const noise = Array.from({ length: 12 }, () => normal() * vol);
  const mean = noise.reduce((a, b) => a + b, 0) / 12;
  const monthly = (1 + annual) ** (1 / 12) - 1;

  return noise.map(x => monthly + x - mean);
}

const market = Array.from({ length: Math.ceil(months / 12) + 1 }, (_, y) => {
  const target = YEARLY[Number(FIRST.slice(0, 4)) + y] ?? DEFAULT_YEAR;
  const equity = yearPath(target.equity, 0.025);
  const bonds = yearPath(target.bonds, 0.008);

  return equity.map((e, m) => ({ equity: e, bonds: bonds[m] }));
})
  .flat()
  .slice(0, months);

const PLANS: Array<{ type: FundType; name: string; chance: number; start: [number, number]; deposit: [number, number] }> = [
  { type: 'pension_comprehensive', name: 'פנסיה מקיפה', chance: 1, start: [20000, 250000], deposit: [1500, 4500] },
  { type: 'education_fund', name: 'קרן השתלמות', chance: 0.8, start: [10000, 150000], deposit: [700, 1600] },
  { type: 'provident_fund', name: 'קופת גמל', chance: 0.5, start: [5000, 120000], deposit: [0, 800] },
  { type: 'investment_provident_fund', name: 'גמל להשקעה', chance: 0.4, start: [10000, 80000], deposit: [0, 1000] },
  { type: 'pension_supplementary', name: 'פנסיה משלימה', chance: 0.25, start: [5000, 60000], deposit: [300, 1500] },
  { type: 'self_managed', name: 'תיק השקעות', chance: 0.35, start: [20000, 300000], deposit: [0, 0] },
];

transaction(() => {
  const removed = removeDemoUsers();
  let fundCount = 0;

  for (let u = 1; u <= USERS; u++) {
    const user = createUser(`demo_${String(u).padStart(2, '0')}`, `Demo peer ${u}`, hashPassword(randomBytes(16).toString('hex')));

    for (const plan of PLANS) {
      if (rand() > plan.chance) {
        continue;
      }

      const provider = pick(PROVIDERS);
      const track = plan.type === 'self_managed' ? pick(TRACKS.slice(0, 2)) : pick(TRACKS);
      const fund = createFund(user.id, { name: plan.name, type: plan.type, provider, track: track.name, status: 'active', notes: '' });
      const startOffset = Math.floor(rand() * 54);
      const deposit = Math.round(between(...plan.deposit) / 50) * 50;
      let balance = Math.round(between(...plan.start));

      for (let i = startOffset; i < months; i++) {
        const month = addMonths(FIRST, i);
        let flow = deposit;

        if (plan.type === 'self_managed' && rand() < 0.04) {
          flow = Math.round(between(5000, 30000) / 1000) * 1000;
        }

        if (i > startOffset) {
          const r = track.beta * market[i].equity + (1 - track.beta) * market[i].bonds + ALPHA.get(provider)! + normal() * 0.003;

          balance = Math.max(0, Math.round(balance * (1 + r) + flow * (1 + r / 2)));
        }

        upsertEntry(fund.id, { month, balance, deposit: i > startOffset ? flow : 0, withdrawal: 0, comment: '' });
      }

      fundCount++;
    }
  }

  console.log(`Removed ${removed} old demo users; created ${USERS} demo users with ${fundCount} funds (${FIRST} → ${end}).`);
});
