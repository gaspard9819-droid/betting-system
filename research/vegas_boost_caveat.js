// !!! MEGHALADOTT (2026-09-17) — a kovetkeztetese TEVES, lasd vegas_margin.js.
// Ez a script egyetlen szelvenybol becsulte a Vegas arszintjet, es arra jutott,
// hogy ~19%-kal rosszabbul araz. A teljes 1X2 piacok merese ezt CAFOLTA:
// a Vegas 1X2 margoja 5.28%, es eppen ezen a meccsen a legalacsonyabb (2.98%).
// A 6.50-es kombinalt ar a harom lab EGYUTTES arazasabol jott, nem magas margobol.
// Megtartva, mert megmutatja, hogyan tevesztett meg az egymintas kovetkeztetes.
//
// A nagy emeles nem feltetlen jo ajanlat. Ket dolgot kell szetvalasztani:
//   1. az emeles MERTEKE (+11%)  — ezt mertuk
//   2. hogy az emelt ar FAIR-e   — ezt NEM tudjuk, mert nincs referencia
//
// Ha a Vegas alapara eleve rossz (magas margo), akkor a +11% csak
// visszahozza a piaci szintre, nem afole.

// A ket kepbol ismert EGY referenciapont:
//   Salzburg 1X2 + Tabakovic golszerzo + 8.5 alatt szoglet
//   Vegas alap 6.50 -> boost 7.50
//   Tippmixpro BetBuilder (boost NELKUL): 8.00
const vegasBase = 6.50, vegasBoost = 7.50, tippmixPlain = 8.00;

console.log('=== A REFERENCIAPONT (az egyetlen, ami van) ===');
console.log('Vegas alapar:          ' + vegasBase.toFixed(2));
console.log('Vegas boostolva:       ' + vegasBoost.toFixed(2) + '  (+' + ((vegasBoost/vegasBase-1)*100).toFixed(0) + '%)');
console.log('Tippmixpro boost NELKUL: ' + tippmixPlain.toFixed(2));
console.log('');
console.log('A Vegas alapara ' + ((1-vegasBase/tippmixPlain)*100).toFixed(1) + '%-kal ROSSZABB a Tippmixpro sima aranal.');
console.log('A boost utan is ' + ((1-vegasBoost/tippmixPlain)*100).toFixed(1) + '%-kal rosszabb.');
console.log('');
console.log('=== AMIT EZ JELENT ===');
console.log('A +11%-os atlagemeles NEM jelent jo arat, ha az alapar ~19%-kal');
console.log('rosszabb a versenytarsenal. A boost ilyenkor a sajat magas margot');
console.log('faragja le, nem a piacot veri meg.');
console.log('');
// Mekkora emeles kellene, hogy elerje a Tippmixpro SIMA arat?
const needed = (tippmixPlain/vegasBase-1)*100;
console.log('Ahhoz, hogy a Vegas boostolt ara elerje a Tippmixpro SIMA arat,');
console.log('+' + needed.toFixed(1) + '%-os emeles kellene. A mert atlag +11.15%.');
console.log('');
console.log('=== FIGYELMEZTETES A MINTARA ===');
console.log('Ez EGY szelveny osszevetese. A +11.15% viszont 43 ajanlat atlaga —');
console.log('az emeles MERTEKE jol mert, az ARSZINT viszont egyetlen pontbol becsult.');
console.log('A ketto kulonbozo megbizhatosagu allitas.');
