// WF2 / Node: "Model Probabilities" — Poisson gólmátrix + Dixon-Coles korrekció.
//
// A naiv Poisson feltételezi, hogy a két csapat gólszáma független. Ez alacsony
// gólszámnál nem igaz: a 0-0 és 1-1 gyakoribb a valóságban, mint amit a Poisson
// jósol. A Dixon-Coles tau korrekció ezt a négy cellát (0-0,0-1,1-0,1-1) igazítja.

const MAX_GOALS = 10;
const RHO = -0.13;  // Dixon-Coles korrelációs paraméter, tipikus focira

function poissonPmf(k, lambda) {
  // exp/log alakban, hogy nagy k-nál se szálljon el a faktoriális
  let logF = 0;
  for (let i = 2; i <= k; i++) logF += Math.log(i);
  return Math.exp(-lambda + k * Math.log(lambda) - logF);
}

function tau(hg, ag, lh, la, rho) {
  if (hg === 0 && ag === 0) return 1 - lh * la * rho;
  if (hg === 0 && ag === 1) return 1 + lh * rho;
  if (hg === 1 && ag === 0) return 1 + la * rho;
  if (hg === 1 && ag === 1) return 1 - rho;
  return 1;
}

function predictMatch(homeRating, awayRating, leagueAvg, homeAdv) {
  // Várható gólok. A hazai előny a hazai oldalra kerül vissza.
  const lh = homeRating.attack * awayRating.defence * leagueAvg * homeAdv;
  const la = awayRating.attack * homeRating.defence * leagueAvg;

  // Gólmátrix Dixon-Coles korrekcióval
  const grid = [];
  let total = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    grid[h] = [];
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = poissonPmf(h, lh) * poissonPmf(a, la) * tau(h, a, lh, la, RHO);
      grid[h][a] = Math.max(0, p);   // a tau elvileg negatívba vihet
      total += grid[h][a];
    }
  }
  // Normalizálás: a levágott farok és a tau miatt az összeg nem pontosan 1
  for (let h = 0; h <= MAX_GOALS; h++)
    for (let a = 0; a <= MAX_GOALS; a++) grid[h][a] /= total;

  let home = 0, draw = 0, away = 0, over25 = 0, btts = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = grid[h][a];
      if (h > a) home += p; else if (h === a) draw += p; else away += p;
      if (h + a > 2.5) over25 += p;
      if (h > 0 && a > 0) btts += p;
    }
  }

  return {
    lambda_home: Math.round(lh * 10000) / 10000,
    lambda_away: Math.round(la * 10000) / 10000,
    home, draw, away,
    over25, under25: 1 - over25,
    btts,
  };
}

module.exports = { predictMatch, poissonPmf };

// ---- lokális teszt ----
if (require.main === module) {
  const fs = require('fs');
  const { parseCsv } = require('./parse.js');
  const { computeRatings } = require('./ratings.js');

  let all = [];
  for (const s of ['2526', '2627'])
    for (const l of ['E0', 'D1', 'SP1', 'I1', 'F1'])
      all = all.concat(parseCsv(fs.readFileSync(`${l}_${s}.csv`, 'utf8'), l, s));

  const ratings = computeRatings(all, '2026-09-01T00:00:00Z');
  const R = {};
  ratings.forEach(r => { R[r.league + '|' + r.team] = r; });

  // 1) Poisson pmf ellenorzes: osszegnek 1-nek kell lennie
  let s = 0; for (let k = 0; k <= 30; k++) s += poissonPmf(k, 1.5);
  console.log(`Poisson pmf osszeg (lambda=1.5, k=0..30): ${s.toFixed(8)}  ${Math.abs(s-1)<1e-6?'OK':'HIBA'}`);

  // 2) Konkret meccsek
  const tests = [
    ['E0', 'Man City', 'Ipswich'],
    ['E0', 'Arsenal', 'Liverpool'],
    ['SP1', 'Barcelona', 'Real Madrid'],
    ['E0', 'Ipswich', 'Man City'],
  ];
  console.log();
  for (const [lg, h, a] of tests) {
    const hr = R[lg + '|' + h], ar = R[lg + '|' + a];
    if (!hr || !ar) { console.log(`HIANYZO: ${h} vagy ${a}`); continue; }
    const p = predictMatch(hr, ar, hr.league_avg_goals, hr.home_advantage);
    const sum = p.home + p.draw + p.away;
    console.log(`${h} vs ${a} (${lg})`);
    console.log(`  lambda: ${p.lambda_home} - ${p.lambda_away}`);
    console.log(`  1X2: ${(p.home*100).toFixed(1)}% / ${(p.draw*100).toFixed(1)}% / ${(p.away*100).toFixed(1)}%  osszeg=${sum.toFixed(6)} ${Math.abs(sum-1)<1e-6?'OK':'HIBA'}`);
    console.log(`  Over2.5: ${(p.over25*100).toFixed(1)}%  BTTS: ${(p.btts*100).toFixed(1)}%`);
    console.log(`  fair odds: ${(1/p.home).toFixed(2)} / ${(1/p.draw).toFixed(2)} / ${(1/p.away).toFixed(2)}`);
    console.log();
  }
}
