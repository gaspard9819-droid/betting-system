// Meccsek es piacok lekerese a Tippmixpro feedbol.
//
// MIERT BAJNOKSAGONKENT, nem a kiemelt listabol: a
// `highlighted-popular-matches` topik a Tippmixpro szerkesztoi valogatasa, es
// NEM esik egybe a boostolt kinalattal. Merve 2026-09-18: mind az ot aktualis
// Szuper oddsos meccs hianyzott belole, 50-es es 200-as lapmerettel is. Ezert
// ad a research/boost_fetch.js nullat.
//
// A bajnoksag-topik minden meccset lat, es a `match-odds` kod nelkul minden
// piacot - beleertve a 693-3 boostot is. Igy egy lekeresbol megvan a teljes
// kinalat, kulon boost-script nelkul.

const { connect, topics } = require('./feed.js');

// ---------------------------------------------------------------- bajnoksagok
//
// Az id-k a meglevo scriptekbol jonnek: a topligak a tippmix_feed.js:69-75-bol,
// a kupak a cups_fetch.js:48-52-bol (a 67-es kategoriabol felderitve).
//
// Ha egy id elavul szezonvaltasnal, a tunete: 0 meccs arra a ligara, hiba
// nelkul. Ujra-felderites:
//   node research/tippmix_discover.js --cat 67     (kupak)
//   node research/tippmix_discover.js --cat 77     (Anglia)

const LEAGUES = [
  { key: 'PL',  name: 'Premier League', tid: '304261874774142976' },
  { key: 'SP1', name: 'La Liga',        tid: '304261428958425088' },
  { key: 'D1',  name: 'Bundesliga',     tid: '305538299534733312' },
  { key: 'I1',  name: 'Serie A',        tid: '304262837539926016' },
  { key: 'F1',  name: 'Ligue 1',        tid: '304906786944282624' },
];

const CUPS = [
  { key: 'BL', name: 'Bajnokok Ligaja',   tid: '305538761002545152' },
  { key: 'EL', name: 'Europa-liga',       tid: '306343242866847744' },
  { key: 'KL', name: 'Konferencia-liga',  tid: '306340432262688768' },
];

// ------------------------------------------------------------- piac-szures
//
// Egy topligas meccsen ~987 piac van (merve 2026-09-18). A tobbsegе
// hasznalhatatlan a szelvenyepiteshez: jatekos-statisztikak, idoszakasz-piacok,
// egzotikumok. Ezek kizarasa nem izles kerdese:
//
//  - jatekos-piac (szerelesek, szabalytalansagok, kapura tartas): egyedi
//    jatekosra szol, a kezdocsapattol fugg, amit meccs elott nem tudunk
//  - Csodacsere: sajat termek-mechanika, az ar nem osszehasonlithato
//  - idoszakasz ("0:00-15:00 kozott"): sokkal zajosabb, mint a teljes meccs
//  - szoglet/lap: a mert margo itt a legnagyobb (8.61% / 9.46%, README.md:368)

const SKIP_MARKET = /Csodacser|gólpassz|szerelés|szabálytalanság|Melyik játékos|kapura tartó|időszakasz|adott időszak|Büntetőlap|[Ss]zöglet/;

// Csak rendes jatekido. A felidos piacok kulon kockazat: rovidebb minta,
// nagyobb szoras, es a margo is magasabb rajtuk.
const FULL_TIME_PART = '3';

function cleanMarketName(name) {
  return String(name || '').replace(' - Rendes játékidő', '').trim();
}

// Egy meccs osszes hasznalhato ara.
//
// A feed harom rekordbol rakja ossze az arat: MARKET + OUTCOME +
// BETTING_OFFER, amiket a MARKET_OUTCOME_RELATION kot ossze. Ez a bontas a
// tippmix_feed.js:143 `extractOdds` logikaja, piac-nev megtartassal.
function extractMarkets(records) {
  const outcomes = new Map(records.filter(r => r._type === 'OUTCOME').map(o => [o.id, o]));
  const offers = new Map();
  for (const b of records.filter(r => r._type === 'BETTING_OFFER')) offers.set(b.outcomeId, b);
  const relations = records.filter(r => r._type === 'MARKET_OUTCOME_RELATION');

  const out = [];
  for (const mk of records.filter(r => r._type === 'MARKET')) {
    if (mk.isClosed) continue;
    if (String(mk.eventPartId) !== FULL_TIME_PART) continue;

    const rawName = mk.translatedName || mk.headerName || mk.name || '';
    if (SKIP_MARKET.test(rawName)) continue;

    const code = mk.bettingTypeId + '-' + mk.eventPartId;
    const picks = [];
    for (const rel of relations.filter(r => r.marketId === mk.id)) {
      const oc = outcomes.get(rel.outcomeId);
      const off = offers.get(rel.outcomeId);
      // Lezart piac vagy nem elerheto ajanlat arat NEM visszuk: azok nem
      // olyan arak, amiken barki fogadhatott volna.
      if (!oc || !off || off.isAvailable === false) continue;
      if (!Number.isFinite(off.odds)) continue;
      picks.push({
        label: (oc.translatedName || oc.headerName || '').trim(),
        type: oc.typeName || '',
        odds: off.odds,
        lastChanged: Number.isFinite(Number(off.lastChangedTime))
          ? new Date(Number(off.lastChangedTime)).toISOString() : null,
      });
    }
    if (!picks.length) continue;

    out.push({
      code,
      bettingTypeId: mk.bettingTypeId,
      name: cleanMarketName(rawName),
      // A boost sajat bettingTypeId-t kap (693). Merve 2026-09-16: a boostolt
      // piac margoja ~2%, a rendese 4.3-6.5% - ket labon ~7 szazalekpont
      // megtartott ertek (README.md:251).
      isBoost: String(mk.bettingTypeId) === '693',
      picks,
    });
  }
  return out;
}

// Meccsek egy bajnoksagbol, ido-ablakkal szurve.
async function matchesOf(feed, tid, { minHours = 0.17, maxHours = 96 } = {}) {
  const recs = await feed.dump(topics.tournament(tid));
  const now = Date.now();
  return recs
    .filter(r => r._type === 'MATCH')
    .filter(m => {
      const h = (Number(m.startTime) - now) / 3600000;
      // A 0.17 ora (10 perc) also hatar a cups_fetch.js:277-bol: kezdes elott
      // 10 perccel mar nem erdemes szelvenyre tenni.
      return h >= minHours && h <= maxHours;
    })
    .map(m => ({
      id: m.id,
      name: m.name,
      home: m.homeParticipantName,
      away: m.awayParticipantName,
      league: m.parentName || '',
      startTime: Number(m.startTime),
      kickoff: new Date(Number(m.startTime)).toISOString(),
    }));
}

// A teljes kinalat: meccsek + minden piacuk.
//
// Ket korben megy: eloszor a meccslistak bajnoksagonkent, aztan meccsenkent a
// piacok. Egy meccs bukasa nem allitja meg a gyujtest, de LATSZIK - a hibak
// visszaadva, nem elnyelve.
async function collect({ maxHours = 96, includeCups = true, onProgress } = {}) {
  const feed = await connect();
  const errors = [];
  try {
    const sources = includeCups ? [...LEAGUES, ...CUPS] : LEAGUES;
    const matches = [];

    for (const src of sources) {
      try {
        const ms = await matchesOf(feed, src.tid, { maxHours });
        for (const m of ms) matches.push({ ...m, source: src.key, sourceName: src.name });
        if (onProgress) onProgress(`${src.name}: ${ms.length} meccs`);
      } catch (err) {
        errors.push({ where: src.name, message: err.message });
        if (onProgress) onProgress(`${src.name}: HIBA - ${err.message}`);
      }
    }

    // Duplikatum-szures: egy meccs tobb forrasban is szerepelhet.
    const seen = new Set();
    const unique = matches.filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });

    const withOdds = [];
    for (const m of unique) {
      try {
        const recs = await feed.dump(topics.matchOdds(m.id));
        const markets = extractMarkets(recs);
        if (markets.length) withOdds.push({ ...m, markets });
      } catch (err) {
        errors.push({ where: m.name, message: err.message });
      }
    }

    return { matches: withOdds, errors, fetchedAt: new Date().toISOString() };
  } finally {
    feed.close();
  }
}

module.exports = { collect, matchesOf, extractMarkets, LEAGUES, CUPS, SKIP_MARKET };
