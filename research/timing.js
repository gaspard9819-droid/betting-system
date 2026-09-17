// KERDES (2026-09-13): erdemes-e a meccs kezdesetol TAVOLABB megrakni a szelvenyt?
//
// A composition_sensitivity.js mar merte a nyito vs zaro arat VAK fogadason,
// 1X2-n. Ez a szkript harom dologgal megy tovabb, mert a kerdes a rendszer
// tenyleges hasznalatarol szol:
//   A) az O/U 2.5 piacra is (a mai szelveny ket labja Over 2.5 volt)
//   B) a rendszer altal KIVALASZTOTT labakra, nem vak fogadasra
//   C) kulon a favoritokra es az eselytelenekre, mert a nyito-zaro elmozdulas
//      iranya oddsfuggo
//
// MIT JELENT "NYITO" ES "ZARO" ITT: a football-data.co.uk Avg* oszlopa a
// gyujtes pillanataban ervenyes atlag (jellemzoen penteken, a hetvegi
// fordulo elott), az AvgC* a meccs kezdete elotti utolso. A ketto kozott
// tipikusan 1-3 nap telik el. A slate 96 orara elore dolgozik, tehat a
// "korai" eset kb. a nyito arnak felel meg.
//
// FONTOS KORLAT: ez NEM a Tippmixpro arait meri, hanem a piaci atlagot. A
// Tippmixpro sajat idozitesi viselkedese ismeretlen - lehet, hogy lassabban
// mozog, mint a piac. Amit ez a szkript megmond: mozdul-e a PIAC olyan
// iranyba, hogy a korai fogadas rendszeresen jobb vagy rosszabb aron kot.
//
// Futtatas: cd data && node ../timing.js
const { loadAll, devig, mean, roi, roiSe, TIPPMIX } = require('./odds_loader.js');
const all = loadAll();
const f2 = x => (Number.isFinite(x) ? x.toFixed(2) : '  -  ').padStart(7);

// --- 1X2: van nyito (avg) es zaro (avgc) is ---
const h2h = all.filter(m => m.avg && m.avgc);
// --- O/U 2.5: ou_avg (nyito) es ou_avgc (zaro) ---
const ou = all.filter(m => m.ou_avg && m.ou_avgc);
console.log(`Meccsek: 1X2 nyito+zaro ${h2h.length}, O/U nyito+zaro ${ou.length}\n`);

console.log('1) MENNYIT MOZDUL AZ AR A KET IDOPONT KOZOTT?');
console.log('   piac   sav          n      atlag |elmozdulas|   a nyito volt a JOBB ar');
for (const [nm, rows, oKey, cKey, n] of [['1X2', h2h, 'avg', 'avgc', 3], ['O/U', ou, 'ou_avg', 'ou_avgc', 2]]) {
  for (const [lo, hi] of [[1.0, 1.6], [1.6, 2.2], [2.2, 3.2], [3.2, 6.0], [6.0, 100]]) {
    const s = [];
    for (const m of rows) for (let k = 0; k < n; k++) {
      const e = m[oKey][k], c = m[cKey][k];
      if (c >= lo && c < hi) s.push({ e, c, better: e > c });
    }
    if (s.length < 100) continue;
    console.log(`   ${nm.padEnd(6)} ${(lo + '-' + (hi > 90 ? '' : hi)).padEnd(12)} ${String(s.length).padStart(5)}       ${(mean(s.map(x => Math.abs(x.e / x.c - 1))) * 100).toFixed(2)}%              ${(s.filter(x => x.better).length / s.length * 100).toFixed(1)}%`);
  }
}

console.log('\n2) UGYANAZ A LAB, KET IDOPONTBAN - realizalt ROI (vak fogadas, tippmix aron)');
console.log('   piac   sav          n      ROI korai    ROI keso    kulonbseg');
for (const [nm, rows, oKey, cKey, n, mk] of [['1X2', h2h, 'avg', 'avgc', 3, 'h2h'], ['O/U', ou, 'ou_avg', 'ou_avgc', 2, 'totals']]) {
  for (const [lo, hi] of [[1.0, 1.6], [1.6, 2.2], [2.2, 3.2], [3.2, 6.0]]) {
    const s = [];
    for (const m of rows) for (let k = 0; k < n; k++) {
      const e = m[oKey][k], c = m[cKey][k];
      if (c < lo || c >= hi) continue;
      const win = mk === 'h2h' ? m.res === k : m.over === k;
      s.push({ early: TIPPMIX(e), late: TIPPMIX(c), win });
    }
    if (s.length < 100) continue;
    const re = roi(s.map(x => ({ win: x.win, odds: x.early })));
    const rl = roi(s.map(x => ({ win: x.win, odds: x.late })));
    const se = roiSe(s.map(x => ({ win: x.win, odds: x.early })));
    console.log(`   ${nm.padEnd(6)} ${(lo + '-' + hi).padEnd(12)} ${String(s.length).padStart(5)}   ${f2(re)}%   ${f2(rl)}%     ${(re - rl >= 0 ? '+' : '') + (re - rl).toFixed(2)}pp  (±${se.toFixed(1)})`);
  }
}

console.log('\n3) A RENDSZER ALTAL VALASZTOTT LABAKON');
console.log('   A szelvenyepito a PIACI valoszinuseg szerint rangsorol, es a magas');
console.log('   valoszinusegu (rovid oddsu) labakat reszesiti elonyben. Ezert kulon');
console.log('   merjuk azt a savot, amit tenylegesen valaszt: 1.3-2.5 tippmix odds.');
const picked = [];
for (const m of h2h) {
  const f = devig(m.avgc).probs;
  for (let k = 0; k < 3; k++) {
    const late = TIPPMIX(m.avgc[k]);
    if (late < 1.3 || late > 2.5) continue;
    picked.push({ early: TIPPMIX(m.avg[k]), late, win: m.res === k, p: f[k], mk: '1X2' });
  }
}
for (const m of ou) {
  const f = devig(m.ou_avgc).probs;
  for (let k = 0; k < 2; k++) {
    const late = TIPPMIX(m.ou_avgc[k]);
    if (late < 1.3 || late > 2.5) continue;
    picked.push({ early: TIPPMIX(m.ou_avg[k]), late, win: m.over === k, p: f[k], mk: 'O/U' });
  }
}
for (const mk of ['1X2', 'O/U', 'mind']) {
  const s = mk === 'mind' ? picked : picked.filter(x => x.mk === mk);
  const re = roi(s.map(x => ({ win: x.win, odds: x.early })));
  const rl = roi(s.map(x => ({ win: x.win, odds: x.late })));
  const seD = roiSe(s.map(x => ({ win: x.win, odds: x.early })));
  console.log(`   ${mk.padEnd(6)} n=${String(s.length).padStart(5)}   ROI korai ${f2(re)}%   ROI keso ${f2(rl)}%   kulonbseg ${(re - rl >= 0 ? '+' : '') + (re - rl).toFixed(2)}pp   (±${seD.toFixed(1)})`);
}

console.log('\n4) SZELVENYRE VETITVE: 2 lab, mindketto korai vagy mindketto keso');
console.log('   Egy 2 labas szelvenyen a lab-szintu kulonbseg KETSZER szamit.');
const both = picked.filter(x => x.mk === '1X2' || x.mk === 'O/U');
const reAll = roi(both.map(x => ({ win: x.win, odds: x.early })));
const rlAll = roi(both.map(x => ({ win: x.win, odds: x.late })));
const gap = reAll - rlAll;
console.log(`   lab-szintu kulonbseg: ${gap >= 0 ? '+' : ''}${gap.toFixed(2)}pp`);
console.log(`   2 labas szelvenyen kb.: ${gap >= 0 ? '+' : ''}${(gap * 2).toFixed(2)}pp`);
console.log(`   3 labas szelvenyen kb.: ${gap >= 0 ? '+' : ''}${(gap * 3).toFixed(2)}pp`);
console.log('   (kozelites: a szorzodas miatt nem pontosan linearis, de a nagysagrend ez)');

console.log('\n5) A DONTO KERDES: SZIGNIFIKANS-E?');
const diffs = both.map(x => (x.win ? x.early - 1 : -1) - (x.win ? x.late - 1 : -1));
const md = mean(diffs);
const sd = Math.sqrt(diffs.reduce((s, d) => s + (d - md) ** 2, 0) / (diffs.length - 1));
const seM = sd / Math.sqrt(diffs.length);
const t = md / seM;
console.log(`   parositott kulonbseg (ugyanaz a lab, ket aron): ${(md * 100).toFixed(3)}pp`);
console.log(`   standard hiba: ${(seM * 100).toFixed(3)}pp   t = ${t.toFixed(2)}   n = ${diffs.length}`);
console.log(`   ${Math.abs(t) > 1.96 ? 'SZIGNIFIKANS (|t| > 1.96)' : 'NEM szignifikans (|t| < 1.96)'}`);
console.log('   Megjegyzes: ez parositott teszt - ugyanaz a lab, ugyanaz a kimenetel,');
console.log('   csak az ar mas. Ezert sokkal erzekenyebb, mint ket kulon ROI osszevetese.');

// ---- 6) A MECHANIZMUS: miert nyer a korai fogadas? ----
// Nem altalanos "korai jobb" szabaly van, hanem ODDSFUGGO elmozdulas.
console.log('\n6) AZ ELMOZDULAS IRANYA ODDS SZERINT (zaro / nyito)');
console.log('   <100% = a zaro ar rosszabb, tehat KORAI a jobb');
console.log('   >100% = a zaro ar jobb, tehat KESO a jobb');
console.log('   piac  sav          n      zaro/nyito');
for (const [nm, ok, ck, n] of [['1X2', 'avg', 'avgc', 3], ['O/U', 'ou_avg', 'ou_avgc', 2]]) {
  const rows = all.filter(m => m[ok] && m[ck]);
  for (const [lo, hi] of [[1.0, 1.4], [1.4, 1.8], [1.8, 2.2], [2.2, 3.0], [3.0, 5.0], [5.0, 100]]) {
    const s = [];
    for (const m of rows) for (let k = 0; k < n; k++) { const c = m[ck][k]; if (c >= lo && c < hi) s.push(c / m[ok][k]); }
    if (s.length < 200) continue;
    const r = mean(s);
    console.log(`   ${nm.padEnd(5)} ${(lo + '-' + (hi > 90 ? '' : hi)).padEnd(12)} ${String(s.length).padStart(5)}     ${(r * 100).toFixed(2)}%   ${r < 0.999 ? 'korai jobb' : r > 1.001 ? 'keso jobb' : 'nincs elmozdulas'}`);
  }
}
console.log('\n   A rovid oddsu labak ara a kezdesig ROMLIK (a penz a favoritra megy),');
console.log('   a hosszuake JAVUL. A szelvenyepito rovid labakat valaszt, ezert');
console.log('   nyer nala a korai fogadas. Ez NEM altalanos szabaly - aki hosszu');
console.log('   labra fogad, annak a keso a jobb.');
