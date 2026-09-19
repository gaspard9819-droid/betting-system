// Ellenorzesek a calib.js-re. Futtatas: node local/calib_test.js
//
// MIERT KELL: a kalibracio egy SZAM, amit kesobb dontesre hasznalunk. Ha az
// elszamolas rosszul all be egy kimenetelt, a hiba nem latszik - csak egy
// kicsit mas szam jon ki, es az meg mindig hihetonek tunik. Ugyanaz a csendes
// tores, mint az Espanyol/Espanol eset (5 lab nemán kiesett) es a mock, ami
// sajat magaval egyezett (76 check ment at a rossz alakra).
//
// Ezert a tesztek nagy resze VALOS adaton fut: a naplozott feed-nevek a valodi
// football-data CSV nevei ellen, es a vegponti futas valodi lejatszott meccsek
// valodi araival es valodi eredmenyeivel.

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const C = require('./calib.js');
const { indexResults } = require('../research/settle.js');
const { powerProbs } = require('./margin.js');

let pass = 0, fail = 0;
const fails = [];

function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { fail++; fails.push(`${name}\n      kapott: ${JSON.stringify(got)}\n      várt:   ${JSON.stringify(want)}`); }
}

function near(name, got, want, tol) {
  const ok = Number.isFinite(got) && Math.abs(got - want) <= tol;
  if (ok) pass++;
  else { fail++; fails.push(`${name}\n      kapott: ${got}\n      várt:   ${want} (±${tol})`); }
}

const m = (home, away) => ({ home, away });

// --------------------------------------------------------------- A) 1X2
// A cimkek a feed sajat nevei - ezek a valodi alakok a 2026-09-19-i
// snapshotbol.
const p = (label, type) => ({ label, type: type || '' });

check('1) 1X2 hazai nyer',        C.outcomeOf('1X2', p('Arsenal'), m('Arsenal', 'Man City'), 2, 0), true);
check('2) 1X2 hazai vesztes',     C.outcomeOf('1X2', p('Arsenal'), m('Arsenal', 'Man City'), 0, 2), false);
check('3) 1X2 hazai dontetlen',   C.outcomeOf('1X2', p('Arsenal'), m('Arsenal', 'Man City'), 1, 1), false);
check('4) 1X2 vendeg nyer',       C.outcomeOf('1X2', p('Man City'), m('Arsenal', 'Man City'), 0, 2), true);
check('5) 1X2 dontetlen cimke',   C.outcomeOf('1X2', p('Döntetlen', 'DRAW'), m('Arsenal', 'Man City'), 1, 1), true);
check('6) 1X2 dontetlen nem jott', C.outcomeOf('1X2', p('Döntetlen', 'DRAW'), m('Arsenal', 'Man City'), 2, 0), false);
check('7) Szuper odds ugyanugy',  C.outcomeOf('1X2 - Szuper odds', p('Arsenal'), m('Arsenal', 'Man City'), 3, 1), true);
// Idegen cimke NEM talalgatas: inkabb hianyzik a piac.
check('8) 1X2 ismeretlen cimke',  C.outcomeOf('1X2', p('Valami Más'), m('Arsenal', 'Man City'), 1, 0), null);
// A feed rovidit, a parositas ezt is allja (local/README.md:277).
check('9) 1X2 rovidites',         C.outcomeOf('1X2', p('Atl. Madrid'), m('Atl. Madrid', 'Real Madrid'), 1, 0), true);

// --------------------------------------------------------------- B) Gólszám
check('10) fél vonal fölött',     C.outcomeOf('Gólszám 2.5', p('Több, mint 2.5'), m('A', 'B'), 2, 1), true);
check('11) fél vonal alatt',      C.outcomeOf('Gólszám 2.5', p('Több, mint 2.5'), m('A', 'B'), 1, 1), false);
check('12) fél vonal under',      C.outcomeOf('Gólszám 2.5', p('Kevesebb, mint 2.5'), m('A', 'B'), 1, 1), true);
check('13) 1.5-ös vonal',         C.outcomeOf('Gólszám 1.5', p('Több, mint 1.5'), m('A', 'B'), 1, 1), true);
check('14) 3.5-ös vonal under',   C.outcomeOf('Gólszám 3.5', p('Kevesebb, mint 3.5'), m('A', 'B'), 2, 1), true);
// Egesz vonalon a pontos talalat push - ez a sor a legfontosabb az egeszben:
// push-t nyeresnek vagy vesztesnek szamolni CSENDBEN torzitana a kalibraciot.
check('15) egész vonal push',     C.outcomeOf('Gólszám 3', p('Több, mint 3'), m('A', 'B'), 2, 1), 'push');
check('16) egész vonal fölött',   C.outcomeOf('Gólszám 3', p('Több, mint 3'), m('A', 'B'), 3, 1), true);
check('17) egész vonal alatt',    C.outcomeOf('Gólszám 3', p('Kevesebb, mint 3'), m('A', 'B'), 1, 1), true);
// A vonal a CIMKEBOL jon, ha a piacnev nem hordozza (a feedben van ilyen:
// 86 db csupasz "Gólszám" nevu piac a 2026-09-19-i snapshotban).
check('18) vonal a címkéből',     C.outcomeOf('Gólszám', p('Több, mint 2.5'), m('A', 'B'), 3, 0), true);
check('19) vonal nélkül null',    C.outcomeOf('Gólszám', p('Több'), m('A', 'B'), 3, 0), null);

// --------------------------------------------------------------- C) BTTS
check('20) BTTS igen',            C.outcomeOf('Mindkét csapat szerez gólt', p('Igen'), m('A', 'B'), 1, 1), true);
check('21) BTTS igen nem jött',   C.outcomeOf('Mindkét csapat szerez gólt', p('Igen'), m('A', 'B'), 2, 0), false);
check('22) BTTS nem',             C.outcomeOf('Mindkét csapat szerez gólt', p('Nem'), m('A', 'B'), 2, 0), true);
check('23) BTTS 0-0',             C.outcomeOf('Mindkét csapat szerez gólt', p('Nem'), m('A', 'B'), 0, 0), true);

// --------------------------------------------------------- D) ismeretlen piac
// A hendikep NAPLOZVA van, de elszamolva NINCS. Ha valaki felveszi az
// outcomeOf-ba, ez a ket sor bukik - es akkor kell ide a valodi szabaly.
check('24) hendikep nincs elszámolva',  C.outcomeOf('Hendikep -1', p('Arsenal'), m('Arsenal', 'B'), 3, 0), null);
check('25) ázsiai hendikep sincs',      C.outcomeOf('Ázsiai hendikep -0.5', p('Arsenal'), m('Arsenal', 'B'), 3, 0), null);
check('26) lapok piaca sincs',          C.outcomeOf('Lesz kiállítás?', p('Igen'), m('A', 'B'), 1, 0), null);

// --------------------------------------------------------------- E) segedek
check('27) lineOf tizedespont',   C.lineOf('Több, mint 2.5'), 2.5);
check('28) lineOf vessző',        C.lineOf('Több, mint 2,5'), 2.5);
check('29) lineOf nincs szám',    C.lineOf('Igen'), null);
// Szezonkod: juliusban fordul.
check('30) szezon szeptember',    C.seasonCode(new Date('2026-09-19T12:00:00Z')), '2627');
check('31) szezon január',        C.seasonCode(new Date('2027-01-10T12:00:00Z')), '2627');
check('32) szezon július',        C.seasonCode(new Date('2027-07-05T12:00:00Z')), '2728');
check('33) szezon június',        C.seasonCode(new Date('2027-06-30T12:00:00Z')), '2627');

check('34) szó-előtag egyezik',   C.wordPrefixMatch('Atlético Madrid', 'Atl. Madrid'), true);
check('35) szó-előtag nem téved', C.wordPrefixMatch('Real Madrid', 'Atl. Madrid'), false);

// --------------------------------------------------- F) valószínűség-számítás
// A power es az aranyos ugyanazt a MARGOT adja, csak a szetosztas mas.
{
  const odds = [1.50, 4.20, 6.50];
  const ipSum = odds.reduce((s, x) => s + 1 / x, 0);
  const pw = powerProbs(odds);
  const pr = odds.map(x => (1 / x) / ipSum);
  near('36) power összege 1',        pw.reduce((a, b) => a + b, 0), 1, 1e-9);
  near('37) arányos összege 1',      pr.reduce((a, b) => a + b, 0), 1, 1e-9);
  // A margin.js:54 merese szerint a power a ROVID labat FELJEBB viszi.
  check('38) power a rövidet emeli', pw[0] > pr[0], true);
  check('39) power a hosszút húzza', pw[2] < pr[2], true);
  // Log-loss kezi ellenorzes: ha a kozepso nyer, -ln(p).
  near('40) log-loss kézzel',        -Math.log(pr[1]), -Math.log((1 / 4.2) / ipSum), 1e-12);
}

// ------------------------------------------- G) valós feed-nevek a valós CSV-n
//
// Ez a legfontosabb ellenorzes, es szandekosan valos adaton fut: a naplozott
// csapatnevek FELOLDHATOK-e a football-data neveire. Ha nem, a meccs csendben
// kiesne a kalibraciobol, es a minta ugy fogyna, hogy senki nem venne eszre.
(async () => {
  const POOL = path.join(__dirname, 'pool');
  let feedNames = new Set();
  let leagues = new Set();
  if (fs.existsSync(POOL)) {
    for (const f of fs.readdirSync(POOL).filter(x => x.endsWith('.json.gz'))) {
      const s = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(POOL, f))));
      for (const mm of s.matches) {
        const code = C.LEAGUE_CSV[mm.source];
        if (!code) continue;               // kupa: nincs eredmenyforras
        leagues.add(code);
        feedNames.add(code + '|' + mm.home);
        feedNames.add(code + '|' + mm.away);
      }
    }
  }

  const idx = {};
  for (const code of leagues) {
    try {
      idx[code] = indexResults(await C.csvFor('2627', code, false), code);
    } catch (err) {
      console.log(`  (CSV nem elérhető: ${code} — ${err.message})`);
    }
  }

  const unmatched = [];
  for (const key of feedNames) {
    const [code, name] = key.split('|');
    if (!idx[code]) continue;
    if (!C.findCsvName(name, idx[code].names)) unmatched.push(`${code}: ${name}`);
  }
  if (feedNames.size) {
    check(`41) mind a ${feedNames.size} naplózott csapatnév feloldható`, unmatched, []);
  } else {
    console.log('  (41 kihagyva: nincs naplózott snapshot)');
  }

  // ------------------------------------------ H) végponti futás valós adaton
  //
  // Szintetikus snapshot VALODI lejatszott meccsekbol: a csapatnevek, az arak
  // (B365 zaroar) es az eredmenyek mind a football-data CSV-bol jonnek. Igy a
  // pontozas valodi eloszlasokon fut, nem kitalalt szamokon.
  const e0 = idx['E0'];
  if (!e0) {
    console.log('  (42+ kihagyva: nincs E0 CSV)');
  } else {
    const csv = await C.csvFor('2627', 'E0', false);
    const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    const head = lines[0].split(',').map(h => h.trim());
    const col = {};
    head.forEach((h, i) => { if (col[h] === undefined) col[h] = i; });

    const need = ['Date', 'HomeTeam', 'AwayTeam', 'FTHG', 'FTAG', 'B365H', 'B365D', 'B365A'];
    const haveCols = need.every(n => col[n] !== undefined);
    check('42) az E0 CSV-ben megvan minden szükséges oszlop', haveCols, true);

    if (haveCols) {
      const matches = [];
      for (let i = 1; i < lines.length && matches.length < 30; i++) {
        const f = lines[i].split(',');
        const [d, home, away] = [f[col.Date], f[col.HomeTeam], f[col.AwayTeam]].map(x => (x || '').trim());
        const hg = Number(f[col.FTHG]), ag = Number(f[col.FTAG]);
        const oh = Number(f[col.B365H]), od = Number(f[col.B365D]), oa = Number(f[col.B365A]);
        if (!home || !away || !Number.isFinite(hg) || !Number.isFinite(ag)) continue;
        if (![oh, od, oa].every(Number.isFinite)) continue;
        const dm = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(d);
        if (!dm) continue;
        const yr = dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3]);
        // Kezdes a jateknap 15:00 UTC-je: a settle.js +-2 napos
        // datum-ellenorzesen belul van.
        const start = Date.UTC(yr, Number(dm[2]) - 1, Number(dm[1]), 15, 0, 0);
        matches.push({
          id: 'T' + i, name: `${home} - ${away}`, home, away,
          league: 'Premier League', source: 'PL',
          startTime: start, kickoff: new Date(start).toISOString(),
          markets: [{
            code: '69-3', name: '1X2', isBoost: false,
            picks: [
              { label: home, type: 'HOME', odds: oh },
              { label: 'Döntetlen', type: 'DRAW', odds: od },
              { label: away, type: 'AWAY', odds: oa },
            ],
          }],
        });
      }

      check('43) legalább 10 lejátszott meccs a szintetikus naplóban', matches.length >= 10, true);

      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calib-'));
      // A lekeres ideje a kezdes ELOTT egy oraval - kulonben a calib.js
      // kiszurne (kezdes utani ar mar elo ar).
      const snap = {
        v: 1, fetchedAt: new Date(matches[0].startTime - 3600000).toISOString(),
        window: { maxHours: 96, includeCups: false }, filter: 'teszt',
        matches, errors: [],
      };
      fs.writeFileSync(path.join(tmp, 'pool_teszt.json.gz'),
        zlib.gzipSync(Buffer.from(JSON.stringify(snap))));

      const out = [];
      const realLog = console.log;
      console.log = (...a) => out.push(a.join(' '));
      process.env.BETTING_POOL_DIR = tmp;
      try {
        await C.main();
      } finally {
        console.log = realLog;
        delete process.env.BETTING_POOL_DIR;
        fs.rmSync(tmp, { recursive: true, force: true });
      }
      const text = out.join('\n');

      const evalLine = /Kiértékelhető: (\d+) piac, (\d+) kimenetel/.exec(text);
      check('44) a futás kiírja a kiértékelt piacok számát', !!evalLine, true);
      if (evalLine) {
        // MINDEN meccs elszamolhato: sajat CSV-nevek, sajat eredmenyek.
        check('45) minden szintetikus piac kiértékelődött',
          Number(evalLine[1]), matches.length);
        check('46) piaconként 3 kimenetel',
          Number(evalLine[2]), matches.length * 3);
      }
      // AZONOSSAG: pontosan egy kimenetel nyerhet piaconkent. Ha ez serul, a
      // jelentes kiirja - es akkor az elszamolas a hibas, nem az adat.
      check('47) nincs azonosság-sértés', /AZONOSSÁG SÉRÜLT/.test(text), false);
      check('48) van log-loss kimenet', /ÁTLAGOS LOG-LOSS/.test(text), true);
      check('49) van párosított összevetés', /PÁROSÍTOTT ÖSSZEVETÉS/.test(text), true);
      check('50) van oddssávos kalibráció', /KALIBRÁCIÓ ODDSSÁVONKÉNT/.test(text), true);
      // Az arak verjenek egy informacio nelkuli tippet. Ha nem, az nem a
      // de-vig hibaja, hanem a naplozase vagy az elszamolase.
      check('51) az árak verik az egyenletes alapvonalat',
        /FIGYELEM: az árak nem verik/.test(text), false);

      // ---------------------------------------- I) azonos kodu piacok
      //
      // REGRESSZIOS ELLENORZES. A dedup kulcsa eredetileg meccs+kod volt, de a
      // `code` minden golszam-vonalra ugyanaz (47-3): a vonalak egymast irtak
      // felul, es meccsenkent egyetlen golszam-piac maradt. Merve a valodi
      // naplon: 3190 piacbol 950 - a minta ketharmada tunt el ugy, hogy semmi
      // nem jelezte.
      //
      // Az arak itt szandekosan egyszeruek: a kerdes a KULCS, nem az arazas.
      const twoLines = {
        ...matches[0],
        markets: [2.5, 3.5].map(line => ({
          code: '47-3', name: `Gólszám ${line}`, isBoost: false,
          picks: [
            { label: `Több, mint ${line}`, type: 'OVER', odds: 1.90 },
            { label: `Kevesebb, mint ${line}`, type: 'UNDER', odds: 1.90 },
          ],
        })),
      };
      const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'calib2-'));
      fs.writeFileSync(path.join(tmp2, 'pool_teszt.json.gz'), zlib.gzipSync(Buffer.from(
        JSON.stringify({ ...snap, matches: [twoLines] }))));

      const out2 = [];
      console.log = (...a) => out2.push(a.join(' '));
      process.env.BETTING_POOL_DIR = tmp2;
      try {
        await C.main();
      } finally {
        console.log = realLog;
        delete process.env.BETTING_POOL_DIR;
        fs.rmSync(tmp2, { recursive: true, force: true });
      }
      const line2 = /Kiértékelhető: (\d+) piac, (\d+) kimenetel/.exec(out2.join('\n'));
      check('52) az azonos kódú gólszám-vonalak nem írják felül egymást',
        line2 ? Number(line2[1]) : null, 2);
      check('53) mindkét vonal két kimenetellel',
        line2 ? Number(line2[2]) : null, 4);
    }
  }

  // ------------------------------------------------------------------ osszegzes
  console.log('');
  console.log('─'.repeat(60));
  if (fail) {
    console.log(`${pass} sikeres, ${fail} BUKOTT\n`);
    for (const f of fails) console.log('  ✗ ' + f);
    process.exit(1);
  }
  console.log(`Mind a ${pass} ellenőrzés sikeres.`);
})().catch(err => {
  console.error('\nHIBA:', err.message);
  console.error(err.stack);
  process.exit(1);
});
