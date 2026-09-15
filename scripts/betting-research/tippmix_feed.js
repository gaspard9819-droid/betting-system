// Tippmixpro arak gyujtese a sajat odds-feedjukbol, kezi masolas nelkul.
//
// MIERT: a szelvenyepito nem tudja a valodi Tippmixpro-arat, hanem BECSLI a
// piaci atlagbol (`tippmixRatio()` a Generate Legs node-ban). A gorbe 27 (1X2)
// es 18 (O/U) kezzel gyujtott arparra van illesztve, 2.31% atlagos hibaval -
// ami nagyobb, mint a legpontosabban mert effektus (korai fogadas, +0.40pp).
// A `btts` piac pedig teljesen meretlen: az 1X2 gorbeje alapjan arazodik.
//
// HOGYAN: a tippmixpro.hu az EveryMatrix platformon fut, es az oddsokat egy
// WAMP-protokollu WebSocketen kapja (wss://sportsapi.tippmixpro.hu/v2). Ez
// strukturalt JSON - nem HTML-kapargatas. Bejelentkezes nem kell, bongeszo nem
// kell: a Node beepitett WebSocketje eleg, fuggoseg nelkul.
//
// A feed felderitese 2026-09-15-en tortent, a Chrome sajat CDP protokolljaval
// rogzitett forgalombol. Ha a protokoll valtozik, a felderitest ugyanigy kell
// megismetelni - a temaformak (`topic`) nem dokumentaltak.
//
// MIT AD: minden arhoz ott a `lastChangedTime`, tehat TUDJUK, mikori az ar.
// Ez nem kenyelmi kerdes. A 2026-09-13-i meres csapdaja epp az volt, hogy 85
// arbol 60 elmozdult ot ora alatt, es ettol latszott rossznak egy jo gorbe.
// A README szabalya - "csak azonos pillanatban rogzitett arakat hasonlits" -
// igy nem fegyelem kerdese, hanem az adatbol kovetkezik.
//
// FUTTATAS (a betting-research mappabol):
//   node tippmix_feed.js                        # mai meccsek arai -> data/tippmix/
//   node tippmix_feed.js --pair <slate.json>    # + parositas egy slate-tel
//   node tippmix_feed.js --markets              # egy meccs osszes piactipusa
//
// A kimenet a data/tippmix/ mappaba kerul, ugyanoda, ahol a kezi gyujtes van.
// A --pair kapcsoloval keszult fajl alakja megegyezik a
// slate_pairs_2026-09-13.json-nal, tehat a tippmix_direct.js kozvetlenul eszi.

const fs = require('fs');
const path = require('path');
const { norm } = require('./teams.js');

const WS_URL = 'wss://sportsapi.tippmixpro.hu/v2';
const OPERATOR = '2901';               // a tippmixpro operator-azonositoja a feedben
const LANG = 'hu';
const OUT_DIR = path.join(__dirname, 'data', 'tippmix');

// A piackod alakja: <bettingTypeId>-<eventPartId>. A 3-as eventPart a rendes
// jatekido. Ezt a harmat hasznaljuk; a tobbi 20 piactipust a --markets mutatja.
const MARKETS = {
  '69-3': 'h2h',      // 1X2
  '47-3': 'totals',   // Golszam (O/U) - lasd a korlatot lent
  '76-3': 'btts',     // Mindket csapat szerez golt
};

// KORLAT (2026-09-15): a 47-3 `mainLine: true`-val csak a FOVONALAT adja, ami
// gyakorlatilag mindig 2.5. A tobbi vonal (1.5, 3.5) kulon MARKET rekordkent
// letezik, de ez a temaforma nem hozza oket. A slate maga is csak a 2.5-os
// vonalat tartja meg, tehat a jelenlegi kalibraciohoz ez eleg - DE a README
// "O/U 3.6 felett nincs adatpont" nyitott kerdeset NEM zarja le. Ahhoz meg
// kell talalni azt a temat, ami a nem-fovonalas piacokat is kiszolgalja.

// ---------------------------------------------------------------- WAMP kliens
// A protokoll uzenetkodjai (WAMP v2): 1=HELLO 2=WELCOME 8=ERROR 48=CALL 50=RESULT
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
      if (m[0] === 2) {                       // WELCOME
        clearTimeout(timer);
        resolve({
          // Egy initialDump lekeres. A `ctx` a bongeszo altal kuldott alak;
          // a cid/t mezok nelkul is kiszolgalja - azok session-azonositok.
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
      if (m[0] === 50 && pending.has(m[1])) {  // RESULT
        const p = pending.get(m[1]); pending.delete(m[1]);
        const payload = m[m.length - 1];
        p.resolve((payload && payload.records) || []);
        return;
      }
      if (m[0] === 8) {                        // ERROR
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

// ------------------------------------------------------------ rekord-feldolgozas
// A feed rekordjai lapos listaban jonnek, tipussal jelolve. Egy odds harom
// rekordbol all ossze: MARKET (mit fogadunk) + OUTCOME (melyik oldalt) +
// BETTING_OFFER (az ar), amiket a MARKET_OUTCOME_RELATION kot ossze.
function extractOdds(records) {
  const byType = t => records.filter(r => r._type === t);
  const outcomes = new Map(byType('OUTCOME').map(o => [o.id, o]));
  const offers = new Map();
  for (const b of byType('BETTING_OFFER')) offers.set(b.outcomeId, b);
  const relations = byType('MARKET_OUTCOME_RELATION');
  const out = [];
  for (const mk of byType('MARKET')) {
    const code = mk.bettingTypeId + '-' + mk.eventPartId;
    for (const rel of relations.filter(r => r.marketId === mk.id)) {
      const oc = outcomes.get(rel.outcomeId), off = offers.get(rel.outcomeId);
      // Csak az elerheto, valos arat visszuk. A lezart piac (isClosed) es a
      // nem elerheto ajanlat (isAvailable=false) arat NEM gyujtjuk: azok nem
      // olyan arak, amiken barki fogadhatott volna.
      if (!oc || !off || off.isAvailable === false || mk.isClosed) continue;
      if (!Number.isFinite(off.odds)) continue;
      out.push({
        market_code: code,
        market: MARKETS[code] || null,
        market_name: mk.bettingTypeName,
        outcome_type: oc.typeName || '',
        outcome_label: oc.translatedName || oc.headerName || '',
        // A vonal (O/U 2.5 stb.) tobb mezoben is allhat a piactipustol fuggoen.
        line: firstNumber([mk.line, oc.line, oc.paramFloat1, mk.paramFloat1]),
        yes: oc.paramBoolean1 === undefined ? null : oc.paramBoolean1,
        odds: off.odds,
        // EZ a mezo teszi a mereseket osszehasonlithatova.
        last_changed: new Date(Number(off.lastChangedTime)).toISOString(),
      });
    }
  }
  return out;
}

const firstNumber = arr => { for (const v of arr) if (Number.isFinite(Number(v)) && v !== null && v !== '') return Number(v); return null; };

// A slate selection-jeire fordit: home/draw/away, over25/under25, btts_yes/no.
// Az ismeretlen kombinaciot NEM talaljuk ki - null lesz, es kimarad.
function toSelection(o, homeName, awayName) {
  if (o.market === 'h2h') {
    const t = (o.outcome_type || '').toLowerCase(), lbl = (o.outcome_label || '').toLowerCase();
    if (t.includes('draw') || lbl === 'döntetlen' || lbl === 'x') return 'draw';
    if (t.includes('winner')) {
      const n = norm(o.outcome_label);
      if (n && homeName && norm(homeName).includes(n)) return 'home';
      if (n && awayName && norm(awayName).includes(n)) return 'away';
      if (n && homeName && n.includes(norm(homeName))) return 'home';
      if (n && awayName && n.includes(norm(awayName))) return 'away';
    }
    return null;
  }
  if (o.market === 'totals') {
    // A slate kizarolag a 2.5-os vonalat tartja meg.
    if (o.line !== 2.5) return null;
    const t = (o.outcome_type || '').toLowerCase();
    if (t.includes('over')) return 'over25';
    if (t.includes('under')) return 'under25';
    return null;
  }
  if (o.market === 'btts') {
    if (o.yes === true) return 'btts_yes';
    if (o.yes === false) return 'btts_no';
    const lbl = (o.outcome_label || '').toLowerCase();
    if (lbl === 'igen') return 'btts_yes';
    if (lbl === 'nem') return 'btts_no';
    return null;
  }
  return null;
}

// -------------------------------------------------------------------- gyujtes
async function collect(feed, limit) {
  // A kiemelt meccsek temaja. A `1380` a foci csoportazonositoja, az
  // `or1.0-100.0` az odds-tartomany szuro.
  const topic = `/sports/${OPERATOR}/${LANG}/highlighted-popular-matches-aggregator-groups-overview/1/${limit}/1380/default-event-info/or1.0-100.0`;
  const records = await feed.dump(topic);
  const matches = records.filter(r => r._type === 'MATCH');
  console.log(`Meccsek a feedben: ${matches.length}`);
  if (!matches.length) throw new Error('a feed nem adott meccset - valtozhatott a temaformatum (lasd a fejlec felderitesi reszet)');

  const codes = Object.keys(MARKETS).join(',');
  const rows = [];
  for (const m of matches) {
    let recs;
    try {
      recs = await feed.dump(`/sports/${OPERATOR}/${LANG}/${m.id}/match-odds/${codes}`);
    } catch (err) {
      // Egy meccs bukasa nem allitja meg a gyujtest, de LATSZIK.
      console.log(`  ! ${m.name}: ${err.message}`);
      continue;
    }
    const odds = extractOdds(recs);
    rows.push({
      event_id: m.id,
      match: m.name,
      home: m.homeParticipantName || '',
      away: m.awayParticipantName || '',
      league: m.parentName || '',
      kickoff: new Date(Number(m.startTime)).toISOString(),
      odds,
    });
    const n = { h2h: 0, totals: 0, btts: 0 };
    for (const o of odds) if (o.market) n[o.market]++;
    console.log(`  ${m.name.padEnd(38).slice(0, 38)} 1X2:${String(n.h2h).padStart(2)}  O/U:${String(n.totals).padStart(2)}  btts:${String(n.btts).padStart(2)}`);
  }
  return rows;
}

// ---------------------------------------------------- parositas egy slate-tel
// Ugyanaz a negylepcsos letra, mint a findTeam/matchTeamName-ben: direkt,
// normalizalt, majd reszstring >= 4 karakteren. Az Espanyol/Espanol eset
// megtanitotta, hogy ez a resz romlik el csendben - ezert a parositatlan
// meccseket KIIRJUK, nem nyeljuk le.
function matchSlateToFeed(slate, feedRows) {
  const pairs = [], unmatched = [];
  const feedByNorm = feedRows.map(f => ({ row: f, h: norm(f.home), a: norm(f.away) }));

  for (const leg of slate) {
    const parts = String(leg.match_name).split(' vs ');
    if (parts.length !== 2) { unmatched.push({ leg: leg.leg_id, why: 'ertelmezhetetlen match_name' }); continue; }
    const sh = norm(parts[0]), sa = norm(parts[1]);
    const hit = feedByNorm.find(f =>
      (f.h === sh && f.a === sa) ||
      (f.h.length >= 4 && sh.length >= 4 && f.a.length >= 4 && sa.length >= 4 &&
       (f.h.includes(sh) || sh.includes(f.h)) && (f.a.includes(sa) || sa.includes(f.a))));
    if (!hit) { unmatched.push({ leg: leg.leg_id, why: 'nincs ilyen meccs a feedben', match: leg.match_name }); continue; }

    const want = leg.selection;
    const cand = hit.row.odds
      .map(o => ({ o, sel: toSelection(o, hit.row.home, hit.row.away) }))
      .filter(x => x.sel === want);
    if (!cand.length) { unmatched.push({ leg: leg.leg_id, why: 'a piac/kimenetel nincs a feedben: ' + leg.market + '|' + want, match: leg.match_name }); continue; }

    const real = cand[0].o;
    const marketAvg = Number(leg.market_avg_odds);
    if (!Number.isFinite(marketAvg) || marketAvg <= 0) { unmatched.push({ leg: leg.leg_id, why: 'hianyzo market_avg_odds' }); continue; }
    pairs.push({
      match: leg.match_name,
      tippmix_source: hit.row.match,
      league: leg.league,
      market: leg.market,
      selection: leg.selection,
      market_avg: marketAvg,
      real: real.odds,
      ratio: Math.round(real.odds / marketAvg * 10000) / 10000,
      // A parositas csak akkor ervenyes, ha a ket ar egy idoben allt fenn.
      real_last_changed: real.last_changed,
      slate_created_at: leg.created_at || null,
    });
  }
  return { pairs, unmatched };
}

// ------------------------------------------------------------------------ fo
(async () => {
  const args = process.argv.slice(2);
  const pairIdx = args.indexOf('--pair');
  const slatePath = pairIdx >= 0 ? args[pairIdx + 1] : null;
  const showMarkets = args.includes('--markets');
  const limit = Number((args.find(a => a.startsWith('--limit=')) || '').split('=')[1]) || 20;

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const startedAt = new Date();
  console.log('Tippmixpro odds-feed  ' + startedAt.toISOString());
  console.log('Forras: ' + WS_URL + '\n');

  let feed;
  try { feed = await connect(); } catch (err) { console.error('HIBA: ' + err.message); process.exit(1); }

  try {
    if (showMarkets) {
      // Egy meccs OSSZES piactipusa - felderiteshez, nem gyujteshez.
      const topic = `/sports/${OPERATOR}/${LANG}/highlighted-popular-matches-aggregator-groups-overview/1/1/1380/default-event-info/or1.0-100.0`;
      const recs = await feed.dump(topic);
      const m = recs.find(r => r._type === 'MATCH');
      if (!m) throw new Error('nincs meccs a feedben');
      const codes = []; for (let i = 1; i <= 120; i++) codes.push(i + '-3');
      const all = await feed.dump(`/sports/${OPERATOR}/${LANG}/${m.id}/match-odds/${codes.join(',')}`);
      const seen = new Map();
      for (const k of all.filter(r => r._type === 'MARKET')) if (!seen.has(k.bettingTypeName)) seen.set(k.bettingTypeName, k.bettingTypeId + '-' + k.eventPartId);
      console.log(`${m.name} - ${seen.size} piactipus:`);
      for (const [n, c] of seen) console.log(`  [${c}] ${n}${MARKETS[c] ? '   <- gyujtjuk mint ' + MARKETS[c] : ''}`);
      feed.close(); return;
    }

    const rows = await collect(feed, limit);
    const stamp = startedAt.toISOString().replace(/:/g, '-').slice(0, 16) + 'Z';
    const rawFile = path.join(OUT_DIR, `feed_${stamp}.json`);
    fs.writeFileSync(rawFile, JSON.stringify({ collected_at: startedAt.toISOString(), source: WS_URL, matches: rows }, null, 1));

    const total = rows.reduce((s, r) => s + r.odds.length, 0);
    const known = rows.reduce((s, r) => s + r.odds.filter(o => o.market).length, 0);
    console.log(`\n${rows.length} meccs, ${total} ar (ebbol ${known} a harom kovetett piacon)`);
    console.log('nyers adat: ' + path.relative(process.cwd(), rawFile));

    if (slatePath) {
      if (!fs.existsSync(slatePath)) { console.error('\nHIBA: nincs ilyen slate fajl: ' + slatePath); process.exit(1); }
      const raw = JSON.parse(fs.readFileSync(slatePath, 'utf8'));
      const slate = Array.isArray(raw) ? raw : (raw.legs || raw.data || []);
      const { pairs, unmatched } = matchSlateToFeed(slate, rows);
      const pairFile = path.join(OUT_DIR, `slate_pairs_${stamp}.json`);
      fs.writeFileSync(pairFile, JSON.stringify(pairs, null, 1));
      console.log(`\nParositas: ${pairs.length} par a ${slate.length} slate-labbol`);
      const byMarket = {};
      for (const p of pairs) byMarket[p.market] = (byMarket[p.market] || 0) + 1;
      console.log('  piaconkent: ' + JSON.stringify(byMarket));
      console.log('  parok: ' + path.relative(process.cwd(), pairFile));

      // IDOELTOLODAS-FIGYELMEZTETES. A 2026-09-13-i meres csapdaja: ha a slate
      // arait es a valos arakat mas pillanatban rogzitettuk, a ratio nem a
      // konyv arresét meri, hanem a kozben elmozdult piacot. 85 arbol 60
      // mozdult ot ora alatt. Ket nap kulonbsegnel a ratio-k ertelmetlenek.
      const ages = pairs.map(p => p.slate_created_at ? (startedAt - new Date(p.slate_created_at)) / 3600000 : null).filter(Number.isFinite);
      if (ages.length) {
        const maxAge = Math.max(...ages);
        console.log(`  a slate arai ${maxAge.toFixed(1)} oraval a gyujtes elott keszultek`);
        if (maxAge > 2) {
          console.log('  FIGYELEM: 2 oranal regebbi slate. A ratio-k ilyenkor az idokozben');
          console.log('  elmozdult piacot merik, nem a Tippmixpro arresét - kalibraciora NEM');
          console.log('  hasznalhatok. Egy idoben rogzitett parhoz futtasd ezt a slate');
          console.log('  frissitese utan kozvetlenul.');
        }
      }
      if (unmatched.length) {
        // Soha nem csendben. Ez a resz romlik el eloszor.
        console.log(`\n  PAROSITATLAN (${unmatched.length}):`);
        const why = {};
        for (const u of unmatched) why[u.why] = (why[u.why] || 0) + 1;
        for (const [w, c] of Object.entries(why).sort((a, b) => b[1] - a[1])) console.log(`    ${String(c).padStart(3)}x ${w}`);
      }
    }
  } catch (err) {
    console.error('\nHIBA: ' + err.message);
    feed.close(); process.exit(1);
  }
  feed.close();
})();
