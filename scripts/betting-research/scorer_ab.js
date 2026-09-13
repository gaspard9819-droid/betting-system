// A/B: a Slip Builder labpontozasa model_prob-bal (jelenlegi) vs piaci valoszinuseggel.
//
// A slip.js a _q rangsort ES a jointP pontszamot is a model_prob-bol szamolja, pedig
// a market_ref.js szerint a modell rangsora minden savban forditott, a Pinnacle-fair
// rangsor pedig helyes iranyu. Itt a TELJES epito-logikat futtatjuk valos napi
// poolokon, es a KIVALASZTOTT labak realizalt ROI-jat merjuk tippmix aron.
// A lab-szintu ROI a tisztabb mero (tobb ezer lab), a szelveny-szintu zajos.
//
// Valtozatok:
//   A  jelenlegi: _q = model_prob + bizalmi bonusz, ALACSONY kizarva, jointP = PI model_prob
//   B  piaci:     _q = market_prob (Pinnacle-fair), ALACSONY kizarva, jointP = PI market_prob
//   C  piaci, Avg-alapu valoszinuseggel (ha a Pinnacle nem lenne az eu regioban)
// Futtatas: cd data && node ../scorer_ab.js
const { loadAll, TIPPMIX, devig, roi, roiSe, mean } = require('./odds_loader.js');
const { computeRatings } = require('./ratings.js');
const { predictMatch } = require('./predict.js');

const all = loadAll();
let ratings = null, at = null;
const rows = [];
for (let i = 200; i < all.length; i++) {
  const m = all[i];
  if (!m.psc || !m.avgc || !m.maxc || !m.ou_pc || !m.ou_avgc) continue;
  if (!at || (new Date(m.date) - at) > 7 * 86400000) { ratings = computeRatings(all.filter(x => x.date < m.date), m.date); at = new Date(m.date); }
  const R = {}; ratings.forEach(r => R[r.league + '|' + r.team] = r);
  const hr = R[m.league + '|' + m.home], ar = R[m.league + '|' + m.away];
  if (!hr || !ar || hr.matches < 8 || ar.matches < 8) continue;
  const p = predictMatch(hr, ar, hr.league_avg_goals, hr.home_advantage);
  rows.push({ m, pm: [p.home, p.draw, p.away], pmou: [p.over25, 1 - p.over25],
    pin: devig(m.psc).probs, pinOU: devig(m.ou_pc).probs, avg: devig(m.avgc).probs, avgOU: devig(m.ou_avgc).probs,
    max: devig(m.maxc).probs, maxOU: m.ou_maxc ? devig(m.ou_maxc).probs : devig(m.ou_avgc).probs });
}
const byDay = {};
for (const r of rows) (byDay[r.m.date.slice(0, 10)] = byDay[r.m.date.slice(0, 10)] || []).push(r);
const days = Object.entries(byDay).filter(([, rs]) => rs.length >= 8);
console.log(`Ertekelt meccsek: ${rows.length}, napok legalabb 8 meccsel: ${days.length}\n`);

const conf = d => Math.abs(d) <= 0.03 ? 'MAGAS' : d <= 0.08 ? 'KOZEPES' : 'ALACSONY';
const confBonus = c => (c === 'MAGAS' ? 0.06 : c === 'KOZEPES' ? 0.02 : 0);
function dayPool(rs) {
  const pool = [];
  rs.forEach((r, i) => {
    const push = (ot, mp, pin, avg, mx, win) => {
      if (ot < 1.3) return;
      const c = conf(mp - mx);
      pool.push({ evt: i, ot, mp, pin, avg, conf: c, win,
        qA: mp + confBonus(c), qB: pin, qC: avg });
    };
    for (let k = 0; k < 3; k++) push(TIPPMIX(r.m.avgc[k]), r.pm[k], r.pin[k], r.avg[k], r.max[k], r.m.res === k);
    for (let k = 0; k < 2; k++) push(TIPPMIX(r.m.ou_avgc[k]), r.pmou[k], r.pinOU[k], r.avgOU[k], r.maxOU[k], r.m.over === k);
  });
  return pool;
}
// A slip.js search()-e: retegzett pool-vagas, legkevesebb lab, jointP*(1-drift) pontszam
function build(pool, T, qKey, pKey, cap) {
  let cand = pool.filter(l => l.conf !== 'ALACSONY');
  cand.sort((a, b) => b[qKey] - a[qKey]);
  const BANDS = [[1.0, 1.6], [1.6, 2.2], [2.2, 3.2], [3.2, 5.0], [5.0, Infinity]];
  const picked = [];
  for (const [blo, bhi] of BANDS) picked.push(...cand.filter(l => l.ot >= blo && l.ot < bhi).slice(0, 8));
  cand = picked.sort((a, b) => b[qKey] - a[qKey]);
  const lo = T * 0.88, hi = T * 1.12;
  const p2 = cand.filter(l => l.ot <= cap);
  if (!p2.length) return null;
  const maxOdds = Math.max(...p2.map(l => l.ot));
  const nMin = Math.max(2, Math.ceil(Math.log(T) / Math.log(maxOdds)));
  for (let n = nMin; n <= 6; n++) {
    const found = [];
    const dfs = (start, chosen, prod, used) => {
      if (found.length >= 400) return;
      if (chosen.length === n) { if (prod >= lo && prod <= hi) found.push({ legs: [...chosen], prod }); return; }
      const rem = n - chosen.length;
      for (let i = start; i < p2.length; i++) {
        if (p2.length - i < rem) break;
        const l = p2[i]; if (used.has(l.evt)) continue;
        const p = prod * l.ot;
        if (p * Math.pow(maxOdds, rem - 1) < lo) continue;
        if (p > hi) continue;
        used.add(l.evt); chosen.push(l); dfs(i + 1, chosen, p, used); chosen.pop(); used.delete(l.evt);
      }
    };
    dfs(0, [], 1, new Set());
    if (found.length) {
      let best = null;
      for (const f of found) {
        const jp = f.legs.reduce((a, l) => a * l[pKey], 1);
        const hiC = f.legs.filter(l => l.conf === 'MAGAS').length;
        f.score = jp * (1 + (qKey === 'qA' ? 0.05 * hiC : 0)) * (1 - Math.abs(f.prod - T) / T);
        f.n = n; f.win = f.legs.every(l => l.win);
        if (!best || f.score > best.score) best = f;
      }
      return best;
    }
  }
  return null;
}
const variants = { 'A jelenlegi (model_prob)': ['qA', 'mp'], 'B piaci (Pinnacle-fair)': ['qB', 'pin'], 'C piaci (Avg-fair)': ['qC', 'avg'] };
for (const T of [5, 10, 20]) {
  console.log(`CEL ${T}x  (@5 plafon, majd feloldva, mint a slip.js)`);
  console.log('   valtozat                     szelveny  atlag lab   LAB-SZINT: n     ROI@tippmix       talalat   atlag odds  |  SZELVENY: bejott    ROI');
  for (const [nm, [qKey, pKey]] of Object.entries(variants)) {
    const slips = [];
    for (const [, rs] of days) { const pool = dayPool(rs); const r = build(pool, T, qKey, pKey, 5) || build(pool, T, qKey, pKey, Infinity); if (r) slips.push(r); }
    const legs = slips.flatMap(s => s.legs.map(l => ({ win: l.win, odds: l.ot })));
    const sb = slips.map(s => ({ win: s.win, odds: s.prod }));
    console.log(`   ${nm.padEnd(28)} ${String(slips.length).padStart(5)}      ${mean(slips.map(s => s.n)).toFixed(2)}             ${String(legs.length).padStart(5)}   ${roi(legs).toFixed(2).padStart(7)}% ±${roiSe(legs).toFixed(1)}     ${(legs.filter(l => l.win).length / legs.length * 100).toFixed(1)}%     ${mean(legs.map(l => l.odds)).toFixed(2)}      |  ${(mean(slips.map(s => s.win ? 1 : 0)) * 100).toFixed(1).padStart(5)}%   ${roi(sb).toFixed(1).padStart(7)}% ±${roiSe(sb).toFixed(0)}`);
  }
  console.log();
}
// Ugyanaz a lab-halmaz? Mennyire ter el a ket valasztas?
let same = 0, tot = 0;
for (const [, rs] of days) { const pool = dayPool(rs); const a = build(pool, 10, 'qA', 'mp', 5), b = build(pool, 10, 'qB', 'pin', 5); if (a && b) { tot++; const sa = new Set(a.legs.map(l => l.evt + ':' + l.ot)); if (b.legs.every(l => sa.has(l.evt + ':' + l.ot))) same++; } }
console.log(`10x-nel a ket valtozat ugyanazt a szelvenyt adja: ${same}/${tot} napon`);
