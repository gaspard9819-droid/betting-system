// A nemzetkozi kupak (BL, EL, KL) felvetele a slate-re, a Tippmixpro feedbol.
//
// MIERT: a Betting Slate Builder ot hazai bajnoksagot ismer, mert a modellje
// a football-data.co.uk CSV-ibol epul, es azok csak bajnoksagokat adnak. Egy
// BL-meccs viszont KET kulonbozo liga csapatat hozza ossze (Bayern = D1,
// Arsenal = E0), es a `findTeam` egy ligan belul keres - tehat a meccs a
// `tooThin`/`unmatched` listaba esne. A The Odds API sem kinal kupat.
//
// Kovetkezmeny: szerda-csutortokon 10-20 meccs kimarad. 2026-09-16-an 18
// EL-meccs volt, es a szelvenyepito 2 La Liga-meccsbol probalt valogatni -
// 2.2x-es celra 1 labas "szelvenyt" adott, mert 2 labbal nem jott ki semmi.
//
// HOGYAN: a feed adja a meccset ES az arat is. Modell nincs - de nem is kell:
// a szelvenyepito a PIACI valoszinuseg alapjan valaszt (a modell rangsora
// meresek szerint forditott, lasd a README-t), es azt egyetlen konyv arabol
// is ki lehet szamolni de-vigelessel.
//
// AMI HIANYZIK ezeken a labakon, es amit a kimenet JELEZ:
//   - model_prob: nincs (null). A Discord-valasz "modell X%" sora ures lesz.
//   - confidence: 'KUPA'. NEM 'ALACSONY' - az kizarna a szelvenyepitobol -,
//     es nem is 'MAGAS', mert nincs mihez merni. Sajat cimke, hogy latszodjon.
//   - best_odds: a Tippmix sajat ara. Nincs tobb konyv, tehat nincs line
//     shopping ezeken a labakon; a kimenet igy nem is ajanl jobb arat.
//
// AZ EGY-KONYVES DE-VIG KORLATJA: a margot ARANYOSAN vonjuk le, ami azt
// feltelezi, hogy a konyv minden kimenetelre ugyanakkora felart tesz. A
// valosagban a favorit-oldal jellemzoen jobban meg van vagva (favourite-
// longshot bias). Tobb konyv atlaga ezt kisimitana; egy konyvbol nem lehet.
// A hatas a rangsorra kicsi (egy meccsen belul monoton), a szelvenyepito
// pedig csak rangsorra hasznalja - de a market_prob abszolut erteke ezeken a
// labakon kevesbe pontos, mint a top5-on.
//
// FUTTATAS (a betting-research mappabol):
//   node cups_fetch.js              # szaraz futas, nem ir
//   node cups_fetch.js --write      # beirja a bet_slate-be
//   node cups_fetch.js --hours 96   # idoablak (alap: 96, mint a Config)
//
// Kornyezet a --write-hoz: N8N_API_URL es N8N_API_KEY.

const WS_URL = 'wss://sportsapi.tippmixpro.hu/v2';
const OPERATOR = '2901';
const LANG = 'hu';
const TABLE = 'g6EjXi82TbW6VB91';          // bet_slate

// A 67-es kategoria a nemzetkozi kupak. Felderitve a tippmix_discover.js-szel
// 2026-09-16-an. Ha egy szezonvaltasnal elavul egy id:
//   node tippmix_discover.js --cat 67
const CUPS = {
  'BL': '305538761002545152',
  'EL': '306343242866847744',
  'KL': '306340432262688768',
};

// A slate harom piaca, a feed kodjaival. Ugyanaz, amit a tippmix_feed.js
// gyujt. A 693 (Szuper odds) itt NEM szerepel: azt a boost_fetch.js irja
// kulon mezobe, es a ket script egymastol fuggetlenul futtathato.
const MARKETS = {
  '69-3': 'h2h',
  '47-3': 'totals',
  '76-3': 'btts',
};

// ---------------------------------------------------------------- WAMP kliens
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
              const to = setTimeout(() => { pending.delete(id); rej(new Error('idotullepes: ' + topic.slice(0, 70))); }, ms);
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
function pricesByMarket(records) {
  const outcomes = new Map(records.filter(r => r._type === 'OUTCOME').map(o => [o.id, o]));
  const offers = new Map();
  for (const b of records.filter(r => r._type === 'BETTING_OFFER')) offers.set(b.outcomeId, b);
  const rel = {};
  for (const r of records.filter(r => r._type === 'MARKET_OUTCOME_RELATION')) (rel[r.marketId] = rel[r.marketId] || []).push(r.outcomeId);

  const out = {};
  for (const mk of records.filter(r => r._type === 'MARKET')) {
    const code = mk.bettingTypeId + '-' + mk.eventPartId;
    const market = MARKETS[code];
    if (!market || mk.isClosed) continue;
    // A golszam piacnak tobb vonala is lehet; a slate csak a 2.5-ost tartja.
    const line = firstNumber([mk.line, mk.paramFloat1]);
    if (market === 'totals' && line !== null && line !== 2.5) continue;
    const list = [];
    for (const id of (rel[mk.id] || [])) {
      const oc = outcomes.get(id), off = offers.get(id);
      if (!oc || !off || off.isAvailable === false || !Number.isFinite(off.odds)) continue;
      list.push({
        label: oc.translatedName || oc.headerName || '',
        type: oc.typeName || '',
        line: firstNumber([oc.line, oc.paramFloat1, line]),
        yes: oc.paramBoolean1 === undefined ? null : oc.paramBoolean1,
        odds: off.odds,
      });
    }
    if (list.length) out[market] = list;
  }
  return out;
}

const firstNumber = arr => { for (const v of arr) if (v !== null && v !== '' && Number.isFinite(Number(v))) return Number(v); return null; };

const norm = s => String(s)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

// A slate selection-jeire fordit. Ismeretlen kombinaciot NEM talalunk ki.
function toSelection(market, o, home, away) {
  if (market === 'h2h') {
    const t = (o.type || '').toLowerCase(), lbl = (o.label || '').toLowerCase();
    if (t.includes('draw') || lbl === 'döntetlen' || lbl === 'x') return 'draw';
    const n = norm(o.label);
    if (!n) return null;
    const h = norm(home), a = norm(away);
    if (h && (h.includes(n) || n.includes(h))) return 'home';
    if (a && (a.includes(n) || n.includes(a))) return 'away';
    // A feed rovidit ("Atl. Madrid"), ezert szo-elotagra is illesztunk.
    const words = x => x.split(' ').filter(w => w.length >= 3);
    const match = (slate, feed) => {
      const sw = words(slate), fw = words(feed);
      return sw.length && fw.length && fw.every(w => sw.some(x => x.startsWith(w) || w.startsWith(x)));
    };
    if (match(h, n)) return 'home';
    if (match(a, n)) return 'away';
    return null;
  }
  if (market === 'totals') {
    if (o.line !== null && o.line !== 2.5) return null;
    const t = (o.type || '').toLowerCase(), lbl = (o.label || '').toLowerCase();
    if (t.includes('over') || lbl.startsWith('több') || lbl.startsWith('tobb')) return 'over25';
    if (t.includes('under') || lbl.startsWith('kev')) return 'under25';
    return null;
  }
  if (market === 'btts') {
    if (o.yes === true) return 'btts_yes';
    if (o.yes === false) return 'btts_no';
    const lbl = (o.label || '').toLowerCase();
    if (lbl === 'igen') return 'btts_yes';
    if (lbl === 'nem') return 'btts_no';
    return null;
  }
  return null;
}

const LABELS = {
  home: '1 (hazai)', draw: 'X (dontetlen)', away: '2 (vendeg)',
  over25: 'Over 2.5 gol', under25: 'Under 2.5 gol',
  btts_yes: 'BTTS igen', btts_no: 'BTTS nem',
};

// De-vigeles EGY konyv arabol: a margot aranyosan vonjuk le.
// Csak TELJES piacon ertelmes (minden kimenetel megvan), kulonben az
// implikalt valoszinusegek osszege nem a margot meri, hanem a hianyt.
function devig(list) {
  if (list.length < 2) return null;
  const ipSum = list.reduce((s, x) => s + 1 / x.odds, 0);
  if (!(ipSum > 1)) return null;          // ertelmetlen (vagy mar de-viggelt) piac
  return { probs: list.map(x => (1 / x.odds) / ipSum), marginPct: (ipSum - 1) * 100 };
}

// ------------------------------------------------------------------ n8n API
async function existingLegIds(apiUrl, apiKey) {
  const ids = new Set();
  let cursor = null;
  do {
    const u = new URL(`${apiUrl.replace(/\/$/, '')}/api/v1/data-tables/${TABLE}/rows`);
    u.searchParams.set('limit', '100');
    if (cursor) u.searchParams.set('cursor', cursor);
    const r = await fetch(u, { headers: { 'X-N8N-API-KEY': apiKey } });
    if (!r.ok) throw new Error(`slate lekeres: HTTP ${r.status}`);
    const j = await r.json();
    for (const row of (j.data || [])) ids.add(row.leg_id);
    cursor = j.nextCursor || null;
  } while (cursor);
  return ids;
}

async function insertRows(apiUrl, apiKey, rows) {
  const u = `${apiUrl.replace(/\/$/, '')}/api/v1/data-tables/${TABLE}/rows`;
  const r = await fetch(u, {
    method: 'POST',
    headers: { 'X-N8N-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: rows }),
  });
  if (!r.ok) throw new Error(`iras: HTTP ${r.status} ${await r.text()}`);
  return r.json();
}

// --------------------------------------------------------------------- futas
(async () => {
  const args = process.argv.slice(2);
  const doWrite = args.includes('--write');
  const hours = args.includes('--hours') ? Number(args[args.indexOf('--hours') + 1]) : 96;

  const apiUrl = process.env.N8N_API_URL, apiKey = process.env.N8N_API_KEY;
  if (doWrite && (!apiUrl || !apiKey)) {
    console.error('A --write-hoz N8N_API_URL es N8N_API_KEY kell.');
    process.exit(1);
  }

  console.log('Csatlakozas a Tippmixpro feedhez...');
  const feed = await connect();
  console.log('  OK\n');

  const now = Date.now();
  const legs = [];
  const skipped = [];

  for (const [cup, tid] of Object.entries(CUPS)) {
    let recs;
    try {
      recs = await feed.dump(`/sports/${OPERATOR}/${LANG}/tournament-aggregator-groups-overview/${tid}/default-event-info/BOTH/1380`);
    } catch (err) {
      // Egy elavult bajnoksag-id nem allithatja meg a tobbit, de LATSZIK.
      console.log(`! ${cup}: ${err.message} - elavult a bajnoksag-id? (tippmix_discover.js --cat 67)`);
      continue;
    }
    const all = recs.filter(r => r._type === 'MATCH');
    const inWindow = all.filter(m => {
      const h = (Number(m.startTime) - now) / 3600000;
      return h > 0.17 && h <= hours;        // a 10 percen belul kezdodo meccs mar nem fogadhato
    });
    console.log(`${cup}: ${all.length} kiirt meccs, ${inWindow.length} a ${hours} oras ablakban`);

    for (const m of inWindow) {
      let odds;
      try { odds = await feed.dump(`/sports/${OPERATOR}/${LANG}/${m.id}/match-odds/${Object.keys(MARKETS).join(',')}`); }
      catch (err) { console.log(`  ! ${m.name}: ${err.message}`); continue; }

      const byMarket = pricesByMarket(odds);
      const home = m.homeParticipantName || '', away = m.awayParticipantName || '';
      const matchName = `${home} vs ${away}`;
      let made = 0;

      for (const [market, list] of Object.entries(byMarket)) {
        // Minden kimenetelt selection-re forditunk. Ha barmelyik nem
        // ertelmezheto, az EGESZ piacot kihagyjuk: a de-vig csak teljes
        // piacon ertelmes, es egy hianyos piac torzitott valoszinuseget adna.
        const mapped = list.map(o => ({ sel: toSelection(market, o, home, away), odds: o.odds }));
        if (mapped.some(x => !x.sel)) {
          skipped.push(`${matchName} / ${market}: ertelmezhetetlen kimenetel`);
          continue;
        }
        const seen = new Set(mapped.map(x => x.sel));
        if (seen.size !== mapped.length) { skipped.push(`${matchName} / ${market}: ismetlodo kimenetel`); continue; }
        const d = devig(mapped);
        if (!d) { skipped.push(`${matchName} / ${market}: de-vig nem szamolhato`); continue; }

        mapped.forEach((x, i) => {
          legs.push({
            leg_id: `${m.id}-${market}-${x.sel}`,
            event_id: String(m.id),
            match_name: matchName,
            league: (m.parentName || cup).replace(/\s*\d{4}\/\d{4}\s*$/, '').trim(),
            kickoff: new Date(Number(m.startTime)).toISOString(),
            market, selection: x.sel,
            label: LABELS[x.sel] || x.sel,
            // Nincs modell ezeken a labakon - a csapaterossegek ligankent
            // vannak kulcsolva, egy kupameccs ket ligabol jon.
            model_prob: null,
            market_prob: Math.round(d.probs[i] * 10000) / 10000,
            // A VALODI Tippmix-ar, nem a tippmixRatio() becslese.
            tippmix_odds: x.odds,
            market_avg_odds: x.odds,
            // Egy konyv van, tehat nincs jobb ar maskent - a kimenet igy
            // nem ajanl line shoppingot ezeken a labakon.
            best_odds: x.odds,
            confidence: 'KUPA',
            news_flag: 'ok',
            news_note: '',
            created_at: new Date().toISOString(),
            boost_odds: null,
            is_boosted: null,
          });
          made++;
        });
      }
      const h = ((Number(m.startTime) - now) / 3600000).toFixed(1);
      console.log(`  ${String(h).padStart(6)}h  ${matchName.padEnd(38).slice(0, 38)}  ${made} lab`);
    }
    console.log();
  }

  if (skipped.length) {
    // Soha nem csendben. Ez a resz romlik el eloszor.
    console.log(`KIHAGYOTT PIACOK (${skipped.length}):`);
    const why = {};
    for (const s of skipped) { const k = s.split(': ')[1]; why[k] = (why[k] || 0) + 1; }
    for (const [k, c] of Object.entries(why).sort((a, b) => b[1] - a[1])) console.log(`   ${String(c).padStart(3)}x ${k}`);
    console.log();
  }

  const byMarket = {};
  for (const l of legs) byMarket[l.market] = (byMarket[l.market] || 0) + 1;
  console.log(`Osszesen ${legs.length} lab, ${new Set(legs.map(l => l.event_id)).size} meccsbol`);
  console.log(`  piaconkent: ${Object.entries(byMarket).map(([k, v]) => k + ' ' + v).join(', ')}`);

  if (!doWrite) {
    console.log('\n(szaraz futas - a slate NEM valtozott. Iras: node cups_fetch.js --write)');
    feed.close();
    return;
  }
  feed.close();

  if (!legs.length) { console.log('\nNincs mit beirni.'); return; }

  // Idempotencia: a mar bent levo leg_id-ket nem irjuk be ujra. A Slate
  // Builder a sajat futasakor torli a tablat (Clear Slate), tehat a kupa-
  // labak is eltunnek - ezert ezt a scriptet a slate frissitese UTAN kell
  // futtatni. Duplikatum igy sem keletkezhet.
  const existing = await existingLegIds(apiUrl, apiKey);
  const fresh = legs.filter(l => !existing.has(l.leg_id));
  const dupes = legs.length - fresh.length;
  if (dupes) console.log(`\n${dupes} lab mar bent van (kihagyva)`);
  if (!fresh.length) { console.log('Minden lab bent van mar.'); return; }

  // Kotegelve irunk: egy 200 labas POST tulsagosan nagy lehet.
  let written = 0;
  for (let i = 0; i < fresh.length; i += 50) {
    const batch = fresh.slice(i, i + 50);
    try { await insertRows(apiUrl, apiKey, batch); written += batch.length; }
    catch (err) { console.log(`  ! koteg ${i / 50 + 1}: ${err.message}`); }
  }
  console.log(`\nBeirva: ${written}/${fresh.length} lab a bet_slate tablaba.`);
})();
