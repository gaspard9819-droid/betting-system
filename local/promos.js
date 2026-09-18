// Tippmixpro promociok lekerese - bejelentkezes NELKUL.
//
// MIERT NEM PLAYWRIGHT: a promociok oldal szerver-oldali HTML-je tartalmazza a
// promok strukturalt adatat (bonusCode, cim, teljes feltetelszoveg). Merve
// 2026-09-19: a `fetch` visszaadja, bongeszo nem kell. Ez gyorsabb, nem
// detektalhato botkent, es nem igenyel bejelentkezest.
//
// AMI NEM MEGY IGY: a fiokhoz kotott ajanlatok es az aktiv forgatasi allapot
// (Bonuszaim menu) - azok bejelentkezest igenyelnek. Ez a script csak a
// publikus kinalatot latja.
//
// CSAPDA, amit kezelni kell: a HTML az OSSZES valaha volt promot tartalmazza,
// visszamenoleg 2024-ig (merve: 250+ bonuszkod egy lekeresben). Az `expiryDate`
// mezo ures, a `location` tomb mindegyiken azonos - tehat a strukturabol NEM
// derul ki, melyik aktiv. Az idoszakot a feltetelszoveg mondja meg:
// "A bonuszajanlat idoszaka: 2026.09.17. 16:00 - 2026.09.20. 23:59"

const URL = 'https://www.tippmixpro.hu/hu/promociok';

// "2026.09.17. 16:00 – 2026.09.20. 23:59" (a gondolatjel lehet - vagy –)
const PERIOD_RX = /(\d{4})\.(\d{2})\.(\d{2})\.?\s*(\d{2}):(\d{2})\s*[–-]\s*(\d{4})\.(\d{2})\.(\d{2})\.?\s*(\d{2}):(\d{2})/;

function parsePeriod(text) {
  const m = PERIOD_RX.exec(text || '');
  if (!m) return null;
  const mk = (y, mo, d, h, mi) => new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  return { from: mk(m[1], m[2], m[3], m[4], m[5]), to: mk(m[6], m[7], m[8], m[9], m[10]) };
}

function stripHtml(s) {
  return String(s || '')
    .replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\"/g, '"')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|ul|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// A promo-blokkokat a bonusCode koré vagjuk: a mezok egy JSON-objektumban
// vannak, de a HTML-be agyazva escape-elve, tehat teljes JSON.parse nem megy
// megbizhatoan. A kod korulli ablakbol szedjuk ki, ami kell.
function extractPromos(html) {
  const out = [];
  const rx = /"bonusCode":"([^"]+)"/g;
  let m;
  while ((m = rx.exec(html)) !== null) {
    const code = m[1];
    // Visszafele keressuk a leiro szoveget, elore a linket/cimet.
    const before = html.slice(Math.max(0, m.index - 14000), m.index);
    const after = html.slice(m.index, m.index + 2500);

    const titleM = /"(?:promotionTitle|cardTitle|title)":"([^"]{5,200})"/g;
    let title = null;
    let t;
    while ((t = titleM.exec(before)) !== null) title = t[1];   // az utolso a legkozelebbi

    const ribbonM = /"ribbonText":"([^"]*)"/.exec(after);
    const detailsM = /"detailsTitle":"([^"]*)"/.exec(after);

    // A promo sajat szovege: az ELOZO promo vegeig visszafele.
    //
    // Fix hosszu ablak atlog a szomszed promo szovegebe, es onnan szed
    // szamot - merve 2026-09-19: harom promo kapott hamis `minOdds: 4.08`-at
    // a kovetkezo ajanlat szovegebol. A `"id":` vagy `"promotionId":` mezo
    // jelzi az elozo rekord kezdetet.
    const bound = Math.max(
      before.lastIndexOf('"promotionId"'),
      before.lastIndexOf('"promotion_id"'),
      before.lastIndexOf('"bonusCode"'),
    );
    const own = bound > 0 ? before.slice(bound) : before.slice(-12000);
    const body = stripHtml(own);
    const period = parsePeriod(body);

    out.push({
      code,
      title: title ? stripHtml(title) : null,
      ribbon: ribbonM ? ribbonM[1] : null,
      action: detailsM ? detailsM[1] : null,
      period,
      text: body,
    });
  }
  return out;
}

// --------------------------------------------------------------- feltetelek
//
// A forgatasi feltetelek a szovegbol. Ezek a mezok dontik el, hogy megeri-e:
// a forgatasi szorzo, a minimum eredo odds es a minimum kotesszam egyutt
// hatarozza meg, mennyit kell atforgatni es milyen szelvenyeken.

function parseTerms(text) {
  const t = String(text || '');

  // Tizedes szam (odds, szorzo): a vesszo tizedesjel.
  const dec = rx => { const m = rx.exec(t); return m ? Number(String(m[1]).replace(',', '.')) : null; };

  // Forint-osszeg: a PONT ezres elvalaszto, nem tizedesjel.
  // "5.000 Ft" -> 5000, nem 5. Ez a kulonbseg nem kozmetikai: 5 Ft-os
  // bonuszra minden itelet ertelmetlen.
  const ft = rx => {
    const m = rx.exec(t);
    if (!m) return null;
    const n = Number(String(m[1]).replace(/[.\s ]/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  const FT = '(\\d[\\d.\\s\\u00a0]*)';

  return {
    rolloverX:   dec(/forgatási követelménye\s*(\d+(?:[.,]\d+)?)\s*x/i),
    // CSAK a kovetelmeny-megfogalmazasok. A promo-szovegek tele vannak
    // PELDASZAMITASSAL ("a fogadas eredo oddsertéke 4,08"), es egy laza
    // regex azt olvassa kovetelmenynek - merve 2026-09-19: harom promo
    // kapott hamis `minOdds: 4.08`-at egy magyarazo bekezdesbol.
    minOdds:     dec(/minimum eredő odds(?:követelménye|a)?:?\s*(\d+(?:[.,]\d+)?)/i)
              || dec(/legalább\s*(\d+(?:[.,]\d+)?)\s*(?:-e?s|-as)?\s*eredő odds/i),
    // Ugyanez: "A harmas kotesben megtett fogadasban..." nem kovetelmeny.
    minFold:     dec(/legalább\s*(\d+)-as kötésben kell/i)
              || dec(/fogadásokat\s*legalább\s*(\d+)-as kötésben/i),
    maxBonusFt:  ft(new RegExp(`legfeljebb\\s*${FT}\\s*Ft`, 'i'))
              || ft(new RegExp(`${FT}\\s*Ft-ig`, 'i')),
    minDepositFt: ft(new RegExp(`legalább\\s*${FT}\\s*Ft (?:értékű )?(?:feltöltés|befizetés)`, 'i'))
               || ft(new RegExp(`feltöltenek[^.]{0,60}?legalább\\s*${FT}\\s*Ft`, 'i')),
    deadlineHours: dec(/Forgatási határidő:?\s*(?:bónusz jóváírástól számított\s*)?(\d+)\s*óra/i),
    // Veszteseg-alapu promo: nem nyeremeny kell hozza, hanem deficit.
    deficitFt:   ft(new RegExp(`legalább\\s*${FT}\\s*Ft értékű deficit`, 'i')),
    liveOnly:    /kizárólag.{0,60}élő fogadások? számítanak/i.test(t),
    // Ingyen tet: nincs forgatas, mert nem sajat penz forog.
    freeBet:     /ingyenes fogadás/i.test(t) && !/forgatási követelmény/i.test(t),
    // Odds-emeles: nem bonusz, hanem jobb ar.
    oddsBoost:   /magasabb oddson|oddsemelés|megnövelt odds/i.test(t),
  };
}

// --------------------------------------------------------------------- itelet
//
// A repo merese szerint (CLAUDE.md): ingyen tet, visszaterites es befizetesi
// bonusz pozitiv EV-ju. DE a "visszaterites" szo felrevezeto lehet: ha a
// feltetel VESZTESEG (deficit), akkor nem visszaterites, hanem
// veszteseg-jutalom - azt ki kell fizetni, hogy megkapd.
function judge(terms) {
  // Veszteseg-alapu: a bonuszert fizetni kell.
  if (terms.deficitFt) {
    const ratio = terms.maxBonusFt ? terms.deficitFt / terms.maxBonusFt : null;
    return {
      verdict: 'kerulendo',
      why: `${fmtFt(terms.deficitFt)} nettó veszteséget kell elérni a bónuszért` +
           (ratio ? ` (${ratio.toFixed(1)}x annyit, mint amennyit kapsz)` : '') +
           ` — ez nem visszatérítés, hanem veszteség-jutalom. Csak akkor éri meg, ` +
           `ha amúgy is ekkora tétekkel fogadnál.`,
    };
  }

  // Ingyen tet forgatas nelkul: tiszta pozitivum.
  if (terms.freeBet && !terms.rolloverX) {
    return {
      verdict: 'megeri',
      why: `Ingyenes fogadás forgatási követelmény nélkül — nincs mit mérlegelni, ` +
           `vidd el. A tét nem a te pénzed.`,
      estCostPct: 0,
    };
  }

  // Odds-emeles: nem bonusz, hanem jobb ar ugyanarra a fogadasra.
  if (terms.oddsBoost && !terms.rolloverX) {
    return {
      verdict: 'megeri',
      why: `Odds-emelés: ugyanarra az eseményre magasabb ár. Ez margó-csökkentés, ` +
           `ami a rendszer egyetlen bizonyítottan működő eleme.`,
      estCostPct: 0,
    };
  }

  // Befizetesi bonusz: a forgatas koltsege szamolhato.
  if (terms.rolloverX) {
    const folds = terms.minFold || 1;
    // A margo labankent szorzodik. 1X2 median 6.15% (README.md:368),
    // boostolt piacon 2.22% - ezert eri meg boostolt labbal forgatni.
    const perLeg = 0.0615;
    const perSlip = 1 - Math.pow(1 - perLeg, folds);
    const costPct = terms.rolloverX * perSlip * 100;

    const parts = [`${terms.rolloverX}x forgatás`];
    if (terms.minFold) parts.push(`${terms.minFold}-as kötésben`);
    if (terms.minOdds) parts.push(`min. ${terms.minOdds} eredő`);

    return {
      verdict: costPct < 60 ? 'megeri' : 'hatareset',
      why: `${parts.join(', ')}: a forgatás becsült költsége a bónusz ` +
           `${costPct.toFixed(0)}%-a (${folds} láb × ~6,2% margó). ` +
           `Boostolt lábakkal lényegesen kevesebb (~2,2%/láb).`,
      estCostPct: costPct,
      // A tenyleges kitettseg: a forgatast SAJAT penzbol kell megtenni,
      // mert a tet-sorrend szerint a bonusz fizet utoljara.
      ownMoneyNeeded: terms.maxBonusFt ? terms.maxBonusFt * terms.rolloverX : null,
    };
  }

  return { verdict: 'ismeretlen', why: 'A feltételek nem olvashatók ki a szövegből.' };
}

function fmtFt(n) {
  return n === null || n === undefined ? '?' : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' Ft';
}

// ------------------------------------------------------------------- lekeres
async function fetchPromos({ activeOnly = true, now = new Date() } = {}) {
  const r = await fetch(URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`promociok lekerese: HTTP ${r.status}`);
  const html = await r.text();

  let promos = extractPromos(html);

  // Duplikatum: ugyanaz a kod tobbszor is elofordulhat a HTML-ben.
  const seen = new Set();
  promos = promos.filter(p => { if (seen.has(p.code)) return false; seen.add(p.code); return true; });

  promos = promos.map(p => ({ ...p, terms: parseTerms(p.text) }));
  promos = promos.map(p => ({ ...p, judgement: judge(p.terms) }));

  if (activeOnly) {
    // Csak az, aminek az idoszaka MOST tart. Aminek nincs kiolvashato
    // idoszaka, az kimarad - inkabb hianyzik egy promo, mint hogy egy
    // 2024-es lejart ajanlatot aktivkent mutassunk.
    promos = promos.filter(p => p.period && p.period.from <= now && now <= p.period.to);
  }

  promos.sort((a, b) => (a.period && b.period) ? a.period.to - b.period.to : 0);
  return { promos, total: seen.size, fetchedAt: new Date().toISOString() };
}

module.exports = { fetchPromos, extractPromos, parseTerms, parsePeriod, judge, fmtFt, URL };
