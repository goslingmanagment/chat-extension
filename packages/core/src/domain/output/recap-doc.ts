// The Recap as a document (2026-10-28, the owner's pick «Досье во весь экран»): the sections of the hub's fan profile,
// each cut into what the window sets as typography: «Имя: Тони…» paragraphs whose label gets a column of its own,
// labelled lists («Игры:» and its «- …» lines), a run of dated lines as a timeline, the fan's words one per line as
// pull quotes, the stage and the spender's class on the hub's own scales. Every reading aid falls back to plain text:
// whatever the cut does not recognise stays a paragraph or a list. The folded window's «Шпаргалка» comes from the same
// cut: what to do next, what not to forget, what not to do.

import {
  type RecapCribVM,
  type RecapDocVM,
  type RecapLineVM,
  type RecapMonthVM,
  type RecapPartVM,
  type RecapScaleVM,
  type RecapSectionKey,
  type RecapSectionVM,
  type RecapTone,
  type RecapWrittenVM,
} from '@cg/contracts/vm';

import { recapSectionOf, recapWritten, type RecapBlock } from './recap';

/** A list line: «- …», «* …», «• …», «1. …», «1) …». */
const LIST = /^\s*(?:[-*•]|\d{1,2}[.)])\s+/;
/** A label longer than this is a clause, not a label. */
const LABEL_MAX = 48;
/** A list line's label is shorter («27 сентября», «Игры»). */
const ITEM_LABEL_MAX = 40;

const capitalize = (text: string): string => text.replace(/^(\s*)(\p{Ll})/u, (_, space: string, letter: string) => space + letter.toUpperCase());
const lowerFirst = (text: string): string => text.replace(/^(\s*)(\p{Lu})(?=\p{Ll})/u, (_, space: string, letter: string) => space + letter.toLowerCase());

/** «Возраст и локация (по его словам)» → the label and its bracket. */
function withNote(raw: string): { readonly label: string; readonly note: string | null } {
  const paren = /^(.*?)\s*\(([^)]*)\)$/.exec(raw);
  return paren === null || paren[1] === undefined || paren[1].trim() === '' ? { label: raw, note: null } : { label: paren[1].trim(), note: paren[2]?.trim() || null };
}

/**
 * «Имя: Тони…» → { label: «Имя», text: «Тони…» }. A label is short, starts with a letter (a list line's also with a
 * digit: «27 сентября: …»), has no quote before its colon and no comma or sentence end outside brackets («Продолжить
 * сцену с того места, где остановились: …» is a sentence). «**Имя:** …» and «**Имя**: …» count as well.
 */
function splitLabel(text: string, max: number, digits: boolean): RecapLineVM {
  const bold = /^\*\*([^*\n]{1,80}?)(?::\*\*|\*\*:)\s+([\s\S]+)$/u.exec(text);
  const match = bold ?? (digits ? /^([\p{L}\d][^:\n"«»“”]{0,80}?):\s+([\s\S]+)$/u : /^(\p{L}[^:\n"«»“”]{0,80}?):\s+([\s\S]+)$/u).exec(text);
  const raw = match?.[1]?.trim() ?? '';
  const rest = match?.[2]?.trim() ?? '';
  if (match === null || raw === '' || rest === '' || raw.length > max || /[.!?,;]/.test(raw.replace(/\([^)]*\)/g, ''))) return { label: null, note: null, text };
  return { ...withNote(raw), text: rest };
}

/** A line that is a list's label by itself: «Что обещала модель (держать в голове):». */
function labelLine(line: string): { readonly label: string; readonly note: string | null } | null {
  const trimmed = line.trim().replace(/^\*\*(.+?)\*\*$/, '$1');
  if (!trimmed.endsWith(':') || trimmed.length > 90) return null;
  const raw = trimmed.slice(0, -1).replace(/\*\*/g, '').trim();
  if (!/^\p{L}/u.test(raw) || /[.!?]/.test(raw.replace(/\([^)]*\)/g, ''))) return null;
  return withNote(raw);
}

function itemOf(line: string): RecapLineVM {
  return splitLabel(line.replace(LIST, '').trim().replace(/[;.]$/, ''), ITEM_LABEL_MAX, true);
}

/** What a part's label tells the chatter: «Чего избегать» — what not to do; «Рекомендуемый подход», «Лучшие хуки» — what to do. */
function toneOf(label: string | null): RecapTone {
  if (label === null) return null;
  if (/избега|не делать|avoid|отталкива|тормоз|red flag/iu.test(label)) return 'avoid';
  if (/рекомендуем|подход|следующий ход|next move|хук|hook/iu.test(label)) return 'act';
  return null;
}

/** A date at a line's start: «27 сентября», «конец июня и июль», «08.10», «вчера». */
const DATE =
  /^(?:\d{1,2}(?:[./-]\d{1,2})?\s+)?(?:(?:в\s+)?(?:конец|конце|конца|начало|начале|начала|середина|середине|середины)\s+)?(?:январ|феврал|март|апрел|ма[йяюе]|июн|июл|август|сентябр|октябр|ноябр|декабр|весн|лет[оа]|осен|зим|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|^\d{1,2}[./]\d{1,2}|^(?:сегодня|вчера|позавчера|недавно|today|yesterday)/iu;
/** The fan's words alone on a line: «"Great experience for 12 year old me"». */
const QUOTED = /^["“«]([^"“”«»]+)["”»][.;!?]?$/u;

function lookOf(label: string | null, items: readonly RecapLineVM[]): 'plain' | 'timeline' | 'quotes' {
  const dated = items.filter((item) => item.label !== null && DATE.test(item.label)).length;
  if (items.length >= 3 && dated >= Math.ceil(items.length * 0.6)) return 'timeline';
  if (items.length > 0 && (/цитат|quote/iu.test(label ?? '') || (items.length >= 2 && items.every((item) => item.label === null && QUOTED.test(item.text.trim()))))) return 'quotes';
  return 'plain';
}

/** The text after a section's heading, as paragraphs and lists. */
function partsOf(markdown: string): RecapPartVM[] {
  const parts: RecapPartVM[] = [];
  const text = (line: RecapLineVM): RecapPartVM => ({ kind: 'text', ...line, tone: toneOf(line.label), figure: null, scale: null });
  const list = (label: { readonly label: string; readonly note: string | null } | null, items: readonly RecapLineVM[]): RecapPartVM => {
    const look = lookOf(label?.label ?? null, items);
    return {
      kind: 'list',
      label: label?.label ?? null,
      note: label?.note ?? null,
      tone: toneOf(label?.label ?? null),
      look,
      items:
        look === 'quotes'
          ? items.map((item) => {
              const quote = QUOTED.exec(item.text.trim())?.[1];
              return quote === undefined ? item : { label: null, note: null, text: quote, quoted: true };
            })
          : items,
    };
  };
  const chunks = markdown
    .trim()
    .split(/\n\s*\n/)
    .map((chunk) => chunk.split('\n').filter((line) => line.trim() !== ''))
    .filter((chunk) => chunk.length > 0);
  for (const chunk of chunks) {
    // A paragraph runs until a line that opens with its own label («Возраст: …» right under «Имя: …») or a list; a list
    // runs over its lines and what wraps them, until such a line. A lone «Подпись:» line is the label of the list under it.
    let lines: string[] = [];
    let items: RecapLineVM[] | null = null;
    let head: { readonly label: string; readonly note: string | null } | null = null;
    const flush = (): void => {
      if (items !== null) parts.push(list(head, items));
      else if (lines.length > 0) parts.push(text(splitLabel(lines.join(' ').trim(), LABEL_MAX, false)));
      lines = [];
      items = null;
      head = null;
    };
    for (const line of chunk) {
      if (LIST.test(line)) {
        if (items === null) {
          const own = lines.length === 1 ? labelLine(lines[0] ?? '') : null;
          if (own === null) flush();
          else lines = [];
          head = own;
          items = [];
        }
        items.push(itemOf(line));
        continue;
      }
      const opens = splitLabel(line.trim(), LABEL_MAX, false).label !== null || labelLine(line) !== null;
      if (items !== null && !opens) {
        const last = items.pop();
        if (last !== undefined) items.push({ ...last, text: `${last.text} ${line.trim()}` });
        continue;
      }
      if (items !== null || (opens && lines.length > 0)) flush();
      lines.push(line.trim());
    }
    flush();
  }
  return parts;
}

// ── the hub's scales ───────────────────────────────────────────────────────

/** The fan-summary prompt's stages and spender classes, as the model names them in either language. */
const STAGES: readonly (readonly [string, RegExp])[] = [
  ['new', /\bnew\b|новичок/iu],
  ['warming up', /warming[\s-]*up|разогрев/iu],
  ['loyal', /\bloyal|лоял/iu],
  ['cooling off', /cooling[\s-]*off|остыва/iu],
  ['churning', /\bchurn|уходит/iu],
];
const SPENDERS: readonly (readonly [string, RegExp])[] = [
  ['browser', /\bbrowser|не тратит/iu],
  ['light', /\blight\b|лёгк|легк/iu],
  ['moderate', /\bmoderate|умеренн/iu],
  ['big spender', /\bbig\b|whale/iu],
];

/** The steps a text names, the first one named being where the fan stands. */
function scaleOf(kind: RecapScaleVM['kind'], scale: readonly (readonly [string, RegExp])[], text: string): RecapScaleVM | null {
  const hits = scale
    .map(([, pattern], index) => {
      const match = pattern.exec(text);
      return match === null ? null : { index, at: match.index };
    })
    .filter((hit) => hit !== null)
    .sort((a, b) => a.at - b.at);
  const first = hits[0];
  if (first === undefined) return null;
  return { kind, steps: scale.map(([name]) => name), at: first.index, lean: hits.slice(1).map((hit) => hit.index), ...saidOf(text) };
}

/**
 * How a sentence that opens with the step names it, and what it adds: «warming up с элементами loyal-light.» →
 * «warming up» and «с элементами loyal-light». A sentence that opens otherwise names nothing apart.
 */
function saidOf(sentence: string): { readonly said?: string; readonly rest?: string } {
  const clause = /^(.+?)(?=\s+с\s+|\s+with\s+|\s+но\s+|[,.;:(]|$)/iu.exec(sentence.trim());
  const said = clause?.[1]?.trim() ?? '';
  if (said === '' || said.length > 32 || !/^\p{L}/u.test(said)) return {};
  const rest = sentence
    .trim()
    .slice(said.length)
    .replace(/^[\s,;:]+/u, '')
    .replace(/[.;]\s*$/u, '')
    .trim();
  return rest === '' ? { said } : { said, rest };
}

/** A sum: «81,97 $», «10-20 $», «$25», «$1,200». */
const MONEY = /\d[\d \u00a0]*(?:[.,]\d{1,2})?\s?\$|\$\s?\d[\d,.]*\d|\$\s?\d/u;
/** What the sum covers: «за почти 5 месяцев», «за полгода». */
const PERIOD = /за\s+(?:почти\s+|около\s+|примерно\s+|последние\s+|больше\s+|более\s+|уже\s+)?(?:\d+(?:[.,]\d+)?|полгода|год|два|две|три|четыре|пять|шесть)(?:\s*(?:мес\p{L}*|нед\p{L}*|дн\p{L}*|год\p{L}*|лет))?/iu;

/** The first sentence of a text, for what a label opens with («warming up с элементами loyal. Он…»). */
function firstSentence(text: string): string {
  return sentences(text)[0] ?? text;
}

/** A text cut into sentences; «т.е.», «Dr.», an initial and an open quote do not end one. */
function sentences(text: string): string[] {
  const out: string[] = [];
  let current = '';
  for (const piece of text.split(/(?<=[.!?…])\s+/u)) {
    current = current === '' ? piece : `${current} ${piece}`;
    const unfinished =
      /(?:^|\s)(?:Dr|Mr|Mrs|Ms|St|т\.?е|т\.?д|т\.?п|др|см|напр)\.$/iu.test(current) || /\s\p{Lu}\.$/u.test(current) || (current.match(/"/g) ?? []).length % 2 === 1;
    if (unfinished) continue;
    out.push(current.trim());
    current = '';
  }
  if (current.trim() !== '') out.push(current.trim());
  return out;
}

/** The stage section's first «Стадия: …» says the stage; the money section's first classified paragraph, the class and the sum. */
function withScales(key: RecapSectionKey | null, parts: readonly RecapPartVM[]): RecapPartVM[] {
  let stage = key === 'stage';
  let spend = key === 'money' || key === 'spend';
  return parts.map((part) => {
    if (part.kind !== 'text') return part;
    if (stage && /стади|stage/iu.test(part.label ?? '')) {
      const scale = scaleOf('stage', STAGES, firstSentence(part.text));
      if (scale !== null) {
        stage = false;
        return { ...part, scale };
      }
    }
    if (spend) {
      const named = part.label !== null && scaleOf('spend', SPENDERS, part.label) !== null;
      const found = scaleOf('spend', SPENDERS, `${part.label ?? ''} ${firstSentence(part.text)}`);
      // «Light spender: 81,97 $…» names the class by its label; «Классификация: light spender.» by its first words.
      const base = found === null ? null : { kind: found.kind, steps: found.steps, at: found.at, lean: found.lean };
      const scale: RecapScaleVM | null = base === null ? null : named && part.label !== null ? { ...base, said: part.label } : { ...base, ...saidOf(firstSentence(part.text)) };
      const money = MONEY.exec(part.text);
      if (scale !== null || (money !== null && /классификац|classification/iu.test(part.label ?? ''))) {
        spend = false;
        // A paragraph that opens with the sum says it first itself: no figure over it.
        const figure = money === null || money.index < 2 ? null : { sum: money[0].trim().replace(/\s+/g, ' '), period: PERIOD.exec(part.text)?.[0] ?? null };
        const months = monthsOf(parts);
        return {
          ...part,
          scale,
          figure: figure === null ? null : { ...figure, period: figure.period === null ? null : lowerFirst(figure.period) },
          ...(months === null ? {} : { months }),
        };
      }
    }
    return part;
  });
}

// ── what a tile of the board shows: first sentences, which way a trend goes, the sums by month ─────────────

/** «Тренд: нерегулярный, с тенденцией к снижению» goes down; «Направление: растёт» goes up. */
function trendOf(text: string): 'up' | 'down' | null {
  if (/подъ[её]м|раст[её]т|рост|теплее|оживл|улучш|growing|rising|up\b/iu.test(text)) return 'up';
  if (/спад|сниж|остыва|пада|хуже|угаса|declin|falling|down\b/iu.test(text)) return 'down';
  return null;
}

const MONTHS = ['январ', 'феврал', 'март', 'апрел', 'ма[йяе]', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
const MONTH_WORD = new RegExp(`(?<!\\p{L})(${MONTHS.join('|')})\\p{L}*`, 'giu');
const MONTH_SUM = new RegExp(`(?<!\\p{L})(${MONTHS.join('|')})\\p{L}*\\s+(\\d[\\d \\u00a0]*(?:[.,]\\d{1,2})?)\\s?\\$`, 'giu');
const monthIndex = (word: string): number => MONTHS.findIndex((stem) => new RegExp(`^${stem}`, 'iu').test(word));
const amount = (digits: string): number => Number.parseFloat(digits.replace(/[\s\u00a0]/gu, '').replace(',', '.'));

/**
 * The sums a money section gives by month («июнь 51,97 $ и сентябрь 30 $»), with the months it says were empty («в июле,
 * августе и пока в октябре ноль»), in the order they come round the year since the longest pause. Null — fewer than two
 * months, or none above zero.
 */
function monthsOf(parts: readonly RecapPartVM[]): RecapMonthVM[] | null {
  const text = parts.map((part) => (part.kind === 'text' ? part.text : part.items.map((item) => item.text).join('. '))).join(' ');
  const found = new Map<number, number>();
  for (const match of text.matchAll(MONTH_SUM)) {
    const month = monthIndex(match[1] ?? '');
    const sum = amount(match[2] ?? '');
    if (month >= 0 && !found.has(month) && Number.isFinite(sum)) found.set(month, sum);
  }
  for (const sentence of sentences(text)) {
    if (!/(?<!\p{L})ноль(?!\p{L})|(?<![\d,.])0\s?\$/iu.test(sentence)) continue;
    for (const match of sentence.matchAll(MONTH_WORD)) {
      const month = monthIndex(match[1] ?? '');
      if (month >= 0 && !found.has(month)) found.set(month, 0);
    }
  }
  if (found.size < 2 || ![...found.values()].some((sum) => sum > 0)) return null;
  const months = [...found.keys()].sort((a, b) => a - b);
  // Round the year from the month after the longest pause: June to October, not January's order.
  let start = 0;
  let pause = -1;
  months.forEach((month, index) => {
    const next = months[(index + 1) % months.length] ?? month;
    const gap = (next - month + 12) % 12 || 12;
    if (gap > pause) {
      pause = gap;
      start = (index + 1) % months.length;
    }
  });
  return [...months.slice(start), ...months.slice(0, start)].map((month) => ({ month, sum: found.get(month) ?? 0 }));
}

/** Each line and paragraph gets its first sentence when it has more; a «Тренд» or «Направление» its way. */
function withLeads(parts: readonly RecapPartVM[]): RecapPartVM[] {
  const lead = (text: string): { readonly lead?: string } => {
    const all = sentences(text);
    return all.length > 1 && all[0] !== undefined ? { lead: all[0] } : {};
  };
  return parts.map((part) => {
    if (part.kind === 'list') return { ...part, items: part.items.map((item) => ({ ...item, ...lead(item.text) })) };
    const trend = /тренд|направлен|динамик|trend|direction/iu.test(part.label ?? '') ? trendOf(firstSentence(part.text)) : null;
    return { ...part, ...lead(part.text), ...(trend === null ? {} : { trend }) };
  });
}

// ── the document ───────────────────────────────────────────────────────────

/** A headed block as a section of the document. */
function sectionOf(block: RecapBlock, name: (heading: string) => string): RecapSectionVM {
  const key = block.heading === '' ? null : recapSectionOf(block.heading);
  return { key, name: block.heading === '' ? '' : name(block.heading), parts: withLeads(withScales(key, partsOf(block.markdown))) };
}

/**
 * The document of a Recap cut into headed blocks (`recapBlocks`); `name` gives a heading as the reader sees it
 * (`recapHeadingText`). Null — no blocks: the text is shown as one.
 */
export function recapDoc(blocks: readonly RecapBlock[] | null, name: (heading: string) => string): RecapDocVM | null {
  if (blocks === null || blocks.length === 0) return null;
  const sections = blocks.map((block) => sectionOf(block, name)).filter((section) => section.parts.length > 0);
  if (sections.length === 0) return null;
  const labelled = sections.filter((section) => section.parts.some((part) => part.label !== null)).length >= sections.length / 2;
  return { sections, labelled };
}

/** A Recap being streamed: its finished sections as the document has them, the heading it writes under now. */
export function recapWrittenVm(text: string, name: (heading: string) => string): RecapWrittenVM | null {
  const written = recapWritten(text);
  if (written === null) return null;
  return {
    done: written.done.map((block) => sectionOf(block, name)).filter((section) => section.parts.length > 0),
    writing: written.writing === '' ? null : { key: recapSectionOf(written.writing), name: name(written.writing) },
  };
}

// ── «Шпаргалка» ────────────────────────────────────────────────────────────

const CRIB_ITEMS = 2;

/** A part's lines: a list's items («Подпись: текст» when labelled), a paragraph's sentences. */
function linesOf(part: RecapPartVM | undefined): string[] {
  if (part === undefined) return [];
  if (part.kind === 'list') return part.items.map((item) => (item.label === null ? item.text : `${capitalize(item.label)}: ${item.text}`));
  return sentences(part.text);
}

const cribLine = (text: string): string => capitalize(firstSentence(text).replace(/[;.]$/, ''));

/**
 * What the folded window keeps over the bar: «Дальше» — the strategy's recommended approach (the short one's next
 * move); «Не забыть» — what the model promised (the open threads); «Не делать» — what to avoid (the boundaries).
 * Two lines a column at most, a sentence each. Null — the text has none of them.
 */
export function recapCrib(doc: RecapDocVM | null): RecapCribVM | null {
  if (doc === null) return null;
  const section = (key: RecapSectionKey): RecapSectionVM | undefined => doc.sections.find((candidate) => candidate.key === key);
  const labelled = (found: RecapSectionVM | undefined, pattern: RegExp): RecapPartVM | undefined => found?.parts.find((part) => pattern.test(part.label ?? ''));
  let next: string[] = [];
  let avoid: string[] = [];
  const strategy = section('strategy');
  const move = section('nextMove');
  if (strategy !== undefined) {
    const approach = labelled(strategy, /рекомендуем|подход|recommended|approach/iu) ?? strategy.parts[strategy.parts.length - 1];
    next = linesOf(approach).slice(0, CRIB_ITEMS);
    avoid = linesOf(labelled(strategy, /избега|avoid|не делать/iu)).slice(0, 1);
  } else if (move !== undefined) {
    next = move.parts.flatMap((part) => linesOf(part)).slice(0, CRIB_ITEMS);
  }
  const loops = section('openLoops') ?? section('threads');
  const promised = labelled(loops, /обещал|promis/iu) ?? loops?.parts[0];
  const keep = linesOf(promised).slice(0, CRIB_ITEMS);
  const bounds = section('boundaries');
  if (avoid.length === 0 && bounds !== undefined) {
    avoid = bounds.parts
      .flatMap((part) => linesOf(part))
      .filter((line) => line.length > 30)
      .slice(0, 1);
  }
  const crib = { next: next.map(cribLine), keep: keep.map(cribLine), avoid: avoid.map(cribLine) };
  return crib.next.length + crib.keep.length + crib.avoid.length === 0 ? null : crib;
}
