// A kinalat naplozasa. EZ AZ EGYETLEN local/ script, ami ir - es csak
// helyi fajlba, a local/pool/ mappaba. Nem n8n, nem Discord, nem halozat.
//
// MIERT KELL
//
// A margo ELORE becsult, es 2026-09-19-ig soha nem derult ki, hogy a de-vigelt
// valoszinusegek helyesek-e. A margin.js a power modszerrol addig annyit
// mondhatott, hogy ismeri a torzitas IRANYAT - a MERTEKET nem, mert az a sajat
// arainkon nem volt merheto: ahhoz eredmeny kell, amit nem naplozott senki.
//
// Ez a script naplozza. A kiertekelo a local/calib.js.
//
// NEM KELL MEGFOGADNI SEMMIT. A kalibraciohoz a teljes kinalat kimenetele
// kell, nem a megtett fogadasoke: napi ~8500 lab a par megtett helyett. Egy
// ar helyessege nem attol fugg, hogy tettunk-e ra penzt. Ez a kulonbseg dont
// het es ev kozott - a research/README.md:784 szerint 160-220 fogadasnal a ROI
// konfidencia-intervalluma tul szeles barmihez, a kalibracio viszont hetekben
// megoldodik.
//
// MIT MENT ES MIT NEM
//
// Nyers ARAKAT ment, nem valoszinusegeket. Az ar meres, a valoszinuseg
// becsles - es a becsles modszere valtozhat (power/proportional, vagy ami
// utana jon). Ha a valoszinuseget mentenenk, minden modszervaltas
// ervenytelenitene a regi naplot. Igy a calib.js barmelyik modszert
// visszamenoleg pontozhatja UGYANAZON az adaton.
//
// A snapshot MERES es nem reprodukalhato - ugyanaz a kategoria, mint a
// research/data/tippmix/ kezi arai, amiket a .gitignore kifejezetten
// bennhagy. Ezert gzip.
//
// MIERT NEM MENT MINDENT
//
// Merve 2026-09-19, 43 meccses kinalaton: a teljes kinalat 12194 piac, gzip
// utan 788 KB - napi egy futassal ~290 MB evente, egy repoban, ami minden
// verziot megtart. A pontszam-fuggo csaladok ugyanabbol 1203 piac, 32 KB.
//
// A kulonbseg nem tomorites kerdese: amit eldobunk, azt a football-data
// vegeredmenyebol SOSEM lehetne elszamolni (jatekos-statisztikak, lapok,
// lesek, idoszakaszok). Egy kalibraciohoz nem ad semmit, mert nincs hozza
// eredmeny. A "logoljuk, hatha kell" itt 25-szoros arat kerne olyan adatert,
// amihez nincs mero.
//
// Ami marad: az ot csalad, amire a margin.js MARKET_REF-je mert margo-
// referenciat tart, ES ami a vegeredmeny fuggvenye. Tehat pontosan az, amibol
// a szelvenyepito valogat, es amit ellenorizni lehet.
//
// A --mind kapcsolo mindent ment (788 KB), ha valaki a teljes kinalat
// margo-szerkezetet akarja vizsgalni. Az mas kerdes, mas koltseggel.
const SCORE_DERIVED = [
  /^1X2/i,                    // a Szuper odds valtozattal egyutt
  /Szuper odds/i,
  /^Gólszám/i,                // barmely vonal
  /Mindkét csapat szerez/i,   // BTTS
  /hendikep/i,                // Hendikep + Ázsiai hendikep
];

// A hendikep-piacok itt BENNE vannak, de a calib.js meg nem szamolja el oket
// (a magyar cimke-parszolas hibazasra hajlamos, lasd calib.js outcomeOf).
// Szandekos: az adat olcso, a szabaly barmikor felvehetó - forditva nem
// mukodne, mert a mai arat holnap nem lehet ujra felvenni.
const keepMarket = mk => mk.isBoost || SCORE_DERIVED.some(rx => rx.test(mk.name || ''));

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { collect } = require('./catalog.js');

const POOL_DIR = path.join(__dirname, 'pool');

// A fajlnev a lekeres IDEJE, percre. A "csak azonos pillanatban felvett arakat
// szabad osszehasonlitani" szabaly (research/README.md:584) csak akkor
// ervenyesitheto, ha az ido a naploban van - a calib.js ez alapjan valaszt
// kickoff elotti snapshotot.
function stamp(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) a[t.slice(2)] = true;
    else { a[t.slice(2)] = next; i++; }
  }
  return a;
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const maxHours = Number(args.orak) || 96;
  const includeCups = !args['nincs-kupa'];
  const all = !!args.mind;

  console.log(`Kínálat lekérése naplózáshoz (${maxHours} óra${includeCups ? ', kupákkal' : ', kupák nélkül'})...`);

  const { matches: raw, errors, fetchedAt } = await collect({
    maxHours,
    includeCups,
    onProgress: s => process.stderr.write('  ' + s + '\n'),
  });

  if (!raw.length) {
    console.error('\nNincs egyetlen meccs sem — nem írok üres snapshotot.');
    process.exit(1);
  }

  const rawMarkets = raw.reduce((a, m) => a + m.markets.length, 0);
  const matches = all ? raw : raw
    .map(m => ({ ...m, markets: m.markets.filter(keepMarket) }))
    .filter(m => m.markets.length);

  if (!matches.length) {
    console.error('\nEgyetlen pontszámból elszámolható piac sem maradt — nem írok üres snapshotot.');
    process.exit(1);
  }

  // A szures TENYE a snapshotban van: egy kesobbi olvaso kulonben nem tudna
  // megkulonboztetni a "nem volt ilyen piac" es a "nem mentettuk" esetet.
  const snapshot = {
    v: 1, fetchedAt,
    window: { maxHours, includeCups },
    filter: all ? 'mind' : 'pontszam-fuggo',
    rawMarkets,
    matches, errors,
  };

  fs.mkdirSync(POOL_DIR, { recursive: true });
  // Ket futas egy percen belul nem irja felul egymast: a masodik kap egy
  // sorszamot. Egy felulirt snapshot csendben tuntetne el egy merest.
  let file = path.join(POOL_DIR, `pool_${stamp(new Date())}.json.gz`);
  for (let i = 2; fs.existsSync(file); i++) {
    file = path.join(POOL_DIR, `pool_${stamp(new Date())}_${i}.json.gz`);
  }
  fs.writeFileSync(file, zlib.gzipSync(Buffer.from(JSON.stringify(snapshot)), { level: 9 }));

  const markets = matches.reduce((a, m) => a + m.markets.length, 0);
  const picks = matches.reduce((a, m) => a + m.markets.reduce((b, k) => b + k.picks.length, 0), 0);
  const boosted = matches.filter(m => m.markets.some(k => k.isBoost)).length;
  const kb = Math.round(fs.statSync(file).size / 1024);

  console.log(`\n${matches.length} meccs · ${markets} piac · ${picks} ár · ${boosted} boostolt meccs`);
  if (!all) console.log(`(${rawMarkets} piacból a pontszámból elszámolhatók — mindet a --mind menti)`);
  if (errors.length) console.log(`${errors.length} hiba a lekérés során (a snapshotban benne vannak)`);
  console.log(`\nMentve: ${path.relative(process.cwd(), file)}  (${kb} KB)`);
  console.log('\nKiértékelés a meccsek lejátszása után: node local/calib.js');
})().catch(err => {
  console.error('\nHIBA:', err.message);
  process.exit(1);
});
