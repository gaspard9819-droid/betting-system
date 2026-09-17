// A Vegas bonusz ujraszamolva a MERT margoval (nem becsulttel).
//
// RESZBEN MEGHALADOTT (2026-09-17): a MARGO-szamok ervenyesek es merteken allnak,
// a 2000 Ft-os FIX TET viszont nem teljesitheto. A bekuldott szabalyzat szerint a
// forgatasra 240 ora (10 nap) van, nem 3.5 honap — 2000 Ft-tal az 250 fogadas.
// A helyes modell korokben szamol (a keret korbeforog, min. 6 kor kell): lasd
// vegas_rollover.js. A piacvalasztas erteke ott is ~18.000 Ft, tehat az alabbi
// kovetkeztetes all, csak a szintek tolodnak lejjebb.
function sim(bonus, rollover, odds, margin, trials, stake) {
  const outs=[];
  for(let t=0;t<trials;t++){
    let bal=bonus,turned=0; const target=bonus*rollover;
    while(turned<target&&bal>=stake){
      const p=(1/odds)*(1-margin);
      bal-=stake; turned+=stake;
      if(Math.random()<p) bal+=stake*odds;
    }
    outs.push(turned>=target?bal:0);
  }
  outs.sort((a,b)=>a-b);
  return {mean:outs.reduce((a,b)=>a+b,0)/trials, median:outs[Math.floor(trials*0.5)],
          bust:outs.filter(x=>x===0).length/trials};
}
const T=100000,B=100000;
console.log('=== VEGAS BONUSZ a MERT margokkal ===');
console.log('100.000 Ft, 5x forgatas (500k forgalom), odds 1.5, tet 2.000 Ft\n');
const cases=[
  ['O/U piac (6.63% mert)',        0.0663],
  ['1X2 atlag (5.28% mert)',       0.0528],
  ['1X2 median (6.17% mert)',      0.0617],
  ['Odds+ meccsek (3.95% mert)',   0.0395],
  ['legjobb meccs (2.98% mert)',   0.0298],
];
console.log('piac'.padEnd(30),'EV'.padEnd(11),'% nevert'.padEnd(10),'vesztes az 500k-n');
for(const[label,m] of cases){
  const r=sim(B,5,1.50,m,T,2000);
  console.log(label.padEnd(30),
    Math.round(r.mean).toLocaleString('hu').padEnd(11),
    (r.mean/B*100).toFixed(1).padEnd(10),
    Math.round(500000*m).toLocaleString('hu')+' Ft');
}
console.log('');
console.log('=== A DONTES ===');
const worst=sim(B,5,1.50,0.0663,T,2000).mean;
const best=sim(B,5,1.50,0.0298,T,2000).mean;
console.log('rossz piacon (O/U):    ' + Math.round(worst).toLocaleString('hu') + ' Ft');
console.log('jo piacon (valogatott): ' + Math.round(best).toLocaleString('hu') + ' Ft');
console.log('a piacvalasztas erteke: ' + Math.round(best-worst).toLocaleString('hu') + ' Ft');
console.log('');
console.log('Tippmixpro bonusz osszehasonlitaskent: ~3.900 Ft (5.000 nevertekbol)');
