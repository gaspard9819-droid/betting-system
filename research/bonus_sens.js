// Erzekenyseg-vizsgalat: szamit-e a tetmeret? Es mi a szorasa?
//
// FIGYELEM: ez TIPPMIXPRO-feltetelekkel szamol (10.000 Ft bonusz, 3x forgatas,
// min odds 2.00) — lasd a konstansokat lentebb. A belole levont "sok kis tet"
// tanacs VEGASRA NEM VIHETO AT: ott 100.000 Ft / 5x / min 1.50 a felteteltel, es
// a szuk keresztmetszet a 240 oras hatarido miatt a KOROK szama, nem a teteke.
// Vegasra a vegas_rollover.js a mervado.
function sim(bonus, rollover, minOdds, margin, trials, betFrac) {
  const outs = [];
  for (let t = 0; t < trials; t++) {
    let bal = bonus, turned = 0;
    const target = bonus * rollover, stake = bonus * betFrac;
    while (turned < target && bal >= stake) {
      const pFair = (1/minOdds)*(1-margin);
      bal -= stake; turned += stake;
      if (Math.random() < pFair) bal += stake*minOdds;
    }
    outs.push(turned >= target ? bal : 0);
  }
  outs.sort((a,b)=>a-b);
  const mean = outs.reduce((a,b)=>a+b,0)/trials;
  return { mean, p10: outs[Math.floor(trials*0.1)], median: outs[Math.floor(trials*0.5)], p90: outs[Math.floor(trials*0.9)], bust: outs.filter(x=>x===0).length/trials };
}
const T=100000, B=10000;
console.log('Tippmixpro 3x, min 2.00, 5.5% margo — tetmeret hatasa\n');
console.log('tet'.padEnd(12), 'EV'.padEnd(10), 'p10'.padEnd(9), 'median'.padEnd(9), 'p90'.padEnd(9), 'nullaval zar');
for (const f of [0.10, 0.25, 0.50, 1.00]) {
  const r = sim(B, 3, 2.00, 0.055, T, f);
  console.log((f*B+' Ft').padEnd(12),
    Math.round(r.mean).toString().padEnd(10),
    Math.round(r.p10).toString().padEnd(9),
    Math.round(r.median).toString().padEnd(9),
    Math.round(r.p90).toString().padEnd(9),
    (r.bust*100).toFixed(1)+'%');
}
