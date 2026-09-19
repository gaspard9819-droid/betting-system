// Csapda-e a szuk margo? A kimenetel-szintu arres es a tenyleges hozam.
//
// MIERT KESZULT: 2026-09-19. A felvetes: egy fogadoiroda szandekosan tesz
// vonzoan szuk margot azokra a kimenetelekre, ahol a fogado ugy erzi, tud
// valamit - es a penzt ott szedi be, ahol a margo latszolag nagyobb, de
// valojaban a fogado ugyis oda megy. Ha ez igaz, a "kedvezo margoju" labak
// hozama NEM jobb, mint a kedvezotlene - vagy akar rosszabb.
//
// MODSZER:
//   1) Referencia-valoszinuseg (p_ref) a Pinnacle ZARO arbol, POWER de-viggel.
//      A power-t a devig_check.js mérte a legjobbnak Pinnacle aron (0.96245).
//      Pinnacle zaro = a legjobb kozelites arra, amit a piac tenylegesen tud.
//   2) Kimenetel-szintu margo egy konkret konyvnel (B365 / Avg / Max), a ZARO
//      aron: margin_i = p_ref_i * odds_i - 1  <- ez pont az EV egysegnyi teten.
//      Negativ = a konyv levon; nulla korul = tiszta ar; pozitiv = tul nagyot ad.
//      A "kedvezo margo" tehat a NULLAHOZ KOZELI vagy pozitiv margin_i.
//   3) A kimeneteleket margin_i szerint decilisekbe soroljuk, es minden
//      decilisre kiszamoljuk a TENYLEGES ROI-t (flat 1 egyseg minden labra).
//
//   Ha a margo becsuletes jelzes: a ROI monoton no a margin_i-vel, es a
//   legjobb decilis ROI-ja kb. a margin_i atlagaval egyezik.
//   Ha csapda: a ROI lapos vagy forditott - a szuk margo nem terul meg.
//
//   Kontroll: ugyanez p_ref helyett a TENYLEGES gyakorisaggal (a margo
//   elorejelzo erejet a sajat referenciaja nelkul is latni akarjuk).
//
// Futtatas: cd data && node ../margin_trap.js
const L = require('./odds_loader.js');

function power(o) {
  const raw = o.map(x => 1 / x);
  let lo = 0.5, hi = 5;
  for (let i = 0; i < 60; i++) {
    const k = (lo + hi) / 2;
    const s = raw.reduce((a, p) => a + Math.pow(p, k), 0);
    if (s > 1) lo = k; else hi = k;
  }
  const p = raw.map(x => Math.pow(x, (lo + hi) / 2));
  const s = p.reduce((a, b) => a + b, 0);
  return p.map(x => x / s);
}

const all = L.loadAll();
const mean = L.mean, roi = L.roi, roiSe = L.roiSe;

// --- 1. legek osszegyujtese kimenetel-szinten ---
// Minden meccs 3 labat ad (H/D/A). A referencia Pinnacle zaro, a fogadhato
// ar egy masik konyv zaro ara - kulonben a margo definicio szerint nulla.
const BOOKS = [
  ['B365', m => m.b365c],
  ['Avg',  m => m.avgc],
  ['Max',  m => m.maxc],
];

function buildLegs(getOdds) {
  const legs = [];
  for (const m of all) {
    if (!m.psc) continue;                 // referencia kell
    const o = getOdds(m);
    if (!o) continue;
    const p = power(m.psc);
    for (let i = 0; i < 3; i++) {
      legs.push({
        p: p[i],
        odds: o[i],
        margin: p[i] * o[i] - 1,          // EV egysegnyi teten
        win: m.res === i,
        outcome: ['H', 'D', 'A'][i],
        pinn: m.psc[i],
      });
    }
  }
  return legs;
}

function deciles(legs, n = 10) {
  const s = legs.slice().sort((a, b) => a.margin - b.margin);
  const out = [];
  for (let i = 0; i < n; i++) {
    const lo = Math.floor(i * s.length / n), hi = Math.floor((i + 1) * s.length / n);
    out.push(s.slice(lo, hi));
  }
  return out;
}

const f = (x, d = 2) => (x >= 0 ? '+' : '') + x.toFixed(d);

for (const [name, getOdds] of BOOKS) {
  const legs = buildLegs(getOdds);
  console.log(`\n=== ${name} zaro ar, Pinnacle zaro referencia (power de-vig) ===`);
  console.log(`legek: ${legs.length}  (${legs.length / 3} meccs)`);
  console.log(`atlagos kimenetel-margo: ${f(mean(legs.map(l => l.margin)) * 100)}%`);
  console.log('');
  console.log('decilis |   margo-sav (EV%)   | atlag EV% | atlag odds |    ROI%  +- SE  | talalat% vart%');
  const d = deciles(legs);
  d.forEach((g, i) => {
    const lo = g[0].margin * 100, hi = g[g.length - 1].margin * 100;
    const evAvg = mean(g.map(l => l.margin)) * 100;
    const r = roi(g), se = roiSe(g);
    const hit = mean(g.map(l => l.win ? 1 : 0)) * 100;
    const exp = mean(g.map(l => l.p)) * 100;
    console.log(
      `   ${String(i + 1).padStart(2)}   | ${f(lo).padStart(7)} .. ${f(hi).padStart(7)} | ` +
      `${f(evAvg).padStart(8)} | ${mean(g.map(l => l.odds)).toFixed(2).padStart(10)} | ` +
      `${f(r).padStart(7)} +-${se.toFixed(2).padStart(5)} | ` +
      `${hit.toFixed(1).padStart(6)} ${exp.toFixed(1).padStart(6)}`
    );
  });

  // felso vs also fel - a fo osszehasonlitas
  const s = legs.slice().sort((a, b) => a.margin - b.margin);
  const bad = s.slice(0, Math.floor(s.length / 2));      // kedvezotlen margo
  const good = s.slice(Math.floor(s.length / 2));        // kedvezo margo
  const diff = roi(good) - roi(bad);
  const seDiff = Math.sqrt(roiSe(good) ** 2 + roiSe(bad) ** 2);
  console.log('');
  console.log(`  kedvezotlen fel (also 50%): EV ${f(mean(bad.map(l => l.margin)) * 100)}%  ROI ${f(roi(bad))}% +-${roiSe(bad).toFixed(2)}`);
  console.log(`  kedvezo fel    (felso 50%): EV ${f(mean(good.map(l => l.margin)) * 100)}%  ROI ${f(roi(good))}% +-${roiSe(good).toFixed(2)}`);
  console.log(`  kulonbseg: ${f(diff)}pp +-${seDiff.toFixed(2)}  (t = ${(diff / seDiff).toFixed(2)})`);
  console.log(`  vart kulonbseg az EV alapjan: ${f((mean(good.map(l => l.margin)) - mean(bad.map(l => l.margin))) * 100)}pp`);
}

// --- 2. hol van a margo? kimenetel-tipus es odds-sav szerint ---
console.log('\n\n=== HOL REJTI EL A KONYV A MARGOT? (B365 zaro) ===');
const legs = buildLegs(m => m.b365c);
console.log('\nkimenetel szerint:');
for (const oc of ['H', 'D', 'A']) {
  const g = legs.filter(l => l.outcome === oc);
  console.log(`  ${oc}: n=${g.length}  atlag EV ${f(mean(g.map(l => l.margin)) * 100)}%  ROI ${f(roi(g))}% +-${roiSe(g).toFixed(2)}`);
}
console.log('\nodds-sav szerint (a fogadhato ar):');
const BANDS = [[1, 1.6], [1.6, 2.2], [2.2, 3.2], [3.2, 5], [5, 8], [8, 1000]];
for (const [lo, hi] of BANDS) {
  const g = legs.filter(l => l.odds >= lo && l.odds < hi);
  if (g.length < 50) continue;
  console.log(`  ${String(lo).padStart(4)}-${String(hi === 1000 ? '+' : hi).padEnd(4)}: n=${String(g.length).padStart(5)}  atlag EV ${f(mean(g.map(l => l.margin)) * 100).padStart(7)}%  ROI ${f(roi(g)).padStart(7)}% +-${roiSe(g).toFixed(2)}`);
}


// --- 3. KONTROLL: referencia-fuggetlen margo ---
// A fenti mérés reszben korkoros: a margo p_ref-bol jon, es a ROI-t is a
// p_ref-hez merjuk. Ha a Pinnacle maga torzit, a torzitas mindketto oldalan
// megjelenik. Ezert itt a margot NEM egy valoszinuseg-modellbol szamoljuk,
// hanem tisztan AR-OSSZEHASONLITASBOL:
//
//   rel_i = odds_i / max_odds_i   <- mennyire jo ez az ar a piac legjobbjahoz
//
// Ez nem hasznal semmilyen valoszinuseget. Ha a "kedvezo ar" becsuletes
// jelzes, a magasabb rel_i-hez jobb ROI tartozik. Ha csapda, nem.
console.log('\n\n=== KONTROLL: valoszinuseg nelkuli margo (odds / legjobb odds) ===');
{
  const legs = [];
  for (const m of all) {
    if (!m.b365c || !m.maxc) continue;
    for (let i = 0; i < 3; i++) {
      legs.push({ rel: m.b365c[i] / m.maxc[i], odds: m.b365c[i], win: m.res === i });
    }
  }
  console.log(`legek: ${legs.length}   atlagos rel: ${(mean(legs.map(l => l.rel)) * 100).toFixed(2)}%`);
  console.log('\nkvintilis | rel-sav        | atlag odds |    ROI%  +- SE');
  const s = legs.slice().sort((a, b) => a.rel - b.rel);
  for (let i = 0; i < 5; i++) {
    const g = s.slice(Math.floor(i * s.length / 5), Math.floor((i + 1) * s.length / 5));
    console.log(
      `    ${i + 1}     | ${(g[0].rel * 100).toFixed(1).padStart(5)}..${(g[g.length - 1].rel * 100).toFixed(1).padStart(6)}% | ` +
      `${mean(g.map(l => l.odds)).toFixed(2).padStart(10)} | ${f(roi(g)).padStart(7)} +-${roiSe(g).toFixed(2)}`
    );
  }
  const bad = s.slice(0, Math.floor(s.length / 2)), good = s.slice(Math.floor(s.length / 2));
  const diff = roi(good) - roi(bad), seD = Math.sqrt(roiSe(good) ** 2 + roiSe(bad) ** 2);
  console.log(`\n  rosszabb ar (also 50%): ROI ${f(roi(bad))}% +-${roiSe(bad).toFixed(2)}`);
  console.log(`  jobb ar     (felso 50%): ROI ${f(roi(good))}% +-${roiSe(good).toFixed(2)}`);
  console.log(`  kulonbseg: ${f(diff)}pp +-${seD.toFixed(2)}  (t = ${(diff / seD).toFixed(2)})`);
}

// --- 4. A CSAPDA-TESZT ---
// A felvetes: a konyv a SZUK MARGOJU piacokon rejt el torzitast. Tehat nem
// kimenetel-szinten, hanem PIAC-szinten nezzuk: a szuk overroundu meccseken
// jobban jar-e a fogado, mint a szelesen?
//
// Ket ertelmezes, mindketto merve:
//   (a) fogadj a legjobb elerheto aron (Max) - szamit-e a B365 margoja?
//   (b) fogadj a B365-nel - a szuk B365-margoju meccsek jobbak-e?
console.log('\n\n=== CSAPDA-TESZT: piac-szintu overround vs. hozam ===');
{
  const ms = [];
  for (const m of all) {
    if (!m.b365c || !m.maxc || !m.psc) continue;
    const orB = m.b365c.reduce((a, o) => a + 1 / o, 0) - 1;
    ms.push({ m, orB });
  }
  ms.sort((a, b) => a.orB - b.orB);
  console.log(`meccsek: ${ms.length}   atlagos B365 overround: ${(mean(ms.map(x => x.orB)) * 100).toFixed(2)}%`);
  console.log('\nkvintilis | B365 overround | (a) Max-aron ROI | (b) B365-aron ROI  | favorit talalat%');
  for (let i = 0; i < 5; i++) {
    const g = ms.slice(Math.floor(i * ms.length / 5), Math.floor((i + 1) * ms.length / 5));
    // minden meccsen mind a 3 labra flat tet - a piac egeszenek hozama
    const betsMax = [], betsB = [];
    let favHit = 0;
    for (const { m } of g) {
      for (let j = 0; j < 3; j++) {
        betsMax.push({ odds: m.maxc[j], win: m.res === j });
        betsB.push({ odds: m.b365c[j], win: m.res === j });
      }
      const fav = m.b365c.indexOf(Math.min(...m.b365c));
      if (m.res === fav) favHit++;
    }
    console.log(
      `    ${i + 1}     | ${(g[0].orB * 100).toFixed(2).padStart(5)}..${(g[g.length - 1].orB * 100).toFixed(2).padStart(6)}% | ` +
      `${f(roi(betsMax)).padStart(9)}% +-${roiSe(betsMax).toFixed(2)} | ` +
      `${f(roi(betsB)).padStart(9)}% +-${roiSe(betsB).toFixed(2)} | ` +
      `${(favHit / g.length * 100).toFixed(1).padStart(8)}%`
    );
  }
}
