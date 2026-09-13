// Tippmixpro ar-kalibracio valos arakbol (2026-09-13).
//
// A tippmixRatio() eddig 20 adatponton allt, es MINDEN szelveny-osszetetelre
// vonatkozo kovetkeztetes ezen billegett. Ez a szkript a felhasznalo altal
// gyujtott Tippmixpro arakat parositja a football-data.co.uk fixtures.csv
// piaci atlagaihoz (AvgH/D/A es Avg>2.5/Avg<2.5), es ujrakalibralja az aranyt.
//
// MIERT a fixtures.csv: a te araid JOVOBELI meccsekre szolnak, a szezon-CSV-k
// viszont csak lejatszott meccseket tartalmaznak. A fixtures.csv a kozelgo
// fordulo arait adja, ingyen, kvota nelkul. Ugyanaz a forras, amit a slate is
// hasznal a modellhez - csak a masik vegerol.
//
// KRITIKUS KULONBSEG az elozo kalibraciohoz kepest: ez kulon kezeli az 1X2 es
// az O/U 2.5 piacot. A regi gorbe KIZAROLAG 1X2 arakon allt, es az O/U-ra
// alkalmazva puszta feltetelezes volt - a README ezt nyitott kerdeskent
// tartotta nyilvan.
//
// Futtatas: cd data && node ../tippmix_calib.js
const fs = require('fs');
const path = require('path');

const TIPPMIX_CSV = path.join('tippmix', 'tippmixpro_2026-09-13.csv');
const FIXTURES = path.join('fresh', 'fixtures.csv');

// ---------- csapatnev-normalizalas ----------
// A Tippmixpro magyar/nemzetkozi irasmodot hasznal, a football-data sajatot.
const norm = s => String(s)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\b(fc|sc|ac|as|ss|ssc|afc|cf|bc|sv|vfb|vfl|tsg|rc|ogc|aj|us|ud|ca|rcd|acf|1)\b/g, ' ')
  .replace(/\s+/g, ' ').trim();

// Tippmixpro nev -> football-data nev. Csak ahol a normalizalas nem eleg.
const ALIAS = {
  'manchester utd': 'man united', 'manchester city': 'man city',
  'nottingham': 'nott m forest', 'hull city': 'hull',
  'atl madrid': 'ath madrid', 'ath bilbao': 'ath bilbao',
  'real sociedad': 'sociedad', 'deportivo la coruna': 'la coruna',
  'r santander': 'santander', 'espanyol': 'espanol',
  'rayo vallecano': 'vallecano', 'celta vigo': 'celta',
  'internazionale': 'inter', 'bayern munchen': 'bayern munich',
  'monchengladbach': 'm gladbach', 'e frankfurt': 'ein frankfurt',
  'bremen': 'werder bremen', 'koln': 'fc koln', 'stuttgart': 'stuttgart',
  'paris sg': 'paris sg', 'paris fc': 'paris fc',
  'sporting cp': 'sp lisbon', 'braga': 'sp braga', 'fc kobenhavn': 'fc copenhagen',
  'maritimo': 'maritimo', 'nacional madeira': 'nacional',
  'estrela amadora': 'estrela', 'go ahead eagles': 'go ahead eagles',
  'sparta rotterdam': 'sparta rotterdam', 'f sittard': 'for sittard',
  'nijmegen': 'nec nijmegen', 'ado den haag': 'den haag',
  'az alkmaar': 'az alkmaar', 'zwolle': 'zwolle',
};
const key = s => { const n = norm(s); return ALIAS[n] || n; };

// ---------- Tippmixpro arak ----------
const tlines = fs.readFileSync(TIPPMIX_CSV, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
const tippmix = [];
for (let i = 1; i < tlines.length; i++) {
  const f = tlines[i].split(';');
  const m = (f[0] || '').trim();
  // A meccsnev "Hazai-Vendeg". Van csapatnev kotojellel (Ararat-Armenia,
  // Eszak-Macedonia, Bosznia-Hercegovina), ezert NEM elso kotojelnel vagunk:
  // megprobaljuk minden lehetseges vagast, es a fixtures dont.
  const num = v => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) && n > 1 ? n : null; };
  tippmix.push({
    raw: m,
    h2h: [num(f[1]), num(f[2]), num(f[3])],
    ou: [num(f[4]), num(f[5])],
  });
}

// ---------- fixtures.csv ----------
const flines = fs.readFileSync(FIXTURES, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
const head = flines[0].split(',').map(h => h.trim());
const col = {}; head.forEach((h, i) => { if (col[h] === undefined) col[h] = i; });
const fixtures = [];
for (let i = 1; i < flines.length; i++) {
  const f = flines[i].split(',');
  const g = n => { if (col[n] === undefined) return null; const v = Number(f[col[n]]); return Number.isFinite(v) && v > 1 ? v : null; };
  const home = (f[col['HomeTeam']] || '').trim(), away = (f[col['AwayTeam']] || '').trim();
  if (!home || !away) continue;
  fixtures.push({
    div: (f[col['Div']] || '').trim(), date: (f[col['Date']] || '').trim(),
    home, away, kh: key(home), ka: key(away),
    avg: [g('AvgH'), g('AvgD'), g('AvgA')],
    max: [g('MaxH'), g('MaxD'), g('MaxA')],
    ouAvg: [g('Avg>2.5'), g('Avg<2.5')],
    ouMax: [g('Max>2.5'), g('Max<2.5')],
  });
}
console.log(`Tippmixpro sorok: ${tippmix.length}   fixtures.csv meccsek: ${fixtures.length}\n`);

// ---------- parositas ----------
// Minden lehetseges kotojel-vagast kiprobalunk, es azt fogadjuk el, amelyik
// mindket oldalon illeszkedik egy fixtures sorra. Igy a kotojeles csapatnevek
// (Ararat-Armenia, Bosznia-Hercegovina) sem torik el a parositast.
const fixByPair = {};
for (const fx of fixtures) fixByPair[fx.kh + '|' + fx.ka] = fx;

const pairs = [];
const unmatched = [];
for (const t of tippmix) {
  let found = null;
  const parts = t.raw.split('-');
  for (let cut = 1; cut < parts.length && !found; cut++) {
    const h = parts.slice(0, cut).join('-').trim();
    const a = parts.slice(cut).join('-').trim();
    if (!h || !a) continue;
    const cand = fixByPair[key(h) + '|' + key(a)];
    if (cand) found = { fx: cand, h, a };
  }
  if (!found) { unmatched.push(t.raw); continue; }
  pairs.push({ ...t, fx: found.fx, home: found.h, away: found.a });
}
console.log(`Parositva: ${pairs.length} meccs`);
console.log(`Nem parositott: ${unmatched.length}`);
if (unmatched.length) console.log('  ' + unmatched.slice(0, 40).join('\n  ') + (unmatched.length > 40 ? `\n  ... es meg ${unmatched.length - 40}` : ''));

// ---------- adatpontok ----------
// Egy adatpont = egy kimenetel, ahol MINDKET ar megvan.
const pts = [];
for (const p of pairs) {
  for (let k = 0; k < 3; k++) {
    if (p.h2h[k] && p.fx.avg[k]) pts.push({ market: 'h2h', sel: ['home', 'draw', 'away'][k], div: p.fx.div,
      match: p.fx.home + ' v ' + p.fx.away, tippmix: p.h2h[k], avg: p.fx.avg[k], max: p.fx.max[k], ratio: p.h2h[k] / p.fx.avg[k] });
  }
  for (let k = 0; k < 2; k++) {
    if (p.ou[k] && p.fx.ouAvg[k]) pts.push({ market: 'ou', sel: ['over25', 'under25'][k], div: p.fx.div,
      match: p.fx.home + ' v ' + p.fx.away, tippmix: p.ou[k], avg: p.fx.ouAvg[k], max: p.fx.ouMax[k], ratio: p.ou[k] / p.fx.ouAvg[k] });
  }
}
const h2h = pts.filter(p => p.market === 'h2h'), ou = pts.filter(p => p.market === 'ou');
console.log(`\nAdatpontok: ${pts.length}  (1X2: ${h2h.length}, O/U 2.5: ${ou.length})`);
console.log(`A regi kalibracio 20 ponton allt, es kizarolag 1X2 aron.\n`);

// ---------- statisztika ----------
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const f1 = x => (x * 100).toFixed(1);
function bandTable(title, rows, bands) {
  console.log(title);
  console.log('  piaci atlag sav     n     tippmix/atlag    effektiv haircut    atlag tippmix / atlag piac');
  for (const [lo, hi] of bands) {
    const s = rows.filter(r => r.avg >= lo && r.avg < hi);
    if (s.length < 3) continue;
    const r = mean(s.map(x => x.ratio));
    console.log(`  ${(lo.toFixed(1) + '-' + (hi > 90 ? '  ' : hi.toFixed(1))).padEnd(16)} ${String(s.length).padStart(5)}      ${f1(r).padStart(6)}%          ${f1(1 - r).padStart(6)}%           ${mean(s.map(x => x.tippmix)).toFixed(2)} / ${mean(s.map(x => x.avg)).toFixed(2)}`);
  }
  console.log(`  OSSZES           ${String(rows.length).padStart(5)}      ${f1(mean(rows.map(x => x.ratio))).padStart(6)}%          ${f1(1 - mean(rows.map(x => x.ratio))).padStart(6)}%\n`);
}
const BANDS = [[1.0, 1.3], [1.3, 1.6], [1.6, 2.0], [2.0, 2.5], [2.5, 3.2], [3.2, 4.0], [4.0, 5.0], [5.0, 6.0], [6.0, 8.0], [8.0, 100]];
bandTable('1) 1X2 PIAC', h2h, BANDS);
bandTable('2) OVER/UNDER 2.5 PIAC  (a regi gorbe ezt sosem merte)', ou, BANDS);

// ---------- regresszio ----------
// Sulyozatlan legkisebb negyzetek: ratio = a + b*odds, a mert tartomanyon.
function fit(rows) {
  const n = rows.length;
  const sx = rows.reduce((s, r) => s + r.avg, 0), sy = rows.reduce((s, r) => s + r.ratio, 0);
  const sxx = rows.reduce((s, r) => s + r.avg * r.avg, 0), sxy = rows.reduce((s, r) => s + r.avg * r.ratio, 0);
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const a = (sy - b * sx) / n;
  const mx = sx / n, my = sy / n;
  const sdx = Math.sqrt(rows.reduce((s, r) => s + (r.avg - mx) ** 2, 0) / (n - 1));
  const sdy = Math.sqrt(rows.reduce((s, r) => s + (r.ratio - my) ** 2, 0) / (n - 1));
  const cov = rows.reduce((s, r) => s + (r.avg - mx) * (r.ratio - my), 0) / (n - 1);
  const r = cov / (sdx * sdy);
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  // reziduumok
  const res = rows.map(x => x.ratio - (a + b * x.avg));
  const rmse = Math.sqrt(res.reduce((s, e) => s + e * e, 0) / n);
  return { a, b, r, t, n, rmse, maxAbsRes: Math.max(...res.map(Math.abs)) };
}
console.log('3) LINEARIS ILLESZTES  ratio = a + b * piaci_atlag_odds');
for (const [nm, rows, lo, hi] of [
  ['1X2, teljes tartomany', h2h, 0, 999],
  ['1X2, 1.3-6.0 (a regi gorbe tartomanya)', h2h.filter(r => r.avg >= 1.3 && r.avg <= 6.0), 1.3, 6.0],
  ['O/U 2.5, teljes tartomany', ou, 0, 999],
]) {
  if (rows.length < 5) continue;
  const f = fit(rows);
  console.log(`  ${nm}`);
  console.log(`    ratio = ${f.a.toFixed(4)} ${f.b >= 0 ? '+' : '-'} ${Math.abs(f.b).toFixed(5)} * odds`);
  console.log(`    n=${f.n}  Pearson r=${f.r.toFixed(3)}  t=${f.t.toFixed(2)}  RMSE=${(f.rmse * 100).toFixed(2)}pp  max|reziduum|=${(f.maxAbsRes * 100).toFixed(2)}pp`);
}

// ---------- a REGI gorbe ellenorzese ----------
const oldRatio = o => 1.0469 - 0.01814 * Math.min(6.0, Math.max(1.3, o));
console.log('\n4) A REGI GORBE (1.0469 - 0.01814*odds, 20 ponton, csak 1X2) A VALOS ADATON');
console.log('  piac       n    valos arany   regi gorbe   elteres      regi becsult ar vs valos');
for (const [nm, rows] of [['1X2', h2h], ['O/U', ou]]) {
  for (const [lo, hi] of [[1.0, 1.3], [1.3, 1.6], [1.6, 2.0], [2.0, 2.5], [2.5, 3.2], [3.2, 5.0], [5.0, 100]]) {
    const s = rows.filter(r => r.avg >= lo && r.avg < hi);
    if (s.length < 3) continue;
    const real = mean(s.map(x => x.ratio)), pred = mean(s.map(x => oldRatio(x.avg)));
    console.log(`  ${nm.padEnd(5)} ${(lo + '-' + (hi > 90 ? '' : hi)).padEnd(9)} ${String(s.length).padStart(4)}    ${f1(real).padStart(6)}%      ${f1(pred).padStart(6)}%    ${(pred > real ? '+' : '') + f1(pred - real).padStart(6)}pp   ${mean(s.map(x => x.avg * oldRatio(x.avg))).toFixed(2)} vs ${mean(s.map(x => x.tippmix)).toFixed(2)}`);
  }
}

// ---------- overround ----------
console.log('\n5) OVERROUND: mennyit tart meg a Tippmixpro meccsenkent?');
const orr = [];
for (const p of pairs) {
  if (p.h2h.every(Boolean) && p.fx.avg.every(Boolean)) {
    const t = p.h2h.reduce((s, o) => s + 1 / o, 0), a = p.fx.avg.reduce((s, o) => s + 1 / o, 0);
    orr.push({ t, a, div: p.fx.div, fav: Math.min(...p.fx.avg) });
  }
}
console.log(`  1X2, n=${orr.length}:  Tippmixpro ${f1(mean(orr.map(x => x.t)) - 1)}%   piaci atlag ${f1(mean(orr.map(x => x.a)) - 1)}%`);
const ouOrr = [];
for (const p of pairs) if (p.ou.every(Boolean) && p.fx.ouAvg.every(Boolean))
  ouOrr.push({ t: p.ou.reduce((s, o) => s + 1 / o, 0), a: p.fx.ouAvg.reduce((s, o) => s + 1 / o, 0) });
console.log(`  O/U, n=${ouOrr.length}:  Tippmixpro ${f1(mean(ouOrr.map(x => x.t)) - 1)}%   piaci atlag ${f1(mean(ouOrr.map(x => x.a)) - 1)}%`);

console.log('\n  Ligank1ent (1X2 overround, Tippmixpro):');
const byDiv = {};
for (const o of orr) (byDiv[o.div] = byDiv[o.div] || []).push(o);
for (const [d, s] of Object.entries(byDiv).sort((a, b) => b[1].length - a[1].length)) {
  if (s.length < 3) continue;
  console.log(`    ${d.padEnd(6)} n=${String(s.length).padStart(3)}   Tippmixpro ${f1(mean(s.map(x => x.t)) - 1).padStart(5)}%   piac ${f1(mean(s.map(x => x.a)) - 1).padStart(5)}%`);
}

// ---------- a legjobb elerheto ar ----------
console.log('\n6) TIPPMIXPRO vs A LEGJOBB KONYV (MaxH/D/A) - mennyit hagysz az asztalon?');
const withMax = pts.filter(p => p.max);
for (const [nm, rows] of [['1X2', withMax.filter(p => p.market === 'h2h')], ['O/U', withMax.filter(p => p.market === 'ou')]]) {
  if (rows.length < 5) continue;
  console.log(`  ${nm}: n=${rows.length}  tippmix/legjobb ${f1(mean(rows.map(r => r.tippmix / r.max)))}%   (a legjobb ar ${f1(mean(rows.map(r => r.max / r.tippmix)) - 1)}%-kal tobbet fizet)`);
}

// ---------- kimentes ----------
const out = pts.map(p => ({ market: p.market, sel: p.sel, div: p.div, match: p.match,
  tippmix: p.tippmix, market_avg: p.avg, market_max: p.max, ratio: Math.round(p.ratio * 10000) / 10000 }));
fs.writeFileSync(path.join('tippmix', 'calibration_points_2026-09-13.json'), JSON.stringify(out, null, 1));
console.log(`\nAdatpontok kimentve: data/tippmix/calibration_points_2026-09-13.json (${out.length} pont)`);
