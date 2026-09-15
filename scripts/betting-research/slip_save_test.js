// A Slip Builder "Build Response" node tesztje a szelveny-mentes utan.
// Futtatas: node slip_save_test.js  (a betting-research gyokerbol)
//
// A kulcs-allitas: a _slip kivezetese NEM valtoztatta meg a Discord
// valaszt. A message-et karakterre osszeveti a git HEAD-beli verzioval.
const fs = require('fs');

const WF = 'C:/Users/AMD/Desktop/n8n builder/workflows/Slip Builder.json';
const SNAP = 'C:/Users/AMD/Desktop/n8n builder/scripts/betting-research/snapshots/bet_slate_2026-09-08T16-10Z.json';

const wf = JSON.parse(fs.readFileSync(WF, 'utf8'));
const code = wf.nodes.find(n => n.name === 'Build Response').parameters.jsCode;

const raw = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
const slateRows = Array.isArray(raw) ? raw : (raw.data || raw.rows || []);

// n8n runtime utanzas. A node ket dolgot olvas: $('Verify & Parse') es $input.
function run(cmd) {
  const fake = {
    'Verify & Parse': { first: () => ({ json: cmd }), all: () => [{ json: cmd }] },
  };
  const $ = (name) => {
    if (!fake[name]) throw new Error('nem ismert node: ' + name);
    return fake[name];
  };
  const $input = { all: () => slateRows.map(json => ({ json })) };
  const fn = new Function('$', '$input', '$json', code);
  return fn($, $input, {});
}

// A kickoff-ok 2026-09-05..09 koruliek, ezert a "most" a snapshot ideje kell
// legyen, kulonben minden lab mult ideju es a slate uresnek latszik.
const REAL_NOW = Date.now;
const FAKE_NOW = new Date('2026-09-05T09:00:00.000Z').getTime();
Date.now = () => FAKE_NOW;
const RealDate = Date;
global.Date = class extends RealDate {
  constructor(...a) { return a.length ? new RealDate(...a) : new RealDate(FAKE_NOW); }
  static now() { return FAKE_NOW; }
};

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) pass++;
  else { fail++; console.log('  BUKOTT: ' + name + (extra ? '\n    ' + extra : '')); }
};

const base = { user_id: '123', command: 'szelveny' };

console.log('1) /szelveny celok — message es _slip');
for (const target of [3, 5, 10, 20, 50]) {
  const out = run(Object.assign({}, base, { target }));
  const j = out[0].json;
  const s = j._slip;
  if (!s) { console.log('  cel ' + target + 'x: nincs szelveny (message: ' + j.message.slice(0, 60) + ')'); continue; }
  const prod = s.legs.reduce((a, l) => a * l.odds, 1);
  console.log('  cel ' + String(target).padStart(3) + 'x -> ' + s.leg_count + ' lab, ossz '
            + s.total_odds.toFixed(2) + 'x, esely ' + (s.hit_prob * 100).toFixed(1) + '%'
            + ', plafon feloldva: ' + s.capped_relaxed);
  ok(s.slip_id && s.slip_id.startsWith('slip-'), target + 'x: van slip_id');
  ok(s.legs.length === s.leg_count, target + 'x: leg_count = legek szama');
  ok(s.stake === 1000, target + 'x: tet 1000');
  ok(s.status === 'open', target + 'x: status open');
  ok(Math.abs(prod - s.total_odds) < 0.02, target + 'x: total_odds = labak szorzata',
     'szorzat=' + prod.toFixed(4) + ' mentett=' + s.total_odds);
  // A hit_prob a PIACI valoszinusegek szorzata (2026-09-12 ota). Korabban a
  // modelle volt, ami a valos eselyt 11-41%-kal tulbecsulte a 145 labas valos
  // slate-en - es a settlement ez ellen merte volna a talalati aranyt.
  const jp = s.legs.reduce((a, l) => a * l.market_prob, 1);
  ok(Math.abs(jp - s.hit_prob) < 0.0002, target + 'x: hit_prob = market_prob szorzat');
  const jpModel = s.legs.reduce((a, l) => a * l.model_prob, 1);
  ok(Math.abs(jpModel - s.hit_prob) > 1e-9 || Math.abs(jpModel - jp) < 1e-9,
     target + 'x: hit_prob NEM a model_prob szorzata');
  // minden lab minden mezoje ki van-e toltve
  for (const l of s.legs) {
    ok(!!l.leg_id && !!l.match_name && !!l.league && !!l.kickoff, target + 'x: lab azonositok');
    ok(!!l.market && !!l.selection, target + 'x: lab piac/selection');
    ok(typeof l.odds === 'number' && l.odds > 1, target + 'x: lab odds szam');
    ok(l.slip_id === s.slip_id, target + 'x: lab slip_id egyezik a fejjel');
    ok(l.status === 'open', target + 'x: lab status open');
  }
  // egy lab egy meccsbol (korrelacio-vedelem) - ez regi invariáns, ne romoljon
  const matches = s.legs.map(l => l.match_name);
  ok(new Set(matches).size === matches.length, target + 'x: egy lab / meccs');
  // a mentett odds a BECSULT tippmix ar, nem a piaci atlag
  for (const l of s.legs) {
    const src = slateRows.find(r => r.leg_id === l.leg_id);
    ok(src && Math.abs(src.tippmix_odds - l.odds) < 1e-9, target + 'x: odds = tippmix_odds');
  }
}

console.log('\n2) nem-szelveny valaszok: _slip legyen null');
for (const cmd of [
  { user_id: '1', command: 'help' },
  { user_id: '1', command: 'slate' },
  { user_id: '1', error: 'Ismeretlen parancs.' },
]) {
  const j = run(cmd)[0].json;
  ok(j._slip === null, (cmd.command || 'error') + ': _slip null',
     'kapott: ' + JSON.stringify(j._slip));
  ok(typeof j.message === 'string' && j.message.length > 0, (cmd.command || 'error') + ': van message');
}

console.log('\n3) elerhetetlen cel: _slip null, de van magyarazo message');
{
  const j = run(Object.assign({}, base, { target: 100000 }))[0].json;
  ok(j._slip === null, 'elerhetetlen cel: _slip null');
  ok(/nem erheto el|Nem talaltam/.test(j.message), 'elerhetetlen cel: magyarazo message');
}

console.log('\n4) a message osszevetese a git HEAD-beli verzioval');
// EREDETILEG: a _slip kivezetese nem valtoztathatta meg a valaszt, ezert a
// message karakterre egyezett a HEAD-del.
//
// 2026-09-12 ota a pontozas piaci valoszinuseggel dolgozik, ami SZANDEKOSAN
// mas labakat valaszt - a szelveny-valaszok tehat elternek, es ez a valtas
// lenyege, nem regresszio. Amit viszont tovabbra is rogziteni kell:
//   - a NEM szelveny valaszok (/help, /slate, parancshiba) karakterre azonosak
//   - a szelveny-valaszok szerkezete valtozatlan (ugyanazok a sorok, csak mas
//     szamokkal), mert a Discord 2000 karakteres limitje erre epul
const { execSync } = require('child_process');
let origCode = null;
try {
  const orig = execSync('git show HEAD:"workflows/Slip Builder.json"',
    { cwd: 'C:/Users/AMD/Desktop/n8n builder', encoding: 'utf8', maxBuffer: 40e6 });
  origCode = JSON.parse(orig).nodes.find(n => n.name === 'Build Response').parameters.jsCode;
} catch (e) {
  console.log('  KIHAGYVA: nem tudom kiolvasni a HEAD-et (' + e.message.slice(0, 60) + ')');
}
if (origCode) {
  const runOrig = (cmd) => {
    const fake = { 'Verify & Parse': { first: () => ({ json: cmd }), all: () => [{ json: cmd }] } };
    const fn = new Function('$', '$input', '$json', origCode);
    return fn((n) => fake[n], { all: () => slateRows.map(json => ({ json })) }, {});
  };
  // 4a) A nem-szelveny valaszok karakterre azonosak maradnak.
  for (const cmd of [
    { user_id: '1', command: 'help' }, { user_id: '1', command: 'slate' },
  ]) {
    const a = runOrig(cmd)[0].json.message, b = run(cmd)[0].json.message;
    ok(a === b, 'message karakterre azonos: ' + cmd.command,
       a === b ? '' : 'ELTER!\n--- eredeti ---\n' + a.slice(0, 300) + '\n--- uj ---\n' + b.slice(0, 300));
  }

  // 4b) A szelveny-valaszok szerkezete valtozatlan: ugyanazok a sorok es
  //     szakaszok, csak mas szamokkal. A szamokat maszkoljuk, ugy hasonlitunk.
  const skeleton = s => s
    .replace(/\d+[.,]\d+/g, '#').replace(/\d+/g, '#')   // minden szam -> #
    .replace(/[ \t]+/g, ' ').trim();
  for (const cmd of [
    Object.assign({}, base, { target: 3 }), Object.assign({}, base, { target: 10 }),
    Object.assign({}, base, { target: 20 }), Object.assign({}, base, { target: 50 }),
  ]) {
    const a = runOrig(cmd)[0].json.message, b = run(cmd)[0].json.message;
    const sa = skeleton(a), sb = skeleton(b);
    // A labak neve (meccsnev, piac) valtozik a mas valasztassal, ezert csak a
    // sorok SZAMAT es a fix szakaszokat hasonlitjuk, nem a teljes vazat.
    const sect = t => t.split('\n').filter(l =>
      /^(Osszodds|Bejovesi esely|──────────|🎟)/.test(l.trim()) ||
      /lab —/.test(l)).map(l => skeleton(l));
    const fa = sect(a), fb = sect(b);
    ok(JSON.stringify(fa) === JSON.stringify(fb),
       'szelveny-szerkezet valtozatlan: ' + cmd.target + 'x',
       JSON.stringify(fa) === JSON.stringify(fb) ? ''
         : 'ELTER!\n--- eredeti ---\n' + fa.join('\n') + '\n--- uj ---\n' + fb.join('\n'));
    // A valasz nem lephet at a Discord 2000 karakteres hataran.
    ok(b.length <= 2000, 'szelveny valasz <= 2000 karakter: ' + cmd.target + 'x', b.length + ' karakter');
    // A valasz szamai mostantol a PIACI eselyt tukrozik.
    const m = b.match(/Bejovesi esely: ~([\d.]+)%/);
    if (m) {
      const shown = Number(m[1]) / 100;
      const slip = run(cmd)[0].json._slip;
      ok(slip && Math.abs(shown - slip.hit_prob) < 0.002,
         'a mutatott esely = a mentett hit_prob: ' + cmd.target + 'x',
         slip ? `mutatott ${shown} vs mentett ${slip.hit_prob}` : 'nincs _slip');
    }
  }
}

global.Date = RealDate; Date.now = REAL_NOW;
console.log('\n' + (fail === 0 ? 'MINDEN TESZT ATMENT' : fail + ' BUKOTT') + '  (' + pass + ' ok / ' + (pass + fail) + ')');
process.exit(fail ? 1 : 0);
