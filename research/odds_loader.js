// Kozos betolto a nyeresegesseg-kutato szkriptekhez (2026-09-12).
// A parse.js csak eredmenyt ad; itt az OSSZES odds-oszlop is kell:
// nyito (pentek delutani gyujtes) es zaro, 1X2 + O/U 2.5, Pinnacle/Avg/Max.
//
// Hasznalat (a data/ mappabol):  const { loadAll, TIPPMIX, devig } = require('../odds_loader.js');
const fs = require('fs');
const { parseCsv } = require('./parse.js');

const SEASONS = ['2223', '2324', '2425', '2526', '2627'];
const LEAGUES = ['E0', 'D1', 'SP1', 'I1', 'F1'];

// Generate Legs tippmixRatio() - szo szerint ugyanaz (1.3-6.0 kozott mert).
const tippmixRatio = o => 1.0469 - 0.01814 * Math.min(6.0, Math.max(1.3, o));
const TIPPMIX = o => o * tippmixRatio(o);

// multiplikativ de-vig: ugyanaz, amit a backtest.js hasznal
const devig = odds => {
  const ip = odds.map(o => 1 / o); const s = ip.reduce((a, b) => a + b, 0);
  return { probs: ip.map(x => x / s), overround: s - 1 };
};

function loadFile(fp, league, season) {
  const raw = fs.readFileSync(fp, 'utf8');
  const text = raw.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const head = lines[0].split(',').map(h => h.trim());
  const col = {}; head.forEach((h, i) => { if (col[h] === undefined) col[h] = i; });
  const base = parseCsv(raw, league, season);
  const byKey = {};
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(',');
    const h = (f[col['HomeTeam']] || '').trim(), a = (f[col['AwayTeam']] || '').trim();
    if (!h || !a) continue;
    const g = n => { if (col[n] === undefined) return null; const v = Number(f[col[n]]); return Number.isFinite(v) && v > 1 ? v : null; };
    const gn = n => { if (col[n] === undefined) return null; const v = Number(f[col[n]]); return Number.isFinite(v) ? v : null; };
    const trip = p => { const t = [g(p + 'H'), g(p + 'D'), g(p + 'A')]; return t.every(Boolean) ? t : null; };
    const pair = (o, u) => { const t = [g(o), g(u)]; return t.every(Boolean) ? t : null; };
    byKey[`${(f[col['Date']] || '').trim()}|${h}|${a}`] = {
      // 1X2 nyito / zaro
      ps: trip('PS'), psc: trip('PSC'),
      avg: trip('Avg'), avgc: trip('AvgC'),
      max: trip('Max'), maxc: trip('MaxC'),
      b365: trip('B365'), b365c: trip('B365C'),
      // O/U 2.5 nyito / zaro  [over, under]
      ou_p: pair('P>2.5', 'P<2.5'), ou_pc: pair('PC>2.5', 'PC<2.5'),
      ou_avg: pair('Avg>2.5', 'Avg<2.5'), ou_avgc: pair('AvgC>2.5', 'AvgC<2.5'),
      ou_max: pair('Max>2.5', 'Max<2.5'), ou_maxc: pair('MaxC>2.5', 'MaxC<2.5'),
      hthg: gn('HTHG'), htag: gn('HTAG'),
    };
  }
  return base.map(m => {
    const d = new Date(m.date);
    const dd = String(d.getUTCDate()).padStart(2, '0'), mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const k1 = `${dd}/${mm}/${d.getUTCFullYear()}|${m.home}|${m.away}`;
    const k2 = `${dd}/${mm}/${String(d.getUTCFullYear()).slice(2)}|${m.home}|${m.away}`;
    const o = byKey[k1] || byKey[k2] || {};
    const res = m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2;   // 0=H 1=D 2=A
    const over = m.hg + m.ag > 2.5 ? 0 : 1;                // 0=over 1=under
    return { ...m, ...o, res, over };
  });
}

function loadAll(opts = {}) {
  const seasons = opts.seasons || SEASONS, leagues = opts.leagues || LEAGUES;
  let all = [];
  for (const s of seasons) for (const l of leagues) {
    const fp = `${l}_${s}.csv`;
    if (!fs.existsSync(fp)) continue;
    all = all.concat(loadFile(fp, l, s));
  }
  all.sort((a, b) => new Date(a.date) - new Date(b.date));
  return all;
}

// egyszeru statisztika segedek
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const roi = bets => bets.length ? mean(bets.map(b => b.win ? b.odds - 1 : -1)) * 100 : NaN;
// ROI standard hibaja (szazalekpontban) - hogy a zajt is lassuk
const roiSe = bets => { if (bets.length < 2) return NaN; const r = bets.map(b => b.win ? b.odds - 1 : -1); const m = mean(r);
  const v = r.reduce((s, x) => s + (x - m) ** 2, 0) / (r.length - 1); return Math.sqrt(v / r.length) * 100; };
const pct = (x, d = 1) => (x * 100).toFixed(d) + '%';

module.exports = { loadAll, SEASONS, LEAGUES, tippmixRatio, TIPPMIX, devig, mean, roi, roiSe, pct };

if (require.main === module) {
  const all = loadAll();
  const has = k => all.filter(m => m[k]).length;
  console.log(`meccsek: ${all.length}`);
  for (const k of ['ps', 'psc', 'avg', 'avgc', 'maxc', 'ou_pc', 'ou_avgc']) console.log(`  ${k.padEnd(8)} ${has(k)}`);
  const bySeason = {}; all.forEach(m => bySeason[m.season] = (bySeason[m.season] || 0) + 1);
  console.log(bySeason);
}
