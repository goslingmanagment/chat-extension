// What is new in each version — the history the site, CHANGELOG.md and the
// Telegram post are made from. Two kinds of release in it:
//
//   - `legacy`: the hand-written sections of CHANGELOG.md in git (up to 0.5.21),
//     as they are;
//   - `notes`: every later version, made of the notes of changes (changes.ts)
//     added to main between its tag and the one before.
//
// Commit subjects never reach a chatter: a version with no note says only that
// nothing changes for the work. The GitHub release keeps every commit, with its
// PR number. No I/O here.

import type { Block, Changelog } from './changelog.ts';
import { blocksText, KIND_EMOJI, KIND_LABEL, sortNotes, type Note } from './changes.ts';

export type Release =
  | { readonly kind: 'notes'; readonly version: string; readonly date: string | null; readonly notes: readonly Note[] }
  | { readonly kind: 'legacy'; readonly version: string; readonly label: string; readonly blocks: readonly Block[] };

export interface History {
  readonly title: string;
  /** Newest first. */
  readonly releases: readonly Release[];
}

/** What a version without a note says. */
export const NOTHING_NEW = 'Внутренние улучшения: для работы ничего не меняется.';

/** The history: `later` (newest first, all above the changelog's top) over the hand-written sections. */
export function historyOf(changelog: Changelog, later: ReadonlyArray<{ readonly version: string; readonly date: string | null; readonly notes: readonly Note[] }>): History {
  return {
    title: changelog.title,
    releases: [
      ...later.map((release): Release => ({ kind: 'notes', version: release.version, date: release.date, notes: sortNotes(release.notes) })),
      ...changelog.sections.map((section): Release => ({ kind: 'legacy', version: section.version, label: section.label, blocks: section.blocks })),
    ],
  };
}

export function releaseOf(history: History, version: string): Release {
  const release = history.releases.find((candidate) => candidate.version === version);
  if (release === undefined) throw new Error(`no notes of ${version} in the history`);
  return release;
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** 2026-10-22 → «22 октября 2026». */
export function russianDate(isoDay: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay);
  if (match === null) throw new Error(`«${isoDay}» is not a YYYY-MM-DD day`);
  const [, year, month, day] = match;
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? '?'} ${year}`;
}

/** The label under a version: its date for a release of notes, the heading's rest for a hand-written one. */
export function releaseLabel(release: Release): string {
  if (release.kind === 'legacy') return release.label;
  return release.date === null ? '' : russianDate(release.date);
}

/** The groups of a release's notes in reading order: the intro, new, improved, fixed. */
export function groups(notes: readonly Note[]): Array<{ readonly kind: Note['kind']; readonly notes: readonly Note[] }> {
  const out: Array<{ kind: Note['kind']; notes: Note[] }> = [];
  for (const note of sortNotes(notes)) {
    const last = out.at(-1);
    if (last?.kind === note.kind) last.notes.push(note);
    else out.push({ kind: note.kind, notes: [note] });
  }
  return out;
}

// ── CHANGELOG.md, as the release writes it for its build (the sources archive) ──

const titleText = (note: Note): string => note.title.map((part) => part.text).join('');

function notesSection(release: Extract<Release, { kind: 'notes' }>): string {
  const label = releaseLabel(release);
  const lines = [`## ${release.version}${label === '' ? '' : ` · ${label}`}`, ''];
  if (release.notes.length === 0) lines.push(`- ${NOTHING_NEW}`, '');
  for (const group of groups(release.notes)) {
    if (group.kind !== 'intro') lines.push(`### ${KIND_EMOJI[group.kind]} ${KIND_LABEL[group.kind]}`, '');
    for (const note of group.notes) {
      const story = blocksText(note.story).replace(/[*_`]/g, '').replace(/\]\(/g, '] (');
      lines.push(group.kind === 'intro' ? `${titleText(note).replace(/[*_`]/g, '')}. ${story}` : `- **${titleText(note).replace(/[*_`]/g, '')}.** ${story}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * CHANGELOG.md with the sections of the releases of notes on top. `committed`
 * is the file as git has it: its hand-written sections stay as they are.
 */
export function changelogMarkdown(committed: string, history: History): string {
  const sections = history.releases.flatMap((release) => (release.kind === 'notes' ? [notesSection(release).trimEnd()] : []));
  if (sections.length === 0) return committed;
  const lines = committed.split('\n');
  const title = lines.findIndex((line) => line.startsWith('# '));
  const head = lines.slice(0, title + 1).join('\n');
  const rest = lines.slice(title + 1).join('\n').replace(/^\n+/, '');
  return `${head}\n\n${sections.join('\n\n')}\n\n${rest}`;
}

// ── the GitHub release ──

/** The body of the GitHub release: the notes' titles, then every commit since the previous tag. */
export function githubNotes(input: { readonly version: string; readonly previous: string | null; readonly subjects: readonly string[]; readonly notes: readonly Note[]; readonly repo: string }): string {
  const notes = sortNotes(input.notes).map((note) => `- ${KIND_EMOJI[note.kind]} ${titleText(note)} (\`changes/${note.slug}.md\`)`);
  const lines = input.subjects.length === 0 ? ['- (no commits)'] : input.subjects.map((subject) => `- ${subject}`);
  const compare = input.previous === null ? [] : ['', `https://github.com/${input.repo}/compare/v${input.previous}...v${input.version}`];
  return [...(notes.length === 0 ? [] : ['### For chatters', '', ...notes, '', '### Commits', '']), ...lines, ...compare, ''].join('\n');
}

// ── feat/fix without a note ──

const PREFIX_RE = /^([a-z]+)(?:\([^)]*\))?!?:\s*/i;

/** true — a commit a chatter notices by its type: it needs a note (changes/README.md). */
export function needsNote(subject: string): boolean {
  const type = PREFIX_RE.exec(subject)?.[1]?.toLowerCase();
  return type === 'feat' || type === 'fix';
}
