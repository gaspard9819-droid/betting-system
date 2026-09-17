// A tippmixRatio() ujraillesztese, a referencia-kulonbseg korrekciojaval.
//
// A tippmix_calib_check.js ket dolgot tisztazott:
//   1. A fixtures.csv AvgH/D/A oszlopa 7 nyito konyv atlaga, 8.00% overrounddal.
//      A slate market_avg_odds mezoje a The Odds API "eu" regioja, amely a
//      2026-09-08-i pillanatkepen 1.30%-kal MAGASABB arat adott ugyanarra a
//      kimenetelre, mint a football-data zaro atlaga (h2h, n=48).
//   2. A nyito-zaro kulonbseg elhanyagolhato (0.15pp overround), tehat az
//      idozites nem magyarazza az eltereseket.
//
// Ezert a mert arany NEM alkalmazhato kozvetlenul a slate-re: a fixtures
// atlaga mas (szelesebb) referencia. Ket dolgot csinalunk:
//   A) Illesztes a nyers adatra, es a referencia-korrekcioval egyutt.
//   B) Egy DE-VIGGELT osszehasonlitas, ami referencia-fuggetlen: a valos
//      valoszinusegek aranya helyett azt nezi, hogy a Tippmixpro a sajat
//      margojat hogyan osztja el az odds-sav menten. Ez az, ami a
//      szelveny-osszetetelt tenylegesen meghatarozza.
//
// Futtatas: cd data && node ../tippmix_refit.js
const fs = require('fs');
const path = require('path');
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const f2 = x => (x * 100).toFixed(2);

const pts = JSON.parse(fs.readFileSync(path.join('tippmix', 'calibration_points_2026-09-13.json'), 'utf8'));
const h2h = pts.filter(p => p.market === 'h2h'), ou = pts.filter(p => p.market === 'ou');

// A slate referenciaja 1.30%-kal magasabb arat ad, mint a football-data atlag
// (h2h, n=48 a 2026-09-08-i pillanatkepen). Az O/U-nal 0.48%.
const REF_ADJ = { h2h: 1.0130, ou: 1.0048 };
console.log('REFERENCIA-KORREKCIO (a slate market_avg_odds / football-data atlag)');
console.log(`  1X2: ${f2(REF_ADJ.h2h - 1)}%   O/U: ${f2(REF_ADJ.ou - 1)}%`);
console.log('  A korrigalt arany = mert_arany / korrekcio - ez az, amit a slate');
console.log('  market_avg_odds mezojere kellene alkalmazni.\n');

function fit(rows, lo, hi) {
  const s = rows.filter(r => r.market_avg >= lo && r.market_avg <= hi);
  if (s.length < 5) return null;
  const n = s.length;
  const sx = s.reduce((a, r) => a + r.market_avg, 0), sy = s.reduce((a, r) => a + r.adj, 0);
  const sxx = s.reduce((a, r) => a + r.market_avg ** 2, 0), sxy = s.reduce((a, r) => a + r.market_avg * r.adj, 0);
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n;
  const mx = sx / n, my = sy / n;
  const cov = s.reduce((t, r) => t + (r.market_avg - mx) * (r.adj - my), 0) / (n - 1);
  const sdx = Math.sqrt(s.reduce((t, r) => t + (r.market_avg - mx) ** 2, 0) / (n - 1));
  const sdy = Math.sqrt(s.reduce((t, r) => t + (r.adj - my) ** 2, 0) / (n - 1));
  const r = cov / (sdx * sdy), t = r * Math.sqrt((n - 2) / (1 - r * r));
  const res = s.map(x => x.adj - (a + b * x.market_avg));
  return { a, b, r, t, n, rmse: Math.sqrt(res.reduce((q, e) => q + e * e, 0) / n), mean: my };
}

const adj = (rows, k) => rows.map(r => ({ ...r, adj: r.ratio / REF_ADJ[k] }));
const H = adj(h2h, 'h2h'), O = adj(ou, 'ou');

console.log('1) KORRIGALT ARANY SAVONKENT (amit a slate-re alkalmaznank)');
console.log('  sav          1X2  n / arany        O/U  n / arany');
for (const [lo, hi] of [[1.0, 1.3], [1.3, 1.6], [1.6, 2.0], [2.0, 2.5], [2.5, 3.2], [3.2, 4.0], [4.0, 6.0], [6.0, 100]]) {
  const a = H.filter(r => r.market_avg >= lo && r.market_avg < hi);
  const b = O.filter(r => r.market_avg >= lo && r.market_avg < hi);
  const fmt = s => s.length >= 3 ? `${String(s.length).padStart(3)} / ${f2(mean(s.map(x => x.adj))).padStart(6)}%` : `${String(s.length).padStart(3)} /      -`;
  console.log(`  ${(lo + '-' + (hi > 90 ? '' : hi)).padEnd(12)} ${fmt(a)}          ${fmt(b)}`);
}
console.log(`  OSSZES       ${String(H.length).padStart(3)} / ${f2(mean(H.map(x => x.adj)))}%          ${String(O.length).padStart(3)} / ${f2(mean(O.map(x => x.adj)))}%\n`);

console.log('2) ILLESZTESEK');
const fits = {
  '1X2, 1.3-6.0 (a jelenlegi tartomany)': fit(H, 1.3, 6.0),
  '1X2, teljes': fit(H, 0, 999),
  'O/U, teljes': fit(O, 0, 999),
};
for (const [nm, f] of Object.entries(fits)) {
  if (!f) continue;
  console.log(`  ${nm}`);
  console.log(`    ratio = ${f.a.toFixed(4)} ${f.b >= 0 ? '+' : '-'} ${Math.abs(f.b).toFixed(5)} * odds     n=${f.n}  r=${f.r.toFixed(3)}  t=${f.t.toFixed(2)}  RMSE=${f2(f.rmse)}pp`);
  console.log(`    lapos alternativa: ratio = ${f.mean.toFixed(4)} (konstans)`);
}

// Melyik jobb: lejtő vagy lapos? RMSE osszevetes.
console.log('\n3) LEJTO vagy LAPOS? (kisebb RMSE = jobb illeszkedes)');
for (const [nm, rows] of [['1X2', H], ['O/U', O]]) {
  const f = fit(rows, 0, 999);
  const flatRmse = Math.sqrt(rows.reduce((s, r) => s + (r.adj - f.mean) ** 2, 0) / rows.length);
  const better = f.rmse < flatRmse ? 'lejto' : 'LAPOS';
  console.log(`  ${nm}: lejto RMSE ${f2(f.rmse)}pp, lapos RMSE ${f2(flatRmse)}pp  -> ${better} jobb (kulonbseg ${f2(Math.abs(f.rmse - flatRmse))}pp)`);
  console.log(`       t=${f.t.toFixed(2)} ${Math.abs(f.t) > 1.96 ? '(szignifikans)' : '(NEM szignifikans, |t|<1.96)'}`);
}

// ---------- 4) A DONTO KERDES: valtozik-e a szelveny-osszetetel? ----------
// A composition_sensitivity.js azt mutatta, hogy a megtartott ertek a labszam
// menten a tippmixRatio meredeksegetol fugg. Most ugyanazt szamoljuk, harom
// aranygorbevel: a regi, az uj illesztett, es a lapos.
console.log('\n4) SZELVENY-OSSZETETEL A HAROM GORBEVEL');
console.log('   (megtartott ertek Pinnacle-fair ellen, n egyenlo oddsu labbal)');
const { loadAll, devig } = require('./odds_loader.js');
const all = loadAll().filter(m => m.psc && m.avgc && m.ou_pc && m.ou_avgc);
const CURVES = {
  'regi (1.0469-0.01814o)': o => 1.0469 - 0.01814 * Math.min(6.0, Math.max(1.3, o)),
  'uj lejto (1X2 illesztes)': null,   // lentebb toltjuk
  'uj lapos': null,
};
const fH = fit(H, 0, 999);
CURVES['uj lejto (1X2 illesztes)'] = o => fH.a + fH.b * Math.min(8.0, Math.max(1.1, o));
CURVES['uj lapos'] = () => fH.mean;

function evCurve(priceFn) {
  const rows = [];
  for (const m of all) {
    const f = devig(m.psc).probs, fo = devig(m.ou_pc).probs;
    for (let k = 0; k < 3; k++) { const ot = m.avgc[k] * priceFn(m.avgc[k]); rows.push({ ot, ev: f[k] * ot - 1 }); }
    for (let k = 0; k < 2; k++) { const ot = m.ou_avgc[k] * priceFn(m.ou_avgc[k]); rows.push({ ot, ev: fo[k] * ot - 1 }); }
  }
  const bins = []; for (let o = 1.1; o < 6.0; o += 0.2) bins.push([o, o + 0.2]); bins.push([6, 8], [8, 12]);
  const p = bins.map(([lo, hi]) => { const s = rows.filter(r => r.ot >= lo && r.ot < hi); return { mid: (lo + hi) / 2, ev: s.length >= 40 ? mean(s.map(x => x.ev)) : null }; }).filter(x => x.ev !== null);
  return o => { if (o <= p[0].mid) return p[0].ev; if (o >= p[p.length - 1].mid) return p[p.length - 1].ev;
    for (let i = 1; i < p.length; i++) if (o <= p[i].mid) { const a = p[i - 1], b = p[i]; return a.ev + (b.ev - a.ev) * (o - a.mid) / (b.mid - a.mid); } };
}
const evs = Object.fromEntries(Object.entries(CURVES).map(([k, fn]) => [k, evCurve(fn)]));
console.log('   cel   n   lab-odds   ' + Object.keys(CURVES).map(k => k.padEnd(24)).join(''));
for (const T of [5, 10, 20, 50]) {
  let bestN = {};
  for (let n = 2; n <= 6; n++) {
    const o = Math.pow(T, 1 / n); if (o < 1.2 || o > 12) continue;
    const vals = Object.entries(evs).map(([k, c]) => { const v = Math.pow(1 + c(o), n); if (!bestN[k] || v > bestN[k].v) bestN[k] = { v, n }; return v; });
    console.log(`   ${String(T + 'x').padEnd(5)} ${n}   ${o.toFixed(2).padStart(6)}     ` + vals.map(v => (v * 100).toFixed(1).padStart(5) + '%').join('                   '));
  }
  console.log(`   -> optimalis labszam: ` + Object.entries(bestN).map(([k, x]) => `${k.split(' ')[0]}=${x.n}`).join(', '));
  console.log();
}
