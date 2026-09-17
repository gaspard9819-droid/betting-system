// TIPPMIXPRO befizetesi bonusz — VALODI feltetelek (reszveteli szabalyzat, 2026-09-17)
//
// A Vegas-tol GYOKERESEN elter. A kulcskulonbsegek:
//   bonusz:      100%, max 5.000 Ft (nem 100.000!)
//   forgatas:    2x (nem 5x)  -> sokkal enyhebb
//   min ODDS:    2.0 EREDO (nem 1.5)
//   KOTES:       legalabb 3-as kotes, 3 kulon merkozes  <-- EZ A LENYEG
//   ido:         72 ora (nem 4.5 honap)
//   tetkorlat:   fogadasonkent max a bonuszosszeg szamit bele (5.000 Ft)
//   kizarva:     Oddsrakéta (=BOOST!), Oddspiramis, kombinaciok, cash out
//   plafon:      a nyeremenyegyenlegre max a bonusz 10x-ese kerulhet at
//
// A 3-as kotes a domino: 3 fuggetlen lab kell, es a szelveny csak akkor nyer,
// ha MINDHAROM bejon. Ez a margot HARMASZOROSAN szedi be.

function sim({bonus, rollover, totalOdds, legs, marginPerLeg, trials, stake, capMult}) {
  const outs = [];
  // Eredo odds = totalOdds. Egy labra eso odds = totalOdds^(1/legs).
  // Minden lab sajat margoval: valos esely = (1/legOdds)*(1-margin).
  const legOdds = Math.pow(totalOdds, 1/legs);
  const pLeg = (1/legOdds)*(1-marginPerLeg);
  const pSlip = Math.pow(pLeg, legs);   // mindharom labnak be kell jonnie
  for (let t=0;t<trials;t++){
    let bal = bonus, turned = 0;
    const target = bonus * rollover;
    while (turned < target && bal >= stake) {
      const counted = Math.min(stake, bonus); // tetenkenti beszamitasi korlat
      bal -= stake; turned += counted;
      if (Math.random() < pSlip) bal += stake*totalOdds;
    }
    let out = turned >= target ? bal : 0;
    out = Math.min(out, bonus*capMult); // 10x plafon
    outs.push(out);
  }
  outs.sort((a,b)=>a-b);
  return {
    mean: outs.reduce((a,b)=>a+b,0)/trials,
    median: outs[Math.floor(trials*0.5)],
    bust: outs.filter(x=>x===0).length/trials,
    pSlip
  };
}

const T=200000, B=5000;
console.log('TIPPMIXPRO 5.000 Ft bonusz — valodi feltetelek');
console.log('2x forgatas (=10.000 Ft), min EREDO odds 2.0, min 3-as kotes, 72 ora\n');
console.log('A 3-as kotes hatasa: a margo labonkent szamit, es mindharomnak be kell jonnie.\n');
console.log('labak'.padEnd(8),'lab odds'.padEnd(10),'szelveny p'.padEnd(12),'EV'.padEnd(9),'% nevert'.padEnd(10),'nullaval zar');
for (const legs of [1,2,3,4]) {
  const r = sim({bonus:B, rollover:2, totalOdds:2.0, legs, marginPerLeg:0.055, trials:T, stake:B*0.5, capMult:10});
  const legOdds = Math.pow(2.0,1/legs);
  console.log(String(legs).padEnd(8),
    legOdds.toFixed(2).padEnd(10),
    (r.pSlip*100).toFixed(1).padEnd(12),
    Math.round(r.mean).toLocaleString('hu').padEnd(9),
    (r.mean/B*100).toFixed(1).padEnd(10),
    (r.bust*100).toFixed(1)+'%');
}
console.log('\n(a 3-as sor a kotelezo minimum; az 1-2 sor csak referencia, nem megengedett)');
