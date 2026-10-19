// @cg/ui/dock/debug — the debug footer of an open result (ui-design §4.12;
// DB-011, DB-012, DB-016, DB-017, DB-020; UI-030): the cost line with
// «Промпт», the stage profiler and its legend, the hub's stages, the context
// line and the model's reasoning. Only in debug mode (the controller sends
// `debug` then) and never in a collapsed dock. AI money and counters appear
// nowhere else. A lazy part: outside debug mode nobody loads it.

import { Fragment, type JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { type I18nKey } from '@cg/contracts/errors';

import { useDispatch, useI18n, useNowFn, type StyleSource } from '../../kit';
import { type DebugProps, type LazyPart } from '../lazy-part';

/** The client's stage names (§9.3) → their catalog words; an unknown stage prints its own name. */
const STAGE_KEYS: Readonly<Record<string, I18nKey>> = {
  request: 'debug.stage.request',
  meta: 'debug.stage.meta',
  'first-chunk': 'debug.stage.firstChunk',
  firstChunk: 'debug.stage.firstChunk',
  stream: 'debug.stage.stream',
  parse: 'debug.stage.parse',
  render: 'debug.stage.render',
};

/** DB-012: the live timer of a running generation, ten times a second, only while it runs in debug mode. */
function useLiveMs(since: number, live: boolean): number | null {
  const now = useNowFn();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => tick((count) => count + 1), 100);
    return () => clearInterval(id);
  }, [live]);
  return live ? Math.max(0, now() - since) : null;
}

export function DebugFoot({ debug, startedAt, running }: DebugProps): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const liveMs = useLiveMs(startedAt, running && debug.liveTimer);
  const number = new Intl.NumberFormat(i18n.language);
  const seconds = new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const stageName = (name: string): string => {
    const key = STAGE_KEYS[name];
    return key === undefined ? name : i18n.t(key);
  };
  const total = liveMs ?? debug.totalMs ?? debug.stages.reduce((sum, stage) => sum + stage.ms, 0);
  const hub = (name: string): string => {
    const stage = debug.hubStages.find((item) => item.name === name);
    return stage === undefined ? '—' : number.format(stage.ms);
  };
  const ms = i18n.t('debug.gutter.ms');
  const context = debug.context;
  const prompt = debug.prompt;
  return (
    <div class="cg-debug" role="group" aria-label={i18n.t('debug.label')}>
      {debug.costLine === null && prompt === null ? null : (
        <>
          <span class="cg-gut">{i18n.t('debug.gutter.cost')}</span>
          <div class="cg-debug__line">
            {/* The line wraps between its items only: «7,0 с» and a model's name stay whole. */}
            <span class="cg-debug__cost">
              {(debug.costLine ?? '').split(' • ').map((item, index) => (
                <Fragment key={index}>
                  {index === 0 ? null : ' • '}
                  <span>{item}</span>
                </Fragment>
              ))}
            </span>
            {prompt === null ? null : (
              <button type="button" class="cg-debug__link" onClick={() => void dispatch(prompt)}>
                {i18n.t('debug.prompt')}
              </button>
            )}
          </div>
        </>
      )}
      <span class="cg-gut">{ms}</span>
      <div>
        <div class="cg-prof__row">
          {debug.stages.length === 0 ? (
            <div class="cg-prof cg-prof--idle" aria-hidden="true" />
          ) : (
            <div class="cg-prof" role="img" aria-label={i18n.t('debug.profilerAria')}>
              {debug.stages.map((stage) => (
                <i key={stage.name} title={`${stageName(stage.name)} ${number.format(stage.ms)} ${ms}`} style={{ flex: `${Math.max(1, stage.ms)} 1 0` }} />
              ))}
            </div>
          )}
          <span class="cg-prof__total" data-cg-total="">
            {i18n.t('debug.total', { s: seconds.format(total / 1000) })}
          </span>
        </div>
        {debug.stages.length === 0 ? null : (
          <div class="cg-prof__legend">
            {debug.stages.map((stage) => (
              <span key={stage.name}>
                {stageName(stage.name)} <b>{number.format(stage.ms)}</b>
              </span>
            ))}
          </div>
        )}
        {debug.hubStages.length === 0 ? null : (
          <div class="cg-prof__legend cg-prof__legend--hub">
            <span>{i18n.t('debug.hubStages', { a: hub('context'), b: hub('provider'), c: hub('stream') })}</span>
          </div>
        )}
        {context === null ? null : (
          <div class="cg-debug__ctx">
            <span>
              source <b>{context.source}</b>
            </span>
            <span>
              coverage <b>{context.coverage}</b>
            </span>
            <span>
              window <b>{`${context.windowServed}/${context.windowRequested}`}</b>
            </span>
            <span>
              live <b>{`${context.liveAccepted}/${context.liveRejected}`}</b>
            </span>
          </div>
        )}
        {debug.reasoning === null ? null : <div class="cg-debug__why">{debug.reasoning}</div>}
      </div>
    </div>
  );
}

// One line of the footer is the caption's size plus 5 px (11 / 16; 13 / 18 with «Размер текста: крупнее»): the gutter
// captions, the bar's row and the text lines keep one rhythm at both sizes.
export const DEBUG_CSS = `
.cg-debug {
  --cg-debug-line: calc(var(--cg-text-xs) + 5px);
  flex: none; display: grid; grid-template-columns: calc(var(--cg-gutter) - 1px) minmax(0, 1fr); row-gap: 6px; padding: 9px 10px 10px 0;
  border-top: 1px solid var(--cg-rule); background: var(--cg-debug-bg); font-size: var(--cg-text-xs); line-height: var(--cg-debug-line);
}
/* In a sheet held to its cap the footer gives way before the answer: down to its first line (no footer is shorter: the
   bar's row is always there), then it scrolls. */
.cg-root .cg-sheet > .cg-debug {
  flex: 0 100 auto; min-height: calc(var(--cg-debug-line) + 20px); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin;
}
.cg-debug > .cg-gut { align-self: start; height: var(--cg-debug-line); font-family: var(--cg-mono); font-size: var(--cg-text-2xs); }
.cg-debug__line { font-family: var(--cg-mono); color: var(--cg-ink-2); overflow-wrap: anywhere; display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.cg-debug__cost > span { display: inline-block; max-width: 100%; }
.cg-root .cg-debug__link { flex: none; font-family: inherit; font-size: var(--cg-text-xs); line-height: inherit; color: var(--cg-ink-2); text-decoration: underline; text-decoration-color: var(--cg-rule-3); text-underline-offset: 2px; }
.cg-prof__row { display: flex; align-items: center; gap: 10px; height: var(--cg-debug-line); }
.cg-prof { flex: 1; min-width: 0; display: flex; gap: 2px; height: 6px; }
.cg-prof--idle { border-radius: var(--cg-r-xs); background: var(--cg-rule-2); }
.cg-prof i { display: block; height: 6px; min-width: 2px; border-radius: var(--cg-r-xs); background: var(--cg-bar); }
.cg-prof i:nth-child(even) { background: var(--cg-bar-strong); }
.cg-prof__total { flex: none; font-family: var(--cg-mono); color: var(--cg-ink-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
.cg-prof__legend, .cg-debug__ctx { font-family: var(--cg-mono); color: var(--cg-ink-muted); display: flex; flex-wrap: wrap; gap: 0 14px; }
.cg-prof__legend + .cg-prof__legend, .cg-prof__legend + .cg-debug__ctx, .cg-prof__row + .cg-debug__ctx { margin-top: 2px; }
.cg-prof__legend span, .cg-debug__ctx span { white-space: nowrap; }
.cg-prof__legend:not(.cg-prof__legend--hub) span::before {
  content: ''; display: inline-block; width: 6px; height: 6px; margin-right: 5px; vertical-align: 1px; border-radius: var(--cg-r-xs); background: var(--cg-bar);
}
.cg-prof__legend:not(.cg-prof__legend--hub) span:nth-child(even)::before { background: var(--cg-bar-strong); }
.cg-prof__legend--hub span { white-space: normal; overflow-wrap: anywhere; }
.cg-prof__legend b, .cg-debug__ctx b { font-weight: 500; color: var(--cg-ink-2); }
.cg-debug__why {
  margin-top: 6px; padding-left: 8px; border-left: 2px solid var(--cg-rule-2); max-height: calc(5 * var(--cg-debug-line)); overflow-y: auto;
  color: var(--cg-ink-muted); white-space: pre-wrap; overflow-wrap: anywhere; scrollbar-width: thin;
}
`;

export const DEBUG_STYLE: StyleSource = { id: 'cg-dock-debug', css: DEBUG_CSS };

export const debugPart: LazyPart<DebugProps> = { view: DebugFoot, styles: [DEBUG_STYLE] };
