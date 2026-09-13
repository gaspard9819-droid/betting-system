// A tippmixRatio() tesztje az ELES Generate Legs node kodjan.
//
// A fuggvenyt a workflows/Betting Slate Builder.json-bol olvassuk ki, nem
// masolatbol - ugyanaz a minta, amit a scorer_switch_test.js hasznal.
//
// Amit bizonyit:
//   1. a gorbe a mert adatokra illeszkedik, es jobban, mint a regi
//   2. piaconkent kulon dolgozik, es a ket irany tenyleg ellentetes
//   3. a levagas mukodik - nincs extrapolacio a mert tartomanyon kivul
//   4. semmilyen bemenetre nem ad ertelmetlen arat
// Futtatas: node tippmix_ratio_test.js   (a betting-research mappabol)
const fs = require('fs');
const path = require('path');

const WF = path.join(__dirname, '..', '..', 'workflows', 'Betting Slate Builder.json');
const PTS = path.join(__dirname, 'data', 'tippmix', 'calibration_points_2026-09-13.json');

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  HIBA ${name}${extra ? '  -> ' + extra : ''}`); }
};
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const f2 = x => (x * 100).toFixed(2);

// --- a fuggveny kinyerese az eles node-bol ---
const wf = JSON.parse(fs.readFileSync(WF, 'utf8'));
const code = wf.nodes.find(n => n.name === 'Generate Legs').parameters.jsCode;
const start = code.indexOf('const tippmixRatio = (odds, market)');
if (start < 0) throw new Error('Nem talalom a tippmixRatio-t (piac-tudatos alakban) a node kodjaban');
const end = code.indexOf('\n    };', start) + 7;
const src = code.slice(start, end);
const tippmixRatio = new Function(src + '\nreturn tippmixRatio;')();

console.log('=== 1. A FUGGVENY KINYERHETO ES PIAC-TUDATOS ===');
check('tippmixRatio kinyerve az eles node-bol', typeof tippmixRatio === 'function');
check('ket parametert vesz (odds, market)', tippmixRatio.length === 2);
check('h2h es totals eltero erteket ad @2.00-nal',
  Math.abs(tippmixRatio(2.0, 'h2h') - tippmixRatio(2.0, 'totals')) > 0.001,
  `h2h ${tippmixRatio(2.0, 'h2h').toFixed(4)} vs totals ${tippmixRatio(2.0, 'totals').toFixed(4)}`);
check('a hivas helyen at is adjuk a piacot', /tippmixRatio\(d\.avg\[k\], market\)/.test(code));

console.log('\n=== 2. A KET PIAC ELLENTETES IRANYBA DOL ===');
const h2hSlope = tippmixRatio(4.0, 'h2h') - tippmixRatio(1.5, 'h2h');
const ouSlope = tippmixRatio(3.0, 'totals') - tippmixRatio(1.5, 'totals');
check('1X2 lejt (hosszu oddson kevesebbet fizet)', h2hSlope < 0, `valtozas ${f2(h2hSlope)}pp`);
check('O/U emelkedik (hosszu oddson tobbet fizet)', ouSlope > 0, `valtozas ${f2(ouSlope)}pp`);

console.log('\n=== 3. ILLESZKEDES A MERT ADATOKRA ===');
const pts = JSON.parse(fs.readFileSync(PTS, 'utf8'));
// A meres a football-data atlaga ellen keszult; a gorbe a slate referenciajara
// szol. A korrekcio ugyanaz, amit a tippmix_refit.js hasznalt.
const REF = { h2h: 1.0130, ou: 1.0048 };
const oldRatio = o => 1.0469 - 0.01814 * Math.min(6.0, Math.max(1.3, o));
for (const [nm, mk, wfMarket] of [['1X2', 'h2h', 'h2h'], ['O/U', 'ou', 'totals']]) {
  const rows = pts.filter(p => p.market === mk).map(p => ({ o: p.market_avg, r: p.ratio / REF[mk] }));
  const resNew = rows.map(x => x.r - tippmixRatio(x.o, wfMarket));
  const resOld = rows.map(x => x.r - oldRatio(x.o));
  const rmse = a => Math.sqrt(a.reduce((s, e) => s + e * e, 0) / a.length);
  console.log(`  ${nm}: n=${rows.length}  uj RMSE ${f2(rmse(resNew))}pp (torzitas ${f2(mean(resNew))}pp)   regi RMSE ${f2(rmse(resOld))}pp (torzitas ${f2(mean(resOld))}pp)`);
  check(`${nm}: az uj gorbe jobban illeszkedik a reginel`, rmse(resNew) < rmse(resOld),
    `uj ${f2(rmse(resNew))} vs regi ${f2(rmse(resOld))}`);
  check(`${nm}: az uj gorbe torzitasa 1pp alatt`, Math.abs(mean(resNew)) < 0.01, `${f2(mean(resNew))}pp`);
}

console.log('\n=== 4. LEVAGAS - NINCS EXTRAPOLACIO ===');
check('1X2 lapos 1.1 alatt', tippmixRatio(1.01, 'h2h') === tippmixRatio(1.1, 'h2h'));
check('1X2 lapos 12.0 felett', tippmixRatio(50, 'h2h') === tippmixRatio(12.0, 'h2h'));
check('O/U lapos 1.3 alatt', tippmixRatio(1.05, 'totals') === tippmixRatio(1.3, 'totals'));
check('O/U lapos 3.2 felett', tippmixRatio(10, 'totals') === tippmixRatio(3.2, 'totals'));
check('O/U a levagas felett nem megy 107% fole', tippmixRatio(100, 'totals') < 1.07,
  f2(tippmixRatio(100, 'totals')) + '%');

console.log('\n=== 5. SEMMILYEN BEMENETRE NEM AD ERTELMETLEN ARAT ===');
let bad = [];
for (const mk of ['h2h', 'totals', 'btts', undefined]) {
  for (let o = 1.01; o <= 60; o += 0.13) {
    const r = tippmixRatio(o, mk);
    if (!Number.isFinite(r) || r < 0.80 || r > 1.15) bad.push(`${mk}@${o.toFixed(2)}=${r.toFixed(3)}`);
    const price = o * r;
    if (price <= 1.0 && o > 1.05) bad.push(`ar<=1: ${mk}@${o.toFixed(2)} -> ${price.toFixed(3)}`);
  }
}
check('minden arany 0.80-1.15 kozott, minden ar > 1.0', bad.length === 0, bad.slice(0, 5).join(', '));
check('ismeretlen piac az 1X2 gorbet kapja (biztonsagos alap)',
  tippmixRatio(2.5, 'btts') === tippmixRatio(2.5, 'h2h'));

console.log('\n=== 6. A BECSULT AR A VALOS TIPPMIX ARHOZ KEPEST ===');
console.log('  piac   sav          n    becsult/valos    (100% = tokeletes)');
for (const [nm, mk, wfMarket] of [['1X2', 'h2h', 'h2h'], ['O/U', 'ou', 'totals']]) {
  for (const [lo, hi] of [[1.0, 1.6], [1.6, 2.5], [2.5, 4.0], [4.0, 100]]) {
    const s = pts.filter(p => p.market === mk && p.market_avg >= lo && p.market_avg < hi);
    if (s.length < 3) continue;
    // becsult ar a slate referenciajaval: market_avg * REF * ratio
    const est = mean(s.map(p => p.market_avg * REF[mk] * tippmixRatio(p.market_avg, wfMarket) / p.tippmix));
    console.log(`  ${nm.padEnd(6)} ${(lo + '-' + (hi > 90 ? '' : hi)).padEnd(12)} ${String(s.length).padStart(3)}     ${f2(est).padStart(6)}%`);
    check(`${nm} ${lo}-${hi}: a becsult ar 5%-on belul`, Math.abs(est - 1) < 0.05, f2(est) + '%');
  }
}

console.log(`\n=== OSSZESEN: ${pass} OK, ${fail} HIBA ===`);
if (fail) process.exit(1);
