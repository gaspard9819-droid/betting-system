// A naplozott arak kiertekelese: helyesek-e a de-vigelt valoszinusegek.
//
// A KERDES, amire valaszol
//
// A margin.js ket modszert ismer a margo szetosztasara, es az alapertelmezes
// (power) egy MAS adaton mert eredmenyen all: a research/devig_check.js 7228
// meccsen, TOBB konyv legjobb arabol (MaxC) szamolva. A sajat arainkon a power
// ebbe az iranyba mozdit (margin.js:54):
//
//   1.0-1.6 sav  +2.80pp      3.2-5.0 sav  -1.97pp      5.0+ sav  -3.82pp
//
// Az IRANY kolcsonzott meres. A MERTEK sosem lett ellenorizve a sajat
// arainkon. Ez a script ellenorzi - eredmennyel, nem feltevessel.
//
// A FO METRIKA: LOG-LOSS PIACONKENT, NEM LABANKENT
//
// Egy piac kimenetelei egy teljes, kizaro rendszert alkotnak: pontosan egy
// nyer. A de-vigelt valoszinusegek eloszlast adnak rajuk, tehat a helyes
// pontszam a nyertes kimenetel -ln(p)-je, piaconkent EGY megfigyeles.
//
// Miert nem labankent: egy piac labai nem fuggetlenek (osszeguk 1), tehat
// labanként szamolva ugyanaz az informacio tobbszor szamitana, es a
// konfidencia-intervallum hamisan szuk lenne. A repo ugyanezt a metrikat
// hasznalja vegig (log-loss 1.018 vs a piac 0.980).
//
// A parositas teszi erzekenyse: ugyanaz a piac, ugyanaz a kimenetel, ket
// modszerrel pontozva. A timing.js ugyanezt csinalta (+0.403pp, t=7.55) -
// parositott teszt sokkal erosebb, mint ket atlag osszevetese.
//
// AMIT NEM CSINAL
//
// Nem mer ROI-t es nem mond meg, hogy nyeresz-e. A margo-minimalizalas
// haszna aritmetikai: kisebb koltseg azonos kimenetel mellett mindig jobb.
// Ami ITT eldol, az a KOLTSEG-BECSLES helyessege - es azon keresztul a
// bejovesi esely, amit a cli.js kiir.
//
// HASZNALAT
//   node local/calib.js                 minden snapshot, alapertelmezett nezet
//   node local/calib.js --elso          kickoff elott a LEGKORABBI arat hasznalja
//   node local/calib.js --friss         CSV-k ujraletoltese akkor is, ha frissek
//   node local/calib.js --reszletek     ismeretlen piacok es parositatlan nevek

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const { powerProbs, isUsableMarket, hasOverlappingOutcomes } = require('./margin.js');
const { indexResults, matchTeamName } = require('../research/settle.js');
const { norm } = require('../research/teams.js');

// A pool-mappa felulirhato, hogy a calib_test.js sajat, eldobhato mappan
// futtathassa a teljes utat anelkul, hogy a valodi naplot piszkalna.
//
// A FELOLDAS A main()-ben TORTENIK, nem itt. Modul-szinten kiolvasva a
// kornyezeti valtozot a require PILLANATABAN rogzitenenk - a teszt viszont
// csak kesobb allitja be, tehat a valodi local/pool/-on futott volna. Pont ez
// tortent: 45-46. ellenorzes 0 piacot latott, mert a mai (meg le nem
// jatszott) meccseket olvasta.
const poolDir = () => process.env.BETTING_POOL_DIR || path.join(__dirname, 'pool');
const DATA_DIR = path.join(__dirname, '..', 'research', 'data');

// A de-vig felso margo-plafonja, szo szerint a margin.js:36-bol. Ami e folott
// van, az nem draga piac, hanem rossz szamitas (atfedo kimenetelek).
const MAX_PLAUSIBLE_MARGIN = 25;

// ------------------------------------------------------------------ argumentum
function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) a[t.slice(2)] = true;
    else { a[t.slice(2)] = next; i++; }
  }
  return a;
}

// --------------------------------------------------------------- csapatnev
//
// Ket lepcso. Eloszor a settle.js matchTeamName-je (ALIAS tabla + normalizalas
// + reszstring), aztan a boost_fetch.js:145 szo-elotag modszere.
//
// MIERT KELL A MASODIK: a Tippmixpro feed ROVIDIT ("Atl. Madrid"), a
// football-data nem. A puszta reszstring erre elbukik - "atl madrid" nincs
// benne az "ath madrid"-ban -, es az elso boost-futas emiatt dobta el mind a
// 12 parositast (local/README.md:277). Ugyanaz a csendes tores, amit az
// Espanyol/Espanol eset mar megtanitott.
function wordPrefixMatch(a, b) {
  const s = norm(a), f = norm(b);
  if (!s || !f) return false;
  if (s === f) return true;
  const sw = s.split(' ').filter(w => w.length >= 3);
  const fw = f.split(' ').filter(w => w.length >= 3);
  if (!sw.length || !fw.length) return false;
  return fw.every(w => sw.some(x => x.startsWith(w) || w.startsWith(x)));
}

// A Tippmixpro feed sajat roviditesei -> football-data nevek.
//
// MIERT KULON TABLA, ES MIERT NEM A teams.js-BE:
//
// A research/teams.js ALIAS-a SZO SZERINT a "Generate Legs" node tablaja, es a
// settle_test.js bukik, ha elter tole (teams.js:8). Az a tabla a The Odds API
// neveit forditja. A feed MAS forras, MAS roviditesekkel - egy bejegyzes, ami
// itt kell, ott csak elrontana a szinkront.
//
// EZ A TABLA NONI FOG. Uj csapat, promovalt csapat, uj bajnoksag mind uj
// roviditest hozhat, es a tunete CSENDES: a meccs kiesik a kalibraciobol, a
// minta fogy, es senki nem veszi eszre. Ezert fogja meg ket helyen:
//   - a calib_test.js 41. ellenorzese minden naplozott nevet feloldani probal
//   - a `node local/calib.js --reszletek` kiirja a parositatlanokat
//
// A lenti ot bejegyzes a 2026-09-19-i naplo 86 nevebol bukott el - mind olyan
// alak, amit sem az ALIAS, sem a szo-elotag modszer nem hidal at:
// "Atl. Madrid" vs "Ath Madrid" (atl/ath), "E. Frankfurt" vs "Ein Frankfurt"
// (az egy betus szo kiesik a >=3 szuron), "Nottingham" vs "Nott'm Forest".
const FEED_ALIAS = {
  'nottingham': "Nott'm Forest",
  'manchester utd': 'Man United',
  'atl madrid': 'Ath Madrid',
  'monchengladbach': "M'gladbach",
  'e frankfurt': 'Ein Frankfurt',
};

function findCsvName(feedName, csvNames) {
  const alias = FEED_ALIAS[norm(feedName)];
  if (alias && csvNames.has(alias)) return alias;
  const direct = matchTeamName(feedName, csvNames);
  if (direct) return direct;
  for (const c of csvNames) if (wordPrefixMatch(feedName, c)) return c;
  return null;
}

// Egy kimenetel-cimke a hazai vagy a vendeg csapatra szol-e. Itt a feed SAJAT
// neve all mindket oldalon, tehat nincs forras-kulonbseg - eleg a laza egyezes.
function sideOfLabel(label, home, away) {
  if (wordPrefixMatch(home, label) || norm(home).includes(norm(label))) return 'home';
  if (wordPrefixMatch(away, label) || norm(away).includes(norm(label))) return 'away';
  return null;
}

// ------------------------------------------------------------- piac-elszamolas
//
// EGY hely, ahol egy piac/kimenetel -> nyert/vesztett dol el, a settle.js:47
// mintajara. Ismeretlen piac NEM talalgatas: null-t ad, a piac kimarad, es a
// neve megjelenik a jelentesben. Inkabb hianyzik egy piac, mint hogy rosszul
// szamoljon.
//
// A TAMOGATOTT CSALADOK szandekosan szukek. Mindharom a vegeredmeny fuggvenye,
// es a cimkejuk egyertelmuen parszolhato:
//
//   1X2 (a Szuper odds valtozattal egyutt) · Gólszám (barmely vonal) · BTTS
//
// A hendikep-piacok szinten a vegeredmenybol jonnek, de a magyar cimkejuk
// parszolasa (elojel, csapatoldal, egesz vonal push-a) hibazasra hajlamos, es
// egy elnezett elojel CSENDBEN forditana meg a kalibraciot. Ezert kimaradnak,
// es a --reszletek kiirja, mennyi lab veszik el veluk - abbol lehet eldonteni,
// megeri-e felvenni oket.
function lineOf(text) {
  const m = /(\d+(?:[.,]\d+)?)/.exec(String(text || ''));
  return m ? Number(m[1].replace(',', '.')) : null;
}

// true = nyert, false = vesztett, 'push' = tet vissza, null = nem tudjuk.
function outcomeOf(marketName, pick, match, hg, ag) {
  const name = String(marketName || '');
  const label = String(pick.label || '');

  if (/^1X2/i.test(name)) {
    const t = String(pick.type || '').toLowerCase();
    const l = label.toLowerCase();
    if (t.includes('draw') || l === 'döntetlen' || l === 'x') return hg === ag;
    const side = sideOfLabel(label, match.home, match.away);
    if (side === 'home') return hg > ag;
    if (side === 'away') return ag > hg;
    return null;
  }

  if (/^Gólszám/i.test(name)) {
    // A vonal eloszor a CIMKEBOL ("Több, mint 2.5"), mert az mindig a sajat
    // vonalat hordozza; a piac neve nem mindig.
    const line = lineOf(label) !== null ? lineOf(label) : lineOf(name);
    if (line === null) return null;
    const total = hg + ag;
    // Egesz vonalon (Gólszám 3) a pontos talalat push. A negyed-vonalakat a
    // margin.js mar kiszurte, a fel-vonalakon ez sosem sul el.
    if (total === line) return 'push';
    if (/Több|Over/i.test(label)) return total > line;
    if (/Kevesebb|Under/i.test(label)) return total < line;
    return null;
  }

  if (/Mindkét csapat szerez/i.test(name)) {
    if (/^Igen/i.test(label)) return hg > 0 && ag > 0;
    if (/^Nem/i.test(label)) return !(hg > 0 && ag > 0);
    return null;
  }

  return null;
}

// ---------------------------------------------------------------- football-data
//
// A liga-kod a snapshot `source` kulcsabol. A kupak (BL/EL/KL) NEM
// szamolhatok el ebbol a forrasbol - a football-data csak bajnoksagokat ad
// (settle.js:130). Azok a meccsek kiesnek, kiirt szammal.
const LEAGUE_CSV = { PL: 'E0', SP1: 'SP1', D1: 'D1', I1: 'I1', F1: 'F1' };

// Szezonkod a kickoff datumabol. A szezon juliusban fordul: 2026-09 -> 2627.
function seasonCode(d) {
  const y = d.getUTCFullYear();
  const start = d.getUTCMonth() >= 6 ? y : y - 1;
  const p = n => String(n % 100).padStart(2, '0');
  return p(start) + p(start + 1);
}

// KET HOSZT, mint a research/README.md letolto parancsaban: kulon rate-limit
// savon futnak, es amelyik kimerult, 503-at ad.
//
// A `fetch` alapbol koveti a 302-t, tehat a curl -L csapdaja itt nem all fenn.
// Ami VISZONT fennall: a hibaoldal 200-zal is erkezhet, es HTML-kent landolna
// .csv neven. A parser ilyenkor nem a letoltesnel hasalna el, hanem kesobb -
// ez a shape mar ket debugolasi kort elvitt (README.md:216). Ezert a
// tartalom-ellenorzes: FTHG nelkul nem CSV, barmit is mond a statuszkod.
async function downloadCsv(season, code) {
  const hosts = ['www.football-data.co.uk', 'football-data.co.uk'];
  let last = '';
  for (const h of hosts) {
    try {
      const r = await fetch(`https://${h}/mmz4281/${season}/${code}.csv`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (!r.ok) { last = `HTTP ${r.status}`; continue; }
      const text = await r.text();
      if (!text.includes('FTHG')) { last = `nem CSV (${text.length} bájt)`; continue; }
      return text;
    } catch (err) { last = err.message; }
  }
  throw new Error(`${code}_${season}: ${last}`);
}

// A folyo szezon fajlja hetente ketszer frissul. 6 oranal fiatalabbat nem
// toltunk ujra - a --friss ezt hagyja figyelmen kivul.
async function csvFor(season, code, fresh) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, `${code}_${season}.csv`);
  if (!fresh && fs.existsSync(file)) {
    const ageH = (Date.now() - fs.statSync(file).mtimeMs) / 3600000;
    if (ageH < 6) return fs.readFileSync(file, 'utf8');
  }
  const text = await downloadCsv(season, code);
  fs.writeFileSync(file, text);
  return text;
}

// ------------------------------------------------------------------ statisztika
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

function sd(xs) {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1));
}

// ---------------------------------------------------------------------- futtatas
async function main() {
  const args = parseArgs(process.argv.slice(2));

  // ---- 1. snapshotok
  const POOL_DIR = poolDir();
  if (!fs.existsSync(POOL_DIR)) {
    console.error('Nincs local/pool/ mappa — előbb naplózni kell: node local/log.js');
    process.exit(1);
  }
  const files = fs.readdirSync(POOL_DIR).filter(f => f.endsWith('.json.gz')).sort();
  if (!files.length) {
    console.error('Nincs egyetlen snapshot sem — előbb naplózni kell: node local/log.js');
    process.exit(1);
  }

  // ---- 2. piac-megfigyelesek, DUPLIKATUM NELKUL
  //
  // Ugyanaz a meccs tobb snapshotban is szerepel (naponta ujra lekerve). Ha
  // mindegyik szamitana, ugyanaz az informacio 5-10-szer sulyozodna, es a
  // konfidencia-intervallum hamisan szuk lenne.
  //
  // Piaconkent EGY ar marad: alapbol a kickoff elotti LEGKESOBBI (az van
  // legkozelebb a zaroarhoz, es az a legfrissebb, amit a szelvenyepito
  // hasznalt volna). A --elso a legkorabbit valasztja - a timing.js merese
  // szerint az ar a rovid labakon a kezdesig romlik, tehat a ketto nem
  // ugyanaz a szam.
  const useFirst = !!args.elso;
  const obs = new Map();            // matchId|marketCode -> megfigyeles
  let snapshotCount = 0;

  for (const f of files) {
    let snap;
    try {
      snap = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(POOL_DIR, f))));
    } catch (err) {
      console.error(`  ${f}: olvashatatlan — ${err.message}`);
      continue;
    }
    snapshotCount++;
    const fetchedAt = new Date(snap.fetchedAt).getTime();

    for (const m of snap.matches) {
      // A lekeres ideje legyen a kickoff ELOTT. Egy kezdes utan felvett ar mar
      // elo ar, mas piac.
      if (!(fetchedAt < Number(m.startTime))) continue;
      for (const mk of m.markets) {
        // A KULCSBAN BENNE KELL LENNIE A PIAC NEVENEK.
        //
        // A `code` a bettingTypeId-eventPartId par (catalog.js:80), ami MINDEN
        // golszam-vonalra ugyanaz: a "Gólszám 1.5", "Gólszám 2.5" es
        // "Gólszám 3.5" egyarant 47-3. Csak a kodra kulcsolva a vonalak
        // egymast irtak felul, es meccsenkent egyetlen golszam-piac maradt.
        //
        // Merve 2026-09-19: 3190 naplozott piacbol igy 950 lett. A minta
        // ketharmada tunt el ugy, hogy semmi nem jelezte - a jelentes csak
        // kevesebb sort irt volna ki.
        const key = m.id + '|' + mk.code + '|' + mk.name;
        const prev = obs.get(key);
        if (prev) {
          const better = useFirst ? fetchedAt < prev.fetchedAt : fetchedAt > prev.fetchedAt;
          if (!better) continue;
        }
        obs.set(key, { match: m, market: mk, fetchedAt });
      }
    }
  }

  // ---- 3. eredmeny-index a szukseges liga/szezon parokra
  const needed = new Map();
  for (const o of obs.values()) {
    const code = LEAGUE_CSV[o.match.source];
    if (!code) continue;
    const season = seasonCode(new Date(Number(o.match.startTime)));
    needed.set(code + '|' + season, { code, season });
  }

  const index = {};
  const csvErrors = [];
  for (const { code, season } of needed.values()) {
    try {
      const text = await csvFor(season, code, !!args.friss);
      const idx = indexResults(text, code);
      // Tobb szezon ugyanabba a liga-indexbe: a settle.js kulcsa
      // liga|hazai|vendeg, a datum-ellenorzes valasztja szet oket.
      if (!index[code]) index[code] = idx;
      else {
        Object.assign(index[code].byKey, idx.byKey);
        for (const n of idx.names) index[code].names.add(n);
      }
    } catch (err) {
      csvErrors.push(err.message);
    }
  }

  // ---- 4. elszamolas + pontozas
  const marketRecords = [];     // piaconkent egy sor
  const outcomeRecords = [];    // kimenetelenkent egy sor (megbizhatosagi tabla)

  const skip = {
    kupa: 0, nincs_csv: 0, csapat_parositatlan: 0, nincs_eredmeny: 0,
    nem_hasznalhato_piac: 0, atfedo_kimenetel: 0, ismeretlen_piac: 0,
    hianyos_piac: 0, push: 0, margo_ervenytelen: 0, azonossag_serult: 0,
  };
  const unknownMarkets = new Map();
  const unmatchedTeams = new Map();

  for (const o of obs.values()) {
    const { match: m, market: mk } = o;

    const league = LEAGUE_CSV[m.source];
    if (!league) { skip.kupa++; continue; }

    // Ugyanaz a szures, mint a szelvenyepitoben: azt kalibraljuk, amit a
    // rangsor tenylegesen hasznalhat (margin.js:256-264).
    if (!mk.isBoost && !isUsableMarket(mk.name)) { skip.nem_hasznalhato_piac++; continue; }
    if (hasOverlappingOutcomes(mk.picks)) { skip.atfedo_kimenetel++; continue; }

    const idx = index[league];
    if (!idx) { skip.nincs_csv++; continue; }

    const csvHome = findCsvName(m.home, idx.names);
    const csvAway = findCsvName(m.away, idx.names);
    if (!csvHome || !csvAway) {
      skip.csapat_parositatlan++;
      const miss = !csvHome ? m.home : m.away;
      unmatchedTeams.set(miss, (unmatchedTeams.get(miss) || 0) + 1);
      continue;
    }

    const res = idx.byKey[league + '|' + csvHome + '|' + csvAway];
    // Nincs sor: a meccs meg nincs a CSV-ben. Ez a NORMALIS eset 1-3 napig,
    // mert a football-data hetente ketszer frissul.
    if (!res) { skip.nincs_eredmeny++; continue; }
    // Ugyanaz a datum-ellenorzes, mint a settle.js:165: rossz szezon azonos
    // parositasa helyett inkabb ne allitsunk semmit.
    if (Math.abs(new Date(res.date) - Number(m.startTime)) / 86400000 > 2) {
      skip.nincs_eredmeny++; continue;
    }

    const outcomes = mk.picks.map(p => outcomeOf(mk.name, p, m, res.hg, res.ag));
    if (outcomes.some(x => x === null)) {
      skip.ismeretlen_piac++;
      unknownMarkets.set(mk.name, (unknownMarkets.get(mk.name) || 0) + 1);
      continue;
    }
    if (outcomes.some(x => x === 'push')) { skip.push++; continue; }

    // A margo-ervenyesseg ugyanaz a ket feltetel, mint a devig()-ben: az
    // implikalt osszeg csak akkor margo, ha 1 folott van, es csak akkor
    // hiheto, ha a plafon alatt.
    const odds = mk.picks.map(p => p.odds);
    const ipSum = odds.reduce((s, x) => s + 1 / x, 0);
    const marginPct = (ipSum - 1) * 100;
    if (!(ipSum > 1) || marginPct > MAX_PLAUSIBLE_MARGIN) { skip.margo_ervenytelen++; continue; }

    // AZONOSSAG-ELLENORZES, a settle_test.js mintajara (README.md:204):
    // pontosan egy kimenetel nyerhet. Nulla = a piac hianyos volt (a nyertes
    // ajanlat nem volt elerheto a lekeresekor), ketto vagy tobb = elszamolasi
    // hiba. Egyik esetben sem szabad pontozni.
    const winners = outcomes.filter(x => x === true).length;
    if (winners === 0) { skip.hianyos_piac++; continue; }
    if (winners > 1) { skip.azonossag_serult++; continue; }

    const wi = outcomes.indexOf(true);
    const pPower = powerProbs(odds);
    const pProp = odds.map(x => (1 / x) / ipSum);

    marketRecords.push({
      match: m.name, market: mk.name, isBoost: !!mk.isBoost, k: odds.length,
      marginPct, winnerOdds: odds[wi],
      llPower: -Math.log(pPower[wi]),
      llProp: -Math.log(pProp[wi]),
      llUniform: -Math.log(1 / odds.length),
    });

    for (let i = 0; i < odds.length; i++) {
      outcomeRecords.push({
        odds: odds[i], won: outcomes[i] === true,
        pPower: pPower[i], pProp: pProp[i],
      });
    }
  }

  // ---- 5. jelentes
  const L = s => console.log(s);
  L('');
  L('='.repeat(66));
  L(`  DE-VIG KALIBRÁCIÓ — ${snapshotCount} snapshot, ${obs.size} piac-megfigyelés`);
  L('='.repeat(66));
  L(`  ár a kickoff előtti ${useFirst ? 'LEGKORÁBBI' : 'legkésőbbi'} lekérésből`);
  if (csvErrors.length) {
    L('');
    for (const e of csvErrors) L(`  CSV HIBA: ${e}`);
  }

  L('');
  L(`  Kiértékelhető: ${marketRecords.length} piac, ${outcomeRecords.length} kimenetel`);
  L('');
  L('  Ami kimaradt:');
  const skipLabels = {
    kupa: 'kupa (nincs eredményforrás)',
    nincs_csv: 'nincs CSV a ligához',
    nincs_eredmeny: 'még nincs eredmény',
    csapat_parositatlan: 'csapatnév párosítatlan',
    nem_hasznalhato_piac: 'kizárt piactípus',
    atfedo_kimenetel: 'átfedő kimenetelek',
    ismeretlen_piac: 'ismeretlen piac (nem számoljuk el)',
    hianyos_piac: 'hiányos piac (a nyertes ár nem volt elérhető)',
    push: 'push (egész vonal, tét vissza)',
    margo_ervenytelen: 'érvénytelen margó',
    azonossag_serult: 'AZONOSSÁG SÉRÜLT (elszámolási hiba)',
  };
  for (const [k, v] of Object.entries(skip)) {
    if (v) L(`    ${String(v).padStart(6)}  ${skipLabels[k]}`);
  }

  if (skip.azonossag_serult) {
    L('');
    L('  FIGYELEM: egy piacon több nyertes kimenetel adódott. Ez elszámolási');
    L('  hiba, nem adatzaj — az outcomeOf() javításáig a többi szám is gyanús.');
  }

  if (!marketRecords.length) {
    L('');
    L('  Nincs kiértékelhető piac. Ha a meccsek frissek, a football-data CSV');
    L('  még nem tartalmazza őket — hetente kétszer frissül. Próbáld pár nap múlva.');
    L('');
    return;
  }

  // -- log-loss
  const llPower = marketRecords.map(r => r.llPower);
  const llProp = marketRecords.map(r => r.llProp);
  const llUni = marketRecords.map(r => r.llUniform);

  L('');
  L('  ÁTLAGOS LOG-LOSS PIACONKÉNT  (kisebb = jobb)');
  L('');
  L(`    power (jelenlegi)      ${mean(llPower).toFixed(5)}`);
  L(`    proportional           ${mean(llProp).toFixed(5)}`);
  L(`    egyenletes (alapvonal) ${mean(llUni).toFixed(5)}`);
  L('');
  L(`    n = ${marketRecords.length} piac`);

  // Az egyenletes alapvonal nem verseny, hanem ellenorzes: ha az arak NEM
  // vernek egy informacio nelkuli tippet, akkor a naplozasban vagy az
  // elszamolasban van a hiba, nem a de-vig modszereben.
  if (mean(llPower) >= mean(llUni)) {
    L('');
    L('    FIGYELEM: az árak nem verik az egyenletes alapvonalat. Ez nem');
    L('    a de-vig hibája — ilyenkor a naplózásban vagy az elszámolásban');
    L('    keresd az okot, mielőtt bármit következtetnél.');
  }

  // -- parositott teszt
  const diffs = marketRecords.map(r => r.llProp - r.llPower);   // + = a power jobb
  const dMean = mean(diffs), dSd = sd(diffs);
  const se = dSd / Math.sqrt(diffs.length);
  const t = dMean / se;

  L('');
  L('  PÁROSÍTOTT ÖSSZEVETÉS  (proportional − power, piaconként)');
  L('');
  L(`    átlagos különbség   ${dMean >= 0 ? '+' : ''}${dMean.toFixed(5)}  ${dMean > 0 ? '(a power jobb)' : dMean < 0 ? '(a proportional jobb)' : ''}`);
  L(`    szórás              ${dSd.toFixed(5)}`);
  L(`    t                   ${t.toFixed(2)}`);
  L('');
  if (Math.abs(t) >= 2) {
    L('    |t| >= 2 — a különbség a jelenlegi mintán kimutatható.');
  } else {
    L('    |t| < 2 — EZ NEM EREDMÉNY. A minta nem dönti el a kérdést.');
    if (dMean !== 0 && Number.isFinite(dSd)) {
      const need = Math.ceil(Math.pow(2 * dSd / dMean, 2));
      L(`    Ekkora hatáshoz kb. ${need} piac kellene (most ${diffs.length} van).`);
    }
  }
  L('');
  L('    A piacok nem teljesen függetlenek: egy játéknap meccsei együtt');
  L('    mozognak, tehát a valódi szórás ennél nagyobb. A t felső becslés.');

  // -- megbizhatosagi tabla oddssav szerint
  //
  // A savhatarok a build.js:63 savjai, hogy a szamok kozvetlenul
  // osszevethetok legyenek a margin.js:54 idezett eltolasaival
  // (1.0-1.6 +2.80pp, 3.2-5.0 -1.97pp, 5.0+ -3.82pp).
  const BANDS = [[1.0, 1.6], [1.6, 2.2], [2.2, 3.2], [3.2, 5.0], [5.0, Infinity]];

  L('');
  L('  KALIBRÁCIÓ ODDSSÁVONKÉNT  (becsült vs. tényleges találati arány)');
  L('');
  L('    sáv           n     power    prop.   tényleges   ±2SE');
  for (const [lo, hi] of BANDS) {
    const rows = outcomeRecords.filter(r => r.odds >= lo && r.odds < hi);
    if (!rows.length) continue;
    const actual = rows.filter(r => r.won).length / rows.length;
    // Binomialis szoras. A kimenetelek egy piacon belul fuggnek egymastol,
    // tehat ez is ALSO becsles a bizonytalansagra.
    const se2 = 2 * Math.sqrt(actual * (1 - actual) / rows.length) * 100;
    const label = hi === Infinity ? `${lo.toFixed(1)}+` : `${lo.toFixed(1)}–${hi.toFixed(1)}`;
    L(`    ${label.padEnd(11)}${String(rows.length).padStart(5)}` +
      `${(mean(rows.map(r => r.pPower)) * 100).toFixed(2).padStart(9)}%` +
      `${(mean(rows.map(r => r.pProp)) * 100).toFixed(2).padStart(8)}%` +
      `${(actual * 100).toFixed(2).padStart(11)}%` +
      `${se2.toFixed(2).padStart(8)}`);
  }
  L('');
  L('    Amelyik becslés a tényleges oszlophoz közelebb van, az a jobb — de');
  L('    csak ott, ahol a ±2SE nem fedi le a kettő különbségét.');

  // -- reszletek
  if (args.reszletek) {
    if (unknownMarkets.size) {
      L('');
      L('  ISMERETLEN PIACOK  (nincs elszámoló szabály, ezért kimaradtak)');
      L('');
      for (const [name, n] of [...unknownMarkets].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
        L(`    ${String(n).padStart(5)}  ${name}`);
      }
      L('');
      L('    Ezek a végeredményből elvileg elszámolhatók. Ha egy család itt');
      L('    nagy számmal szerepel, megéri felvenni az outcomeOf()-ba — de');
      L('    egyenként, mért cimke-alakkal, nem mintára találgatva.');
    }
    if (unmatchedTeams.size) {
      L('');
      L('  PÁROSÍTATLAN CSAPATNEVEK  (a research/teams.js ALIAS táblájába kellenek)');
      L('');
      for (const [name, n] of [...unmatchedTeams].sort((a, b) => b[1] - a[1])) {
        L(`    ${String(n).padStart(5)}  ${name}`);
      }
    }
  } else if (unknownMarkets.size || unmatchedTeams.size) {
    L('');
    L(`  (${unknownMarkets.size} ismeretlen piactípus, ${unmatchedTeams.size} párosítatlan csapatnév — node local/calib.js --reszletek)`);
  }

  L('');
}

// A tiszta fuggvenyek kivezetve, hogy a calib_test.js hajthassa oket. A futtatas
// csak kozvetlen hivasnal indul - kulonben a teszt betoltese lekerne a feedet.
module.exports = {
  main, outcomeOf, lineOf, seasonCode, findCsvName, wordPrefixMatch, sideOfLabel,
  csvFor, LEAGUE_CSV, MAX_PLAUSIBLE_MARGIN, mean, sd,
};

if (require.main === module) {
  main().catch(err => {
    console.error('\nHIBA:', err.message);
    process.exit(1);
  });
}
