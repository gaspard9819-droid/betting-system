// Bajnoksag-azonosito felderites a Tippmixpro feedbol.
//
// MIERT: a `tippmix_feed.js` LEAGUES tablaja ot hazai bajnoksagot ismer, es a
// The Odds API sem kinal mast. Emiatt a slate-rol lemaradnak a nemzetkozi
// kupak (BL, EL, Konferencia Liga) - szerda-csutortokon ez jellemzoen 10-20
// meccs, es ilyenkor a szelvenyepito 2-3 meccsbol probal valogatni.
//
// A `tippmix_feed.js` fejlece leirja, hogyan kell egy elavult bajnoksag-idet
// megtalalni: a `/sports/2901/hu/tournaments/1/<kategoria>` tema listazza egy
// kategoria bajnoksagait. Ez a script ugyanazt teszi, csak vegigmegy a
// kategoriakon, es ki is irja, amit talal - igy uj bajnoksagot felvenni nem
// bongeszo-felderitest jelent, hanem egy parancsot.
//
// FUTTATAS (a betting-research mappabol):
//   node tippmix_discover.js                 # a nemzetkozi kategoriak vegigkerdezese
//   node tippmix_discover.js --cat 393       # egy konkret kategoria bajnoksagai
//   node tippmix_discover.js --scan 1-600    # kategoria-id sav vegigprobalasa
//
// A kimenet a `LEAGUES` tablaba beilleszthето alakban is megjelenik.

const WS_URL = 'wss://sportsapi.tippmixpro.hu/v2';
const OPERATOR = '2901';
const LANG = 'hu';

// A labdarugas sportId a temaban 1 (lasd tippmix_feed.js fejlec).
const SPORT = '1';

// Ismert kategoriak a tippmix_feed.js fejlecebol, referenciaként. A nemzetkozi
// kupak nem orszaghoz tartoznak, ezert sajat kategoriaban vannak - a --scan
// ezeket keresi meg.
const KNOWN = { 77: 'Anglia', 65: 'Spanyolorszag', 54: 'Nemetorszag',
                111: 'Olaszorszag', 73: 'Franciaorszag' };

// ---------------------------------------------------------------- WAMP kliens
// Szandekosan a tippmix_feed.js-bol atvett alak: az a fajl nem exportal, es
// ket helyen egy 60 soros protokoll-kliens kevesebb kart tesz, mint egy
// refaktor azon a scripten, ami mar kalibraciot szolgaltatott.
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
          dump(topic, ms = 20000) {
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

// Egy kategoria bajnoksagai. A rekordok laposan jonnek, `_type` jeloli oket.
async function tournaments(feed, cat) {
  const recs = await feed.dump(`/sports/${OPERATOR}/${LANG}/tournaments/${SPORT}/${cat}`);
  return recs.filter(r => r._type === 'TOURNAMENT' || r._type === 'CATEGORY' || r.name);
}

(async () => {
  const args = process.argv.slice(2);
  const catArg = args.includes('--cat') ? args[args.indexOf('--cat') + 1] : null;
  const scanArg = args.includes('--scan') ? args[args.indexOf('--scan') + 1] : null;

  console.log('Csatlakozas a Tippmixpro feedhez...');
  const feed = await connect();
  console.log('  OK\n');

  const show = (cat, recs) => {
    const ts = recs.filter(r => r._type === 'TOURNAMENT');
    const cs = recs.filter(r => r._type === 'CATEGORY');
    if (!ts.length && !cs.length) return 0;
    console.log(`kategoria ${cat}${KNOWN[cat] ? ' (' + KNOWN[cat] + ')' : ''}:`);
    for (const c of cs) console.log(`    [CATEGORY] ${c.id}  ${c.name}`);
    for (const t of ts) console.log(`    '${t.name}': '${t.id}',`);
    console.log();
    return ts.length + cs.length;
  };

  try {
    if (catArg) {
      show(catArg, await tournaments(feed, catArg));
    } else if (scanArg) {
      const [lo, hi] = scanArg.split('-').map(Number);
      let hits = 0;
      for (let c = lo; c <= hi; c++) {
        let recs;
        try { recs = await tournaments(feed, c); } catch { continue; }
        if (show(c, recs)) hits++;
      }
      console.log(`\n${hits} kategoria adott talalatot a ${lo}-${hi} savban.`);
    } else {
      // Alapmod: a nemzetkozi kupak kategoriaja nem orszag, ezert a kis
      // id-ket probaljuk vegig - a feedben a nemzetkozi kategoriak jellemzoen
      // a lista elejen vannak. Ha nem talalja, a --scan a teljesebb eszkoz.
      for (const c of [1, 2, 3, 4, 5, 7, 8, 9, 10, 12, 285, 393, 1000]) {
        let recs;
        try { recs = await tournaments(feed, c); } catch { continue; }
        show(c, recs);
      }
      console.log('Ha a BL/EL nincs a listaban: node tippmix_discover.js --scan 1-600');
    }
  } catch (err) {
    console.error('HIBA: ' + err.message);
    feed.close(); process.exit(1);
  }
  feed.close();
})();
