// KOZVETLEN kalibracio a slate SAJAT referenciajan (2026-09-13).
//
// MIERT KELL EZ, ha mar van tippmix_calib.js?
//
// A tippmix_calib.js a football-data fixtures.csv atlaga ellen mert, majd egy
// referencia-korrekciot alkalmazott (1.30%), amit egy KORABBI pillanatkepbol
// becsultem. Az eles telepites utani ellenorzes megmutatta, hogy ez a korrekcio
// rossz volt: a slate sajat market_avg_odds mezojen mert nyers arany 98.53%
// (1X2), nem a varhato 100.6%. A valodi referencia-kulonbseg tehat ~3.4%, nem
// 1.3% - es a korrekcio irreleváns lesz, ha eleve a helyes referencian merunk.
//
// Ez a szkript a 2026-09-13-i 08:00-as futas (execution 134) Generate Legs
// kimenetet parositja a valos Tippmixpro arakkal. Ugyanaz a nap, ugyanazok a
// meccsek, es a market_avg_odds pontosan az a mezo, amire a tippmixRatio
// alkalmazva lesz. Nincs referencia-eltolodas, nincs korrekcio, nincs becsles.
//
// Adat: data/tippmix/slate_pairs_2026-09-13.json (a kinyert parok)
// Futtatas: node tippmix_direct.js   (a betting-research mappabol)
const fs = require('fs');
const path = require('path');

const PAIRS = path.join(__dirname, 'data', 'tippmix', 'slate_pairs_2026-09-13.json');
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const f2 = x => (x * 100).toFixed(2);

const pts = JSON.parse(fs.readFileSync(PAIRS, 'utf8'));
const h2h = pts.filter(p => p.market === 'h2h'), ou = pts.filter(p => p.market === 'totals');
console.log(`Kozvetlen parok a slate sajat referenciajan: ${pts.length}  (1X2: ${h2h.length}, O/U: ${ou.length})`);
console.log('Forras: execution 134 (2026-09-13 08:00) Generate Legs kimenete + valos Tippmixpro arak\n');

console.log('1) NYERS ARANY SAVONKENT (valos tippmix ar / slate market_avg_odds)');
console.log('  sav          1X2  n / arany         O/U  n / arany');
const BANDS = [[1.0, 1.4], [1.4, 1.8], [1.8, 2.2], [2.2, 2.8], [2.8, 3.6], [3.6, 5.0], [5.0, 8.0], [8.0, 100]];
for (const [lo, hi] of BANDS) {
  const a = h2h.filter(p => p.market_avg >= lo && p.market_avg < hi);
  const b = ou.filter(p => p.market_avg >= lo && p.market_avg < hi);
  const fmt = s => s.length >= 2 ? `${String(s.length).padStart(3)} / ${f2(mean(s.map(x => x.ratio))).padStart(6)}%` : `${String(s.length).padStart(3)} /      -`;
  console.log(`  ${(lo + '-' + (hi > 90 ? '' : hi)).padEnd(12)} ${fmt(a)}           ${fmt(b)}`);
}
console.log(`  OSSZES       ${String(h2h.length).padStart(3)} / ${f2(mean(h2h.map(x => x.ratio)))}%           ${String(ou.length).padStart(3)} / ${f2(mean(ou.map(x => x.ratio)))}%\n`);

function fit(rows) {
  const n = rows.length;
  const sx = rows.reduce((s, r) => s + r.market_avg, 0), sy = rows.reduce((s, r) => s + r.ratio, 0);
  const sxx = rows.reduce((s, r) => s + r.market_avg ** 2, 0), sxy = rows.reduce((s, r) => s + r.market_avg * r.ratio, 0);
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n;
  const mx = sx / n, my = sy / n;
  const cov = rows.reduce((t, r) => t + (r.market_avg - mx) * (r.ratio - my), 0) / (n - 1);
  const sdx = Math.sqrt(rows.reduce((t, r) => t + (r.market_avg - mx) ** 2, 0) / (n - 1));
  const sdy = Math.sqrt(rows.reduce((t, r) => t + (r.ratio - my) ** 2, 0) / (n - 1));
  const r = cov / (sdx * sdy), t = r * Math.sqrt((n - 2) / (1 - r * r));
  const res = rows.map(x => x.ratio - (a + b * x.market_avg));
  return { a, b, r, t, n, mean: my, rmse: Math.sqrt(res.reduce((q, e) => q + e * e, 0) / n) };
}
console.log('2) ILLESZTES');
const fH = fit(h2h), fO = fit(ou);
console.log(`  1X2:  ratio = ${fH.a.toFixed(4)} ${fH.b >= 0 ? '+' : '-'} ${Math.abs(fH.b).toFixed(5)} * odds   n=${fH.n}  r=${fH.r.toFixed(3)}  t=${fH.t.toFixed(2)}  RMSE=${f2(fH.rmse)}pp`);
console.log(`  O/U:  ratio = ${fO.a.toFixed(4)} ${fO.b >= 0 ? '+' : '-'} ${Math.abs(fO.b).toFixed(5)} * odds   n=${fO.n}  r=${fO.r.toFixed(3)}  t=${fO.t.toFixed(2)}  RMSE=${f2(fO.rmse)}pp`);
console.log(`  laposak: 1X2 ${fH.mean.toFixed(4)}, O/U ${fO.mean.toFixed(4)}`);
console.log(`  szignifikans-e a lejtes? 1X2 ${Math.abs(fH.t) > 1.96 ? 'IGEN' : 'NEM'}, O/U ${Math.abs(fO.t) > 1.96 ? 'IGEN' : 'NEM'}\n`);

console.log('3) A HAROM GORBE PONTOSSAGA EZEN A 45 PONTON');
const curves = {
  'regi (2026-09-02, 20 pont)': (o) => 1.0469 - 0.01814 * Math.min(6.0, Math.max(1.3, o)),
  'fixtures-alapu (telepitett)': (o, mk) => mk === 'totals'
    ? 0.9302 + 0.04168 * Math.min(3.2, Math.max(1.3, o))
    : 1.0322 - 0.00629 * Math.min(12.0, Math.max(1.1, o)),
  'kozvetlen (ez a szkript)': (o, mk) => mk === 'totals'
    ? fO.a + fO.b * Math.min(3.6, Math.max(1.3, o))
    : fH.a + fH.b * Math.min(12.0, Math.max(1.1, o)),
};
console.log('  gorbe                          torzitas   atlag abs hiba   RMSE');
for (const [nm, fn] of Object.entries(curves)) {
  const err = pts.map(p => fn(p.market_avg, p.market) - p.ratio);
  console.log(`  ${nm.padEnd(30)} ${(mean(err) >= 0 ? '+' : '') + f2(mean(err)).padStart(5)}pp   ${f2(mean(err.map(Math.abs))).padStart(6)}pp        ${f2(Math.sqrt(mean(err.map(e => e * e)))).padStart(5)}pp`);
}
console.log('\n  ...es az ARBAN (becsult ar / valos ar):');
for (const [nm, fn] of Object.entries(curves)) {
  const e = pts.map(p => (p.market_avg * fn(p.market_avg, p.market)) / p.real);
  console.log(`  ${nm.padEnd(30)} atlag ${f2(mean(e))}%   atlag abs hiba ${f2(mean(e.map(x => Math.abs(x - 1))))}%`);
}

console.log('\n4) SAVONKENT: melyik gorbe hol teved?');
console.log('  sav        n    valos    regi     fixtures  kozvetlen');
for (const [lo, hi] of [[1.0, 1.8], [1.8, 2.8], [2.8, 4.0], [4.0, 100]]) {
  for (const mk of ['h2h', 'totals']) {
    const s = pts.filter(p => p.market === mk && p.market_avg >= lo && p.market_avg < hi);
    if (s.length < 2) continue;
    const vals = Object.values(curves).map(fn => f2(mean(s.map(p => p.market_avg * fn(p.market_avg, p.market) / p.real))) + '%');
    console.log(`  ${mk === 'h2h' ? '1X2' : 'O/U'} ${(lo + '-' + (hi > 90 ? '' : hi)).padEnd(7)} ${String(s.length).padStart(3)}   100.00%  ${vals.join('  ')}`);
  }
}
