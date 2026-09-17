// A pontozas-valtas (model_prob -> market_prob) ellenorzese az ELES node kodjan.
//
// A buildSlip-et a workflows/Slip Builder.json "Build Response" node-jabol
// olvassuk ki, nem a slip.js-bol - ugyanaz a minta, amit a settle_wf_test.js
// hasznal. A pool a 2026-09-08-i valos slate-pillanatkep.
//
// Amit bizonyit:
//   1. a valtas tenylegesen mas labakat valaszt valos adaton
//   2. minden invariáns tart: szorzat, egy-meccs-egy-lab, veto, ALACSONY, plafon
//   3. a valaszban mutatott "Bejovesi esely" a PIACI valoszinusegekbol jon
//   4. a jointP sosem esik vissza a model_prob-ra hianyzo market_prob eseten
// Futtatas: node scorer_switch_test.js   (a betting-research mappabol)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const WF = path.join(ROOT, 'workflows', 'Slip Builder.json');
const SNAP = path.join(__dirname, 'snapshots', 'bet_slate_2026-09-08T16-10Z.json');

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  HIBA ${name}${extra ? '  -> ' + extra : ''}`); }
};

// --- a buildSlip kinyerese az eles node-bol ---
const wf = JSON.parse(fs.readFileSync(WF, 'utf8'));
const code = wf.nodes.find(n => n.name === 'Build Response').parameters.jsCode;
const start = code.indexOf('function buildSlip');
const endMark = 'return { ok: true, approximate: false, ...best };';
const end = code.indexOf('\n}', code.indexOf(endMark)) + 2;
if (start < 0 || end < 2) throw new Error('Nem talalom a buildSlip-et a node kodjaban');
const buildSlipSrc = code.slice(start, end);
const buildSlip = new Function(buildSlipSrc + '\nreturn buildSlip;')();

// A REGI pontozas ugyanabbol a forrasbol, visszaalakitva - igy az osszehasonlitas
// tenyleg csak a pontozasrol szol, nem ket kulon kodrol.
const oldSrc = buildSlipSrc
  .replace(/const pOf = l => \(Number\.isFinite\(l\.market_prob\) && l\.market_prob > 0\)\n\s*\? l\.market_prob\n\s*: \(l\.tippmix_odds > 1 \? 1 \/ l\.tippmix_odds : 0\);/,
           'const pOf = l => l.model_prob;')
  .replace('cand.forEach(l => { l._q = pOf(l) - (l.news_flag === \'warn\' ? 0.03 : 0); });',
           'const confBonus = c => (c === \'MAGAS\' ? 0.06 : c === \'KOZEPES\' ? 0.02 : 0);\n  cand.forEach(l => { l._q = l.model_prob + confBonus(l.confidence) - (l.news_flag === \'warn\' ? 0.03 : 0); });');
const buildSlipOld = new Function(oldSrc + '\nreturn buildSlip;')();

console.log('=== 1. A NODE KODJA KINYERHETO ES FUT ===');
check('buildSlip kinyerve az eles node-bol', typeof buildSlip === 'function');
check('a regi pontozas is elokeszult (osszehasonlitashoz)', typeof buildSlipOld === 'function');
check('pOf jelen van az uj kodban', /const pOf = l =>/.test(buildSlipSrc));
check('nincs dontesi model_prob a buildSlip-ben',
  !buildSlipSrc.split('\n').some(l => /model_prob/.test(l) && !/^\s*\/\//.test(l)));

// --- a valos slate betoltese ---
const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
const rows = Array.isArray(snap) ? snap : (snap.data || snap.rows || []);
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const pool = rows.map(r => ({
  ...r,
  model_prob: num(r.model_prob), market_prob: num(r.market_prob),
  tippmix_odds: num(r.tippmix_odds), market_avg_odds: num(r.market_avg_odds),
})).filter(l => l.tippmix_odds > 1);

console.log(`\n=== 2. VALOS SLATE (2026-09-08, ${pool.length} lab) ===`);
check('a pillanatkep betoltheto es van benne lab', pool.length > 50, `${pool.length} lab`);
check('van market_prob minden labon', pool.every(l => l.market_prob > 0));
const events = new Set(pool.map(l => l.event_id));
check('tobb meccs van a poolban', events.size >= 10, `${events.size} meccs`);

// --- a ket pontozas osszevetese valos adaton ---
console.log('\n=== 3. A VALTAS MAS LABAKAT VALASZT (valos adaton) ===');
console.log('  cel     REGI (model_prob)                       UJ (market_prob)                        azonos?');
let differed = 0, targets = 0;
for (const T of [3, 5, 10, 20, 50, 100]) {
  const a = buildSlipOld(pool.map(l => ({ ...l })), { target: T });
  const b = buildSlip(pool.map(l => ({ ...l })), { target: T });
  if (!a.ok || !b.ok) { console.log(`  ${(T + 'x').padEnd(7)} egyik nem adott megoldast`); continue; }
  targets++;
  const key = r => r.legs.map(l => l.leg_id).sort().join('|');
  const same = key(a) === key(b);
  if (!same) differed++;
  const fmt = r => `${r.n} lab @${r.prod.toFixed(2)}x esely ${(r.jointP * 100).toFixed(2)}%`;
  console.log(`  ${(T + 'x').padEnd(7)} ${fmt(a).padEnd(39)} ${fmt(b).padEnd(39)} ${same ? 'igen' : 'NEM'}`);
}
check('a valtas valos adaton tobb celnal mas szelvenyt ad', differed >= 2, `${differed}/${targets} celnal ter el`);

// --- invariansok az UJ pontozassal ---
console.log('\n=== 4. INVARIANSOK AZ UJ PONTOZASSAL ===');
for (const T of [3, 5, 10, 20, 50, 100, 200]) {
  const r = buildSlip(pool.map(l => ({ ...l })), { target: T, maxLegs: 6 });
  if (!r.ok) { check(`${T}x megoldas`, false, r.reason); continue; }
  const prod = r.legs.reduce((a, l) => a * l.tippmix_odds, 1);
  const ids = r.legs.map(l => l.event_id);
  const jp = r.legs.reduce((a, l) => a * l.market_prob, 1);
  const top = Math.max(...r.legs.map(l => l.tippmix_odds));
  check(`${T}x szorzat egyezik a prod mezovel`, Math.abs(prod - r.prod) < 1e-6, `${prod} vs ${r.prod}`);
  check(`${T}x egy meccs = egy lab`, new Set(ids).size === ids.length);
  check(`${T}x nincs vetozott lab`, r.legs.every(l => l.news_flag !== 'veto'));
  check(`${T}x nincs ALACSONY lab`, r.legs.every(l => l.confidence !== 'ALACSONY'));
  check(`${T}x jointP = PIACI valoszinusegek szorzata`, Math.abs(jp - r.jointP) < 1e-9,
    `piaci ${jp.toFixed(6)} vs jointP ${r.jointP.toFixed(6)}`);
  const modelJp = r.legs.reduce((a, l) => a * l.model_prob, 1);
  check(`${T}x jointP NEM a modell szorzata`, Math.abs(modelJp - r.jointP) > 1e-9 || Math.abs(modelJp - jp) < 1e-9,
    `modell ${modelJp.toFixed(6)}`);
  check(`${T}x plafon: @5 folotti lab csak feloldva`, top <= 5.0 || r.capped_relaxed === true,
    `legdragabb @${top.toFixed(2)}, relaxed=${r.capped_relaxed}`);
}

// --- hianyzo market_prob: 1/odds, sosem a modell ---
console.log('\n=== 5. HIANYZO market_prob -> 1/odds, SOSEM a model_prob ===');
const mk = (id, mp, kp, odds) => ({ leg_id: id, event_id: id, match_name: 'Teszt ' + id,
  league: 'Teszt', market: 'h2h', selection: 'home', label: '1', model_prob: mp,
  market_prob: kp, tippmix_odds: odds, confidence: 'KOZEPES', news_flag: 'ok', news_note: '' });
const noMkt = [mk('D', 0.90, 0, 2.00), mk('E', 0.10, 0, 2.00)];
const rn = buildSlip(noMkt, { target: 4.0, maxLegs: 2, minLegs: 2 });
check('hianyzo market_prob mellett is van megoldas', rn.ok, rn.reason);
check('jointP = 1/2.00 x 1/2.00 = 0.25', rn.ok && Math.abs(rn.jointP - 0.25) < 1e-9,
  rn.ok ? String(rn.jointP) : '-');
check('jointP NEM 0.90 x 0.10 = 0.09 (a modelle)', !rn.ok || Math.abs(rn.jointP - 0.09) > 1e-9);

// --- a csali-teszt: a modell kedvencet elutasitja ---
console.log('\n=== 6. CSALI: a modell kedvenceet elutasitja ===');
const clash = [mk('A', 0.90, 0.40, 2.00), mk('B', 0.30, 0.55, 2.00), mk('C', 0.31, 0.54, 2.00)];
const rc = buildSlip(clash, { target: 4.0, maxLegs: 2, minLegs: 2 });
const chosen = rc.ok ? rc.legs.map(l => l.leg_id).sort().join('') : 'NINCS';
check('a ket legjobb PIACI valoszinuseget valasztja (BC)', chosen === 'BC', `valasztott: ${chosen}`);
const rcOld = buildSlipOld(clash.map(l => ({ ...l })), { target: 4.0, maxLegs: 2, minLegs: 2 });
const chosenOld = rcOld.ok ? rcOld.legs.map(l => l.leg_id).sort().join('') : 'NINCS';
check('a regi pontozas ugyanitt a modell csalijat valasztotta', chosenOld.includes('A'),
  `regi valasztott: ${chosenOld}`);

// --- ures / szelsoseges bemenet ---
console.log('\n=== 7. SZELSOSEGES BEMENET ===');
check('ures pool -> no_candidates', buildSlip([], { target: 10 }).reason === 'no_candidates');
check('csak ALACSONY -> no_candidates',
  buildSlip(pool.filter(l => l.confidence === 'ALACSONY'), { target: 10 }).reason === 'no_candidates');
check('csak vetozott -> no_candidates',
  buildSlip(pool.filter(l => l.news_flag === 'veto'), { target: 10 }).reason === 'no_candidates');
const one = buildSlip(pool.map(l => ({ ...l })), { target: 1000000, maxLegs: 3 });
check('elerhetetlen cel -> nem dob kivetelt', typeof one === 'object' && one !== null);

console.log(`\n=== OSSZESEN: ${pass} OK, ${fail} HIBA ===`);
if (fail) process.exit(1);
