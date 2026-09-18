// Szelvenyepites margo-minimalizalassal.
//
// A kereso a research/slip.js DFS-e: legkevesebb lab, egy meccs egy lab,
// puha odds-plafon ket menetben, +-tolerancia a cel korul. Az a resz valtozatlan,
// mert mert indokai vannak (lasd slip.js fejlec).
//
// AMI VALTOZIK: a rangsor. A slip.js piaci valoszinuseggel rangsorol
// (`_q = market_prob`, `score = jointP * (1 - drift)`), mert ott a slate
// BECSULT tippmix-arakat hordozott, es a valoszinuseg volt a legjobb elerheto
// jelzes. Itt minden ar MERT, tehat a margo kozvetlenul szamolhato - es a
// margo az, amit a repo merese szerint erdemes minimalizalni:
//
//   - boost: ~2% margo a rendes 4.3-6.5% helyett, ket labon ~7pp (README:251)
//   - lab-szam: margo labankent szorzodik, ~8%/lab (docs)
//   - oddssav: -0.23% (1.3-2.0) ... -12.32% (5.0-8.0) (README:571)
//
// Ez nem EV-becsles. Az EV-hez eles referencia-ar kellene (Pinnacle), ami
// egy konyvbol nincs. A koltseg viszont szamolhato, es kisebb koltseg
// azonos kimenetel mellett mindig jobb.

const { slipValue } = require('./margin.js');

function buildSlip(pool, opts = {}) {
  const T = opts.target;
  const maxLegs = opts.maxLegs || 4;
  const minLegOdds = opts.minLegOdds || 1.20;
  const maxLegOdds = opts.maxLegOdds || 5.00;
  const minLegs = opts.minLegs || 2;
  const tol = opts.tolerance || 0.12;
  const POOL_CAP = opts.poolCap || 60;

  if (!Number.isFinite(T) || T <= 1) return { ok: false, reason: 'ervenytelen_cel' };

  let cand = pool.filter(l => Number.isFinite(l.odds) && l.odds >= minLegOdds && Number.isFinite(l.legCost));
  if (!cand.length) return { ok: false, reason: 'ures_kinalat' };

  // NINCS piac-csalad szerinti korlat - es ez meres eredmenye, nem mulasztas.
  //
  // Volt ilyen szabaly (max 2 lab ugyanabbol a piac-csaladbol es iranybol),
  // azzal az indokkal, hogy harom "tobb mint X gol" lab harom meccsrol
  // ugyanarra az arazasi torzitasra epul: ha a konyv az over-oldalt
  // szisztematikusan dragabban adja, az mindharom labon ul.
  //
  // MEGMERVE 2026-09-19, 148 kozel 50/50-es golszam vonalon: az over oldal a
  // margo 49.8%-at viseli (median 49.7%). Szimmetrikus. A margo a
  // vonal-savokon is lapos: 5.98% / 5.93% / 5.77% / 6.03%.
  //
  // Az "emberek szeretik az overt, a konyv ezt bearazza" allitas elterjedt,
  // de ezen az adaton nem igaz. Mert indok nelkul nem szukitjuk a poolt.
  //
  // AMI MARAD: egy meccsbol egy lab. Az mert - README.md:499: ugyanazon meccs
  // ket labanal a szorzat 9.16 lett volna, a Tippmixpro 5.25-ot irt ki
  // (-21.9% netto), mert ott UGYANAZ az esemeny szerepel ketszer.


  // Rangsor: OLCSOBB LAB ELOBB. A legCost kisebb = jobb.
  cand.forEach(l => { l._q = -l.legCost; });
  cand.sort((a, b) => b._q - a._q);

  // Retegzett vagas odds-savonkent (slip.js:99). Tiszta koltseg szerinti
  // vagas kiszorna az osszes hosszu labat, es a nagy celok elerhetetlenne
  // valnanak.
  const BANDS = [[1.0, 1.6], [1.6, 2.2], [2.2, 3.2], [3.2, 5.0], [5.0, Infinity]];
  const perBand = Math.max(6, Math.ceil(POOL_CAP / BANDS.length));
  const picked = [];
  for (const [blo, bhi] of BANDS) {
    picked.push(...cand.filter(l => l.odds >= blo && l.odds < bhi).slice(0, perBand));
  }
  cand = picked.sort((a, b) => b._q - a._q);

  const lo = T * (1 - tol), hi = T * (1 + tol);

  const search = (cap) => {
    const pool2 = cand.filter(l => l.odds <= cap);
    if (!pool2.length) return null;

    const maxOdds = Math.max(...pool2.map(l => l.odds));
    const nMin = Math.max(minLegs, Math.ceil(Math.log(T) / Math.log(maxOdds)));
    if (nMin > maxLegs) return { failed: 'cel_tul_magas', nMin, maxLegs, maxOdds };

    // MINDEN labszamot vegigprobalunk, es a LEGOLCSOBB nyer.
    //
    // A research/slip.js az ELSO n-nel megall, amin van megoldas ("legkevesebb
    // lab"). Ott ez helyes volt: a slate BECSULT tippmix-arakat hordozott
    // (tippmixRatio(), 2.31% atlagos hiba), tehat a koltseget nem lehetett
    // megbizhatoan osszehasonlitani labszamok kozott - a "kevesebb lab
    // kevesebb margo" hasznalhato kozelites volt.
    //
    // Itt minden ar MERT, tehat a koltseg kozvetlenul szamolhato. Es a
    // kozelites nem all: a hosszu labak buntetese (README.md:571) gyorsabban
    // no, mint amennyit egy plusz lab hozzatesz.
    //
    // Merve 2026-09-19 a mai kinalaton, ugyanarra a celra:
    //
    //   cel     1 lab    2 lab    3 lab
    //   2.1x    1.60%    2.70%    6.33%    <- a kevesebb lab olcsobb
    //   3x      3.28%    2.36%    3.03%    <- mar megfordul
    //   5x      6.03%    3.89%    2.53%
    //   10x     nincs    9.12%    5.42%
    //   20x     nincs   12.59%   10.14%
    //
    // Az 5x-es peldan a regi logika ket labat adott volna (3.89%), pedig a
    // harom olcsobb (2.53%).
    const byN = [];
    for (let n = nMin; n <= maxLegs; n++) {
      const found = [];

      const dfs = (start, chosen, prod, usedMatches) => {
        if (found.length >= 400) return;
        if (chosen.length === n) {
          if (prod >= lo && prod <= hi) found.push({ legs: [...chosen], prod });
          return;
        }
        const remaining = n - chosen.length;
        for (let i = start; i < pool2.length; i++) {
          if (pool2.length - i < remaining) break;
          const l = pool2[i];
          if (usedMatches.has(l.matchId)) continue;                 // egy meccs = egy lab
          const p = prod * l.odds;
          if (p * Math.pow(maxOdds, remaining - 1) < lo) continue;
          if (p > hi) continue;
          usedMatches.add(l.matchId);
          chosen.push(l);
          dfs(i + 1, chosen, p, usedMatches);
          chosen.pop();
          usedMatches.delete(l.matchId);
        }
      };
      dfs(0, [], 1, new Set());

      if (found.length) {
        // PONTOZAS: a legolcsobb kombinacio nyer.
        //
        // A koltseg szazalekpontban van, a drift aranyban - ezert a drift
        // 50-es szorzoja. Igy egy 1%-os cel-elteres 0.5 "szazalekpontnyi"
        // buntetest er: a tolerancian belul a KOLTSEG dont, nem az, hogy
        // melyik kombinacio kozeliti jobban a celt.
        for (const f of found) {
          const v = slipValue(f.legs);
          const drift = Math.abs(f.prod - T) / T;
          f.cost = v.totalCostPct;
          f.retainedPct = v.retainedPct;
          f.jointP = v.jointP;
          f.boosted = f.legs.filter(l => l.isBoost).length;
          f.score = -(v.totalCostPct + drift * 50);
        }
        // Elsodleges a pontszam; a boost csak DONTETLENT bont - a boost
        // elonye mar benne van a legCost-ban, kulon bonusz megsem-jobb
        // kombinaciot hozna fel.
        found.sort((a, b) => (b.score - a.score) || (b.boosted - a.boosted));
        const winner = found[0];
        winner.n = n;
        byN.push(winner);
      }
    }

    if (!byN.length) return null;
    // A legolcsobb labszam nyer. Dontetlennel a KEVESEBB lab - kevesebb
    // dolog tud rosszul elsulni (lemondott meccs, felfuggesztett piac).
    byN.sort((a, b) => (a.cost - b.cost) || (a.n - b.n));
    return byN[0];
  };

  // Ket menet: eloszor a puha plafonnal, aztan nelkule.
  let best = search(maxLegOdds);
  let relaxed = false;
  if (!best || best.failed) {
    const second = search(Infinity);
    if (second && !second.failed) { best = second; relaxed = true; }
    else if (!best) best = second;
  }

  if (!best) return { ok: false, reason: 'nincs_kombinacio' };
  if (best.failed) {
    return { ok: false, reason: best.failed, nMin: best.nMin, maxLegs: best.maxLegs, maxOdds: best.maxOdds };
  }

  return {
    ok: true,
    legs: best.legs,
    n: best.n,
    totalOdds: best.prod,
    jointP: best.jointP,
    costPct: best.cost,
    retainedPct: best.retainedPct,
    boosted: best.boosted,
    cappedRelaxed: relaxed,
    target: T,
  };
}

module.exports = { buildSlip };
