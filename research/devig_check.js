// Szamit-e, hogyan de-viggelunk? A market_prob kalibracioja savonkent.
//
// MIERT KESZULT: 2026-09-15-en atneztunk hat nyilvanos fogadasi repot. Ketto
// (Reymes/football-match-prediction, zakariae-boui/value-betting-scanner) azt
// allitotta, hogy a multiplikativ de-vig (p_i / osszeg) szisztematikusan
// torzit a favourite-longshot bias miatt, es a POWER de-vig jobb - az a k
// kitevo, amire sum(p_i^k) = 1. Ez ellenorizheto allitas volt, tehat
// leellenoriztuk a sajat adatunkon, es nem hittuk el csak azert, mert ket
// fuggetlen repo ugyanazt mondta.
//
// EREDMENY (7228 meccs, ebbol 6228 Pinnacle zaro arral):
//
//   1) Pinnacle vagy piaci atlag aron a power TENYLEG jobb:
//        Pinnacle zaro:  0.96302 -> 0.96245
//        Atlag zaro:     0.96336 -> 0.96243  (a legjobb az osszes kombinaciobol)
//
//   2) A MI market_prob-unk viszont MaxC-bol (best odds) keszul - a Generate
//      Legs node a `best` tombot de-viggeli. A MaxC atlagos overroundja
//      -0.03%: nincs arres, amit szet lehetne osztani. Ezert a power itt
//      alig valtoztat (5.0+ sav: 14.35% -> 14.30%), es nem eri meg cserelni.
//
//   3) A TORZITAS VISZONT LETEZIK, csak nem a de-vig okozza:
//        1.0-1.6 sav:  becsult 71.88%  tenyleges 73.19%   (-1.32pp)
//        5.0+   sav:   becsult 14.35%  tenyleges 13.26%   (+1.09pp)
//      A favoritokat alabecsuljuk, a hosszu labakat tulbecsuljuk. Ez a MaxC
//      referencia sajatja: a leghosszabb labakon a "legjobb odds" rendszerint
//      egy outlier konyvtol jon, ami tul nagyot ad, es ezt valoszinusegge
//      alakitva tul optimista szamot kapunk.
//
// MIT JELENT A SZELVENYEPITORE: a `market_prob` szerinti valogatas a hosszu
// labakat jobbnak latja, mint amilyenek. A @5.00-as plafon ezt reszben
// takarja, de a 3.2-5.0 savban is fennall. NYITOTT KERDES, hogy a MaxC
// helyett erdemes-e a piaci atlagbol szamolni a market_prob-ot - az
// osszehasonlitas lentebb megvan, de a valtoztatas eloszor a slip.js-en
// merendo, nem a deployolt node-on.
//
// Futtatas: cd data && node ../devig_check.js
const L = require('./odds_loader.js');

const mult = o => { const ip = o.map(x => 1 / x), s = ip.reduce((a, b) => a + b, 0); return ip.map(x => x / s); };

// Power de-vig: biszekcioval keressuk a k kitevot, amire sum(p_i^k) = 1.
// A k > 1 esetben a nagy valoszinusegek relative nonek - ez kezeli a
// favourite-longshot biast, amit a sima aranyos osztas nem.
function power(o) {
  const raw = o.map(x => 1 / x);
  let lo = 0.5, hi = 5;
  for (let i = 0; i < 60; i++) {
    const k = (lo + hi) / 2;
    const s = raw.reduce((a, p) => a + Math.pow(p, k), 0);
    if (s > 1) lo = k; else hi = k;
  }
  const k = (lo + hi) / 2;
  const p = raw.map(x => Math.pow(x, k));
  const s = p.reduce((a, b) => a + b, 0);
  return p.map(x => x / s);
}

const all = L.loadAll();
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const withPsc = all.filter(m => m.psc && m.avgc && m.maxc && m.res != null);

// ---- 1) log-loss referenciank es de-vig szerint ----
const ll = fn => {
  let t = 0, n = 0;
  for (const m of withPsc) { const p = fn(m); t += -Math.log(Math.max(1e-9, p[m.res])); n++; }
  return t / n;
};
console.log(`1) LOG-LOSS referencia x de-vig szerint (n=${withPsc.length}, kisebb a jobb)`);
const rows = [
  ['Pinnacle zaro + multiplikativ', m => mult(m.psc)],
  ['Pinnacle zaro + power        ', m => power(m.psc)],
  ['Atlag zaro    + multiplikativ', m => mult(m.avgc)],
  ['Atlag zaro    + power        ', m => power(m.avgc)],
  ['MaxC (best)   + multiplikativ', m => mult(m.maxc)],
  ['MaxC (best)   + power        ', m => power(m.maxc)],
];
const scored = rows.map(([n, f]) => [n, ll(f)]);
const best = Math.min(...scored.map(r => r[1]));
for (const [n, v] of scored) console.log(`   ${n}  ${v.toFixed(5)}${v === best ? '   <-- legjobb' : ''}`);

const ov = k => mean(withPsc.map(m => m[k].reduce((a, o) => a + 1 / o, 0) - 1)) * 100;
console.log(`\n   atlagos overround: Pinnacle ${ov('psc').toFixed(2)}%   Atlag ${ov('avgc').toFixed(2)}%   MaxC ${ov('maxc').toFixed(2)}%`);
console.log('   (a MaxC kulonbozo konyvek maximumaibol all, ezert nincs arrese -');
console.log('    ezert nem szamit nala a de-vig modszer)');

// ---- 2) a deployolt market_prob kalibracioja ----
// Ezt a szamot hasznalja a szelvenyepito a labak rangsorolasahoz, tehat ez
// az, aminek igaznak kell lennie - nem a log-lossnak.
const usable = all.filter(m => m.maxc && m.res != null);
const bands = {};
for (const m of usable) {
  const pm = mult(m.maxc), pp = power(m.maxc);
  for (let k = 0; k < 3; k++) {
    const o = m.maxc[k];
    const b = o < 1.6 ? '1.0-1.6' : o < 2.2 ? '1.6-2.2' : o < 3.2 ? '2.2-3.2' : o < 5 ? '3.2-5.0' : '5.0+';
    (bands[b] = bands[b] || []).push({ mult: pm[k], pow: pp[k], hit: m.res === k });
  }
}
console.log(`\n2) A DEPLOYOLT market_prob kalibracioja (MaxC alapon, n=${usable.length} meccs)`);
console.log('   sav        n      mostani  power    TENYLEGES   mostani hibaja');
for (const b of ['1.0-1.6', '1.6-2.2', '2.2-3.2', '3.2-5.0', '5.0+']) {
  const s = bands[b];
  if (!s || s.length < 200) continue;
  const act = s.filter(x => x.hit).length / s.length;
  const mm = mean(s.map(x => x.mult)), pw = mean(s.map(x => x.pow));
  const err = (mm - act) * 100;
  console.log(`   ${b.padEnd(10)}${String(s.length).padStart(5)}   ${(mm * 100).toFixed(2)}%  ${(pw * 100).toFixed(2)}%   ${(act * 100).toFixed(2)}%      ${err >= 0 ? '+' : ''}${err.toFixed(2)}pp`);
}
console.log('\n   A favoritokat alabecsuljuk, a hosszu labakat tulbecsuljuk.');
console.log('   A power de-vig ezen alig javit - a hiba a MaxC referenciabol jon,');
console.log('   nem a de-vig modszerbol.');
