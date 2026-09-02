// Szelveny-matematika: hogyan erjunk el egy cel-osszoddsot a legkisebb karral?
console.log('SZELVENY: HOGY VALTOZIK A VARHATO ERTEK A LABAK SZAMAVAL?\n');
console.log('Feltetel: minden lab ~8% margoval (Tippmixpro-szeru monopol konyv)\n');
const M=0.08;
console.log('  cel odds  labak  lab-odds   megtartott ertek   varhato veszteseg');
for(const target of [3,5,10,20,50]){
  console.log(`  ${String(target+'x').padEnd(9)}`);
  for(const n of [2,3,4,5,6,8]){
    const legOdds=Math.pow(target,1/n);
    if(legOdds<1.15)continue;             // ennel kisebb odds nem letezik ertelmesen
    const keep=1/Math.pow(1+M,n);          // ennyi marad a "fair" ertekbol
    console.log(`            ${String(n).padStart(2)}    ${legOdds.toFixed(2).padStart(6)}      ${(keep*100).toFixed(1).padStart(5)}%           ${((1-keep)*100).toFixed(1).padStart(5)}%`);
  }
  console.log();
}
console.log('KOVETKEZTETES: ugyanaz a cel-odds KEVESEBB labbal lenyegesen jobb.');
console.log('Pl. 10x cel: 3 labbal 79% ertek marad, 8 labbal csak 54%.\n');
console.log('--- MI A NYERESI ESELY? (ha minden lab fair esellyel jon be) ---\n');
console.log('  cel odds  labak  lab-odds  lab-esely   szelveny nyeresi esely');
for(const target of [5,10,20]){
  for(const n of [2,3,4,6]){
    const legOdds=Math.pow(target,1/n);
    if(legOdds<1.15)continue;
    const legP=1/(legOdds*(1+M));   // valos esely a margo levonasa utan
    const accP=Math.pow(legP,n);
    console.log(`  ${String(target+'x').padEnd(9)} ${String(n).padStart(2)}    ${legOdds.toFixed(2).padStart(6)}   ${(legP*100).toFixed(1).padStart(5)}%        ${(accP*100).toFixed(2).padStart(6)}%   (kb. minden ${Math.round(1/accP)}. szelveny)`);
  }
  console.log();
}
