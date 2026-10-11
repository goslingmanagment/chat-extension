// @cg/ui/dock/debug — the debug footer of an open result (ui-design §4.12;
// DB-011, DB-012, DB-016, DB-017, DB-020; UI-030): the cost line with
// «Промпт», the stage profiler and its legend, the hub's stages, the context
// line and the model's reasoning. Only in debug mode (the controller sends
// `debug` then) and never in a collapsed dock. AI money and counters appear
// nowhere else. A lazy part: outside debug mode nobody loads it.

import { type JSX } from 'preact';
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
  const context = debug.context;
  const prompt = debug.prompt;
  return (
    <div class="cg-debug" role="group" aria-label={i18n.t('debug.label')}>
      {debug.costLine === null && prompt === null ? null : (
        <>
          <span class="cg-gut">{i18n.t('debug.gutter.cost')}</span>
          <div class="cg-debug__line">
            <span>{debug.costLine ?? ''}</span>
            {prompt === null ? null : (
              <button type="button" class="cg-debug__link" onClick={() => void dispatch(prompt)}>
                {i18n.t('debug.prompt')}
              </button>
            )}
          </div>
        </>
      )}
      <span class="cg-gut">{i18n.t('debug.gutter.ms')}</span>
      <div>
        {debug.stages.length === 0 ? null : (
          <div class="cg-prof" role="img" aria-label={i18n.t('debug.profilerAria')}>
            {debug.stages.map((stage) => (
              <i key={stage.name} style={{ flex: `${Math.max(1, stage.ms)} 1 0` }} />
            ))}
          </div>
        )}
        <div class="cg-prof__legend">
          {debug.stages.map((stage) => (
            <span key={stage.name}>
              {stageName(stage.name)} <b>{number.format(stage.ms)}</b>
            </span>
          ))}
          <span data-cg-total="">{i18n.t('debug.total', { s: seconds.format(total / 1000) })}</span>
        </div>
        {debug.hubStages.length === 0 ? null : (
          <div class="cg-prof__legend cg-prof__legend--hub">
            <span>{i18n.t('debug.hubStages', { a: hub('context'), b: hub('provider'), c: hub('stream') })}</span>
          </div>
        )}
        {context === null ? null : (
          <div class="cg-prof__legend cg-prof__legend--hub">
            <span>{`source=${context.source} • coverage=${context.coverage} • window=${context.windowServed}/${context.windowRequested} • live=${context.liveAccepted}/${context.liveRejected}`}</span>
          </div>
        )}
        {debug.reasoning === null ? null : <div class="cg-debug__why">{debug.reasoning}</div>}
      </div>
    </div>
  );
}

export const DEBUG_CSS = `
.cg-debug {
  flex: none; display: grid; grid-template-columns: calc(var(--cg-gutter) - 1px) minmax(0, 1fr); row-gap: 6px; padding: 9px 10px 10px 0;
  border-top: 1px solid var(--cg-rule); background: var(--cg-debug-bg); font-size: var(--cg-text-xs); line-height: 16px;
}
.cg-debug > .cg-gut { font-size: 10px; height: 16px; }
.cg-debug__line { font-family: var(--cg-mono); color: var(--cg-ink-2); overflow-wrap: anywhere; display: flex; justify-content: space-between; gap: 12px; }
.cg-root .cg-debug__link { flex: none; font-family: inherit; font-size: var(--cg-text-xs); color: var(--cg-ink-2); text-decoration: underline; text-decoration-color: var(--cg-rule-3); text-underline-offset: 2px; }
.cg-prof { display: flex; gap: 2px; height: 6px; margin-top: 2px; }
.cg-prof i { display: block; height: 6px; min-width: 2px; border-radius: var(--cg-r-xs); background: var(--cg-bar); }
.cg-prof i:nth-child(even) { background: var(--cg-bar-strong); }
.cg-prof__legend { margin-top: 6px; font-family: var(--cg-mono); color: var(--cg-ink-muted); display: flex; flex-wrap: wrap; gap: 2px 12px; }
.cg-prof__legend--hub { margin-top: 2px; }
.cg-prof__legend span { white-space: nowrap; }
.cg-prof__legend--hub span { white-space: normal; overflow-wrap: anywhere; }
.cg-prof__legend b { font-weight: 500; color: var(--cg-ink-2); }
.cg-debug__why { margin-top: 6px; max-height: 96px; overflow-y: auto; font-family: var(--cg-mono); color: var(--cg-ink-muted); white-space: pre-wrap; overflow-wrap: anywhere; scrollbar-width: thin; }
`;

export const DEBUG_STYLE: StyleSource = { id: 'cg-dock-debug', css: DEBUG_CSS };

export const debugPart: LazyPart<DebugProps> = { view: DebugFoot, styles: [DEBUG_STYLE] };
