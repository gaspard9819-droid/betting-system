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

  // MEGKOTES, amit a slip.js nem ismer: piac-CSALAD es IRANY szerinti korlat.
  //
  // A slip.js `event_id` szurese kizarja, hogy egy meccsrol ket lab keruljon
  // a szelvenyre. De ugyanaz a piac KULONBOZO meccseken is felbukkan, es ha
  // harom lab ugyanaz ("tobb mint 1.5 gol") harom meccsrol, akkor a szelveny
  // EGYETLEN feltevesre epul: hogy golgazdag a fordulo.
  //
  // Ez rejtett korrelacio: a jointP fuggetlennek veszi a labakat, tehat
  // TULBECSULI a bejovesi eselyt. A vonalszam nem szamit - a "2.5 folott" es
  // a "3.5 folott" ugyanaz az irany -, ezert a csaladra + iranyra szamolunk,
  // nem a pontos piacnevre.
  const familyCap = Number(opts.maxPerFamily) || 2;

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

    for (let n = nMin; n <= maxLegs; n++) {
      const found = [];

      const dfs = (start, chosen, prod, usedMatches, famCount) => {
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
          const fam = (l.marketFamily || l.market) + '|' + (l.side || '');
          if ((famCount.get(fam) || 0) >= familyCap) continue;       // piac-diverzitas
          const p = prod * l.odds;
          if (p * Math.pow(maxOdds, remaining - 1) < lo) continue;
          if (p > hi) continue;
          usedMatches.add(l.matchId);
          famCount.set(fam, (famCount.get(fam) || 0) + 1);
          chosen.push(l);
          dfs(i + 1, chosen, p, usedMatches, famCount);
          chosen.pop();
          famCount.set(fam, famCount.get(fam) - 1);
          usedMatches.delete(l.matchId);
        }
      };
      dfs(0, [], 1, new Set(), new Map());

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
        return winner;
      }
    }
    return null;
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
