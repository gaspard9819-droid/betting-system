// Ellenorzes: mit valtoztat a puha @5 odds-plafon?
// Minden celra ketszer epitunk szelvenyt - plafonnal es plafon nelkul -
// es osszevetjuk a labszamot, a legdragabb labat es a bejovesi eselyt.
//
// Futtatas: node cap_check.js   (sajat szintetikus slate, nem kell adat)
const { buildSlip } = require('./slip.js');

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
    ['h2h','home','1 (hazai)', ph/s],['h2h','draw','X (dontetlen)', pd/s],['h2h','away','2 (vendeg)', pa/s],
    ['totals','over25','Over 2.5', 0.45+R()*0.25],['totals','under25','Under 2.5', 0],
    ['btts','btts_yes','BTTS igen', 0.45+R()*0.20],['btts','btts_no','BTTS nem', 0],
  ];
  legs[4][3] = 1 - legs[3][3];
  legs[6][3] = 1 - legs[5][3];
  legs.forEach(([mkt, sel, label, p]) => {
    const tippmix = (1/p) / 1.08;   // margo: az odds a fair ALATT van
    const conf = R() < 0.45 ? 'MAGAS' : R() < 0.85 ? 'KOZEPES' : 'ALACSONY';
    pool.push({ leg_id:`e${i}-${mkt}-${sel}`, event_id:`e${i}`,
      match_name:`${t[0]} vs ${t[1]}`, league:'Teszt', market:mkt, selection:sel,
      label, model_prob:Math.round(p*1000)/1000,
      market_prob:Math.round(p*0.98*1000)/1000,
      tippmix_odds:Math.round(tippmix*100)/100, confidence:conf,
      news_flag: (i===5 && sel==='home') ? 'veto' : (i===3 ? 'warn' : 'ok'), news_note:'' });
  });
});

const CAP = 5.00;
const line = (T) => {
  // plafon nelkul = nagyon magas plafon, hogy a regi viselkedest lassuk
  const off = buildSlip(pool, { target:T, maxLegs:6, maxLegOdds: Infinity });
  const on  = buildSlip(pool, { target:T, maxLegs:6 });
  const fmt = r => {
    if (!r.ok) return `NINCS (${r.reason})`.padEnd(30);
    const top = Math.max(...r.legs.map(l => l.tippmix_odds));
    const flag = top > CAP ? ' !' : '  ';
    return `${r.n} lab, legdragabb @${top.toFixed(2)}${flag} esely ${(r.jointP*100).toFixed(2)}%`.padEnd(30);
  };
  const relaxed = on.ok && on.capped_relaxed ? ' <- plafon feloldva' : '';
  console.log(`${(T+'x').padEnd(7)} REGI: ${fmt(off)} UJ: ${fmt(on)}${relaxed}`);
};

console.log('Puha @5.00 plafon hatasa (! = @5 folotti lab van a szelvenyben)\n');
[3, 5, 10, 20, 50, 100, 200, 500].forEach(line);

console.log('\nEllenorzes: az UJ oszlopban csak ott lehet "!", ahol "plafon feloldva".');
