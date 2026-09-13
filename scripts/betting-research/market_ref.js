// KERDESEK (2026-09-12):
//  B) Melyik piaci referencia a legjobb valoszinuseg-forras? A Generate Legs a
//     LEGJOBB oddsbol (MaxC-szeru) de-vigel - a README szerint az "amelyik konyv
//     a legjobban tevedett". Pinnacle / Avg / Max / B365 log-loss egymas mellett.
//  C) Ad-e a modell BARMI informaciot a piacon felul? Blend: p = (1-w)*piac + w*modell,
//     a w, ami a legkisebb log-losst adja. Ha w~0, a modell valoszinusege felesleges.
//  D) Az O/U 2.5 piacon is forditott-e a modell rangsora? (Eddig csak 1X2-n mertuk.)
//  E) A szelvenyepito labpontozasa: model_prob vs p_fair vs a MAGAS/KOZEPES/ALACSONY
//     osztalyok - melyik rangsor ad jobb realizalt ROI-t tippmix aron, savon belul?
// Futtatas: cd data && node ../market_ref.js
const { loadAll, TIPPMIX, devig, roi, roiSe, mean } = require('./odds_loader.js');
const { computeRatings } = require('./ratings.js');
const { predictMatch } = require('./predict.js');

const all = loadAll();
const MIN_HISTORY = 200;
let ratings = null, at = null;
const rows = [];
for (let i = 0; i < all.length; i++) {
  const m = all[i];
  if (i < MIN_HISTORY) continue;
  if (!m.psc || !m.avgc || !m.maxc) continue;
  if (!at || (new Date(m.date) - at) > 7 * 86400000) {
    // szigoruan korabbi napok - az aznapi meccsek sem szamitanak bele
    ratings = computeRatings(all.filter(x => x.date < m.date), m.date);
    at = new Date(m.date);
  }
  const R = {}; ratings.forEach(r => R[r.league + '|' + r.team] = r);
  const hr = R[m.league + '|' + m.home], ar = R[m.league + '|' + m.away];
  if (!hr || !ar || hr.matches < 8 || ar.matches < 8) continue;
  const p = predictMatch(hr, ar, hr.league_avg_goals, hr.home_advantage);
  rows.push({
    m, pm: [p.home, p.draw, p.away], pmou: [p.over25, 1 - p.over25],
    pin: devig(m.psc).probs, avg: devig(m.avgc).probs, max: devig(m.maxc).probs,
    b365: m.b365c ? devig(m.b365c).probs : null,
    pinOU: m.ou_pc ? devig(m.ou_pc).probs : null, avgOU: devig(m.ou_avgc).probs,
    maxOU: m.ou_maxc ? devig(m.ou_maxc).probs : null,
  });
}
console.log(`Ertekelt meccsek (walk-forward, heti ujraszamolas, 4+ szezon): ${rows.length}\n`);

const ll = (rs, get, key) => mean(rs.map(r => -Math.log(Math.max(1e-9, get(r)[r.m[key]]))));
const f4 = x => x.toFixed(4);

console.log('B) PIACI REFERENCIAK LOG-LOSSA (kisebb = jobb)');
const r1 = rows.filter(r => r.b365);
console.log(`   1X2  (n=${r1.length})  Pinnacle ${f4(ll(r1, r => r.pin, 'res'))}   Avg ${f4(ll(r1, r => r.avg, 'res'))}   Max(=Generate Legs) ${f4(ll(r1, r => r.max, 'res'))}   B365 ${f4(ll(r1, r => r.b365, 'res'))}   modell ${f4(ll(r1, r => r.pm, 'res'))}`);
const r2 = rows.filter(r => r.pinOU && r.maxOU);
console.log(`   O/U  (n=${r2.length})  Pinnacle ${f4(ll(r2, r => r.pinOU, 'over'))}   Avg ${f4(ll(r2, r => r.avgOU, 'over'))}   Max ${f4(ll(r2, r => r.maxOU, 'over'))}   modell ${f4(ll(r2, r => r.pmou, 'over'))}`);
// Mennyire ter el a Max-alapu es a Pinnacle-alapu valoszinuseg?
const gap = rows.map(r => Math.max(...[0, 1, 2].map(k => Math.abs(r.max[k] - r.pin[k]))));
console.log(`   Max vs Pinnacle valoszinuseg elteres: atlag ${(mean(gap) * 100).toFixed(2)}pp, >3pp az esetek ${(gap.filter(g => g > 0.03).length / gap.length * 100).toFixed(1)}%-aban\n`);

console.log('C) MODELL + PIAC BLEND: p = (1-w)*piac + w*modell  (log-loss, 1X2 / O-U)');
console.log('   w      Pinnacle-alap 1X2   Avg-alap 1X2   Pinnacle-alap O/U   Avg-alap O/U');
let bestW = { pin: null, avg: null, pinOU: null, avgOU: null };
for (let w = 0; w <= 1.0001; w += 0.1) {
  const bl = (a, b) => a.map((x, i) => (1 - w) * x + w * b[i]);
  const v = {
    pin: ll(rows, r => bl(r.pin, r.pm), 'res'), avg: ll(rows, r => bl(r.avg, r.pm), 'res'),
    pinOU: ll(r2, r => bl(r.pinOU, r.pmou), 'over'), avgOU: ll(r2, r => bl(r.avgOU, r.pmou), 'over'),
  };
  for (const k of Object.keys(v)) if (!bestW[k] || v[k] < bestW[k].ll) bestW[k] = { w, ll: v[k] };
  console.log(`   ${w.toFixed(1)}        ${f4(v.pin)}            ${f4(v.avg)}           ${f4(v.pinOU)}            ${f4(v.avgOU)}`);
}
console.log(`   legjobb w: Pinnacle-1X2 ${bestW.pin.w.toFixed(1)}, Avg-1X2 ${bestW.avg.w.toFixed(1)}, Pinnacle-O/U ${bestW.pinOU.w.toFixed(1)}, Avg-O/U ${bestW.avgOU.w.toFixed(1)}\n`);

console.log('D) O/U 2.5: A MODELL RANGSORA (AvgC aron, mint a backtest.js az 1X2-n)');
const ouBets = [];
for (const r of r2) for (let k = 0; k < 2; k++) {
  const o = r.m.ou_avgc[k];
  ouBets.push({ odds: o, win: r.m.over === k, ev: r.pmou[k] * o - 1, edge: r.pmou[k] - r.pinOU[k] });
}
const show = (nm, a) => console.log(`   ${nm.padEnd(40)} ${String(a.length).padStart(5)} fogadas   ROI ${roi(a).toFixed(2).padStart(7)}% ±${roiSe(a).toFixed(1)}   talalat ${(a.filter(b => b.win).length / a.length * 100).toFixed(1)}%`);
show('minden O/U lab (alapvonal)', ouBets);
for (const th of [0, 0.03, 0.06, 0.10]) show(`modell EV > ${(th * 100).toFixed(0)}%`, ouBets.filter(b => b.ev > th));
show('KONTROLL: modell EV < -10%', ouBets.filter(b => b.ev < -0.10));
const srt = [...ouBets].sort((a, b) => b.edge - a.edge); const q = Math.floor(srt.length / 4);
['legjobb 25% (modell-piac elteres)', '2. negyed', '3. negyed', 'legrosszabb 25%'].forEach((nm, i) => show(nm, srt.slice(i * q, (i + 1) * q)));
console.log();

console.log('E) LABPONTOZAS A SZELVENYEPITOBEN - savon belul, tippmix aron, 1X2 + O/U labak');
console.log('   Rangsor-kulcsok: model_prob (jelenlegi jointP), p_fair (Pinnacle), bizalmi osztaly (Generate Legs, Max-alapu)');
const tl = [];
for (const r of rows) {
  for (let k = 0; k < 3; k++) {
    const ot = TIPPMIX(r.m.avgc[k]); if (ot < 1.3) continue;
    const diff = r.pm[k] - r.max[k];
    tl.push({ ot, win: r.m.res === k, mp: r.pm[k], fair: r.pin[k], diff, diffPin: r.pm[k] - r.pin[k], odds: ot });
  }
  if (r.pinOU) for (let k = 0; k < 2; k++) {
    const ot = TIPPMIX(r.m.ou_avgc[k]); if (ot < 1.3) continue;
    const mx = r.maxOU ? r.maxOU[k] : r.avgOU[k];
    tl.push({ ot, win: r.m.over === k, mp: r.pmou[k], fair: r.pinOU[k], diff: r.pmou[k] - mx, diffPin: r.pmou[k] - r.pinOU[k], odds: ot });
  }
}
const conf = d => Math.abs(d) <= 0.03 ? 'MAGAS' : d <= 0.08 ? 'KOZEPES' : 'ALACSONY';
for (const [lo, hi] of [[1.3, 2.0], [2.0, 3.2], [3.2, 5.0]]) {
  const s = tl.filter(l => l.ot >= lo && l.ot < hi);
  console.log(`   SAV ${lo}-${hi}  (n=${s.length}, ROI@tippmix osszes ${roi(s).toFixed(2)}%)`);
  for (const [nm, key] of [['model_prob', 'mp'], ['p_fair (Pinnacle)', 'fair'], ['modell-piac elteres', 'diffPin']]) {
    const so = [...s].sort((a, b) => b[key] - a[key]); const q = Math.floor(so.length / 4);
    const top = so.slice(0, q), bot = so.slice(3 * q);
    console.log(`     ${nm.padEnd(22)} felso negyed ROI ${roi(top).toFixed(2).padStart(7)}% ±${roiSe(top).toFixed(1)}  (talalat ${(top.filter(b => b.win).length / top.length * 100).toFixed(1)}%)   also negyed ROI ${roi(bot).toFixed(2).padStart(7)}% ±${roiSe(bot).toFixed(1)}  (talalat ${(bot.filter(b => b.win).length / bot.length * 100).toFixed(1)}%)`);
  }
  for (const c of ['MAGAS', 'KOZEPES', 'ALACSONY']) {
    const a = s.filter(l => conf(l.diff) === c), b = s.filter(l => conf(l.diffPin) === c);
    console.log(`     ${c.padEnd(9)} Max-alapu (eles): n=${String(a.length).padStart(5)} ROI ${roi(a).toFixed(2).padStart(7)}% talalat ${(a.filter(x => x.win).length / a.length * 100).toFixed(1)}%   |  Pinnacle-alapu: n=${String(b.length).padStart(5)} ROI ${roi(b).toFixed(2).padStart(7)}% talalat ${(b.filter(x => x.win).length / b.length * 100).toFixed(1)}%`);
  }
  const dis = s.filter(l => conf(l.diff) !== conf(l.diffPin)).length;
  console.log(`     osztaly-elteres Max vs Pinnacle referencia kozott: ${(dis / s.length * 100).toFixed(1)}%\n`);
}
