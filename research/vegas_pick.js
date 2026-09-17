// MECCSVALASZTO a bonusz forgatasahoz — melyik meccsen a legszukebb a margo?
//
// Ez NEM joslas. A margo a fogadas pillanataban ismert: sum(1/odds) - 1, referencia
// nelkul kijon. A modell nem veri a piacot (log-loss 1.018 vs 0.980), a margoszamolas
// viszont puszta aritmetika. A vegas_rollover.js szerint a piacvalasztas ~18.000 Ft-ot
// er ugyanazon a bonuszon — ez a repo egyik ket merhetoen mukodo dolga.
//
// ADATFORRAS: kezi bekuldes. A vegas.hu odds API-ja zarva (obfuszkalt validateToken),
// es a bet_slate a TIPPMIXPRO arait tarolja — mas konyv, mas margok, nem hasznalhato
// proxykent, amig nincs merve, hogy egyutt mozognak.
//
// A bekuldott adat formatuma alul, a MATCHES tombben — a vegas_margin.js szerkezetet
// koveti, hogy a meglevo meres atemelheto legyen.

// A meres idopontja. KOTELEZO: csak azonos pillanatban rogzitett arak hasonlithatok.
// A 2026-09-13-as meresnel 85-bol 60 ar mozdult atlag 1.34%-ot ot ora alatt — kevert
// idopontu arakbol a rangsor ertelmetlen.
const CAPTURED_AT = '2026-09-17T18:00Z';

// [meccs, {piac: [oddsok...]}]
// h2h = 1X2 (3 kimenet), ou = Over/Under (2 kimenet).
const MATCHES = [
  ['Levszki Szofia - Salzburg',    { h2h: [3.38, 3.69, 2.16], ou: [1.64, 2.20] }],
  ['OFI Kreta - Hoffenheim',       { h2h: [8.00, 5.33, 1.33], ou: [2.08, 1.71] }],
  ['Besiktas - Marseille',         { h2h: [1.75, 4.35, 4.20], ou: [2.25, 1.61] }],
  ['Celtic - Ferencvaros',         { h2h: [1.75, 4.15, 4.40], ou: [2.30, 1.58] }],
  ['Crystal Palace - Lech Poznan', { h2h: [1.35, 5.33, 7.50], ou: [2.22, 1.62] }],
  ['Viktoria Plzen - Union SG',    { h2h: [2.42, 3.50, 2.75], ou: [1.68, 2.12] }],
  ['Juventus - Nijmegen',          { h2h: [1.15, 7.50, 16.00], ou: [2.00, 1.77] }],
  ['Lillestrom - SCU',             { h2h: [1.61, 4.20, 5.00], ou: [1.62, 2.22] }],
];

// Piaconkent hany kimenet KELL a teljes keszlethez. Hianyos piac margoja ertelmetlen —
// a Slate Builder devig()-je ugyanezert ad null-t, ha barmelyik kulcs hianyzik.
const REQUIRED = { h2h: 3, ou: 2 };

// Amit NEM szabad igy szamolni. A sum(1/odds)-1 csak EGYMAST KIZARO kimenetekre all.
// A kettos esely (1X/12/X2) atfed, a keplet 117%-os "margot" adott a pyramid_check.js-ben.
const EXCLUDED = { dc: 'kettos esely — atfedo kimenetek, a keplet nem ervenyes rajuk' };

const MIN_ODDS = 1.5;              // a szabalyzat szelvenyenkenti minimuma
const TURNOVER = 500000;           // 5x forgatas 100.000 Ft bonuszon

function margin(market, odds) {
  if (EXCLUDED[market]) return { err: EXCLUDED[market] };
  const need = REQUIRED[market];
  if (!need) return { err: 'ismeretlen piac: ' + market };
  if (!Array.isArray(odds) || odds.length !== need)
    return { err: 'hianyos piac (' + (odds ? odds.length : 0) + '/' + need + ' kimenet)' };
  if (odds.some(o => !(o > 1))) return { err: 'ervenytelen odds' };
  return { pct: (odds.reduce((s, o) => s + 1 / o, 0) - 1) * 100 };
}

// Forgathato-e egyaltalan? Kell legalabb egy kimenet a minimum odds felett.
const rollable = odds => odds.some(o => o >= MIN_ODDS);

if (!CAPTURED_AT) {
  console.log('!!! FIGYELEM: nincs idobelyeg a bekuldott arakon.');
  console.log('    Kevert idopontu arakbol a rangsor nem ertelmes. Lasd a fejlecet.\n');
}

console.log('=== MECCSVALASZTO — hol forgasd a bonuszt? ===');
console.log('arak rogzitve: ' + (CAPTURED_AT || 'ISMERETLEN') + '\n');

const ranked = [];
for (const [name, markets] of MATCHES) {
  for (const [market, odds] of Object.entries(markets)) {
    const r = margin(market, odds);
    if (r.err) { ranked.push({ name, market, err: r.err }); continue; }
    ranked.push({
      name, market, pct: r.pct,
      loss: TURNOVER * r.pct / 100,
      rollable: rollable(odds),
      odds,
    });
  }
}

const ok = ranked.filter(r => !r.err && r.rollable).sort((a, b) => a.pct - b.pct);
const skipped = ranked.filter(r => r.err || !r.rollable);

console.log('#'.padEnd(4), 'meccs'.padEnd(30), 'piac'.padEnd(6), 'margo'.padEnd(9), 'vesztes 500k-n');
ok.forEach((r, i) => {
  console.log(String(i + 1).padEnd(4), r.name.padEnd(30), r.market.padEnd(6),
    (r.pct.toFixed(2) + '%').padEnd(9),
    Math.round(r.loss).toLocaleString('hu') + ' Ft');
});

if (skipped.length) {
  console.log('\n--- kihagyva ---');
  for (const r of skipped) {
    console.log(r.name.padEnd(30), r.market.padEnd(6),
      r.err || 'nincs ' + MIN_ODDS + '+ kimenet, nem forgathato');
  }
}

if (ok.length) {
  const best = ok[0], worst = ok[ok.length - 1];
  console.log('');
  console.log('=== A DONTES ===');
  console.log('legszukebb:  ' + best.name + ' (' + best.market + ') — '
    + best.pct.toFixed(2) + '%, vesztes ' + Math.round(best.loss).toLocaleString('hu') + ' Ft');
  console.log('legszelesebb: ' + worst.name + ' (' + worst.market + ') — '
    + worst.pct.toFixed(2) + '%, vesztes ' + Math.round(worst.loss).toLocaleString('hu') + ' Ft');
  console.log('a valasztas erteke: ' + Math.round(worst.loss - best.loss).toLocaleString('hu')
    + ' Ft ugyanazon a forgalmon');

  const h2h = ok.filter(r => r.market === 'h2h'), ou = ok.filter(r => r.market === 'ou');
  const avg = a => a.reduce((s, r) => s + r.pct, 0) / a.length;
  console.log('');
  if (h2h.length) console.log('1X2 atlag: ' + avg(h2h).toFixed(2) + '%   (' + h2h.length + ' piac)');
  if (ou.length)  console.log('O/U atlag: ' + avg(ou).toFixed(2) + '%   (' + ou.length + ' piac)');
  console.log('');
  console.log('A felso harmadbol valassz, es oszd 10-20 szelvenyre koronkent');
  console.log('(lasd vegas_rollover.js). Kombinaciot NE — a szabalyzat kizarja a');
  console.log('forgatasbol.');
}
