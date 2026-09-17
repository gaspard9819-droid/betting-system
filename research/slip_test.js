const { buildSlip } = require('./slip.js');
// Realisztikus slate: 12 meccs, meccsenkent 7 lab (1X2 + O/U + BTTS)
let seed = 12345; const R = () => (seed = (seed*1103515245+12345) % 2147483648) / 2147483648;
const pool = [];
const teams = [['Arsenal','Chelsea'],['Liverpool','Newcastle'],['Man City','Everton'],
  ['Barcelona','Sevilla'],['Real Madrid','Betis'],['Milan','Roma'],['Inter','Napoli'],
  ['Bayern Munich','Wolfsburg'],['Dortmund','Mainz'],['Paris SG','Lyon'],
  ['Marseille','Nice'],['Juventus','Torino']];
teams.forEach((t, i) => {
  const ph = 0.30 + R()*0.35, pd = 0.20 + R()*0.10, pa = Math.max(0.05, 1-ph-pd);
  const s = ph+pd+pa;
  const legs = [
    ['h2h','home','1 (hazai)', ph/s],['h2h','draw','X (döntetlen)', pd/s],['h2h','away','2 (vendég)', pa/s],
    ['totals','over25','Over 2.5', 0.45+R()*0.25],['totals','under25','Under 2.5', 0],
    ['btts','btts_yes','BTTS igen', 0.45+R()*0.20],['btts','btts_no','BTTS nem', 0],
  ];
  legs[4][3] = 1 - legs[3][3];
  legs[6][3] = 1 - legs[5][3];
  legs.forEach(([mkt, sel, label, p]) => {
    const fair = 1/p;
    const tippmix = fair / (1 + 0.08);   // margo: az odds a fair ALATT van
    const conf = R() < 0.45 ? 'MAGAS' : R() < 0.85 ? 'KOZEPES' : 'ALACSONY';
    pool.push({ leg_id:`e${i}-${mkt}-${sel}`, event_id:`e${i}`,
      match_name:`${t[0]} vs ${t[1]}`, league:'Teszt', market:mkt, selection:sel,
      label, model_prob:Math.round(p*1000)/1000,
      market_prob:Math.round(p*0.98*1000)/1000,
      tippmix_odds:Math.round(tippmix*100)/100, confidence:conf,
      news_flag: (i===5 && sel==='home') ? 'veto' : (i===3 ? 'warn' : 'ok'),
      news_note: (i===5&&sel==='home')?'kulcstamado serult':'' });
  });
});
console.log(`Slate: ${pool.length} lab, ${teams.length} meccs`);
console.log(`  ALACSONY bizalmu: ${pool.filter(l=>l.confidence==='ALACSONY').length}`);
console.log(`  vetozott: ${pool.filter(l=>l.news_flag==='veto').length}`);
console.log(`  odds tartomany: ${Math.min(...pool.map(l=>l.tippmix_odds)).toFixed(2)} - ${Math.max(...pool.map(l=>l.tippmix_odds)).toFixed(2)}\n`);

const show = (nm, r, T) => {
  if (!r.ok) { console.log(`  ${nm.padEnd(26)} NINCS MEGOLDAS (${r.reason}${r.nMin?', nMin='+r.nMin:''})`); return r; }
  const prod = r.legs.reduce((a,l)=>a*l.tippmix_odds,1);
  const matches = new Set(r.legs.map(l=>l.event_id));
  const okProd = Math.abs(prod - r.prod) < 1e-9;
  const okUniq = matches.size === r.legs.length;
  const okVeto = !r.legs.some(l=>l.news_flag==='veto');
  const okLow  = !r.legs.some(l=>l.confidence==='ALACSONY');
  console.log(`  ${nm.padEnd(26)} ${r.n} lab  osszodds ${prod.toFixed(2)}x  esely ${(r.jointP*100).toFixed(2)}%  ${r.approximate?'(kozelito)':''}`);
  console.log(`  ${''.padEnd(26)} szorzat-egyezes:${okProd?'OK':'HIBA'} egy-meccs-egy-lab:${okUniq?'OK':'HIBA'} veto-kizarva:${okVeto?'OK':'HIBA'} alacsony-kizarva:${okLow?'OK':'HIBA'}`);
  return r;
};
console.log('=== CEL-ODDS TESZTEK ===');
[1.5,3,5,10,20,50,500].forEach(T=>{
  show(`/szelveny ${T}`, buildSlip(pool,{target:T}), T);
});
console.log('\n=== PARAMETEREK ===');
show('/szelveny 10 max3', buildSlip(pool,{target:10,maxLegs:3}));
show('/szelveny 10 max2', buildSlip(pool,{target:10,maxLegs:2}));
show('/szelveny 10 min2.0', buildSlip(pool,{target:10,minLegOdds:2.0}));
show('/szelveny 20 max6', buildSlip(pool,{target:20,maxLegs:6}));
console.log('\n=== LEGKEVESEBB LAB ELLENORZES ===');
const r10 = buildSlip(pool,{target:10,maxLegs:8});
console.log(`  cel 10x, maxLegs=8 -> ${r10.n} labat valasztott`);
console.log(`  -> ${r10.n<=3?'OK (nem hasznalt tobb labat a szuksegesnel)':'GYANUS'}`);
console.log('\n=== SZELSOSEGES ESETEK ===');
show('ures pool', buildSlip([],{target:10}));
show('csak ALACSONY', buildSlip(pool.filter(l=>l.confidence==='ALACSONY'),{target:10}));
show('csak vetozott', buildSlip(pool.filter(l=>l.news_flag==='veto'),{target:10}));
show('cel 1.0', buildSlip(pool,{target:1.0}));
console.log('\n=== RESZLETES: /szelveny 10 ===');
const d = buildSlip(pool,{target:10});
d.legs.forEach((l,i)=>console.log(`  ${i+1}. ${l.match_name.padEnd(24)} ${l.label.padEnd(15)} @ ${l.tippmix_odds.toFixed(2)}  piac ${(l.market_prob*100).toFixed(0)}% / modell ${(l.model_prob*100).toFixed(0)}%  ${l.confidence}${l.news_flag==='warn'?' ⚠':''}`));
const p = d.legs.reduce((a,l)=>a*l.tippmix_odds,1);
// A jointP a PIACI valoszinusegek szorzata (2026-09-12 ota), nem a modelle.
const jp = d.legs.reduce((a,l)=>a*l.market_prob,1);
console.log(`  KEZI ELLENORZES: ${d.legs.map(l=>l.tippmix_odds.toFixed(2)).join(' × ')} = ${p.toFixed(3)}`);
console.log(`  esely kezzel (PIACI p): ${d.legs.map(l=>(l.market_prob*100).toFixed(0)+'%').join(' × ')} = ${(jp*100).toFixed(2)}%  (kb. minden ${Math.round(1/jp)}. szelveny)`);
console.log(`  egyezik a buildSlip jointP-jevel: ${Math.abs(jp-d.jointP)<1e-9?'OK':'HIBA ('+d.jointP+')'}`);

// === A PIACI VALOSZINUSEG DONT, NEM A MODELLE ===
// A fenti pool market_prob-ja a model_prob 98%-a, igy a ket rangsor majdnem
// azonos - abbol nem latszana a valtas. Itt SZANDEKOSAN szembeallitjuk oket:
// ket azonos oddsu lab, ahol a modell az egyiket, a piac a masikat szereti.
console.log('\n=== A PIACI VALOSZINUSEG DONT (nem a modell) ===');
const mk = (id, mp, kp) => ({ leg_id:id, event_id:id, match_name:`Teszt ${id}`, league:'Teszt',
  market:'h2h', selection:'home', label:'1 (hazai)', model_prob:mp, market_prob:kp,
  tippmix_odds:2.00, confidence:'KOZEPES', news_flag:'ok', news_note:'' });
// Mindketto @2.00, a cel 4x -> pont ket lab kell, harombol valaszt kettot.
// A "csali" labat a modell szereti a legjobban, a piac a legkevesbe.
const clash = [ mk('A', 0.90, 0.40), mk('B', 0.30, 0.55), mk('C', 0.31, 0.54) ];
const rc = buildSlip(clash, { target: 4.0, maxLegs: 2, minLegs: 2 });
const chosen = rc.ok ? rc.legs.map(l=>l.leg_id).sort().join('') : 'NINCS';
console.log(`  harom @2.00 lab, cel 4x -> valasztott: ${chosen}`);
console.log(`  -> ${chosen==='BC' ? 'OK (a ket legjobb PIACI valoszinuseget valasztotta)' : 'HIBA: a modell csalijat (A) valasztotta'}`);
console.log(`  jointP = ${rc.ok?rc.jointP.toFixed(4):'-'}  (piaci: 0.55 × 0.54 = ${(0.55*0.54).toFixed(4)}, modell lenne: 0.30 × 0.31 = ${(0.30*0.31).toFixed(4)})`);

// Hianyzo market_prob: 1/odds a visszaeses, sosem a model_prob.
const noMkt = [ { ...mk('D', 0.90, 0.40), market_prob: null },
                { ...mk('E', 0.10, 0.50), market_prob: undefined } ];
const rn = buildSlip(noMkt, { target: 4.0, maxLegs: 2, minLegs: 2 });
console.log(`  hianyzo market_prob -> ${rn.ok ? 'megoldas van, jointP '+rn.jointP.toFixed(4)+' (1/2.00 × 1/2.00 = 0.2500)' : 'NINCS MEGOLDAS'}`);
console.log(`  -> ${rn.ok && Math.abs(rn.jointP-0.25)<1e-9 ? 'OK (1/odds visszaeses, nem a model_prob)' : 'HIBA'}`);
