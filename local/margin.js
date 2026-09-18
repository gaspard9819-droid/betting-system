// Margo-szamitas es lab-koltseg.
//
// EZ A RANGSOR ALAPJA. Nincs predikcio: a repo sajat merese szerint a
// model_prob rangsora MINDHAROM oddssavban forditott (slip.js:19-30):
//
//   sav        model_prob felso/also negyed     market_prob felso/also negyed
//   1.3-2.0       -3.04% / +0.75%                  -0.61% / -4.48%
//   2.0-3.2       -7.25% / -2.47%                  -3.72% / -8.40%
//   3.2-5.0      -12.74% / -10.73%                 -5.71% / -18.23%
//
// Amit a modell a legjobban szeret, az terul meg a legrosszabbul. Ezert nem
// becsuljuk az EV-t - a KOLTSEGET minimalizaljuk, ami merheto es nem fuggi
// attol, hogy eltalaljuk-e az eredmenyt.

// ----------------------------------------------------------------- de-vigeles
//
// Egy konyv arabol: a margot aranyosan vonjuk le. A cups_fetch.js:207-215
// logikaja.
//
// KORLAT, amit a hivo lat: az aranyos levonas favorit-longshot torzitast
// hordoz - a rovid labon a valodi margo kisebb, a hosszun nagyobb, mint amit
// ez ad. A devig_check.js merte (7228 meccs): a hatvany-modszer jobb a
// Pinnacle zaroaron (0.96302 -> 0.96245), de a torzitas iranya ott is ugyanaz.
// Egy konyvbol nincs jobb - ezert ez a szam BECSLES, nem meres.
function devig(picks) {
  if (!picks || picks.length < 2) return null;
  const ipSum = picks.reduce((s, p) => s + 1 / p.odds, 0);
  // ipSum <= 1: ertelmetlen vagy mar de-viggelt piac. Ilyenkor nincs mit
  // levonni, es a "margo" negativ lenne - a piac kimarad a rangsorbol.
  if (!(ipSum > 1)) return null;
  return {
    probs: picks.map(p => (1 / p.odds) / ipSum),
    marginPct: (ipSum - 1) * 100,
  };
}

// --------------------------------------------------------- lab-koltseg savok
//
// A shipped gorbe mert lab-koltsege oddssav szerint (README.md:571), Pinnacle
// fair arhoz kepest. Ez indokolja a @5.00 puha plafont: 5.0 folott a koltseg
// meredeken nő.
const BAND_COST = [
  { lo: 1.00, hi: 2.00, cost: 0.23 },
  { lo: 2.00, hi: 3.20, cost: 2.67 },
  { lo: 3.20, hi: 5.00, cost: 5.64 },
  { lo: 5.00, hi: 8.00, cost: 12.32 },
  { lo: 8.00, hi: Infinity, cost: 21.15 },
];

function bandCost(odds) {
  const b = BAND_COST.find(x => odds >= x.lo && odds < x.hi);
  return b ? b.cost : BAND_COST[BAND_COST.length - 1].cost;
}

// ------------------------------------------------------- piac-margo referencia
//
// Mert medianok 25 meccsen, README.md:368. Akkor hasznaljuk, ha a piac
// hianyos (nincs meg minden kimenetel), tehat a de-vig nem margot merne,
// hanem hianyt.
//
// A `fallback` nem elorejelzes: ha egy piacra se de-vig, se referencia nincs,
// a lab KIMARAD a rangsorbol. Inkabb hianyzik egy lab, mint hogy kitalalt
// szammal keruljon be.
const MARKET_REF = [
  { rx: /Szuper odds/i,            pct: 2.22 },
  { rx: /^1X2$/i,                  pct: 6.15 },
  { rx: /Ázsiai hendikep/i,        pct: 6.46 },
  { rx: /Gólszám/i,                pct: 6.76 },
  { rx: /Mindkét csapat szerez/i,  pct: 7.50 },
  { rx: /Hendikep/i,               pct: 9.46 },
];

function referenceMargin(marketName) {
  const hit = MARKET_REF.find(r => r.rx.test(marketName || ''));
  return hit ? hit.pct : null;
}

// ------------------------------------------------------------------ lab-epites
//
// Egy piacbol annyi lab lesz, ahany kimenetele van. Minden lab megkapja:
//   - a sajat arat
//   - a piac margojat (mert vagy referencia)
//   - a de-viggelt valoszinuseget
//   - a becsult koltseget
//
// A koltseg ket reszbol all:
//   legCost = piac margoja / kimenetelek szama  +  oddssav buntetese
//
// A margot OSZTJUK a kimenetelek szamaval, mert a margo a TELJES piacra
// vonatkozik: egy harom kimenetelu 1X2 6.15%-a nem azt jelenti, hogy minden
// egyes lab 6.15%-ot visz, hanem hogy a konyv ennyit tart meg a piac egeszen.
// Egy labra eso resz ennek az aranyos hanyada.
// Piac-csalad: a vonalszam nelkuli alak.
//
// A "Gólszám 2.5", "Gólszám 2.75", "Gólszám 3" ugyanaz a fogadas mas vonalon.
// Ha a szelvenyre harom kulonbozo meccsrol kerul "Gólszám x - Több", az
// EGYETLEN feltevesre epul: hogy golgazdag a fordulo. A jointP ezt nem
// mutatja, mert fuggetlennek veszi a labakat - a valodi kockazat nagyobb.
//
// Ezert a diverzitas-korlat a csaladra szamol, nem a pontos nevre.
function marketFamily(name) {
  return String(name || '')
    .replace(/\s*-?\s*\d+(?:[.,]\d+)?\s*$/, '')   // vonalszam a vegen
    .replace(/\s+[-+]?\d+(?:[.,]\d+)?\s*/, ' ')    // vagy kozepen (hendikep)
    .trim();
}

function legsFrom(match, market) {
  const dv = devig(market.picks);
  const ref = referenceMargin(market.name);

  // Se de-vig, se referencia: a piac kimarad. Nem talalunk ki szamot.
  if (!dv && ref === null) return [];

  const marginPct = dv ? dv.marginPct : ref;
  const perLegMargin = marginPct / market.picks.length;

  return market.picks.map((p, i) => ({
    matchId: match.id,
    match: match.name,
    home: match.home,
    away: match.away,
    league: match.league,
    kickoff: match.kickoff,
    startTime: match.startTime,

    market: market.name,
    marketFamily: marketFamily(market.name),
    marketCode: market.code,
    isBoost: market.isBoost,
    label: p.label,
    odds: p.odds,
    // A kimenetel iranya: "Több"/"Kevesebb", "Igen"/"Nem". Ket kulonbozo
    // meccs "Több, mint 2.5" labja ugyanabba az iranyba fogad.
    side: /Több|Igen|Over/i.test(p.label) ? 'over'
        : /Kevesebb|Nem|Under/i.test(p.label) ? 'under' : null,

    marketMarginPct: marginPct,
    marginSource: dv ? 'mert' : 'referencia',
    prob: dv ? dv.probs[i] : 1 / p.odds,

    legCost: perLegMargin + bandCost(p.odds),
  }));
}

// A teljes kinalat labakra bontva.
function allLegs(matches, { minOdds = 1.12, maxOdds = 8.0 } = {}) {
  const out = [];
  for (const m of matches) {
    for (const mk of m.markets) {
      for (const leg of legsFrom(m, mk)) {
        if (leg.odds < minOdds || leg.odds > maxOdds) continue;
        out.push(leg);
      }
    }
  }
  return out;
}

// Egy szelveny becsult megtartott erteke.
//
// A margo labankent szorzodik (docs: 2 lab 85.7%, 4 lab 73.5%). A szamitas a
// labak SAJAT margoival megy, nem atlaggal - ezert lesz egy boostolt lab
// erezheto kulonbseg.
function slipValue(legs) {
  let retained = 1;
  for (const l of legs) retained *= (1 - l.legCost / 100);
  const totalOdds = legs.reduce((a, l) => a * l.odds, 1);
  const jointP = legs.reduce((a, l) => a * l.prob, 1);
  return {
    totalOdds,
    jointP,
    retainedPct: retained * 100,
    totalCostPct: (1 - retained) * 100,
  };
}

module.exports = { devig, bandCost, referenceMargin, marketFamily, legsFrom, allLegs, slipValue, BAND_COST, MARKET_REF };
