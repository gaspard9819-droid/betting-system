// Befizetesi bonusz varhato ertek — Monte Carlo.
// A kerdes: egy X Ft bonusz, amit N-szer meg kell forgatni min. odds M mellett,
// a haz margojaval szemben mennyit er ténylegesen?

function sim(bonus, rollover, minOdds, margin, trials, betFrac) {
  // Bonusz egyenleg, addig fogadunk min. odds-on, amig a forgatas megvan.
  // Valos nyeresi valoszinuseg = (1/odds) * (1 - margin) korrekcio nelkul:
  // a konyv ara odds, a valos esely p = (1/odds)*(1-margin) -- azaz a margo miatt
  // a valos esely kisebb, mint amit az ar sugall.
  let survived = 0, total = 0;
  for (let t = 0; t < trials; t++) {
    let bal = bonus;
    let turned = 0;
    const target = bonus * rollover;
    const stake = bonus * betFrac;
    while (turned < target && bal >= stake) {
      const pFair = (1 / minOdds) * (1 - margin);
      const win = Math.random() < pFair;
      bal -= stake;
      turned += stake;
      if (win) bal += stake * minOdds;
    }
    const out = turned >= target ? bal : 0;
    total += out;
    if (out > 0) survived++;
  }
  return { ev: total / trials, survivalRate: survived / trials };
}

const TRIALS = 200000;
console.log('Befizetesi bonusz tenyleges erteke (Monte Carlo, ' + TRIALS + ' futas)\n');

const scenarios = [
  { name: 'Tippmixpro 3x forgatas, min 2.00',  bonus: 10000, rollover: 3, minOdds: 2.00, margin: 0.055 },
  { name: 'Tippmixpro 5x forgatas, min 1.50',  bonus: 10000, rollover: 5, minOdds: 1.50, margin: 0.055 },
  { name: 'Vegas 5x forgatas, min 1.50',       bonus: 10000, rollover: 5, minOdds: 1.50, margin: 0.055 },
  { name: 'Boost-piacon 3x, min 2.00 (2% margo)', bonus: 10000, rollover: 3, minOdds: 2.00, margin: 0.020 },
];

for (const s of scenarios) {
  const r = sim(s.bonus, s.rollover, s.minOdds, s.margin, TRIALS, 0.25);
  const pct = (r.ev / s.bonus * 100).toFixed(1);
  console.log(s.name.padEnd(46),
    'EV = ' + Math.round(r.ev).toLocaleString('hu') + ' Ft',
    '(' + pct + '% a nevertekbol)',
    ' teljesites: ' + (r.survivalRate*100).toFixed(1) + '%');
}
