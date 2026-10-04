// @cg/ui/overlays/coach — the Coach side panel (ui-design §3.7, §4.19, §10;
// §9.1 (б): a 320 px panel on layer 900, the coordinator's proposal — the
// conversation stays visible and Coach never covers the chat; AI-080…AI-100).
// The session of the open chat from `CoachVM`: the freshness of the archive
// Coach reads, the turns with their waiting stages, answers with drafts split
// into parts (Insert one at a time, as in the dock), ready questions, and the
// question field (↵ asks, ⇧↵ a new line). The panel does not trap focus; Esc
// closes it and focus goes back. Coach sees the archive and the Recap, never
// the fan's fresh text. A lazy overlay.

import { type ReadonlySignal } from '@preact/signals';
import { type JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

import { COACH_LIMITS } from '@cg/contracts/limits';
import { type CoachTurnVM, type CoachVM, type MountDeps } from '@cg/contracts/vm';

import {
  Button,
  Caret,
  Checkbox,
  Dot,
  ErrorCard,
  Markdown,
  OverlayLayer,
  SidePanel,
  StageLine,
  TextField,
  ViewState,
  mountKitSurface,
  useDispatch,
  useI18n,
  useKit,
  useMinuteClock,
  useNowFn,
  useView,
  type KitMount,
  type KitMountOptions,
  type StyleSource,
  type SurfaceDefinition,
} from '../../kit';
import { isRunning, msgOf, toneOf } from '../../dock/model';
import { Parts } from '../../dock/Parts';
import { StreamText, useSteadyView, useStreamText } from '../../dock/Stream';
import { DOCK_STYLE } from '../../dock/styles';
import { overlayRootCss } from '../layer';

/** A question typed and not yet asked survives closing the panel (AI-099); in memory only, by the chat's handle. */
const unsent = new Map<string, string>();

function Turn({ turn, raw, mode }: { readonly turn: CoachTurnVM; readonly raw: ReadonlySignal<CoachVM>; readonly mode: 'insert' | 'copy-only' }): JSX.Element {
  const i18n = useI18n();
  const text = useStreamText(raw, (coach) => coach.turns.find((item) => item.id === turn.id)?.streamText ?? null);
  const answer = turn.answer;
  return (
    <>
      <div class="cg-co__turn is-you" data-cg-turn={turn.id}>
        <div class="cg-co__who">
          {i18n.t('coach.who.you')}
          {turn.attachedDraft ? <span class="cg-co__with"> · {i18n.t('coach.attachDraft')}</span> : null}
        </div>
        <p>{turn.question}</p>
      </div>
      <div class="cg-co__turn" data-cg-answer={turn.id}>
        <div class="cg-co__who">{i18n.t('coach.who.coach')}</div>
        {isRunning(turn.state) ? (
          <div class="cg-co__wait" aria-busy="true">
            {turn.sentToCoach || turn.phase === null ? <span class="cg-co__sent">{i18n.t('coach.sentToCoach')}</span> : <div class="cg-co__stages"><StageLine phase={turn.phase} startedAt={turn.phase.startedAt} /></div>}
            <p class="cg-co__stream">
              <StreamText text={text} />
              <Caret />
            </p>
          </div>
        ) : null}
        {answer === null ? null : (
          <>
            {answer.prose === '' ? null : <Markdown source={answer.prose} class="cg-co__md" />}
            {(answer.blocks ?? []).map((block, index) => (
              <div key={index} class="cg-co__block" data-cg-block={block.kind}>
                <div class="cg-cap">{i18n.text(block.title)}</div>
                <Markdown source={block.body} class="cg-co__md" />
              </div>
            ))}
            {answer.drafts.map((draft) => (
              <div key={draft.index} class="cg-co__drafts" role="group" aria-label={i18n.text(draft.label)}>
                {answer.drafts.length > 1 ? <div class="cg-co__draft-cap">{i18n.text(draft.label)}</div> : null}
                <Parts parts={draft.parts} opId={turn.opId ?? ''} mode={turn.opId === null ? 'copy-only' : mode} confirm={null} />
              </div>
            ))}
          </>
        )}
        {turn.error === null ? null : <ErrorCard error={turn.error} tone={toneOf(turn.error)} actions={turn.errorActions} inline />}
      </div>
    </>
  );
}

function Freshness({ freshness }: { readonly freshness: CoachVM['freshness'] }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const { lag, asOf, refresh } = freshness;
  return (
    <div class="cg-co__bar">
      {lag !== null ? (
        <span class="is-lag">
          <Dot kind="accent" use="archive-lag" />
          {lag.messages === null ? i18n.t('common.coverage.partial') : i18n.t('coach.archiveLag', { n: lag.messages })}
        </span>
      ) : asOf === null ? (
        <span />
      ) : (
        <span>{i18n.t('coach.archiveAsOf', { time: i18n.formatTime(asOf) })}</span>
      )}
      <Button
        label={i18n.text(refresh.label)}
        icon="refresh"
        size="sm"
        variant={lag === null ? 'plain' : 'line'}
        reason={refresh.enabled ? null : refresh.reason === null ? i18n.t('common.unknown') : i18n.text(refresh.reason.text)}
        onClick={() => void dispatch(refresh.action)}
      />
    </div>
  );
}

/** The Recap Coach was given, folded under the head (AI-095). */
function RecapNote({ recap }: { readonly recap: NonNullable<CoachVM['recap']> }): JSX.Element {
  const i18n = useI18n();
  const now = useNowFn();
  useMinuteClock();
  return (
    <details class="cg-co__recap">
      <summary>
        <b>{i18n.t('dock.action.recap')}</b>
        <span>{i18n.t('recap.madeAgo', { age: i18n.formatAge(recap.generatedAt, now()) })}</span>
      </summary>
      <p>{recap.summary}</p>
    </details>
  );
}

export function CoachView(): JSX.Element {
  const i18n = useI18n();
  const { deps } = useKit();
  const dispatch = useDispatch();
  const raw = useView({ of: 'coach' });
  const vm = useSteadyView(raw).value;
  // Coach follows the open chat: its target and the copy-only mode are the dock's.
  const dock = useSteadyView(useView({ of: 'dock' })).value;
  const handle = dock.targetHandle;
  const key = handle ?? '';
  const [question, setQuestion] = useState(() => unsent.get(key) ?? '');
  const [attach, setAttach] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const last = vm.turns[vm.turns.length - 1];
  // A new turn or its answer scrolls into view.
  useLayoutEffect(() => {
    const element = list.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [vm.turns.length, last?.state]);

  const close = (): void => void dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'coach', open: false } });
  const keep = (value: string): void => {
    setQuestion(value);
    if (value === '') unsent.delete(key);
    else unsent.set(key, value);
  };
  const canAsk = vm.ask.enabled && handle !== null;
  const whyNot = canAsk ? null : vm.ask.reason === null ? i18n.t('common.unknown') : i18n.text(vm.ask.reason.text);
  const ask = (text: string, preset: 'situation' | null = null): void => {
    const body = text.trim();
    if (!canAsk || body === '') return;
    const withDraft = attach && vm.ask.attachDraft.available;
    void dispatch({
      type: 'Generate',
      targetHandle: handle,
      feature: 'coach',
      options: { question: body, ...(preset === null ? {} : { preset }), ...(withDraft ? { attachMyDraft: true } : {}) },
    }).then((receipt) => {
      // The question leaves the field only once the turn started (AI-099).
      if (receipt?.ok === true && preset === null) keep('');
    });
  };
  const newDialog = (): void => {
    const start = (): void => void dispatch(vm.newDialog.action);
    if (vm.turns.length === 0) return start();
    void deps.dialogs
      .confirm({ title: msgOf('coach.newDialog'), body: msgOf('coach.newDialogTooltip'), confirm: msgOf('coach.newDialog'), cancel: msgOf('common.cancel'), tone: 'normal' })
      .then((answer) => {
        if (answer === 'confirm') start();
      });
  };

  const chips =
    vm.chips.length === 0 ? null : (
      <div class="cg-co__chips">
        {vm.chips.map((chip, index) => (
          <Button key={index} label={i18n.text(chip.label)} variant="line" size="sm" reason={whyNot} onClick={() => ask(chip.question, chip.preset)} />
        ))}
      </div>
    );
  const firstRemembered = vm.turns.findIndex((turn) => !turn.outsideMemory);
  const blocked = vm.view.s === 'loading' || vm.view.s === 'error' || vm.view.s === 'forbidden';
  const empty = !blocked && vm.turns.length === 0;
  const mode = dock.mode;

  return (
    <OverlayLayer>
      <SidePanel label={i18n.t('coach.title')} class="cg-coach" onClose={close}>
        <div class="cg-co__head">
          <div class="cg-co__who-is">
            <div class="cg-co__name">{i18n.t('coach.title')}</div>
            {vm.targetName === null ? null : <div class="cg-co__sub">{i18n.t('coach.sub', { name: vm.targetName })}</div>}
          </div>
          <Button
            label={i18n.text(vm.newDialog.label)}
            variant="line"
            size="sm"
            tooltip={i18n.t('coach.newDialogTooltip')}
            reason={vm.newDialog.enabled ? null : vm.newDialog.reason === null ? i18n.t('common.unknown') : i18n.text(vm.newDialog.reason.text)}
            onClick={newDialog}
          />
          <Button label={i18n.t('common.close')} icon="x" iconOnly variant="quiet" onClick={close} />
        </div>
        {vm.recap === null ? null : <RecapNote recap={vm.recap} />}
        <Freshness freshness={vm.freshness} />
        <div ref={list} class="cg-co__turns">
          {blocked || vm.view.s === 'offline' ? <ViewState view={vm.view} /> : null}
          {empty ? (
            <div class="cg-co__empty">
              <b>{i18n.t('coach.empty.title')}</b>
              {i18n.t('coach.empty.body', { name: vm.targetName ?? i18n.t('common.unknown') })}
              {chips}
            </div>
          ) : null}
          {blocked
            ? null
            : vm.turns.map((turn, index) => (
                <div key={turn.id} class="cg-co__pair">
                  {index === firstRemembered && index > 0 ? (
                    <div class="cg-co__memory" role="separator">
                      {i18n.t('coach.memoryBoundary')}
                    </div>
                  ) : null}
                  <Turn turn={turn} raw={raw} mode={mode} />
                </div>
              ))}
          {!empty && !blocked && last !== undefined && !isRunning(last.state) ? chips : null}
        </div>
        <div class="cg-co__ask">
          <div class="cg-co__attach">
            <Checkbox
              label={i18n.t('coach.attachDraft')}
              checked={attach && vm.ask.attachDraft.available}
              semantics="toggle"
              onChange={setAttach}
              reason={vm.ask.attachDraft.available ? null : vm.ask.attachDraft.reason === null ? i18n.t('common.unknown') : i18n.text(vm.ask.attachDraft.reason.text)}
            />
          </div>
          <TextField
            value={question}
            onValue={keep}
            label={i18n.t('coach.ask.aria')}
            placeholder={i18n.t('coach.ask.placeholder')}
            multiline
            minHeight={56}
            maxHeight={160}
            maxLength={COACH_LIMITS.questionMaxChars}
            onEnter={() => ask(question)}
          />
          <div class="cg-co__send">
            <span>{i18n.t('coach.ask.hint')}</span>
            <Button label={i18n.t('coach.ask.button')} variant="line" reason={whyNot} onClick={() => ask(question)} />
          </div>
        </div>
      </SidePanel>
    </OverlayLayer>
  );
}

export const COACH_CSS = `
${overlayRootCss('coach', 'panel')}
.cg-coach { font-size: var(--cg-text-base); line-height: 18px; color: var(--cg-ink); }
.cg-co__head { flex: none; display: flex; align-items: center; gap: 10px; padding: 14px 8px 12px 16px; }
.cg-co__who-is { flex: 1; min-width: 0; }
.cg-co__name { font-size: var(--cg-text-xl); line-height: 20px; font-weight: 600; color: var(--cg-ink-strong); }
.cg-co__sub { font-size: var(--cg-text-sm); color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-co__recap { flex: none; padding: 0 16px 8px; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-co__recap summary { display: flex; gap: 8px; cursor: pointer; list-style: none; }
.cg-co__recap summary b { font-weight: 500; color: var(--cg-ink-2); }
.cg-co__recap p { margin-top: 4px; font-size: var(--cg-text-base); line-height: 18px; color: var(--cg-ink-2); }
.cg-co__bar { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; min-height: 32px; padding: 3px 8px 3px 16px; border-top: 1px solid var(--cg-rule); border-bottom: 1px solid var(--cg-rule); font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-co__bar .is-lag { display: inline-flex; align-items: center; gap: 6px; color: var(--cg-ink-strong); font-weight: 500; }
.cg-co__bar .cg-btn { margin-left: auto; }
.cg-co__turns { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; padding: 6px 0 12px; }
.cg-co__turn { padding: 10px 16px 4px; }
.cg-co__who { font-size: var(--cg-text-sm); color: var(--cg-ink-muted); margin-bottom: 2px; }
.cg-co__turn p, .cg-co__md { font-size: var(--cg-text-md); line-height: 20px; color: var(--cg-ink); overflow-wrap: anywhere; }
.cg-co__turn.is-you p { color: var(--cg-ink-2); white-space: pre-wrap; }
.cg-co__sent { font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-co__stages { display: flex; align-items: center; min-width: 0; }
.cg-co__stream { margin-top: 4px; white-space: pre-wrap; }
.cg-co__block { margin-top: 8px; }
.cg-co__drafts { margin: 8px -16px 0; border-top: 1px solid var(--cg-rule); }
.cg-co__draft-cap { padding: 6px 16px 0 32px; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
/* Drafts in the 320 px panel: the number in a 32 px gutter, Copy and «Вставить» under the text (ui-design §4.19). */
.cg-co__drafts .cg-part { grid-template-columns: 32px minmax(0, 1fr); padding-right: 8px; }
.cg-co__drafts .cg-part__t { font-size: var(--cg-text-md); }
.cg-co__drafts .cg-part__a { grid-column: 2; justify-self: start; margin: 6px 0 0 -8px; }
.cg-co__drafts .cg-part.is-done .cg-part__a { margin: 2px 0 0 -8px; }
.cg-co__drafts .cg-part__card, .cg-co__drafts .cg-part__extra { grid-column: 2; }
.cg-co__turn .cg-card { margin-top: 8px; }
.cg-co__memory { margin: 10px 16px 0; padding-top: 8px; border-top: 1px dashed var(--cg-rule-3); font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-co__empty { padding: 28px 16px; color: var(--cg-ink-muted); }
.cg-co__empty b { display: block; font-weight: 600; color: var(--cg-ink-strong); font-size: var(--cg-text-lg); line-height: 20px; margin-bottom: 4px; }
.cg-co__chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 16px 0; }
.cg-co__empty .cg-co__chips { padding: 14px 0 0; }
.cg-co__ask { flex: none; padding: 10px 12px 12px 16px; border-top: 1px solid var(--cg-rule); }
.cg-co__attach { margin: -4px 0 4px -7px; }
.cg-co__attach .cg-check { font-size: var(--cg-text-sm); font-weight: 400; }
.cg-co__send { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 6px; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
`;
export const COACH_STYLE: StyleSource = { id: 'cg-coach', css: COACH_CSS };

export const coachSurface: SurfaceDefinition = { view: CoachView, styles: [DOCK_STYLE, COACH_STYLE] };

export function mountCoach(root: ShadowRoot, deps: MountDeps, options: KitMountOptions = {}): KitMount {
  return mountKitSurface('coach', root, deps, coachSurface, options);
}
