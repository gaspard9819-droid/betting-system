// Van-e piac, ami KONZISZTENSEN szukebb margoju a tobbinel?
//
// MIERT KESZULT: 2026-09-19. A margin_trap.js megmutatta, hogy a margo
// becsuletes jelzes, es hogy kimenetel-szinten a hosszu labakon rejtik el.
// Amit NEM nezett: a piacokat egymashoz kepest. Ha forgatni kell (ingyen tet,
// rollover), a legszukebb margoju piacon kell - de csak akkor erdemes ra
// szabalyt epiteni, ha az a piac MINDIG az, nem csak atlagban.
//
// KET ADATFORRAS, MERT EGYIK SEM ELEG ONMAGABAN:
//   football-data (6228 meccs, 5 liga, 5 szezon): 1X2, O/U 2.5, AH.
//     Van eredmeny -> margo ES tenyleges ROI is merheto.
//   Tippmix feed (68 meccs, 2026-09-15 es 09-19): 1X2, BTTS, Golszam.
//     NINCS eredmeny -> CSAK margo merheto. A BTTS-rol ezert nem mondunk
//     hozamot, csak arat. A lenti tabla ezt ki is irja.
//
// AMIT EZ A SCRIPT NEM LAT, ES AMIT EZERT NEM SZABAD BELOLE KOVETKEZTETNI
//
// A football-data meccsenkent EGYETLEN AH-vonalat rogzit: azt, amelyik kb.
// kiegyenliti az eselyeket. Ezert az itteni "AH" oszlop NEM az AH-piac
// egesze, hanem a kiegyenlitett vonal. Ezen a vonalon az AH tenyleg a
// legszukebb (2.92% B365 zaron, mind a 9 szeleten) - de ebbol NEM kovetkezik,
// hogy a Tippmixen is az.
//
// A valodi Tippmix-poolon merve (2026-09-19, 43 meccs, minden vonallal) az
// AH a DRAGABB fele: hold 6.59%, szemben az 1X2 4.59%-aval. A Tippmix minden
// vonalat kinal egyszerre, es a szelso vonalak dragak.
//
// A ketto nem mond ellent egymasnak - ket kulonbozo dolgot mer. Ha a kerdes
// az, hogy a FELHASZNALO hol forgasson, a valodi pool a mervado:
// research/combo_target.js.
//
// MIERT NEM AZ OVERROUND A MERO:
//   Az overround (sum(1/o) - 1) nem osszehasonlithato kulonbozo kimenetel-
//   szamu piacok kozott: 3 lab mechanikusan tobbet gyujt, mint 2. A hold
//   viszont igen:
//     hold = 1 - 1/sum(1/o)
//   Ez a tet azon hanyada, amit a konyv megtart egy megforgatason,
//   fuggetlenul a labak szamatol. Ez a szam donti el, hol forgass.
//
// AZ AZSIAI HENDIKEP ELSZAMOLASA (itt lehet csendben elrontani):
//   A negyedvonalak (0.25, 0.75) FELBE vagjak a tetet:
//     marg = hg - ag + line  (hazai szemszog)
//     marg >= 0.5 teljes nyeres | 0.25 fel nyeres + fel push | 0 push
//     -0.25 fel veszites + fel push | <= -0.5 teljes veszites
//   A push 0 hozam, NEM nyeres. Ha nyeresnek szamolnank, az AH ROI-ja
//   hamisan jonak latszana - ez a piac legkonnyebben elrontott resze.
//
// Futtatas: cd data && node ../market_compare.js
const L = require('./odds_loader.js');
const fs = require('fs');

const mean = L.mean;
const f = (x, d = 2) => (x >= 0 ? '+' : '') + x.toFixed(d);
const se = a => {
  if (a.length < 2) return NaN;
  const mu = mean(a);
  const v = a.reduce((s, x) => s + (x - mu) ** 2, 0) / (a.length - 1);
  return Math.sqrt(v / a.length);
};

// hold = a konyv reszesedese a megforgatott tetbol. Kimenetel-szamtol fuggetlen.
const hold = o => 1 - 1 / o.reduce((a, x) => a + 1 / x, 0);

// --- extra oszlopok, amiket az odds_loader nem hoz: AH es B365 zaro O/U ---
function loadExtra() {
  const out = {};
  for (const s of L.SEASONS) for (const lg of L.LEAGUES) {
    const fp = `${lg}_${s}.csv`;
    if (!fs.existsSync(fp)) continue;
    const text = fs.readFileSync(fp, 'utf8').replace(/^﻿/, '');
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const head = lines[0].split(',').map(h => h.trim());
    const col = {}; head.forEach((h, i) => { if (col[h] === undefined) col[h] = i; });
    for (let i = 1; i < lines.length; i++) {
      const fl = lines[i].split(',');
      const h = (fl[col['HomeTeam']] || '').trim(), a = (fl[col['AwayTeam']] || '').trim();
      if (!h || !a) continue;
      const g = n => { if (col[n] === undefined) return null; const v = Number(fl[col[n]]); return Number.isFinite(v) && v > 1 ? v : null; };
      const gl = n => { if (col[n] === undefined) return null; const v = Number(fl[col[n]]); return Number.isFinite(v) ? v : null; };
      const pair = (x, y) => { const t = [g(x), g(y)]; return t.every(Boolean) ? t : null; };
      out[`${(fl[col['Date']] || '').trim()}|${h}|${a}`] = {
        line: gl('AHCh'),
        ah_pc: pair('PCAHH', 'PCAHA'), ah_b365c: pair('B365CAHH', 'B365CAHA'),
        ah_avgc: pair('AvgCAHH', 'AvgCAHA'), ah_maxc: pair('MaxCAHH', 'MaxCAHA'),
        ou_b365c: pair('B365C>2.5', 'B365C<2.5'),
      };
    }
  }
  return out;
}

const extra = loadExtra();
const all = L.loadAll().map(m => {
  const d = new Date(m.date);
  const dd = String(d.getUTCDate()).padStart(2, '0'), mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const k1 = `${dd}/${mm}/${d.getUTCFullYear()}|${m.home}|${m.away}`;
  const k2 = `${dd}/${mm}/${String(d.getUTCFullYear()).slice(2)}|${m.home}|${m.away}`;
  return { ...m, ...(extra[k1] || extra[k2] || {}) };
});

// AH: a tet mekkora hanyada nyer hazai oldalon. 0.5 = push.
function ahWonShare(hg, ag, line) {
  const marg = hg - ag + line;
  if (marg >= 0.5) return 1;
  if (marg === 0.25) return 0.75;
  if (marg === 0) return 0.5;
  if (marg === -0.25) return 0.25;
  if (marg <= -0.5) return 0;
  return 0.5;
}
const ahProfit = (won, odds) => won * (odds - 1) - (1 - won);

const MARKETS = [
  {
    name: '1X2',
    books: { Pinn: m => m.psc, B365: m => m.b365c, Avg: m => m.avgc, Max: m => m.maxc },
    legs: (m, o) => o.map((odds, i) => ({ odds, profit: m.res === i ? odds - 1 : -1 })),
  },
  {
    name: 'O/U 2.5',
    books: { Pinn: m => m.ou_pc, B365: m => m.ou_b365c, Avg: m => m.ou_avgc, Max: m => m.ou_maxc },
    legs: (m, o) => o.map((odds, i) => ({ odds, profit: m.over === i ? odds - 1 : -1 })),
  },
  {
    name: 'AH',
    books: { Pinn: m => m.ah_pc, B365: m => m.ah_b365c, Avg: m => m.ah_avgc, Max: m => m.ah_maxc },
    legs: (m, o) => {
      if (m.line === null || m.line === undefined) return null;
      const w = ahWonShare(m.hg, m.ag, m.line);
      return [
        { odds: o[0], profit: ahProfit(w, o[0]) },
        { odds: o[1], profit: ahProfit(1 - w, o[1]) },
      ];
    },
  },
];

function collect(mk, get, filter) {
  const profits = [], holds = [];
  for (const m of all) {
    if (filter && !filter(m)) continue;
    const o = get(m); if (!o) continue;
    const lg = mk.legs(m, o); if (!lg) continue;
    holds.push(hold(o));
    for (const l of lg) profits.push(l.profit);
  }
  return { profits, holds };
}

console.log('=== 1. PIACOK EGYMAS MELLETT (football-data, zaro ar) ===');
console.log('');
console.log('A hold kimenetel-szamtol fuggetlen, ezert az 1X2 (3 lab) es az O/U (2 lab) osszemerheto.');
console.log('Flat tet MINDEN labra: ha a hold igazat mond, a ROI kb. -hold.');
console.log('');
console.log('piac      | konyv | meccs |   hold% |    ROI%  +- SE  | ROI+hold');
console.log('----------+-------+-------+---------+-----------------+---------');
for (const mk of MARKETS) {
  for (const [bk, get] of Object.entries(mk.books)) {
    const { profits, holds } = collect(mk, get);
    if (holds.length < 100) continue;
    const h = mean(holds) * 100, r = mean(profits) * 100, s = se(profits) * 100;
    console.log(
      `${mk.name.padEnd(9)} | ${bk.padEnd(5)} | ${String(holds.length).padStart(5)} | ` +
      `${h.toFixed(2).padStart(7)} | ${f(r).padStart(7)} +-${s.toFixed(2).padStart(5)} | ${f(r + h).padStart(6)}pp`
    );
  }
  console.log('----------+-------+-------+---------+-----------------+---------');
}

// --- 2. konzisztencia: szezononkent es ligankent ---
// Egy piac, ami atlagban jobb, de szeletenkent ugral, nem hasznalhato
// szabalynak. Azt nezzuk, HANY szeleten nyer, nem azt, mennyivel.
console.log('');
console.log('');
console.log('=== 2. KONZISZTENCIA: ugyanaz a konyv (Pinnacle zaro), szeletenkent ===');
console.log('');
console.log('Ha egy piac tenyleg szukebb, minden szeleten annak kell a legkisebb holdot adnia.');
console.log('');
console.log('EMLEKEZTETO: az AH itt a KIEGYENLITETT vonal, mert a football-data csak azt');
console.log('rogzíti. A Tippmixen az osszes vonallal egyutt az AH dragabb - ld. combo_target.js.');
console.log('');

function sliceTable(label, keyFn, keys) {
  console.log(`${label}:`);
  console.log('  szelet   |    1X2 |  O/U   |   AH   | legszukebb');
  const wins = {};
  for (const k of keys) {
    const row = {};
    for (const mk of MARKETS) {
      const { holds } = collect(mk, mk.books.Pinn, m => keyFn(m) === k);
      row[mk.name] = holds.length >= 30 ? mean(holds) * 100 : null;
    }
    const valid = Object.entries(row).filter(([, v]) => v !== null);
    if (valid.length < 2) continue;
    const best = valid.reduce((a, b) => (b[1] < a[1] ? b : a))[0];
    wins[best] = (wins[best] || 0) + 1;
    console.log(
      `  ${String(k).padEnd(8)} | ` +
      MARKETS.map(mk => (row[mk.name] === null ? '   n/a' : row[mk.name].toFixed(2).padStart(6))).join(' | ') +
      ` | ${best}`
    );
  }
  console.log(`  -> nyertes szeletek: ${JSON.stringify(wins)}`);
  console.log('');
}
sliceTable('szezononkent', m => m.season, L.SEASONS);
sliceTable('ligankent', m => m.league, L.LEAGUES);

// --- 3. BTTS: csak margo, mert nincs eredmeny ---
console.log('');
console.log('=== 3. BTTS ES GOLSZAM (Tippmix feed) - CSAK MARGO, ROI NEM MERHETO ===');
console.log('');
console.log('A feed meccsei eredmeny nelkul vannak. Ezert itt csak a hold all;');
console.log('hozamrol ez a resz NEM mond semmit. A minta kicsi: a szamok iranyt');
console.log('adnak, nem vegleges erteket.');
console.log('');
{
  const dir = 'tippmix';
  const files = fs.readdirSync(dir).filter(x => x.startsWith('feed_'));
  const byMarket = {};
  const seenMk = new Set();
  const pairs = [];
  const seenPair = new Set();
  for (const fn of files) {
    const d = JSON.parse(fs.readFileSync(`${dir}/${fn}`, 'utf8'));
    for (const m of d.matches || []) {
      const groups = {};
      for (const o of m.odds || []) {
        const key = o.market + (o.line !== null && o.line !== undefined ? ` ${o.line}` : '');
        (groups[key] = groups[key] || []).push(o.odds);
      }
      for (const [key, odds] of Object.entries(groups)) {
        const dk = `${m.event_id}|${key}`;
        if (seenMk.has(dk)) continue;              // a ket feed atfedhet
        seenMk.add(dk);
        if (odds.length < 2 || !odds.every(x => x > 1)) continue;
        (byMarket[key] = byMarket[key] || []).push({ h: hold(odds), n: odds.length });
      }
      // parositott osszehasonlitas: ugyanaz a meccs, 1X2 vs BTTS
      const g = {};
      for (const o of m.odds || []) (g[o.market] = g[o.market] || []).push(o.odds);
      if (g.h2h && g.h2h.length === 3 && g.btts && g.btts.length === 2 && !seenPair.has(m.event_id)) {
        seenPair.add(m.event_id);
        pairs.push({ x: hold(g.h2h), b: hold(g.btts) });
      }
    }
  }
  console.log('piac              | piacok | labak |   hold% +- SE');
  console.log('------------------+--------+-------+---------------');
  for (const [k, v] of Object.entries(byMarket).sort((a, b) => b[1].length - a[1].length)) {
    if (v.length < 5) continue;
    const hs = v.map(x => x.h * 100);
    console.log(`${k.padEnd(17)} | ${String(v.length).padStart(6)} | ${String(v[0].n).padStart(5)} | ${mean(hs).toFixed(2).padStart(6)} +-${se(hs).toFixed(2)}`);
  }
  if (pairs.length >= 5) {
    const dif = pairs.map(p => (p.b - p.x) * 100);
    console.log('');
    console.log(`ugyanazon ${pairs.length} meccsen parositva (a meccs-osszetetel igy nem zavar):`);
    console.log(`  1X2  hold ${mean(pairs.map(p => p.x * 100)).toFixed(2)}%`);
    console.log(`  BTTS hold ${mean(pairs.map(p => p.b * 100)).toFixed(2)}%`);
    console.log(`  kulonbseg ${f(mean(dif))}pp +-${se(dif).toFixed(2)}  (t = ${(mean(dif) / se(dif)).toFixed(2)})`);
    console.log(`  BTTS szukebb ${pairs.filter(p => p.b < p.x).length}/${pairs.length} meccsen`);
  }
}
