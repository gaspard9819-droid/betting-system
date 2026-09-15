// Csapatnev-parositas: a football-data.co.uk CSV nevei <-> The Odds API nevei.
//
// EZ A TABLA A FORRAS. Szo szerint kimasolva a "Generate Legs" node-bol
// (Betting Slate Builder), es a "Settle Legs" node ugyanezt hasznalja.
// Ket kezzel tartott kopia elkerulhetetlenul elcsuszik: az elso valtozatban
// 67 bejegyzes volt itt a 122 helyett, es az Espanyol (a CSV-ben "Espanol")
// emiatt parositatlan maradt - 5 leg csendben kiesett volna az elszamolasbol.
// A sync-et a settle_test.js ellenorzi: osszeveti ezt a tablat a workflow
// JSON-jaban levovel, es bukik, ha elternek.
//
// Uj csapat eseten MINDKET helyen javitani kell (itt es a node-ban), vagy
// futtatni a sync_alias.js-t, ami innen irja at a node kodjat.

const ALIAS = {
  'manchester united': 'Man United', 'manchester city': 'Man City',
  'newcastle united': 'Newcastle', 'tottenham hotspur': 'Tottenham',
  'wolverhampton wanderers': 'Wolves', 'nottingham forest': "Nott'm Forest",
  'brighton and hove albion': 'Brighton', 'brighton & hove albion': 'Brighton',
  'west ham united': 'West Ham', 'leeds united': 'Leeds',
  'leicester city': 'Leicester', 'ipswich town': 'Ipswich',
  'sheffield united': 'Sheffield United', 'luton town': 'Luton',
  'afc bournemouth': 'Bournemouth', 'crystal palace': 'Crystal Palace',
  'atletico madrid': 'Ath Madrid', 'athletic bilbao': 'Ath Bilbao',
  'real sociedad': 'Sociedad', 'real betis': 'Betis',
  'celta vigo': 'Celta', 'rayo vallecano': 'Vallecano',
  'deportivo alaves': 'Alaves', 'real valladolid': 'Valladolid',
  'racing santander': 'Santander', 'real madrid': 'Real Madrid',
  'fc barcelona': 'Barcelona', 'barcelona': 'Barcelona',
  'bayern munich': 'Bayern Munich', 'bayern munchen': 'Bayern Munich',
  'borussia dortmund': 'Dortmund', 'borussia monchengladbach': "M'gladbach",
  'bayer leverkusen': 'Leverkusen', 'eintracht frankfurt': 'Ein Frankfurt',
  'vfb stuttgart': 'Stuttgart', 'vfl wolfsburg': 'Wolfsburg',
  'werder bremen': 'Werder Bremen', 'fc koln': 'FC Koln', '1 fc koln': 'FC Koln',
  'rb leipzig': 'RB Leipzig', 'sc freiburg': 'Freiburg', 'fc augsburg': 'Augsburg',
  'mainz 05': 'Mainz', 'fsv mainz 05': 'Mainz', 'tsg hoffenheim': 'Hoffenheim',
  'inter milan': 'Inter', 'ac milan': 'Milan', 'as roma': 'Roma',
  'ss lazio': 'Lazio', 'ssc napoli': 'Napoli',
  'atalanta bc': 'Atalanta', 'acf fiorentina': 'Fiorentina',
  'hellas verona': 'Verona', 'us lecce': 'Lecce', 'torino fc': 'Torino',
  'paris saint germain': 'Paris SG', 'paris saintgermain': 'Paris SG',
  'olympique marseille': 'Marseille', 'olympique lyonnais': 'Lyon',
  'as monaco': 'Monaco', 'lille osc': 'Lille', 'stade rennais': 'Rennes',
  'ogc nice': 'Nice', 'rc lens': 'Lens', 'fc nantes': 'Nantes',
  'atletico madrid': 'Ath Madrid', 'atletico de madrid': 'Ath Madrid',
  'deportivo la coruna': 'La Coruna', 'rc deportivo la coruna': 'La Coruna',
  '1 fc koln': 'FC Koln', 'fc koln': 'FC Koln', '1 fc kolna': 'FC Koln',
  'real racing club de santander': 'Santander', 'racing de santander': 'Santander',
  'rcd espanyol': 'Espanol', 'espanyol': 'Espanol', 'rcd espanyol de barcelona': 'Espanol',
  'real oviedo': 'Oviedo', 'ud levante': 'Levante', 'levante ud': 'Levante',
  'elche cf': 'Elche', 'girona fc': 'Girona', 'rcd mallorca': 'Mallorca',
  'ca osasuna': 'Osasuna', 'getafe cf': 'Getafe', 'sevilla fc': 'Sevilla',
  'valencia cf': 'Valencia', 'villarreal cf': 'Villarreal',
  'hamburger sv': 'Hamburg', 'sv werder bremen': 'Werder Bremen',
  'fc st pauli': 'St Pauli', 'st pauli': 'St Pauli',
  '1 fsv mainz 05': 'Mainz', 'fsv mainz 05': 'Mainz',
  '1 fc union berlin': 'Union Berlin', 'union berlin': 'Union Berlin',
  'fc schalke 04': 'Schalke 04', 'schalke 04': 'Schalke 04',
  '1 fc heidenheim': 'Heidenheim', 'fc heidenheim 1846': 'Heidenheim',
  'sv elversberg': 'Elversberg', 'sc paderborn 07': 'Paderborn',
  'ac monza': 'Monza', 'us cremonese': 'Cremonese', 'ac pisa': 'Pisa',
  'us sassuolo': 'Sassuolo', 'venezia fc': 'Venezia', 'parma calcio': 'Parma',
  'cagliari calcio': 'Cagliari', 'genoa cfc': 'Genoa', 'como 1907': 'Como',
  'udinese calcio': 'Udinese', 'bologna fc': 'Bologna',
  'stade brestois': 'Brest', 'stade brestois 29': 'Brest',
  'fc lorient': 'Lorient', 'le havre ac': 'Le Havre', 'fc metz': 'Metz',
  'aj auxerre': 'Auxerre', 'toulouse fc': 'Toulouse', 'angers sco': 'Angers',
  'rc strasbourg': 'Strasbourg', 'rc strasbourg alsace': 'Strasbourg',
  'le mans fc': 'Le Mans', 'estac troyes': 'Troyes', 'paris fc': 'Paris FC',
};

// NFD: az ekezetes betut alapbetu + kombinalo jel parra bontja, majd a jelet
// eltavolitjuk. Enelkul az "Atletico" -> "atltico" lenne (torolt betu), es a
// La Liga / Bundesliga ekezetes nevei sosem parosulnanak.
const norm = s => String(s)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

module.exports = { ALIAS, norm };
