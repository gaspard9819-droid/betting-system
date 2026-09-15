// A Build Response node VALODI kodja, a workflow JSON-bol kiolvasva.
//
// Miert nem eleg a slip_test.js: az a lokalis slip.js-t teszteli, a
// deployolt node kodja viszont kulon masolat. A ketto elcsuszhat - ez a
// script pont azt zarja ki, hogy a boost-valtozas csak az egyikben legyen
// meg. Ugyanaz a recept, mint a settle_wf_test.js-ben.
//
// FUTTATAS:  node boost_wf_test.js

const fs = require('fs');
const path = require('path');

const WF = path.join(__dirname, '..', '..', 'workflows', 'Slip Builder.json');
const wf = JSON.parse(fs.readFileSync(WF, 'utf8'));
const node = wf.nodes.find(n => n.name === 'Build Response');
if (!node) throw new Error('nincs Build Response node a workflow JSON-ban');

// A node kodjabol csak a buildSlip fuggvenyt emeljuk ki: a tobbi resz n8n
// globalisokra ($input, $) tamaszkodik, amik itt nem leteznek.
const src = node.parameters.jsCode;
const start = src.indexOf('function buildSlip');
const endMark = '// ---------- bemenet ----------';
const end = src.indexOf(endMark);
if (start === -1 || end === -1) throw new Error('nem talalom a buildSlip hatarait a node kodjaban');
const fnSrc = src.slice(start, end);

// eslint-disable-next-line no-new-func
const buildSlip = new Function(fnSrc + '\nreturn buildSlip;')();

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  OK    ${name}`); }
  else { fail++; console.log(`  BUKIK ${name}${extra ? '  -> ' + extra : ''}`); }
};

const leg = (ev, market, sel, odds, prob, boost) => ({
  leg_id: `${ev}-${market}-${sel}`, event_id: ev,
  match_name: `Csapat${ev}A vs Csapat${ev}B`, league: 'Teszt Liga',
  market, selection: sel, label: `${market}/${sel}`,
  model_prob: prob, market_prob: prob, tippmix_odds: odds,
  ...(boost ? { boost_odds: boost, is_boosted: 'igen' } : {}),
  confidence: 'MAGAS', news_flag: 'ok', news_note: '',
});

console.log('\nA DEPLOYOLT NODE KODJA (nem a lokalis slip.js)');

console.log('\n1) a boostolt arat hasznalja');
{
  const pool = [
    leg('m1', 'h2h', 'home', 1.30, 0.740, 1.50),
    leg('m2', 'totals', 'over25', 1.33, 0.723),
  ];
  const r = buildSlip(pool, { target: 2.0, maxLegs: 4, minLegOdds: 1.25 });
  check('kijon a 2.0-es cel 2 labbal', r.ok && r.n === 2 && !r.approximate,
    r.ok ? `n=${r.n} approx=${r.approximate}` : r.reason);
  check('a boostolt 1.50 van benne',
    r.ok && r.legs.some(l => l.boost_odds === 1.50), '-');
  check('az osszodds ~1.995', r.ok && Math.abs(r.prod - 1.995) < 0.01,
    r.ok ? String(r.prod) : '-');
}

console.log('\n2) a boost kevesebb labbal is elerhetove tesz egy celt');
{
  const boosted = [
    leg('m1', 'h2h', 'home', 1.40, 0.686, 1.75),
    leg('m2', 'h2h', 'home', 1.40, 0.686, 1.72),
    leg('m3', 'totals', 'over25', 1.40, 0.686),
    leg('m4', 'btts', 'btts_yes', 1.40, 0.686),
  ];
  const rb = buildSlip(boosted, { target: 3.0, maxLegs: 4, minLegOdds: 1.25 });
  check('boosttal 2 lab eleg', rb.ok && rb.n === 2, rb.ok ? `n=${rb.n}` : rb.reason);

  const plain = boosted.map(l => { const c = { ...l }; delete c.boost_odds; delete c.is_boosted; return c; });
  const rp = buildSlip(plain, { target: 3.0, maxLegs: 4, minLegOdds: 1.25 });
  check('boost nelkul tobb lab kell', !rp.ok || rp.n > 2,
    rp.ok ? `n=${rp.n}` : `nem sikerult: ${rp.reason}`);
}

console.log('\n3) a boost nem torzitja a valoszinuseget');
{
  const pool = [
    leg('m1', 'h2h', 'home', 1.50, 0.640, 1.90),
    leg('m2', 'totals', 'over25', 1.55, 0.620),
  ];
  const r = buildSlip(pool, { target: 2.95, maxLegs: 4, minLegOdds: 1.25 });
  check('megvan a szelveny', r.ok, r.reason || '-');
  if (r.ok) {
    check('a jointP a market_prob-bol jon',
      Math.abs(r.jointP - 0.640 * 0.620) < 1e-9, String(r.jointP));
  }
}

console.log('\n4) nincs regresszio boost nelkul');
{
  const pool = [];
  for (let i = 1; i <= 8; i++) {
    pool.push(leg('e' + i, 'h2h', 'home', 1.30 + i * 0.12, 0.70 - i * 0.03));
    pool.push(leg('e' + i, 'totals', 'over25', 1.50 + i * 0.10, 0.62 - i * 0.02));
  }
  for (const T of [2, 3, 5, 10]) {
    const r = buildSlip(pool, { target: T, maxLegs: 4 });
    check(`cel ${T}x megoldodik`, r.ok, r.reason || '-');
  }
}

console.log('\n5) a node es a lokalis slip.js UGYANAZT adja');
{
  const local = require('./slip.js').buildSlip;
  const pool = [];
  for (let i = 1; i <= 10; i++) {
    // minden harmadik meccs 1X2 labja boostolt
    const b = i % 3 === 0 ? Math.round((1.30 + i * 0.14) * 1.08 * 100) / 100 : null;
    pool.push(leg('e' + i, 'h2h', 'home', 1.30 + i * 0.14, 0.72 - i * 0.03, b));
    pool.push(leg('e' + i, 'totals', 'over25', 1.55 + i * 0.09, 0.63 - i * 0.02));
  }
  for (const T of [2, 2.5, 3, 4, 6, 10]) {
    const a = buildSlip(pool, { target: T, maxLegs: 4 });
    const b = local(pool, { target: T, maxLegs: 4 });
    const key = r => r.ok
      ? `${r.n}|${r.prod.toFixed(4)}|${r.legs.map(l => l.leg_id).sort().join(',')}`
      : `nem:${r.reason}`;
    check(`cel ${T}x azonos eredmeny`, key(a) === key(b), `node=${key(a)}  lokalis=${key(b)}`);
  }
}

console.log(`\n${pass} sikeres, ${fail} bukott`);
process.exit(fail ? 1 : 0);
