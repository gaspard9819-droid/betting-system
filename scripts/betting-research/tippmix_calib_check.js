// A 2026-09-13-i kalibracio ellenorzese, mielott barmi valtozna a kodban.
//
// Az elso futas meglepo eredmenyt adott: a Tippmixpro overroundja 4.4%, a
// football-data fixtures.csv piaci atlagae 7.2%. Ha ez igaz, a Tippmixpro
// JOBB a piaci atlagnal, es a tippmixRatio() alapfeltevese ("a monopol konyv
// vag a piachoz kepest") forditva all.
//
// Harom dolgot kell kizarni, mielott ezt elhisszuk:
//   A) Az AvgH/D/A a fixtures.csv-ben NYITO ar (a meccs elott napokkal), a
//      szezon-CSV AvgC* pedig ZARO. Nyito arak jellemzoen szelesebbek.
//      Ha igen, a mert arany nem a Tippmixpro josaga, hanem idozitesi kulonbseg.
//   B) Kevesebb konyv szerepel a fixtures atlagaban, mint a zaro atlagban.
//   C) A parositott 28 meccs nem reprezentativ (kis liga, szelsoseges arak).
//
// Futtatas: cd data && node ../tippmix_calib_check.js
const fs = require('fs');
const path = require('path');
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const f1 = x => (x * 100).toFixed(2);

// ---------- A) nyito vs zaro overround ugyanazon a forrason ----------
// A szezon-CSV-kben egyutt van a NYITO (Avg*) es a ZARO (AvgC*) atlag.
// Ha a nyito szisztematikusan szelesebb, az megmagyarazza a 7.2%-ot.
console.log('A) NYITO vs ZARO PIACI ATLAG OVERROUND (szezon-CSV, ugyanaz a forras)');
const seasons = ['2223', '2324', '2425', '2526', '2627'];
const leagues = ['E0', 'SP1', 'D1', 'I1', 'F1'];
const rows = [];
for (const s of seasons) for (const lg of leagues) {
  const fp = `${lg}_${s}.csv`;
  if (!fs.existsSync(fp)) continue;
  const L = fs.readFileSync(fp, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(x => x.trim());
  const head = L[0].split(',').map(h => h.trim()); const c = {};
  head.forEach((h, i) => { if (c[h] === undefined) c[h] = i; });
  for (let i = 1; i < L.length; i++) {
    const f = L[i].split(',');
    const g = n => { if (c[n] === undefined) return null; const v = Number(f[c[n]]); return Number.isFinite(v) && v > 1 ? v : null; };
    const o = [g('AvgH'), g('AvgD'), g('AvgA')], cl = [g('AvgCH'), g('AvgCD'), g('AvgCA')];
    const oou = [g('Avg>2.5'), g('Avg<2.5')], clou = [g('AvgC>2.5'), g('AvgC<2.5')];
    if (o.every(Boolean) && cl.every(Boolean))
      rows.push({ lg, s, open: o.reduce((a, x) => a + 1 / x, 0), close: cl.reduce((a, x) => a + 1 / x, 0),
        openOU: oou.every(Boolean) ? oou.reduce((a, x) => a + 1 / x, 0) : null,
        closeOU: clou.every(Boolean) ? clou.reduce((a, x) => a + 1 / x, 0) : null });
  }
}
console.log(`   n=${rows.length} meccs`);
console.log(`   1X2  nyito overround ${f1(mean(rows.map(r => r.open)) - 1)}%   zaro ${f1(mean(rows.map(r => r.close)) - 1)}%   kulonbseg ${f1(mean(rows.map(r => r.open - r.close)))}pp`);
const ouRows = rows.filter(r => r.openOU && r.closeOU);
console.log(`   O/U  nyito overround ${f1(mean(ouRows.map(r => r.openOU)) - 1)}%   zaro ${f1(mean(ouRows.map(r => r.closeOU)) - 1)}%   kulonbseg ${f1(mean(ouRows.map(r => r.openOU - r.closeOU)))}pp`);
console.log('   -> Ha a nyito overround ~7%, a fixtures.csv 7.2%-a NORMALIS,');
console.log('      es a Tippmixpro 4.4%-a valoban szukebb, nem meresi hiba.\n');

// ---------- B) hany konyv all az atlag mogott ----------
console.log('B) HANY KONYV SZEREPEL AZ ATLAGBAN?');
const fxHead = fs.readFileSync(path.join('fresh', 'fixtures.csv'), 'utf8').replace(/^﻿/, '').split(/\r?\n/)[0].split(',').map(h => h.trim());
const bookCols = fxHead.filter(h => /^[A-Z0-9]+H$/.test(h) && !['MaxH', 'AvgH'].includes(h));
console.log(`   fixtures.csv konyv-oszlopok (1X2): ${bookCols.join(', ')}  -> ${bookCols.length} konyv`);
const e0Head = fs.readFileSync('E0_2526.csv', 'utf8').replace(/^﻿/, '').split(/\r?\n/)[0].split(',').map(h => h.trim());
const closeCols = e0Head.filter(h => /^[A-Z0-9]+CH$/.test(h) && !['MaxCH', 'AvgCH'].includes(h));
console.log(`   szezon-CSV zaro konyv-oszlopok: ${closeCols.join(', ')}  -> ${closeCols.length} konyv`);
console.log('   -> Kulonbozo konyv-halmaz onmagaban is eltolhatja az atlagot.\n');

// ---------- C) reprezentativitas ----------
console.log('C) A PAROSITOTT 28 MECCS REPREZENTATIV-E?');
const pts = JSON.parse(fs.readFileSync(path.join('tippmix', 'calibration_points_2026-09-13.json'), 'utf8'));
const byDiv = {};
for (const p of pts) (byDiv[p.div] = byDiv[p.div] || []).push(p);
console.log('   liga     pont   atlag arany   a slate ligaja?');
const SLATE = ['E0', 'SP1', 'D1', 'I1', 'F1'];
for (const [d, s] of Object.entries(byDiv).sort((a, b) => b[1].length - a[1].length))
  console.log(`   ${d.padEnd(8)} ${String(s.length).padStart(4)}     ${f1(mean(s.map(x => x.ratio)))}%        ${SLATE.includes(d) ? 'IGEN' : 'nem'}`);
const inSlate = pts.filter(p => SLATE.includes(p.div));
console.log(`\n   A slate 5 ligajaban: ${inSlate.length} pont, atlag arany ${f1(mean(inSlate.map(x => x.ratio)))}%`);
console.log(`   Minden ligaban:      ${pts.length} pont, atlag arany ${f1(mean(pts.map(x => x.ratio)))}%`);

// ---------- D) a dontő kerdes ----------
// A slate a The Odds API 'eu' regio atlagat hasznalja, NEM a football-data
// atlagat. A ketto nem ugyanaz. Az elozo, 20 pontos kalibracio a SLATE altal
// rogzitett market_avg_odds ellen kesuzlt - ez a mostani a football-data ellen.
// Ket kulonbozo referencia, ezert a ket eredmeny nem osszemerheto kozvetlenul.
console.log('\nD) FIGYELEM: KET KULONBOZO REFERENCIA');
console.log('   A regi 20 pontos kalibracio a SLATE market_avg_odds mezoje ellen keszult,');
console.log('   ami a The Odds API "eu" regio konyveinek atlaga, a meccs elott <=96 oraval.');
console.log('   Ez a mostani a football-data fixtures.csv AvgH/D/A ellen keszult.');
console.log('   A ketto MAS konyv-halmaz es MAS idopont -> az aranyok nem cserelhetok fel.');
console.log('   A tippmixRatio() a slate market_avg_odds-ara van alkalmazva, tehat a');
console.log('   slate sajat referenciaja ellen kell kalibralni, nem a football-data ellen.');

// Mekkora a kulonbseg a ket referencia kozott? A 2026-09-08-i slate-pillanatkep
// es az akkori szezon-CSV zaro atlagok osszevetese megmutatja.
console.log('\n   MEKKORA A KULONBSEG? (slate market_avg_odds vs football-data zaro atlag,');
console.log('   a 2026-09-08-i pillanatkep 29 meccsen)');
const snap = JSON.parse(fs.readFileSync(path.join('..', 'snapshots', 'bet_slate_2026-09-08T16-10Z.json'), 'utf8'));
const slateRows = Array.isArray(snap) ? snap : (snap.data || snap.rows || []);
// football-data zaro atlagok a 2627-es szezonbol, meccsnev szerint
const fdOdds = {};
for (const lg of leagues) {
  const fp = `${lg}_2627.csv`;
  if (!fs.existsSync(fp)) continue;
  const L = fs.readFileSync(fp, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(x => x.trim());
  const head = L[0].split(',').map(h => h.trim()); const c = {};
  head.forEach((h, i) => { if (c[h] === undefined) c[h] = i; });
  for (let i = 1; i < L.length; i++) {
    const f = L[i].split(',');
    const g = n => { if (c[n] === undefined) return null; const v = Number(f[c[n]]); return Number.isFinite(v) && v > 1 ? v : null; };
    const h = (f[c['HomeTeam']] || '').trim(), a = (f[c['AwayTeam']] || '').trim();
    if (!h || !a) continue;
    fdOdds[h + '|' + a] = { h2h: [g('AvgCH'), g('AvgCD'), g('AvgCA')], ou: [g('AvgC>2.5'), g('AvgC<2.5')] };
  }
}
// A slate nevei mas alakuak; a leg_id-bol nem jon ki a football-data nev.
// Egyszeru normalizalt parositas.
const nrm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]/g, '');
const fdByNorm = {};
for (const k of Object.keys(fdOdds)) { const [h, a] = k.split('|'); fdByNorm[nrm(h) + '|' + nrm(a)] = fdOdds[k]; }
const cmp = [];
for (const r of slateRows) {
  const [hm, am] = String(r.match_name).split(' vs ');
  if (!hm || !am) continue;
  // lazan: az elso 6 karakter egyezese
  const cand = Object.keys(fdByNorm).find(k => {
    const [a, b] = k.split('|');
    return nrm(hm).startsWith(a.slice(0, 6)) && nrm(am).startsWith(b.slice(0, 6));
  });
  if (!cand) continue;
  const fd = fdByNorm[cand];
  const idx = r.market === 'h2h' ? { home: 0, draw: 1, away: 2 }[r.selection] : { over25: 0, under25: 1 }[r.selection];
  const arr = r.market === 'h2h' ? fd.h2h : fd.ou;
  if (idx === undefined || !arr || !arr[idx]) continue;
  cmp.push({ market: r.market, slate: r.market_avg_odds, fd: arr[idx], ratio: r.market_avg_odds / arr[idx] });
}
if (cmp.length) {
  console.log(`   n=${cmp.length} kimenetel`);
  for (const mk of ['h2h', 'totals']) {
    const s = cmp.filter(x => x.market === mk);
    if (s.length) console.log(`     ${mk.padEnd(7)} n=${String(s.length).padStart(3)}  slate/football-data ${f1(mean(s.map(x => x.ratio)))}%  (slate atlag ${mean(s.map(x => x.slate)).toFixed(2)}, fd atlag ${mean(s.map(x => x.fd)).toFixed(2)})`);
  }
} else {
  console.log('   Nem sikerult parositani - a kerdes nyitva marad.');
}
