// KERDES: a 2-3 szorzos savban a modell mennyivel jobb, mint fogadas sajat kutfobol?
const fs=require('fs');
const {parseCsv}=require('./parse.js'),{computeRatings}=require('./ratings.js'),{predictMatch}=require('./predict.js');
function pw(raw,l,s){const t=raw.replace(/^\ufeff/,'');const L=t.split(/\r?\n/).filter(x=>x.trim());
  const h=L[0].split(',').map(x=>x.trim());const c={};h.forEach((x,i)=>{if(c[x]===undefined)c[x]=i;});
  const base=parseCsv(raw,l,s);const bk={};
  for(let i=1;i<L.length;i++){const f=L[i].split(',');
    const H=(f[c['HomeTeam']]||'').trim(),A=(f[c['AwayTeam']]||'').trim();if(!H||!A)continue;
    const g=(n1,n2)=>{const v=c[n1]!==undefined?Number(f[c[n1]]):NaN;if(Number.isFinite(v)&&v>1)return v;
      const w=c[n2]!==undefined?Number(f[c[n2]]):NaN;return Number.isFinite(w)&&w>1?w:null;};
    bk[`${(f[c['Date']]||'').trim()}|${H}|${A}`]={av:[g('AvgCH','AvgH'),g('AvgCD','AvgD'),g('AvgCA','AvgA')],
      ps:[g('PSCH','PSH'),g('PSCD','PSD'),g('PSCA','PSA')]};}
  return base.map(m=>{const d=new Date(m.date),dd=String(d.getUTCDate()).padStart(2,'0'),mm=String(d.getUTCMonth()+1).padStart(2,'0');
    const k1=`${dd}/${mm}/${d.getUTCFullYear()}|${m.home}|${m.away}`,k2=`${dd}/${mm}/${String(d.getUTCFullYear()).slice(2)}|${m.home}|${m.away}`;
    return {...m,...(bk[k1]||bk[k2]||{})};});}
let all=[];for(const s of ['2526','2627'])for(const l of ['E0','D1','SP1','I1','F1'])
  all=all.concat(pw(fs.readFileSync(`${l}_${s}.csv`,'utf8'),l,s));
all.sort((a,b)=>new Date(a.date)-new Date(b.date));

const LO=2.0,HI=3.2;  // a celzott szorzo sav
let ratings=null,at=null;
const cand=[];  // minden 2-3.2 szorzos kimenetel, modell-velemennyel
for(let i=0;i<all.length;i++){const m=all[i];
  if(i<200||!m.av||!m.av.every(Boolean))continue;
  if(!at||(new Date(m.date)-at)>7*864e5){ratings=computeRatings(all.slice(0,i),m.date);at=new Date(m.date);}
  const R={};ratings.forEach(r=>R[r.league+'|'+r.team]=r);
  const hr=R[m.league+'|'+m.home],ar=R[m.league+'|'+m.away];
  if(!hr||!ar||hr.matches<8||ar.matches<8)continue;
  const p=predictMatch(hr,ar,hr.league_avg_goals,hr.home_advantage);
  const mp=[p.home,p.draw,p.away];
  const ip=m.ps&&m.ps.every(Boolean)?m.ps.map(x=>1/x):m.av.map(x=>1/x);
  const ov=ip.reduce((a,b)=>a+b,0),fair=ip.map(x=>x/ov);
  const res=m.hg>m.ag?0:m.hg===m.ag?1:2;
  for(let k=0;k<3;k++){if(m.av[k]<LO||m.av[k]>HI)continue;
    cand.push({odds:m.av[k],mp:mp[k],fair:fair[k],win:k===res,ev:mp[k]*m.av[k]-1,
      edge:mp[k]-1/m.av[k]});}}
console.log(`A ${LO}-${HI} szorzos savban ${cand.length} fogadhato kimenetel\n`);
const roi=a=>a.length?a.reduce((s,c)=>s+(c.win?c.odds-1:-1),0)/a.length*100:null;
const hit=a=>a.length?a.filter(c=>c.win).length/a.length*100:null;
const show=(nm,a)=>{const r=roi(a);
  console.log(`  ${nm.padEnd(42)} ${String(a.length).padStart(5)} fogadas   ROI ${r===null?'-':r.toFixed(2).padStart(7)+'%'}   talalat ${hit(a)===null?'-':hit(a).toFixed(1)+'%'}`);};
console.log('ALAPVONAL — "SAJAT KUTFO" PROXYK');
show('minden 2-3.2 szorzos kimenetel', cand);
// veletlenszeru valogatas: 30%-ot fogad meg (mint aki valogat, de nem tud tobbet)
const rnd=[];let seed=42;const rr=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648;};
for(const c of cand)if(rr()<0.3)rnd.push(c);
show('veletlen 30% valogatas (nincs tudas)', rnd);
console.log('\nMODELL SZERINTI VALOGATAS');
for(const th of [0,0.03,0.06,0.10,0.15]){
  const sel=cand.filter(c=>c.ev>th);
  show(`modell EV > ${(th*100).toFixed(0)}%`, sel);}
console.log('\nMODELL — de csak ahol a modell ES a piac is egyetert (kettos kapu)');
for(const th of [0.03,0.06,0.10]){
  const sel=cand.filter(c=>c.ev>th&&c.fair>1/c.odds);
  show(`kettos kapu, EV > ${(th*100).toFixed(0)}%`, sel);}
console.log('\nKONTROLL: mi lenne, ha a modell ELLEN fogadnank? (ha ez jobb, a modell fordítva mukodik)');
for(const th of [0.10]){const sel=cand.filter(c=>c.ev< -th);show(`modell EV < -${(th*100).toFixed(0)}%`,sel);}
console.log('\nA MODELL RANGSOROLO KEPESSEGE (a savon belul)');
const srt=[...cand].sort((a,b)=>b.edge-a.edge);const q=Math.floor(srt.length/4);
['legjobb 25%','2. negyed','3. negyed','legrosszabb 25%'].forEach((nm,i)=>{
  show(nm, srt.slice(i*q,(i+1)*q));});
