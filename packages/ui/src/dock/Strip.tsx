// The strip (ui-design §3.1, §3.3, §4.1; UI-002…UI-010, UI-031, AI-002…
// AI-010): one 34 px line above the composer — the goose mark, the seven AI
// actions, «Ещё» on a narrow composer, then status words, quota, the tones,
// Split, the two windows (Spenders, «Новые»), the persona and the palette
// hint. `role="toolbar"`: one tab stop, arrows inside. What hides at which
// width is CSS (container queries, styles.ts); the markup is the same at
// every width.
//
// The tones stand twice (decision X26): on a wide composer as four buttons —
// one click runs Reply in that tone, no menu to open — and on a narrow one as
// the «Тон» menu with the same choices. CSS shows one of the two.

import { type JSX, type TargetedKeyboardEvent } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

import { type Tone } from '@cg/contracts/features';
import { DOCK_ACTION_IDS, type DockActionId, type DockVM, type UiAction } from '@cg/contracts/vm';

import {
  CheckGlyph,
  Divider,
  GooseMark,
  Icon,
  Menu,
  MenuAnchor,
  Spinner,
  StripButton,
  focusQuietly,
  hotkeyText,
  menuTriggerKeys,
  rovingIndex,
  useDispatch,
  useHints,
  useI18n,
  useKit,
  useTooltip,
  type MenuItem,
} from '../kit';
import { QUOTA_RESET_TIME_ZONE, isCrowded, quotaSlot, stripAction } from './model';

/** Review, Recap and Coach move into «Ещё» on a composer of 600 px and narrower (ui-design §3.3). */
const TIER_TWO: readonly DockActionId[] = ['review', 'recap', 'coach'];
/** The kit's menus are at least this wide (ui-design §4.1). */
const MENU_MIN_WIDTH_PX = 200;
/** The menu's id of «Без тона». */
const NO_TONE = 'none';
/** A key label longer than this is a spelled-out one («Ctrl+E», «Ctrl+Alt+B»), not a symbol one («⌘E», «⌘⇧B»). */
const LONG_KEY_LABEL = 4;

type BoardId = 'spenders' | 'newcomers';
/** The windows that open from the strip: the boards a chatter works from between chats. */
const BOARDS: readonly BoardId[] = ['spenders', 'newcomers'];
type StopId = DockActionId | 'more' | `tone:${Tone}` | 'tone' | 'split' | BoardId;

function visible(element: HTMLElement): boolean {
  return element.getClientRects().length > 0;
}

/** The goose: a mark, not a button; its tooltip carries the persona on a narrow strip too. */
function Mark({ vm }: { readonly vm: DockVM }): JSX.Element {
  const i18n = useI18n();
  const text = vm.persona === null ? i18n.t('dock.label') : i18n.t('dock.mark.tooltip', { persona: vm.persona.label });
  const tip = useTooltip(text);
  return (
    <>
      <span class={`cg-mark${vm.mark === 'faint' ? ' is-off' : ''}`} role="img" aria-label={text} {...tip.props}>
        <GooseMark />
      </span>
      {tip.description}
    </>
  );
}

/** A quiet word of the right block with its own tooltip (quota, persona, the palette hint). */
function Word({ class: name, text, tooltip, short }: { readonly class: string; readonly text: string; readonly tooltip: string | null; readonly short?: string }): JSX.Element {
  const tip = useTooltip(tooltip);
  return (
    <>
      <span class={name} {...tip.props}>
        {short === undefined ? (
          text
        ) : (
          <>
            <span class="cg-long">{text}</span>
            <span class="cg-short">{short}</span>
          </>
        )}
      </span>
      {tip.description}
    </>
  );
}

export interface StripProps {
  readonly vm: DockVM;
  /** A start was refused (the fourth generation, a busy chat): the refusal shows again even if it was hidden. */
  readonly onRefused?: () => void;
}

export function Strip({ vm, onRefused }: StripProps): JSX.Element {
  const i18n = useI18n();
  const hints = useHints();
  const { deps } = useKit();
  const dispatch = useDispatch();
  const bar = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const toneRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<'tone' | 'more' | null>(null);
  /** «Ещё» opens from its left edge; on a composer too narrow for that — from its right edge, inside the dock. */
  const [moreAlign, setMoreAlign] = useState<'start' | 'end'>('start');
  const [stop, setStop] = useState<StopId>('reply');
  const t = i18n.t.bind(i18n);
  /** The strip's buttons in DOM order: the tab stop is one of them, arrows walk the ones a width left visible. */
  const STOPS: readonly StopId[] = [...DOCK_ACTION_IDS, 'more', ...vm.options.tones.map((id): StopId => `tone:${id}`), 'tone', 'split', ...BOARDS];

  const buttons = (): HTMLElement[] => [...(bar.current?.querySelectorAll<HTMLElement>('.cg-act') ?? [])];
  const stopOf = (target: EventTarget | null): StopId | null => {
    const button = target instanceof HTMLElement ? target.closest<HTMLElement>('.cg-act') : null;
    return button === null ? null : (STOPS[buttons().indexOf(button)] ?? null);
  };
  /** The buttons a width left on screen (all of them where nothing is laid out). */
  const shown = (): HTMLElement[] => {
    const all = buttons();
    const laidOut = all.filter(visible);
    return laidOut.length > 0 ? laidOut : all;
  };
  // One tab stop for the whole strip (ui-design §6.3); it never sits on a button a narrower composer hid.
  useLayoutEffect(() => {
    const all = buttons();
    const list = shown();
    const current = all[STOPS.indexOf(stop)];
    const first = list[0];
    if (first !== undefined && (current === undefined || !list.includes(current))) setStop(STOPS[all.indexOf(first)] ?? 'reply');
  });

  const run = (action: UiAction | null): void => {
    if (action === null) return;
    void dispatch(action).then((receipt) => {
      if (receipt !== null && !receipt.ok) onRefused?.();
    });
  };
  const cancelKey = hotkeyText(deps.catalog.entry('cancel').hotkey)?.display ?? '';
  const nameOf = (id: DockActionId): string => t(`dock.action.${id}`);
  const whyOff = (id: DockActionId): string | null => {
    const action = vm.actions[id];
    if (action.enabled) return null;
    return action.reason === null ? t('common.unknown') : i18n.text(action.reason.text);
  };
  const stopProps = (id: StopId): { readonly tabIndex: 0 | -1 } => ({ tabIndex: stop === id ? 0 : -1 });

  const actionButton = (id: DockActionId): JSX.Element => {
    const action = vm.actions[id];
    const name = nameOf(id);
    const off = whyOff(id);
    const keys = hotkeyText(action.hotkey);
    let tooltip = action.busy ? t('dock.action.busy', { action: name, hotkey: cancelKey }).trim() : keys === null ? name : t('dock.action.tooltip', { action: name, hotkey: keys.display });
    if (action.badge !== null) tooltip = `${tooltip}\n${t('dock.badge.recapReady')}`;
    return (
      <StripButton
        label={name}
        hotkey={action.enabled ? action.hotkey : null}
        active={action.active}
        busy={action.busy}
        ready={action.badge !== null}
        reason={off === null ? null : t('dock.action.unavailable', { action: name, reason: off })}
        tooltip={tooltip}
        onClick={() => run(stripAction(id, vm))}
        {...stopProps(id)}
      />
    );
  };

  // ── «Ещё» ──
  const tierTwo = TIER_TWO.map((id) => vm.actions[id]);
  const firstOff = TIER_TWO.find((id) => !vm.actions[id].enabled) ?? null;
  const moreOff = tierTwo.every((action) => !action.enabled) && firstOff !== null ? t('dock.action.moreUnavailable', { reason: whyOff(firstOff) ?? '' }) : null;
  const moreItems: MenuItem[] = TIER_TWO.map((id) => {
    const keys = hotkeyText(vm.actions[id].hotkey);
    const off = whyOff(id);
    return { id, label: nameOf(id), ...(keys === null ? {} : { hint: keys.display }), reason: off === null ? null : t('dock.action.unavailable', { action: nameOf(id), reason: off }) };
  });

  const alignMore = (): void => {
    const button = moreRef.current?.getBoundingClientRect();
    const strip = bar.current?.getBoundingClientRect();
    setMoreAlign(button !== undefined && strip !== undefined && button.left + MENU_MIN_WIDTH_PX > strip.right ? 'end' : 'start');
  };
  const openMore = (): void => {
    alignMore();
    setMenu('more');
  };
  // The composer may change its width under an open «Ещё» (a ChatSpace panel opens, the window
  // shrinks): the menu stays inside the dock, and goes away with its button on a wide composer.
  useLayoutEffect(() => {
    if (menu !== 'more') return;
    const laidOut = buttons().filter(visible);
    if (laidOut.length > 0 && moreRef.current !== null && !laidOut.includes(moreRef.current)) setMenu(null);
    else alignMore();
  });

  // ── Тон ──
  const { tone, tones, locked, toneReason, splitReason, split } = vm.options;
  const toneKeys = hotkeyText(vm.options.toneHotkey);
  const splitKeys = hotkeyText(vm.options.splitHotkey);
  const toneWord = t('dock.option.tone');
  const toneFull = tone === null ? toneWord : t('dock.option.toneValue', { tone: t(`dock.tone.${tone}`) });
  // «Тон: Flirt» keeps «Тон» at 420 px and narrower; a catalog that words it otherwise shows the whole phrase.
  const toneSplit = toneFull.startsWith(toneWord) && toneFull.length > toneWord.length;
  const toneOff = locked ? t('dock.option.toneLocked') : toneReason === null ? null : t('dock.option.toneUnavailable', { reason: i18n.text(toneReason.text) });
  const toneItems: MenuItem[] = [
    ...tones.map((id) => ({ id, label: t(`dock.tone.${id}`), checked: tone === id })),
    { id: NO_TONE, label: t('dock.option.toneNone'), checked: tone === null },
  ];
  const chooseTone = (id: string): void => {
    if (vm.targetHandle === null) return;
    // «Без тона», and a second click on the tone that is already chosen (AI-006), only take the tone off.
    if (id === NO_TONE || id === tone) run({ type: 'SetTone', targetHandle: vm.targetHandle, tone: null });
    // A tone chosen in the menu runs Reply in it at once (AI-005); with Reply off it is only remembered.
    else if (vm.actions.reply.enabled) run({ type: 'Generate', targetHandle: vm.targetHandle, feature: 'reply', options: { tone: id as Tone } });
    else run({ type: 'SetTone', targetHandle: vm.targetHandle, tone: id as Tone });
  };

  /** A tone as a button of its own: what a click on it does, in the words of the menu's choice. */
  const toneButton = (id: Tone): JSX.Element => {
    const name = t(`dock.tone.${id}`);
    const value = t('dock.option.toneValue', { tone: name });
    // Chosen: a click takes the tone off. Otherwise it runs Reply in it at once (AI-005); with Reply off it is only remembered.
    const tooltip = tone === id ? `${value} → ${t('dock.option.toneNone')}` : vm.actions.reply.enabled ? `${nameOf('reply')} · ${value}` : value;
    return <StripButton key={id} label={name} class="cg-opt cg-tone" pressed={tone === id} reason={toneOff} tooltip={tooltip} onClick={() => chooseTone(id)} {...stopProps(`tone:${id}`)} />;
  };

  // ── the windows ──
  const boardButton = (id: BoardId): JSX.Element => {
    const name = t(id === 'spenders' ? 'spenders.title' : 'newcomers.title');
    const keys = id === 'spenders' ? hotkeyText(deps.catalog.entry('spenders').hotkey) : null;
    return (
      <StripButton
        key={id}
        label={name}
        class="cg-opt cg-board"
        tooltip={keys === null ? name : t('dock.action.tooltip', { action: name, hotkey: keys.display })}
        onClick={() => run({ type: 'Navigate', to: { kind: 'surface', surface: id, open: true } })}
        {...stopProps(id)}
      />
    );
  };

  // ── Split ──
  const splitOff =
    locked
      ? t('dock.option.splitLocked')
      : splitReason === null
        ? null
        : splitReason.id === 'not-a-message'
          ? i18n.text(splitReason.text)
          : t('dock.option.splitUnavailable', { reason: i18n.text(splitReason.text) });
  const lock = locked ? <Icon name="lock" size={12} class="cg-lock" /> : null;

  // ── quota, persona ──
  const quota = quotaSlot(vm);
  const resets = vm.quota?.resetsAt ?? null;
  const resetsAt = resets === null ? null : i18n.formatTime(resets);
  // «Обновится в 03:00 по Москве» names its zone, so that time is Moscow's wherever the chatter sits.
  const resetsMoscow = resets === null ? null : (i18n.formatTimeIn?.(resets, QUOTA_RESET_TIME_ZONE) ?? null);
  const remaining = vm.quota?.remaining ?? 0;

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (menu !== null || event.defaultPrevented) return;
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('.cg-act') : null;
    if (target === null) return;
    const list = shown();
    const next = rovingIndex(event.key, list.indexOf(target), list.length, 'horizontal');
    if (next === null) return;
    event.preventDefault();
    focusQuietly(list[next]);
  };

  // «Ctrl+Alt+B» is four times as wide as «⌘⇧B»: where key labels are long, the widths of §3.3 are other ones.
  const longKeys = DOCK_ACTION_IDS.some((id) => (hotkeyText(vm.actions[id].hotkey)?.display.length ?? 0) > LONG_KEY_LABEL);
  const classes = ['cg-strip', isCrowded(vm) ? 'is-crowded' : '', vm.statusWords ? 'has-status' : '', longKeys ? 'is-longkeys' : ''].filter((name) => name !== '').join(' ');
  return (
    <div
      ref={bar}
      class={classes}
      role="toolbar"
      aria-label={t('dock.label')}
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      onFocusIn={(event) => {
        const id = stopOf(event.target);
        if (id !== null && id !== stop) setStop(id);
      }}
    >
      <Mark vm={vm} />
      <div class="cg-strip__acts">
        {DOCK_ACTION_IDS.map((id, index) => (
          <span key={id} class={TIER_TWO.includes(id) ? 'cg-slot cg-slot--two' : 'cg-slot'}>
            {index === 0 ? null : <Divider />}
            {actionButton(id)}
          </span>
        ))}
        <span class="cg-slot cg-slot--more">
          <Divider />
          <MenuAnchor>
            <StripButton
              label={t('dock.action.more')}
              active={tierTwo.some((action) => action.active)}
              busy={tierTwo.some((action) => action.busy)}
              ready={tierTwo.some((action) => action.badge !== null)}
              reason={moreOff}
              tooltip={t('dock.action.moreTooltip')}
              haspopup="menu"
              expanded={menu === 'more'}
              buttonRef={moreRef}
              onClick={() => (menu === 'more' ? setMenu(null) : openMore())}
              onKeyDown={(event) => {
                if (moreOff === null) menuTriggerKeys(event, openMore);
              }}
              {...stopProps('more')}
            />
            <Menu
              open={menu === 'more'}
              kind="action"
              label={t('dock.action.more')}
              items={moreItems}
              align={moreAlign}
              onSelect={(id) => run(stripAction(id as DockActionId, vm))}
              onClose={() => setMenu(null)}
              returnFocusTo={() => moreRef.current}
            />
          </MenuAnchor>
        </span>
      </div>
      <div class="cg-strip__opts">
        {vm.statusWords ? (
          <>
            <span class="cg-status-word" role="status">
              <Spinner />
              <span class="cg-long">{t('dock.status.chatLoading')}</span>
              <span class="cg-short">{t('common.loading')}</span>
            </span>
            <Divider />
          </>
        ) : null}
        {quota === null ? null : (
          <span class="cg-slot cg-slot--quota">
            {quota === 'zero' ? (
              <Word class="cg-quota is-zero cg-num" text={t('dock.quota.zero')} tooltip={resetsMoscow === null ? null : t('dock.quota.zeroTooltip', { time: resetsMoscow })} />
            ) : (
              <Word
                class="cg-quota cg-num"
                text={t('dock.quota.low', { n: remaining })}
                short={t('dock.quota.lowShort', { n: remaining })}
                tooltip={resetsAt === null ? null : t('dock.quota.lowTooltip', { n: remaining, time: resetsAt })}
              />
            )}
            <Divider />
          </span>
        )}
        <span class="cg-slot cg-slot--tones" role="group" aria-label={toneWord}>
          {tones.map(toneButton)}
          {lock}
          <Divider />
        </span>
        <span class="cg-slot cg-slot--tone">
          <MenuAnchor>
            <StripButton
              label={toneSplit ? toneWord : toneFull}
              class="cg-opt"
              hotkey={vm.options.toneHotkey}
              reason={toneOff}
              tooltip={toneKeys === null ? t('dock.option.toneMenuTitle') : t('dock.option.toneTooltip', { hotkey: toneKeys.display })}
              haspopup="menu"
              expanded={menu === 'tone'}
              buttonRef={toneRef}
              trailing={
                <>
                  {toneSplit ? <span class="cg-tone-val">{toneFull.slice(toneWord.length)}</span> : null}
                  {lock}
                </>
              }
              onClick={() => setMenu(menu === 'tone' ? null : 'tone')}
              onKeyDown={(event) => {
                if (toneOff === null) menuTriggerKeys(event, () => setMenu('tone'));
              }}
              {...stopProps('tone')}
            />
            <Menu
              open={menu === 'tone'}
              kind="radio"
              label={toneWord}
              caption={{ text: t('dock.option.toneMenuTitle'), ...(toneKeys === null ? {} : { hint: toneKeys.display }) }}
              items={toneItems}
              align="end"
              onSelect={chooseTone}
              onClose={() => setMenu(null)}
              returnFocusTo={() => toneRef.current}
            />
          </MenuAnchor>
          <Divider />
        </span>
        <span class="cg-slot cg-slot--split">
          <StripButton
            label={t('dock.option.split')}
            class="cg-opt"
            hotkey={vm.options.splitHotkey}
            pressed={split}
            reason={splitOff}
            tooltip={splitKeys === null ? t('dock.option.split') : t('dock.option.splitTooltip', { hotkey: splitKeys.display })}
            leading={<CheckGlyph on={split} />}
            trailing={lock}
            onClick={() => run({ type: 'SetPreference', key: 'generation.split', value: !split })}
            {...stopProps('split')}
          />
        </span>
        <span class="cg-slot cg-slot--boards">
          <Divider />
          {BOARDS.map(boardButton)}
        </span>
        {vm.status === 'not-signed-in' ? (
          <span class="cg-slot cg-slot--persona">
            <Divider />
            <span class="cg-persona is-missing">{t('dock.persona.notSignedIn')}</span>
          </span>
        ) : (
          <span class="cg-slot cg-slot--persona">
            <Divider />
            {vm.persona === null ? null : <Word class="cg-persona" text={vm.persona.label} tooltip={hints ? t('dock.persona.tooltip', { page: vm.persona.pageName }) : null} />}
          </span>
        )}
        {vm.paletteHotkey === null ? null : <Word class="cg-hint" text={hotkeyText(vm.paletteHotkey)?.display ?? ''} tooltip={hints ? t('dock.paletteHint.tooltip') : null} />}
      </div>
    </div>
  );
}
