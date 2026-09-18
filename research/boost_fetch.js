// Tippmixpro "Szuper odds" (odds raketa) lekerese es beirasa a bet_slate-be.
//
// MIERT: a boostolt piacon a margo ~2%, a rendesen 5-6% (meres 2026-09-16,
// 4 meccs / 12 kimenet). A szelvenyepito legnagyobb ellensege a margo, mert
// labankent kompozalodik - ket labon a kulonbseg ~7 szazalekpont megtartott
// ertek. A boostolt ar ezen felul a VALODI Tippmixpro-ar, nem a Generate Legs
// `tippmixRatio()` becslese (2.31% atlagos hibaval), tehat ket dolgot javit
// egyszerre.
//
// MIERT KULON SCRIPT, nem n8n node: az n8n Code node kulon task-runner
// konteneben fut, amiben NINCS `WebSocket` globalis (merve 2026-09-15, egy
// eldobhato szonda-workflow-val: `hasWebSocketGlobal: false`). A feednek nincs
// REST-alternativaja sem - minden HTTP-ut 404/502. Ezert a lekerest csak
// lokalis Node tudja elvegezni, es az eredmenyt a public API-n keresztul irjuk
// vissza a datatable-be.
//
// FUTTATAS (a betting-research mappabol):
//   node boost_fetch.js              # lekeres + kiiras, NEM ir a slate-be
//   node boost_fetch.js --write      # + beirja a bet_slate boost_odds mezojet
//   node boost_fetch.js --min 3      # csak a legalabb 3%-os emeleseket veszi
//
// Kornyezet a --write-hoz: N8N_API_URL es N8N_API_KEY (Windows env valtozok).
//
// A boost piac a feedben: `1X2 - Szuper odds - Rendes jatekido`,
// bettingTypeId 693, temaforma `match-odds/693-3`. Csak 1X2 - a szelveny
// tobbi piaca (O/U, BTTS) rendes aron marad, ami rendben van: egy meccsbol
// ugyis csak egy lab mehet.

const { norm } = require('./teams.js');

const WS_URL = 'wss://sportsapi.tippmixpro.hu/v2';
const OPERATOR = '2901';
const LANG = 'hu';

// 693-3 = boostolt 1X2 rendes jatekidore, 69-3 = ugyanaz rendes aron.
// Mindkettot lekerjuk, hogy legyen mihez merni az emelest.
const BOOST_CODE = '693-3';
const PLAIN_CODE = '69-3';

// A slate 96 oras ablaka (Betting Slate Builder / Config node: maxHoursAhead).
const WINDOW_HOURS = 96;

// ---------------------------------------------------------------- WAMP kliens
// Szandekosan a tippmix_feed.js-bol atvett alak: az a fajl nem exportal, es
// ket helyen egy rovid protokoll-kliens kevesebb kart tesz, mint egy refaktor
// azon a scripten, ami mar kalibraciot szolgaltatott.
function connect(timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const pending = new Map();
    let reqId = 0;
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('idotullepes a csatlakozasnal')); }, timeoutMs);

    ws.onopen = () => ws.send(JSON.stringify([1, 'www.tippmixpro.hu', {
      agent: 'Wampy.js v6.2.2',
      roles: {
        subscriber: { features: { pattern_based_subscription: true, publication_trustlevels: true } },
        caller: { features: { caller_identification: true, progressive_call_results: true, call_canceling: true, call_timeout: true } },
      },
      authmethods: ['wampcra'], authid: 'webapi-wampy',
    }]));

    ws.onerror = () => { clearTimeout(timer); reject(new Error('WebSocket hiba - elerheto a sportsapi.tippmixpro.hu?')); };
    ws.onclose = ev => {
      clearTimeout(timer);
      for (const [, p] of pending) p.reject(new Error('a kapcsolat lezarult (code ' + ev.code + ')'));
      pending.clear();
    };

    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m[0] === 2) {
        clearTimeout(timer);
        resolve({
          dump(topic, ms = 25000) {
            return new Promise((res, rej) => {
              const id = ++reqId;
              const to = setTimeout(() => { pending.delete(id); rej(new Error('idotullepes: ' + topic.slice(0, 80))); }, ms);
              pending.set(id, { resolve: v => { clearTimeout(to); res(v); }, reject: v => { clearTimeout(to); rej(v); } });
              ws.send(JSON.stringify([48, id, {}, '/sports#initialDump', [], { topic, ctx: { v: '2', lang: LANG, tz: -120 } }]));
            });
          },
          close: () => { try { ws.close(); } catch {} },
        });
        return;
      }
      if (m[0] === 50 && pending.has(m[1])) {
        const p = pending.get(m[1]); pending.delete(m[1]);
        const payload = m[m.length - 1];
        p.resolve((payload && payload.records) || []);
        return;
      }
      if (m[0] === 8) {
        const id = m[2];
        if (pending.has(id)) {
          const p = pending.get(id); pending.delete(id);
          const kw = m[m.length - 1];
          p.reject(new Error((kw && kw.desc) || 'ismeretlen feed-hiba'));
        }
      }
    };
  });
}

// ------------------------------------------------------------ feldolgozas
// Egy odds harom rekordbol all ossze: MARKET + OUTCOME + BETTING_OFFER,
// amiket a MARKET_OUTCOME_RELATION kot ossze.
function pickPrices(records, wantCode) {
  const byType = t => records.filter(r => r._type === t);
  const outcomes = new Map(byType('OUTCOME').map(o => [o.id, o]));
  const offers = new Map();
  for (const b of byType('BETTING_OFFER')) offers.set(b.outcomeId, b);
  const relations = byType('MARKET_OUTCOME_RELATION');
  const out = [];
  for (const mk of byType('MARKET')) {
    if (mk.bettingTypeId + '-' + mk.eventPartId !== wantCode) continue;
    for (const rel of relations.filter(r => r.marketId === mk.id)) {
      const oc = outcomes.get(rel.outcomeId), off = offers.get(rel.outcomeId);
      // Lezart piac vagy nem elerheto ajanlat arat NEM visszuk: azok nem
      // olyan arak, amiken barki fogadhatott volna.
      if (!oc || !off || off.isAvailable === false || mk.isClosed) continue;
      if (!Number.isFinite(off.odds)) continue;
      out.push({
        label: oc.translatedName || oc.headerName || '',
        type: oc.typeName || '',
        odds: off.odds,
        last_changed: new Date(Number(off.lastChangedTime)).toISOString(),
      });
    }
  }
  return out;
}

// Csapatnev-egyezes a slate es a feed kozott.
//
// A feed ROVIDIT ott, ahol a slate nem: "Atl. Madrid" vs "Atlético Madrid",
// "Man Utd." vs "Manchester United". A puszta reszstring-vizsgalat ezekre
// elbukik ("atl madrid" nincs benne az "atletico madrid"-ban), ezert a
// negyedik lepcso szavankent hasonlit: minden feed-szonak legyen olyan
// slate-szo, aminek elejet adja (atl -> atletico, madrid -> madrid).
//
// A lepcsok sorrendje szamit: a szigorubb egyezes elobb. A szo-elotag a
// legmegengedobb, ezert utoljara - es minimum 3 karakteres szavakra, hogy az
// "FC"/"CA" tipusu toltelek ne parositson ossze ket kulonbozo csapatot.
function teamsMatch(slateName, feedName) {
  const s = norm(slateName || ''), f = norm(feedName || '');
  if (!s || !f) return false;
  if (s === f) return true;
  if (s.includes(f) || f.includes(s)) return true;
  const sw = s.split(' ').filter(w => w.length >= 3);
  const fw = f.split(' ').filter(w => w.length >= 3);
  if (!sw.length || !fw.length) return false;
  return fw.every(w => sw.some(x => x.startsWith(w) || w.startsWith(x)));
}

// A slate selection-jeire fordit. Az ismeretlen kombinaciot NEM talaljuk ki:
// null lesz, es kimarad - inkabb hianyzik egy boost, mint hogy rossz labra
// keruljon egy ar.
function toSelection(o, homeName, awayName) {
  const t = (o.type || '').toLowerCase(), lbl = (o.label || '').toLowerCase();
  if (t.includes('draw') || lbl === 'döntetlen' || lbl === 'x') return 'draw';
  if (!norm(o.label)) return null;
  if (teamsMatch(homeName, o.label)) return 'home';
  if (teamsMatch(awayName, o.label)) return 'away';
  return null;
}

// ------------------------------------------------------------------ n8n API
async function slateRows(apiUrl, apiKey) {
  const rows = [];
  let cursor = null;
  do {
    const u = new URL(`${apiUrl.replace(/\/$/, '')}/api/v1/data-tables/g6EjXi82TbW6VB91/rows`);
    u.searchParams.set('limit', '100');
    if (cursor) u.searchParams.set('cursor', cursor);
    const r = await fetch(u, { headers: { 'X-N8N-API-KEY': apiKey } });
    if (!r.ok) throw new Error(`slate lekeres: HTTP ${r.status} ${await r.text()}`);
    const j = await r.json();
    rows.push(...(j.data || []));
    cursor = j.nextCursor || null;
  } while (cursor);
  return rows;
}

// A datatable sor-frissitese `POST /rows/upsert`. Merve 2026-09-16: a PATCH
// /rows es a POST /rows/update egyarant 405-ot ad ezen a peldanyon, es csak
// ez a vegpont el. Az upsert CSAK a `data`-ban megadott mezoket irja at, a
// tobbit bekene hagyja - tehat nem kell a teljes sort visszakuldeni.
//
// VESZELY: az upsert BESZUR, ha a filter nem fog sort. A `data` csak ket mezot
// tartalmaz, tehat a beszurt sorban nem lenne match_name/market/selection -
// egy csonka lab, ami vegigmenne a Slip Builderen. Ez akkor all elo, ha a
// Clear Slate (08:00) a slate beolvasasa es az iras kozott urit. Ezert minden
// iras elott ellenorizzuk, hogy a sor MEG megvan.
async function rowExists(apiUrl, apiKey, legId) {
  const u = new URL(`${apiUrl.replace(/\/$/, '')}/api/v1/data-tables/g6EjXi82TbW6VB91/rows`);
  u.searchParams.set('filter', JSON.stringify({
    type: 'and', filters: [{ columnName: 'leg_id', condition: 'eq', value: legId }],
  }));
  u.searchParams.set('limit', '1');
  const r = await fetch(u, { headers: { 'X-N8N-API-KEY': apiKey } });
  if (!r.ok) throw new Error(`lab ellenorzes: HTTP ${r.status} ${await r.text()}`);
  const j = await r.json();
  return (j.data || []).length > 0;
}

async function writeBoost(apiUrl, apiKey, legId, boostOdds) {
  if (!await rowExists(apiUrl, apiKey, legId)) {
    throw new Error(`a lab mar nincs a slate-en (torolt sor?) - NEM irok, hogy ne szuljek csonka sort`);
  }
  const u = `${apiUrl.replace(/\/$/, '')}/api/v1/data-tables/g6EjXi82TbW6VB91/rows/upsert`;
  const r = await fetch(u, {
    method: 'POST',
    headers: { 'X-N8N-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filter: { type: 'and', filters: [{ columnName: 'leg_id', condition: 'eq', value: legId }] },
      data: { boost_odds: boostOdds, is_boosted: 'igen' },
    }),
  });
  if (!r.ok) throw new Error(`iras (${legId}): HTTP ${r.status} ${await r.text()}`);
}

// --------------------------------------------------------------------- futas
(async () => {
  const args = process.argv.slice(2);
  const doWrite = args.includes('--write');
  // A --min ertekenek ki KELL derulnie: `--min` ertek nelkul vagy `--min abc`
  // NaN-t adna, amire minden `pct >= minPct` hamis - nulla boost irodna be,
  // miközben a kimenet sikeresnek latszik.
  let minPct = 0;
  if (args.includes('--min')) {
    minPct = Number(args[args.indexOf('--min') + 1]);
    if (!Number.isFinite(minPct)) {
      console.error('A --min utan szam kell, pl. --min 3');
      process.exit(1);
    }
  }

  const apiUrl = process.env.N8N_API_URL, apiKey = process.env.N8N_API_KEY;
  if (doWrite && (!apiUrl || !apiKey)) {
    console.error('A --write-hoz N8N_API_URL es N8N_API_KEY kell (Windows env valtozok).');
    process.exit(1);
  }

  // 1) A slate labai - ehhez parositunk. Iras nelkul is kell, mert csak azokra
  //    a meccsekre van ertelme boostot keresni, amik a slate-en vannak.
  let slate = [];
  if (apiUrl && apiKey) {
    try {
      slate = await slateRows(apiUrl, apiKey);
      console.log(`Slate: ${slate.length} lab a bet_slate tablaban`);
    } catch (err) {
      console.log(`! a slate nem elerheto (${err.message}) - parositas nelkul futok`);
    }
  } else {
    console.log('Nincs N8N_API_URL/KEY - parositas nelkul, csak a feed tartalmat mutatom.');
  }
  const slateByEvent = new Map();
  for (const r of slate) {
    if (!slateByEvent.has(r.event_id)) slateByEvent.set(r.event_id, []);
    slateByEvent.get(r.event_id).push(r);
  }

  console.log('\nCsatlakozas a Tippmixpro feedhez...');
  const feed = await connect();
  console.log('  OK');

  // 2) A kiemelt lista adja a boostolt meccseket. A boost a fooldalon jelenik
  //    meg, nem bajnoksagonkent - ezert ez a temaforma, nem a tournament-.
  const recs = await feed.dump(`/sports/${OPERATOR}/${LANG}/highlighted-popular-matches-aggregator-groups-overview/1/50/1380/default-event-info/or1.0-100.0`);
  const now = Date.now();
  const matches = recs.filter(r => r._type === 'MATCH').filter(m => {
    const h = (Number(m.startTime) - now) / 3600000;
    return h >= -3 && h <= WINDOW_HOURS;
  });
  console.log(`Kiemelt meccsek a ${WINDOW_HOURS} oras ablakban: ${matches.length}\n`);

  const found = [];
  const unmatched = [];
  for (const m of matches) {
    let odds;
    try {
      odds = await feed.dump(`/sports/${OPERATOR}/${LANG}/${m.id}/match-odds/${BOOST_CODE},${PLAIN_CODE}`);
    } catch (err) {
      // Egy meccs bukasa nem allitja meg a gyujtest, de LATSZIK.
      console.log(`  ! ${m.name}: ${err.message}`);
      continue;
    }
    const boost = pickPrices(odds, BOOST_CODE);
    if (!boost.length) continue;                    // nincs boost ezen a meccsen
    const plain = pickPrices(odds, PLAIN_CODE);

    console.log(`${m.name}  (${m.parentName || ''})`);
    for (const b of boost) {
      const sel = toSelection(b, m.homeParticipantName, m.awayParticipantName);
      if (!sel) { unmatched.push({ match: m.name, label: b.label, why: 'ismeretlen kimenetel' }); continue; }
      const p = plain.find(x => toSelection(x, m.homeParticipantName, m.awayParticipantName) === sel);
      const pct = p ? (b.odds / p.odds - 1) * 100 : null;
      const pctTxt = pct === null ? '  (nincs rendes ar)' : `  ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;

      // Parositas a slate labjara: ugyanaz az event_id NEM hasznalhato, mert
      // a slate a The Odds API azonositoit hordozza, a feed a sajatjait.
      // Csapatnev + selection a kulcs.
      let leg = null;
      for (const [, legs] of slateByEvent) {
        const hit = legs.find(l => {
          if (l.market !== 'h2h' || l.selection !== sel) return false;
          const parts = String(l.match_name).split(' vs ');
          if (parts.length !== 2) return false;
          // MINDKET csapatnak egyeznie kell: egy oldal onmagaban osszehozna
          // az "Osasuna hazai" es az "Osasuna vendeg" meccset.
          return teamsMatch(parts[0], m.homeParticipantName)
              && teamsMatch(parts[1], m.awayParticipantName);
        });
        if (hit) { leg = hit; break; }
      }

      const legTxt = leg ? `-> ${leg.leg_id}` : (slate.length ? '-> nincs a slate-en' : '');
      console.log(`   [BOOST] ${String(b.label).padEnd(22)} @${String(b.odds).padEnd(6)} rendes @${p ? p.odds : '?'}${pctTxt}  ${legTxt}`);

      if (leg && pct !== null && pct >= minPct) {
        found.push({ leg_id: leg.leg_id, match: m.name, label: b.label, boost: b.odds, plain: p.odds, pct });
      } else if (leg && pct !== null) {
        console.log(`            (kihagyva: ${pct.toFixed(2)}% < ${minPct}% kuszob)`);
      }
    }
    console.log();
  }

  if (unmatched.length) {
    // Soha nem csendben. Ez a resz romlik el eloszor.
    console.log(`PAROSITATLAN KIMENETELEK (${unmatched.length}):`);
    for (const u of unmatched) console.log(`   ${u.match}: "${u.label}" - ${u.why}`);
    console.log();
  }

  console.log(`Beirhato boost: ${found.length} lab`);
  if (found.length) {
    const avg = found.reduce((s, f) => s + f.pct, 0) / found.length;
    console.log(`Atlagos emeles: +${avg.toFixed(2)}%`);
  }

  if (!doWrite) {
    console.log('\n(szaraz futas - a slate NEM valtozott. Iras: node boost_fetch.js --write)');
    feed.close();
    return;
  }

  let ok = 0;
  for (const f of found) {
    try { await writeBoost(apiUrl, apiKey, f.leg_id, f.boost); ok++; }
    catch (err) { console.log(`  ! ${f.leg_id}: ${err.message}`); }
  }
  console.log(`\nBeirva: ${ok}/${found.length} lab a bet_slate boost_odds mezojebe.`);
  feed.close();
})();
