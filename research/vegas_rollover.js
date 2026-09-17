// A VEGAS BONUSZ FORGATASA — a VALODI szabalyzattal (2026-09-17).
//
// A szabalyzat szo szerint:
//   "...otszoros tetrakasi, valamint fogadasi szelvenyenkent minimalisan 1,5-os
//    oddskovetelmeny tarsul, amelyet a sportfogadasi bonusz igenylestol szamitott
//    240 ORAN BELUL szukseges teljesiteni."
//   "Azok a kombinacioban megtett fogadasok, amelyek tartalmaznak sportfogadasi
//    bonuszt, NEM szamitanak bele a tetrakasi kovetelmenybe."
//   "...ha a bonusz lejaratanak pillanataban van meg NEM KIERTEKELT esemenye, a
//    tetrakasi hatarido elteltevel a fel nem hasznalt egyenleg TORLESRE KERUL."
//
// Amit ez felulir a korabbi scriptekben:
//   1. A hatarido 240 ora (10 nap), NEM 3.5 honap. A vegas_real.js fejlece a promocio
//      ELERHETOSEGI ablakat (2026.08.03-12.31) olvasta forgatasi hataridonek.
//   2. A "sok kis tet" tanacs (bonus_sens.js) Tippmixpro-parameterekkel keszult
//      (10.000 Ft / 3x / odds 2.00), nem Vegassal. Vegasra maskepp all.
//
// A LENYEG: nem a fogadasok szama a szuk keresztmetszet, hanem a KOROKE.
// A forgatas kiertekelessel halad, es a keret korbeforog — 100.000 Ft-bol nem lehet
// 500.000-et megjatszani egyszerre. Barmennyi szelvenyt kirakhatsz egy korben, de a
// kovetkezo kor csak azutan indul, hogy az elozo kiertekelodott.

const BONUS = 100000;
const ROLLOVER = 5;
const TARGET = BONUS * ROLLOVER;   // 500.000 Ft forgalom
const ODDS = 1.5;                  // a szabalyzat minimuma
const MIN_STAKE = 200;             // szelvenyenkenti also korlat a konyvnel

// ---------------------------------------------------------------------------
// 1. Hany kor kell? Ez tiszta varhato-ertek levezetes, nem szimulacio.
// ---------------------------------------------------------------------------
function roundsNeeded(margin) {
  const rows = [];
  let bal = BONUS, turned = 0;
  while (turned < TARGET && rows.length < 50) {
    const stake = Math.min(bal, TARGET - turned);
    if (stake < MIN_STAKE) break;
    turned += stake;
    // varhato keret a kor utan: a megjatszott resz (1-margo)-szorosan ter vissza
    bal = bal - stake + stake * ODDS * ((1 / ODDS) * (1 - margin));
    rows.push({ round: rows.length + 1, stake, turned, bal });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 2. Monte Carlo: korok, korlatozott korszammal.
//    A keretet splitInto szelvenyre osztjuk, mind egyszerre fut, egyutt ertekelodik.
//    Ket kulon kockazat, kulon szamolva:
//      bust   — elfogyott a keret (a szelvenyek egyszerre buktak)
//      expiry — lejart a 240 ora, mielott a forgalom osszejott
// ---------------------------------------------------------------------------
function sim(margin, splitInto, maxRounds, trials) {
  const p = (1 / ODDS) * (1 - margin);
  let sum = 0, bust = 0, expiry = 0;
  const outs = [];
  for (let t = 0; t < trials; t++) {
    let bal = BONUS, turned = 0, r = 0;
    while (turned < TARGET && r < maxRounds) {
      const total = Math.min(bal, TARGET - turned);
      const per = total / splitInto;
      if (per < MIN_STAKE) break;              // nem oszthato szet ennyi felé
      let won = 0;
      for (let i = 0; i < splitInto; i++) if (Math.random() < p) won += per * ODDS;
      bal = bal - total + won;
      turned += total;
      r++;
    }
    if (turned >= TARGET) { sum += bal; outs.push(bal); }
    else { outs.push(0); if (r >= maxRounds) expiry++; else bust++; }
  }
  outs.sort((a, b) => a - b);
  return {
    mean: sum / trials,
    median: outs[Math.floor(trials * 0.5)],
    bust: bust / trials,
    expiry: expiry / trials,
  };
}

const T = 20000;
const M_1X2 = 0.0528;   // a vegas_margin.js-ben MERT 1X2 atlag

console.log('=== 1. HANY KOR KELL? (varhato ertek, 1X2 atlagmargo ' + (M_1X2*100).toFixed(2) + '%) ===');
console.log('Barmennyi szelvenyt kirakhatsz egy korben — a keret akkor is korbeforog.\n');
console.log('kor'.padEnd(6), 'megjatszott'.padEnd(14), 'osszes forgalom'.padEnd(18), 'keret utana');
const rows = roundsNeeded(M_1X2);
for (const r of rows) {
  console.log(String(r.round).padEnd(6),
    Math.round(r.stake).toLocaleString('hu').padEnd(14),
    Math.round(r.turned).toLocaleString('hu').padEnd(18),
    Math.round(r.bal).toLocaleString('hu'));
}
console.log('');
console.log('-> MINIMUM ' + rows.length + ' kor, es a vegen ~'
  + Math.round(rows[rows.length-1].bal).toLocaleString('hu') + ' Ft marad.');
console.log('   Ellenorzes: 100.000 - 500.000 x ' + (M_1X2*100).toFixed(2) + '% = '
  + Math.round(BONUS - TARGET*M_1X2).toLocaleString('hu') + ' Ft');
console.log('');
console.log('Egy "kor" nem egy nap: delutani meccsre raksz, este kiertekelodik, mehet');
console.log('az estire. Napi 1.5-2 kor realis -> 10 nap alatt 15-20 kor.');
console.log('');

console.log('=== 2. HANY FELE OSSZAD A KERETET EGY KORBEN? ===');
console.log('(1X2 atlagmargo, a lejarat a 240 ora miatti bukas)\n');
console.log('szelveny/kor'.padEnd(14), '10 kor'.padEnd(22), '15 kor'.padEnd(22), '20 kor');
console.log(''.padEnd(14), 'EV / lejarat'.padEnd(22), 'EV / lejarat'.padEnd(22), 'EV / lejarat');
for (const split of [1, 2, 5, 10, 20, 50]) {
  const cells = [10, 15, 20].map(mr => {
    const r = sim(M_1X2, split, mr, T);
    return (Math.round(r.mean).toLocaleString('hu') + ' / '
      + ((r.bust + r.expiry) * 100).toFixed(1) + '%');
  });
  console.log((split + ' db').padEnd(14), cells[0].padEnd(22), cells[1].padEnd(22), cells[2]);
}
console.log('');
console.log('Keves nagy szelveny magasabb EV-t ad, de sokkal gyakrabban bukik: egyetlen');
console.log('vesztes kor felezi a keretet. Sok kicsi csokkenti a koronkenti szorast, hogy');
console.log('a keret kitartson 6 koron at. 50-nel mar romlik, mert a ' + MIN_STAKE + ' Ft-os');
console.log('szelvenyminimum miatt az utolso korokben nem oszthato szet a maradek.');
console.log('');
console.log('-> A jozan sav: 10-20 szelveny koronkent.');
console.log('');

console.log('=== 3. A MERT MARGOK, 20 szelveny/kor, 15 kor ===');
console.log('(a margokat a vegas_margin.js es vegas_oddsplus.js merte)\n');
const cases = [
  ['O/U piac (6.63% mert)',      0.0663],
  ['1X2 median (6.17% mert)',    0.0617],
  ['1X2 atlag (5.28% mert)',     0.0528],
  ['Odds+ meccsek (3.95% mert)', 0.0395],
  ['legjobb meccs (2.98% mert)', 0.0298],
];
console.log('hol forgatod'.padEnd(30), 'netto EV'.padEnd(12), 'median'.padEnd(12), 'bukas/lejarat');
const evs = [];
for (const [label, m] of cases) {
  const r = sim(m, 20, 15, T);
  evs.push(r.mean);
  console.log(label.padEnd(30),
    Math.round(r.mean).toLocaleString('hu').padEnd(12),
    Math.round(r.median).toLocaleString('hu').padEnd(12),
    ((r.bust + r.expiry) * 100).toFixed(1) + '%');
}
console.log('');
console.log('A piacvalasztas erteke: ' + Math.round(evs[evs.length-1] - evs[0]).toLocaleString('hu') + ' Ft');
console.log('ugyanazon a bonuszon. Ezert er a meccsvalogatas — lasd vegas_pick.js.');
console.log('');
console.log('=== AMIT A SZABALYZAT MEG KIKOT ===');
console.log('- Kombinacioval NEM forgathatsz (a bonuszt tartalmazo kotesek nem szamitanak).');
console.log('- A szelvenynek KI IS KELL ERTEKELODNIE a 240 oran belul, nem eleg megtenni.');
console.log('  Ezert az utolso nap gyakorlatilag nem hasznalhato.');
console.log('- A ki nem forgatott bonuszegyenleg TORLESRE KERUL.');
