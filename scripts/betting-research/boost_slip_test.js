// A boostolt ar hasznalata a szelvenyepitoben. Szintetikus slate, nincs
// halozat - ugyanugy futtathato, mint a slip_test.js.
//
// Amit bizonyit:
//   1. ahol van boost_odds, a buildSlip AZT hasznalja a tippmix_odds helyett
//   2. a boost KEVESEBB labbal is elerhetove tesz egy celt (a felhasznalo
//      2026-09-16-i pelda: 2.0-es cel, boost @1.30 -> @1.50)
//   3. a boost NEM torzitja a valoszinuseg-szamitast (a kifizetest emeli,
//      nem az eselyt) - a jointP a market_prob-bol jon, nem 1/boost_odds-bol
//   4. boost nelkuli slate-en a viselkedes valtozatlan (nincs regresszio)
//
// FUTTATAS:  node boost_slip_test.js

const { buildSlip } = require('./slip.js');

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  OK    ${name}`); }
  else { fail++; console.log(`  BUKIK ${name}${extra ? '  -> ' + extra : ''}`); }
};

// Egy lab. A market_prob a de-viggelt piaci esely; a tippmix_odds a rendes ar.
const leg = (ev, market, sel, odds, prob, boost) => ({
  leg_id: `${ev}-${market}-${sel}`, event_id: ev,
  match_name: `Csapat${ev}A vs Csapat${ev}B`, league: 'Teszt Liga',
  market, selection: sel, label: `${market}/${sel}`,
  model_prob: prob, market_prob: prob,
  tippmix_odds: odds,
  ...(boost ? { boost_odds: boost, is_boosted: 'igen' } : {}),
  confidence: 'MAGAS', news_flag: 'ok', news_note: '',
});

const oddsOf = r => r.legs.map(l => (Number.isFinite(l.boost_odds) ? l.boost_odds : l.tippmix_odds));

// ---------------------------------------------------------------------------
console.log('\n1) A BOOSTOLT AR KERUL HASZNALATRA');
{
  // Egyetlen meccs boostolva: 1.30 -> 1.50. A masik meccs rendes @1.33.
  // Cel 2.0: boosttal 1.50 x 1.33 = 1.995 (belul), boost nelkul
  // 1.30 x 1.33 = 1.729 (a +-12%-os savon KIVUL, also hatar 1.76).
  const pool = [
    leg('m1', 'h2h', 'home', 1.30, 0.740, 1.50),
    leg('m2', 'totals', 'over25', 1.33, 0.723),
  ];
  const r = buildSlip(pool, { target: 2.0, maxLegs: 4, minLegOdds: 1.25 });
  check('kijon a 2.0-es cel', r.ok && !r.approximate, r.reason || `approx=${r.approximate}`);
  check('2 labbal', r.ok && r.n === 2, r.ok ? `n=${r.n}` : '-');
  const o = r.ok ? oddsOf(r) : [];
  check('a boostolt 1.50-et hasznalja, nem az 1.30-at', o.includes(1.50), JSON.stringify(o));
  check('az osszodds ~1.995', r.ok && Math.abs(r.prod - 1.995) < 0.01, r.ok ? String(r.prod) : '-');

  // Kontroll: ugyanez boost nelkul NEM jon ki pontosan.
  const plain = [
    leg('m1', 'h2h', 'home', 1.30, 0.740),
    leg('m2', 'totals', 'over25', 1.33, 0.723),
  ];
  const r2 = buildSlip(plain, { target: 2.0, maxLegs: 4, minLegOdds: 1.25 });
  check('boost NELKUL ugyanez nem pontos talalat', !r2.ok || r2.approximate || r2.single_leg,
    `ok=${r2.ok} approx=${r2.approximate} n=${r2.n}`);
}

// ---------------------------------------------------------------------------
console.log('\n2) A BOOST KEVESEBB LABBAL IS ELERHETOVE TESZ EGY CELT');
{
  // Cel 3.0. Rendes arakkal a legnagyobb lab @1.40 -> 3 lab kell
  // (1.40^2 = 1.96 < 2.64 also hatar). Boosttal van egy @1.75 -> 2 lab eleg
  // (1.75 x 1.72 = 3.01).
  const boosted = [
    leg('m1', 'h2h', 'home', 1.40, 0.686, 1.75),
    leg('m2', 'h2h', 'home', 1.40, 0.686, 1.72),
    leg('m3', 'totals', 'over25', 1.40, 0.686),
    leg('m4', 'btts', 'btts_yes', 1.40, 0.686),
  ];
  const rb = buildSlip(boosted, { target: 3.0, maxLegs: 4, minLegOdds: 1.25 });
  check('boosttal kijon a 3.0', rb.ok && !rb.approximate, rb.reason || '-');
  check('boosttal 2 lab eleg', rb.ok && rb.n === 2, rb.ok ? `n=${rb.n}` : '-');

  const plain = boosted.map(l => { const c = { ...l }; delete c.boost_odds; delete c.is_boosted; return c; });
  const rp = buildSlip(plain, { target: 3.0, maxLegs: 4, minLegOdds: 1.25 });
  check('boost nelkul tobb lab kell', !rp.ok || rp.n > 2, rp.ok ? `n=${rp.n}` : `nem sikerult: ${rp.reason}`);
}

// ---------------------------------------------------------------------------
console.log('\n3) A BOOST NEM TORZITJA A VALOSZINUSEGET');
{
  // A boost a KIFIZETEST emeli, nem az esemeny eselyet. Ha a jointP
  // 1/boost_odds-bol szamolna, alabecsulne az eselyt.
  const pool = [
    leg('m1', 'h2h', 'home', 1.50, 0.640, 1.90),
    leg('m2', 'totals', 'over25', 1.55, 0.620),
  ];
  const r = buildSlip(pool, { target: 2.95, maxLegs: 4, minLegOdds: 1.25 });
  check('megvan a szelveny', r.ok, r.reason || '-');
  if (r.ok) {
    const want = 0.640 * 0.620;                     // a piaci eselyekbol
    const wrong = (1 / 1.90) * (1 / 1.55);          // ha a boostolt arbol jonne
    check('a jointP a market_prob-bol jon', Math.abs(r.jointP - want) < 1e-9,
      `jointP=${r.jointP} vart=${want.toFixed(4)}`);
    check('NEM a boostolt arbol', Math.abs(r.jointP - wrong) > 1e-6,
      `jointP=${r.jointP} rossz-lenne=${wrong.toFixed(4)}`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n4) AZONOS PONTSZAMNAL A BOOSTOLT NYER');
{
  // Ket teljesen egyenerteku kombinacio: ugyanaz az ar es ugyanaz a piaci
  // esely. A kulonbseg csak annyi, hogy az egyik labja boostolt.
  const pool = [
    leg('m1', 'h2h', 'home', 1.40, 0.700, 1.50),   // boostolt, hasznalt ar 1.50
    leg('m2', 'h2h', 'home', 1.50, 0.700),         // rendes, ugyanaz az ar
    leg('m3', 'totals', 'over25', 1.35, 0.730),
  ];
  const r = buildSlip(pool, { target: 2.02, maxLegs: 2, minLegOdds: 1.25 });
  check('megvan a szelveny', r.ok && r.n === 2, r.ok ? `n=${r.n}` : r.reason);
  if (r.ok) {
    const usedBoost = r.legs.some(l => Number.isFinite(l.boost_odds));
    check('a boostolt labat valasztotta', usedBoost,
      r.legs.map(l => l.leg_id).join(', '));
  }
}

// ---------------------------------------------------------------------------
console.log('\n5) NINCS REGRESSZIO BOOST NELKULI SLATE-EN');
{
  // Ugyanaz a pool boost mezo nelkul: a viselkedes valtozatlan kell legyen.
  const pool = [];
  for (let i = 1; i <= 8; i++) {
    pool.push(leg('e' + i, 'h2h', 'home', 1.30 + i * 0.12, 0.70 - i * 0.03));
    pool.push(leg('e' + i, 'totals', 'over25', 1.50 + i * 0.10, 0.62 - i * 0.02));
  }
  for (const T of [2, 3, 5, 10]) {
    const r = buildSlip(pool, { target: T, maxLegs: 4 });
    check(`cel ${T}x megoldodik`, r.ok, r.reason || '-');
    if (r.ok && !r.approximate && !r.single_leg) {
      const prod = r.legs.reduce((a, l) => a * l.tippmix_odds, 1);
      check(`  cel ${T}x: a szorzat a rendes arakbol jon ki`, Math.abs(prod - r.prod) < 1e-9,
        `${prod.toFixed(4)} vs ${r.prod.toFixed(4)}`);
    }
  }
}

console.log(`\n${pass} sikeres, ${fail} bukott`);
process.exit(fail ? 1 : 0);
