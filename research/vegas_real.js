// A VALODI vegas.hu udvozlobonusz feltetelei (kepernyokep, 2026-09-17):
//   bonusz: 100% az elso befizetesre, max 100 000 Ft
//   forgatas: a bonuszosszeg 5-szorose
//   ODDSKOVETELMENY: szelvenyenkent min 1.5  <-- ez a kulcs
//   idotartam: 2026.08.03 - 2026.12.31 (kb 3.5 honap, NEM 7 nap)
//
// A korabbi becsles 5x/1.50-et hasznalt -> 74.5%. Az volt a helyes szorzo.
// Amit viszont NEM vettem figyelembe: a min odds 1.5 az also korlat, nem kotelezo ar.
// Magasabb oddson kevesebb fogadas kell? NEM - a forgatas FT-ben merodik, nem darabban.
// Viszont az odds valasztasa a TULELEST befolyasolja.

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
  return {
    mean: outs.reduce((a,b)=>a+b,0)/trials,
    median: outs[Math.floor(trials*0.5)],
    p25: outs[Math.floor(trials*0.25)],
    bust: outs.filter(x=>x===0).length/trials
  };
}

const T=100000, B=100000, ROLL=5;
console.log('VEGAS UDVOZLOBONUSZ - valodi feltetelek');
console.log('100 000 Ft bonusz, 5x forgatas (=500 000 Ft), min odds 1.5, 5.5% margo');
console.log('Tet: a bonusz 2%-a (2000 Ft) = sok kis tet\n');
console.log('odds'.padEnd(8), 'EV'.padEnd(10), '% nevert'.padEnd(10), 'median'.padEnd(10), 'nullaval zar');
for (const o of [1.50, 1.80, 2.00, 2.50, 3.00]) {
  const r = sim(B, ROLL, o, 0.055, T, B*0.02);
  console.log(o.toFixed(2).padEnd(8),
    Math.round(r.mean).toLocaleString('hu').padEnd(10),
    (r.mean/B*100).toFixed(1).padEnd(10),
    Math.round(r.median).toLocaleString('hu').padEnd(10),
    (r.bust*100).toFixed(1)+'%');
}
