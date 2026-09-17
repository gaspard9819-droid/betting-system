function sim(bonus, rollover, odds, margin, trials, stake) {
  const outs = [];
  for (let t = 0; t < trials; t++) {
    let bal = bonus, turned = 0;
    const target = bonus * rollover;
    while (turned < target && bal >= stake) {
      const pFair = (1/odds)*(1-margin);
      bal -= stake; turned += stake;
      if (Math.random() < pFair) bal += stake*odds;
    }
    outs.push(turned >= target ? bal : 0);
  }
  outs.sort((a,b)=>a-b);
  return { mean: outs.reduce((a,b)=>a+b,0)/trials, median: outs[Math.floor(trials*0.5)],
           bust: outs.filter(x=>x===0).length/trials };
}
const T=100000, B=100000;
console.log('A MARGO hatasa — 100k bonusz, 5x forgatas, odds 1.5, tet 2000 Ft\n');
console.log('margo'.padEnd(22), 'EV'.padEnd(11), '% nevert'.padEnd(10), 'nullaval zar');
const cases = [
  ['6.5% (also liga/rossz piac)', 0.065],
  ['5.5% (tipikus)', 0.055],
  ['4.3% (jo piac)', 0.043],
  ['2.0% (BOOST piac)', 0.020],
  ['0.0% (elmeleti hatar)', 0.000],
];
for (const [label, m] of cases) {
  const r = sim(B, 5, 1.50, m, T, B*0.02);
  console.log(label.padEnd(22),
    Math.round(r.mean).toLocaleString('hu').padEnd(11),
    (r.mean/B*100).toFixed(1).padEnd(10),
    (r.bust*100).toFixed(1)+'%');
}
console.log('\nA teljes forgatas 500 000 Ft. A margo ezen a forgalmon csapodik le:');
for (const [label,m] of cases) console.log('  ' + label.padEnd(22) + ' varhato vesztes a forgalmon: ' + Math.round(500000*m).toLocaleString('hu') + ' Ft');
