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
console.log('Az algoritmus a legkisebb n-t valasztja. Ellenorizzuk, hogy az a legjobb EV:');
for(const T of [10,20,50]){
  const auto=buildSlip(pool,{target:T,maxLegs:8,poolCap:60});
  if(!auto.ok)continue;
  const prod=auto.legs.reduce((a,l)=>a*l.tippmix_odds,1);
  const jp=auto.legs.reduce((a,l)=>a*l.model_prob,1);
  console.log(`  ${String(T+'x').padEnd(6)} automatikusan ${auto.n} lab -> EV ${(jp*prod).toFixed(4)}`);
}
