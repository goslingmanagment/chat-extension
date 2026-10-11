// The bar (ui-design §3.1, §3.3, §4.1; UI-002…UI-010, UI-031, AI-002…
// AI-010): one 40 px card above the composer — Reply with the capsule of its
// options, the other AI actions as raised chips in groups, «Ещё» where a
// narrow composer hid some, then the status words, the two windows (Spenders,
// «Новые»), the persona and the palette key. No goose: its cell is the room
// that keeps every chip on a ~540 px composer (decision X31).
// `role="toolbar"`: one tab stop, arrows inside. What hides at which width is
// CSS (container queries, styles.ts); the markup is the same at every width.
//
// Actions are raised chips; options lie in a sunken capsule pressed against
// Reply (decision X28, the Fansly extension's bar): the four tones as emoji —
// one click runs Reply in that tone (AI-005), a click on the chosen one takes
// it off (AI-006), and it rises as a thumb — and, behind a seam, Split,
// pressed in while on. The capsule stands at every width: there is no menu to
// open for a tone.

import { Fragment, type JSX, type TargetedKeyboardEvent } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

import { type I18nKey } from '@cg/contracts/errors';
import { type Tone } from '@cg/contracts/features';
import { DOCK_ACTION_IDS, type DockActionId, type DockVM, type UiAction } from '@cg/contracts/vm';

import {
  CheckGlyph,
  Divider,
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
  useGeometry,
  useHints,
  useI18n,
  useKit,
  useTooltip,
  type IconName,
  type MenuItem,
} from '../kit';
import { QUOTA_RESET_TIME_ZONE, quotaSlot, stripAction } from './model';

/** Review, Recap and Coach: icons on a composer narrower than 610 px, in «Ещё» with the windows below 500 (ui-design §3.3). */
const TIER_TWO: readonly DockActionId[] = ['review', 'recap', 'coach'];
/** On a narrow composer these chips are their icons alone, the word in the hint and in the name (ui-design §3.3). */
const ICONS: Readonly<Record<'review' | 'recap' | 'coach' | BoardId, IconName>> = { review: 'gauge', recap: 'dossier', coach: 'bulb', spenders: 'bill', newcomers: 'userPlus' };
/** A hairline seam stands before the first chip of a group: Reply and its options │ Fix │ Hi · Ping │ Review · Recap · Coach. */
const GROUP_START: readonly DockActionId[] = ['fix', 'hi', 'review'];
/** The tones in the chatters' own language (the Fansly extension's capsule); the word is the cell's name and its hint. */
const TONE_EMOJI: Readonly<Record<Tone, string>> = { casual: '😌', flirty: '😏', upsell: '💰', spicy: '🔥' };
/** The kit's menus are at least this wide (ui-design §4.1). */
const MENU_MIN_WIDTH_PX = 200;

type BoardId = 'spenders' | 'newcomers';
/** The windows that open from the bar: the boards a chatter works from between chats. */
const BOARDS: readonly BoardId[] = ['spenders', 'newcomers'];
type MoreId = DockActionId | BoardId;
type StopId = DockActionId | 'more' | `tone:${Tone}` | 'split' | BoardId;

function visible(element: HTMLElement): boolean {
  return element.getClientRects().length > 0;
}

const isBoard = (id: string): id is BoardId => BOARDS.some((board) => board === id);

/**
 * What is left of a low quota (UI-031): a small count at Reply's corner. It costs the bar no width, so it is there on
 * every composer, and its hint says it in words whatever the hints setting is, as the goose's hint did.
 */
function Quota({ count, text }: { readonly count: number; readonly text: string }): JSX.Element {
  const tip = useTooltip(text);
  return (
    <>
      <span class={`cg-quota cg-num${count === 0 ? ' is-zero' : ''}`} role="img" aria-label={text} {...tip.props}>
        {count}
      </span>
      {tip.description}
    </>
  );
}

/** A quiet word of the right block with its own hint (the persona, the palette key). */
function Word({ class: name, text, tooltip }: { readonly class: string; readonly text: string; readonly tooltip: string | null }): JSX.Element {
  const tip = useTooltip(tooltip);
  return (
    <>
      <span class={name} {...tip.props}>
        {text}
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
  const [menuOpen, setMenuOpen] = useState(false);
  /** What «Ещё» stands for: the chips a narrow composer hid (the three functions where nothing is laid out). */
  const [moreIds, setMoreIds] = useState<readonly MoreId[]>(TIER_TWO);
  /** «Ещё» opens from its left edge; on a composer too narrow for that — from its right edge, inside the dock. */
  const [moreAlign, setMoreAlign] = useState<'start' | 'end'>('start');
  const [stop, setStop] = useState<StopId>('reply');
  // The composer's width decides what is hidden: a new width is a new look at it.
  void useGeometry().value;
  const t = i18n.t.bind(i18n);
  const { tone, tones, locked, toneReason, splitReason, split } = vm.options;
  /** The bar's chips in DOM order: the tab stop is one of them, arrows walk the ones a width left visible. */
  const STOPS: readonly StopId[] = DOCK_ACTION_IDS.flatMap((id): StopId[] => (id === 'reply' ? [id, ...tones.map((item): StopId => `tone:${item}`), 'split'] : [id])).concat('more', ...BOARDS);

  const buttons = (): HTMLElement[] => [...(bar.current?.querySelectorAll<HTMLElement>('.cg-act') ?? [])];
  const stopOf = (target: EventTarget | null): StopId | null => {
    const button = target instanceof HTMLElement ? target.closest<HTMLElement>('.cg-act') : null;
    return button === null ? null : (STOPS[buttons().indexOf(button)] ?? null);
  };
  /** The chips a width left on screen (all of them where nothing is laid out). */
  const shown = (): HTMLElement[] => {
    const all = buttons();
    const laidOut = all.filter(visible);
    return laidOut.length > 0 ? laidOut : all;
  };
  /** The chips of «Ещё» that are not on screen now; the three functions where no width hid anything (then «Ещё» itself is not on screen). */
  const hiddenNow = (): readonly MoreId[] => {
    const off = (selector: string): boolean => ![...(bar.current?.querySelectorAll<HTMLElement>(selector) ?? [])].some(visible);
    const ids = [...(off('.cg-slot--two') ? TIER_TWO : []), ...(off('.cg-slot--boards') ? BOARDS : [])];
    return ids.length > 0 && buttons().some(visible) ? ids : TIER_TWO;
  };
  const alignMore = (): void => {
    const button = moreRef.current?.getBoundingClientRect();
    const strip = bar.current?.getBoundingClientRect();
    setMoreAlign(button !== undefined && strip !== undefined && button.left + MENU_MIN_WIDTH_PX > strip.right ? 'end' : 'start');
  };
  useLayoutEffect(() => {
    // One tab stop for the whole bar (ui-design §6.3); it never sits on a chip a narrower composer hid.
    const all = buttons();
    const list = shown();
    const current = all[STOPS.indexOf(stop)];
    const first = list[0];
    if (first !== undefined && (current === undefined || !list.includes(current))) setStop(STOPS[all.indexOf(first)] ?? 'reply');
    // «Ещё» is active, busy or ready for the chips it stands for, and lists them.
    const next = hiddenNow();
    if (next.length !== moreIds.length || next.some((id, index) => id !== moreIds[index])) setMoreIds(next);
    // The composer may change its width under an open «Ещё» (a ChatSpace panel opens, the window
    // shrinks): the menu stays inside the dock, and goes away with its button on a wide composer.
    if (!menuOpen) return;
    const laidOut = all.filter(visible);
    if (laidOut.length > 0 && moreRef.current !== null && !laidOut.includes(moreRef.current)) setMenuOpen(false);
    else alignMore();
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
  /** A hint is the control's name (and its key) with one sentence under it: what the chip does (UI-004). */
  const hinted = (title: string, hint: I18nKey): string => `${title}\n${t(hint)}`;
  const keyed = (name: string, keys: ReturnType<typeof hotkeyText>): string => (keys === null ? name : t('dock.action.tooltip', { action: name, hotkey: keys.display }));
  const offText = (id: DockActionId, why: string): string => t('dock.action.unavailable', { action: nameOf(id), reason: why });

  const actionButton = (id: DockActionId): JSX.Element => {
    const action = vm.actions[id];
    const name = nameOf(id);
    const off = whyOff(id);
    let tooltip = action.busy ? t('dock.action.busy', { action: name, hotkey: cancelKey }).trim() : hinted(keyed(name, hotkeyText(action.hotkey)), `dock.hint.${id}`);
    if (action.badge !== null) tooltip = `${tooltip}\n${t('dock.badge.recapReady')}`;
    const icon = id === 'review' || id === 'recap' || id === 'coach' ? ICONS[id] : null;
    return (
      <StripButton
        label={name}
        {...(id === 'reply' ? { class: 'cg-act--main' } : {})}
        {...(icon === null ? {} : { class: 'cg-act--ico', iconable: true, leading: <Icon name={icon} size={14} /> })}
        hotkey={action.enabled ? action.hotkey : null}
        active={action.active}
        busy={action.busy}
        ready={action.badge !== null}
        reason={off === null ? null : hints ? hinted(offText(id, off), `dock.hint.${id}`) : offText(id, off)}
        tooltip={tooltip}
        onClick={() => run(stripAction(id, vm))}
        {...stopProps(id)}
      />
    );
  };

  // ── the capsule: tones and Split ──
  const toneOff = locked ? t('dock.option.toneLocked') : toneReason === null ? null : t('dock.option.toneUnavailable', { reason: i18n.text(toneReason.text) });
  const chooseTone = (id: Tone): void => {
    if (vm.targetHandle === null) return;
    // A second click on the tone that is already chosen only takes the tone off (AI-006).
    if (id === tone) run({ type: 'SetTone', targetHandle: vm.targetHandle, tone: null });
    // A tone runs Reply in it at once (AI-005); with Reply off it is only remembered.
    else if (vm.actions.reply.enabled) run({ type: 'Generate', targetHandle: vm.targetHandle, feature: 'reply', options: { tone: id } });
    else run({ type: 'SetTone', targetHandle: vm.targetHandle, tone: id });
  };
  const toneKeys = hotkeyText(vm.options.toneHotkey);
  const toneButton = (id: Tone): JSX.Element => {
    const name = t(`dock.tone.${id}`);
    const value = t('dock.option.toneValue', { tone: name });
    const title = hinted(`${TONE_EMOJI[id]} ${tone === id || !vm.actions.reply.enabled ? value : `${nameOf('reply')} · ${value}`}`, `dock.hint.tone.${id}`);
    // The last line of a hint: how to take the chosen tone off, or the key that walks the tones without running Reply (AI-008).
    const last = tone === id ? t('dock.hint.toneOff') : toneKeys === null ? null : t('dock.option.toneTooltip', { hotkey: toneKeys.display });
    return (
      <StripButton
        key={id}
        label={name}
        class="cg-opt cg-tone"
        pressed={tone === id}
        reason={toneOff}
        tooltip={last === null ? title : `${title}\n${last}`}
        leading={
          <span class="cg-tone__e" aria-hidden="true">
            {TONE_EMOJI[id]}
          </span>
        }
        onClick={() => chooseTone(id)}
        {...stopProps(`tone:${id}`)}
      />
    );
  };
  const splitOff =
    locked
      ? t('dock.option.splitLocked')
      : splitReason === null
        ? null
        : splitReason.id === 'not-a-message'
          ? i18n.text(splitReason.text)
          : t('dock.option.splitUnavailable', { reason: i18n.text(splitReason.text) });
  const splitKeys = hotkeyText(vm.options.splitHotkey);

  // ── the windows ──
  const boardName = (id: BoardId): string => t(id === 'spenders' ? 'spenders.title' : 'newcomers.title');
  const boardKey = (id: BoardId): ReturnType<typeof hotkeyText> => (id === 'spenders' ? hotkeyText(deps.catalog.entry('spenders').hotkey) : null);
  const openBoard = (id: BoardId): void => run({ type: 'Navigate', to: { kind: 'surface', surface: id, open: true } });

  // ── «Ещё»: whatever a narrow composer hid — Review, Recap, Coach, the two windows ──
  const listed = moreIds.filter((id) => !isBoard(id) || !vm.statusWords);
  const hidden = TIER_TWO.filter((id) => moreIds.includes(id));
  const firstOff = hidden.find((id) => !vm.actions[id].enabled) ?? null;
  // The windows open whatever the chat's state is: «Ещё» is off only while all it holds is functions that are off.
  const moreOff = firstOff !== null && !listed.some(isBoard) && hidden.every((id) => !vm.actions[id].enabled) ? t('dock.action.moreUnavailable', { reason: whyOff(firstOff) ?? '' }) : null;
  const moreItems: MenuItem[] = listed.map((id) => {
    const keys = isBoard(id) ? boardKey(id) : hotkeyText(vm.actions[id].hotkey);
    const off = isBoard(id) ? null : whyOff(id);
    return { id, label: isBoard(id) ? boardName(id) : nameOf(id), ...(keys === null ? {} : { hint: keys.display }), reason: off === null || isBoard(id) ? null : offText(id, off) };
  });
  const openMore = (): void => {
    alignMore();
    setMenuOpen(true);
  };

  // ── the quota: a count at the goose's corner, its words in the hint ──
  const quota = quotaSlot(vm);
  const remaining = vm.quota?.remaining ?? 0;
  const resets = vm.quota?.resetsAt ?? null;
  // «Обновится в 03:00 по Москве» names its zone, so that time is Moscow's wherever the chatter sits.
  const resetsMoscow = resets === null ? null : (i18n.formatTimeIn?.(resets, QUOTA_RESET_TIME_ZONE) ?? null);
  const quotaText =
    quota === null
      ? null
      : quota === 'zero'
        ? resetsMoscow === null
          ? t('dock.quota.zero')
          : `${t('dock.quota.zero')}\n${t('dock.quota.zeroTooltip', { time: resetsMoscow })}`
        : resets === null
          ? t('dock.quota.low', { n: remaining })
          : t('dock.quota.lowTooltip', { n: remaining, time: i18n.formatTime(resets) });

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (menuOpen || event.defaultPrevented) return;
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('.cg-act') : null;
    if (target === null) return;
    const list = shown();
    const next = rovingIndex(event.key, list.indexOf(target), list.length, 'horizontal');
    if (next === null) return;
    event.preventDefault();
    focusQuietly(list[next]);
  };

  return (
    <div
      ref={bar}
      class={vm.statusWords ? 'cg-strip has-status' : 'cg-strip'}
      role="toolbar"
      aria-label={t('dock.label')}
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      onFocusIn={(event) => {
        const id = stopOf(event.target);
        if (id !== null && id !== stop) setStop(id);
      }}
    >
      <div class="cg-strip__acts">
        {DOCK_ACTION_IDS.map((id) => (
          <Fragment key={id}>
            <span class={TIER_TWO.includes(id) ? 'cg-slot cg-slot--two' : id === 'reply' ? 'cg-slot cg-slot--reply' : 'cg-slot'}>
              {GROUP_START.includes(id) ? <Divider /> : null}
              {actionButton(id)}
              {id === 'reply' && quotaText !== null ? <Quota count={quota === 'zero' ? 0 : remaining} text={quotaText} /> : null}
            </span>
            {id !== 'reply' ? null : (
              // The capsule of Reply's options: a click on a tone is Reply in that tone; behind the seam — Split.
              <span class="cg-tones">
                <span class="cg-tones__track" role="group" aria-label={t('dock.option.tone')}>
                  {tones.map(toneButton)}
                </span>
                <span class="cg-tones__seam" aria-hidden="true" />
                <StripButton
                  label={t('dock.option.split')}
                  class="cg-opt cg-split"
                  hotkey={vm.options.splitHotkey}
                  pressed={split}
                  reason={splitOff}
                  tooltip={hinted(splitKeys === null ? t('dock.option.split') : t('dock.option.splitTooltip', { hotkey: splitKeys.display }), 'dock.hint.split')}
                  leading={<CheckGlyph on={split} />}
                  onClick={() => run({ type: 'SetPreference', key: 'generation.split', value: !split })}
                  {...stopProps('split')}
                />
                {locked ? <Icon name="lock" size={12} class="cg-lock" /> : null}
              </span>
            )}
          </Fragment>
        ))}
        <span class="cg-slot cg-slot--more">
          <MenuAnchor>
            <StripButton
              label={t('dock.action.more')}
              class="cg-more"
              active={hidden.some((id) => vm.actions[id].active)}
              busy={hidden.some((id) => vm.actions[id].busy)}
              ready={hidden.some((id) => vm.actions[id].badge !== null)}
              reason={moreOff}
              tooltip={listed.map((id) => (isBoard(id) ? boardName(id) : nameOf(id))).join(', ')}
              haspopup="menu"
              expanded={menuOpen}
              buttonRef={moreRef}
              onClick={() => (menuOpen ? setMenuOpen(false) : openMore())}
              onKeyDown={(event) => {
                if (moreOff === null) menuTriggerKeys(event, openMore);
              }}
              {...stopProps('more')}
            />
            <Menu
              open={menuOpen}
              kind="action"
              label={t('dock.action.more')}
              items={moreItems}
              align={moreAlign}
              onSelect={(id) => (isBoard(id) ? openBoard(id) : run(stripAction(id as DockActionId, vm)))}
              onClose={() => setMenuOpen(false)}
              returnFocusTo={() => moreRef.current}
            />
          </MenuAnchor>
        </span>
      </div>
      <div class="cg-strip__opts">
        {vm.statusWords ? (
          <span class="cg-status-word" role="status">
            <Spinner />
            <span class="cg-long">{t('dock.status.chatLoading')}</span>
            <span class="cg-short">{t('common.loading')}</span>
          </span>
        ) : null}
        <span class="cg-slot cg-slot--boards">
          {BOARDS.map((id) => (
            <StripButton
              key={id}
              label={boardName(id)}
              class="cg-act--ico"
              iconable
              leading={<Icon name={ICONS[id]} size={14} />}
              hotkey={id === 'spenders' ? deps.catalog.entry('spenders').hotkey : null}
              tooltip={hinted(keyed(boardName(id), boardKey(id)), `dock.hint.${id}`)}
              onClick={() => openBoard(id)}
              {...stopProps(id)}
            />
          ))}
        </span>
        <span class="cg-slot cg-slot--persona">
          <Divider />
          {vm.status === 'not-signed-in' ? (
            <span class="cg-persona is-missing">{t('dock.persona.notSignedIn')}</span>
          ) : vm.persona === null ? null : (
            <Word class="cg-persona" text={vm.persona.label} tooltip={hints ? t('dock.persona.tooltip', { page: vm.persona.pageName }) : null} />
          )}
        </span>
        {vm.paletteHotkey === null ? null : <Word class="cg-hint" text={hotkeyText(vm.paletteHotkey)?.display ?? ''} tooltip={hints ? t('dock.paletteHint.tooltip') : null} />}
      </div>
    </div>
  );
}
