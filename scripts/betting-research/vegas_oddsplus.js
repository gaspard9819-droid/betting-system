// A kepen ket meccsnel ott van az "Odds+" jeloles: Besiktas-Marseille es Celtic-FTC.
// Ellenorzom, hogy ezeknel tenyleg alacsonyabb-e a margo.
const rows = [
  ['Levszki - Salzburg',   [3.38,3.69,2.16], false],
  ['OFI - Hoffenheim',     [8.00,5.33,1.33], false],
  ['Besiktas - Marseille', [1.75,4.35,4.20], true ],  // Odds+
  ['Celtic - Ferencvaros', [1.75,4.15,4.40], true ],  // Odds+
  ['Palace - Lech',        [1.35,5.33,7.50], false],
  ['Plzen - Union SG',     [2.42,3.50,2.75], false],
  ['Juventus - Nijmegen',  [1.15,7.50,16.00],false],
  ['Lillestrom - SCU',     [1.61,4.20,5.00], false],
];
const ov = o => (o.reduce((s,x)=>s+1/x,0)-1)*100;
const plus = rows.filter(r=>r[2]).map(r=>ov(r[1]));
const norm = rows.filter(r=>!r[2]).map(r=>ov(r[1]));
const avg = a=>a.reduce((s,x)=>s+x,0)/a.length;

console.log('=== "Odds+" JELOLES HATASA az 1X2 margora ===\n');
rows.forEach(([n,o,p])=>console.log((p?'[Odds+] ':'        ')+n.padEnd(24)+ov(o).toFixed(2)+'%'));
console.log('');
console.log('Odds+ meccsek atlaga:   ' + avg(plus).toFixed(2) + '%  (' + plus.length + ' meccs)');
console.log('Sima meccsek atlaga:    ' + avg(norm).toFixed(2) + '%  (' + norm.length + ' meccs)');
console.log('kulonbseg:              ' + (avg(norm)-avg(plus)).toFixed(2) + ' szazalekpont');
console.log('');
console.log('A Levszki-Salzburg (2.98%) sima meccs, megis a legalacsonyabb —');
console.log('tehat a mintazat nem tiszta, 8 meccs keves a biztos allitashoz.');
console.log('');
console.log('=== A KORABBI REFERENCIAPONT UJRAERTEKELESE ===');
console.log('A Salzburg 1X2 = 2.16 a Vegasnal, es a margo ott csak 2.98%.');
console.log('Tehat a 6.50-es kombinalt alapar NEM magas margobol jott —');
console.log('a harom lab EGYUTTES arazasa volt konzervativ, nem az 1X2 lab.');
