// Recap text (architecture.md §10.1 «Markdown разбирается один раз, по
// готовому результату», AI-069, AI-137). The answer is prepared once, on
// `done`: reasoning removed, line ends normalised. A Recap of either length is
// also cut into its headed blocks («Кто», «Траты»… of the short one, «Досье»…
// of the full one); a text with fewer than two headings stays one text. Recap
// is never a message to the fan: no Split, no markers, nothing insertable.

import { type UiTextKey } from '@cg/contracts/i18n/keys';

import { normalizeNewlines } from '../text';
import { stripThinkBlocks } from './cleanup';

export interface RecapBlock {
  readonly heading: string;
  readonly markdown: string;
}

/** Headings longer than this are sentences, not headings. */
const HEADING_MAX_CHARS = 80;
const BLOCKS_MAX = 24;

/** AI-137: the finished text as it is stored, shown and copied. */
export function recapText(raw: string): string {
  return normalizeNewlines(stripThinkBlocks(raw))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const hasLetters = (text: string): boolean => /\p{L}/u.test(text);
const isUpperCase = (text: string): boolean => hasLetters(text) && text === text.toUpperCase() && text !== text.toLowerCase();

/**
 * A heading line: a Markdown heading, a line that is bold as a whole, or a
 * line of capitals (with an optional «1.» number and a trailing colon), as
 * the hub's fan-summary prompt asks for («clear headers, plain text»).
 */
export function recapHeadingOf(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > HEADING_MAX_CHARS + 8) return null;
  const hash = /^#{1,6}[ \t]+(.+?)[ \t]*#*$/.exec(trimmed);
  const bold = /^(?:\d{1,2}[.)][ \t]+)?(?:\*\*|__)(.+?)(?:\*\*|__):?$/.exec(trimmed);
  const title = (hash?.[1] ?? bold?.[1] ?? null)?.replace(/:$/, '').trim() ?? null;
  if (title !== null) return title.length > 0 && title.length <= HEADING_MAX_CHARS && hasLetters(title) ? title : null;
  const plain = /^(?:\d{1,2}[.)][ \t]+)?(.+?):?$/.exec(trimmed)?.[1]?.trim() ?? '';
  return plain.length >= 3 && plain.length <= HEADING_MAX_CHARS && /^\p{L}/u.test(plain) && isUpperCase(plain) && !/[.!?…]$/.test(plain) ? plain : null;
}

/**
 * The headed blocks of a Recap, or null when the text has fewer than two
 * headings (it is then shown as one text). Text before the first heading
 * becomes a block without a heading (shown without a heading line).
 */
export function recapBlocks(markdown: string): RecapBlock[] | null {
  const blocks: { heading: string; lines: string[] }[] = [];
  let headings = 0;
  for (const line of markdown.split('\n')) {
    const heading = recapHeadingOf(line);
    if (heading !== null) {
      headings += 1;
      blocks.push({ heading, lines: [] });
      continue;
    }
    if (blocks.length === 0) blocks.push({ heading: '', lines: [] });
    blocks[blocks.length - 1]?.lines.push(line);
  }
  if (headings < 2) return null;
  const out = blocks
    .map((block) => ({ heading: block.heading, markdown: block.lines.join('\n').trim() }))
    .filter((block) => block.markdown.length > 0);
  return out.length < 2 || out.length > BLOCKS_MAX ? null : out;
}

/** 1.20.0 (decision X47): the sections the hub's fan-summary prompt asks for, as the reader's language names them. */
export const RECAP_SECTION_KEYS = {
  dossier: 'recap.section.dossier',
  portrait: 'recap.section.portrait',
  stage: 'recap.section.stage',
  communication: 'recap.section.communication',
  money: 'recap.section.money',
  openLoops: 'recap.section.openLoops',
  strategy: 'recap.section.strategy',
  // The short Recap's sections (the hub's short fan-summary prompt: WHO … NEXT MOVE; the old client's summary-markdown.ts).
  who: 'recap.section.who',
  spend: 'recap.section.spend',
  triggers: 'recap.section.triggers',
  boundaries: 'recap.section.boundaries',
  threads: 'recap.section.threads',
  nextMove: 'recap.section.nextMove',
} as const satisfies Readonly<Record<string, UiTextKey>>;

/** The prompts' headings («1. DOSSIER» …, «WHO» …; `templates.ts` FAN_SUMMARY_TEMPLATE) and the Russian a model may write instead. */
const SECTION_OF: Readonly<Record<string, keyof typeof RECAP_SECTION_KEYS>> = {
  WHO: 'who',
  'КТО': 'who',
  'SPEND PATTERN': 'spend',
  'ТРАТЫ': 'spend',
  'ПАТТЕРН ТРАТ': 'spend',
  TRIGGERS: 'triggers',
  'ТРИГГЕРЫ': 'triggers',
  BOUNDARIES: 'boundaries',
  'ГРАНИЦЫ': 'boundaries',
  'ACTIVE THREADS': 'threads',
  'АКТИВНЫЕ НИТИ': 'threads',
  'ОТКРЫТЫЕ НИТИ': 'threads',
  'NEXT MOVE': 'nextMove',
  'СЛЕДУЮЩИЙ ХОД': 'nextMove',
  DOSSIER: 'dossier',
  'ДОСЬЕ': 'dossier',
  'PSYCHOLOGICAL PORTRAIT': 'portrait',
  'ПСИХОЛОГИЧЕСКИЙ ПОРТРЕТ': 'portrait',
  'STAGE AND TRAJECTORY': 'stage',
  'СТАДИЯ И ТРАЕКТОРИЯ': 'stage',
  'COMMUNICATION DYNAMICS': 'communication',
  'ДИНАМИКА ОБЩЕНИЯ': 'communication',
  'FINANCIAL PROFILE': 'money',
  'ФИНАНСОВЫЙ ПРОФИЛЬ': 'money',
  'OPEN LOOPS': 'openLoops',
  'ОТКРЫТЫЕ ПЕТЛИ': 'openLoops',
  STRATEGY: 'strategy',
  'СТРАТЕГИЯ': 'strategy',
};

/**
 * A block's heading as the reader sees it (1.20.0, decision X47): a section of the hub's fan profile in the reader's
 * language («1. DOSSIER» → «Досье»); any other heading in capitals in sentence case («KEY QUOTES» → «Key quotes»);
 * the rest as written.
 */
export function recapHeadingText(heading: string, text: (key: UiTextKey) => string): string {
  const bare = heading.replace(/^\d{1,2}[.)][ \t]+/, '').trim();
  const section = SECTION_OF[bare.toUpperCase().replace(/\s+/g, ' ')];
  if (section !== undefined) return text(RECAP_SECTION_KEYS[section]);
  if (!isUpperCase(bare)) return bare;
  const lower = bare.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
