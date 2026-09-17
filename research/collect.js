// EGY PARANCS: friss slate az n8n-bol + valos Tippmixpro arak + a gorbe ellenorzese.
//
// MIERT EGY FAJLBAN: a meres akkor ervenyes, ha a slate ara es a valos ar
// UGYANABBOL A PILLANATBOL valo. Ket kulon lepes kozott eltelik ido, es
// kozben a piac elmozdul - 2026-09-13-an 85 arbol 60 mozdult el ot ora alatt,
// es ettol latszott rossznak egy jo gorbe. Ezert a slate kiolvasasa es az
// argyujtes egy futasban van, nem ket parancsban.
//
// MIKOR FUTTASD: a 08:00-as Betting Slate Builder utan mihamarabb. A szkript
// kiirja, hany perces a slate, es figyelmeztet, ha tul regi.
//
// FUTTATAS (a betting-research mappabol):
//   node collect.js
//
// Kell hozza: N8N_API_KEY kornyezeti valtozo (Windows env var).
//
// MIT HAGY MAGA UTAN:
//   data/tippmix/slate_pairs_<idopont>.json   - a parok, tippmix_direct.js formatumban
// A nyers feed-kimenet is keletkezik (feed_*.json), de az gitignore-olt.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TABLE_ID = 'g6EjXi82TbW6VB91';   // bet_slate
const OUT_DIR = path.join(__dirname, 'data', 'tippmix');

// Az env var a hoszt-gyoker, /api/v1 nelkul - a vegpontokhoz kell.
const RAW = (process.env.N8N_API_URL || 'https://n8n-pwshg2jn0aifbcdupbtr9nu8.91.99.211.194.sslip.io').replace(/\/$/, '');
const BASE = RAW.endsWith('/api/v1') ? RAW : RAW + '/api/v1';
const KEY = process.env.N8N_API_KEY;

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
// A SZALLITOTT gorbe, szo szerint a Generate Legs node-bol.
const shippedRatio = (market, odds) => market === 'h2h' ? 1.0711 - 0.02066 * odds : 0.9992;

async function readSlate() {
  if (!KEY) throw new Error('nincs N8N_API_KEY kornyezeti valtozo');
  const url = `${BASE}/data-tables/${TABLE_ID}/rows`;
  const rows = [];
  let cursor = null;
  // FIGYELEM: a `skip`/`offset` parameter jelenleteben ez a vegpont URES
  // listat ad vissza. Csak a `cursor` mukodik - 2026-09-15-en mert viselkedes.
  while (true) {
    const q = '?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    const r = await fetch(url + q, { headers: { 'X-N8N-API-KEY': KEY } });
    if (!r.ok) throw new Error(`n8n API HTTP ${r.status} - jo az N8N_API_KEY?`);
    const j = await r.json();
    const d = Array.isArray(j.data) ? j.data : (j.data && j.data.rows) || [];
    rows.push(...d);
    cursor = j.nextCursor || (j.data && j.data.nextCursor) || null;
    if (!cursor || !d.length) break;
  }
  return rows;
}

(async () => {
  console.log('1) A friss slate kiolvasasa az n8n-bol');
  let slate;
  try { slate = await readSlate(); } catch (e) { console.error('   HIBA: ' + e.message); process.exit(1); }
  if (!slate.length) { console.error('   HIBA: a bet_slate ures - futott mar ma a Slate Builder?'); process.exit(1); }

  const ageMin = (Date.now() - new Date(slate[0].created_at)) / 60000;
  const byMarket = {};
  for (const r of slate) byMarket[r.market] = (byMarket[r.market] || 0) + 1;
  console.log(`   ${slate.length} lab (${JSON.stringify(byMarket)}), a slate ${ageMin.toFixed(1)} perces`);
  if (ageMin > 120) {
    console.log('   FIGYELEM: 2 oranal regebbi slate. A meres az idokozben elmozdult');
    console.log('   piacot merne, nem a Tippmixpro arreset. Futtasd a Slate Buildert eloszor.');
  }

  const tmp = path.join(os.tmpdir(), 'slate_for_collect.json');
  fs.writeFileSync(tmp, JSON.stringify(slate));

  console.log('\n2) Valos Tippmixpro arak gyujtese');
  // A gyujtot valtozatlanul hivjuk meg - egy helyen legyen a feed-logika.
  const out = execFileSync(process.execPath, [path.join(__dirname, 'tippmix_feed.js'), '--pair', tmp, '--limit=200'],
    { encoding: 'utf8', cwd: __dirname });
  // A gyujto reszletes listajabol csak az osszegzo sorokat mutatjuk.
  for (const line of out.split('\n')) {
    if (/^\d+ meccs|^Parositas|^  piaconkent|^  parok|^  a slate|FIGYELEM|PAROSITATLAN|^ {5}\d+x/.test(line)) console.log('   ' + line.trim());
  }

  const m = out.match(/parok: (.+slate_pairs_[^\s]+\.json)/);
  if (!m) { console.log('\n   Nem keszult parositas - nincs mit ertekelni.'); process.exit(0); }
  const pairFile = path.resolve(__dirname, m[1].trim());
  const pairs = JSON.parse(fs.readFileSync(pairFile, 'utf8'));
  if (!pairs.length) { console.log('\n   0 par - nincs mit ertekelni.'); process.exit(0); }

  console.log('\n3) A SZALLITOTT GORBE ELLENORZESE a valos arakon');
  const errs = { h2h: [], totals: [] };
  const far = [];
  for (const p of pairs) {
    const est = p.market_avg * shippedRatio(p.market, p.market_avg);
    const err = (est - p.real) / p.real * 100;
    (errs[p.market] || (errs[p.market] = [])).push(Math.abs(err));
    if (Math.abs(err) > 5) far.push({ ...p, err });
  }
  console.log('   piac    n    atlagos abszolut hiba');
  for (const [k, v] of Object.entries(errs)) {
    if (!v.length) continue;
    console.log(`   ${k.padEnd(7)} ${String(v.length).padStart(3)}   ${mean(v).toFixed(2)}%`);
  }
  const all = Object.values(errs).flat();
  console.log(`   OSSZES  ${String(all.length).padStart(3)}   ${mean(all).toFixed(2)}%`);
  console.log('   (a 2026-09-13-i kalibracio 2.31%-ot mert 45 paron)');

  if (far.length) {
    // Az 5% feletti elteres jellemzoen EXTRAPOLACIO: a gorbe mert tartomanya
    // 1X2-n kb. 1.2-5.5, e folott a becsles nem megbizhato.
    console.log(`\n   5% felett eltero (${far.length}):`);
    for (const f of far.slice(0, 8)) {
      console.log(`     ${f.market.padEnd(6)} ${String(f.market_avg).padEnd(6)} -> ${String(f.real).padEnd(6)} ${(f.err >= 0 ? '+' : '') + f.err.toFixed(1)}%  ${f.match.slice(0, 32)}`);
    }
  }

  console.log('\n   parok: ' + path.relative(process.cwd(), pairFile));
  if (pairs.length < 30) {
    console.log('\n   MEGJEGYZES: ' + pairs.length + ' par keves uj kalibraciohoz. A meglevo');
    console.log('   illesztes 45 paron all. Gyujts tobb napon at, aztan illesszunk ujra.');
  }
})();
