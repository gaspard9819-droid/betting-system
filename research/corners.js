// Szoglet-eloszuro: van-e egyaltalan elorejelezheto struktura a szogletszamban?
//
// MIERT EZ, ES MIERT NINCS BENNE ODDS:
// A football-data.co.uk fajlok HC/AC oszlopa a szogletszamot hozza, de szoglet
// ODDS-ot nem — az osszes over/under es azsiai oszlop golra vonatkozik
// (ellenorizve a hivatalos notes.txt-ben, 2026-09-08). Fizetos szoglet-odds
// letezik (Footiqo ~380 meccs ingyen, OddAlerts fizetos), de mielott barmit
// fizetnenk, ez a script nulla koltsegen eldonti az elozetes kerdest:
//
//   Elorejelezheto-e a szogletszam JOBBAN, mint a triviális alapvonal?
//
// Ha NEM, a szoglet-piac arazasat nincs ertelme megvenni — nincs mit arazni.
// Ha IGEN, a kovetkezo lepes a Footiqo ingyenes szezonja valosag-ellenorzesnek.
//
// A modszer szandekosan azonos a backtest.js-evel: walk-forward ratingek,
// explicit alapvonal, es egy INVERTALO KONTROLL. A gol-modellnel az invertalo
// kontroll fogta meg, hogy a rangsor forditott volt (legjobb kvartilis -17.7%,
// legrosszabb +1.4%) — ugyanaz a csapda itt is nyitva all.
//
// Futtatas a data/ konyvtarbol:  node ../corners.js

const fs = require('fs');
const path = require('path');
const { parseCsv } = require('./parse.js');

const SEASONS = ['2223', '2324', '2425', '2526'];
const LEAGUES = ['E0', 'E1', 'D1', 'SP1', 'I1', 'F1'];

// Ugyanaz az idosulyozas, mint a ratings.js-ben (kb. 107 napos felezes).
const XI = 0.0065;
const SHRINK_K = 12;      // ennyi sulyozott meccsnel 50% a sajat adat sulya
const MIN_HISTORY = 200;  // ennyi meccs elott nem jelzunk elore
// A vizsgalt over/under vonalak. A szoglet-piac tipikusan 8.5-11.5 kozott
// mozog; a 9.5 es 10.5 a leggyakoribb fovonal.
const LINES = [8.5, 9.5, 10.5, 11.5];

// ---------- adat ----------

function loadAll() {
  const all = [];
  const missing = [];
  for (const s of SEASONS) {
    for (const l of LEAGUES) {
      const file = `${l}_${s}.csv`;
      if (!fs.existsSync(file)) { missing.push(file); continue; }
      const rows = parseCsv(fs.readFileSync(file, 'utf8'), l, s);
      for (const r of rows) all.push(r);
    }
  }
  return { all, missing };
}

// ---------- modell ----------

// Szoglet-eromertek csapatonkent: mennyi szogletet SZEREZ (att) es mennyit
// ENGED (def), a liga atlagahoz kepest, idoben sulyozva. Ugyanaz a szerkezet,
// mint a gol-ratingeknel, csak a cel HC/AC.
function computeCornerRatings(matches, asOf) {
  const now = new Date(asOf);
  const byLeague = {};
  for (const m of matches) (byLeague[m.league] = byLeague[m.league] || []).push(m);

  const out = {};
  for (const [league, rows] of Object.entries(byLeague)) {
    const en = rows.map(m => {
      const days = Math.max(0, (now - new Date(m.date)) / 86400000);
      return { ...m, w: Math.exp(-XI * days) };
    }).filter(m => m.w > 1e-6);
    if (!en.length) continue;

    let wsum = 0, hcsum = 0, acsum = 0;
    for (const m of en) { wsum += m.w; hcsum += m.w * m.hc; acsum += m.w * m.ac; }
    if (wsum < 1e-9) continue;
    const avgH = hcsum / wsum;   // liga atlagos hazai szoglet
    const avgA = acsum / wsum;   // liga atlagos vendeg szoglet
    if (!(avgH > 0) || !(avgA > 0)) continue;

    // Csapatonkent sulyozott att/def, a liga atlagara normalva.
    const t = {};
    const touch = k => (t[k] = t[k] || { aw: 0, af: 0, dw: 0, df: 0 });
    for (const m of en) {
      const H = touch(m.home), A = touch(m.away);
      // hazai: szerzett = hc (hazai atlaghoz merve), kapott = ac (vendeg atlaghoz)
      H.aw += m.w; H.af += m.w * (m.hc / avgH);
      H.dw += m.w; H.df += m.w * (m.ac / avgA);
      A.aw += m.w; A.af += m.w * (m.ac / avgA);
      A.dw += m.w; A.df += m.w * (m.hc / avgH);
    }

    const strengths = {};
    for (const [name, v] of Object.entries(t)) {
      // Shrinkage 1.0 (liga atlag) fele. Szogletnel — a golokkal ellentetben —
      // 1.0 a helyes prior: nincs "ujonc kevesebb szogletet szerez" hatas,
      // sot a gyengebb csapatok gyakran TOBB szogletet kapnak es adnak is.
      const sa = v.aw / (v.aw + SHRINK_K);
      const sd = v.dw / (v.dw + SHRINK_K);
      strengths[name] = {
        att: sa * (v.af / Math.max(v.aw, 1e-9)) + (1 - sa) * 1.0,
        def: sd * (v.df / Math.max(v.dw, 1e-9)) + (1 - sd) * 1.0,
      };
    }
    out[league] = { avgH, avgA, strengths };
  }
  return out;
}

// Varhato osszszoglet egy meccsre. null, ha barmelyik csapat ismeretlen.
function expectedCorners(rt, m) {
  const L = rt[m.league];
  if (!L) return null;
  const H = L.strengths[m.home], A = L.strengths[m.away];
  if (!H || !A) return null;
  const eh = L.avgH * H.att * A.def;   // hazai varhato szoglet
  const ea = L.avgA * A.att * H.def;   // vendeg varhato szoglet
  if (!(eh > 0) || !(ea > 0)) return null;
  return eh + ea;
}

// ---------- valoszinuseg ----------

// P(osszszoglet > line). A szoglet TULSZORT a Poissonhoz kepest
// (variancia/atlag = 1.214 a korabbi meresbol), ezert negativ binomialis,
// nem Poisson. Poissont hasznalni itt szisztematikusan alabecsulne a
// szelso kimeneteleket.
function nbTailOver(mean, line, vmr) {
  // vmr = variancia/atlag arany (>1). NB parameterezes: var = mean * vmr,
  // r = mean / (vmr - 1), p = 1 / vmr.
  if (!(mean > 0)) return null;
  const v = Math.max(vmr, 1.0001);
  const r = mean / (v - 1);
  const p = 1 / v;
  // P(X <= k) osszegzes, k = floor(line). A line mindig .5, igy nincs push.
  const k = Math.floor(line);
  // P(X=0) = p^r, majd rekurzio: P(X=i) = P(X=i-1) * (r+i-1)/i * (1-p)
  let term = Math.pow(p, r);
  let cdf = term;
  for (let i = 1; i <= k; i++) {
    term *= ((r + i - 1) / i) * (1 - p);
    cdf += term;
  }
  return Math.min(Math.max(1 - cdf, 1e-9), 1 - 1e-9);
}

// ---------- meresek ----------

function logLoss(p, outcome) { return -(outcome ? Math.log(p) : Math.log(1 - p)); }

function pct(x) { return (100 * x).toFixed(1) + '%'; }
function f3(x) { return x.toFixed(4); }

// ---------- futtatas ----------

const { all, missing } = loadAll();

if (missing.length) {
  console.log(`Figyelem: ${missing.length} fajl hianyzik (${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ', ...' : ''})`);
}
if (!all.length) {
  console.error('\nNincs adat a data/ konyvtarban. Toltsd le eloszor:');
  console.error('  for S in 2223 2324 2425 2526; do for L in E0 E1 D1 SP1 I1 F1; do');
  console.error('    curl -s -o "${L}_${S}.csv" "https://www.football-data.co.uk/mmz4281/$S/$L.csv"');
  console.error('  done; done');
  process.exit(1);
}

const withCorners = all.filter(m => m.hc !== null && m.ac !== null);
console.log(`\nBetoltve: ${all.length} meccs, ebbol szoglettel: ${withCorners.length}`);
if (withCorners.length < 500) {
  console.error('\nTul keves szogletes meccs (<500) — ezen a mintan nem lehet kovetkeztetni.');
  process.exit(1);
}

withCorners.sort((a, b) => new Date(a.date) - new Date(b.date));

// 1) Alapstatisztika: tenyleg tulszort-e a szoglet?
let n0 = 0, sum = 0, sumsq = 0;
for (const m of withCorners) { const c = m.hc + m.ac; n0++; sum += c; sumsq += c * c; }
const mean0 = sum / n0;
const var0 = sumsq / n0 - mean0 * mean0;
const VMR = var0 / mean0;
console.log(`Ossz-szoglet atlag: ${mean0.toFixed(2)}, szoras^2: ${var0.toFixed(2)}, variancia/atlag: ${VMR.toFixed(3)}`);
console.log(VMR > 1.05
  ? '  -> tulszort (a Poisson alabecsulne a szelsoertekeket) — NB modellt hasznalunk'
  : '  -> gyakorlatilag Poisson');

// 2) Walk-forward: minden meccset CSAK a korabbi meccsekbol jelzunk elore.
// Hetente szamolunk ujra ratinget, mint a backtest.js-ben (sebesseg).
const stats = {};
for (const line of LINES) {
  stats[line] = { n: 0, mLL: 0, bLL: 0, mBr: 0, bBr: 0, over: 0, preds: [] };
}

let ratings = null, ratingsAt = null, skipped = 0;
const RECALC_MS = 7 * 86400000;

for (let i = 0; i < withCorners.length; i++) {
  const m = withCorners[i];
  if (i < MIN_HISTORY) continue;

  const t = new Date(m.date).getTime();
  if (!ratings || t - ratingsAt > RECALC_MS) {
    // Szigoruan csak a korabbi meccsek — ez zarja ki a lookahead-et.
    ratings = computeCornerRatings(withCorners.slice(0, i), m.date);
    ratingsAt = t;
  }

  const exp = expectedCorners(ratings, m);
  if (exp === null) { skipped++; continue; }

  const actual = m.hc + m.ac;

  // Alapvonal: a liga sajat idosulyozott atlaga, csapatinformacio NELKUL.
  // Ez az, amit a modellnek meg kell vernie ahhoz, hogy erjen valamit.
  const L = ratings[m.league];
  const baseMean = L ? (L.avgH + L.avgA) : mean0;

  for (const line of LINES) {
    const pm = nbTailOver(exp, line, VMR);
    const pb = nbTailOver(baseMean, line, VMR);
    if (pm === null || pb === null) continue;
    const o = actual > line ? 1 : 0;
    const s = stats[line];
    s.n++;
    s.over += o;
    s.mLL += logLoss(pm, o);
    s.bLL += logLoss(pb, o);
    s.mBr += (pm - o) * (pm - o);
    s.bBr += (pb - o) * (pb - o);
    s.preds.push({ pm, pb, o });
  }
}

console.log(`Kihagyva ismeretlen csapat miatt: ${skipped}`);

// 3) Eredmenyek vonalankent
console.log('\n=== Modell vs. liga-atlag alapvonal (walk-forward) ===');
console.log('vonal    n     over%   modell LL   alap LL    kulonbseg   modell Brier  alap Brier');
let anyBetter = false;
for (const line of LINES) {
  const s = stats[line];
  if (!s.n) continue;
  const mLL = s.mLL / s.n, bLL = s.bLL / s.n;
  const diff = bLL - mLL;   // pozitiv = a modell jobb
  if (diff > 0) anyBetter = true;
  console.log(
    `${String(line).padEnd(7)} ${String(s.n).padEnd(6)}${pct(s.over / s.n).padEnd(8)}` +
    `${f3(mLL).padEnd(12)}${f3(bLL).padEnd(11)}${(diff >= 0 ? '+' : '') + f3(diff).padEnd(12)}` +
    `${f3(s.mBr / s.n).padEnd(14)}${f3(s.bBr / s.n)}`
  );
}
console.log('  (a kulonbseg POZITIV, ha a modell jobb az alapvonalnal)');

// 4) INVERTALO KONTROLL — ez fogta meg a gol-modell forditott rangsorat.
// A modell elorejelzeseit kvartilisekbe rendezzuk aszerint, mennyivel ter el
// az alapvonaltol, es megnezzuk a talalati aranyt sávonkent. Ha a
// legmagabiztosabb sav teljesit a LEGROSSZABBUL, a jelzes forditott.
console.log('\n=== Invertalo kontroll: a modell elterese az alapvonaltol ===');
for (const line of LINES) {
  const s = stats[line];
  if (s.n < 200) continue;
  const rows = s.preds.map(r => ({ ...r, edge: r.pm - r.pb }));
  rows.sort((a, b) => a.edge - b.edge);
  const q = Math.floor(rows.length / 4);
  if (!q) continue;
  const band = (arr, label) => {
    let ll = 0, bll = 0, hit = 0;
    for (const r of arr) { ll += logLoss(r.pm, r.o); bll += logLoss(r.pb, r.o); hit += r.o; }
    return `${label}: modell LL ${f3(ll / arr.length)}  alap LL ${f3(bll / arr.length)}  ` +
           `elteres ${(bll - ll >= 0 ? '+' : '') + f3((bll - ll) / arr.length)}  over ${pct(hit / arr.length)}`;
  };
  console.log(`\n  vonal ${line} (n=${rows.length}):`);
  console.log('    ' + band(rows.slice(0, q), 'legerosebb UNDER-jelzes'));
  console.log('    ' + band(rows.slice(-q), 'legerosebb OVER-jelzes '));
  console.log('    ' + band(rows.slice(q, -q), 'kozepso fel          '));
}

// 5) Iteles
console.log('\n=== Kovetkeztetes ===');
const main = stats[9.5].n ? stats[9.5] : stats[10.5];
const gain = main.n ? (main.bLL - main.mLL) / main.n : 0;
if (!anyBetter || gain <= 0) {
  console.log('A modell NEM veri a liga-atlag alapvonalat. A csapatinformacio nem');
  console.log('ad hozzá semmit a szogletszam elorejelzesehez ezen a mintan.');
  console.log('-> NE vegyel szoglet-odds adatot. Nincs mit arazni.');
} else if (gain < 0.005) {
  console.log(`A modell epphogy jobb (log-loss nyereseg ${f3(gain)}/meccs), de a`);
  console.log('nyereseg elhanyagolhato. Egy tipikus szoglet-piac marginja 5-8%;');
  console.log('ekkora elony azt nem fedezi.');
  console.log('-> NE vegyel adatot ez alapjan.');
} else {
  console.log(`A modell veri az alapvonalat (log-loss nyereseg ${f3(gain)}/meccs).`);
  console.log('Ez indokolja a kovetkezo lepest: a Footiqo INGYENES 25/26-os szezonja');
  console.log('(~380 meccs) valosag-ellenorzesnek, valos zaro szoglet-oddsokkal.');
  console.log('FIGYELEM: 380 meccs kevés a vegso itelethez — az meg nem bizonyitek,');
  console.log('csak az, hogy erdemes-e a fizetos adaton komolyabban merni.');
  console.log('Nezd meg az invertalo kontrollt is: ha a legerosebb jelzes a');
  console.log('legrosszabb, a rangsor forditott es a nyereseg nem hasznalhato.');
}
console.log('');
