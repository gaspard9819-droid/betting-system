// KERDES: mennyibe kerul egy lab a Tippmixpro-becsult aron, odds-savonkent?
// Es ebbol kovetkezik-e mas szelveny-osszetetel, mint a "legkevesebb lab @5 plafonnal"?
//
// Az acca.js LAPOS 8% margot feltetelezett labankent. De a tippmixRatio() meres
// szerint a Tippmixpro rovid oddson a piaci atlag FELETT fizet, hosszun alatta.
// Ha a lab-koltseg odds-fuggo, a legkevesebb-lab szabaly nem feltetlenul optimalis.
//
// Modszer: Pinnacle zaro = fair valoszinuseg (a piac legjobb becslese), a lab ara
// AvgC x tippmixRatio(AvgC). EV = p_fair x odds - 1. A realizalt ROI is ott van
// kontrollnak (zajos, +-se-vel).
// Futtatas: cd data && node ../tippmix_cost.js
const { loadAll, TIPPMIX, devig, roi, roiSe, mean } = require('./odds_loader.js');
const all = loadAll();
const withPin = all.filter(m => m.psc && m.avgc);
console.log(`Meccsek: ${all.length}, Pinnacle zaroval: ${withPin.length}\n`);

const BANDS = [[1.3, 1.6], [1.6, 2.0], [2.0, 2.5], [2.5, 3.2], [3.2, 4.0], [4.0, 5.0], [5.0, 6.0], [6.0, 12]];
const bandOf = o => BANDS.find(([lo, hi]) => o >= lo && o < hi);
const bandName = b => `${b[0].toFixed(1)}-${b[1] >= 12 ? '   ' : b[1].toFixed(1)}`;
const f2 = x => (Number.isFinite(x) ? x.toFixed(2) : '  -  ').padStart(7);

// --- 1X2 labak ---
const legs = [];
for (const m of withPin) {
  const fair = devig(m.psc).probs;
  for (let k = 0; k < 3; k++) {
    const oa = m.avgc[k], ot = TIPPMIX(oa), op = m.psc[k];
    legs.push({ k, league: m.league, oa, ot, op, fair: fair[k], win: m.res === k, ev: fair[k] * ot - 1 });
  }
}
// --- O/U 2.5 labak ---
const ouLegs = [];
for (const m of all.filter(m => m.ou_pc && m.ou_avgc)) {
  const fair = devig(m.ou_pc).probs;
  for (let k = 0; k < 2; k++) {
    const oa = m.ou_avgc[k], ot = TIPPMIX(oa), op = m.ou_pc[k];
    ouLegs.push({ k, league: m.league, oa, ot, op, fair: fair[k], win: m.over === k, ev: fair[k] * ot - 1 });
  }
}

function table(title, rows) {
  console.log(title);
  console.log('  sav (tippmix)   n     tippmix/avg   EV(fair)   ROI@tippmix        ROI@avg   ROI@pinnacle');
  for (const b of BANDS) {
    const s = rows.filter(r => bandOf(r.ot) === b); if (s.length < 30) continue;
    const t = s.map(r => ({ win: r.win, odds: r.ot })), a = s.map(r => ({ win: r.win, odds: r.oa })), p = s.map(r => ({ win: r.win, odds: r.op }));
    console.log(`  ${bandName(b).padEnd(12)} ${String(s.length).padStart(6)}     ${(mean(s.map(r => r.ot / r.oa)) * 100).toFixed(1)}%      ${f2(mean(s.map(r => r.ev)) * 100)}%   ${f2(roi(t))}% ±${roiSe(t).toFixed(1)}   ${f2(roi(a))}%   ${f2(roi(p))}%`);
  }
  const t = rows.map(r => ({ win: r.win, odds: r.ot }));
  console.log(`  OSSZES       ${String(rows.length).padStart(6)}                  ${f2(mean(rows.map(r => r.ev)) * 100)}%   ${f2(roi(t))}% ±${roiSe(t).toFixed(1)}\n`);
}
table('1) 1X2 LABAK TIPPMIX-BECSULT ARON (fair = Pinnacle zaro, multiplikativ de-vig)', legs);
table('2) O/U 2.5 LABAK TIPPMIX-BECSULT ARON (figyelem: a tippmixRatio 1X2 arakon kalibralt)', ouLegs);

console.log('3) KIMENETEL TIPUS SZERINT (1X2, tippmix ar)');
for (const [nm, k] of [['hazai', 0], ['dontetlen', 1], ['vendeg', 2]]) {
  const s = legs.filter(r => r.k === k), t = s.map(r => ({ win: r.win, odds: r.ot }));
  console.log(`  ${nm.padEnd(10)} n=${s.length}  EV(fair) ${f2(mean(s.map(r => r.ev)) * 100)}%   ROI ${f2(roi(t))}% ±${roiSe(t).toFixed(1)}`);
}
console.log('\n4) LIGA SZERINT (1X2, tippmix ar)   [atlag overround: Avg-konyv / Pinnacle]');
for (const lg of ['E0', 'D1', 'SP1', 'I1', 'F1']) {
  const s = legs.filter(r => r.league === lg), t = s.map(r => ({ win: r.win, odds: r.ot }));
  const ms = withPin.filter(m => m.league === lg);
  console.log(`  ${lg.padEnd(4)} n=${s.length}  EV(fair) ${f2(mean(s.map(r => r.ev)) * 100)}%   ROI ${f2(roi(t))}% ±${roiSe(t).toFixed(1)}   overround ${(mean(ms.map(m => devig(m.avgc).overround)) * 100).toFixed(2)}% / ${(mean(ms.map(m => devig(m.psc).overround)) * 100).toFixed(2)}%`);
}
const ouMs = all.filter(m => m.ou_pc && m.ou_avgc);
console.log(`  O/U 2.5 overround: Avg ${(mean(ouMs.map(m => devig(m.ou_avgc).overround)) * 100).toFixed(2)}% / Pinnacle ${(mean(ouMs.map(m => devig(m.ou_pc).overround)) * 100).toFixed(2)}%\n`);

// --- EV gorbe finom binekben, a szelveny-osszetetel szamolasahoz ---
function evCurve(rows) {
  const bins = []; for (let o = 1.3; o < 6.0; o += 0.2) bins.push([o, o + 0.2]); bins.push([6, 8], [8, 12]);
  const pts = bins.map(([lo, hi]) => { const s = rows.filter(r => r.ot >= lo && r.ot < hi); return { mid: (lo + hi) / 2, n: s.length, ev: s.length >= 40 ? mean(s.map(r => r.ev)) : null }; }).filter(p => p.ev !== null);
  return o => { // linearis interpolacio a bin-kozepek kozott, szeleken levagva
    if (o <= pts[0].mid) return pts[0].ev; if (o >= pts[pts.length - 1].mid) return pts[pts.length - 1].ev;
    for (let i = 1; i < pts.length; i++) if (o <= pts[i].mid) { const a = pts[i - 1], b = pts[i]; return a.ev + (b.ev - a.ev) * (o - a.mid) / (b.mid - a.mid); }
  };
}
const EV1 = evCurve(legs), EVou = evCurve(ouLegs);
console.log('5) SZELVENY-OSSZETETEL: megtartott ertek = PI(1+EV(o_i)), n egyenlo oddsu labbal');
console.log('   (acca.js lapos 8%-os feltevese osszehasonlitasul; 1X2 gorbe / O/U gorbe)');
console.log('   cel   n   lab-odds   lapos8%   1X2-gorbe   O/U-gorbe');
for (const T of [3, 5, 10, 20, 50]) {
  for (let n = 1; n <= 8; n++) {
    const o = Math.pow(T, 1 / n); if (o < 1.3 || o > 12) continue;
    const flat = 1 / Math.pow(1.08, n), k1 = Math.pow(1 + EV1(o), n), k2 = Math.pow(1 + EVou(o), n);
    console.log(`   ${String(T + 'x').padEnd(5)} ${n}   ${o.toFixed(2).padStart(6)}     ${(flat * 100).toFixed(1).padStart(5)}%    ${(k1 * 100).toFixed(1).padStart(5)}%      ${(k2 * 100).toFixed(1).padStart(5)}%`);
  }
  console.log();
}

// --- 6) Empirikus szelveny-szimulacio valos napi poolokbol ---
// A: jelenlegi szabaly - legkevesebb lab, @5 puha plafon, jointP szerint valaszt
// B: barmely labszam 2-6, a legnagyobb PI(p_fair*odds) (= legjobb bejovesi esely a celnal)
// C: mint B, de @5 plafon nelkul
console.log('6) EMPIRIKUS SZELVENY-SZIMULACIO (napi pool = az adott nap osszes 1X2 + O/U labja, tippmix aron)');
const byDay = {};
for (const m of withPin.filter(m => m.ou_pc && m.ou_avgc)) (byDay[m.date.slice(0, 10)] = byDay[m.date.slice(0, 10)] || []).push(m);
const days = Object.entries(byDay).filter(([, ms]) => ms.length >= 8);
console.log(`   ${days.length} nap legalabb 8 meccsel\n`);

function dayPool(ms) {
  const pool = [];
  ms.forEach((m, i) => {
    const f = devig(m.psc).probs, fo = devig(m.ou_pc).probs;
    for (let k = 0; k < 3; k++) { const ot = TIPPMIX(m.avgc[k]); if (ot >= 1.3 && ot <= 8) pool.push({ evt: i, ot, p: f[k], ev: f[k] * ot, win: m.res === k }); }
    for (let k = 0; k < 2; k++) { const ot = TIPPMIX(m.ou_avgc[k]); if (ot >= 1.3 && ot <= 8) pool.push({ evt: i, ot, p: fo[k], ev: fo[k] * ot, win: m.over === k }); }
  });
  return pool;
}
function search(pool, T, nMinReq, nMax, cap, sortKey, mode) {
  const lo = T * 0.88, hi = T * 1.12;
  const p2 = pool.filter(l => l.ot <= cap).sort((a, b) => b[sortKey] - a[sortKey]);
  if (!p2.length) return null;
  const maxOdds = Math.max(...p2.map(l => l.ot));
  const nMin = Math.max(nMinReq, Math.ceil(Math.log(T) / Math.log(maxOdds)));
  let best = null;
  for (let n = nMin; n <= nMax; n++) {
    const found = []; let budget = 300000;
    const dfs = (start, chosen, prod, used) => {
      if (found.length >= 400 || budget-- <= 0) return;
      if (chosen.length === n) { if (prod >= lo && prod <= hi) found.push({ legs: [...chosen], prod }); return; }
      const rem = n - chosen.length;
      for (let i = start; i < p2.length; i++) {
        if (p2.length - i < rem) break;
        const l = p2[i]; if (used.has(l.evt)) continue;
        const p = prod * l.ot;
        if (p * Math.pow(maxOdds, rem - 1) < lo) continue;
        if (p > hi) continue;
        used.add(l.evt); chosen.push(l); dfs(i + 1, chosen, p, used); chosen.pop(); used.delete(l.evt);
      }
    };
    dfs(0, [], 1, new Set());
    for (const f of found) {
      f.jointP = f.legs.reduce((a, l) => a * l.p, 1);
      f.n = n; f.win = f.legs.every(l => l.win);
      f.score = mode === 'fewest' ? f.jointP * (1 - Math.abs(f.prod - T) / T) : f.jointP * f.prod;
      if (!best || f.score > best.score) best = f;
    }
    if (best && mode === 'fewest') return best;
  }
  return best;
}
const strategies = {
  'A jelenlegi (legkevesebb lab, @5 plafon)': (pool, T) => search(pool, T, 2, 6, 5, 'p', 'fewest') || search(pool, T, 2, 6, Infinity, 'p', 'fewest'),
  'B max EV, 2-6 lab, @5 plafon':            (pool, T) => search(pool, T, 2, 6, 5, 'ev', 'best'),
  'C max EV, 2-6 lab, plafon nelkul':        (pool, T) => search(pool, T, 2, 6, Infinity, 'ev', 'best'),
};
for (const T of [5, 10, 20]) {
  console.log(`   CEL ${T}x`);
  console.log('   strategia                                   szelveny  atlag lab  EV(fair)  bejott   ROI(realizalt)');
  for (const [nm, fn] of Object.entries(strategies)) {
    const out = [];
    for (const [, ms] of days) { const r = fn(dayPool(ms), T); if (r) out.push(r); }
    if (!out.length) { console.log(`   ${nm.padEnd(44)} nincs megoldas`); continue; }
    const bets = out.map(r => ({ win: r.win, odds: r.prod }));
    console.log(`   ${nm.padEnd(44)} ${String(out.length).padStart(5)}     ${mean(out.map(r => r.n)).toFixed(2)}      ${mean(out.map(r => r.jointP * r.prod)).toFixed(4)}   ${(mean(out.map(r => r.win ? 1 : 0)) * 100).toFixed(1).padStart(5)}%   ${f2(roi(bets))}% ±${roiSe(bets).toFixed(1)}`);
  }
  console.log();
}
console.log('Megjegyzes: az EV(fair) a Pinnacle zaro szerinti varhato ertek (1.0 = nullszaldo).');
console.log('A realizalt ROI a tenyleges kimenetelekbol; egy nap szelvenyei korrelalnak, a ±se ezert alulbecsul.');
