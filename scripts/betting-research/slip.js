// WF-B / "Build Slip" node logikaja.
// Cel: adott T cel-osszodds elerese a LEHETO LEGKEVESEBB labbal.
// Indok (mert): a margo labankent szorzodik. 10x cel 3 labbal 79.4%-ot
// tart meg a fair ertekbol, 8 labbal csak 54%-ot.
//
// DE: a "legkevesebb lab" onmagaban extrem aru labat valaszt. Ezert van
// egy PUHA odds-plafon (maxLegOdds, alap 5.00): eloszor csak az az alatti
// labakkal keresunk, es csak akkor engedunk fole, ha maskepp nincs megoldas.
// Ket oka van a plafonnak:
//   1. a tippmixRatio() kalibracio csak 1.3-6.0 kozott mert - fole extrapolal
//   2. a modell rangsora forditva mukodik (vs_human.js: legjobb negyed -17.7%,
//      legrosszabb +1.4%), tehat magas oddsu lab valasztasaban nem bizhatunk
// A csere tudatos: 2 lab helyett 3 lab ~86% helyett ~79% ertekmegtartas,
// csereben nincs extrem lab.

function buildSlip(pool, opts) {
  const T = opts.target;
  const maxLegs = opts.maxLegs || 4;
  const minLegOdds = opts.minLegOdds || 1.30;
  const maxLegOdds = opts.maxLegOdds || 5.00;
  const minLegs = opts.minLegs || 2;
  const tol = opts.tolerance || 0.12;      // +-12% a cel korul
  const POOL_CAP = opts.poolCap || 40;

  // 1) szures
  let cand = pool.filter(l =>
    l.news_flag !== 'veto' &&
    l.confidence !== 'ALACSONY' &&
    l.tippmix_odds >= minLegOdds &&
    l.model_prob > 0
  );
  if (!cand.length) return { ok: false, reason: 'no_candidates' };

  // 2) minoseg szerinti rangsor, hogy a POOL_CAP vagas a jokat tartsa meg.
  //    A minoseg = modell-valoszinuseg + bizalmi bonusz. NEM a modell-piac
  //    elteres, mert a meres szerint az hibat szur, nem tudast.
  const confBonus = c => (c === 'MAGAS' ? 0.06 : c === 'KOZEPES' ? 0.02 : 0);
  cand.forEach(l => { l._q = l.model_prob + confBonus(l.confidence) - (l.news_flag === 'warn' ? 0.03 : 0); });
  cand.sort((a, b) => b._q - a._q);

  // Retegzett vagas odds-savonkent. Tiszta minoseg szerinti vagas kiszorna
  // az osszes magas oddsu labat (mert azok alacsony valoszinusegűek), es
  // akkor a nagy cel-oddsok elerhetetlenne valnanak. Savonkent tartunk meg
  // a legjobbakbol, igy minden celhoz marad anyag.
  const BANDS = [[1.0, 1.6], [1.6, 2.2], [2.2, 3.2], [3.2, 5.0], [5.0, Infinity]];
  const perBand = Math.max(4, Math.ceil(POOL_CAP / BANDS.length));
  const picked = [];
  for (const [blo, bhi] of BANDS) {
    picked.push(...cand.filter(l => l.tippmix_odds >= blo && l.tippmix_odds < bhi).slice(0, perBand));
  }
  cand = picked.sort((a, b) => b._q - a._q);

  const lo = T * (1 - tol), hi = T * (1 + tol);

  // Egy kereso-menet adott odds-plafonnal. Azert kulon fuggveny, hogy
  // ketszer futtathassuk: eloszor a plafonnal, aztan nelkule.
  const search = (cap) => {
    const pool2 = cand.filter(l => l.tippmix_odds <= cap);
    if (!pool2.length) return null;

    // A maxOdds a SZUKITETT listan szamolodik: kevesebb a felso hatar,
    // tehat tobb lab kell ugyanahhoz a celhoz. Pont ez a kivant hatas.
    const maxOdds = Math.max(...pool2.map(l => l.tippmix_odds));
    // Minimum 2 lab: aki szelvenyt ker, tobb labra gondol - egy lab sima
    // fogadas. Ha 2 labbal nem jon ki a cel, a lenti fallback ad 1 labasat.
    const nMin = Math.max(minLegs, Math.ceil(Math.log(T) / Math.log(maxOdds)));
    if (nMin > maxLegs) return { failed: 'target_too_high', nMin, maxLegs, maxOdds };

    // n novekvo sorrendben — az ELSO n, amin van megoldas, nyer.
    for (let n = nMin; n <= maxLegs; n++) {
      const found = [];

      // korlatozott melysegi kereses metszessel
      const dfs = (start, chosen, prod, usedMatches) => {
        if (found.length >= 400) return;                  // eleg jelolt
        if (chosen.length === n) {
          if (prod >= lo && prod <= hi) found.push({ legs: [...chosen], prod });
          return;
        }
        const remaining = n - chosen.length;
        for (let i = start; i < pool2.length; i++) {
          if (pool2.length - i < remaining) break;        // nem jon ki a letszam
          const l = pool2[i];
          if (usedMatches.has(l.event_id)) continue;      // egy meccs = egy lab
          const p = prod * l.tippmix_odds;
          // metszes: ha a maradek labakkal a maximum sem eri el a also hatart -> dobjuk
          if (p * Math.pow(maxOdds, remaining - 1) < lo) continue;
          // metszes: ha mar most tullotte a felso hatart -> dobjuk (odds >= 1)
          if (p > hi) continue;
          usedMatches.add(l.event_id);
          chosen.push(l);
          dfs(i + 1, chosen, p, usedMatches);
          chosen.pop();
          usedMatches.delete(l.event_id);
        }
      };
      dfs(0, [], 1, new Set());

      if (found.length) {
        // pontozas: egyuttes valoszinuseg dominal, a cel-elteres buntet
        for (const f of found) {
          const jointP = f.legs.reduce((a, l) => a * l.model_prob, 1);
          const hiCount = f.legs.filter(l => l.confidence === 'MAGAS').length;
          const drift = Math.abs(f.prod - T) / T;
          f.score = jointP * (1 + 0.05 * hiCount) * (1 - drift);
          f.jointP = jointP;
        }
        found.sort((a, b) => b.score - a.score);
        const winner = found[0];
        winner.n = n;
        return winner;                                    // NEM megyunk feljebb
      }
    }
    return null;
  };

  // 3a) Elso menet: csak a plafon alatti labak.
  let best = null, relaxed = false, capFail = null;
  const capped = search(maxLegOdds);
  if (capped && !capped.failed) best = capped;
  else capFail = capped;

  // 3b) Ha nincs megoldas a plafonnal, feloldjuk. Jobb egy dragabb lab,
  //     mint semmi - de a valasz jelzi, hogy ez a szelveny gyenge pontja.
  if (!best) {
    const open = search(Infinity);
    if (open && !open.failed) { best = open; relaxed = true; }
    else if (open && open.failed && !capFail) capFail = open;
  }

  if (best) best.capped_relaxed = relaxed;

  if (!best) {
    if (capFail && capFail.failed === 'target_too_high') {
      return { ok: false, reason: 'target_too_high',
        nMin: capFail.nMin, maxLegs: capFail.maxLegs, maxOdds: capFail.maxOdds };
    }
    // Nincs megoldas minLegs+ labbal - probaljuk egyetlen labbal, mielott
    // a kozelito agra mennenk. Alacsony celnal (pl. 3x) ez a helyes valasz.
    if (minLegs > 1) {
      const single = cand.filter(l => l.tippmix_odds >= lo && l.tippmix_odds <= hi);
      if (single.length) {
        single.sort((a, b) => b.model_prob - a.model_prob);
        return { ok: true, approximate: false, single_leg: true, n: 1,
          legs: [single[0]], prod: single[0].tippmix_odds,
          jointP: single[0].model_prob };
      }
    }
    // nincs pontos talalat — adjuk a legkozelebbit barmely n-en.
    // Ez a teljes jelolt-listan dolgozik (plafon nelkul): vegso mentsvar.
    const allMaxOdds = Math.max(...cand.map(l => l.tippmix_odds));
    const nMinAll = Math.max(1, Math.ceil(Math.log(T) / Math.log(allMaxOdds)));
    let closest = null;
    for (let n = nMinAll; n <= maxLegs; n++) {
      const greedy = [];
      const used = new Set();
      let prod = 1;
      for (const l of cand) {
        if (greedy.length >= n) break;
        if (used.has(l.event_id)) continue;
        if (prod * l.tippmix_odds > hi && greedy.length) continue;
        greedy.push(l); used.add(l.event_id); prod *= l.tippmix_odds;
      }
      if (greedy.length === n) {
        const d = Math.abs(prod - T);
        if (!closest || d < closest.d) {
          closest = { legs: greedy, prod, n, d,
            jointP: greedy.reduce((a, l) => a * l.model_prob, 1) };
        }
      }
    }
    if (!closest) return { ok: false, reason: 'no_combination' };
    return { ok: true, approximate: true, ...closest };
  }
  return { ok: true, approximate: false, ...best };
}

module.exports = { buildSlip };
