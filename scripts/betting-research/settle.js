// A "Settle Legs" node logikaja. Egy leg kimenetelenek eldontese a
// football-data.co.uk vegeredmenyebol (FTHG/FTAG).
//
// MIERT KULON FAJL: ugyanaz az elv, mint a slip.js-nel - a logika lokalisan
// tesztelve lesz valos CSV-n es valos slate snapshoton, mielott n8n node-ba
// kerul. A csapatnev-parositas itt a kockazatos resz: az Odds API nevei
// (match_name) es a CSV nevei kulonboznek, es egy elnezett parositas
// CSENDBEN allitana rosszul a nyeresi aranyt.

// ---------- csapatnev normalizalas ----------
// A tabla es a norm() a teams.js-bol jon, ami SZO SZERINT a "Generate Legs"
// node ALIAS tablaja. Nem masoljuk ide ujra: az elso valtozat kezi kopiaja
// 67 bejegyzest tartalmazott a 122 helyett, es az Espanyol (a CSV-ben
// "Espanol") emiatt parositatlan maradt - 5 leg csendben kiesett volna.
const { ALIAS, norm } = require('./teams.js');

// A slate match_name-je "Hazai vs Vendeg". A ' vs ' a Generate Legs-ben
// kepzodik, tehat fix - de vedunk ellene, hogy ne allitsunk rosszat.
function splitMatchName(matchName) {
  const parts = String(matchName).split(' vs ');
  if (parts.length !== 2) return null;
  const home = parts[0].trim(), away = parts[1].trim();
  if (!home || !away) return null;
  return { home, away };
}

// Egy slate-nev parositasa a CSV-ben szereplo nevek listajahoz.
// Ugyanaz a 4 lepcso, mint a findTeam()-ben: direkt, alias, normalizalt,
// majd reszstring >= 4 karakteren.
function matchTeamName(slateName, csvNames) {
  if (csvNames.has(slateName)) return slateName;
  const n = norm(slateName);
  const aliased = ALIAS[n];
  if (aliased && csvNames.has(aliased)) return aliased;
  for (const c of csvNames) if (norm(c) === n) return c;
  for (const c of csvNames) {
    const nc = norm(c);
    if (nc.length >= 4 && (n.includes(nc) || nc.includes(n))) return c;
  }
  return null;
}

// ---------- kimenetel ----------
// Egyetlen hely, ahol egy piac/kimenetel -> nyert/vesztett dol el.
// Uj piac hozzaadasakor IDE kell irni, kulonben null-t ad (= nyitva marad,
// nem pedig tevedesbol vesztett).
function legOutcome(market, selection, hg, ag) {
  if (!Number.isFinite(hg) || !Number.isFinite(ag)) return null;
  if (market === 'h2h') {
    if (selection === 'home') return hg > ag;
    if (selection === 'draw') return hg === ag;
    if (selection === 'away') return ag > hg;
    return null;
  }
  if (market === 'totals') {
    // A slate csak a 2.5-os vonalat tartja meg (Generate Legs szuri),
    // igy nincs push: 2.5 nem lehet pontos golszam.
    if (selection === 'over25') return hg + ag > 2.5;
    if (selection === 'under25') return hg + ag < 2.5;
    return null;
  }
  if (market === 'btts') {
    if (selection === 'btts_yes') return hg > 0 && ag > 0;
    if (selection === 'btts_no') return !(hg > 0 && ag > 0);
    return null;
  }
  return null;
}

// ---------- CSV -> eredmeny index ----------
// A kulcsot egy helyen kepezzuk: az indexeles es a kereses kulonbozo
// kulcsformaja csendes "result_not_published"-ot adna minden legre.
const resultKey = (league, home, away) => league + '|' + home + '|' + away;

// Csak a vegeredmeny kell, es CSAK a lejatszott meccsek. Egy jovobeli sor
// ures FTHG-vel nem szabad, hogy 0-0-kent szamoljon.
function indexResults(raw, league) {
  const text = String(raw).replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return { byKey: {}, names: new Set() };
  const head = lines[0].split(',').map(h => h.trim());
  const col = {};
  head.forEach((h, i) => { if (col[h] === undefined) col[h] = i; });
  for (const n of ['Date', 'HomeTeam', 'AwayTeam', 'FTHG', 'FTAG']) {
    if (col[n] === undefined) return { byKey: {}, names: new Set() };
  }
  const byKey = {}, names = new Set();
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(',');
    const home = (f[col['HomeTeam']] || '').trim();
    const away = (f[col['AwayTeam']] || '').trim();
    if (!home || !away) continue;
    // A nevek a MEG NEM jatszott sorokbol is kellenek: kulonben egy
    // parositatlan csapat "unresolvable" lenne "result_not_published"
    // helyett, es hibanak latszana, ami csak varakozas.
    names.add(home); names.add(away);
    const fthg = f[col['FTHG']], ftag = f[col['FTAG']];
    if (fthg === undefined || fthg === '' || ftag === undefined || ftag === '') continue;
    const hg = Number(fthg), ag = Number(ftag);
    if (!Number.isFinite(hg) || !Number.isFinite(ag)) continue;
    // dd/mm/yyyy - NEM ISO, kezzel bontjuk (ugyanaz, mint a parse.js-ben)
    const m = (f[col['Date']] || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
    if (!m) continue;
    const yr = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const date = new Date(Date.UTC(yr, Number(m[2]) - 1, Number(m[1])));
    if (isNaN(date.getTime())) continue;
    // A kulcs csapatpar, NEM datum: a CSV datuma a helyi jateknap, a slate
    // kickoff-ja UTC - ezek atlephetik egymast ejfelkor. Egy szezonban egy
    // parositas hazai palyan egyszer jatszik, tehat a par egyedi.
    // A datumot megtartjuk ellenorzesre (lasd date_mismatch).
    byKey[resultKey(league, home, away)] = { hg, ag, date: date.toISOString(), home, away };
  }
  return { byKey, names };
}

// ---------- egy leg elszamolasa ----------
// Harom kimenet: won/lost | still_open | unresolvable.
// A "still_open" es az "unresolvable" kulonvalasztasa szandekos: az elso
// varakozas (a CSV meg nem frissult), a masodik hiba, amit latni akarunk.
function settleLeg(leg, index, opts) {
  const o = opts || {};
  const now = o.now ? new Date(o.now) : new Date();
  const graceHours = o.graceHours !== undefined ? o.graceHours : 3;

  const ko = new Date(leg.kickoff);
  if (isNaN(ko.getTime())) return { status: 'unresolvable', reason: 'bad_kickoff' };
  // A meccs ~2 ora, + tartalek. Elotte nincs mit elszamolni.
  if (now - ko < graceHours * 3600000) return { status: 'still_open', reason: 'not_finished' };

  const idx = index[leg.league];
  if (!idx) return { status: 'still_open', reason: 'no_csv_for_league' };

  const split = splitMatchName(leg.match_name);
  if (!split) return { status: 'unresolvable', reason: 'bad_match_name' };

  const csvHome = matchTeamName(split.home, idx.names);
  const csvAway = matchTeamName(split.away, idx.names);
  if (!csvHome || !csvAway) {
    return { status: 'unresolvable', reason: 'team_unmatched',
             detail: (!csvHome ? split.home : split.away) };
  }

  const res = idx.byKey[resultKey(leg.league, csvHome, csvAway)];
  // Nincs sor = a CSV meg nem tartalmazza a meccset. Ez a NORMALIS eset
  // 1-3 napig, mert a football-data hetente ketszer frissul.
  if (!res) return { status: 'still_open', reason: 'result_not_published' };

  // Egeszsegellenorzes: a CSV jateknapja legyen a kickoff +-2 napon belul.
  // Ha nem, valoszinuleg MASIK szezon ugyanazon parositasat talaltuk el -
  // inkabb ne allitsunk semmit.
  const dayDiff = Math.abs(new Date(res.date) - ko) / 86400000;
  if (dayDiff > 2) {
    return { status: 'unresolvable', reason: 'date_mismatch',
             detail: 'CSV ' + res.date.slice(0, 10) + ' vs kickoff ' + String(leg.kickoff).slice(0, 10) };
  }

  const won = legOutcome(leg.market, leg.selection, res.hg, res.ag);
  if (won === null) {
    return { status: 'unresolvable', reason: 'unknown_market',
             detail: leg.market + '|' + leg.selection };
  }
  return { status: won ? 'won' : 'lost', score: res.hg + '-' + res.ag,
           hg: res.hg, ag: res.ag };
}

// ---------- egy szelveny elszamolasa ----------
// A szelveny akkumulator: EGY vesztes lab az egesz szelvenyt megbuktatja,
// es ezt AZONNAL tudjuk - nem kell megvarni a tobbi labat. Ezert a lost
// eset elobb all, mint a still_open.
function settleSlip(slip, legResults) {
  const r = legResults;
  if (!r.length) return { status: 'open', reason: 'no_legs' };
  if (r.some(x => x.status === 'lost')) {
    return { status: 'lost', payout: 0, profit: -slip.stake };
  }
  // Egy feloldhatatlan lab megallitja az elszamolast: nem allithatjuk
  // nyertesnek a szelvenyt, amig egy labrol nem tudjuk, mi tortent.
  if (r.some(x => x.status === 'unresolvable')) {
    return { status: 'open', reason: 'leg_unresolvable' };
  }
  if (r.some(x => x.status === 'still_open')) {
    return { status: 'open', reason: 'legs_pending' };
  }
  // Minden lab nyert.
  const payout = Math.round(slip.stake * slip.total_odds * 100) / 100;
  return { status: 'won', payout, profit: Math.round((payout - slip.stake) * 100) / 100 };
}

// ---------- osszesito ----------
// Csak a LEZART szelvenyek szamitanak bele. A nyitottakat kulon jelentjuk,
// mert kulonben egy friss szelveny lerontana a nyeresi aranyt.
function summarize(slips) {
  const closed = slips.filter(s => s.status === 'won' || s.status === 'lost');
  const open = slips.filter(s => s.status === 'open');
  const won = closed.filter(s => s.status === 'won');
  const staked = closed.reduce((a, s) => a + s.stake, 0);
  const returned = closed.reduce((a, s) => a + (s.payout || 0), 0);
  return {
    closed: closed.length,
    open: open.length,
    won: won.length,
    lost: closed.length - won.length,
    win_rate: closed.length ? Math.round(won.length / closed.length * 1000) / 10 : null,
    staked: Math.round(staked * 100) / 100,
    returned: Math.round(returned * 100) / 100,
    profit: Math.round((returned - staked) * 100) / 100,
    // ROI a megtett tetre. null nulla teten - nem 0%, mert az azt sugallna,
    // hogy mertunk valamit.
    roi_pct: staked ? Math.round((returned - staked) / staked * 1000) / 10 : null,
  };
}

module.exports = { settleLeg, settleSlip, summarize, legOutcome,
                   indexResults, matchTeamName, splitMatchName, norm, ALIAS };
