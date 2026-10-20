// What is new in a version, made from the commits since the previous tag —
// nobody writes it by hand. The squash commits of main (`git log
// --first-parent`) give one line each:
//
//   - the CHANGELOG section (the site's "What's new" page, the history, the
//     announcement): what a chatter may notice — features and fixes, without
//     the conventional prefix and the PR number;
//   - the GitHub release: every commit as it is, with its PR number.
//
// CHANGELOG.md in git keeps the hand-written history up to 0.5.7; the sections
// of later versions are made again from their tags whenever they are needed
// (local.ts `changelogFor`). No I/O here.

/** Conventional types that never reach a chatter. */
const HIDDEN_TYPES = new Set(['docs', 'doc', 'test', 'tests', 'ci', 'chore', 'build', 'style', 'refactor', 'release', 'revert']);

const PREFIX_RE = /^([a-z]+)(?:\([^)]*\))?!?:\s*/i;

/** A subject as a chatter reads it; null — a commit that is not about the product. */
export function chatterLine(subject: string): string | null {
  const prefix = PREFIX_RE.exec(subject);
  if (prefix !== null && HIDDEN_TYPES.has((prefix[1] ?? '').toLowerCase())) return null;
  let text = subject.slice(prefix?.[0].length ?? 0).replace(/\s*\(#\d+\)\s*$/, '').trim();
  // The changelog takes a small Markdown subset (changelog.ts): no stray marks, no links of a commit's own.
  text = text.replace(/[*_]{2,}/g, '').replace(/\]\(/g, '] (').replace(/!\[/g, '[');
  if ((text.match(/`/g) ?? []).length % 2 === 1) text = text.replace(/`/g, '');
  text = text.trim();
  if (text === '') return null;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?…]$/.test(text) ? '' : '.'}`;
}

/** The `## version` section of CHANGELOG.md. */
export function changelogSection(version: string, subjects: readonly string[]): string {
  const lines = [...new Set(subjects.map(chatterLine).filter((line): line is string => line !== null))];
  return [`## ${version}`, '', ...(lines.length === 0 ? ['- Исправления и улучшения.'] : lines.map((line) => `- ${line}`)), ''].join('\n');
}

/**
 * CHANGELOG.md with the sections of later versions on top. `committed` is the
 * file as git has it; `sections` — newest first, each above what it has.
 */
export function withSections(committed: string, sections: readonly string[]): string {
  if (sections.length === 0) return committed;
  const lines = committed.split('\n');
  const title = lines.findIndex((line) => line.startsWith('# '));
  const head = lines.slice(0, title + 1).join('\n');
  const rest = lines.slice(title + 1).join('\n').replace(/^\n+/, '');
  return `${head}\n\n${sections.map((section) => section.trimEnd()).join('\n\n')}\n\n${rest}`;
}

/** The body of the GitHub release: every commit since the previous tag. */
export function githubNotes(input: { readonly version: string; readonly previous: string | null; readonly subjects: readonly string[]; readonly repo: string }): string {
  const lines = input.subjects.length === 0 ? ['- (no commits)'] : input.subjects.map((subject) => `- ${subject}`);
  const compare = input.previous === null ? [] : ['', `https://github.com/${input.repo}/compare/v${input.previous}...v${input.version}`];
  return [...lines, ...compare, ''].join('\n');
}
