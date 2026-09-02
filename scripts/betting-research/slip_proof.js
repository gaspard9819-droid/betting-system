// Igazolas: ugyanaz a cel-odds, kulonbozo labszammal. Melyik jobb?
// Merjuk a VARHATO ERTEKET: jointP * osszodds. 1.0 = break-even.
const { buildSlip } = require('./slip.js');
let seed=12345; const R=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
const pool=[];
const teams=[['Arsenal','Chelsea'],['Liverpool','Newcastle'],['Man City','Everton'],
 ['Barcelona','Sevilla'],['Real Madrid','Betis'],['Milan','Roma'],['Inter','Napoli'],
 ['Bayern','Wolfsburg'],['Dortmund','Mainz'],['PSG','Lyon'],['Marseille','Nice'],
 ['Juventus','Torino'],['Atalanta','Lazio'],['Sociedad','Valencia'],['Leipzig','Freiburg'],
 ['Villarreal','Osasuna'],['Fiorentina','Bologna'],['Lens','Rennes']];
teams.forEach((t,i)=>{
  const ph=0.28+R()*0.38,pd=0.20+R()*0.10,pa=Math.max(0.05,1-ph-pd);const s=ph+pd+pa;
  const legs=[['h2h','home','1',ph/s],['h2h','draw','X',pd/s],['h2h','away','2',pa/s],
   ['totals','over25','O2.5',0.45+R()*0.25],['totals','under25','U2.5',0],
   ['btts','btts_yes','BTTS+',0.45+R()*0.20],['btts','btts_no','BTTS-',0]];
  legs[4][3]=1-legs[3][3]; legs[6][3]=1-legs[5][3];
  legs.forEach(([m,sel,lab,p])=>{
    pool.push({leg_id:`e${i}-${m}-${sel}`,event_id:`e${i}`,match_name:`${t[0]} vs ${t[1]}`,
      market:m,selection:sel,label:lab,model_prob:Math.round(p*1000)/1000,
      market_prob:p,tippmix_odds:Math.round((1/p)/1.08*100)/100,
      confidence:R()<0.5?'MAGAS':'KOZEPES',news_flag:'ok',news_note:''});});
});
console.log(`Pool: ${pool.length} lab, ${teams.length} meccs, minden lab 8% margoval\n`);
console.log('UGYANAZ A CEL, KENYSZERITETT LABSZAMMAL:');
console.log('  cel    labak  osszodds   bejovesi esely   VARHATO ERTEK');
for(const T of [10,20,50]){
  for(const n of [2,3,4,5,6]){
    // kenyszerites: minLegOdds ugy allitva, hogy n lab kelljen
    const r=buildSlip(pool,{target:T,maxLegs:n,minLegOdds:1.15,
      poolCap:60, forceN:n});
    if(!r.ok||r.n!==n)continue;
    const prod=r.legs.reduce((a,l)=>a*l.tippmix_odds,1);
    const jp=r.legs.reduce((a,l)=>a*l.model_prob,1);
    console.log(`  ${String(T+'x').padEnd(6)} ${String(n).padStart(2)}    ${prod.toFixed(2).padStart(8)}   ${(jp*100).toFixed(2).padStart(6)}%          ${(jp*prod).toFixed(4)}`);
  }
  console.log();
}
// FONTOS: az algoritmus a legkisebb n-t valasztja, DE csak a @5.00-os puha
// odds-plafonon belul. Ahol a plafon tobb labra kenyszerit, ott az EV
// tudatosan alacsonyabb - ez a plafon ara. Ezert ket oszlopot mutatunk.
console.log('Az algoritmus a legkisebb n-t valasztja a @5.00 plafonon BELUL.');
console.log('A plafon ara latszik, ahol a ket oszlop eltér:\n');
console.log('  cel     plafonnal (eles)        plafon nelkul (regi)');
for(const T of [10,20,50]){
  const on =buildSlip(pool,{target:T,maxLegs:8,poolCap:60});
  const off=buildSlip(pool,{target:T,maxLegs:8,poolCap:60,maxLegOdds:Infinity});
  const ev=r=>{ if(!r.ok) return null;
    const prod=r.legs.reduce((a,l)=>a*l.tippmix_odds,1);
    const jp=r.legs.reduce((a,l)=>a*l.model_prob,1);
    const top=Math.max(...r.legs.map(l=>l.tippmix_odds));
    return `${r.n} lab, max @${top.toFixed(2)}, EV ${(jp*prod).toFixed(4)}`; };
  const a=ev(on), b=ev(off);
  if(!a||!b)continue;
  console.log(`  ${String(T+'x').padEnd(6)}  ${a.padEnd(26)}${b}${a!==b?'':'   (azonos)'}`);
}
console.log('\nAhol tobb lab lett: ez a tudatos csere - nincs extrem lab,');
console.log('cserebe labankent ~8% margo. Lasd workflows/README.md.');
