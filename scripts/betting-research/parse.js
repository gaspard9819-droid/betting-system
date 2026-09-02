// WF1 / Node: "Parse CSV" — ez a kód megy majd az n8n Code node-ba.
// Lokális teszthez a végén van egy runner, azt az n8n-verzióból kivesszük.

function parseCsv(raw, league, season) {
  // BOM levágása — a football-data.co.uk fájlok UTF-8 BOM-mal kezdődnek,
  // enélkül az első oszlopnév "﻿Div" lenne és a lookup elhasalna.
  const text = raw.replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];

  // Fejlécnév -> index. Kötelező, mert az oszlopsorrend szezononként eltér:
  // a 2627-es fájlban HxG/AxG beékelődik a Referee és a HS közé.
  const head = lines[0].split(',').map(h => h.trim());
  const col = {};
  head.forEach((h, i) => { if (col[h] === undefined) col[h] = i; });

  const need = ['Date', 'HomeTeam', 'AwayTeam', 'FTHG', 'FTAG'];
  for (const n of need) {
    if (col[n] === undefined) {
      throw new Error(`Hiányzó oszlop "${n}" a ${league} ${season} fájlban`);
    }
  }
  const hasXg = col['HxG'] !== undefined && col['AxG'] !== undefined;

  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(',');
    const home = (f[col['HomeTeam']] || '').trim();
    const away = (f[col['AwayTeam']] || '').trim();
    const fthg = f[col['FTHG']];
    const ftag = f[col['FTAG']];

    // Le nem játszott vagy csonka sor — a szezon végén gyakori üres sorok.
    if (!home || !away || fthg === undefined || fthg === '' || ftag === '') continue;

    const hg = Number(fthg), ag = Number(ftag);
    if (!Number.isFinite(hg) || !Number.isFinite(ag)) continue;

    // dd/mm/yyyy vagy dd/mm/yy — NEM ISO. new Date() ezt hó/nap-ként
    // értelmezné félre, ezért kézzel bontjuk.
    const dRaw = (f[col['Date']] || '').trim();
    const m = dRaw.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
    if (!m) continue;
    const yr = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const date = new Date(Date.UTC(yr, Number(m[2]) - 1, Number(m[1])));
    if (isNaN(date.getTime())) continue;

    const row = {
      league, season, date: date.toISOString(),
      home, away, hg, ag,
      hxg: null, axg: null,
    };

    if (hasXg) {
      const hx = Number(f[col['HxG']]), ax = Number(f[col['AxG']]);
      if (Number.isFinite(hx) && Number.isFinite(ax)) { row.hxg = hx; row.axg = ax; }
    }
    out.push(row);
  }
  return out;
}

module.exports = { parseCsv };

// ---- lokális teszt ----
if (require.main === module) {
  const fs = require('fs');
  let total = 0, withXg = 0;
  for (const s of ['2526', '2627']) {
    for (const l of ['E0', 'D1', 'SP1', 'I1', 'F1']) {
      const raw = fs.readFileSync(`${l}_${s}.csv`, 'utf8');
      const rows = parseCsv(raw, l, s);
      const xg = rows.filter(r => r.hxg !== null).length;
      total += rows.length; withXg += xg;
      console.log(`${l} ${s}: ${rows.length} meccs, xG: ${xg}, elso: ${rows[0] ? rows[0].date.slice(0,10) : '-'}, utolso: ${rows.length ? rows[rows.length-1].date.slice(0,10) : '-'}`);
    }
  }
  console.log(`\nOSSZESEN: ${total} meccs, ebbol xG-vel: ${withXg}`);
}
