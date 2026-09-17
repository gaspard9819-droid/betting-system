// Erzekenyseg-vizsgalat a tippmix_cost.js eredmenyeihez (2026-09-12):
//  1) A szelveny-osszetetel kovetkeztetese fugg-e a tippmixRatio() kalibraciotol?
//     Harom arfelteves: mert ratio / Tippmix = piaci atlag / regi lapos 4.5% haircut.
//  2) A MEGLEVO epito egyetlen parameterenek (maxLegOdds plafon) hatasa: 5 -> 3.2 -> 2.5 -> 2.0.
//     Itt nincs EV-szerinti valogatas (jointP szerint valaszt), igy nincs winner's curse.
//  3) Melyik rovid lab a legjobb? Sav x kimenetel-tipus, es szezononkent.
//  4) Nyito (pentek delutani) vs zaro arak: a slate 08:00-kor, akar 96 oraval korabban arazza.
// Futtatas: cd data && node ../composition_sensitivity.js
const { loadAll, tippmixRatio, devig, roi, roiSe, mean } = require('./odds_loader.js');
const all = loadAll();
const withPin = all.filter(m => m.psc && m.avgc && m.ou_pc && m.ou_avgc);
const f2 = x => (Number.isFinite(x) ? x.toFixed(2) : '  -  ').padStart(7);

const PRICE = {
  'mert tippmixRatio':    o => o * tippmixRatio(o),
  'Tippmix = piaci atlag': o => o,
  'regi lapos -4.5%':      o => o * 0.955,
};

// --- 1) osszetetel-tabla harom arfeltevessel (1X2 + O/U labak egyutt) ---
function evCurve(priceFn) {
  const rows = [];
  for (const m of withPin) {
    const f = devig(m.psc).probs, fo = devig(m.ou_pc).probs;
    for (let k = 0; k < 3; k++) { const ot = priceFn(m.avgc[k]); rows.push({ ot, ev: f[k] * ot - 1 }); }
    for (let k = 0; k < 2; k++) { const ot = priceFn(m.ou_avgc[k]); rows.push({ ot, ev: fo[k] * ot - 1 }); }
  }
  const bins = []; for (let o = 1.1; o < 6.0; o += 0.2) bins.push([o, o + 0.2]); bins.push([6, 8], [8, 12]);
  const pts = bins.map(([lo, hi]) => { const s = rows.filter(r => r.ot >= lo && r.ot < hi); return { mid: (lo + hi) / 2, ev: s.length >= 40 ? mean(s.map(r => r.ev)) : null }; }).filter(p => p.ev !== null);
  return o => { if (o <= pts[0].mid) return pts[0].ev; if (o >= pts[pts.length - 1].mid) return pts[pts.length - 1].ev;
    for (let i = 1; i < pts.length; i++) if (o <= pts[i].mid) { const a = pts[i - 1], b = pts[i]; return a.ev + (b.ev - a.ev) * (o - a.mid) / (b.mid - a.mid); } };
}
console.log('1) MEGTARTOTT ERTEK (%) HAROM ARFELTEVESSEL - n egyenlo oddsu lab, 1X2+O/U gorbe');
const curves = Object.fromEntries(Object.entries(PRICE).map(([k, fn]) => [k, evCurve(fn)]));
console.log('   cel   n   lab-odds   ' + Object.keys(PRICE).map(k => k.padEnd(22)).join(''));
for (const T of [5, 10, 20, 50]) {
  for (let n = 2; n <= 6; n++) {
    const o = Math.pow(T, 1 / n); if (o < 1.3 || o > 12) continue;
    console.log(`   ${String(T + 'x').padEnd(5)} ${n}   ${o.toFixed(2).padStart(6)}     ` + Object.values(curves).map(c => (Math.pow(1 + c(o), n) * 100).toFixed(1).padStart(5) + '%').join('                 '));
  }
  console.log();
}

// --- 2) a meglevo epito plafonjanak hatasa (legkevesebb lab, jointP szerint) ---
const byDay = {};
for (const m of withPin) (byDay[m.date.slice(0, 10)] = byDay[m.date.slice(0, 10)] || []).push(m);
const days = Object.entries(byDay).filter(([, ms]) => ms.length >= 8);
function dayPool(ms, priceFn) {
  const pool = [];
  ms.forEach((m, i) => {
    const f = devig(m.psc).probs, fo = devig(m.ou_pc).probs;
    for (let k = 0; k < 3; k++) { const ot = priceFn(m.avgc[k]); if (ot >= 1.3 && ot <= 8) pool.push({ evt: i, ot, p: f[k], win: m.res === k }); }
    for (let k = 0; k < 2; k++) { const ot = priceFn(m.ou_avgc[k]); if (ot >= 1.3 && ot <= 8) pool.push({ evt: i, ot, p: fo[k], win: m.over === k }); }
  });
  return pool;
}
function fewest(pool, T, cap) {
  const lo = T * 0.88, hi = T * 1.12;
  const p2 = pool.filter(l => l.ot <= cap).sort((a, b) => b.p - a.p);
  if (!p2.length) return null;
  const maxOdds = Math.max(...p2.map(l => l.ot));
  const nMin = Math.max(2, Math.ceil(Math.log(T) / Math.log(maxOdds)));
  for (let n = nMin; n <= 8; n++) {
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
    if (found.length) {
      let best = null;
      for (const f of found) { f.jointP = f.legs.reduce((a, l) => a * l.p, 1); f.n = n; f.win = f.legs.every(l => l.win);
        f.score = f.jointP * (1 - Math.abs(f.prod - T) / T); if (!best || f.score > best.score) best = f; }
      return best;
    }
  }
  return null;
}
console.log(`2) A MEGLEVO EPITO (legkevesebb lab, jointP) KULONBOZO PLAFONNAL - ${days.length} nap, mert tippmixRatio aron`);
for (const T of [5, 10, 20, 50]) {
  console.log(`   CEL ${T}x     plafon   szelveny  atlag lab   EV(fair)   bejott   ROI(realizalt)      | EV(fair) ha Tippmix = piaci atlag`);
  for (const cap of [Infinity, 5, 3.2, 2.5, 2.0, 1.7]) {
    const out = [], out2 = [];
    for (const [, ms] of days) {
      const r = fewest(dayPool(ms, PRICE['mert tippmixRatio']), T, cap) || fewest(dayPool(ms, PRICE['mert tippmixRatio']), T, Infinity); if (r) out.push(r);
      const r2 = fewest(dayPool(ms, PRICE['Tippmix = piaci atlag']), T, cap) || fewest(dayPool(ms, PRICE['Tippmix = piaci atlag']), T, Infinity); if (r2) out2.push(r2);
    }
    if (!out.length) continue;
    const bets = out.map(r => ({ win: r.win, odds: r.prod }));
    console.log(`               ${String(cap === Infinity ? 'nincs' : '@' + cap.toFixed(1)).padStart(6)}   ${String(out.length).padStart(5)}      ${mean(out.map(r => r.n)).toFixed(2)}      ${mean(out.map(r => r.jointP * r.prod)).toFixed(4)}    ${(mean(out.map(r => r.win ? 1 : 0)) * 100).toFixed(1).padStart(5)}%   ${f2(roi(bets))}% ±${roiSe(bets).toFixed(1).padStart(4)}      | ${mean(out2.map(r => r.jointP * r.prod)).toFixed(4)}`);
  }
  console.log();
}

// --- 3) sav x kimenetel-tipus, mert tippmix aron ---
console.log('3) MELYIK ROVID LAB? sav x tipus (mert tippmixRatio ar, fair = Pinnacle zaro)');
const T1 = PRICE['mert tippmixRatio'];
const typed = [];
for (const m of withPin) {
  const f = devig(m.psc).probs, fo = devig(m.ou_pc).probs;
  [['hazai', 0], ['dontetlen', 1], ['vendeg', 2]].forEach(([t, k]) => { const ot = T1(m.avgc[k]); typed.push({ t, ot, ev: f[k] * ot - 1, win: m.res === k, odds: ot, season: m.season }); });
  [['over 2.5', 0], ['under 2.5', 1]].forEach(([t, k]) => { const ot = T1(m.ou_avgc[k]); typed.push({ t, ot, ev: fo[k] * ot - 1, win: m.over === k, odds: ot, season: m.season }); });
}
console.log('   sav          tipus        n     EV(fair)   ROI@tippmix');
for (const [lo, hi] of [[1.1, 1.3], [1.3, 1.6], [1.6, 2.0], [2.0, 2.5], [2.5, 3.2]]) {
  for (const t of ['hazai', 'dontetlen', 'vendeg', 'over 2.5', 'under 2.5']) {
    const s = typed.filter(x => x.t === t && x.ot >= lo && x.ot < hi); if (s.length < 60) continue;
    console.log(`   ${(lo + '-' + hi).padEnd(11)}  ${t.padEnd(10)} ${String(s.length).padStart(5)}    ${f2(mean(s.map(x => x.ev)) * 100)}%   ${f2(roi(s))}% ±${roiSe(s).toFixed(1)}`);
  }
  console.log();
}
console.log('   SZEZONONKENT, 1.3-2.5 sav, minden tipus:');
for (const s of ['2223', '2324', '2425', '2526']) {
  const x = typed.filter(r => r.season === s && r.ot >= 1.3 && r.ot < 2.5);
  const y = typed.filter(r => r.season === s && r.ot >= 3.2);
  console.log(`   ${s}: 1.3-2.5  n=${String(x.length).padStart(5)}  EV(fair) ${f2(mean(x.map(r => r.ev)) * 100)}%  ROI ${f2(roi(x))}% ±${roiSe(x).toFixed(1)}     |  3.2+  n=${String(y.length).padStart(5)}  EV(fair) ${f2(mean(y.map(r => r.ev)) * 100)}%  ROI ${f2(roi(y))}% ±${roiSe(y).toFixed(1)}`);
}

// --- 4) nyito vs zaro: blind ROI ugyanazon a labon, ket idopontban ---
console.log('\n4) NYITO (pentek du.) vs ZARO piaci atlag ar - ugyanaz a lab, blind, 1X2, tippmix-ratio nelkul');
const early = all.filter(m => m.avg && m.avgc);
console.log('   sav (zaro avg)    n      ROI@nyito   ROI@zaro   atlag |elmozdulas|   nyito > zaro az esetek');
for (const [lo, hi] of [[1.3, 1.6], [1.6, 2.0], [2.0, 2.5], [2.5, 3.2], [3.2, 4.0], [4.0, 6.0]]) {
  const s = [];
  for (const m of early) for (let k = 0; k < 3; k++) if (m.avgc[k] >= lo && m.avgc[k] < hi) s.push({ e: m.avg[k], c: m.avgc[k], win: m.res === k });
  const re = roi(s.map(x => ({ win: x.win, odds: x.e }))), rc = roi(s.map(x => ({ win: x.win, odds: x.c })));
  console.log(`   ${(lo + '-' + hi).padEnd(14)} ${String(s.length).padStart(6)}    ${f2(re)}%    ${f2(rc)}%       ${(mean(s.map(x => Math.abs(x.e / x.c - 1))) * 100).toFixed(2)}%            ${(s.filter(x => x.e > x.c).length / s.length * 100).toFixed(1)}%`);
}
