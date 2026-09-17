// Vegas.hu oddsfokozok — 2026.09.17, EL meccsnap. 43 ajanlat, 9 meccs.
// Forras: a felhasznalo artifactja (vegas.hu-rol gyujtve).
//
// MIT LEHET ES MIT NEM LEHET ebbol kiszamolni:
//  - NEM lehet margot szamolni. Ahhoz egy piac OSSZES kimenetele kell (1X2 -> 3 ar).
//    Ezek mind tobblabu kombinaciok, egyetlen kimenettel. Nincs komplementer par.
//  - LEHET viszont merni a BOOST MERTEKET, es azt osszevetni a Tippmixpro
//    +4.02%-os mert atlagaval (tippmix-boost-feed, 2026-09-16).

const offers = [
  // [meccs, alap, boostolt]
  ['Levszki-Salzburg', 6.50, 7.50], ['Levszki-Salzburg', 4.75, 5.20],
  ['Levszki-Salzburg', 6.50, 7.50], ['Levszki-Salzburg', 5.75, 6.50],
  ['Levszki-Salzburg', 10.00, 12.00],
  ['OFI-Hoffenheim', 2.40, 2.48], ['OFI-Hoffenheim', 7.50, 8.50],
  ['OFI-Hoffenheim', 7.50, 8.50], ['OFI-Hoffenheim', 3.10, 3.20],
  ['OFI-Hoffenheim', 4.50, 5.20],
  ['Besiktas-Marseille', 5.50, 6.00], ['Besiktas-Marseille', 5.33, 6.00],
  ['Besiktas-Marseille', 8.50, 9.50], ['Besiktas-Marseille', 3.10, 3.20],
  ['Besiktas-Marseille', 2.75, 2.85],
  ['Celtic-FTC', 4.75, 5.50], ['Celtic-FTC', 5.50, 6.00],
  ['Celtic-FTC', 3.10, 3.30], ['Celtic-FTC', 8.50, 9.50],
  ['Celtic-FTC', 3.10, 3.30], ['Celtic-FTC', 4.50, 5.20],
  ['Palace-Lech', 3.33, 3.50], ['Palace-Lech', 2.90, 3.00],
  ['Palace-Lech', 7.50, 8.50], ['Palace-Lech', 8.50, 9.50],
  ['Plzen-UnionSG', 10.00, 12.00], ['Plzen-UnionSG', 3.80, 4.20],
  ['Plzen-UnionSG', 5.75, 6.50], ['Plzen-UnionSG', 7.00, 8.00],
  ['Juventus-Nijmegen', 8.00, 9.00], ['Juventus-Nijmegen', 3.00, 3.10],
  ['Juventus-Nijmegen', 3.80, 4.20], ['Juventus-Nijmegen', 1.84, 1.88],
  ['Lillestrom-SCU', 4.75, 5.20], ['Lillestrom-SCU', 9.00, 11.00],
  ['Lillestrom-SCU', 6.00, 6.50], ['Lillestrom-SCU', 2.42, 2.52],
  ['Lillestrom-SCU', 4.50, 5.20],
  ['Sociedad-Bournemouth', 13.00, 16.00], ['Sociedad-Bournemouth', 1.75, 1.78],
  ['Sociedad-Bournemouth', 5.66, 6.50], ['Sociedad-Bournemouth', 9.50, 11.00],
  ['Sociedad-Bournemouth', 12.00, 14.00],
];

const lifts = offers.map(([m,a,b]) => ({m, base:a, boost:b, lift:(b/a-1)*100}));
const mean = lifts.reduce((s,x)=>s+x.lift,0)/lifts.length;
const sorted = [...lifts].sort((a,b)=>a.lift-b.lift);
const median = sorted[Math.floor(sorted.length/2)].lift;

console.log('=== VEGAS.HU ODDSFOKOZO — MERT ADAT (2026.09.17) ===');
console.log('minta: ' + lifts.length + ' ajanlat, 9 EL meccs\n');
console.log('atlagos emeles:  +' + mean.toFixed(2) + '%');
console.log('median emeles:   +' + median.toFixed(2) + '%');
console.log('min / max:       +' + sorted[0].lift.toFixed(1) + '% / +' + sorted[sorted.length-1].lift.toFixed(1) + '%');
console.log('');
console.log('Tippmixpro Szuper odds (mert 2026-09-16): +4.02%');
console.log('-> a Vegas boost ' + (mean/4.02).toFixed(1) + 'x NAGYOBB emelest ad\n');

// Fugg-e az emeles az alaparaktol?
console.log('=== EMELES AZ ALAPAR FUGGVENYEBEN ===');
const bands = [[1,3],[3,5],[5,8],[8,20]];
console.log('alapar sav'.padEnd(14),'db'.padEnd(5),'atlag emeles');
for (const [lo,hi] of bands) {
  const g = lifts.filter(x=>x.base>=lo && x.base<hi);
  if (!g.length) continue;
  const m = g.reduce((s,x)=>s+x.lift,0)/g.length;
  console.log((lo+'-'+hi).padEnd(14), String(g.length).padEnd(5), '+'+m.toFixed(1)+'%');
}
