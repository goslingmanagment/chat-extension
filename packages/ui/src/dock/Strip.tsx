// The bar (ui-design §3.1, §3.3, §4.1; UI-002…UI-010, UI-031, AI-002…
// AI-010): one 40 px card above the composer — Reply with the capsule of its
// options, the other AI actions as raised chips in groups, «Ещё» where a
// narrow composer hid some, then the status words, the two windows (Spenders,
// «Новые»), the persona and the palette key. No goose: its cell is the room
// that keeps every chip on a ~540 px composer (decision X31).
// `role="toolbar"`: one tab stop, arrows inside. What hides at which width is
// CSS (container queries, styles.ts); the markup is the same at every width.
//
// The chips are data (`DockVM.chips`, R20 F4): which features have a chip on
// this site, in which group and order, with which icon, what a click asks for
// — the site's slice of the feature manifest, built by the dock's controller.
// The bar knows the groups, not the features: Reply's group carries the
// capsule and the quota, the windows stand in the right block, a seam stands
// before the first chip of every next group, and what a narrow composer hides
// goes into «Ещё».
//
// Actions are raised chips; options lie in a sunken capsule pressed against
// Reply (decision X28, the Fansly extension's bar): the four tones as emoji —
// one click runs Reply in that tone (AI-005), a click on the chosen one takes
// it off (AI-006), and it rises as a thumb — and, behind a seam, Split,
// pressed in while on. The capsule stands at every width: there is no menu to
// open for a tone.

import { Fragment, type JSX, type TargetedKeyboardEvent } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

import { type Tone } from '@cg/contracts/features';
import { type ChipVM, type DockChipGroup, type DockVM, type UiAction } from '@cg/contracts/vm';

import {
  CheckGlyph,
  DOCK_GROUP_SLOT,
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
  type MenuItem,
} from '../kit';
import { QUOTA_RESET_TIME_ZONE, quotaSlot } from './model';

/** Reply's group: its chip is the bar's main one, with the capsule of its options after it and the quota at its corner. */
const LEAD: DockChipGroup = 'reply';
/** The windows that open from the bar stand in its right block, and give their place to the status while the chat loads. */
const WINDOWS: DockChipGroup = 'windows';
/** What «Ещё» stands for where no width hid anything: the chips a narrow composer hides first (ui-design §3.3). */
const FOLDS_FIRST: DockChipGroup = 'analysis';
/** The tones in the chatters' own language (the Fansly extension's capsule); the word is the cell's name and its hint. */
const TONE_EMOJI: Readonly<Record<Tone, string>> = { casual: '😌', flirty: '😏', upsell: '💰', spicy: '🔥' };
/** The kit's menus are at least this wide (ui-design §4.1). */
const MENU_MIN_WIDTH_PX = 200;
const NO_CHIPS: readonly ChipVM[] = [];

/** A chip by its feature's key, the capsule's cells, «Ещё». */
type StopId = string;

function visible(element: HTMLElement): boolean {
  return element.getClientRects().length > 0;
}

const inWindows = (chip: ChipVM): boolean => chip.group === WINDOWS;

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
  const chips = vm.chips ?? NO_CHIPS;
  const acts = chips.filter((chip) => !inWindows(chip));
  const windows = chips.filter(inWindows);
  /** What «Ещё» stands for where nothing is laid out, and where no width hid anything. */
  const foldsFirst = (): readonly string[] => chips.filter((chip) => chip.group === FOLDS_FIRST).map((chip) => chip.id);
  /** What «Ещё» stands for: the chips a narrow composer hid. */
  const [moreIds, setMoreIds] = useState<readonly string[]>(foldsFirst);
  /** «Ещё» opens from its left edge; on a composer too narrow for that — from its right edge, inside the dock. */
  const [moreAlign, setMoreAlign] = useState<'start' | 'end'>('start');
  const [stop, setStop] = useState<StopId>('reply');
  // The composer's width decides what is hidden: a new width is a new look at it.
  void useGeometry().value;
  const t = i18n.t.bind(i18n);
  const { tone, tones, locked, toneReason, splitReason, split } = vm.options;
  /** The bar's chips in DOM order: the tab stop is one of them, arrows walk the ones a width left visible. */
  const STOPS: readonly StopId[] = acts
    .flatMap((chip): StopId[] => (chip.group === LEAD ? [chip.id, ...tones.map((item): StopId => `tone:${item}`), 'split'] : [chip.id]))
    .concat('more', ...windows.map((chip) => chip.id));

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
  /** The chips that are not on screen now; the ones that fold first where no width hid anything (then «Ещё» itself is not on screen). */
  const hiddenNow = (): readonly string[] => {
    const all = buttons();
    const ids = chips.map((chip) => chip.id).filter((id) => {
      const button = all[STOPS.indexOf(id)];
      return button !== undefined && !visible(button);
    });
    return ids.length > 0 && all.some(visible) ? ids : foldsFirst();
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
  const nameOf = (chip: ChipVM): string => i18n.text(chip.label);
  const whyOff = (chip: ChipVM): string | null => {
    if (chip.enabled) return null;
    return chip.reason === null ? t('common.unknown') : i18n.text(chip.reason.text);
  };
  const stopProps = (id: StopId): { readonly tabIndex: 0 | -1 } => ({ tabIndex: stop === id ? 0 : -1 });
  /** A hint is the control's name (and its key) with one sentence under it: what the chip does (UI-004). */
  const hinted = (title: string, hint: string): string => `${title}\n${hint}`;
  const keyed = (name: string, keys: ReturnType<typeof hotkeyText>): string => (keys === null ? name : t('dock.action.tooltip', { action: name, hotkey: keys.display }));
  const offText = (chip: ChipVM, why: string): string => t('dock.action.unavailable', { action: nameOf(chip), reason: why });

  const chipButton = (chip: ChipVM): JSX.Element => {
    const name = nameOf(chip);
    const hint = i18n.text(chip.hint);
    const off = whyOff(chip);
    let tooltip = chip.busy ? t('dock.action.busy', { action: name, hotkey: cancelKey }).trim() : hinted(keyed(name, hotkeyText(chip.hotkey)), hint);
    if (chip.badge !== null) tooltip = `${tooltip}\n${t('dock.badge.recapReady')}`;
    return (
      <StripButton
        key={chip.id}
        label={name}
        {...(chip.group === LEAD ? { class: 'cg-act--main' } : {})}
        {...(chip.icon === null ? {} : { class: 'cg-act--ico', iconable: true, leading: <Icon name={chip.icon} size={14} /> })}
        hotkey={chip.enabled ? chip.hotkey : null}
        active={chip.active}
        busy={chip.busy}
        ready={chip.badge !== null}
        reason={off === null ? null : hints ? hinted(offText(chip, off), hint) : offText(chip, off)}
        tooltip={tooltip}
        onClick={() => run(chip.action)}
        {...stopProps(chip.id)}
      />
    );
  };

  // ── the capsule: tones and Split ──
  const toneOff = locked ? t('dock.option.toneLocked') : toneReason === null ? null : t('dock.option.toneUnavailable', { reason: i18n.text(toneReason.text) });
  // X68: a tone is chosen, as in the old extension — the next Reply goes with it; Reply itself is its own click.
  // A second click on the tone that is already chosen takes it off (AI-006).
  const chooseTone = (id: Tone): void => {
    if (vm.targetHandle === null) return;
    run({ type: 'SetTone', targetHandle: vm.targetHandle, tone: id });
  };
  const toneKeys = hotkeyText(vm.options.toneHotkey);
  const toneButton = (id: Tone): JSX.Element => {
    const name = t(`dock.tone.${id}`);
    const value = t('dock.option.toneValue', { tone: name });
    const title = hinted(`${TONE_EMOJI[id]} ${value}`, t(`dock.hint.tone.${id}`));
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

  // ── «Ещё»: whatever a narrow composer hid — Review, Recap, Coach, the two windows ──
  const folded = chips.filter((chip) => moreIds.includes(chip.id));
  // While the chat loads nothing can be opened from the bar: the windows are not offered in «Ещё» either.
  const listed = folded.filter((chip) => !inWindows(chip) || !vm.statusWords);
  const hidden = folded.filter((chip) => !inWindows(chip));
  const firstOff = hidden.find((chip) => !chip.enabled) ?? null;
  // The windows open whatever the chat's state is: «Ещё» is off only while all it holds is functions that are off.
  const moreOff = firstOff !== null && !listed.some(inWindows) && hidden.every((chip) => !chip.enabled) ? t('dock.action.moreUnavailable', { reason: whyOff(firstOff) ?? '' }) : null;
  const moreItems: MenuItem[] = listed.map((chip) => {
    const keys = hotkeyText(chip.hotkey);
    const off = whyOff(chip);
    return { id: chip.id, label: nameOf(chip), ...(keys === null ? {} : { hint: keys.display }), reason: off === null ? null : offText(chip, off) };
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
        {acts.map((chip, index) => (
          <Fragment key={chip.id}>
            <span class={DOCK_GROUP_SLOT[chip.group]}>
              {/* A hairline seam before the first chip of every next group: Reply and its options │ Fix │ Hi · Ping │ Review · Recap · Coach. */}
              {index > 0 && acts[index - 1]?.group !== chip.group ? <Divider /> : null}
              {chipButton(chip)}
              {chip.group === LEAD && quotaText !== null ? <Quota count={quota === 'zero' ? 0 : remaining} text={quotaText} /> : null}
            </span>
            {chip.group !== LEAD ? null : (
              // The capsule of Reply's options: a tone is chosen for the next Reply (X68); behind the seam — Split.
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
                  tooltip={hinted(splitKeys === null ? t('dock.option.split') : t('dock.option.splitTooltip', { hotkey: splitKeys.display }), t('dock.hint.split'))}
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
              active={hidden.some((chip) => chip.active)}
              busy={hidden.some((chip) => chip.busy)}
              ready={hidden.some((chip) => chip.badge !== null)}
              reason={moreOff}
              tooltip={listed.map(nameOf).join(', ')}
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
              onSelect={(id) => run(chips.find((chip) => chip.id === id)?.action ?? null)}
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
        {windows.length === 0 ? null : <span class={DOCK_GROUP_SLOT[WINDOWS]}>{windows.map(chipButton)}</span>}
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
