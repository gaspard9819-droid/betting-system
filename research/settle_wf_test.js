// A Bet Settlement workflow Code node-jainak lokalis futtatasa VALOS adaton.
// Futtatas: node settle_wf_test.js  (a betting-research gyokerbol)
//
// A workflow JSON-jabol olvassa a node kodot, tehat a TENYLEGES node-ot
// teszteli, nem egy masolatot.
const fs = require('fs');

const WFDIR = 'C:/Users/AMD/Desktop/betting-system/workflows/';
const SRC = 'C:/Users/AMD/Desktop/betting-system/research/';
const wf = JSON.parse(fs.readFileSync(WFDIR + 'Bet Settlement.json', 'utf8'));
const codeOf = (name) => wf.nodes.find(n => n.name === name).parameters.jsCode;

let pass = 0, fail = 0;
const ok = (c, name, extra) => {
  if (c) pass++; else { fail++; console.log('  BUKOTT: ' + name + (extra ? '\n    ' + extra : '')); }
};

// ---- valos CSV-k, ugy ahogy a HTTP node adna ----
const LEAGUES = [
  { code: 'E0', name: 'Premier League' }, { code: 'SP1', name: 'La Liga' },
  { code: 'D1', name: 'Bundesliga' }, { code: 'I1', name: 'Serie A' },
  { code: 'F1', name: 'Ligue 1' },
];
const HOSTS = ['www.football-data.co.uk', 'football-data.co.uk'];
const SEASON = '2627';

function makeHttpAndConfig(opts) {
  const o = opts || {};
  const cfg = [], http = [];
  for (const lg of LEAGUES) {
    for (const host of HOSTS) {
      cfg.push({ url: 'https://' + host + '/mmz4281/' + SEASON + '/' + lg.code + '.csv',
                 host, key: lg.code, league: lg.code, league_name: lg.name, season: SEASON });
      const failThis = o.failHost === host || o.failAll ||
                       (o.failLeague === lg.code && o.failLeagueHosts !== false);
      // A VALOS alak: a HTTP node a text/csv torzset `data` neven adja vissza,
      // nem `body` neven. Az elso valtozat itt `body`-t hasznalt, es a teszt
      // ezert a sajat feltevesét igazolta vissza - 76 ellenorzes ment at ugy,
      // hogy az elso eles futas (execution 156) azonnal elbukott rajta.
      // Amit a node lat, azt kell adni neki.
      if (failThis) {
        http.push({ statusCode: 503, headers: { 'retry-after': '348' }, data: 'Service Unavailable' });
      } else {
        const f = SRC + 'data/' + lg.code + '_' + SEASON + '.csv';
        http.push({ statusCode: 200, headers: { 'content-type': 'text/csv' },
                    data: fs.readFileSync(f, 'utf8') });
      }
    }
  }
  return { cfg, http };
}

// ---- szelvenyek: a Build Response VALODI kimenetebol ----
const slipCode = JSON.parse(fs.readFileSync(WFDIR + 'Slip Builder.json', 'utf8'))
  .nodes.find(n => n.name === 'Build Response').parameters.jsCode;
const snapRaw = JSON.parse(fs.readFileSync(SRC + 'snapshots/bet_slate_2026-09-08T16-10Z.json', 'utf8'));
const slateRows = Array.isArray(snapRaw) ? snapRaw : (snapRaw.data || snapRaw.rows || []);

const RealDate = Date;
const FAKE = new RealDate('2026-09-05T09:00:00.000Z').getTime();
function withFakeNow(fn) {
  const D = global.Date, now = Date.now;
  global.Date = class extends RealDate {
    constructor(...a) { return a.length ? new RealDate(...a) : new RealDate(FAKE); }
    static now() { return FAKE; }
  };
  try { return fn(); } finally { global.Date = D; Date.now = now; }
}

function buildSlip(target) {
  return withFakeNow(() => {
    const cmd = { user_id: '1', command: 'szelveny', target };
    const fake = { 'Verify & Parse': { first: () => ({ json: cmd }), all: () => [{ json: cmd }] } };
    const fn = new Function('$', '$input', '$json', slipCode);
    return fn((n) => fake[n], { all: () => slateRows.map(json => ({ json })) }, {})[0].json._slip;
  });
}

// A data table sorok alakja: a mentett fej + labak, id-vel (a tabla adja).
let rowId = 1;
function toRows(slip) {
  const head = Object.assign({}, slip, { id: rowId++ });
  delete head.legs;
  head.payout = 0; head.profit = 0;
  const legs = slip.legs.map(l => Object.assign({}, l, { id: rowId++ }));
  return { head, legs };
}

// ---- a node-ok futtatasa ----
function runSettle(ctx) {
  const fake = {
    'Fetch Results':  { all: () => ctx.http.map(json => ({ json })) },
    'Config':         { all: () => ctx.cfg.map(json => ({ json })) },
    'Get Open Slips': { all: () => ctx.slips.map(json => ({ json })) },
    'Get Open Legs':  { all: () => ctx.legs.map(json => ({ json })) },
  };
  const $ = (n) => { if (!fake[n]) throw new Error('ismeretlen node: ' + n); return fake[n]; };
  const fn = new Function('$', '$input', slipNowPatch(codeOf('Settle Legs')));
  return fn($, { all: () => [], first: () => ({ json: {} }) })[0].json;
}
// A settleLeg a valos "most"-ot hasznalja; a teszthez a meccsek utanra
// visszük. 2026-09-12 (ma) mar joval a 09-05..09 -i meccsek utan van,
// tehat nem kell hamisitani - de rogzitjuk, hogy ne legyen idofuggo.
function slipNowPatch(code) { return code; }

function runReport(settleOut, allSlips) {
  const fake = { 'Settle Legs': { first: () => ({ json: settleOut }) } };
  const $ = (n) => fake[n];
  const fn = new Function('$', '$input', codeOf('Build Report'));
  return fn($, { all: () => allSlips.map(json => ({ json })) })[0].json;
}

// =====================================================================
console.log('1) VALOS CSV + valos szelvenyek');
// =====================================================================
{
  const { cfg, http } = makeHttpAndConfig();
  const slips = [], legs = [];
  const built = [];
  for (const t of [3, 5, 10, 20, 50]) {
    const s = buildSlip(t);
    if (!s) continue;
    const r = toRows(s);
    slips.push(r.head); legs.push(...r.legs); built.push(s);
  }
  console.log('  ' + slips.length + ' szelveny, ' + legs.length + ' lab');

  const out = runSettle({ cfg, http, slips, legs });
  console.log('  ligak betoltve: ' + out.leagues_loaded.length + ' / 5');
  console.log('  lab statuszok: ' + JSON.stringify(out.leg_tally));
  console.log('  szelveny statuszok: ' + JSON.stringify(out.slip_tally));
  if (out.problems.length) { console.log('  PROBLEMAK:'); out.problems.forEach(p => console.log('    ' + p)); }
  if (out.fetch_errors.length) { console.log('  LETOLTESI HIBAK: ' + out.fetch_errors.join(' | ')); }

  ok(out.leagues_loaded.length === 5, 'mind az 5 liga betoltve');
  ok(out.fetch_errors.length === 0, 'nincs letoltesi hiba');
  ok(out.problems.length === 0, 'nincs feloldhatatlan lab', JSON.stringify(out.problems));
  ok(out.leg_tally.unresolvable === undefined || out.leg_tally.unresolvable === 0,
     'nulla unresolvable');
  ok(out.leg_tally.still_open === undefined || out.leg_tally.still_open === 0,
     'minden lab lezarult (a meccsek regen lementek)');
  ok(out.slip_tally.open === undefined || out.slip_tally.open === 0,
     'minden szelveny lezarult');

  // Kezi ellenorzes: minden szelvenyre kiszamoljuk a helyes eredmenyt a
  // labak statuszabol, es osszevetjuk azzal, amit a node mondott.
  const legStatus = {};
  for (const u of out.leg_updates) legStatus[u.leg_id] = u.status;
  for (const head of slips) {
    const own = legs.filter(l => l.slip_id === head.slip_id);
    const sts = own.map(l => legStatus[l.leg_id]);
    const expect = sts.includes('lost') ? 'lost' : (sts.every(s => s === 'won') ? 'won' : 'open');
    const got = out.slip_updates.find(u => u.slip_id === head.slip_id);
    ok(got && got.status === expect,
       head.target + 'x: ' + expect + ' (labak: ' + sts.join(',') + ')',
       got ? 'kapott: ' + got.status : 'nincs frissites');
    if (got && got.status === 'won') {
      ok(Math.abs(got.payout - head.stake * head.total_odds) < 0.02,
         head.target + 'x: kifizetes = tet x odds');
      ok(Math.abs(got.profit - (got.payout - head.stake)) < 0.02, head.target + 'x: profit');
    }
    if (got && got.status === 'lost') {
      ok(got.payout === 0 && got.profit === -head.stake, head.target + 'x: bukott -> -tet');
    }
  }

  // Jelentes
  const settled = slips.map(h => {
    const u = out.slip_updates.find(x => x.slip_id === h.slip_id);
    return Object.assign({}, h, u ? { status: u.status, payout: u.payout, profit: u.profit } : {});
  });
  const rep = runReport(out, settled);
  console.log('\n  --- jelentes ---');
  console.log(rep.message.split('\n').map(l => '  | ' + l).join('\n'));

  // A jelentes szamai egyezzenek a kezi szamolassal
  const closed = settled.filter(s => s.status === 'won' || s.status === 'lost');
  const won = closed.filter(s => s.status === 'won');
  ok(rep.stats.closed === closed.length, 'jelentes: lezart szam');
  ok(rep.stats.won === won.length, 'jelentes: nyert szam');
  const staked = closed.reduce((a, s) => a + s.stake, 0);
  const ret = closed.reduce((a, s) => a + (s.payout || 0), 0);
  ok(rep.stats.staked === staked, 'jelentes: megtett tet');
  ok(Math.abs(rep.stats.returned - ret) < 0.02, 'jelentes: visszajott');
  ok(Math.abs(rep.stats.profit - (ret - staked)) < 0.02, 'jelentes: eredmeny');
  ok(rep.message.length <= 2000, 'jelentes befer a Discord limitbe (' + rep.message.length + ')');
}

// =====================================================================
console.log('\n2) URES bemenet: nincs szelveny, nincs lab');
// =====================================================================
{
  const { cfg, http } = makeHttpAndConfig();
  const out = runSettle({ cfg, http, slips: [], legs: [] });
  ok(out.legs_seen === 0 && out.slips_seen === 0, 'ures: 0 lab, 0 szelveny');
  ok(out.leg_updates.length === 0 && out.slip_updates.length === 0, 'ures: nincs frissites');
  ok(out.problems.length === 0, 'ures: nincs problema');
  ok(out.leagues_loaded.length === 5, 'ures: a ligak akkor is betoltodnek');
  const rep = runReport(out, []);
  ok(/Meg nincs lezart szelveny/.test(rep.message), 'ures: ertelmes jelentes');
  ok(rep.stats.win_rate === null, 'ures: nyeresi arany null, nem 0%');
  console.log('  jelentes: ' + rep.message.split('\n').filter(l => l.trim()).join(' / '));
}

// =====================================================================
console.log('\n2b) A HTTP valasz torzse: data ES body alakban is');
// =====================================================================
{
  // Execution 156 (2026-09-15) ezen bukott el: a node `body`-t keresett,
  // az n8n `data`-t adott, es mind a 10 hibatlan 200-as valasz
  // "hasznalhatatlan valasz" lett. Nulla sor irodott - a guard jol mukodott -,
  // de az elszamolas soha nem futott volna le. Mindket alakot atvisszuk.
  for (const key of ['data', 'body']) {
    const { cfg, http } = makeHttpAndConfig();
    const remapped = http.map(r => {
      const v = r.data !== undefined ? r.data : r.body;
      const o = { statusCode: r.statusCode, headers: r.headers };
      o[key] = v;
      return o;
    });
    const out = runSettle({ cfg, http: remapped, slips: [], legs: [] });
    ok(out.leagues_loaded.length === 5, key + ': mind az 5 liga betolt');
    ok(out.fetch_errors.length === 0, key + ': nincs fetch hiba');
  }
  // A nyers objektum (egyik kulcs sincs) viszont HELYESEN bukjon el.
  const { cfg, http } = makeHttpAndConfig();
  const junk = http.map(r => ({ statusCode: r.statusCode, headers: r.headers, valami: r.data }));
  const out = runSettle({ cfg, http: junk, slips: [], legs: [] });
  ok(out.leagues_loaded.length === 0, 'ismeretlen kulcs: egy liga sem tolt be');
  ok(out.fetch_errors.length === 5, 'ismeretlen kulcs: mind az 5 liga hibat jelent');
}

// =====================================================================
console.log('\n3) A data table ures sort ad (alwaysOutputData)');
// =====================================================================
{
  const { cfg, http } = makeHttpAndConfig();
  // Az n8n ures data table eseten {} -t adhat vissza az alwaysOutputData miatt.
  const out = runSettle({ cfg, http, slips: [{}], legs: [{}] });
  ok(out.slips_seen === 0, 'ures objektum kiszurve a szelvenyekbol');
  ok(out.legs_seen === 0, 'ures objektum kiszurve a labakbol');
  ok(out.problems.length === 0, 'ures objektum nem general problemat');
}

// =====================================================================
console.log('\n4) MINDEN letoltes elbukik');
// =====================================================================
{
  const { cfg, http } = makeHttpAndConfig({ failAll: true });
  const s = buildSlip(10); const r = toRows(s);
  const out = runSettle({ cfg, http, slips: [r.head], legs: r.legs });
  ok(out.leagues_loaded.length === 0, 'nincs betoltott liga');
  ok(out.fetch_errors.length === 5, '5 ligara jon hiba', JSON.stringify(out.fetch_errors));
  ok(/Retry-After/.test(out.fetch_errors[0]), 'a hiba tartalmazza a Retry-After-t');
  // A LENYEG: egyetlen lab sem lesz "lost" attol, hogy nincs adat.
  ok(out.leg_updates.length === 0, 'nincs labfrissites adat nelkul');
  ok(out.leg_tally.lost === undefined || out.leg_tally.lost === 0,
     'NULLA lab nem lett vesztesnek allitva adat nelkul');
  ok(out.leg_tally.still_open === r.legs.length, 'minden lab nyitva marad');
  const su = out.slip_updates.find(u => u.slip_id === r.head.slip_id);
  ok(su && su.status === 'open', 'a szelveny nyitva marad');
  console.log('  hibak: ' + out.fetch_errors.slice(0, 2).join(' | '));
  // es az or ezt kifogja
  const guard = wf.nodes.find(n => n.name === 'Results Usable');
  ok(/leagues_loaded\.length/.test(JSON.stringify(guard.parameters)), 'az or a leagues_loaded-ot nezi');
}

// =====================================================================
console.log('\n5) EGY hoszt bukik, a masik nem (a 2026-09-08-i eset)');
// =====================================================================
{
  const { cfg, http } = makeHttpAndConfig({ failHost: 'www.football-data.co.uk' });
  const s = buildSlip(10); const r = toRows(s);
  const out = runSettle({ cfg, http, slips: [r.head], legs: r.legs });
  ok(out.leagues_loaded.length === 5, 'a fallback hoszt megmenti mind az 5 ligat');
  ok(out.fetch_errors.length === 0, 'nincs hiba, ha a masodik hoszt valaszol');
  ok(out.leg_updates.length === r.legs.length, 'minden lab elszamolva');
  console.log('  ligak: ' + out.leagues_loaded.join(', '));
}

// =====================================================================
console.log('\n6) EGY liga bukik mindket hoszton');
// =====================================================================
{
  const { cfg, http } = makeHttpAndConfig({ failLeague: 'SP1' });
  // Tobb celbol epitunk, hogy BIZTOSAN legyen La Liga lab is: az 50x
  // szelveny egymaga veletlenul sem tartalmazott egyet sem, es a teszt
  // igy vakon atmeent.
  const slips = [], legs = [];
  for (const t of [3, 5, 10, 20, 50]) {
    const s = buildSlip(t); if (!s) continue;
    s.slip_id += '-' + slips.length; s.legs.forEach(l => { l.slip_id = s.slip_id; });
    const r = toRows(s); slips.push(r.head); legs.push(...r.legs);
  }
  const laligaLegs = legs.filter(l => l.league === 'La Liga');
  ok(laligaLegs.length > 0, 'a teszt tenyleg tartalmaz La Liga labat (' + laligaLegs.length + ')');
  const otherLegs = legs.filter(l => l.league !== 'La Liga');

  const out = runSettle({ cfg, http, slips, legs });
  ok(out.leagues_loaded.length === 4, '4 liga betoltve');
  ok(!out.leagues_loaded.includes('La Liga'), 'a La Liga NINCS a betoltottak kozt');
  ok(out.fetch_errors.length === 1 && /La Liga/.test(out.fetch_errors[0]),
     'a La Liga hibaja jelentve', JSON.stringify(out.fetch_errors));
  // A La Liga labai nyitva maradnak - NEM lesznek vesztesek adat nelkul.
  const closed = out.leg_updates.map(u => u.leg_id);
  for (const l of laligaLegs) ok(!closed.includes(l.leg_id), 'La Liga lab nyitva marad: ' + l.match_name);
  // A tobbi liga viszont elszamolodik: a hiba nem all le az egesz futast.
  ok(out.leg_updates.length === otherLegs.length,
     'a tobbi liga minden labja lezarva (' + out.leg_updates.length + '/' + otherLegs.length + ')');
  // Az erintett szelvenyek nyitva maradnak, a nem erintettek lezarodnak.
  for (const h of slips) {
    const own = legs.filter(l => l.slip_id === h.slip_id);
    const hasLaLiga = own.some(l => l.league === 'La Liga');
    const u = out.slip_updates.find(x => x.slip_id === h.slip_id);
    // Kiveve, ha egy MAS labja mar bukott: az azonnal lezarja a szelvenyt,
    // es ez helyes - a La Liga eredmenye mar nem valtoztat rajta.
    const otherLost = own.some(l => l.league !== 'La Liga'
      && out.leg_updates.find(x => x.leg_id === l.leg_id && x.status === 'lost'));
    if (hasLaLiga && !otherLost) {
      ok(u.status === 'open', h.target + 'x: La Liga labbal nyitva marad');
    } else if (otherLost) {
      ok(u.status === 'lost', h.target + 'x: mas labja bukott -> lezarva La Liga nelkul is');
    }
  }
  console.log('  ' + laligaLegs.length + ' La Liga lab nyitva, ' + out.leg_updates.length + ' mas lab lezarva');
}

// =====================================================================
console.log('\n7) TOBB ITEM: sok szelveny egyszerre, kozos labakkal');
// =====================================================================
{
  const { cfg, http } = makeHttpAndConfig();
  const slips = [], legs = [];
  // Ugyanazt a celt ketszer: azonos labak, KULONBOZO slip_id.
  for (const t of [3, 3, 10, 10, 20, 50]) {
    const s = buildSlip(t); if (!s) continue;
    // a slip_id egyedivé tetele (valosagban az idobelyeg teszi azza)
    s.slip_id = s.slip_id + '-' + slips.length;
    s.legs.forEach(l => { l.slip_id = s.slip_id; });
    const r = toRows(s); slips.push(r.head); legs.push(...r.legs);
  }
  const out = runSettle({ cfg, http, slips, legs });
  ok(out.slips_seen === slips.length, 'minden szelveny latva (' + slips.length + ')');
  ok(out.legs_seen === legs.length, 'minden lab latva (' + legs.length + ')');
  ok(out.slip_updates.length === slips.length, 'minden szelveny frissitve');
  ok(out.leg_updates.length === legs.length, 'minden lab frissitve');
  // A KETTOZOTT szelvenyek ugyanazt az eredmenyt adjak (azonos labak)
  const byTarget = {};
  for (const h of slips) {
    const u = out.slip_updates.find(x => x.slip_id === h.slip_id);
    (byTarget[h.target] = byTarget[h.target] || []).push(u.status);
  }
  for (const [t, sts] of Object.entries(byTarget)) {
    if (sts.length > 1) ok(new Set(sts).size === 1, t + 'x: azonos labak -> azonos eredmeny (' + sts.join(',') + ')');
  }
  console.log('  ' + slips.length + ' szelveny / ' + legs.length + ' lab elszamolva');
  const settled = slips.map(h => {
    const u = out.slip_updates.find(x => x.slip_id === h.slip_id);
    return Object.assign({}, h, { status: u.status, payout: u.payout, profit: u.profit });
  });
  const rep = runReport(out, settled);
  ok(rep.stats.closed === slips.length, 'jelentes: minden szelveny lezart');
  ok(rep.message.length <= 2000, 'jelentes befer (' + rep.message.length + ')');
  console.log('  nyeresi arany: ' + rep.stats.win_rate + '%, eredmeny: ' + rep.stats.profit + ' Ft');
  // cel szerinti bontas
  ok(rep.by_band.length >= 2, 'van cel szerinti bontas (' + rep.by_band.length + ' sav)');
}

// =====================================================================
console.log('\n8) HIBAS payload: szemet a sorokban');
// =====================================================================
{
  const { cfg, http } = makeHttpAndConfig();
  const bad = [
    { slip_id: 'x1', leg_id: 'nincs-ilyen', match_name: 'Nemletezo FC vs Masik FC',
      league: 'Premier League', kickoff: '2026-09-05T11:30:00.000Z',
      market: 'h2h', selection: 'home', odds: 2, id: 900 },
    { slip_id: 'x2', leg_id: 'rossz-datum', match_name: 'Arsenal vs Chelsea',
      league: 'Premier League', kickoff: 'ez nem datum',
      market: 'h2h', selection: 'home', odds: 2, id: 901 },
    { slip_id: 'x3', leg_id: 'rossz-piac', match_name: 'Arsenal vs Chelsea',
      league: 'Premier League', kickoff: '2026-08-30T14:00:00.000Z',
      market: 'corners', selection: 'over95', odds: 2, id: 902 },
    { slip_id: 'x4', leg_id: 'rossz-nev', match_name: 'nincs benne szeparator',
      league: 'Premier League', kickoff: '2026-08-30T14:00:00.000Z',
      market: 'h2h', selection: 'home', odds: 2, id: 903 },
  ];
  const heads = ['x1', 'x2', 'x3', 'x4'].map((id, i) => ({
    slip_id: id, target: 2, total_odds: 2, leg_count: 1, stake: 1000,
    status: 'open', id: 950 + i,
  }));
  const out = runSettle({ cfg, http, slips: heads, legs: bad });
  ok(out.problems.length === 4, 'mind a 4 hibas lab jelentve', JSON.stringify(out.problems));
  ok(out.leg_updates.length === 0, 'hibas lab NEM kap statuszt');
  // A LENYEG: egyetlen hibas szelveny sem lesz nyertes vagy vesztes.
  for (const u of out.slip_updates) {
    ok(u.status === 'open', u.slip_id + ': hibas lab -> a szelveny nyitva marad (kapott: ' + u.status + ')');
    ok(u.open_reason === 'leg_unresolvable', u.slip_id + ': az ok rogzitve');
  }
  console.log('  problemak:'); out.problems.forEach(p => console.log('    ' + p));
  // a jelentes megjeleniti oket
  const rep = runReport(out, heads);
  ok(/Feloldhatatlan/.test(rep.message), 'a jelentes kiirja a problemakat');
}

// =====================================================================
console.log('\n9) IDEMPOTENCIA: ketszer futtatva ugyanaz');
// =====================================================================
{
  const { cfg, http } = makeHttpAndConfig();
  const s = buildSlip(10); const r = toRows(s);
  const a = runSettle({ cfg, http, slips: [r.head], legs: r.legs });
  const b = runSettle({ cfg, http, slips: [r.head], legs: r.legs });
  const norm = (o) => JSON.stringify({
    leg: o.leg_updates.map(u => [u.leg_id, u.status, u.score]),
    slip: o.slip_updates.map(u => [u.slip_id, u.status, u.payout, u.profit]),
  });
  ok(norm(a) === norm(b), 'ket futas ugyanazt adja');

  // Es a MASODIK futas, amikor a labak mar lezarodtak: a szelveny akkor is
  // helyesen szamolodik el. Ez a valos eset, mert a labak elobb zarodnak.
  const legStatus = {};
  for (const u of a.leg_updates) legStatus[u.leg_id] = u.status;
  const closedLegs = r.legs.filter(l => legStatus[l.leg_id] === 'won');
  const stillOpen = r.legs.filter(l => legStatus[l.leg_id] !== 'won');
  // csak a nyitva maradtak jonnek vissza a tablabol
  const c = runSettle({ cfg, http, slips: [r.head], legs: stillOpen });
  const au = a.slip_updates[0], cu = c.slip_updates[0];
  ok(au.status === cu.status, 'reszben lezart labakkal ugyanaz az eredmeny ('
     + au.status + ' vs ' + cu.status + ')',
     'a mar lezart ' + closedLegs.length + ' labat a leg_count-bol szamolja');
}

// =========================================================
console.log('\nJ) kupa-labak: elszamolhatatlan, de nem ragad nyitva');
// =========================================================
// A BL/EL/KL labaknak nincs eredmeny-forrasa (a football-data.co.uk csak
// bajnoksagokat ad). A veszely nem az, hogy rosszul szamoljuk el, hanem hogy
// OROKRE nyitva maradnak: a 'still_open' agon minden futas ujraprobalna, a
// nyitott szelvenyek szama csendben nőne, es a statisztika ugy nezne ki,
// mintha meg varnank valamire, ami sosem jon meg.
{
  const cfg = [], http = [];
  const kupaLeg = {
    id: 9001, slip_id: 'slip-kupa-teszt', leg_id: 'ev1-h2h-home',
    match_name: 'Milan vs Benfica', league: 'EL, csoportkör',
    kickoff: '2026-09-01T19:00:00.000Z',        // joval a teszt "most"-ja elott
    market: 'h2h', selection: 'home', label: '1 (hazai)',
    odds: 2.1, model_prob: null, market_prob: 0.47,
    confidence: 'KUPA', status: 'open', reason: '', score: '',
  };
  const kupaSlip = {
    id: 9000, slip_id: 'slip-kupa-teszt', issued_at: '2026-08-30T10:00:00.000Z',
    target: 2, total_odds: 2.1, leg_count: 1, stake: 1000, hit_prob: 0.47,
    capped_relaxed: 'nem', status: 'open', open_reason: 'legs_pending',
    payout: 0, profit: 0,
  };

  const out = runSettle({ cfg, http, slips: [kupaSlip], legs: [kupaLeg] });
  const lu = out.leg_updates.find(u => u.leg_id === 'ev1-h2h-home');
  ok(lu && lu.status === 'unsettleable',
     'a kupa-lab unsettleable, nem still_open', lu && lu.status);

  const su = out.slip_updates.find(u => u.slip_id === 'slip-kupa-teszt');
  ok(su && su.status === 'unsettleable',
     'a szelveny is unsettleable lesz', su && su.status);
  // EZ a lenyeg: ha 'open'-kent irnank vissza, a Get Open Slips holnap ujra
  // behuzna, es a ciklus sosem allna meg.
  ok(su && su.status !== 'open',
     'NEM irjuk vissza open-kent (kulonben orokre ujraprobalna)');
  ok(su && su.settled_at,
     'a settled_at ki van toltve - az elszamolas megtortent, csak nem merheto');

  // A bukott lab erosebb: egy kupa-labas szelveny, aminek egy masik labja
  // mar bukott, BUKOTT - igy a kupa-labas szelvenyek egy resze merheto marad.
  const vesztoLeg = Object.assign({}, kupaLeg, {
    id: 9002, leg_id: 'ev2-h2h-home', match_name: 'Arsenal vs Chelsea',
    league: 'Premier League', confidence: 'MAGAS', selection: 'away',
  });
  const ketLabas = Object.assign({}, kupaSlip, { slip_id: 'slip-kupa-vegyes', id: 9003, leg_count: 2 });
  const legs2 = [
    Object.assign({}, kupaLeg, { id: 9004, slip_id: 'slip-kupa-vegyes' }),
    Object.assign({}, vesztoLeg, { id: 9005, slip_id: 'slip-kupa-vegyes' }),
  ];
  const out2 = runSettle({ cfg, http, slips: [ketLabas], legs: legs2 });
  const su2 = out2.slip_updates.find(u => u.slip_id === 'slip-kupa-vegyes');
  // A Premier League lab eredmenye nincs meg (nincs http adat), tehat
  // still_open - a szelveny igy unsettleable, nem lost. A sorrend akkor
  // szamit, ha a masik lab MAR bukott; azt a settle_test.js fedi le.
  ok(su2 && su2.status === 'unsettleable',
     'vegyes szelveny (kupa + rendes, eredmeny nelkul): unsettleable', su2 && su2.status);

  // A jelentes ne nyelje le: ha nem irjuk ki, ugy tunne, kevesebb
  // szelvenyt adtunk ki, mint amennyit valojaban.
  const rep = runReport(out, [Object.assign({}, kupaSlip, { status: 'unsettleable' })]);
  ok(rep.stats.unsettleable === 1, 'a summarize kulon szamolja', JSON.stringify(rep.stats));
  ok(/nem elszamolhato/.test(rep.message), 'a Discord-jelentes emliti oket');
  ok(rep.stats.win_rate === null || rep.stats.closed === 0,
     'az elszamolhatatlan nem szamit bele a nyeresi aranyba');
}

console.log('\n' + (fail === 0 ? 'MINDEN TESZT ATMENT' : fail + ' BUKOTT') + '  (' + pass + ' ok / ' + (pass + fail) + ')');
process.exit(fail ? 1 : 0);
