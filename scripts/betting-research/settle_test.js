// settle.js tesztek. Futtatas: node settle_test.js  (a betting-research gyokerbol)
//
// Ket felvonas:
//   A) egysegtesztek szintetikus adaton - minden piac, minden hatareset
//   B) VALOS teszt: a 2026-09-08-i slate snapshot legjei a letoltott CSV-k
//      vegeredmenye ellen. Ez az, ami a csapatnev-parositast bizonyitja.

const fs = require('fs');
const path = require('path');
const S = require('./settle.js');

let pass = 0, fail = 0;
const eq = (got, want, name) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.log('  BUKOTT: ' + name + '\n    kapott: ' + g + '\n    vart:   ' + w); }
};

// =========================================================
console.log('A) legOutcome - minden piac');
// =========================================================
// h2h
eq(S.legOutcome('h2h', 'home', 2, 0), true,  'home nyer 2-0');
eq(S.legOutcome('h2h', 'home', 1, 1), false, 'home nem nyer dontetlennel');
eq(S.legOutcome('h2h', 'home', 0, 1), false, 'home veszit');
eq(S.legOutcome('h2h', 'draw', 1, 1), true,  'draw 1-1');
eq(S.legOutcome('h2h', 'draw', 0, 0), true,  'draw 0-0');
eq(S.legOutcome('h2h', 'draw', 2, 1), false, 'draw nem jon be');
eq(S.legOutcome('h2h', 'away', 0, 1), true,  'away nyer');
eq(S.legOutcome('h2h', 'away', 1, 1), false, 'away nem nyer dontetlennel');
// totals 2.5 - a 2 gol UNDER, a 3 gol OVER, nincs push
eq(S.legOutcome('totals', 'over25',  1, 1), false, 'over25 2 gollal veszit');
eq(S.legOutcome('totals', 'over25',  2, 1), true,  'over25 3 gollal nyer');
eq(S.legOutcome('totals', 'under25', 1, 1), true,  'under25 2 gollal nyer');
eq(S.legOutcome('totals', 'under25', 2, 1), false, 'under25 3 gollal veszit');
eq(S.legOutcome('totals', 'under25', 0, 0), true,  'under25 0-0');
// btts
eq(S.legOutcome('btts', 'btts_yes', 1, 1), true,  'btts igen 1-1');
eq(S.legOutcome('btts', 'btts_yes', 3, 0), false, 'btts igen 3-0 veszit');
eq(S.legOutcome('btts', 'btts_no',  3, 0), true,  'btts nem 3-0 nyer');
eq(S.legOutcome('btts', 'btts_no',  0, 0), true,  'btts nem 0-0 nyer');
eq(S.legOutcome('btts', 'btts_no',  1, 2), false, 'btts nem 1-2 veszit');
// ismeretlen piac / rossz adat -> null, NEM false
eq(S.legOutcome('corners', 'over95', 1, 1), null, 'ismeretlen piac -> null');
eq(S.legOutcome('h2h', 'homewin',    1, 1), null, 'ismeretlen selection -> null');
eq(S.legOutcome('h2h', 'home', NaN, 1),     null, 'NaN gol -> null');
eq(S.legOutcome('h2h', 'home', null, null), null, 'null gol -> null');

// =========================================================
console.log('B) csapatnev parositas');
// =========================================================
const names = new Set(['Man United', 'Newcastle', "Nott'm Forest", 'Brighton',
                       'Ath Madrid', 'Real Madrid', 'Paris SG', "M'gladbach",
                       'Ein Frankfurt', 'Bournemouth']);
eq(S.matchTeamName('Man United', names), 'Man United', 'direkt talalat');
eq(S.matchTeamName('Manchester United', names), 'Man United', 'alias');
eq(S.matchTeamName('Newcastle United', names), 'Newcastle', 'alias 2');
eq(S.matchTeamName('Nottingham Forest', names), "Nott'm Forest", 'alias aposztroffal');
eq(S.matchTeamName('Brighton and Hove Albion', names), 'Brighton', 'alias hosszu nev');
eq(S.matchTeamName('Atletico Madrid', names), 'Ath Madrid', 'alias ekezet nelkul');
eq(S.matchTeamName('Atlético Madrid', names), 'Ath Madrid', 'ekezetes bemenet');
eq(S.matchTeamName('Borussia Monchengladbach', names), "M'gladbach", 'alias');
eq(S.matchTeamName('AFC Bournemouth', names), 'Bournemouth', 'alias prefixszel');
eq(S.matchTeamName('Valami FC', names), null, 'nincs talalat -> null');
// A reszstring lepcso 4 karakter FELETT engedelmes, szandekosan: ez az, ami
// az "FC Barcelona" / "Barcelona" tipusu parokat elkapja alias nelkul. Ara,
// hogy a "Real" belefut a "Real Madrid"-ba. Ez itt NEM hiba, mert a hivo
// oldalon a date_mismatch or kifogja a rossz parositast - de rogzitjuk a
// viselkedest, hogy egy szigoritas ne csendben menjen at.
eq(S.matchTeamName('Real', names), 'Real Madrid', 'rovid nev BELEFUT a hosszuba (ismert ar)');
// A >= 4 korlat a CSV-nevre all, nem a keresettre - ezert a "Rea" is befut.
// Ami valoban kizart: olyan nev, ami egyik CSV-nevnek sem resze.
eq(S.matchTeamName('Rea', names), 'Real Madrid', 'a hosszkorlat a CSV-nevre all');
eq(S.matchTeamName('Zzz', names), null, 'nem reszstring -> null');

// A ket ALIAS tabla szinkronban van-e az eles node-dal. Ez a teszt azert van,
// mert az elso valtozat kezi kopiaja 67 bejegyzest tartalmazott a 122 helyett.
const wfPath = path.join(__dirname, '..', '..', 'workflows', 'Betting Slate Builder.json');
if (fs.existsSync(wfPath)) {
  const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
  const gl = wf.nodes.find(n => n.name === 'Generate Legs');
  const code = gl ? gl.parameters.jsCode : '';
  const a = code.indexOf('const ALIAS'), b = code.indexOf('};', a);
  const nodeAlias = {};
  if (a >= 0) {
    const re = /'([^']+)':\s*(?:'([^']*)'|"([^"]*)")/g;
    let m; const block = code.slice(a, b + 2);
    while ((m = re.exec(block))) nodeAlias[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  const mine = S.ALIAS;
  const missing = Object.keys(nodeAlias).filter(k => mine[k] !== nodeAlias[k]);
  const extra = Object.keys(mine).filter(k => !(k in nodeAlias));
  eq(missing, [], 'ALIAS: minden node-bejegyzes megvan a teams.js-ben');
  eq(extra, [], 'ALIAS: nincs extra bejegyzes a teams.js-ben');
  eq(Object.keys(mine).length, Object.keys(nodeAlias).length,
     'ALIAS: ugyanannyi bejegyzes (' + Object.keys(nodeAlias).length + ')');
} else {
  console.log('  KIHAGYVA: nincs workflow JSON az ALIAS-szinkron ellenorzeshez');
}

// match_name bontas
eq(S.splitMatchName('Arsenal vs Chelsea'), { home: 'Arsenal', away: 'Chelsea' }, 'sima bontas');
eq(S.splitMatchName('Brighton and Hove Albion vs Leeds United'),
   { home: 'Brighton and Hove Albion', away: 'Leeds United' }, 'hosszu nevek');
eq(S.splitMatchName('Arsenal - Chelsea'), null, 'rossz szeparator -> null');
eq(S.splitMatchName('Arsenal vs '), null, 'ures vendeg -> null');
eq(S.splitMatchName(''), null, 'ures string -> null');

// =========================================================
console.log('C) settleLeg - statuszok');
// =========================================================
const csv = [
  'Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR',
  'E0,05/09/2026,12:30,Newcastle,Bournemouth,2,1,H',
  'E0,05/09/2026,15:00,Arsenal,Chelsea,1,1,D',
  'E0,12/09/2026,15:00,Man United,Leeds,,,',   // meg nem jatszott
].join('\n');
const index = { 'Premier League': S.indexResults(csv, 'Premier League') };
const NOW = '2026-09-10T00:00:00.000Z';

const mk = (o) => Object.assign({
  league: 'Premier League', match_name: 'Newcastle United vs Bournemouth',
  kickoff: '2026-09-05T11:30:00.000Z', market: 'h2h', selection: 'home',
}, o);

eq(S.settleLeg(mk({}), index, { now: NOW }).status, 'won', 'hazai nyert 2-1');
eq(S.settleLeg(mk({ selection: 'away' }), index, { now: NOW }).status, 'lost', 'vendeg vesztett');
eq(S.settleLeg(mk({ selection: 'draw' }), index, { now: NOW }).status, 'lost', 'dontetlen nem jott be');
eq(S.settleLeg(mk({ market: 'totals', selection: 'over25' }), index, { now: NOW }).status,
   'won', 'over25 3 gollal');
eq(S.settleLeg(mk({ market: 'btts', selection: 'btts_yes' }), index, { now: NOW }).status,
   'won', 'btts igen 2-1');
eq(S.settleLeg(mk({}), index, { now: NOW }).score, '2-1', 'eredmeny visszaadva');

// meg nem kezdodott el / nincs kesz
eq(S.settleLeg(mk({ kickoff: '2026-09-10T20:00:00.000Z' }), index, { now: NOW }),
   { status: 'still_open', reason: 'not_finished' }, 'kickoff a jovoben');
// grace: 2 oraval a kickoff utan meg fut a meccs
eq(S.settleLeg(mk({ kickoff: '2026-09-09T22:00:00.000Z' }), index, { now: NOW }),
   { status: 'still_open', reason: 'not_finished' }, '2 ora nem eleg (grace 3)');

// lejatszott, de a CSV-ben meg nincs eredmeny -> VARAKOZAS, nem hiba
eq(S.settleLeg(mk({ match_name: 'Manchester United vs Leeds United',
                    kickoff: '2026-09-12T14:00:00.000Z' }), index, { now: '2026-09-13T00:00:00Z' }),
   { status: 'still_open', reason: 'result_not_published' }, 'CSV meg nem frissult');

// ismeretlen liga -> varakozas (nem hiba: lehet, hogy csak nem toltottuk le)
eq(S.settleLeg(mk({ league: 'Eredivisie' }), index, { now: NOW }),
   { status: 'still_open', reason: 'no_csv_for_league' }, 'nincs CSV a ligahoz');

// parositatlan csapat -> HIBA, latszodnia kell
eq(S.settleLeg(mk({ match_name: 'Kitalalt FC vs Bournemouth' }), index, { now: NOW }).reason,
   'team_unmatched', 'parositatlan csapat');
eq(S.settleLeg(mk({ match_name: 'Newcastle United - Bournemouth' }), index, { now: NOW }).reason,
   'bad_match_name', 'rossz match_name');
eq(S.settleLeg(mk({ kickoff: 'nem datum' }), index, { now: NOW }).reason,
   'bad_kickoff', 'rossz kickoff');
eq(S.settleLeg(mk({ market: 'corners', selection: 'over95' }), index, { now: NOW }).reason,
   'unknown_market', 'ismeretlen piac');

// datum-elteres: ugyanaz a parositas, de egy evvel korabbi kickoff
eq(S.settleLeg(mk({ kickoff: '2025-09-05T11:30:00.000Z' }), index, { now: NOW }).reason,
   'date_mismatch', 'masik szezon ugyanaz a par');

// ures CSV / szemet bemenet nem dobhat kivetelt
eq(S.indexResults('', 'X').names.size, 0, 'ures CSV');
eq(S.indexResults('csak,egy,sor', 'X').names.size, 0, 'fejlec nelkuli CSV');
eq(S.indexResults('a,b,c\n1,2,3', 'X').names.size, 0, 'hianyzo kotelezo oszlop');
// a le nem jatszott meccs csapatai IS bekerulnek a nevek koze
const idx3 = S.indexResults(csv, 'Premier League');
eq(idx3.names.has('Man United') && idx3.names.has('Leeds'), true,
   'jovobeli meccs csapatai is a nev-listaban');
eq(Object.keys(idx3.byKey).length, 2, 'csak a 2 lejatszott meccs kap eredmenyt');

// =========================================================
console.log('D) settleSlip - akkumulator logika');
// =========================================================
const slip = { stake: 1000, total_odds: 10.0 };
eq(S.settleSlip(slip, [{ status: 'won' }, { status: 'won' }]),
   { status: 'won', payout: 10000, profit: 9000 }, 'minden lab nyert');
eq(S.settleSlip(slip, [{ status: 'won' }, { status: 'lost' }]),
   { status: 'lost', payout: 0, profit: -1000 }, 'egy vesztes lab -> bukott');
// EZ a lenyeg: a vesztes lab AZONNAL dont, nem kell megvarni a nyitottat
eq(S.settleSlip(slip, [{ status: 'lost' }, { status: 'still_open' }]),
   { status: 'lost', payout: 0, profit: -1000 }, 'vesztes lab dont nyitott mellett is');
eq(S.settleSlip(slip, [{ status: 'lost' }, { status: 'unresolvable' }]),
   { status: 'lost', payout: 0, profit: -1000 }, 'vesztes lab dont hibas lab mellett is');
eq(S.settleSlip(slip, [{ status: 'won' }, { status: 'still_open' }]),
   { status: 'open', reason: 'legs_pending' }, 'nyitott lab -> nyitott szelveny');
eq(S.settleSlip(slip, [{ status: 'won' }, { status: 'unresolvable' }]),
   { status: 'open', reason: 'leg_unresolvable' }, 'hibas lab NEM nyer');
eq(S.settleSlip(slip, []), { status: 'open', reason: 'no_legs' }, 'nincs lab');

// =========================================================
console.log('E) summarize');
// =========================================================
eq(S.summarize([]), { closed: 0, open: 0, unsettleable: 0, won: 0, lost: 0, win_rate: null,
                      staked: 0, returned: 0, profit: 0, roi_pct: null },
   'ures lista -> null arany, nem 0%');
eq(S.summarize([{ status: 'open', stake: 1000 }]).win_rate, null,
   'csak nyitott -> null arany');
eq(S.summarize([{ status: 'open', stake: 1000 }]).staked, 0,
   'a nyitott tet nem szamit a staked-be');
const mixed = [
  { status: 'won',  stake: 1000, payout: 3000 },
  { status: 'lost', stake: 1000, payout: 0 },
  { status: 'lost', stake: 1000, payout: 0 },
  { status: 'open', stake: 1000 },
];
eq(S.summarize(mixed), { closed: 3, open: 1, unsettleable: 0, won: 1, lost: 2, win_rate: 33.3,
                         staked: 3000, returned: 3000, profit: 0, roi_pct: 0 },
   '1/3 nyeres, nullszaldo');

// --- kupa-labak: elszamolhatatlan, de nem ragad nyitva ---
// A BL/EL/KL labaknak nincs eredmeny-forrasa (a football-data.co.uk csak
// bajnoksagokat ad). Vegallapot kell, nem varakozas: kulonben a szelveny
// orokre nyitva maradna, es a nyitott szelvenyek szama csendben nőne.
const kupaLeg = { kickoff: '2026-09-16T19:00:00.000Z', league: 'EL, csoportkör',
                  match_name: 'Milan vs Benfica', market: 'h2h', selection: 'home',
                  confidence: 'KUPA' };
const later = '2026-09-17T12:00:00.000Z';
eq(S.settleLeg(kupaLeg, {}, { now: later }).status, 'unsettleable',
   'kupa-lab: unsettleable, nem still_open');
eq(S.settleLeg(kupaLeg, {}, { now: later }).reason, 'cup_no_result_source',
   'kupa-lab: latszik az ok is');
// A kezdes elott meg a kupa-lab is "meg nem jatszottak" - a sorrend szamit.
eq(S.settleLeg(kupaLeg, {}, { now: '2026-09-16T12:00:00.000Z' }).status, 'still_open',
   'kupa-lab a kezdes elott: meg nyitott, nem unsettleable');

eq(S.settleSlip({ stake: 1000, total_odds: 2, leg_count: 2 },
     [{ status: 'won' }, { status: 'unsettleable' }]).status, 'unsettleable',
   'egy kupa-lab elszamolhatatlanna teszi a szelvenyt');
// A bukott lab ELOBBRE valo: ha egy lab mar bukott, a szelveny bukott,
// barmi is tortent a kupa-labbal. Igy a kupa-labas szelvenyek egy resze
// meg merheto marad.
eq(S.settleSlip({ stake: 1000, total_odds: 2, leg_count: 2 },
     [{ status: 'lost' }, { status: 'unsettleable' }]).status, 'lost',
   'a bukott lab erosebb az elszamolhatatlannal');

eq(S.summarize([
     { status: 'won', stake: 1000, payout: 2000 },
     { status: 'unsettleable', stake: 1000 },
   ]), { closed: 1, open: 0, unsettleable: 1, won: 1, lost: 0, win_rate: 100,
         staked: 1000, returned: 2000, profit: 1000, roi_pct: 100 },
   'az elszamolhatatlan nem torzitja a ROI-t, de latszik');

// =========================================================
console.log('F) VALOS adat: 2026-09-08 slate snapshot a letoltott CSV-k ellen');
// =========================================================
const snapPath = path.join(__dirname, 'snapshots', 'bet_slate_2026-09-08T16-10Z.json');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(snapPath) || !fs.existsSync(dataDir)) {
  console.log('  KIHAGYVA: nincs snapshot vagy data/ mappa');
} else {
  const raw = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  const legs = Array.isArray(raw) ? raw : (raw.data || raw.rows || []);

  // A liganev -> CSV fajl leképezes. Ugyanazok a ligak, mint a Config node-ban.
  const LEAGUE_FILES = {
    'Premier League': 'E0', 'La Liga': 'SP1', 'Bundesliga': 'D1',
    'Serie A': 'I1', 'Ligue 1': 'F1',
  };
  const SEASON = '2627';
  const index = {};
  for (const [league, code] of Object.entries(LEAGUE_FILES)) {
    const f = path.join(dataDir, code + '_' + SEASON + '.csv');
    if (fs.existsSync(f)) index[league] = S.indexResults(fs.readFileSync(f, 'utf8'), league);
  }

  // "Most" = joval a meccsek utan, hogy minden elszamolhato legyen.
  const now = '2026-09-12T00:00:00.000Z';
  const tally = {};
  const problems = [];
  for (const leg of legs) {
    const r = S.settleLeg(leg, index, { now });
    tally[r.status] = (tally[r.status] || 0) + 1;
    if (r.status === 'unresolvable') {
      problems.push(leg.league + ' | ' + leg.match_name + ' | ' +
                    leg.market + '|' + leg.selection + ' -> ' + r.reason +
                    (r.detail ? ' (' + r.detail + ')' : ''));
    }
  }
  console.log('  ' + legs.length + ' leg a snapshotban');
  console.log('  statuszok: ' + JSON.stringify(tally));
  if (problems.length) {
    console.log('  FELOLDHATATLAN (' + problems.length + '):');
    const seen = new Set();
    for (const p of problems) { if (!seen.has(p)) { seen.add(p); console.log('    ' + p); } }
  }

  // Ez a bizonyito allitas: valos adaton EGY leg sem lehet feloldhatatlan.
  // Ha ez bukik, a csapatnev-parositas hibas, es a nyeresi arany hamis lenne.
  eq(tally.unresolvable || 0, 0, 'VALOS: nincs feloldhatatlan leg');
  eq((tally.won || 0) + (tally.lost || 0) > 0, true, 'VALOS: van elszamolt leg');

  // Ep-esz: a talalati arany legyen hihetoen 25-75% kozott. Minden kimenetel
  // labkent szerepel (home ES draw ES away), tehat ~1/3-nak kell bejonnie
  // a h2h-n, es ~50%-nak a ket allasu piacokon.
  const w = tally.won || 0, l = tally.lost || 0;
  const rate = w / (w + l) * 100;
  console.log('  leg talalati arany: ' + rate.toFixed(1) + '% (' + w + '/' + (w + l) + ')');
  eq(rate > 20 && rate < 70, true, 'VALOS: talalati arany hiheto savban');

  // Piaconkent is: ha egy piac 0%-ot vagy 100%-ot ad, a logika forditva all.
  const byMarket = {};
  for (const leg of legs) {
    const r = S.settleLeg(leg, index, { now });
    if (r.status !== 'won' && r.status !== 'lost') continue;
    const k = leg.market + '|' + leg.selection;
    byMarket[k] = byMarket[k] || { w: 0, n: 0 };
    byMarket[k].n++; if (r.status === 'won') byMarket[k].w++;
  }
  console.log('  piaconkent:');
  for (const k of Object.keys(byMarket).sort()) {
    const m = byMarket[k];
    console.log('    ' + k.padEnd(18) + ' ' + m.w + '/' + m.n +
                ' (' + (m.w / m.n * 100).toFixed(0) + '%)');
  }
  // A komplementer parok osszege PONTOSAN a meccsszam kell legyen: minden
  // meccsen vagy az over, vagy az under jon be. Ha nem, elszamolunk egy legjet.
  for (const [a, b] of [['totals|over25', 'totals|under25'], ['btts|btts_yes', 'btts|btts_no']]) {
    const A = byMarket[a], B = byMarket[b];
    if (A && B && A.n === B.n) {
      eq(A.w + B.w, A.n, 'VALOS: ' + a + ' + ' + b + ' nyeresei = meccsszam');
    }
  }
  // h2h: a harom kimenetel kozul pontosan egy jon be meccsenkent
  const H = byMarket['h2h|home'], D = byMarket['h2h|draw'], Aw = byMarket['h2h|away'];
  if (H && D && Aw && H.n === D.n && D.n === Aw.n) {
    eq(H.w + D.w + Aw.w, H.n, 'VALOS: h2h harom kimenetel nyeresei = meccsszam');
  }
}

// =========================================================
console.log('\n' + (fail === 0 ? 'MINDEN TESZT ATMENT' : fail + ' TESZT BUKOTT') +
            '  (' + pass + ' ok / ' + (pass + fail) + ')');
process.exit(fail === 0 ? 0 : 1);
