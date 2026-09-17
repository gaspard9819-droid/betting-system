// A tetmeret hatasa a Tippmixpro-nal. FONTOS ELTERES a Vegas-tol:
// "Fogadasonkent legfeljebb a bonuszosszeggel megegyezo osszeg szamit bele"
// -> 5.000 Ft bonusznal egy 5.000 Ft-os tet SZAMIT BE TELJESEN,
//    es a forgatas csak 2x = 10.000 Ft, azaz KET darab 5.000 Ft-os teddel kesz.
// Ez gyokeresen mas, mint a Vegas 500.000 Ft-os forgalma.

function sim({bonus, rollover, totalOdds, legs, marginPerLeg, trials, stake, capMult}) {
  const outs=[];
  const legOdds=Math.pow(totalOdds,1/legs);
  const pSlip=Math.pow((1/legOdds)*(1-marginPerLeg),legs);
  for(let t=0;t<trials;t++){
    let bal=bonus,turned=0;
    const target=bonus*rollover;
    let bets=0;
    while(turned<target && bal>=stake){
      const counted=Math.min(stake,bonus);
      bal-=stake; turned+=counted; bets++;
      if(Math.random()<pSlip) bal+=stake*totalOdds;
      if(bets>500) break;
    }
    let out=turned>=target?bal:0;
    out=Math.min(out,bonus*capMult);
    outs.push(out);
  }
  outs.sort((a,b)=>a-b);
  return {mean:outs.reduce((a,b)=>a+b,0)/trials, median:outs[Math.floor(trials*0.5)],
          bust:outs.filter(x=>x===0).length/trials};
}
const T=200000,B=5000;
console.log('TIPPMIXPRO — tetmeret, 3-as kotes, eredo odds 2.0, 2x forgatas\n');
console.log('tet'.padEnd(10),'db tet kell'.padEnd(13),'EV'.padEnd(9),'% nevert'.padEnd(10),'median'.padEnd(9),'nullaval zar');
for(const s of [1000,2500,5000]){
  const r=sim({bonus:B,rollover:2,totalOdds:2.0,legs:3,marginPerLeg:0.055,trials:T,stake:s,capMult:10});
  console.log((s+' Ft').padEnd(10),
    String(Math.ceil(B*2/Math.min(s,B))).padEnd(13),
    Math.round(r.mean).toLocaleString('hu').padEnd(9),
    (r.mean/B*100).toFixed(1).padEnd(10),
    Math.round(r.median).toLocaleString('hu').padEnd(9),
    (r.bust*100).toFixed(1)+'%');
}
console.log('\nMAGASABB EREDO ODDS (a 2.0 csak minimum) — tet 5.000 Ft, 3 lab:');
console.log('eredo odds'.padEnd(12),'EV'.padEnd(9),'% nevert'.padEnd(10),'median'.padEnd(9),'nullaval zar');
for(const o of [2.0,3.0,5.0,10.0]){
  const r=sim({bonus:B,rollover:2,totalOdds:o,legs:3,marginPerLeg:0.055,trials:T,stake:5000,capMult:10});
  console.log(o.toFixed(1).padEnd(12),
    Math.round(r.mean).toLocaleString('hu').padEnd(9),
    (r.mean/B*100).toFixed(1).padEnd(10),
    Math.round(r.median).toLocaleString('hu').padEnd(9),
    (r.bust*100).toFixed(1)+'%');
}
