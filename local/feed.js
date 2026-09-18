// WAMP kliens a Tippmixpro sportsapi feedhez.
//
// MIERT KULON MODUL: ez a kliens ma NEGYSZER szerepel szo szerint a repoban
// (tippmix_feed.js:79, tippmix_discover.js:38, cups_fetch.js:64,
// boost_fetch.js:47), mindegyikben egy kommenttel, hogy a masolas szandekos,
// mert a tippmix_feed.js nem exportal. Ez a modul exportal, tehat a local/
// pipeline egy peldanyt hasznal.
//
// A research/ scriptek VALTOZATLANOK maradnak - azok mert eredmenyeket
// szolgaltattak, es egy refaktor tobbet kockaztat, mint amennyit er.
//
// MIERT NEM n8n Code node: ott nincs `WebSocket` globalis (merve 2026-09-15,
// eldobhato szonda-workflow-val: `hasWebSocketGlobal: false`), es a feednek
// nincs REST-alternativaja - minden HTTP-ut 404/502.

const WS_URL = 'wss://sportsapi.tippmixpro.hu/v2';
const OPERATOR = '2901';
const LANG = 'hu';

// A WAMP RESULT uzenet payloadja az UTOLSO elem, nem a negyedik.
//
// Ez nem kozmetika: egy `m[3]`-bol olvaso szonda 0 rekordot kapott ugyanarra a
// topikra, amire a boost_fetch.js 50 meccset latott (merve 2026-09-18). A hiba
// nem ad kivetelt - ures tombot ad, ami "nincs talalat"-kent olvasodik.
function payloadOf(m) {
  const pl = m[m.length - 1];
  return (pl && pl.records) || [];
}

function connect(timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const pending = new Map();
    let reqId = 0;
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('idotullepes a csatlakozasnal'));
    }, timeoutMs);

    ws.onopen = () => ws.send(JSON.stringify([1, 'www.tippmixpro.hu', {
      agent: 'Wampy.js v6.2.2',
      roles: {
        subscriber: { features: { pattern_based_subscription: true, publication_trustlevels: true } },
        caller: { features: { caller_identification: true, progressive_call_results: true, call_canceling: true, call_timeout: true } },
      },
      authmethods: ['wampcra'], authid: 'webapi-wampy',
    }]));

    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('WebSocket hiba - elerheto a sportsapi.tippmixpro.hu?'));
    };

    ws.onclose = ev => {
      clearTimeout(timer);
      for (const [, p] of pending) p.reject(new Error('a kapcsolat lezarult (code ' + ev.code + ')'));
      pending.clear();
    };

    ws.onmessage = e => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }

      // WELCOME
      if (m[0] === 2) {
        clearTimeout(timer);
        resolve({
          dump(topic, ms = 25000) {
            return new Promise((res, rej) => {
              const id = ++reqId;
              const to = setTimeout(() => {
                pending.delete(id);
                rej(new Error('idotullepes: ' + topic.slice(0, 80)));
              }, ms);
              pending.set(id, {
                resolve: v => { clearTimeout(to); res(v); },
                reject: v => { clearTimeout(to); rej(v); },
              });
              ws.send(JSON.stringify([48, id, {}, '/sports#initialDump', [], {
                topic, ctx: { v: '2', lang: LANG, tz: -120 },
              }]));
            });
          },
          close: () => { try { ws.close(); } catch {} },
        });
        return;
      }

      // RESULT
      if (m[0] === 50 && pending.has(m[1])) {
        const p = pending.get(m[1]);
        pending.delete(m[1]);
        p.resolve(payloadOf(m));
        return;
      }

      // ERROR
      if (m[0] === 8) {
        const id = m[2];
        if (pending.has(id)) {
          const p = pending.get(id);
          pending.delete(id);
          const kw = m[m.length - 1];
          p.reject(new Error((kw && kw.desc) || 'ismeretlen feed-hiba'));
        }
      }
    };
  });
}

// ------------------------------------------------------------------- topikok
//
// Mind a negy alak a meglevo scriptekbol jon, valtoztatas nelkul. A `1380`
// szegmens es az `or1.0-100.0` odds-szuro a frontend sajat hivasaibol szarmazik.

const topics = {
  // A Tippmixpro szerkesztoi "kiemelt" valogatasa.
  //
  // FIGYELEM: ez NEM tartalmazza a Szuper oddsos meccseket. Merve 2026-09-18:
  // mind az ot aktualis boostolt meccs (Brighton-Arsenal, Sevilla-Barcelona,
  // Stuttgart-Dortmund, Roma-Inter, DVSC-Vasas) hianyzott belole 50-es ES
  // 200-as lapmerettel is. Ezert epit a catalog.js bajnoksagonkent.
  highlighted: (limit = 50) =>
    `/sports/${OPERATOR}/${LANG}/highlighted-popular-matches-aggregator-groups-overview/1/${limit}/1380/default-event-info/or1.0-100.0`,

  // Egy bajnoksag/kupa meccsei. Ez lat MINDEN meccset, nem csak a kiemelteket.
  tournament: tid =>
    `/sports/${OPERATOR}/${LANG}/tournament-aggregator-groups-overview/${tid}/default-event-info/BOTH/1380`,

  // Egy meccs piacai. Kod nelkul MINDEN piacot ad (~987 egy topligas meccsen,
  // merve 2026-09-18 a Tottenham-Aston Villa meccsen), kodokkal szurve csak
  // a felsoroltakat.
  matchOdds: (matchId, codes) =>
    codes
      ? `/sports/${OPERATOR}/${LANG}/${matchId}/match-odds/${codes}`
      : `/sports/${OPERATOR}/${LANG}/${matchId}/match-odds`,

  // Kategoria bajnoksagai - id-felderiteshez, ha egy tournament id elavul.
  tournaments: (sport, cat) =>
    `/sports/${OPERATOR}/${LANG}/tournaments/${sport}/${cat}`,
};

module.exports = { connect, topics, WS_URL, OPERATOR, LANG };
