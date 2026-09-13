// Mit valtoztat az uj tippmixRatio a VALOS szelvenyeken?
//
// A 2026-09-08-i slate-pillanatkep market_avg_odds mezojebol ujraszamoljuk a
// tippmix_odds-ot mindket gorbevel, majd lefuttatjuk az ELES buildSlip-et.
// Mindket kod a telepitett workflow JSON-bol jon, nem masolatbol.
//
// Amit merunk:
//   1. valtozik-e a szelveny osszetetele
//   2. valtozik-e az optimalis labszam (ez volt a nyitott kerdes)
//   3. a @5.00 plafon indoklasa all-e meg
// Futtatas: node ratio_impact_test.js   (a betting-research mappabol)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SLATE_WF = path.join(ROOT, 'workflows', 'Betting Slate Builder.json');
const SLIP_WF = path.join(ROOT, 'workflows', 'Slip Builder.json');
const SNAP = path.join(__dirname, 'snapshots', 'bet_slate_2026-09-08T16-10Z.json');

let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  HIBA ${n}${e ? '  -> ' + e : ''}`); } };
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

// --- az eles tippmixRatio ---
const slateCode = JSON.parse(fs.readFileSync(SLATE_WF, 'utf8')).nodes.find(n => n.name === 'Generate Legs').parameters.jsCode;
const s0 = slateCode.indexOf('const tippmixRatio = (odds, market)');
const newRatio = new Function(slateCode.slice(s0, slateCode.indexOf('\n    };', s0) + 7) + '\nreturn tippmixRatio;')();
const oldRatio = o => 1.0469 - 0.01814 * Math.min(6.0, Math.max(1.3, o));

// --- az eles buildSlip ---
const slipCode = JSON.parse(fs.readFileSync(SLIP_WF, 'utf8')).nodes.find(n => n.name === 'Build Response').parameters.jsCode;
const b0 = slipCode.indexOf('function buildSlip');
const b1 = slipCode.indexOf('\n}', slipCode.indexOf('return { ok: true, approximate: false, ...best };')) + 2;
const buildSlip = new Function(slipCode.slice(b0, b1) + '\nreturn buildSlip;')();

// --- a slate ujraarazva ---
const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
const raw = Array.isArray(snap) ? snap : (snap.data || snap.rows || []);
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const reprice = ratioFn => raw.map(r => {
  const avg = num(r.market_avg_odds);
  return { ...r, model_prob: num(r.model_prob), market_prob: num(r.market_prob),
    market_avg_odds: avg,
    tippmix_odds: Math.round(avg * ratioFn(avg, r.market) * 100) / 100 };
}).filter(l => l.tippmix_odds > 1);
const poolOld = reprice(oldRatio), poolNew = reprice(newRatio);

console.log('=== 1. AZ ARAK VALTOZASA A VALOS SLATE-EN ===');
console.log(`  145 lab ujraarazva a market_avg_odds mezobol`);
const diffs = poolNew.map((l, i) => l.tippmix_odds / poolOld[i].tippmix_odds - 1);
console.log(`  atlagos arvaltozas: ${(mean(diffs) * 100).toFixed(2)}%   max ${(Math.max(...diffs) * 100).toFixed(1)}%   min ${(Math.min(...diffs) * 100).toFixed(1)}%`);
for (const mk of ['h2h', 'totals']) {
  const s = poolNew.map((l, i) => ({ mk: l.market, d: l.tippmix_odds / poolOld[i].tippmix_odds - 1 })).filter(x => x.mk === mk);
  if (s.length) console.log(`    ${mk.padEnd(7)} n=${String(s.length).padStart(3)}  atlag ${(mean(s.map(x => x.d)) * 100).toFixed(2)}%`);
}
check('az uj arak magasabbak (a regi gorbe alabecsult)', mean(diffs) > 0, `${(mean(diffs) * 100).toFixed(2)}%`);
check('egyetlen ar sem valtozik 15%-nal tobbet', Math.max(...diffs.map(Math.abs)) < 0.15);

console.log('\n=== 2. A SZELVENYEK VALTOZASA ===');
console.log('  cel     REGI ar                              UJ ar                                azonos labak?');
let changed = 0, tried = 0;
for (const T of [3, 5, 10, 20, 50, 100]) {
  const a = buildSlip(poolOld.map(l => ({ ...l })), { target: T });
  const b = buildSlip(poolNew.map(l => ({ ...l })), { target: T });
  if (!a.ok || !b.ok) { console.log(`  ${(T + 'x').padEnd(7)} egyik nem adott megoldast`); continue; }
  tried++;
  const key = r => r.legs.map(l => l.leg_id).sort().join('|');
  const same = key(a) === key(b);
  if (!same) changed++;
  const fmt = r => `${r.n} lab @${r.prod.toFixed(2)}x esely ${(r.jointP * 100).toFixed(2)}%`;
  console.log(`  ${(T + 'x').padEnd(7)} ${fmt(a).padEnd(36)} ${fmt(b).padEnd(36)} ${same ? 'igen' : 'NEM'}`);
}
console.log(`  -> ${changed}/${tried} celnal valtozott a szelveny`);

console.log('\n=== 3. AZ OPTIMALIS LABSZAM (a nyitott kerdes) ===');
console.log('  A composition_sensitivity.js szerint a regi gorbevel 20x+ celnal');
console.log('  TOBB lab lett volna jobb. Az uj, valos arakon alapulo gorbevel:');
const { loadAll, devig } = require('./odds_loader.js');
// A loadAll a munkakonyvtarbol olvassa a CSV-ket, ezert atvaltunk a data/-ra,
// hogy a teszt barhonnan futtathato legyen.
const cwd0 = process.cwd();
process.chdir(path.join(__dirname, 'data'));
const all = loadAll().filter(m => m.psc && m.avgc && m.ou_pc && m.ou_avgc);
process.chdir(cwd0);
if (!all.length) throw new Error('Nincs betoltott meccs - hianyoznak a CSV-k a data/ mappabol?');
function evCurve(ratioFn) {
  const rows = [];
  for (const m of all) {
    const f = devig(m.psc).probs, fo = devig(m.ou_pc).probs;
    for (let k = 0; k < 3; k++) { const ot = m.avgc[k] * ratioFn(m.avgc[k], 'h2h'); rows.push({ ot, ev: f[k] * ot - 1 }); }
    for (let k = 0; k < 2; k++) { const ot = m.ou_avgc[k] * ratioFn(m.ou_avgc[k], 'totals'); rows.push({ ot, ev: fo[k] * ot - 1 }); }
  }
  const bins = []; for (let o = 1.1; o < 6.0; o += 0.2) bins.push([o, o + 0.2]); bins.push([6, 8], [8, 12]);
  const p = bins.map(([lo, hi]) => { const s = rows.filter(r => r.ot >= lo && r.ot < hi); return { mid: (lo + hi) / 2, ev: s.length >= 40 ? mean(s.map(x => x.ev)) : null }; }).filter(x => x.ev !== null);
  return o => { if (o <= p[0].mid) return p[0].ev; if (o >= p[p.length - 1].mid) return p[p.length - 1].ev;
    for (let i = 1; i < p.length; i++) if (o <= p[i].mid) { const x = p[i - 1], y = p[i]; return x.ev + (y.ev - x.ev) * (o - x.mid) / (y.mid - x.mid); } };
}
const evOld = evCurve(oldRatio), evNew = evCurve(newRatio);
console.log('  cel    legjobb labszam REGI gorbevel   legjobb labszam UJ gorbevel');
let fewestHolds = true;
const bestByTarget = [];
for (const T of [5, 10, 20, 50]) {
  let bo = null, bn = null;
  for (let n = 2; n <= 6; n++) {
    const o = Math.pow(T, 1 / n); if (o < 1.2 || o > 12) continue;
    const vo = Math.pow(1 + evOld(o), n), vn = Math.pow(1 + evNew(o), n);
    if (!bo || vo > bo.v) bo = { v: vo, n }; if (!bn || vn > bn.v) bn = { v: vn, n };
  }
  // A buildSlip a legkisebb elerheto labszamot valasztja (2-tol). A szabaly
  // akkor helyes, ha az optimum is a legkisebb vegen van, nem 4+ labnal.
  if (bn.n > 3) fewestHolds = false;
  bestByTarget.push({ T, old: bo.n, nw: bn.n });
  console.log(`  ${String(T + 'x').padEnd(6)} ${String(bo.n).padStart(10)} lab (${(bo.v * 100).toFixed(1)}%)          ${String(bn.n).padStart(10)} lab (${(bn.v * 100).toFixed(1)}%)`);
}
check('a legkevesebb-lab szabaly az uj gorbevel helyes (optimum 2-3 lab minden celnal)',
  fewestHolds, 'optimum: ' + bestByTarget.map(x => `${x.T}x=${x.nw}`).join(', '));
check('a regi gorbe 20x+ celnal tenyleg tobb labat javasolt volna',
  bestByTarget.some(x => x.T >= 20 && x.old > x.nw),
  'regi: ' + bestByTarget.map(x => `${x.T}x=${x.old}`).join(', '));

console.log('\n=== 4. A @5.00 PLAFON INDOKLASA ===');
console.log('  A plafon azert van, mert a magas oddsu labak dragak. Uj arakkal:');
const bands = [[1.3, 2.0], [2.0, 3.2], [3.2, 5.0], [5.0, 8.0], [8.0, 12]];
for (const [lo, hi] of bands) {
  const rows = [];
  for (const m of all) { const f = devig(m.psc).probs;
    for (let k = 0; k < 3; k++) { const a = m.avgc[k]; if (a >= lo && a < hi) { const ot = a * newRatio(a, 'h2h'); rows.push(f[k] * ot - 1); } } }
  if (rows.length >= 50) console.log(`    1X2 ${(lo + '-' + hi).padEnd(9)} n=${String(rows.length).padStart(5)}  EV ${(mean(rows) * 100).toFixed(2)}%`);
}
const above5 = [], below5 = [];
for (const m of all) { const f = devig(m.psc).probs;
  for (let k = 0; k < 3; k++) { const a = m.avgc[k], ot = a * newRatio(a, 'h2h');
    (ot > 5 ? above5 : below5).push(f[k] * ot - 1); } }
check('a @5 feletti labak dragabbak, mint az alattiak (a plafon indokolt)',
  mean(above5) < mean(below5), `felette ${(mean(above5) * 100).toFixed(2)}% vs alatta ${(mean(below5) * 100).toFixed(2)}%`);

console.log('\n=== 5. INVARIANSOK AZ UJ ARAKKAL ===');
for (const T of [3, 5, 10, 20, 50, 100]) {
  const r = buildSlip(poolNew.map(l => ({ ...l })), { target: T, maxLegs: 6 });
  if (!r.ok) { check(`${T}x megoldas`, false, r.reason); continue; }
  const prod = r.legs.reduce((a, l) => a * l.tippmix_odds, 1);
  check(`${T}x szorzat egyezik`, Math.abs(prod - r.prod) < 1e-6);
  check(`${T}x egy meccs = egy lab`, new Set(r.legs.map(l => l.event_id)).size === r.legs.length);
  const top = Math.max(...r.legs.map(l => l.tippmix_odds));
  check(`${T}x plafon tartva vagy feloldva jelezve`, top <= 5.0 || r.capped_relaxed === true, `@${top.toFixed(2)}`);
}

console.log(`\n=== OSSZESEN: ${pass} OK, ${fail} HIBA ===`);
if (fail) process.exit(1);
