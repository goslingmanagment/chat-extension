// The Recap window (2026-10-28). Of three ways to show a Recap the owner picked «Досье во весь экран» («давай 1 щас и
// 2 позже как альтер вид»: the one-screen board comes later as a second view of this window). A big reader over the
// chat. On the left a rail: the fan, «Коротко | Полностью», the sections with a marker that follows the reading (keys
// 1–9, J and K), the card that asks for «Обновить» when the chat went on after the Recap, the facts. On the right the
// document. It grows out of the button it was opened from and folds into a cheat sheet over the bar («Свернуть»).
// With nothing saved it opens on the choice of the two (expanded is the default, the owner, 2026-10-27). A build keeps
// the previous Recap readable under its ribbon while the rail lights up section by section; a first build shows the
// sections as they are written. «Обновить» is a paid run: a deliberate click, or ⌘⇧S in the open window.

import { type JSX } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import { type UiTextKey } from '@cg/contracts/i18n/keys';
import {
  RECAP_FULL_SECTIONS,
  RECAP_SHORT_SECTIONS,
  type ActionButtonVM,
  type PhaseVM,
  type RecapDocVM,
  type RecapLength,
  type RecapPickerVM,
  type RecapSectionKey,
  type RecapViewVM,
  type RecapWrittenVM,
} from '@cg/contracts/vm';

import {
  Button,
  Dot,
  ElapsedTimer,
  Icon,
  Markdown,
  Spinner,
  ViewState,
  activeIn,
  anchorRect,
  focusQuietly,
  hotkeyText,
  isComposing,
  isHeldKey,
  useDispatch,
  useI18n,
  useKit,
  useNowFn,
  useTooltip,
  useView,
  useWindowExit,
  windowOf,
  type WindowExit,
} from '../../kit';
import { CancelButton } from '../Head';
import { StaleRow } from '../Result';
import { useSteadyView } from '../Stream';
import { EASE_OUT, LAND_MS, SPRING_FOLD, SPRING_OPEN, inOutCurve, lessMotion, morphFrames, playCurve, settle, springEasing } from './motion';
import { SavedFact, checkingWithBuild, coverageLine, usePickerFocus, usedBy } from './recap-facts';
import { RecapBoard } from './RecapBoard';
import { RecapSections, Tile } from './RecapDoc';
import { CopyAll, MadeAgo, RefreshFailedFact, debugFooter, running, type ViewProps } from './shared';

const SECTION_NAME: Readonly<Record<RecapSectionKey, UiTextKey>> = {
  dossier: 'recap.section.dossier',
  portrait: 'recap.section.portrait',
  stage: 'recap.section.stage',
  communication: 'recap.section.communication',
  money: 'recap.section.money',
  openLoops: 'recap.section.openLoops',
  strategy: 'recap.section.strategy',
  who: 'recap.section.who',
  spend: 'recap.section.spend',
  triggers: 'recap.section.triggers',
  boundaries: 'recap.section.boundaries',
  threads: 'recap.section.threads',
  nextMove: 'recap.section.nextMove',
};
const FORMAT: Readonly<Record<RecapLength, readonly RecapSectionKey[]>> = { full: RECAP_FULL_SECTIONS, short: RECAP_SHORT_SECTIONS };
/** What a full build takes, said by the ribbon's timer («0:42 из ~1:30»; the picker says «около полутора минут»). */
const FULL_BUILD_S = 90;
const ENTER_KEY = { display: '↵', aria: 'Enter', delivery: 'delivered' as const, fallback: null };

const capitalize = (text: string): string => text.replace(/^(\s*)(\p{Ll})/u, (_, space: string, letter: string) => space + letter.toUpperCase());
const FULL_BUILD_TIME = `${String(Math.floor(FULL_BUILD_S / 60))}:${String(FULL_BUILD_S % 60).padStart(2, '0')}`;

/** A row of the contents rail. */
interface Row {
  readonly key: RecapSectionKey | null;
  readonly name: string;
  /** The section of the shown document it jumps to; null — not written yet. */
  readonly at: number | null;
  /** While a build runs: written, being written, still to come; null — nothing runs. */
  readonly build: 'done' | 'writing' | 'wait' | null;
}

function docRows(doc: RecapDocVM | null): Row[] {
  if (doc === null) return [];
  return doc.sections.flatMap((section, at) => (section.name === '' ? [] : [{ key: section.key, name: section.name, at, build: null }]));
}

/** The rows of a Recap being rebuilt light up as the new one's sections are written (the hub writes them in order). */
function litRows(rows: readonly Row[], written: RecapWrittenVM | null): Row[] {
  const done = written?.done ?? [];
  const keys = new Set(done.flatMap((section) => (section.key === null ? [] : [section.key])));
  return rows.map((row, index) => {
    if (row.key !== null) return { ...row, build: keys.has(row.key) ? 'done' : written?.writing?.key === row.key ? 'writing' : 'wait' };
    return { ...row, build: index < done.length ? 'done' : index === done.length && written?.writing !== null && written !== null ? 'writing' : 'wait' };
  });
}

/** What a first build has written so far, as a document. */
function writtenDoc(written: RecapWrittenVM | null): RecapDocVM {
  const sections = written?.done ?? [];
  const labelled = sections.length > 0 && sections.filter((section) => section.parts.some((part) => part.label !== null)).length >= sections.length / 2;
  return { sections, labelled };
}

/** «Досье» or «Сводка»: the view the person chose last, while the tab lives (the board is the second view, 2026-10-28). */
type View = 'dossier' | 'board';
let chosenView: View = 'dossier';

export function RecapWindow({ debugPart }: Pick<ViewProps, 'debugPart'>): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const { root, deps } = useKit();
  const raw = useView({ of: 'recap.view' });
  const recap = useSteadyView(raw).value;
  const picker = useView({ of: 'recap.picker' }).value;

  const rootRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tocRef = useRef<HTMLElement>(null);
  const markerRef = useRef<HTMLSpanElement>(null);

  const building = running(recap.state);
  const kept = building ? (recap.kept ?? null) : null;
  const written = building ? (recap.written ?? null) : null;
  const checking = checkingWithBuild(picker);
  const failedView = recap.view.s === 'error' || recap.view.s === 'forbidden' || recap.view.s === 'offline' || (recap.view.s === 'loading' && !building && !checking);
  const markdown = building ? (kept?.markdown ?? null) : recap.markdown;
  const mode: 'doc' | 'first' | 'empty' | 'state' = markdown !== null ? 'doc' : building ? 'first' : failedView ? 'state' : 'empty';
  const doc: RecapDocVM | null = mode === 'first' ? writtenDoc(written) : mode !== 'doc' ? null : building ? (kept?.doc ?? null) : (recap.doc ?? null);
  // The board needs the Recap's sections: a first build, the choice of the two and a text without sections read as «Досье».
  const [view, setView] = useState<View>(chosenView);
  const boardable = mode === 'doc' && doc !== null;
  const showing: View = boardable ? view : 'dossier';
  const onBoard = showing === 'board';
  const madeAt = building ? (kept?.generatedAt ?? null) : recap.generatedAt;
  const name = recap.targetName ?? picker.targetName;
  const handle = recap.targetHandle ?? null;

  // ── the rail's rows ──
  const [preview, setPreview] = useState<RecapLength | null>(null);
  const format = (length: RecapLength): Row[] => FORMAT[length].map((key) => ({ key, name: i18n.t(SECTION_NAME[key]), at: null, build: null }));
  let rows: Row[];
  if (mode === 'doc') rows = building ? litRows(docRows(doc), written) : docRows(doc);
  else if (mode === 'first') {
    const sections = written?.done ?? [];
    // The hub's own sections: all of them, lit as they come; a text in another format: what came so far.
    const unknown = sections.some((section) => section.key === null) || (written !== null && written.writing !== null && written.writing.key === null);
    if (!unknown || written === null) {
      rows = litRows(format(recap.length), written).map((row) => {
        const at = sections.findIndex((section) => section.key === row.key);
        return { ...row, at: at === -1 ? null : at };
      });
    } else {
      rows = sections.map((section, at): Row => ({ key: section.key, name: section.name, at, build: 'done' }));
      if (written.writing !== null) rows.push({ key: written.writing.key, name: written.writing.name, at: null, build: 'writing' });
    }
  } else if (mode === 'empty') rows = format(preview ?? recap.length);
  else rows = [];
  const ghost = mode === 'empty';
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // ── wayfinding: the marker, the running head, the scrollspy ──
  const [active, setActive] = useState(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [scrolled, setScrolled] = useState(false);
  const [runOn, setRunOn] = useState(false);
  const lock = useRef<number | null>(null);
  const glide = useRef(0);
  const frame = useRef(0);

  const headTops = (): number[] => {
    const scroller = scrollRef.current;
    if (scroller === null) return [];
    const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
    return rowsRef.current.map((row) => {
      if (row.at === null) return Number.POSITIVE_INFINITY;
      const head = scroller.querySelector(`[data-cg-sec="${String(row.at)}"] > .cg-rx-h`) ?? scroller.querySelector(`[data-cg-sec="${String(row.at)}"]`);
      return head === null ? Number.POSITIVE_INFINITY : head.getBoundingClientRect().top - origin;
    });
  };

  const spy = (): void => {
    const scroller = scrollRef.current;
    if (scroller === null) return;
    const y = scroller.scrollTop;
    setScrolled(y > 4);
    const tops = headTops();
    if (lock.current === null) {
      const threshold = y + scroller.clientHeight * 0.3;
      let next = 0;
      // At the very top the first section is the one read, however short it is.
      if (y > 8) {
        tops.forEach((top, index) => {
          if (top <= threshold) next = index;
        });
      }
      if (next !== activeRef.current) setActive(next);
    }
    const current = tops[lock.current ?? activeRef.current] ?? Number.POSITIVE_INFINITY;
    setRunOn(y > current + 6);
  };
  const onScroll = (): void => {
    const view = windowOf(root);
    if (view === null || frame.current !== 0) return;
    frame.current = view.requestAnimationFrame(() => {
      frame.current = 0;
      spy();
    });
  };

  const stopGlide = (): void => {
    if (glide.current !== 0) windowOf(root)?.cancelAnimationFrame(glide.current);
    glide.current = 0;
  };
  const glideTo = (to: number): Promise<void> => {
    const scroller = scrollRef.current;
    const view = windowOf(root);
    stopGlide();
    if (scroller === null) return Promise.resolve();
    const from = scroller.scrollTop;
    const distance = to - from;
    if (view === null || lessMotion(view) || Math.abs(distance) < 2) {
      scroller.scrollTop = to;
      return Promise.resolve();
    }
    const run = (start: number, ms: number): Promise<void> =>
      new Promise((resolve) => {
        let t0: number | null = null;
        const tick = (now: number): void => {
          t0 ??= now;
          const k = Math.min(1, (now - t0) / ms);
          scroller.scrollTop = start + (to - start) * (1 - Math.pow(1 - k, 4));
          if (k < 1) glide.current = view.requestAnimationFrame(tick);
          else {
            glide.current = 0;
            resolve();
          }
        };
        glide.current = view.requestAnimationFrame(tick);
      });
    const article = scroller.firstElementChild;
    if (Math.abs(distance) > scroller.clientHeight * 1.5 && article !== null) {
      // A long jump: the page dips, lands just short of the heading and glides the last stretch.
      const out = article.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 110, easing: 'ease-in', fill: 'forwards' });
      return settle(out, 110).then(() => {
        scroller.scrollTop = to - Math.sign(distance) * 150;
        article.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
        out.cancel();
        return run(scroller.scrollTop, 380);
      });
    }
    return run(from, Math.min(540, Math.max(300, 260 + Math.abs(distance) * 0.22)));
  };
  const flash = (at: number): void => {
    const head = scrollRef.current?.querySelector<HTMLElement>(`[data-cg-sec="${String(at)}"] > .cg-rx-h`);
    if (head === null || head === undefined || lessMotion(windowOf(root))) return;
    head.classList.remove('is-flash');
    void head.offsetWidth;
    head.classList.add('is-flash');
    windowOf(root)?.setTimeout(() => head.classList.remove('is-flash'), 1500);
  };
  const jump = (index: number, instant = false): void => {
    const row = rowsRef.current[index];
    const scroller = scrollRef.current;
    if (row === undefined || row.at === null || scroller === null) return;
    const top = headTops()[index] ?? 0;
    const to = Math.max(0, Math.min(top - 22, scroller.scrollHeight - scroller.clientHeight));
    const at = row.at;
    lock.current = index;
    setActive(index);
    if (instant) {
      stopGlide();
      scroller.scrollTop = to;
    }
    void (instant ? Promise.resolve() : glideTo(to)).then(() => {
      flash(at);
      windowOf(root)?.setTimeout(() => {
        if (lock.current === index) lock.current = null;
        spy();
      }, 120);
    });
  };
  /** J and K: the next section; K first goes back to the start of the one being read. */
  const step = (direction: 1 | -1): void => {
    const scroller = scrollRef.current;
    const list = rowsRef.current;
    if (scroller === null || list.length === 0) return;
    const current = activeRef.current;
    if (direction < 0 && scroller.scrollTop > (headTops()[current] ?? 0) - 10) return jump(current);
    for (let index = current + direction; index >= 0 && index < list.length; index += direction) {
      if (list[index]?.at !== null) return jump(index);
    }
  };

  // «Сводка» ↔ «Досье»: a tile (or a row of the rail) opens its section in «Досье», at its heading.
  const opening = useRef<number | null>(null);
  const choose = (next: View): void => {
    chosenView = next;
    if (next === showing) return;
    opening.current = null;
    setView(next);
  };
  const openSection = (at: number | null): void => {
    const index = rowsRef.current.findIndex((row) => row.at === at);
    if (index < 0) return;
    opening.current = index;
    setView('dossier');
  };
  const shownView = useRef(showing);
  useLayoutEffect(() => {
    if (shownView.current === showing) return;
    shownView.current = showing;
    const scroller = scrollRef.current;
    if (scroller === null) return;
    stopGlide();
    lock.current = null;
    scroller.scrollTop = 0;
    const index = opening.current;
    opening.current = null;
    if (index !== null) jump(index, true);
    else spy();
    if (!lessMotion(windowOf(root))) scroller.firstElementChild?.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: EASE_OUT });
  }, [showing]);

  // The marker sits on the active row; the first placing does not glide.
  const placed = useRef(false);
  useLayoutEffect(() => {
    const toc = tocRef.current;
    const marker = markerRef.current;
    if (toc === null || marker === null) return;
    const item = toc.querySelectorAll<HTMLElement>('.cg-rx-toc__item')[active];
    if (item === undefined || ghost || mode === 'state' || onBoard) {
      marker.style.opacity = '0';
      return;
    }
    if (!placed.current) marker.style.transition = 'none';
    marker.style.opacity = '';
    marker.style.transform = `translateY(${String(item.offsetTop)}px)`;
    marker.style.height = `${String(Math.max(38, item.offsetHeight))}px`;
    if (!placed.current) {
      void marker.offsetWidth;
      marker.style.transition = '';
      placed.current = true;
    }
  });

  // The last heading can reach the top: the tail under the end of the Recap.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const tail = scroller?.querySelector<HTMLElement>('.cg-rx-tail');
    const last = scroller?.querySelector<HTMLElement>('.cg-rx-sec:last-of-type');
    const end = scroller?.querySelector<HTMLElement>('.cg-rx-end');
    if (scroller === null || scroller === undefined || tail === null || tail === undefined || last === null || last === undefined) return;
    const height = scroller.clientHeight - last.offsetHeight - (end?.offsetHeight ?? 0) - 80;
    tail.style.height = `${String(Math.round(Math.min(scroller.clientHeight * 0.55, Math.max(40, height))))}px`;
  }, [doc, mode, recap.length]);

  // ── «Коротко | Полностью»: each length keeps where it was read; the document cross-fades, the rows roll over ──
  const scrollMemo = useRef<Record<RecapLength, number>>({ short: 0, full: 0 });
  const shownLength = useRef(recap.length);
  useLayoutEffect(() => {
    if (shownLength.current === recap.length) return;
    shownLength.current = recap.length;
    const scroller = scrollRef.current;
    if (scroller === null) return;
    stopGlide();
    lock.current = null;
    scroller.scrollTop = scrollMemo.current[recap.length];
    spy();
    if (lessMotion(windowOf(root))) return;
    scroller.firstElementChild?.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: 60, easing: EASE_OUT, fill: 'backwards' });
    tocRef.current?.querySelectorAll('.cg-rx-toc__in').forEach((row, index) => {
      row.animate([{ opacity: 0, transform: 'translateY(9px)' }, { opacity: 1, transform: 'none' }], { duration: 280, delay: 40 + index * 26, easing: EASE_OUT, fill: 'backwards' });
    });
  }, [recap.length]);
  const switchTo = (length: RecapLength): void => {
    if (length === recap.length) return;
    const scroller = scrollRef.current;
    if (scroller !== null) scrollMemo.current[recap.length] = scroller.scrollTop;
    void dispatch({ type: 'ShowRecap', length });
  };

  // ── leaving: the content fades, the paper folds into the bar or shrinks into the button, then the window goes ──
  const leaving = useRef(false);
  const leave = (how: WindowExit): void => {
    if (leaving.current) return;
    leaving.current = true;
    const finish = (): void => {
      void dispatch({ type: 'ShowAnalysis', view: 'recap', mode: how });
      if (how === 'hidden') deps.focus.restore();
    };
    void exitMotion(how).then(finish, finish);
  };
  useWindowExit(leave);
  async function exitMotion(how: WindowExit): Promise<void> {
    const paper = paperRef.current;
    const box = rootRef.current;
    const view = windowOf(root);
    if (paper === null || box === null || view === null || lessMotion(view)) return;
    box.style.pointerEvents = 'none';
    stopGlide();
    const fade = { duration: 120, easing: 'ease-in', fill: 'forwards' } as const;
    box.querySelectorAll(':scope > .cg-rx-rail, :scope > .cg-rx-doc').forEach((part) => part.animate([{ opacity: 1 }, { opacity: 0 }], fade));
    paper.querySelector('.cg-rx-paper__rail')?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, delay: 60, easing: 'ease-in', fill: 'forwards' });
    root.querySelector('.cg-rx-scrim')?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 280, easing: 'ease-in', fill: 'forwards' });
    const base = paper.getBoundingClientRect();
    const bar = how === 'sheet' ? anchorRect('dock-bar') : null;
    const height = bar === null ? 0 : Math.min(176, Math.max(96, bar.top - 24));
    const target = how === 'sheet' ? (bar === null ? null : { left: bar.left, top: bar.top - 2 - height, width: bar.width, height }) : anchorRect('recap');
    if (target === null) {
      await settle(paper.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.985)' }], { duration: 180, easing: 'ease-in', fill: 'forwards' }), 180);
      return;
    }
    const curve = how === 'sheet' ? SPRING_FOLD.points : inOutCurve(24);
    const ms = Math.round(((curve.length - 1) * 1000) / 60);
    if (how === 'hidden') {
      // Into the button: the paper takes the button's colour and dissolves as it lands, so its label shows through.
      paper.querySelector('.cg-rx-paper__tint')?.animate([{ opacity: 0, offset: 0 }, { opacity: 0, offset: 0.45 }, { opacity: 1, offset: 1 }], { duration: ms, fill: 'forwards' });
      paper.animate([{ opacity: 1, offset: 0 }, { opacity: 1, offset: 0.62 }, { opacity: 0, offset: 1 }], { duration: ms + 40, fill: 'forwards' });
    }
    await settle(playCurve(paper, morphFrames(base, base, target, curve, 16, how === 'sheet' ? 12 : 8), curve, 40), ms + 40);
  }

  // ── opening: the paper grows out of the button (or the cheat sheet), the rail and the first lines settle after it ──
  const [ping, setPing] = useState(false);
  useLayoutEffect(() => {
    const box = rootRef.current;
    const paper = paperRef.current;
    const view = windowOf(root);
    // The focus opens on the document, so the arrows, Space, J and K read it; the choice of the two takes it itself.
    const at = activeIn(root);
    if (at === null || at === box?.closest('.cg-dialog')) focusQuietly(scrollRef.current);
    const pinging = view?.setTimeout(() => setPing(true), 900);
    if (box === null || paper === null || view === null) return undefined;
    const clear = (): void => {
      if (pinging !== undefined) view.clearTimeout(pinging);
    };
    if (lessMotion(view)) {
      box.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
      return clear;
    }
    root.querySelector('.cg-rx-scrim')?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 340, easing: 'ease-out' });
    const crib = anchorRect('recap-crib');
    const from = crib ?? anchorRect('recap');
    const base = paper.getBoundingClientRect();
    if (from === null || base.width === 0) {
      box.animate([{ opacity: 0, transform: 'translateY(10px) scale(0.99)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: EASE_OUT });
      return clear;
    }
    playCurve(paper, morphFrames(base, from, base, SPRING_OPEN.points, crib === null ? 8 : 12, 16), SPRING_OPEN.points);
    paper.querySelector('.cg-rx-paper__tint')?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: 'ease-out', fill: 'both' });
    paper.querySelector('.cg-rx-paper__rail')?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 60, easing: 'ease-out', fill: 'backwards' });
    box.querySelectorAll('.cg-rx-id, .cg-rx-seg, .cg-rx-cap, .cg-rx-toc__item, .cg-rx-freshwrap, .cg-rx-facts, .cg-rx-keys').forEach((part, index) => {
      part.animate([{ opacity: 0, transform: 'translateX(-10px)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: LAND_MS + 40 + index * 24, easing: EASE_OUT, fill: 'backwards' });
    });
    markerRef.current?.animate([{ opacity: 0, transform: `${markerRef.current.style.transform} scale(0.9, 0.8)` }, { opacity: 1 }], { duration: 420, delay: LAND_MS + 300, easing: EASE_OUT, fill: 'backwards' });
    box.querySelector('.cg-rx-top')?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: LAND_MS + 180, easing: 'ease-out', fill: 'backwards' });
    box.querySelector('.cg-rx-rib.is-on')?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: LAND_MS + 160, fill: 'backwards' });
    const seen = (scrollRef.current?.getBoundingClientRect().bottom ?? 0) + 40;
    Array.from(box.querySelectorAll('.cg-rx-sec > .cg-rx-h, .cg-rx-sec > .cg-rx-grid, .cg-rx-sec > .cg-rx-flow, .cg-rx-empty > *, .cg-rx-pick > *, .cg-rx-md, .cg-rx-state'))
      .filter((part) => part.getBoundingClientRect().top < seen)
      .slice(0, 6)
      .forEach((part, index) => {
        part.animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: LAND_MS + 120 + index * 70, easing: EASE_OUT, fill: 'backwards' });
      });
    return clear;
    // Once, as the window opens.
  }, []);
  useEffect(
    () => () => {
      stopGlide();
      if (frame.current !== 0) windowOf(root)?.cancelAnimationFrame(frame.current);
    },
    [],
  );

  // A first build: the rail follows the sections as they come, the document stays where the person reads.
  useEffect(() => {
    spy();
  }, [doc, mode]);

  // ── the build's ribbon: running, then «Готово» or «Сборка отменена» for a moment ──
  const [note, setNote] = useState<{ readonly kind: 'done' | 'off'; readonly title: string; readonly line: string } | null>(null);
  const was = useRef({ building, keptAt: kept?.generatedAt ?? null, length: recap.length });
  useEffect(() => {
    const before = was.current;
    was.current = { building, keptAt: building ? (kept?.generatedAt ?? null) : before.keptAt, length: recap.length };
    if (!before.building || building || before.length !== recap.length) return;
    if (recap.markdown !== null && recap.generatedAt !== null && recap.generatedAt !== before.keptAt) {
      setNote({ kind: 'done', title: i18n.t(before.keptAt === null ? 'recap.win.ready' : 'recap.win.refreshed'), line: '' });
    } else if (recap.refreshFailed === null && !failedView) {
      setNote({ kind: 'off', title: i18n.t('recap.win.canceled'), line: i18n.t(before.keptAt === null ? 'recap.win.canceledNone' : 'recap.win.canceledKept') });
    }
  });
  useEffect(() => {
    if (note === null) return undefined;
    const id = windowOf(root)?.setTimeout(() => setNote(null), note.kind === 'done' ? 2600 : 1800);
    return () => {
      if (id !== undefined) windowOf(root)?.clearTimeout(id);
    };
  }, [note, root]);

  const spring = useMemo(() => springEasing((property, value) => (windowOf(root) as (Window & typeof globalThis) | null)?.CSS.supports(property, value) === true), [root]);
  const esc = hotkeyText(deps.catalog.entry('close').hotkey)?.display ?? i18n.t('common.key.esc');
  const activeRow = rows[active] ?? null;
  const lag = !building && markdown !== null ? recap.archiveLag : null;
  const cancel = recap.phase?.cancel ?? (recap.opId === null || !building ? null : { type: 'CancelGeneration' as const, operationId: recap.opId });

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || isComposing(event)) return;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.code === 'Period' && cancel !== null && building) {
      event.preventDefault();
      event.stopPropagation();
      void dispatch(cancel);
      return;
    }
    if (mod || event.altKey || ghost || rowsRef.current.length === 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, textarea, [contenteditable="true"], [role="radiogroup"]') !== null && target !== null) return;
    const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
    if (digit !== undefined) {
      const index = Number(digit) - 1;
      if (rowsRef.current[index]?.at === null || rowsRef.current[index] === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      if (onBoard) openSection(rowsRef.current[index]?.at ?? null);
      else jump(index);
      return;
    }
    if (onBoard) return;
    if (event.code === 'KeyJ' || event.code === 'KeyK') {
      event.preventDefault();
      event.stopPropagation();
      step(event.code === 'KeyJ' ? 1 : -1);
    }
  };

  return (
    <div
      ref={rootRef}
      class={`cg-rx${building ? ' is-building' : ''}`}
      data-cg-len={recap.length}
      data-cg-mode={mode}
      style={`--cg-rx-spring: ${spring.easing}; --cg-rx-spring-ms: ${String(spring.ms)}ms`}
      onKeyDown={onKeyDown}
    >
      <div ref={paperRef} class="cg-rx-paper" aria-hidden="true">
        <div class="cg-rx-paper__rail" />
        <div class="cg-rx-paper__tint" />
      </div>

      <aside class="cg-rx-rail">
        <header class="cg-rx-id">
          <div class="cg-rx-kick">
            <Icon name="book" size={14} />
            {i18n.t('dock.action.recap')}
          </div>
          <h2 class="cg-rx-fan">{name ?? i18n.t('dock.action.recap')}</h2>
          {handle === null ? null : (
            <div class="cg-rx-handle" title={`@${handle}`}>
              @{handle}
            </div>
          )}
        </header>
        {recap.lengths.short || recap.lengths.full || markdown !== null ? <Lengths recap={recap} onPick={switchTo} /> : null}
        {ghost ? <div class="cg-rx-cap">{i18n.t('recap.win.ghost')}</div> : mode === 'first' ? <div class="cg-rx-cap">{i18n.t('recap.win.arriving')}</div> : null}
        {rows.length === 0 ? null : (
          <nav ref={tocRef} class={`cg-rx-toc${ghost ? ' is-ghost' : ''}${building ? ' is-building' : ''}`} aria-label={i18n.t('recap.win.sections')}>
            <span ref={markerRef} class="cg-rx-toc__marker" />
            {rows.map((row, index) => (
              <button
                key={`${recap.length}:${row.key ?? row.name}`}
                type="button"
                class={`cg-rx-toc__item${index === active && !ghost && !onBoard ? ' is-on' : ''}${row.build === null ? '' : ` is-${row.build}`}`}
                disabled={ghost || row.at === null}
                {...(index === active && !ghost && !onBoard ? { 'aria-current': 'true' as const } : {})}
                onClick={() => (onBoard ? openSection(row.at) : jump(index))}
              >
                <span class="cg-rx-toc__in">
                  <Tile section={row.key} size={14} />
                  <span class="cg-rx-toc__n">{row.name}</span>
                  {index < 9 && !ghost && !building ? <kbd class="cg-rx-toc__k">{index + 1}</kbd> : <span />}
                </span>
                <span class="cg-rx-toc__st" aria-hidden="true">
                  {row.build === 'done' ? <Icon name="check" size={14} /> : null}
                </span>
              </button>
            ))}
          </nav>
        )}
        <div class="cg-rx-rail__sp" />
        {lag === null ? null : <Fresh recap={recap} lag={lag} ping={ping} />}
        <RailFacts recap={recap} madeAt={madeAt} building={building} quiet={lag === null && !building && markdown !== null} />
        {mode === 'doc' && rows.length > 0 ? (
          <div class="cg-rx-keys">
            <span>
              <kbd class="cg-rx-kbd">J</kbd>
              <kbd class="cg-rx-kbd">K</kbd>
              {i18n.t('recap.win.keysSections')}
            </span>
            <span>
              <kbd class="cg-rx-kbd">{esc}</kbd>
              {i18n.t('recap.win.keysClose')}
            </span>
          </div>
        ) : null}
      </aside>

      <div class="cg-rx-doc">
        <div class={`cg-rx-top${scrolled ? ' is-scrolled' : ''}`}>
          {boardable ? (
            <div class="cg-rx-views" role="radiogroup" aria-label={i18n.t('recap.view.label')}>
              {(['dossier', 'board'] as const).map((option) => (
                <button key={option} type="button" role="radio" class="cg-rx-views__b" aria-checked={showing === option ? 'true' : 'false'} onClick={() => choose(option)}>
                  <Icon name={option === 'board' ? 'board' : 'lines'} size={14} />
                  {i18n.t(option === 'board' ? 'recap.view.board' : 'recap.view.dossier')}
                </button>
              ))}
            </div>
          ) : null}
          <div class={`cg-rx-run${runOn && activeRow !== null && mode === 'doc' && !onBoard ? ' is-on' : ''}`} aria-hidden="true">
            {activeRow === null ? null : (
              <>
                <Tile section={activeRow.key} size={13} />
                <span>{activeRow.name}</span>
              </>
            )}
          </div>
          <div class="cg-rx-tools">
            {building ? null : <CopyAll handle={recap.copyHandle} label={i18n.t('recap.copy')} />}
            {markdown === null ? null : <Button label={i18n.t('result.collapse')} icon="collapse" variant="quiet" class="cg-rx-fold" tooltip={i18n.t('recap.win.foldTooltip')} onClick={() => leave('sheet')} />}
            {markdown === null ? null : <span class="cg-rx-tools__sep" />}
            <Button label={i18n.t('common.hide')} icon="x" iconOnly variant="quiet" class="cg-rx-close" tooltip={`${i18n.t('result.hideTooltip')}  ${esc}`} onClick={() => leave('hidden')} />
          </div>
        </div>
        <Ribbon recap={recap} building={building} kept={kept !== null} madeAt={madeAt} written={written} note={note} cancel={building ? cancel : null} />
        <div class="cg-rx-pages">
          <div
            ref={scrollRef}
            class={`cg-rx-scroll${mode === 'empty' || mode === 'state' ? ' is-empty' : ''}`}
            tabIndex={0}
            aria-label={i18n.t('dock.action.recap')}
            onScroll={onScroll}
            onWheel={() => {
              stopGlide();
              lock.current = null;
            }}
          >
            {onBoard && doc !== null ? (
              <RecapBoard doc={doc} onOpen={openSection} />
            ) : mode === 'empty' ? (
              <Choice recap={recap} picker={picker} onPreview={setPreview} />
            ) : mode === 'state' ? (
              <div class="cg-rx-state">
                <ViewState view={recap.view} />
              </div>
            ) : (
              <article class={`cg-rx-article${doc?.labelled === true ? ' is-grid' : ''}${mode === 'first' ? ' is-stream' : ''}`}>
                {recap.stale === undefined || recap.stale === null || building ? null : (
                  <StaleRow
                    mark={recap.stale}
                    onAgain={() => void dispatch(recap.refresh.action)}
                    reason={recap.refresh.enabled ? null : recap.refresh.reason === null ? i18n.t('common.unknown') : i18n.text(recap.refresh.reason.text)}
                  />
                )}
                {doc !== null ? (
                  <RecapSections doc={doc} writing={mode === 'first' ? (written?.writing ?? null) : null} />
                ) : markdown === null ? null : (
                  <div class="cg-rx-md">
                    <Markdown source={markdown} decorate />
                  </div>
                )}
                {mode === 'first' && (written === null || (written.done.length === 0 && written.writing === null)) ? (
                  <div class="cg-rx-skel is-wait" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </div>
                ) : null}
                {mode === 'doc' ? (
                  <>
                    <footer class="cg-rx-end">
                      <span>{i18n.t('recap.win.end')}</span>
                      <span class="cg-rx-end__sp" />
                      {rows.length === 0 ? null : <Button label={i18n.t('recap.win.top')} icon="arrowUp" variant="quiet" size="sm" class="cg-rx-up" onClick={() => jump(0)} />}
                    </footer>
                    <div class="cg-rx-tail" />
                  </>
                ) : null}
                {debugFooter(debugPart, recap.debug, recap.state, recap.phase)}
              </article>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** «Коротко | Полностью»: a switch whose thumb slides; a length with nothing saved shows what it holds and its build. */
function Lengths({ recap, onPick }: { readonly recap: RecapViewVM; readonly onPick: (length: RecapLength) => void }): JSX.Element {
  const i18n = useI18n();
  return (
    <div class="cg-rx-seg" role="radiogroup" aria-label={i18n.t('recap.lengthLabel')} data-cg-len={recap.length}>
      <span class="cg-rx-seg__thumb" />
      <LengthButton length="short" recap={recap} onPick={onPick} />
      <LengthButton length="full" recap={recap} onPick={onPick} />
    </div>
  );
}

function LengthButton({ length, recap, onPick }: { readonly length: RecapLength; readonly recap: RecapViewVM; readonly onPick: (length: RecapLength) => void }): JSX.Element {
  const i18n = useI18n();
  const reason = recap.lengths[length] ? null : i18n.t('cg.recapNotFound.title');
  const tip = useTooltip(reason);
  const on = recap.length === length;
  return (
    <>
      <button
        type="button"
        role="radio"
        class="cg-rx-seg__b"
        aria-checked={on ? 'true' : 'false'}
        tabIndex={on ? 0 : -1}
        {...tip.props}
        {...(reason === null ? {} : { 'aria-disabled': 'true' })}
        onClick={() => {
          if (reason === null) onPick(length);
        }}
        onKeyDown={(event) => {
          tip.props.onKeyDown(event);
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const next: RecapLength = event.key === 'ArrowLeft' ? 'short' : 'full';
          if (recap.lengths[next]) onPick(next);
          (event.currentTarget.parentElement?.querySelector<HTMLElement>(`.cg-rx-seg__b:nth-of-type(${next === 'short' ? 1 : 2})`) ?? null)?.focus();
        }}
      >
        {i18n.t(length === 'short' ? 'recap.short' : 'recap.full')}
      </button>
      {tip.description}
    </>
  );
}

/** The card that asks for attention: the chat went on after the Recap. «Обновить» right in it (a paid run). */
function Fresh({ recap, lag, ping }: { readonly recap: RecapViewVM; readonly lag: NonNullable<RecapViewVM['archiveLag']>; readonly ping: boolean }): JSX.Element {
  const i18n = useI18n();
  return (
    <div class="cg-rx-freshwrap">
      <div class={`cg-rx-fresh${ping ? ' is-ping' : ''}`}>
        <div class="cg-rx-fresh__t">
          <Dot kind="accent" use="archive-lag" />
          <span>{lag.messages === null ? i18n.t('recap.newAfterSome') : i18n.plural('recap.newAfter', lag.messages)}</span>
        </div>
        <p class="cg-rx-fresh__s">{i18n.t('recap.win.freshNote')}</p>
        {recap.refreshFailed === null ? (
          <div class="cg-rx-fresh__row">
            <Refresh vm={recap.refresh} soft />
            {recap.length === 'full' ? <span class="cg-rx-fresh__eta">{i18n.t('recap.win.freshEta')}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Refresh({ vm, soft }: { readonly vm: ActionButtonVM; readonly soft: boolean }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const keys = hotkeyText(vm.hotkey);
  return (
    <Button
      label={i18n.text(vm.label)}
      icon="refresh"
      size="sm"
      class={soft ? 'cg-refresh cg-rx-btn cg-rx-btn--soft' : 'cg-refresh cg-rx-link'}
      tooltip={i18n.t('recap.refreshTooltip', { hotkey: keys?.display ?? '' }).trim()}
      reason={vm.enabled ? null : vm.reason === null ? i18n.t('common.unknown') : i18n.text(vm.reason.text)}
      onClick={() => void dispatch(vm.action)}
    />
  );
}

/** When it was made, what it read, who uses it; a save that failed; a build that failed over it; a quiet «Обновить». */
function RailFacts({ recap, madeAt, building, quiet }: { readonly recap: RecapViewVM; readonly madeAt: string | null; readonly building: boolean; readonly quiet: boolean }): JSX.Element | null {
  const i18n = useI18n();
  const covers = building ? null : coverageLine(i18n, recap.stamp);
  const used = !building && recap.generatedAt !== null && recap.saved.s !== 'failed' ? capitalize(usedBy(i18n, recap)) : null;
  if (madeAt === null && covers === null && used === null && recap.saved.s !== 'failed' && recap.saved.s !== 'saving' && recap.refreshFailed === null) return null;
  return (
    <div class="cg-rx-facts">
      {madeAt === null ? null : (
        <div class="cg-rx-fact">
          <Icon name="clock" size={14} />
          <span>
            <MadeAgo at={madeAt} />
          </span>
        </div>
      )}
      {covers === null ? null : (
        <div class="cg-rx-fact">
          <Icon name="bubble" size={14} />
          <span>{capitalize(covers)}</span>
        </div>
      )}
      {used === null ? null : (
        <div class="cg-rx-fact">
          <Icon name="layers" size={14} />
          <span>{used}</span>
        </div>
      )}
      <SavedFact saved={recap.saved} />
      <RefreshFailedFact failed={recap.refreshFailed} />
      {quiet && recap.refreshFailed === null ? <Refresh vm={recap.refresh} soft={false} /> : null}
    </div>
  );
}

/** The build's ribbon over the document: what is built, for how long, «Отменить ⌘.», the stages; then «Готово». */
function Ribbon({
  recap,
  building,
  kept,
  madeAt,
  written,
  note,
  cancel,
}: {
  readonly recap: RecapViewVM;
  readonly building: boolean;
  readonly kept: boolean;
  readonly madeAt: string | null;
  readonly written: RecapWrittenVM | null;
  readonly note: { readonly kind: 'done' | 'off'; readonly title: string; readonly line: string } | null;
  readonly cancel: RecapViewVM['refresh']['action'] | null;
}): JSX.Element {
  const i18n = useI18n();
  const phase = recap.phase;
  const on = (building && phase !== null) || note !== null;
  const short = recap.length === 'short';
  let body: JSX.Element | null = null;
  if (building && phase !== null) {
    const title = i18n.t(kept ? (short ? 'recap.win.rebuildingShort' : 'recap.win.rebuilding') : short ? 'recap.win.buildingShort' : 'recap.win.building');
    body = (
      <div class="cg-rx-rib__box">
        <div class="cg-rx-rib__row">
          <span class="cg-rx-spin" aria-hidden="true" />
          <span class="cg-rx-rib__title">{title}</span>
          <span class="cg-rx-rib__note">{kept && madeAt !== null ? <KeptNote at={madeAt} /> : i18n.t('recap.win.buildingNote')}</span>
          <span class="cg-rx-rib__time">
            <b>
              <ElapsedTimer since={phase.startedAt} />
            </b>
            {short ? null : ` ${i18n.t('recap.win.of', { time: FULL_BUILD_TIME })}`}
          </span>
          {cancel === null ? null : <CancelButton action={cancel} />}
        </div>
        <Stages phase={phase} written={written} />
        {short ? null : <Progress startedAt={phase.startedAt} />}
      </div>
    );
  } else if (note !== null) {
    body = (
      <div class={`cg-rx-rib__box is-${note.kind}`}>
        <div class="cg-rx-rib__row">
          {note.kind === 'done' ? (
            <span class="cg-rx-done" aria-hidden="true">
              <Icon name="check" size={12} />
            </span>
          ) : null}
          <span class="cg-rx-rib__title">{note.title}</span>
          {/* What the new one read, as its facts say it once they are in. */}
          <span class="cg-rx-rib__note">{note.kind === 'done' ? (coverageLine(i18n, recap.stamp) ?? i18n.t('recap.win.readyNote')) : note.line}</span>
        </div>
      </div>
    );
  }
  return (
    <div class={`cg-rx-rib${on ? ' is-on' : ''}`} aria-live="polite">
      <div class="cg-rx-rib__clip">{body}</div>
    </div>
  );
}

function KeptNote({ at }: { readonly at: string }): JSX.Element {
  const i18n = useI18n();
  const [before = '', after = ''] = i18n.t('recap.win.keptNote', { made: '\u0000' }).split('\u0000');
  return (
    <>
      {before}
      <MadeAgo at={at} lower />
      {after}
    </>
  );
}

/** The stages so far; the one that writes names the section it writes. */
function Stages({ phase, written }: { readonly phase: PhaseVM; readonly written: RecapWrittenVM | null }): JSX.Element {
  const i18n = useI18n();
  return (
    <div class="cg-rx-steps">
      {phase.stages.map((stage) => {
        const label = i18n.text(stage.label).replace(/\s*(…|\.\.\.)\s*$/, '');
        const now = stage.state === 'current';
        const text = now && stage.id === 'writing' && written?.writing !== null && written?.writing !== undefined ? i18n.t('recap.win.writing', { section: written.writing.name }) : label;
        return (
          <span key={stage.id} class={`cg-rx-step${now ? ' is-now' : ' is-done'}`} data-cg-stage={stage.id}>
            <i class="cg-rx-step__m">{now ? null : <Icon name="check" size={12} />}</i>
            {now ? `${text}…` : text}
          </span>
        );
      })}
    </div>
  );
}

/** The full build's time, as a line under the ribbon: up to 96 % of the usual minute and a half, never «done» by itself. */
function Progress({ startedAt }: { readonly startedAt: number }): JSX.Element {
  const now = useNowFn();
  const delay = useMemo(() => Math.max(0, (now() - startedAt) / 1000), [startedAt, now]);
  return <span key={startedAt} class="cg-rx-rib__bar" style={`animation-duration: ${String(FULL_BUILD_S)}s; animation-delay: -${delay.toFixed(2)}s`} />;
}

/** No Recap of this length yet: what each of the two reads, how long it takes, who uses it, and its build. */
function Choice({ recap, picker, onPreview }: { readonly recap: RecapViewVM; readonly picker: RecapPickerVM; readonly onPreview: (length: RecapLength | null) => void }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const checking = checkingWithBuild(picker);
  const primary = recap.length;
  const other: RecapLength = primary === 'full' ? 'short' : 'full';
  const otherSaved = picker.slots[other] !== null;
  const focus = usePickerFocus(true, checking);
  const cards: readonly RecapLength[] = otherSaved ? [primary] : ['full', 'short'];
  const title = i18n.t(!otherSaved ? 'recap.win.emptyTitle' : primary === 'full' ? 'recap.win.emptyFullTitle' : 'recap.win.emptyShortTitle');
  const lead = i18n.t(!otherSaved ? 'recap.win.emptyLead' : primary === 'full' ? 'recap.win.emptyFullLead' : 'recap.win.emptyShortLead');
  const build = picker.build[primary];
  return (
    <div class="cg-rx-empty">
      <h3 class="cg-rx-empty__h">{title}</h3>
      <p class="cg-rx-empty__lead">{lead}</p>
      {checking && picker.view.s === 'loading' ? (
        <p class="cg-rx-empty__note" role="status" aria-busy="true">
          <Spinner />
          {picker.view.stage === null ? i18n.t('common.loading') : i18n.text(picker.view.stage)}
        </p>
      ) : null}
      <div
        ref={focus.group}
        class={`cg-rx-pick${cards.length === 1 ? ' is-one' : ''}`}
        role="group"
        aria-label={title}
        tabIndex={0}
        onPointerLeave={() => onPreview(null)}
        onKeyDown={(event) => {
          // Enter builds the length shown (the full one unless «Коротко» was chosen, AI-060); a focused button answers itself.
          if (event.target !== event.currentTarget || event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || isComposing(event)) return;
          event.preventDefault();
          // A held Enter builds one Recap; while the saved ones are still read a build takes a click.
          if (build.enabled && !checking && !isHeldKey(event)) void dispatch(build.action);
        }}
      >
        {cards.map((length) => (
          <Card key={length} length={length} main={length === primary} vm={picker.build[length]} keyed={picker.build.full.hotkey ?? ENTER_KEY} checking={checking} buttonRef={length === primary ? focus.full : null} onPreview={onPreview} />
        ))}
      </div>
      <p class="cg-rx-empty__explain">{i18n.t('recap.picker.explain')}</p>
    </div>
  );
}

function Card({
  length,
  main,
  vm,
  keyed,
  checking,
  buttonRef,
  onPreview,
}: {
  readonly length: RecapLength;
  readonly main: boolean;
  readonly vm: ActionButtonVM;
  readonly keyed: NonNullable<ActionButtonVM['hotkey']> | typeof ENTER_KEY;
  readonly checking: boolean;
  readonly buttonRef: { current: HTMLButtonElement | null } | null;
  readonly onPreview: (length: RecapLength | null) => void;
}): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const full = length === 'full';
  return (
    <div class={`cg-rx-card${main ? ' is-main' : ''}`} data-cg-len={length} onPointerEnter={() => onPreview(length)} onFocusIn={() => onPreview(length)}>
      <div class="cg-rx-card__h">
        <span>{i18n.t(full ? 'recap.full' : 'recap.short')}</span>
        <span class="cg-rx-card__n">{i18n.plural('recap.win.sectionsCount', FORMAT[length].length)}</span>
      </div>
      <dl class="cg-rx-card__dl">
        <dt>{i18n.t('recap.win.reads')}</dt>
        <dd>{i18n.t(full ? 'recap.win.readsFull' : 'recap.win.readsShort')}</dd>
        <dt>{i18n.t('recap.win.takes')}</dt>
        <dd>{i18n.t(full ? 'recap.win.takesFull' : 'recap.win.takesShort')}</dd>
        <dt>{i18n.t(full ? 'recap.win.usedByMany' : 'recap.win.usedByOne')}</dt>
        <dd>{i18n.t(full ? 'recap.win.usedFull' : 'recap.win.usedShort')}</dd>
      </dl>
      <Button
        label={i18n.text(vm.label)}
        class={main ? 'cg-rx-btn cg-rx-btn--main cg-pick__first' : 'cg-rx-btn cg-rx-btn--ghost'}
        hotkey={main && vm.enabled && !checking ? keyed : null}
        {...(buttonRef === null ? {} : { buttonRef })}
        reason={vm.enabled ? null : vm.reason === null ? i18n.t('common.unknown') : i18n.text(vm.reason.text)}
        onClick={() => void dispatch(vm.action)}
      />
    </div>
  );
}
