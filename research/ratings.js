// WF1 / Node: "Compute Ratings" — Dixon-Coles súlyozott csapaterősségek.
//
// Módszer:
//   - Időbeli súlyozás: exp(-xi * napok), xi=0.0065 -> kb. 107 napos felezés.
//     A tavalyi szezon így számít, de a friss forma dominál.
//   - Hibrid gólmérték: ahol van xG, ott a gól és az xG átlaga (az xG kevésbé
//     zajos, de a valós gól is információ), ahol nincs, ott a nyers gól.
//   - Shrinkage: kevés súlyozott meccsnél az erősség 1.0 felé húzva, hogy egy
//     3 meccses jó rajt ne csináljon szuper-csapatot.

const XI = 0.0065;
const SHRINK_K = 12;   // ennyi súlyozott meccsnél 50% a saját adat súlya
const XG_BLEND = 0.5;  // xG és valós gól keverési aránya, ahol van xG

// Prior, ami felé a shrinkage húz. NEM 1.0 (liga átlag): egy csapat, amiről
// alig van adatunk, jellemzően frissen feljutott újonc, és az újoncok átlag
// alatt teljesítenek. A liga átlagra húzás az Ipswich-et a Premier League
// top 6 támadásába tette 2 meccs alapján — ez fogadási döntést torzítana.
const PRIOR_ATT = 0.92;  // gyengébb támadás
const PRIOR_DEF = 1.08;  // többet kap

function computeRatings(matches, asOf) {
  const now = asOf ? new Date(asOf) : new Date();
  const byLeague = {};
  for (const m of matches) {
    (byLeague[m.league] = byLeague[m.league] || []).push(m);
  }

  const results = [];

  for (const [league, rows] of Object.entries(byLeague)) {
    // 1) súly + effektív gólérték meccsenként
    const enriched = rows.map(m => {
      const days = Math.max(0, (now - new Date(m.date)) / 86400000);
      const w = Math.exp(-XI * days);
      let hVal = m.hg, aVal = m.ag;
      if (m.hxg !== null && m.axg !== null) {
        hVal = XG_BLEND * m.hxg + (1 - XG_BLEND) * m.hg;
        aVal = XG_BLEND * m.axg + (1 - XG_BLEND) * m.ag;
      }
      return { ...m, w, hVal, aVal };
    }).filter(m => m.w > 1e-6);

    if (!enriched.length) continue;

    // 2) liga szintű átlagok (súlyozott)
    let sw = 0, shg = 0, sag = 0;
    for (const m of enriched) { sw += m.w; shg += m.w * m.hVal; sag += m.w * m.aVal; }
    const avgHome = shg / sw;   // átlagos hazai gól
    const avgAway = sag / sw;   // átlagos vendég gól
    const leagueAvg = (avgHome + avgAway) / 2;
    const homeAdv = avgHome / avgAway;   // hazai pálya előny szorzó

    // 3) csapatonkénti súlyozott lőtt/kapott, hazai-vendég normalizálva.
    //    A hazai gólokat elosztjuk a hazai előnnyel, hogy a pályaválasztás
    //    ne keveredjen bele a csapat erősségébe.
    const t = {};
    const get = n => (t[n] = t[n] || { sf: 0, sa: 0, w: 0, games: 0 });

    for (const m of enriched) {
      const H = get(m.home), A = get(m.away);
      // hazai csapat: lőtt = hVal / homeAdv (előny kiszűrve), kapott = aVal
      H.sf += m.w * (m.hVal / homeAdv); H.sa += m.w * m.aVal;
      H.w += m.w; H.games++;
      // vendég csapat: lőtt = aVal, kapott = hVal / homeAdv
      A.sf += m.w * m.aVal; A.sa += m.w * (m.hVal / homeAdv);
      A.w += m.w; A.games++;
    }

    // 4) erősségek + shrinkage
    for (const [team, s] of Object.entries(t)) {
      const rawAtt = (s.sf / s.w) / leagueAvg;
      const rawDef = (s.sa / s.w) / leagueAvg;
      // shrink: kevés súlyozott meccs -> húzás 1.0 felé
      const k = s.w / (s.w + SHRINK_K);
      const attack = k * rawAtt + (1 - k) * PRIOR_ATT;
      const defence = k * rawDef + (1 - k) * PRIOR_DEF;

      results.push({
        team, league,
        attack: Math.round(attack * 10000) / 10000,
        defence: Math.round(defence * 10000) / 10000,
        matches: s.games,
        weighted_matches: Math.round(s.w * 100) / 100,
        league_avg_goals: Math.round(leagueAvg * 10000) / 10000,
        home_advantage: Math.round(homeAdv * 10000) / 10000,
        updated_at: now.toISOString(),
      });
    }
  }
  return results;
}

module.exports = { computeRatings };

// ---- lokális teszt ----
if (require.main === module) {
  const fs = require('fs');
  const { parseCsv } = require('./parse.js');
  let all = [];
  for (const s of ['2526', '2627']) {
    for (const l of ['E0', 'D1', 'SP1', 'I1', 'F1']) {
      all = all.concat(parseCsv(fs.readFileSync(`${l}_${s}.csv`, 'utf8'), l, s));
    }
  }
  const r = computeRatings(all, '2026-09-01T00:00:00Z');
  console.log(`Csapatok osszesen: ${r.length}\n`);

  for (const lg of ['E0', 'SP1']) {
    const sub = r.filter(x => x.league === lg).sort((a, b) => b.attack - a.attack);
    console.log(`=== ${lg} (liga atlag gol: ${sub[0].league_avg_goals}, hazai elony: ${sub[0].home_advantage}) ===`);
    console.log('TOP 6 tamadas:');
    sub.slice(0, 6).forEach(x => console.log(`  ${x.team.padEnd(16)} att=${x.attack.toFixed(3)} def=${x.defence.toFixed(3)} (${x.matches} meccs, sulyozva ${x.weighted_matches})`));
    console.log('LEGJOBB 4 vedelem:');
    [...sub].sort((a,b)=>a.defence-b.defence).slice(0,4).forEach(x => console.log(`  ${x.team.padEnd(16)} def=${x.defence.toFixed(3)}`));
    console.log();
  }

  // Sanity: tartomanyok
  const att = r.map(x=>x.attack), def = r.map(x=>x.defence);
  console.log(`attack tartomany: ${Math.min(...att).toFixed(3)} - ${Math.max(...att).toFixed(3)}`);
  console.log(`defence tartomany: ${Math.min(...def).toFixed(3)} - ${Math.max(...def).toFixed(3)}`);
  const out = r.filter(x => x.attack < 0.3 || x.attack > 2.5 || x.defence < 0.3 || x.defence > 2.5);
  console.log(`tartomanyon kivuli: ${out.length}`);
}
