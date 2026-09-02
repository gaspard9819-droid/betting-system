// Backteszt: a modell kalibracioja a 2526-os szezonon, a piac ellen.
// Minden meccset a MEGELOZO adatokbol jelzunk elore (walk-forward), majd
// osszevetjuk a Pinnacle zaro oddsokkal (PSCH/PSCD/PSCA).
//
// Ket dolgot mer:
//   1. Log-loss / Brier: mennyire kalibralt a modell (a piachoz kepest)
//   2. Ha a modell alapjan fogadnank, mi lenne a CLV es a ROI

const fs = require('fs');
const { parseCsv } = require('./parse.js');
const { computeRatings } = require('./ratings.js');
const { predictMatch } = require('./predict.js');

// A záró oddsokat is ki kell szedni, amit a parse.js nem tesz meg.
function parseWithOdds(raw, league, season) {
  const text = raw.replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const head = lines[0].split(',').map(h => h.trim());
  const col = {}; head.forEach((h, i) => { if (col[h] === undefined) col[h] = i; });
  const base = parseCsv(raw, league, season);
  const byKey = {};
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(',');
    const h = (f[col['HomeTeam']] || '').trim(), a = (f[col['AwayTeam']] || '').trim();
    if (!h || !a) continue;
    // PSC* = Pinnacle closing. Ha nincs, AvgC* = piaci atlag zaro.
    const pick = (n1, n2) => {
      const v1 = col[n1] !== undefined ? Number(f[col[n1]]) : NaN;
      if (Number.isFinite(v1) && v1 > 1) return v1;
      const v2 = col[n2] !== undefined ? Number(f[col[n2]]) : NaN;
      return Number.isFinite(v2) && v2 > 1 ? v2 : null;
    };
    byKey[`${(f[col['Date']]||'').trim()}|${h}|${a}`] = {
      oh: pick('PSCH', 'AvgCH'), od: pick('PSCD', 'AvgCD'), oa: pick('PSCA', 'AvgCA'),
    };
  }
  return base.map(m => {
    const d = new Date(m.date);
    const dd = String(d.getUTCDate()).padStart(2,'0');
    const mm = String(d.getUTCMonth()+1).padStart(2,'0');
    const k1 = `${dd}/${mm}/${d.getUTCFullYear()}|${m.home}|${m.away}`;
    const k2 = `${dd}/${mm}/${String(d.getUTCFullYear()).slice(2)}|${m.home}|${m.away}`;
    const o = byKey[k1] || byKey[k2] || {};
    return { ...m, ...o };
  });
}

let all = [];
for (const s of ['2526', '2627'])
  for (const l of ['E0', 'D1', 'SP1', 'I1', 'F1'])
    all = all.concat(parseWithOdds(fs.readFileSync(`${l}_${s}.csv`, 'utf8'), l, s));

all.sort((a, b) => new Date(a.date) - new Date(b.date));

// Walk-forward: minden meccsnel csak a korabbi meccsekbol szamolunk ratinget.
// A sebesseg miatt hetente ujraszamolunk, nem meccsenkent.
const MIN_HISTORY = 200;
let modelLL = 0, marketLL = 0, modelBrier = 0, marketBrier = 0, n = 0;
let ratings = null, ratingsAt = null;
const evBuckets = {};

for (let i = 0; i < all.length; i++) {
  const m = all[i];
  if (i < MIN_HISTORY) continue;
  if (!m.oh || !m.od || !m.oa) continue;

  if (!ratingsAt || (new Date(m.date) - ratingsAt) > 7 * 86400000) {
    ratings = computeRatings(all.slice(0, i), m.date);
    ratingsAt = new Date(m.date);
  }
  const R = {}; ratings.forEach(r => R[r.league + '|' + r.team] = r);
  const hr = R[m.league + '|' + m.home], ar = R[m.league + '|' + m.away];
  if (!hr || !ar || hr.matches < 8 || ar.matches < 8) continue;

  const p = predictMatch(hr, ar, hr.league_avg_goals, hr.home_advantage);

  // piac de-vigelese (multiplikativ, a backteszthez eleg)
  const ip = [1/m.oh, 1/m.od, 1/m.oa];
  const ov = ip[0]+ip[1]+ip[2];
  const mk = ip.map(x => x/ov);

  const outcome = m.hg > m.ag ? 0 : (m.hg === m.ag ? 1 : 2);
  const mp = [p.home, p.draw, p.away];

  modelLL  -= Math.log(Math.max(1e-9, mp[outcome]));
  marketLL -= Math.log(Math.max(1e-9, mk[outcome]));
  for (let k = 0; k < 3; k++) {
    const y = k === outcome ? 1 : 0;
    modelBrier += (mp[k]-y)**2; marketBrier += (mk[k]-y)**2;
  }
  n++;

  // EV bucketek: ha a modell X%-kal tobbet lat a piacnal, mi tortenik
  const odds = [m.oh, m.od, m.oa];
  for (let k = 0; k < 3; k++) {
    const ev = mp[k]*odds[k] - 1;
    if (ev <= 0) continue;
    const b = ev < 0.03 ? '0-3%' : ev < 0.06 ? '3-6%' : ev < 0.10 ? '6-10%' : '10%+';
    const e = evBuckets[b] = evBuckets[b] || { bets:0, ret:0, won:0 };
    e.bets++;
    e.ret += (k === outcome ? odds[k]-1 : -1);
    if (k === outcome) e.won++;
  }
}

console.log(`Ertekelt meccsek: ${n}\n`);
console.log('KALIBRACIO (kisebb = jobb)');
console.log(`  Modell  log-loss: ${(modelLL/n).toFixed(4)}   Brier: ${(modelBrier/n).toFixed(4)}`);
console.log(`  Piac    log-loss: ${(marketLL/n).toFixed(4)}   Brier: ${(marketBrier/n).toFixed(4)}`);
const gap = (modelLL/n) - (marketLL/n);
console.log(`  Kulonbseg: ${gap > 0 ? '+' : ''}${gap.toFixed(4)} ${gap > 0 ? '(a piac jobb)' : '(a modell jobb)'}\n`);

console.log('EV BUCKETEK (ha csak a modell alapjan fogadnank)');
for (const b of ['0-3%','3-6%','6-10%','10%+']) {
  const e = evBuckets[b]; if (!e) continue;
  console.log(`  ${b.padEnd(6)} ${String(e.bets).padStart(4)} fogadas  ROI: ${(e.ret/e.bets*100).toFixed(2).padStart(7)}%  talalat: ${(e.won/e.bets*100).toFixed(1)}%`);
}
