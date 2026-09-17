// VEGAS.HU MARGO — MERT ADAT, 2026.09.17, EL meccsnap.
// Vegre teljes piacok: 1X2 (3 kimenet) es O/U (2 kimenet).
// A margo (overround) = sum(1/odds) - 1. Referencia NEM kell hozza.

const matches = [
  // [meccs, [1, X, 2], [over, under], ou_vonal]
  ['Levszki Szofia - Salzburg',   [3.38, 3.69, 2.16], [1.64, 2.20], 2.5],
  ['OFI Kreta - Hoffenheim',      [8.00, 5.33, 1.33], [2.08, 1.71], 3.5],
  ['Besiktas - Marseille',        [1.75, 4.35, 4.20], [2.25, 1.61], 3.5],
  ['Celtic - Ferencvaros',        [1.75, 4.15, 4.40], [2.30, 1.58], 3.5],
  ['Crystal Palace - Lech Poznan',[1.35, 5.33, 7.50], [2.22, 1.62], 3.5],
  ['Viktoria Plzen - Union SG',   [2.42, 3.50, 2.75], [1.68, 2.12], 2.5],
  ['Juventus - Nijmegen',         [1.15, 7.50, 16.00],[2.00, 1.77], 3.5],
  ['Lillestrom - SCU',            [1.61, 4.20, 5.00], [1.62, 2.22], 2.5],
];

const ov = odds => odds.reduce((s,o)=>s+1/o, 0) - 1;

console.log('=== VEGAS.HU MARGO (overround) — 8 EL meccs, 2026.09.17 ===\n');
console.log('meccs'.padEnd(30), '1X2 margo'.padEnd(12), 'O/U margo');
let m1x2 = [], mou = [];
for (const [name, h2h, ou] of matches) {
  const a = ov(h2h)*100, b = ov(ou)*100;
  m1x2.push(a); mou.push(b);
  console.log(name.padEnd(30), (a.toFixed(2)+'%').padEnd(12), b.toFixed(2)+'%');
}
const avg = a => a.reduce((s,x)=>s+x,0)/a.length;
const med = a => { const s=[...a].sort((x,y)=>x-y); return s[Math.floor(s.length/2)]; };

console.log('');
console.log('1X2 atlag margo:  ' + avg(m1x2).toFixed(2) + '%   (median ' + med(m1x2).toFixed(2) + '%)');
console.log('O/U atlag margo:  ' + avg(mou).toFixed(2) + '%   (median ' + med(mou).toFixed(2) + '%)');
console.log('');
console.log('=== OSSZEVETES ===');
console.log('Tippmixpro rendes 1X2 (mert 2026-09-16):  4.3 - 6.5%');
console.log('Tippmixpro Szuper odds (boost):           2.0 - 2.4%');
console.log('Pinnacle (iparagi referencia):            ~3%');
console.log('VEGAS 1X2 (most mert):                    ' + avg(m1x2).toFixed(2) + '%');
console.log('VEGAS O/U (most mert):                    ' + avg(mou).toFixed(2) + '%');
