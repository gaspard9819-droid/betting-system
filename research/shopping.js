// A kerdes: ha ugyanazt a fogadast adod le, de a LEGJOBB elerheto oddson
// a rossz helyett, mennyit nyersz? Ez nem jóslas - ugyanaz a fogadas, jobb ar.
const fs=require('fs');
const BOOKS=['B365','BFD','BMGM','BV','BW','CL','LB','PS','SK','SJ','VC','WH','1XB'];
function load(fp){const t=fs.readFileSync(fp,'utf8').replace(/^\ufeff/,'');
  const L=t.split(/\r?\n/).filter(x=>x.trim());if(L.length<2)return[];
  const h=L[0].split(',').map(x=>x.trim());const c={};h.forEach((x,i)=>{if(c[x]===undefined)c[x]=i;});
  return L.slice(1).map(r=>{const f=r.split(',');
    const g=n=>{const v=c[n]!==undefined?Number(f[c[n]]):NaN;return Number.isFinite(v)&&v>1?v:null;};
    const gn=n=>{const v=c[n]!==undefined?Number(f[c[n]]):NaN;return Number.isFinite(v)?v:null;};
    const q={};for(const b of BOOKS){const o=[g(b+'CH'),g(b+'CD'),g(b+'CA')];if(o.every(Boolean))q[b]=o;}
    return {hg:gn('FTHG'),ag:gn('FTAG'),q,av:[g('AvgCH'),g('AvgCD'),g('AvgCA')],mx:[g('MaxCH'),g('MaxCD'),g('MaxCA')]};})
    .filter(x=>x.hg!==null&&Object.keys(x.q).length>=5&&x.av.every(Boolean));}
let all=[];
for(const l of ['E0','D1','SP1','I1','F1'])all=all.concat(load(`${l}_2526.csv`));
for(const f of fs.readdirSync('lower').filter(x=>x.endsWith('.csv')))all=all.concat(load('lower/'+f));
console.log(`Meccsek: ${all.length}\n`);

// A "sajat kutfo" szimulacio: veletlenszeruen valasztott fogadasok a 2-3.2 savban.
// A LENYEG: ugyanazok a fogadasok, csak mas aron.
let seed=7;const rr=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648;};
const picks=[];
for(const r of all){const res=r.hg>r.ag?0:r.hg===r.ag?1:2;
  for(let k=0;k<3;k++){if(r.av[k]<2.0||r.av[k]>3.2)continue;
    if(rr()>0.35)continue;                       // valogat, mint te
    const ks=Object.keys(r.q);
    const best=Math.max(...ks.map(b=>r.q[b][k]));
    const worst=Math.min(...ks.map(b=>r.q[b][k]));
    picks.push({win:k===res,avg:r.av[k],best,worst,nb:ks.length});}}
const roi=(a,sel)=>a.reduce((s,c)=>s+(c.win?sel(c)-1:-1),0)/a.length*100;
console.log(`Szimulalt fogadasok: ${picks.length}  (ugyanazok, harom kulonbozo aron)\n`);
console.log('ugyanaz a fogadas, mas aron:');
console.log(`  legrosszabb konyvnel   ROI ${roi(picks,c=>c.worst).toFixed(2).padStart(7)}%`);
console.log(`  atlagos konyvnel       ROI ${roi(picks,c=>c.avg).toFixed(2).padStart(7)}%   <- Tippmixpro-szeru`);
console.log(`  legjobb konyvnel       ROI ${roi(picks,c=>c.best).toFixed(2).padStart(7)}%`);
const gain=roi(picks,c=>c.best)-roi(picks,c=>c.avg);
console.log(`\n  KULONBSEG (legjobb vs atlagos): ${gain>0?'+':''}${gain.toFixed(2)} szazalekpont`);
console.log('  Ez tiszta nyereseg, jóslas nelkul. Ugyanaz a tipp, jobb ar.\n');
const ao=picks.reduce((s,c)=>s+c.avg,0)/picks.length;
const bo=picks.reduce((s,c)=>s+c.best,0)/picks.length;
console.log(`  atlag odds:  ${ao.toFixed(3)}  ->  legjobb odds: ${bo.toFixed(3)}   (+${((bo/ao-1)*100).toFixed(2)}%)`);
console.log(`  atlagosan ${(picks.reduce((s,c)=>s+c.nb,0)/picks.length).toFixed(1)} konyv adott oddsot\n`);
// Mennyi az esely, hogy a legjobb ar >X%-kal jobb az atlagnal?
const gaps=picks.map(c=>c.best/c.avg-1).sort((a,b)=>a-b);
console.log('MEKKORA A RES ESETENKENT? (legjobb vs atlagos odds)');
[0.02,0.03,0.05,0.08].forEach(t=>{const n=gaps.filter(g=>g>=t).length;
  console.log(`  legalabb +${(t*100).toFixed(0)}%:  ${(n/gaps.length*100).toFixed(1)}% az eseteknek`);});
console.log(`  median res: +${(gaps[Math.floor(gaps.length/2)]*100).toFixed(2)}%`);
