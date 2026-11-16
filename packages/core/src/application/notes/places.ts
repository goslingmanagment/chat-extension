// 2026-11-16: the place a questionnaire's «Локация» names, as the team writes it in a fan's name for oneself
// («Anton/Germany/26», «Sam/US», «Chet/Australia/29»: hub prod, every name next to a questionnaire). The Goose and
// some chatters write the place in Russian («Германия (10.2026)», «Остин, Техас, США»), the names carry it in
// English: the country, the US and the UK as «US» and «UK», a US state or big city as «US» (Cyrillic names too:
// «Денис/Russia/33», «Тимофей/USA»). Pure data.

const PLACES: readonly (readonly [string, readonly string[]])[] = [
  ['US', ['сша', 'америка', 'штаты', 'соединенные штаты', 'соединенные штаты америки', 'us', 'usa', 'united states', 'united states of america', 'america', 'states']],
  ['UK', ['великобритания', 'британия', 'соединенное королевство', 'uk', 'united kingdom', 'great britain', 'britain', 'gb']],
  ['England', ['англия', 'england']],
  ['Scotland', ['шотландия', 'scotland']],
  ['Wales', ['уэльс', 'wales']],
  ['Ireland', ['ирландия', 'ireland']],
  ['Canada', ['канада', 'canada']],
  ['Mexico', ['мексика', 'мехико', 'mexico', 'mexico city']],
  ['Australia', ['австралия', 'australia']],
  ['New Zealand', ['новая зеландия', 'new zealand']],
  ['Germany', ['германия', 'germany', 'deutschland']],
  ['France', ['франция', 'france']],
  ['Italy', ['италия', 'italy', 'italia']],
  ['Spain', ['испания', 'spain', 'espana']],
  ['Portugal', ['португалия', 'portugal']],
  ['Netherlands', ['нидерланды', 'голландия', 'netherlands', 'the netherlands', 'holland']],
  ['Belgium', ['бельгия', 'belgium']],
  ['Luxembourg', ['люксембург', 'luxembourg']],
  ['Switzerland', ['швейцария', 'switzerland']],
  ['Austria', ['австрия', 'austria']],
  ['Denmark', ['дания', 'denmark']],
  ['Sweden', ['швеция', 'sweden']],
  ['Norway', ['норвегия', 'norway']],
  ['Finland', ['финляндия', 'finland']],
  ['Iceland', ['исландия', 'iceland']],
  ['Poland', ['польша', 'poland']],
  ['Czech', ['чехия', 'czech', 'czechia', 'czech republic']],
  ['Slovakia', ['словакия', 'slovakia']],
  ['Hungary', ['венгрия', 'hungary']],
  ['Romania', ['румыния', 'romania']],
  ['Bulgaria', ['болгария', 'bulgaria']],
  ['Greece', ['греция', 'greece']],
  ['Cyprus', ['кипр', 'cyprus']],
  ['Malta', ['мальта', 'malta']],
  ['Croatia', ['хорватия', 'croatia']],
  ['Slovenia', ['словения', 'slovenia']],
  ['Serbia', ['сербия', 'serbia']],
  ['Bosnia', ['босния', 'bosnia']],
  ['Albania', ['албания', 'albania']],
  ['Estonia', ['эстония', 'estonia']],
  ['Latvia', ['латвия', 'latvia']],
  ['Lithuania', ['литва', 'lithuania']],
  ['Ukraine', ['украина', 'ukraine']],
  ['Belarus', ['беларусь', 'белоруссия', 'belarus']],
  ['Moldova', ['молдова', 'молдавия', 'moldova']],
  ['Russia', ['россия', 'рф', 'russia']],
  ['Georgia', ['грузия']],
  ['Armenia', ['армения', 'armenia']],
  ['Azerbaijan', ['азербайджан', 'azerbaijan']],
  ['Kazakhstan', ['казахстан', 'kazakhstan']],
  ['Turkey', ['турция', 'turkey', 'turkiye']],
  ['Israel', ['израиль', 'israel']],
  ['Lebanon', ['ливан', 'lebanon']],
  ['UAE', ['оаэ', 'эмираты', 'uae', 'emirates', 'united arab emirates']],
  ['Saudi Arabia', ['саудовская аравия', 'saudi arabia']],
  ['Qatar', ['катар', 'qatar']],
  ['Kuwait', ['кувейт', 'kuwait']],
  ['Egypt', ['египет', 'egypt']],
  ['Morocco', ['марокко', 'morocco']],
  ['South Africa', ['юар', 'южная африка', 'south africa']],
  ['Nigeria', ['нигерия', 'nigeria']],
  ['India', ['индия', 'india']],
  ['Pakistan', ['пакистан', 'pakistan']],
  ['China', ['китай', 'china']],
  ['Taiwan', ['тайвань', 'taiwan']],
  ['Hong Kong', ['гонконг', 'hong kong']],
  ['Japan', ['япония', 'japan']],
  ['Korea', ['корея', 'южная корея', 'korea', 'south korea']],
  ['Singapore', ['сингапур', 'singapore']],
  ['Malaysia', ['малайзия', 'malaysia']],
  ['Thailand', ['таиланд', 'тайланд', 'thailand']],
  ['Vietnam', ['вьетнам', 'vietnam']],
  ['Philippines', ['филиппины', 'philippines']],
  ['Indonesia', ['индонезия', 'indonesia']],
  ['Brazil', ['бразилия', 'brazil', 'brasil']],
  ['Argentina', ['аргентина', 'argentina']],
  ['Chile', ['чили', 'chile']],
  ['Colombia', ['колумбия', 'colombia']],
  ['Peru', ['перу', 'peru']],
  ['Venezuela', ['венесуэла', 'venezuela']],
  ['Puerto Rico', ['пуэрто-рико', 'пуэрто рико', 'puerto rico']],
];

/** The US states and the cities the team's names put under «US» when the place names no country. Georgia is the
 * country (the team's «Грузия»): the state is «Джорджия». */
const US_PLACES: readonly string[] = [
  'алабама', 'аляска', 'аризона', 'арканзас', 'калифорния', 'колорадо', 'коннектикут', 'делавэр', 'флорида', 'джорджия',
  'гавайи', 'айдахо', 'иллинойс', 'индиана', 'айова', 'канзас', 'кентукки', 'луизиана', 'мэн', 'мэриленд', 'массачусетс',
  'мичиган', 'миннесота', 'миссисипи', 'миссури', 'монтана', 'небраска', 'невада', 'нью-гэмпшир', 'нью-джерси',
  'нью-мексико', 'нью-йорк', 'северная каролина', 'северная дакота', 'огайо', 'оклахома', 'орегон', 'пенсильвания',
  'род-айленд', 'южная каролина', 'южная дакота', 'теннесси', 'техас', 'юта', 'вермонт', 'вирджиния', 'виргиния',
  'вашингтон', 'западная вирджиния', 'висконсин', 'вайоминг',
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida', 'hawaii',
  'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts',
  'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey',
  'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania',
  'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington',
  'west virginia', 'wisconsin', 'wyoming',
  'лос-анджелес', 'лос анджелес', 'чикаго', 'лас-вегас', 'лас вегас', 'майами', 'хьюстон', 'даллас', 'остин',
  'сан-франциско', 'сан франциско', 'сиэтл', 'бостон', 'нью йорк', 'nyc', 'ny', 'la', 'los angeles', 'chicago',
  'las vegas', 'miami', 'houston', 'dallas', 'austin', 'san francisco', 'seattle', 'boston',
];

/** How a place compares: case and «ё» folded, dots and spaces evened («U.S.A.» is «usa»). */
export const placeKey = (place: string): string =>
  place
    .normalize('NFC')
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** A place the team's names carry: its name there, and whether it is a country (a US state or city is not one). */
export interface KnownPlace {
  readonly name: string;
  readonly country: boolean;
}

const KNOWN = new Map<string, KnownPlace>([
  ...US_PLACES.map((place) => [placeKey(place), { name: 'US', country: false }] as const),
  ...PLACES.flatMap(([name, aliases]) => aliases.map((alias) => [placeKey(alias), { name, country: true }] as const)),
]);

/** null — not a place the team's names are known to carry. */
export const knownPlace = (place: string): KnownPlace | null => KNOWN.get(placeKey(place)) ?? null;
