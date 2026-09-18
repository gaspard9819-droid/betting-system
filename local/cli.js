// Helyi szelvenyepito - belepesi pont.
//
// EZ A SCRIPT NEM IR SEHOVA. Nem n8n tablaba, nem Discordra, nem fajlba.
// Csak olvas (Tippmixpro feed + promociok oldal) es a konzolra ir.
//
// HASZNALAT
//   node local/cli.js --cel 2.0                 szelveny 2.0-s eredore
//   node local/cli.js --cel 2.0 --mikor ma      csak mai meccsek
//   node local/cli.js --cel 5 --max 3           legfeljebb 3 lab
//   node local/cli.js --cel 2.0 --db 2          ket kulonbozo szelveny
//   node local/cli.js --boost                   a Szuper odds kinalat
//   node local/cli.js --promok                  aktiv promociok
//   node local/cli.js --piacok                  milyen piacokbol valogat

const { collect } = require('./catalog.js');
const { allLegs, slipValue } = require('./margin.js');
const { buildSlip } = require('./build.js');
const { fetchPromos, fmtFt } = require('./promos.js');

// ------------------------------------------------------------------ argumentum
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const key = t.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { a[key] = true; }
      else { a[key] = next; i++; }
    } else a._.push(t);
  }
  return a;
}

// A --mikor ertekei. A `ma` a nap vegeig tart, nem 24 orat elore: aki mai
// szelvenyt ker, ma este lejatszott meccsekre gondol.
function windowOf(mikor) {
  const now = new Date();
  if (!mikor || mikor === true) return { maxHours: 96, label: '96 orán belül' };
  const s = String(mikor).toLowerCase();
  if (s === 'ma' || s === 'today') {
    const end = new Date(now); end.setHours(23, 59, 59, 999);
    return { maxHours: (end - now) / 3600000, label: 'ma (' + end.toLocaleDateString('hu-HU') + ')' };
  }
  if (s === 'holnap' || s === 'tomorrow') {
    const end = new Date(now); end.setDate(end.getDate() + 1); end.setHours(23, 59, 59, 999);
    return { maxHours: (end - now) / 3600000, label: 'holnapig' };
  }
  if (s === 'hetvege' || s === 'weekend') return { maxHours: 96, label: 'hétvége (96h)' };
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) return { maxHours: Math.min(240, n), label: n + ' órán belül' };
  return { maxHours: 96, label: '96 orán belül' };
}

const ftime = iso => new Date(iso).toLocaleString('hu-HU', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const pct = n => (n >= 0 ? '' : '') + n.toFixed(2) + '%';

// ------------------------------------------------------------------- promociok
async function cmdPromos() {
  console.log('Promóciók lekérése (publikus oldal, bejelentkezés nélkül)...\n');
  const { promos, total } = await fetchPromos();
  console.log(`${total} promó a forrásban, ebből AKTÍV: ${promos.length}\n`);

  for (const p of promos) {
    const t = p.terms, j = p.judgement;
    const mark = j.verdict === 'megeri' ? '[JÓ]' : j.verdict === 'kerulendo' ? '[NEM]' : '[?]';
    console.log(`${mark} ${(p.title || '(cím nélkül)').replace(/&#8211;/g, '–')}`);
    console.log(`     kód: ${p.code}`);
    if (p.period) console.log(`     lejár: ${p.period.to.toLocaleString('hu-HU')}`);

    const terms = [];
    if (t.rolloverX) terms.push(`${t.rolloverX}x forgatás`);
    if (t.minOdds) terms.push(`min. ${t.minOdds} eredő`);
    if (t.minFold) terms.push(`min. ${t.minFold}-as kötés`);
    if (t.deadlineHours) terms.push(`${t.deadlineHours}h határidő`);
    if (terms.length) console.log(`     ${terms.join(' · ')}`);

    if (t.maxBonusFt) console.log(`     max bónusz: ${fmtFt(t.maxBonusFt)}` + (t.minDepositFt ? `, min. befizetés: ${fmtFt(t.minDepositFt)}` : ''));
    if (t.deficitFt) console.log(`     ehhez ${fmtFt(t.deficitFt)} veszteség kell${t.liveOnly ? ' (csak élő fogadás)' : ''}`);
    console.log(`     ${j.why}`);
    if (j.ownMoneyNeeded) console.log(`     saját pénz a forgatáshoz: ${fmtFt(j.ownMoneyNeeded)} (a bónusz fizet utoljára)`);
    console.log();
  }

  console.log('A fiókhoz kötött ajánlatok és az aktív forgatási állapot nem látszik —');
  console.log('azokhoz be kellene lépni, amit ez a script szándékosan nem tesz.');
}

// ----------------------------------------------------------------------- boost
async function cmdBoost(win) {
  console.log(`Szuper odds kínálat lekérése (${win.label})...\n`);
  const { matches, errors } = await collect({ maxHours: win.maxHours, onProgress: s => process.stderr.write('  ' + s + '\n') });
  const boosted = matches.filter(m => m.markets.some(k => k.isBoost));

  console.log(`\n${boosted.length} boostolt meccs (${matches.length} meccsből):\n`);
  for (const m of boosted) {
    const b = m.markets.find(k => k.isBoost);
    const plain = m.markets.find(k => k.code === '69-3');
    console.log(`${m.name}  —  ${ftime(m.kickoff)}  (${m.league})`);
    for (const p of b.picks) {
      const pl = plain && plain.picks.find(x => x.label === p.label);
      const up = pl ? ` (rendes @${pl.odds}, +${((p.odds / pl.odds - 1) * 100).toFixed(1)}%)` : '';
      console.log(`   ${p.label.padEnd(24)} @${String(p.odds).padEnd(6)}${up}`);
    }
    console.log();
  }
  if (errors.length) console.log(`(${errors.length} hiba a lekérés során)`);
}

// ---------------------------------------------------------------------- piacok
async function cmdMarkets(win) {
  const { matches } = await collect({ maxHours: win.maxHours, onProgress: s => process.stderr.write('  ' + s + '\n') });
  const legs = allLegs(matches);
  const byMarket = new Map();
  for (const l of legs) {
    if (!byMarket.has(l.market)) byMarket.set(l.market, { n: 0, margins: [], boost: 0 });
    const e = byMarket.get(l.market);
    e.n++; e.margins.push(l.marketMarginPct); if (l.isBoost) e.boost++;
  }
  const rows = [...byMarket.entries()].map(([name, e]) => {
    const s = e.margins.slice().sort((a, b) => a - b);
    return { name, n: e.n, med: s[Math.floor(s.length / 2)], boost: e.boost };
  }).sort((a, b) => a.med - b.med);

  console.log(`\n${legs.length} láb ${matches.length} meccsről, ${rows.length} piacon\n`);
  console.log('margó%  láb   piac');
  for (const r of rows.slice(0, 30)) {
    console.log(`${r.med.toFixed(2).padStart(6)}  ${String(r.n).padStart(4)}   ${r.name}${r.boost ? '  [BOOST]' : ''}`);
  }
}

// -------------------------------------------------------------------- szelveny
async function cmdSlip(args, win) {
  const target = Number(String(args.cel || args.target).replace(',', '.'));
  if (!Number.isFinite(target) || target <= 1) {
    console.error('A --cel után 1-nél nagyobb szám kell, pl. --cel 2.0');
    process.exit(1);
  }
  const count = Math.max(1, Math.min(5, Number(args.db) || 1));

  console.log(`Kínálat lekérése (${win.label})...`);
  const { matches, errors } = await collect({ maxHours: win.maxHours, onProgress: s => process.stderr.write('  ' + s + '\n') });
  const pool = allLegs(matches);
  console.log(`\n${matches.length} meccs, ${pool.length} használható láb.`);
  if (errors.length) console.log(`(${errors.length} hiba a lekérés során)`);

  const used = new Set();
  for (let k = 0; k < count; k++) {
    // Tobb szelvenyhez: a mar felhasznalt meccsek kiesnek, hogy ne
    // ugyanazt kapd ketszer.
    const avail = pool.filter(l => !used.has(l.matchId));
    const slip = buildSlip(avail, {
      target,
      maxLegs: Number(args.max) || 4,
      minLegOdds: Number(args.min) || 1.20,
      minLegs: Number(args.minlab) || 2,
      tolerance: Number(args.tur) || 0.12,
    });

    console.log('\n' + '─'.repeat(64));
    if (!slip.ok) {
      console.log(`${k + 1}. szelvény: NEM SIKERÜLT — ${slip.reason}`);
      if (slip.reason === 'cel_tul_magas') {
        console.log(`   ${target}x-hez legalább ${slip.nMin} láb kellene, a plafon ${slip.maxLegs}.`);
        console.log(`   A leghosszabb elérhető láb: @${slip.maxOdds}`);
      }
      break;
    }

    console.log(`${k + 1}. SZELVÉNY — cél ${target}x\n`);
    slip.legs.forEach((l, i) => {
      console.log(`${i + 1}. ${l.match}   ${ftime(l.kickoff)}`);
      console.log(`   ${l.market}: ${l.label}  @${l.odds}${l.isBoost ? '   [SZUPER ODDS]' : ''}`);
      console.log(`   piac margó ${pct(l.marketMarginPct)} (${l.marginSource}) · láb-költség ${pct(l.legCost)}`);
      l.matchId && used.add(l.matchId);
    });

    console.log(`\n   Eredő odds:        ${slip.totalOdds.toFixed(2)}x`);
    console.log(`   Bejövési esély:    ~${(slip.jointP * 100).toFixed(1)}%  (kb. minden ${(1 / slip.jointP).toFixed(1)}. szelvény)`);
    console.log(`   Becsült költség:   ${pct(slip.costPct)}  —  a fair érték ${slip.retainedPct.toFixed(1)}%-a marad meg`);
    if (slip.boosted) console.log(`   Boostolt láb:      ${slip.boosted} db`);
    if (slip.cappedRelaxed) console.log(`   FIGYELEM: van @5.00 fölötti láb — a cél másképp nem volt elérhető.`);
  }

  console.log('\n' + '─'.repeat(64));
  console.log('Az árak a lekérés pillanatában érvényesek — leadásig változhatnak.');
  console.log('A margó becsült: egy könyvből de-vigelve, favorit-longshot torzítással.');
}

// -------------------------------------------------------------------- futtatas
(async () => {
  const args = parseArgs(process.argv.slice(2));
  const win = windowOf(args.mikor || args.orak);

  try {
    if (args.promok || args.promo) return await cmdPromos();
    if (args.boost) return await cmdBoost(win);
    if (args.piacok) return await cmdMarkets(win);
    if (args.cel || args.target) return await cmdSlip(args, win);

    console.log(`Helyi szelvényépítő — Tippmixpro árakból, minden piacon.

  node local/cli.js --cel 2.0              szelvény 2.0-s eredőre
  node local/cli.js --cel 2.0 --mikor ma   csak mai meccsek
  node local/cli.js --cel 5 --max 3        legfeljebb 3 láb
  node local/cli.js --cel 2.0 --db 2       két különböző szelvény
  node local/cli.js --boost                Szuper odds kínálat
  node local/cli.js --promok               aktív promóciók
  node local/cli.js --piacok               piacok margó szerint

Kapcsolók: --max (láb), --min (láb-odds), --tur (tolerancia, alap 0.12),
           --mikor ma|holnap|hetvege|<óra>

Ez a script nem ír sehova — csak olvas és a konzolra ír.`);
  } catch (err) {
    console.error('\nHIBA:', err.message);
    process.exit(1);
  }
})();
