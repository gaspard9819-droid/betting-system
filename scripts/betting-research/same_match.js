// KERDES: mennyire korrelalnak egy meccsen belul a kimenetelek?
// A Slip Builder egy meccsrol egy labat enged (usedMatches), mert a labak nem
// fuggetlenek. De ha egy konyv ugyanazon meccs ket labjat SIMAN OSSZESZOROZZA
// (nem kombinalt arral), akkor a pozitiv korrelacio a fogadonak dolgozik:
// P(hazai ES over) > P(hazai) x P(over), az ar viszont a szorzat.
// Ez CSAK akkor er valamit, ha a Tippmixpro engedi az egy-meccses kombinaciot
// naiv szorzassal - ez nyitott kerdes, itt csak a nagysagrendet merjuk.
// Futtatas: cd data && node ../same_match.js
const { loadAll, TIPPMIX, devig, mean } = require('./odds_loader.js');
const all = loadAll().filter(m => m.avgc && m.ou_avgc);
console.log(`Meccsek: ${all.length}\n`);

const combos = [
  ['hazai + over 2.5', m => m.res === 0, m => m.over === 0, m => [m.avgc[0], m.ou_avgc[0]]],
  ['hazai + under 2.5', m => m.res === 0, m => m.over === 1, m => [m.avgc[0], m.ou_avgc[1]]],
  ['vendeg + over 2.5', m => m.res === 2, m => m.over === 0, m => [m.avgc[2], m.ou_avgc[0]]],
  ['vendeg + under 2.5', m => m.res === 2, m => m.over === 1, m => [m.avgc[2], m.ou_avgc[1]]],
  ['dontetlen + under 2.5', m => m.res === 1, m => m.over === 1, m => [m.avgc[1], m.ou_avgc[1]]],
  ['dontetlen + over 2.5', m => m.res === 1, m => m.over === 0, m => [m.avgc[1], m.ou_avgc[0]]],
];
const FAV = [['hazai < 1.6', m => m.avgc[0] < 1.6], ['hazai 1.6-2.2', m => m.avgc[0] >= 1.6 && m.avgc[0] < 2.2], ['hazai 2.2-3.2', m => m.avgc[0] >= 2.2 && m.avgc[0] < 3.2], ['hazai 3.2+', m => m.avgc[0] >= 3.2], ['OSSZES', () => true]];

console.log('Egyuttes gyakorisag / (marginalisok szorzata): >1 = pozitiv korrelacio');
console.log('EV(naiv szorzat, tippmix aron) = P(egyutt) x odds1_t x odds2_t - 1  --  osszevetve a ket kulon lab EV-jevel');
for (const [cn, A, B, oddsOf] of combos) {
  console.log(`\n  ${cn}`);
  console.log('    hazai-sav        n     P(A)    P(B)   P(A&B)   P(A)P(B)   arany    EV naiv-szorzat   EV egy lab A   EV egy lab B');
  for (const [fn, filt] of FAV) {
    const s = all.filter(filt); if (s.length < 100) continue;
    const pa = mean(s.map(m => A(m) ? 1 : 0)), pb = mean(s.map(m => B(m) ? 1 : 0)), pab = mean(s.map(m => A(m) && B(m) ? 1 : 0));
    // EV a tenyleges arakon: meccsenkent szorzat, atlagolva
    const evNaive = mean(s.map(m => { const [o1, o2] = oddsOf(m); return (A(m) && B(m) ? TIPPMIX(o1) * TIPPMIX(o2) : 0) - 1; }));
    const evA = mean(s.map(m => (A(m) ? TIPPMIX(oddsOf(m)[0]) : 0) - 1));
    const evB = mean(s.map(m => (B(m) ? TIPPMIX(oddsOf(m)[1]) : 0) - 1));
    console.log(`    ${fn.padEnd(14)} ${String(s.length).padStart(5)}   ${pa.toFixed(3)}   ${pb.toFixed(3)}   ${pab.toFixed(3)}    ${(pa * pb).toFixed(3)}     ${(pab / (pa * pb)).toFixed(3)}      ${(evNaive * 100).toFixed(1).padStart(6)}%        ${(evA * 100).toFixed(1).padStart(6)}%        ${(evB * 100).toFixed(1).padStart(6)}%`);
  }
}
console.log('\nOlvasat: ahol az arany jovel 1 folott van ES az EV naiv-szorzat jobb a ket kulon labnal,');
console.log('ott a meccsen beluli kombinacio ertekes - DE csak ha a konyv tenyleg szorzattal arazza.');
