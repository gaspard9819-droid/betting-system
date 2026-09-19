// Ket labbal melyik cel-szorzo a legolcsobb, es szamit-e egyaltalan?
//
// MIERT KESZULT: 2026-09-19. A kerdes az volt, hogy a szokasos ketlabas
// @2.00-t erdemes-e masra cserelni, ha a cel a legszukebb margo.
//
// EGY KORABBI VALTOZAT EBBEN TEVEDETT, ES ERDEMES TUDNI, MIERT
//
// Az elso valtozat a football-data CSV-kbol merte az AH-t, es arra jutott,
// hogy @2.00 ket AH-labbal NEM EPITHETO, mert az AH odds a 1.58-2.35 savba
// szorul (14568 labbol 0 db esett az 1.38-1.52 savba).
//
// Ez az allitas HAMIS a Tippmixre, es a felhasznalo szelvenye cafolta meg:
// Roma - Internazionale, Ázsiai hendikep -1, Internazionale (+1) @1.23.
//
// A hiba oka: a football-data meccsenkent EGYETLEN AH-vonalat rogzit, azt,
// amelyik kb. kiegyenliti az eselyeket. Ezert latszott az ar ~1.95 korul
// ragadva. A Tippmix viszont MINDEN vonalat kinal egyszerre - a Roma-Interre
// -2-tol +2-ig 12 AH-vonalat, 1.01-tol 24-ig terjedo arakkal.
//
// Amit "a piac termeszete"-nek mertem, az az ADATFORRAS termeszete volt.
// Ugyanaz a hiba, mint a vegas_boost_caveat.js-ben: szuk mintabol a piac
// egeszere kovetkeztetni. Ezert ez a script most a VALODI poolbol mer.
//
// MIT MER
//   local/pool/*.json.gz - amit a napi logger gyujt a Tippmixrol, minden
//   piaccal es minden vonallal. Nincs benne eredmeny, ezert CSAK MARGO
//   merheto, hozam NEM. A hold azt mondja meg, mennyit tart meg a konyv,
//   nem azt, hogy nyersz-e.
//
//   hold = 1 - 1/sum(1/o)   <- kimenetel-szamtol fuggetlen, ezert a 2 es 3
//   labu piacok osszemerhetok. Ket labra: 1 - (1-h1)*(1-h2).
//
// A BOOST KULON KEZELENDO
//   A boostolt piac (isBoost, bettingTypeId 693) nem sima ar, hanem
//   promocio - a holdja azert kicsi, mert a konyv szandekosan tulfizet.
//   Ha egybe merjuk a tobbivel, minden "legolcsobb" lista tele lesz vele,
//   es a piacvalasztasrol semmit nem tanulunk. Ezert a fo tabla boost
//   NELKUL megy, es a boost erteke kulon szamolodik.
//
// Futtatas: node research/combo_target.js
//   A poolt a BETTING_POOL_DIR is felulirhatja (ua. mint a local/calib.js).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const poolDir = () => process.env.BETTING_POOL_DIR || path.join(__dirname, '..', 'local', 'pool');

const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const median = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const hold = picks => {
  if (picks.length < 2) return null;
  const s = picks.reduce((a, p) => a + 1 / p.odds, 0);
  if (s <= 1) return null;                    // hianyos piac: nem ertelmezheto
  const h = 1 - 1 / s;
  return h < 0 || h > 0.5 ? null : h;         // szemet kiszurve
};

// --- a legfrissebb snapshot ---
const POOL = poolDir();
if (!fs.existsSync(POOL)) {
  console.error('Nincs pool mappa: ' + POOL + ' — elobb naplozni kell: node local/log.js');
  process.exit(1);
}
const files = fs.readdirSync(POOL).filter(f => f.endsWith('.json.gz')).sort();
if (!files.length) {
  console.error('Ures a pool mappa: ' + POOL);
  process.exit(1);
}
const snapFile = files[files.length - 1];
const snap = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(POOL, snapFile))));

console.log('=== FORRAS ===');
console.log('snapshot: ' + snapFile);
console.log('gyujtve:  ' + snap.fetchedAt);
console.log('meccsek:  ' + snap.matches.length + '   nyers piacok: ' + snap.rawMarkets);
console.log('');
console.log('FIGYELEM: a pool nem tartalmaz eredmenyt, ezert ez a script CSAK');
console.log('MARGOT mer. Hozamrol semmit nem mond. Egy snapshot egy forduloja:');
console.log('az iranyok szerkezetiek, a pontos szamok fordulonkent ingadoznak.');

// --- labak kigyujtese ---
// egy lab: { o: odds, h: a piaca holdja, mk: piacnev, lab: valasztas }
function legsOf(match, { withBoost }) {
  const out = [];
  for (const mk of match.markets || []) {
    if (!withBoost && mk.isBoost) continue;
    const h = hold(mk.picks);
    if (h === null) continue;
    for (const p of mk.picks) out.push({ o: p.odds, h, mk: mk.name, lab: p.label, boost: !!mk.isBoost });
  }
  return out;
}

// --- 1. egy lab: az odds hossza dragit-e? ---
console.log('');
console.log('');
console.log('=== 1. EGY LAB: az atlag romlik, a LEGJOBB ELERHETO nem ===');
console.log('');
console.log('Ha a hosszabb odds onmagaban dragabb lenne, a jobb szelso oszlop is nőne.');
console.log('');
{
  const legs = [];
  for (const m of snap.matches) legs.push(...legsOf(m, { withBoost: false }));
  console.log('odds sav   | labak | atlag hold% | legjobb 10% | min');
  const B = [[1.05, 1.15], [1.15, 1.25], [1.25, 1.35], [1.35, 1.5], [1.5, 1.7],
             [1.7, 1.9], [1.9, 2.2], [2.2, 2.6], [2.6, 3.2], [3.2, 4.5], [4.5, 7]];
  for (const [lo, hi] of B) {
    const g = legs.filter(x => x.o >= lo && x.o < hi);
    if (g.length < 20) continue;
    const hs = g.map(x => x.h * 100).sort((a, b) => a - b);
    console.log(
      `${String(lo).padStart(4)}-${String(hi).padEnd(5)}|${String(g.length).padStart(6)} |` +
      `${mean(hs).toFixed(2).padStart(12)} |${mean(hs.slice(0, Math.ceil(hs.length * 0.1))).toFixed(2).padStart(12)} |${hs[0].toFixed(2).padStart(5)}`
    );
  }
  console.log('');
  console.log('Nem az odds hossza dragit, hanem hogy hosszabb oddsnal tobb a szemet,');
  console.log('amibe bele lehet futni.');
}

// --- 2. a fo kerdes: szamit-e a cel-szorzo? ---
// Ket KULONBOZO meccsbol egy-egy lab (egy meccsen belul a labak nem
// fuggetlenek, es a Tippmix ugysem engedi oket egy szelvenyre).
// Minden meccsparra a legolcsobb valasztas, ami a celsavba esik.
const TARGETS = [1.5, 1.8, 2.0, 2.2, 2.5, 3.0, 4.0, 5.0, 7.0, 10.0];

function targetTable(withBoost) {
  const byMatch = snap.matches
    .map(m => ({ m, L: legsOf(m, { withBoost }) }))
    .filter(x => x.L.length);
  console.log('cel   | parok | median hold% | legjobb 10% |   min | tipikus legjobb par');
  const rows = {};
  for (const T of TARGETS) {
    const lo = T * 0.98, hi = T * 1.02;
    const res = [];
    let bestEx = null;
    for (let i = 0; i < byMatch.length; i++) for (let j = i + 1; j < byMatch.length; j++) {
      const A = byMatch[i], B = byMatch[j];
      let best = null;
      for (const a of A.L) {
        if (a.o >= T) continue;                      // egy lab nem viheti a celt
        for (const b of B.L) {
          const mult = a.o * b.o;
          if (mult < lo || mult > hi) continue;
          const h = 1 - (1 - a.h) * (1 - b.h);
          if (!best || h < best.h) best = { h, a, b };
        }
      }
      if (best) { res.push(best.h * 100); if (!bestEx || best.h < bestEx.h) bestEx = best; }
    }
    if (res.length < 10) continue;
    res.sort((x, y) => x - y);
    rows[T] = { med: median(res), top: mean(res.slice(0, Math.ceil(res.length * 0.1))), min: res[0] };
    const ex = bestEx ? `${bestEx.a.mk} @${bestEx.a.o} + ${bestEx.b.mk} @${bestEx.b.o}` : '';
    console.log(
      `${String(T.toFixed(1)).padStart(5)} |${String(res.length).padStart(6)} |` +
      `${rows[T].med.toFixed(2).padStart(13)} |${rows[T].top.toFixed(2).padStart(12)} |` +
      `${rows[T].min.toFixed(2).padStart(6)} | ${ex}`
    );
  }
  return rows;
}

console.log('');
console.log('');
console.log('=== 2. KET LAB, KET KULONBOZO MECCS: szamit-e a cel-szorzo? ===');
console.log('');
console.log('Minden meccsparra a legolcsobb kombinacio, ami a celsavba (+-2%) esik.');
console.log('BOOST NELKUL - a boost erteke lentebb, kulon.');
console.log('');
const noBoost = targetTable(false);
{
  const ks = Object.keys(noBoost).map(Number).sort((a, b) => a - b);
  if (ks.length >= 2) {
    const a = noBoost[ks[0]], b = noBoost[ks[ks.length - 1]];
    console.log('');
    console.log(`  @${ks[0].toFixed(2)} -> @${ks[ks.length - 1].toFixed(2)}: median hold ${a.med.toFixed(2)}% -> ${b.med.toFixed(2)}%  (${(b.med - a.med).toFixed(2)}pp)`);
    console.log('  A cel-szorzo tizszerezese ennyit hoz. Cserebe a talalati esely tort reszere esik.');
  }
}

// --- 3. ahol a valodi kulonbseg van: piacvalasztas ugyanazon a szorzon ---
console.log('');
console.log('');
console.log('=== 3. UGYANAZ A SZORZO, KULONBOZO PIACOK - ITT VAN A PENZ ===');
console.log('');
{
  const T = 2.0, lo = T * 0.98, hi = T * 1.02;
  const byMatch = snap.matches.map(m => ({ m, L: legsOf(m, { withBoost: false }) })).filter(x => x.L.length);
  const all = [];
  for (let i = 0; i < byMatch.length; i++) for (let j = i + 1; j < byMatch.length; j++) {
    for (const a of byMatch[i].L) for (const b of byMatch[j].L) {
      const mult = a.o * b.o;
      if (mult < lo || mult > hi) continue;
      all.push({ h: (1 - (1 - a.h) * (1 - b.h)) * 100, a, b });
    }
  }
  all.sort((x, y) => x.h - y.h);
  console.log(`@${T.toFixed(2)} korul ${all.length} lehetseges ketlabas kombinacio (boost nelkul):`);
  console.log(`  legolcsobb ${all[0].h.toFixed(2)}%  |  median ${median(all.map(x => x.h)).toFixed(2)}%  |  legdragabb ${all[all.length - 1].h.toFixed(2)}%`);
  console.log(`  szoras a ket veg kozott: ${(all[all.length - 1].h - all[0].h).toFixed(2)}pp`);
  console.log('');
  console.log('A 3 legolcsobb:');
  for (const r of all.slice(0, 3)) console.log(`  ${r.h.toFixed(2)}%  ${r.a.mk} / ${r.a.lab} @${r.a.o}  +  ${r.b.mk} / ${r.b.lab} @${r.b.o}`);
  console.log('A 3 legdragabb:');
  for (const r of all.slice(-3)) console.log(`  ${r.h.toFixed(2)}%  ${r.a.mk} / ${r.a.lab} @${r.a.o}  +  ${r.b.mk} / ${r.b.lab} @${r.b.o}`);

  // piac-csaladonkent, hogy a mintazat lathato legyen
  console.log('');
  console.log('Piac-csaladok holdja (egy lab, boost nelkul):');
  const fam = {};
  for (const m of snap.matches) for (const mk of m.markets || []) {
    if (mk.isBoost) continue;
    const h = hold(mk.picks);
    if (h === null) continue;
    let f;
    if (mk.name.startsWith('Ázsiai hendikep')) f = 'Azsiai hendikep';
    else if (mk.name === '1X2') f = '1X2';
    else if (/^Gólszám [\d.]+$/.test(mk.name)) f = 'Golszam (egy vonal)';
    else if (mk.name === 'Mindkét csapat szerez gólt') f = 'BTTS';
    else if (mk.name.startsWith('Hendikep')) f = 'EU hendikep';
    else f = 'KOMBINALT / egzotikus';
    (fam[f] = fam[f] || []).push(h * 100);
  }
  console.log('csalad                | piac | hold%');
  for (const [k, v] of Object.entries(fam).sort((a, b) => mean(a[1]) - mean(b[1]))) {
    console.log(`${k.padEnd(22)}|${String(v.length).padStart(5)} |${mean(v).toFixed(2).padStart(6)}`);
  }
}

// --- 4. mit er a boost ---
console.log('');
console.log('');
console.log('=== 4. A BOOST ERTEKE ===');
console.log('');
{
  const boosts = [];
  for (const m of snap.matches) for (const mk of m.markets || []) {
    if (!mk.isBoost) continue;
    const h = hold(mk.picks);
    if (h !== null) boosts.push({ h: h * 100, m: m.home + ' - ' + m.away, mk: mk.name });
  }
  if (!boosts.length) {
    console.log('Ebben a snapshotban nincs boostolt piac.');
  } else {
    console.log(`boostolt piac: ${boosts.length}   atlag hold ${mean(boosts.map(x => x.h)).toFixed(2)}%`);
    for (const b of boosts) console.log(`  ${b.h.toFixed(2)}%  ${b.m}  (${b.mk})`);
    const withB = targetTableQuiet(true), noB = targetTableQuiet(false);
    if (withB[2.0] && noB[2.0]) {
      console.log('');
      console.log(`@2.00 legolcsobb kombinacio boosttal ${withB[2.0].toFixed(2)}%, nelkule ${noB[2.0].toFixed(2)}%` +
                  `  -> a boost ${(noB[2.0] - withB[2.0]).toFixed(2)}pp-t er`);
    }
  }
}

// ugyanaz mint a targetTable, de csak a minimumot adja vissza, kiiras nelkul
function targetTableQuiet(withBoost) {
  const byMatch = snap.matches.map(m => ({ m, L: legsOf(m, { withBoost }) })).filter(x => x.L.length);
  const out = {};
  for (const T of [2.0]) {
    const lo = T * 0.98, hi = T * 1.02;
    let best = null;
    for (let i = 0; i < byMatch.length; i++) for (let j = i + 1; j < byMatch.length; j++) {
      for (const a of byMatch[i].L) for (const b of byMatch[j].L) {
        const mult = a.o * b.o;
        if (mult < lo || mult > hi) continue;
        const h = 1 - (1 - a.h) * (1 - b.h);
        if (best === null || h < best) best = h;
      }
    }
    if (best !== null) out[T] = best * 100;
  }
  return out;
}
