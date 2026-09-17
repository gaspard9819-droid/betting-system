// Megeri-e az Oddspiramis? Meres, nem becsles.
//
// A KERDES: a szelvenyepito a LEGKEVESEBB labat valasztja, mert a margo
// labankent szorzodik. Az Oddspiramis ezzel szemben a SOK labat jutalmazza:
// min. 4 lab, mind >= @1.30, es a vegen a teljes szorzot emeli 5%-tol 60%-ig.
// Melyik nyer?
//
// A szamitas: n lab utan a fair ertekbol (1/(1+m))^n marad, ahol m a
// labankenti margo. A piramis ezt egyszer megszorozza (1+b_n)-nel. Tehat
//
//     nettó megtartas = (1 + b_n) / (1 + m)^n
//
// Ez akkor ver egy 2 labas szelvenyt, ha a fenti nagyobb, mint 1/(1+m)^2.
//
// AMIT MERUNK: az m-et piaconkent, a feed valos arabol. A piramis TIZ piacot
// enged, mi eddig harmat neztunk - ha valamelyik "uj" piac lenyegesen olcsobb
// (pl. 3%), a szamitas atbillenhet.
//
// A margo (overround) egy piacon: sum(1/odds) - 1. Csak TELJES piacot
// szamolunk (minden kimenetel megvan), kulonben az osszeg ertelmetlen.
//
// FONTOS KORLAT: a "1X2 - Szuper odds" (693) NEM resze az Oddspiramisnak.
// A ket akcio nem kombinalhato - ezert a boostolt ~2%-os margo NEM all
// rendelkezesre piramis-szelvenyen. A meres ezt kulon oszlopban mutatja,
// hogy latszodjon, mennyit ER a kizaras.
//
// FUTTATAS:  node pyramid_check.js [--matches 20]

const WS_URL = 'wss://sportsapi.tippmixpro.hu/v2';
const OPERATOR = '2901';
const LANG = 'hu';

// Az Oddspiramis emelese labszam szerint. Forras: a Tippmixpro akcio-leirasa
// (tobb fuggetlen osszefoglalo egyezoen adja; 13-nal az egyik 50%-ot, a masik
// 60%-ot ir - a konzervativ 50%-ot vesszuk, hogy ne felulbecsuljuk).
const PYRAMID = { 4: 0.05, 5: 0.10, 6: 0.15, 7: 0.20, 8: 0.25, 9: 0.30,
                  10: 0.35, 11: 0.40, 12: 0.45, 13: 0.50, 14: 0.60 };

// A piramisban MINOSULO piacok, a feed kodjaival. A nevek a --markets
// felderitesbol valok (tippmix_feed.js --markets).
//
// Az "1X2 - Szuper odds" (693) SZANDEKOSAN nincs itt: ki van zarva az
// akciobol. Kulon merjuk, referenciakent.
const QUALIFYING = {
  '69-3':  '1X2',
  '76-3':  'Mindket csapat szerez golt',
  '47-3':  'Golszam (O/U)',
  '8-3':   'Hendikep',
  '48-3':  'Azsiai hendikep',
  '118-3': 'Szogletszam',
  '45-3':  'Pontos eredmeny',
};

// KIHAGYVA: Ketesely (9-3). A margo keplete - sum(1/odds) - 1 - csak akkor
// ertelmes, ha a kimenetelek EGYMAST KIZAROK es egyutt lefedik a teret. A
// ketesely harom kimenetele (1X, 12, X2) atfedi egymast: minden eredmeny
// kettoben is benne van, ezert az osszeg ~2 korul all, es 117%-os "margot"
// mutatna. A valos margo kb. (merten 117.46% - 100%) / 2, de ezt itt nem
// szamoljuk ki - felrevezetobb lenne egy kulon keplettel becsult szamot
// ugyanabba a tablaba tenni. Merve 2026-09-16, 18 piacon.
const REFERENCE = { '693-3': '1X2 - Szuper odds (KIZARVA a piramisbol)' };

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

    ws.onerror = () => { clearTimeout(timer); reject(new Error('WebSocket hiba')); };
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
              const to = setTimeout(() => { pending.delete(id); rej(new Error('idotullepes')); }, ms);
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

// Egy MARKET osszes ara. A margot csak TELJES piacon lehet szamolni, ezert a
// kimeneteleket piaconkent (marketId) csoportositjuk, nem piactipusonkent:
// egy piactipusnak tobb vonala is lehet (pl. hendikep +1, +2), es azok KULON
// piacok - osszeadva ertelmetlen szamot adnanak.
function marketsOf(records) {
  const outcomes = new Map(records.filter(r => r._type === 'OUTCOME').map(o => [o.id, o]));
  const offers = new Map();
  for (const b of records.filter(r => r._type === 'BETTING_OFFER')) offers.set(b.outcomeId, b);
  const rel = {};
  for (const r of records.filter(r => r._type === 'MARKET_OUTCOME_RELATION')) (rel[r.marketId] = rel[r.marketId] || []).push(r.outcomeId);

  const out = [];
  for (const mk of records.filter(r => r._type === 'MARKET')) {
    if (mk.isClosed) continue;
    const ids = rel[mk.id] || [];
    const prices = [];
    let missing = 0;
    for (const id of ids) {
      const off = offers.get(id), oc = outcomes.get(id);
      if (!oc || !off || off.isAvailable === false || !Number.isFinite(off.odds)) { missing++; continue; }
      prices.push(off.odds);
    }
    // Hianyos piac margoja ertelmetlen (az osszeg alulrol torzit), ezert
    // kihagyjuk - de a szamat jelentjuk, hogy ne tunjon el csendben.
    out.push({
      code: mk.bettingTypeId + '-' + mk.eventPartId,
      name: mk.bettingTypeName,
      marketName: mk.name,
      complete: missing === 0 && prices.length === ids.length && prices.length >= 2,
      n: prices.length, missing, prices,
      overround: prices.length >= 2 ? prices.reduce((s, o) => s + 1 / o, 0) - 1 : null,
      // Az Oddspiramis minden labra >= @1.30-at kovetel meg.
      usable: prices.filter(o => o >= 1.30).length,
    });
  }
  return out;
}

(async () => {
  const args = process.argv.slice(2);
  const want = args.includes('--matches') ? Number(args[args.indexOf('--matches') + 1]) : 20;

  console.log('Csatlakozas a Tippmixpro feedhez...');
  const feed = await connect();
  const recs = await feed.dump(`/sports/${OPERATOR}/${LANG}/highlighted-popular-matches-aggregator-groups-overview/1/50/1380/default-event-info/or1.0-100.0`);
  const matches = recs.filter(r => r._type === 'MATCH').slice(0, want);
  console.log(`  OK - ${matches.length} meccset merek\n`);

  const codes = [...Object.keys(QUALIFYING), ...Object.keys(REFERENCE)].join(',');
  const stats = {};        // code -> { over: [], usable: 0, total: 0, incomplete: 0 }
  const bump = c => (stats[c] = stats[c] || { over: [], usable: 0, legs: 0, incomplete: 0, matches: 0 });

  for (const m of matches) {
    let odds;
    try { odds = await feed.dump(`/sports/${OPERATOR}/${LANG}/${m.id}/match-odds/${codes}`); }
    catch (err) { console.log(`  ! ${m.name}: ${err.message}`); continue; }
    const mkts = marketsOf(odds);
    const seenHere = new Set();
    for (const mk of mkts) {
      if (!QUALIFYING[mk.code] && !REFERENCE[mk.code]) continue;
      const s = bump(mk.code);
      if (!seenHere.has(mk.code)) { s.matches++; seenHere.add(mk.code); }
      s.legs += mk.n;
      s.usable += mk.usable;
      if (!mk.complete || mk.overround === null) { s.incomplete++; continue; }
      s.over.push(mk.overround);
    }
  }
  feed.close();

  const med = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = Math.floor(s.length / 2); return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };

  console.log('=== MARGO PIACONKENT (a feed valos araibol) ===\n');
  console.log('  piac                              meccs  piac  median  atlag   >=1.30 lab');
  const rows = [];
  for (const [code, label] of [...Object.entries(QUALIFYING), ...Object.entries(REFERENCE)]) {
    const s = stats[code];
    if (!s || !s.over.length) { console.log(`  ${label.padEnd(34)}  -  nincs meresi adat`); continue; }
    const mdn = med(s.over), avg = s.over.reduce((a, b) => a + b, 0) / s.over.length;
    rows.push({ code, label, mdn, avg, usable: s.usable });
    console.log(`  ${label.padEnd(34)}${String(s.matches).padStart(4)}${String(s.over.length).padStart(6)}`
      + `${(mdn * 100).toFixed(2).padStart(8)}%${(avg * 100).toFixed(2).padStart(7)}%${String(s.usable).padStart(10)}`
      + (s.incomplete ? `   (${s.incomplete} hianyos kihagyva)` : ''));
  }

  // --------------------------------------------------------------- a dontes
  console.log('\n=== MEGERI-E A PIRAMIS? ===');
  console.log('Megtartott ertek a fair erteknek. 100% = nulla margo.');
  console.log('A referencia a 2 labas szelveny piramis nelkul - azt kell megverni.\n');

  const qualifying = rows.filter(r => QUALIFYING[r.code]);
  if (!qualifying.length) { console.log('Nincs merheto minosulo piac.'); return; }

  // A legolcsobb minosulo piac adja a legjobb esélyt a piramisnak.
  const best = qualifying.reduce((a, b) => (a.mdn <= b.mdn ? a : b));
  const worst = qualifying.reduce((a, b) => (a.mdn >= b.mdn ? a : b));
  const all = qualifying.reduce((s, r) => s + r.mdn, 0) / qualifying.length;

  for (const [tag, m] of [
    [`a LEGOLCSOBB minosulo piac (${best.label})`, best.mdn],
    ['a minosulo piacok ATLAGA', all],
    [`a LEGDRAGABB minosulo piac (${worst.label})`, worst.mdn],
  ]) {
    console.log(`--- ${tag}: ${(m * 100).toFixed(2)}% margo ---`);
    const ref = 1 / Math.pow(1 + m, 2);
    let bestN = null;
    for (let n = 2; n <= 14; n++) {
      const plain = 1 / Math.pow(1 + m, n);
      const b = PYRAMID[n] || 0;
      const val = plain * (1 + b);
      if (!bestN || val > bestN.val) bestN = { n, val };
      const flag = n >= 4 && val > ref ? '  <-- VERI a 2 labast' : '';
      console.log(`   ${String(n).padStart(2)} lab  ${(plain * 100).toFixed(1).padStart(6)}% -> ${(val * 100).toFixed(1).padStart(6)}%${b ? '  (+' + (b * 100).toFixed(0) + '%)' : '        '}${flag}`);
    }
    console.log(`   >>> a legjobb: ${bestN.n} lab, ${(bestN.val * 100).toFixed(1)}%`
      + (bestN.n === 2 ? '  = a piramis NEM eri meg ezen a piacon' : '  = a piramis MEGERI'));
    console.log();
  }
})();
