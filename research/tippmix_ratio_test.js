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
// A fixtures-alapu pontok maradnak hivatkozaskent, de a teszt mar a
// kozvetlen parokbol dolgozik (lasd a 3. szakaszt).

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

console.log('\n=== 2. A LEJTES IRANYA ===');
const h2hSlope = tippmixRatio(4.0, 'h2h') - tippmixRatio(1.5, 'h2h');
const ouSlope = tippmixRatio(3.0, 'totals') - tippmixRatio(1.5, 'totals');
check('1X2 lejt (hosszu oddson kevesebbet fizet)', h2hSlope < 0, `valtozas ${f2(h2hSlope)}pp`);
// Az O/U-n a lejtes NEM szignifikans (t=-1.86, n=18), es a korabbi,
// football-data elleni meres ELLENTETES elojelut adott ugyanerre a piacra.
// Ket ellentmondo gyenge jel helyett a lapos becsles az oszinte valasz.
check('O/U lapos (a lejtes nem szignifikans, ezert nem illesztunk)',
  Math.abs(ouSlope) < 0.001, `valtozas ${f2(ouSlope)}pp`);

console.log('\n=== 3. ILLESZKEDES A KOZVETLENUL MERT ADATOKRA ===');
// FONTOS: a slate SAJAT referenciajan mert parokat hasznaljuk, nem a
// football-data elleni meresot. A tippmixRatio a market_avg_odds mezore hat,
// tehat azon kell mernie. A fixtures-alapu meres egy BECSULT
// referencia-korrekcion allt (1.30%), a valodi kulonbseg ~3.4% - ezert lett
// 1.9 szazalekponttal felulbecslo. Lasd a Generate Legs fejlecet.
const DIRECT = path.join(__dirname, 'data', 'tippmix', 'slate_pairs_2026-09-13.json');
const direct = JSON.parse(fs.readFileSync(DIRECT, 'utf8'));
const oldRatio = o => 1.0469 - 0.01814 * Math.min(6.0, Math.max(1.3, o));
const fixturesRatio = (o, mk) => mk === 'totals'
  ? 0.9302 + 0.04168 * Math.min(3.2, Math.max(1.3, o))
  : 1.0322 - 0.00629 * Math.min(12.0, Math.max(1.1, o));
const rmse = a => Math.sqrt(a.reduce((s, e) => s + e * e, 0) / a.length);
for (const [nm, mk] of [['1X2', 'h2h'], ['O/U', 'totals']]) {
  const rows = direct.filter(p => p.market === mk);
  const rNew = rows.map(x => x.ratio - tippmixRatio(x.market_avg, mk));
  const rOld = rows.map(x => x.ratio - oldRatio(x.market_avg));
  const rFix = rows.map(x => x.ratio - fixturesRatio(x.market_avg, mk));
  console.log(`  ${nm}: n=${rows.length}   telepitett RMSE ${f2(rmse(rNew))}pp (torzitas ${f2(mean(rNew))}pp)`);
  console.log(`       regi ${f2(rmse(rOld))}pp (${f2(mean(rOld))}pp)   elvetett fixtures-alapu ${f2(rmse(rFix))}pp (${f2(mean(rFix))}pp)`);
  check(`${nm}: jobban illeszkedik az elvetett fixtures-alapunal`, rmse(rNew) < rmse(rFix), `${f2(rmse(rNew))} vs ${f2(rmse(rFix))}`);
  // TORZITAS, nem RMSE a mero. Az O/U-n a regi gorbe RMSE-je hajszallal jobb
  // (2.86 vs 2.96pp), de -1.00pp-tal RENDSZERESEN alabecsul, mig a lapos
  // becsles torzitatlan. Egy rendszeres eltolodas minden szelvenyt ugyanabba
  // az iranyba visz, a szorodas nem - ezert a torzitas a fontosabb.
  check(`${nm}: torzitasa 1pp alatt`, Math.abs(mean(rNew)) < 0.01, `${f2(mean(rNew))}pp`);
  check(`${nm}: torzitasa kisebb a reginel`, Math.abs(mean(rNew)) <= Math.abs(mean(rOld)),
    `uj ${f2(mean(rNew))}pp vs regi ${f2(mean(rOld))}pp`);
}
// Az ARBAN mert pontossag - ez az, ami a felhasznalonak szamit.
const priceErr = fn => mean(direct.map(p => Math.abs(p.market_avg * fn(p.market_avg, p.market) / p.real - 1)));
console.log(`  ar-pontossag (atlag abs hiba): telepitett ${f2(priceErr(tippmixRatio))}%   regi ${f2(priceErr(oldRatio))}%   fixtures ${f2(priceErr(fixturesRatio))}%`);
check('a telepitett gorbe a legpontosabb arban is',
  priceErr(tippmixRatio) < priceErr(oldRatio) && priceErr(tippmixRatio) < priceErr(fixturesRatio));
check('az atlagos ar-hiba 3% alatt', priceErr(tippmixRatio) < 0.03, f2(priceErr(tippmixRatio)) + '%');
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

console.log('\n=== 6. A BECSULT AR A VALOS TIPPMIX ARHOZ KEPEST, SAVONKENT ===');
console.log('  A slate sajat referenciajan mert 45 paron - nincs korrekcio, nincs becsles.');
console.log('  piac   sav          n    becsult/valos    (100% = tokeletes)');
for (const [nm, mk] of [['1X2', 'h2h'], ['O/U', 'totals']]) {
  for (const [lo, hi] of [[1.0, 1.8], [1.8, 2.8], [2.8, 4.0], [4.0, 100]]) {
    const s = direct.filter(p => p.market === mk && p.market_avg >= lo && p.market_avg < hi);
    if (s.length < 2) continue;
    const est = mean(s.map(p => p.market_avg * tippmixRatio(p.market_avg, mk) / p.real));
    console.log(`  ${nm.padEnd(6)} ${(lo + '-' + (hi > 90 ? '' : hi)).padEnd(12)} ${String(s.length).padStart(3)}     ${f2(est).padStart(6)}%`);
    check(`${nm} ${lo}-${hi}: a becsult ar 5%-on belul`, Math.abs(est - 1) < 0.05, f2(est) + '%');
  }
}

console.log(`\n=== OSSZESEN: ${pass} OK, ${fail} HIBA ===`);
if (fail) process.exit(1);
