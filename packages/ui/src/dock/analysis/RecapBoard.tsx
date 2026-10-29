// «Сводка» (2026-10-28, the owner: «давай 1 щас и 2 позже как альтер вид»): the Recap window's second view, a board that
// answers at a glance. «Что делать сейчас» leads: the strategy's recommended approach, its first move set large, the
// hooks under it. Beside it what is still open; under them who he is, the money and the stage on their aids, how he talks
// and his portrait. A tile shows whole lines and paragraphs, never a cut sentence: what does not fit is named in its
// footer, and a press on the tile opens its section in «Досье». A Recap in another format gets a plain grid.

import { type JSX } from 'preact';
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import { type RecapDocVM, type RecapMonthVM, type RecapPartVM, type RecapScaleVM, type RecapSectionKey, type RecapSectionVM } from '@cg/contracts/vm';

import { Icon, useI18n, useKit, windowOf } from '../../kit';
import { RecapInline, Tile } from './RecapDoc';

type Role = 'hero' | 'loops' | 'who' | 'money' | 'stage' | 'q1' | 'q2' | 'x';
type Layout = 'full' | 'short' | 'generic';

const ROLE: Readonly<Record<RecapSectionKey, Role>> = {
  strategy: 'hero',
  nextMove: 'hero',
  openLoops: 'loops',
  threads: 'loops',
  dossier: 'who',
  who: 'who',
  money: 'money',
  spend: 'money',
  stage: 'stage',
  communication: 'q1',
  triggers: 'q1',
  portrait: 'q2',
  boundaries: 'q2',
};

/** The board knows the hub's two formats; any other set of sections is a plain grid in the text's order. */
function layoutOf(sections: readonly RecapSectionVM[]): Layout {
  const roles = sections.map((section) => (section.key === null ? null : ROLE[section.key]));
  const known = roles.every((role) => role !== null) && new Set(roles).size === roles.length && roles.includes('hero');
  if (!known) return 'generic';
  return roles.includes('stage') ? 'full' : 'short';
}

/** The smallest whole thing a tile shows: a paragraph, a list's line, a «Подпись: текст» of «Кто он». */
interface Piece {
  readonly key: string;
  readonly kind: 'lead' | 'para' | 'item' | 'def';
  /** The text order: what the tile shows is set in it, whatever order it was chosen in. */
  readonly order: number;
  /** A list's label, shown once over its first line on the tile. */
  readonly group: string | null;
  readonly avoid: boolean;
  readonly label: string | null;
  readonly note: string | null;
  readonly text: string;
  /** The first sentence, when the text has more: the last resort of a tile too small for the whole. */
  readonly short: string | null;
}

const isApproach = (part: RecapPartVM): boolean => /рекомендуем|подход|next move|следующ|план/iu.test(part.label ?? '');
const isHooks = (part: RecapPartVM): boolean => part.kind === 'list' && /хук|hook|крюч/iu.test(part.label ?? '');

function piecesOf(parts: readonly RecapPartVM[], prefix: string, first = 0): Piece[] {
  let order = first;
  return parts.flatMap((part, at): Piece[] => {
    if (part.kind === 'text') {
      order += 1;
      return [{ key: `${prefix}${String(at)}`, kind: 'para', order, group: null, avoid: part.tone === 'avoid', label: part.label, note: part.note, text: part.text, short: part.lead ?? null }];
    }
    return part.items.map((item, line): Piece => {
      order += 1;
      return { key: `${prefix}${String(at)}.${String(line)}`, kind: 'item', order, group: part.label, avoid: part.tone === 'avoid', label: item.label, note: item.note, text: item.text, short: item.lead ?? null };
    });
  });
}

/**
 * «Что делать сейчас»: the approach first, its first move as the lead; then what to avoid; the hooks as a strip under.
 * No approach named, no lead: what to avoid is never set large as the thing to do.
 */
export function heroOf(section: RecapSectionVM): { readonly pieces: Piece[]; readonly hooks: { readonly label: string; readonly heads: readonly string[] } | null } {
  const hooksPart = section.parts.find(isHooks);
  const heads = hooksPart?.kind === 'list' ? hooksPart.items.map((item) => (item.label ?? item.lead ?? item.text).replace(/[.;:]$/, '').trim()) : [];
  const hooks = hooksPart !== undefined && heads.length >= 2 && heads.every((head) => head.length > 0 && head.length <= 64) ? { label: hooksPart.label ?? '', heads } : null;
  const rest = section.parts.filter((part) => hooks === null || part !== hooksPart);
  // The approach: a part its label names so, or any of «Следующий ход», which is all the next move; what to avoid never.
  const approach = rest.filter((part) => part.tone !== 'avoid' && (section.key === 'nextMove' || isApproach(part)));
  const avoid = rest.filter((part) => !approach.includes(part) && part.tone === 'avoid');
  const others = rest.filter((part) => !approach.includes(part) && !avoid.includes(part));
  const pieces = piecesOf([...approach, ...avoid, ...others], 'h');
  const first = pieces[0];
  // No approach: no lead, every part keeps its label (what to avoid its colour too).
  if (first === undefined || approach.length === 0) return { pieces, hooks };
  // The first move, set large; the rest of its text, if any, follows it.
  const lead: Piece = { ...first, key: `${first.key}L`, kind: 'lead', text: first.short ?? first.text, short: null, label: null };
  const after = first.short === null ? '' : first.text.slice(first.text.indexOf(first.short) + first.short.length).trim();
  return { pieces: [lead, ...(after === '' ? [] : [{ ...first, key: `${first.key}R`, kind: 'para' as const, group: null, label: null, text: after, short: null }]), ...pieces.slice(1)], hooks };
}

/** «Незакрытое»: one line of each kind first (promised, unanswered, reasons to come back), shown in the text's order. */
function loopsOf(section: RecapSectionVM): Piece[] {
  const groups = section.parts.map((part, at) => piecesOf([part], `l${String(at)}.`, at * 100));
  const out: Piece[] = [];
  const total = groups.reduce((sum, group) => sum + group.length, 0);
  for (let round = 0; out.length < total; round++) {
    for (const group of groups) {
      const piece = group[round];
      if (piece !== undefined) out.push(piece);
    }
  }
  return out;
}

/** «Кто он»: the labelled facts, each by its first sentence (the section has the rest). */
function whoOf(section: RecapSectionVM): { readonly pieces: Piece[]; readonly dl: boolean } {
  const facts = section.parts.filter((part) => part.kind === 'text' && part.label !== null);
  if (facts.length < 2) return { pieces: piecesOf(section.parts, 'w'), dl: false };
  return {
    pieces: piecesOf(facts, 'w').map((piece) => ({ ...piece, kind: 'def' as const, text: piece.short ?? piece.text, short: null })),
    dl: true,
  };
}

const capitalize = (text: string): string => text.replace(/^(\s*)(\p{Ll})/u, (_, space: string, letter: string) => space + letter.toUpperCase());

function Arrow({ way }: { readonly way: 'up' | 'down' | undefined }): JSX.Element | null {
  if (way === undefined) return null;
  return (
    <span class={`cg-rx-arrow is-${way}`} aria-hidden="true">
      {way === 'up' ? '↗' : '↘'}
    </span>
  );
}

function Bars({ months }: { readonly months: readonly RecapMonthVM[] }): JSX.Element {
  const i18n = useI18n();
  const names = i18n.t('recap.board.monthsShort').split(' ');
  const max = Math.max(...months.map((month) => month.sum));
  const said = months.map((month) => `${names[month.month] ?? ''}: ${month.sum > 0 ? `${String(Math.round(month.sum))} $` : i18n.t('recap.board.zero')}`).join(', ');
  return (
    <div class="cg-rx-bars" role="img" aria-label={i18n.t('recap.board.months', { list: said })}>
      {months.map((month) => (
        <div key={month.month} class={`cg-rx-bar${month.sum > 0 ? '' : ' is-zero'}`}>
          {month.sum > 0 ? <em>{Math.round(month.sum)}</em> : null}
          <i style={month.sum > 0 ? `height: calc(var(--cg-rx-bh) * ${Math.max(0.18, month.sum / max).toFixed(3)})` : undefined} />
          <span>{names[month.month] ?? ''}</span>
        </div>
      ))}
    </div>
  );
}

function Steps({ scale }: { readonly scale: RecapScaleVM }): JSX.Element {
  const last = scale.steps.length - 1;
  return (
    <div class="cg-rx-steps2" aria-hidden="true">
      <div class="cg-rx-steps2__bar">
        {scale.steps.map((step, index) => (
          <i key={step} class={index === scale.at ? 'is-on' : scale.lean.includes(index) ? 'is-lean' : index < scale.at ? 'is-past' : ''} />
        ))}
      </div>
      <div class="cg-rx-steps2__names">
        {scale.steps.map((step, index) => (
          <span key={step} class={index === scale.at ? 'is-on' : ''}>
            {index === scale.at || ((index === 0 || index === last) && Math.abs(index - scale.at) > 1) ? step : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

/** «Деньги»: the sum, the class, what it covers, the months, the trend. Null — the text says none of it. */
function moneyOf(section: RecapSectionVM): { readonly top: JSX.Element; readonly used: ReadonlySet<RecapPartVM> } | null {
  const aid = section.parts.find((part) => part.kind === 'text' && (part.figure !== null || part.scale?.kind === 'spend'));
  if (aid === undefined || aid.kind !== 'text') return null;
  const trend = section.parts.find((part) => part.kind === 'text' && part.trend !== undefined);
  // The paragraph the class is read from goes into the aid: its sum set large, or, when it opens with the sum, its text
  // under the class without the label the class already says («Moderate spender: 186 $ за 4 месяца…»).
  const used = new Set<RecapPartVM>([aid]);
  if (trend !== undefined) used.add(trend);
  const chip = aid.scale === null ? null : (aid.scale.said ?? aid.scale.steps[aid.scale.at] ?? null);
  const top = (
    <div class="cg-rx-aid">
      {aid.figure === null ? null : (
        <div class="cg-rx-aid__fig">
          <b>{aid.figure.sum}</b>
          {chip === null ? null : <span class="cg-rx-chip">{chip}</span>}
        </div>
      )}
      {aid.figure === null && chip !== null ? (
        <div class="cg-rx-aid__fig">
          <span class="cg-rx-chip">{chip}</span>
        </div>
      ) : null}
      {aid.figure === null ? (
        <p class="cg-rx-aid__text">
          {aid.label === null || aid.label === chip ? null : <b class="cg-rx-il">{`${capitalize(aid.label)}: `}</b>}
          <RecapInline text={aid.text} upper />
        </p>
      ) : null}
      {aid.figure?.period === null || aid.figure === null ? null : <div class="cg-rx-aid__per">{capitalize(aid.figure.period)}</div>}
      {aid.months === undefined ? null : <Bars months={aid.months} />}
      {trend === undefined || trend.kind !== 'text' ? null : (
        <div class="cg-rx-aid__line">
          <b>{trend.label}</b>
          <Arrow way={trend.trend} />
          <RecapInline text={trend.lead ?? trend.text} />
        </div>
      )}
    </div>
  );
  return { top, used };
}

/** «Стадия»: the step in the text's words, what it adds, the scale, which way it goes. Null — the text names no step. */
function stageOf(section: RecapSectionVM): { readonly top: JSX.Element; readonly used: ReadonlySet<RecapPartVM> } | null {
  const aid = section.parts.find((part) => part.kind === 'text' && part.scale?.kind === 'stage');
  if (aid === undefined || aid.kind !== 'text' || aid.scale === null) return null;
  const way = section.parts.find((part) => part !== aid && part.kind === 'text' && part.trend !== undefined);
  const used = new Set<RecapPartVM>([aid]);
  if (way !== undefined) used.add(way);
  const scale = aid.scale;
  const top = (
    <div class="cg-rx-aid">
      <div class="cg-rx-aid__now">
        {scale.said ?? scale.steps[scale.at]}
        {scale.rest === undefined ? null : <small>{scale.rest}</small>}
      </div>
      <Steps scale={scale} />
      {way === undefined || way.kind !== 'text' ? null : (
        <div class="cg-rx-aid__line">
          <b>{way.label}</b>
          <Arrow way={way.trend} />
          <RecapInline text={way.lead ?? way.text} />
        </div>
      )}
    </div>
  );
  return { top, used };
}

function PiecesView({ pieces, dl }: { readonly pieces: readonly Piece[]; readonly dl: boolean }): JSX.Element {
  if (dl) {
    return (
      <dl class="cg-rx-bdl">
        {pieces.map((piece) => (
          <div key={piece.key}>
            <dt>{piece.label}</dt>
            <dd>
              <RecapInline text={piece.text} upper />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  // Consecutive lines of one list go under one heading; the lead's own list goes on without a second one.
  const runs: { readonly group: string | null; readonly avoid: boolean; readonly items: Piece[]; readonly head: boolean }[] = [];
  const out: JSX.Element[] = [];
  let leadGroup: string | null = null;
  const flush = (): void => {
    const run = runs.pop();
    if (run === undefined) return;
    out.push(
      <div key={`g${String(out.length)}`} class={`cg-rx-bg${run.avoid ? ' is-avoid' : ''}`}>
        {run.head && run.group !== null ? <div class="cg-rx-bg__h">{run.group}</div> : null}
        <ul>
          {run.items.map((piece) => (
            <li key={piece.key}>
              {piece.label === null ? null : <b class="cg-rx-il">{`${capitalize(piece.label)}: `}</b>}
              <RecapInline text={piece.text} upper={piece.label === null} />
            </li>
          ))}
        </ul>
      </div>,
    );
  };
  for (const piece of pieces) {
    if (piece.kind === 'lead') {
      flush();
      leadGroup = piece.group;
      out.push(
        <p key={piece.key} class="cg-rx-blead">
          <RecapInline text={piece.text} upper />
        </p>,
      );
      continue;
    }
    if (piece.kind === 'item') {
      const open = runs[runs.length - 1];
      if (open !== undefined && open.group === piece.group) open.items.push(piece);
      else {
        flush();
        runs.push({ group: piece.group, avoid: piece.avoid, items: [piece], head: piece.group !== leadGroup });
      }
      continue;
    }
    flush();
    out.push(
      <p key={piece.key} class={`cg-rx-bp${piece.avoid ? ' is-avoid' : ''}`}>
        {piece.label === null ? null : <b class="cg-rx-il">{`${capitalize(piece.label)}: `}</b>}
        <RecapInline text={piece.text} upper={piece.label === null} />
      </p>,
    );
  }
  flush();
  return <>{out}</>;
}

/**
 * The tile's body shows the most of its pieces that fit, by priority (the order they come in), set in the text's order;
 * never a cut sentence. Found by halving: a few renders, before the frame is painted.
 */
function useFit(count: number, body: { current: HTMLElement | null }, reset: string): number {
  const { root } = useKit();
  const [size, setSize] = useState(0);
  const key = `${reset}#${String(size)}#${String(count)}`;
  const [fit, setFit] = useState({ key, lo: 0, hi: count, k: count });
  // A new text, length or tile size: measure again from all of it.
  const current = fit.key === key ? fit : { key, lo: 0, hi: count, k: count };
  useLayoutEffect(() => {
    const element = body.current;
    if (element === null || (current.lo >= current.hi && current.key === fit.key)) return;
    const fits = element.scrollHeight <= element.clientHeight + 1;
    const lo = fits ? current.k : current.lo;
    const hi = fits ? (current.k === count ? count : current.hi) : current.k - 1;
    const next = lo >= hi ? { ...current, lo, hi: lo, k: lo } : { ...current, lo, hi, k: Math.ceil((lo + hi) / 2) };
    if (next.key !== fit.key || next.k !== fit.k || next.lo !== fit.lo || next.hi !== fit.hi) setFit(next);
  });
  useLayoutEffect(() => {
    const element = body.current;
    const view = windowOf(root) as (Window & typeof globalThis) | null;
    const Observer = view?.ResizeObserver;
    if (element === null || view === null || Observer === undefined) return undefined;
    // A new width wraps the lines anew, a new height holds more or less; the text's font arriving late does either.
    let last = { width: element.clientWidth, height: element.clientHeight };
    const again = (): void => setSize((value) => value + 1);
    const observer = new Observer(() => {
      if (Math.abs(element.clientHeight - last.height) < 2 && Math.abs(element.clientWidth - last.width) < 2) return;
      last = { width: element.clientWidth, height: element.clientHeight };
      again();
    });
    observer.observe(element);
    const fonts = view.document.fonts as FontFaceSet | undefined;
    fonts?.addEventListener('loadingdone', again);
    return () => {
      observer.disconnect();
      fonts?.removeEventListener('loadingdone', again);
    };
  }, [body, root]);
  return current.k;
}

interface TileSpec {
  readonly at: number;
  readonly role: Role;
  readonly section: RecapSectionVM;
  readonly name: string;
  readonly aux: string | null;
  readonly top: JSX.Element | null;
  readonly pieces: readonly Piece[];
  readonly dl: boolean;
  readonly hooks: { readonly label: string; readonly heads: readonly string[] } | null;
  /** Whether the footer counts lines («ещё 3 пункта») or names what is inside («Внутри: Тренд и ещё 2»). */
  readonly count: boolean;
}

function BoardTile({ spec, index, layout, onOpen }: { readonly spec: TileSpec; readonly index: number; readonly layout: Layout; readonly onOpen: (at: number) => void }): JSX.Element {
  const i18n = useI18n();
  const body = useRef<HTMLDivElement>(null);
  const reset = useMemo(() => spec.pieces.map((piece) => `${piece.key}:${String(piece.text.length)}`).join('|'), [spec.pieces]);
  const k = useFit(spec.pieces.length, body, reset);
  const shown = useMemo(() => [...spec.pieces.slice(0, k)].sort((a, b) => a.order - b.order), [spec.pieces, k]);
  // Not even one whole piece: its first sentence.
  const first = spec.pieces[0];
  const view = k === 0 && first !== undefined && first.short !== null ? [{ ...first, text: first.short, short: null }] : shown;
  const hidden = spec.pieces.length - (view.length === 0 ? 0 : k === 0 ? 1 : k);
  let more: string | null = null;
  if (hidden > 0) {
    const labels = [...new Set(spec.pieces.slice(Math.max(k, view.length)).map((piece) => piece.group ?? piece.label).filter((label): label is string => label !== null))];
    if (spec.count || labels.length === 0) more = i18n.plural('recap.board.more', hidden);
    else if (labels.length <= 2) more = i18n.t('recap.board.inside', { labels: labels.map(capitalize).join(', ') });
    else more = i18n.t('recap.board.insideMore', { labels: labels.slice(0, 2).map(capitalize).join(', '), n: labels.length - 2 });
  }
  const area = layout === 'generic' ? undefined : spec.role;
  return (
    <article
      class={`cg-rx-bt is-${spec.role}${spec.role === 'q1' || spec.role === 'q2' || spec.role === 'x' ? ' is-quiet' : ''}`}
      style={`${area === undefined ? '' : `grid-area: ${area}; `}--cg-i: ${String(index)}`}
      onClick={(event) => {
        // A press on a tile opens its section; a link of the text keeps its own.
        if (event.target instanceof Element && event.target.closest('a') !== null) return;
        onOpen(spec.at);
      }}
    >
      <h3 class="cg-rx-bt__h">
        <button type="button" class="cg-rx-bt__open" aria-label={i18n.t('recap.board.open', { tile: spec.name, name: spec.section.name })}>
          <Tile section={spec.section.key} size={spec.role === 'hero' ? 16 : 14} />
          <span class="cg-rx-bt__name">{spec.name}</span>
        </button>
        <span class="cg-rx-bt__sp" />
        {spec.aux === null ? null : <span class="cg-rx-bt__aux">{spec.aux}</span>}
        <span class="cg-rx-bt__go" aria-hidden="true">
          <Icon name="expand" size={13} />
        </span>
      </h3>
      <div ref={body} class="cg-rx-bt__body">
        {spec.top}
        <PiecesView pieces={view} dl={spec.dl} />
      </div>
      {spec.hooks === null ? null : (
        <div class="cg-rx-bt__hooks">
          <span class="cg-rx-bt__hooks-h">{spec.hooks.label}</span>
          <ul>
            {spec.hooks.heads.map((head, at) => (
              <li key={at}>
                <RecapInline text={head} upper />
              </li>
            ))}
          </ul>
        </div>
      )}
      {more === null ? null : <div class="cg-rx-bt__more">{more}</div>}
    </article>
  );
}

const ORDER: Readonly<Record<'full' | 'short', readonly Role[]>> = {
  full: ['hero', 'loops', 'who', 'money', 'stage', 'q1', 'q2'],
  short: ['hero', 'loops', 'q2', 'who', 'money', 'q1'],
};

export function RecapBoard({ doc, onOpen }: { readonly doc: RecapDocVM; readonly onOpen: (at: number) => void }): JSX.Element {
  const i18n = useI18n();
  const specs = useMemo((): TileSpec[] => {
    const sections = doc.sections.map((section, at) => ({ section, at })).filter(({ section }) => section.name !== '');
    const layout = layoutOf(sections.map(({ section }) => section));
    const tiles = sections.map(({ section, at }): TileSpec => {
      const role: Role = layout === 'generic' || section.key === null ? 'x' : ROLE[section.key];
      const base = { at, role, section, name: section.name, aux: null, top: null, pieces: piecesOf(section.parts, 'p'), dl: false, hooks: null, count: false };
      switch (role) {
        case 'hero': {
          const { pieces, hooks } = heroOf(section);
          return { ...base, name: i18n.t('recap.board.now'), aux: section.name, pieces, hooks, count: true };
        }
        case 'loops':
          return { ...base, pieces: loopsOf(section), count: true };
        case 'who': {
          const { pieces, dl } = whoOf(section);
          return { ...base, name: i18n.t('recap.board.who'), pieces, dl };
        }
        case 'money': {
          const money = moneyOf(section);
          return money === null ? base : { ...base, top: money.top, pieces: piecesOf(section.parts.filter((part) => !money.used.has(part)), 'm') };
        }
        case 'stage': {
          const stage = stageOf(section);
          return stage === null ? base : { ...base, name: i18n.t('recap.board.stage'), top: stage.top, pieces: piecesOf(section.parts.filter((part) => !stage.used.has(part)), 's') };
        }
        case 'q1':
        case 'q2':
        case 'x':
          return base;
      }
    });
    if (layout === 'generic') return tiles;
    const order = ORDER[layout];
    return [...tiles].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  }, [doc, i18n]);
  const layout = layoutOf(doc.sections.filter((section) => section.name !== ''));
  return (
    <div class={`cg-rx-board is-${layout}`}>
      {specs.map((spec, index) => (
        <BoardTile key={`${String(spec.at)}:${spec.section.name}`} spec={spec} index={index} layout={layout} onOpen={onOpen} />
      ))}
    </div>
  );
}
